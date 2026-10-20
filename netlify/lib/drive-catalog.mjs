import { normalizeCatalog } from "../../lib/catalog-curator.js";
import { getDriveAccessToken, googleDriveConfig, isDriveId } from "./google-drive.mjs";
import { googleDriveFileId } from "../../lib/dreamweaver-playback.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const MAX_INDEX_BYTES = 1024 * 1024;
const CACHE_MS = 60_000;
const CORS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type",
});
const FRIENDLY_ERROR = "The music catalog is temporarily unavailable. Please try again shortly.";

function json(value, status = 200, method = "GET") {
  const response = Response.json(value, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
  return method === "HEAD" ? new Response(null, response) : response;
}

async function boundedJson(response) {
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_INDEX_BYTES || !response.body) throw new Error("Catalog response unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INDEX_BYTES) throw new Error("Catalog response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function verifiedAsset(file, fileId, folderId) {
  return file?.id === fileId && file.trashed === false &&
    Array.isArray(file.parents) && file.parents.includes(folderId) &&
    /^audio\/[a-z0-9.+-]+$/i.test(file.mimeType || "") &&
    Number.isSafeInteger(Number(file.size)) && Number(file.size) > 0;
}

export function driveCatalogConfig(env = process.env) {
  const settings = googleDriveConfig(env);
  if (!settings && [
    "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_DRIVE_MASTERS_FOLDER_ID",
  ].some(name => String(env[name] || "").trim())) throw new Error("Invalid Drive catalog configuration");
  return settings;
}

// Each service owns only one validated catalog; failed refreshes never serve stale grants.
export function createDriveCatalogService({
  fetchImpl = globalThis.fetch,
  config = () => driveCatalogConfig(),
  getAccessToken = getDriveAccessToken,
  now = Date.now,
  timeoutMs = 30_000,
} = {}) {
  let cached = null;
  let pending = null;

  async function timedFetch(url, init = {}, streaming = false) {
    const target = new URL(url);
    if (target.origin !== "https://www.googleapis.com" &&
        target.href !== "https://oauth2.googleapis.com/token") throw new Error("Invalid upstream");
    if (!streaming) return fetchImpl(target.href, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(target.href, { ...init, redirect: "error", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function readAudio(reader) {
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            void reader.cancel().catch(() => {});
            reject(new Error("Audio read timed out"));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function ingest(settings, key) {
    const token = await getAccessToken(settings, { fetchImpl: timedFetch });
    const headers = { Authorization: ["Bearer", token].join(" ") };
    const apiJson = async url => boundedJson(await timedFetch(url, { headers }));
    const indexes = [];
    const seenTokens = new Set();
    let pageToken = "";
    do {
      const url = new URL(DRIVE_API);
      url.search = new URLSearchParams({
        q: `'${settings.folderId}' in parents and trashed = false and name = 'catalog-index.json'`,
        fields: "nextPageToken,files(id,name,size,mimeType,parents,trashed)",
        pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const page = await apiJson(url);
      if (!Array.isArray(page.files)) throw new Error("Invalid catalog listing");
      indexes.push(...page.files);
      if (indexes.length > 1) throw new Error("Ambiguous catalog index");
      pageToken = page.nextPageToken || "";
      if (typeof pageToken !== "string" || (pageToken && seenTokens.has(pageToken)) || seenTokens.size >= 100) throw new Error("Invalid catalog pagination");
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    const index = indexes[0];
    if (!index || !isDriveId(index.id) || index.name !== "catalog-index.json" ||
        index.trashed !== false || !index.parents?.includes(settings.folderId) ||
        Number(index.size) > MAX_INDEX_BYTES) throw new Error("Catalog index unavailable");
    const raw = await apiJson(`${DRIVE_API}/${encodeURIComponent(index.id)}?alt=media&supportsAllDrives=true`);
    if (!raw || raw.version !== 1 || !Array.isArray(raw.tracks)) throw new Error("Invalid catalog");
    // Publication consent is checked before normalization; drafts cannot enter the allowlist.
    const publicTracks = raw.tracks.filter(track => track?.public === true);
    const normalized = normalizeCatalog({ version: raw.version, tracks: publicTracks });
    const fileIds = [...new Set(normalized.tracks.map(track => track.driveFileId))];
    let nextAsset = 0;
    let verificationFailed = false;
    await Promise.all(Array.from({ length: Math.min(6, fileIds.length) }, async () => {
      while (!verificationFailed && nextAsset < fileIds.length) {
        const fileId = fileIds[nextAsset++];
        try {
          if (!isDriveId(fileId)) throw new Error("Invalid catalog audio reference");
          const file = await apiJson(`${DRIVE_API}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,size,mimeType,parents,trashed`);
          if (!verifiedAsset(file, fileId, settings.folderId)) throw new Error("Catalog audio unavailable");
        } catch (error) {
          verificationFailed = true;
          throw error;
        }
      }
    }));
    const allowlist = new Map();
    const tracks = normalized.tracks.map(track => {
      if (allowlist.has(track.id)) throw new Error("Invalid catalog identity");
      allowlist.set(track.id, track.driveFileId);
      const proxy = `/api/drive-catalog/audio?track=${encodeURIComponent(track.id)}`;
      return { ...track, streamUrl: track.primaryAudioPath || proxy, fallbackUrl: proxy };
    });
    return { key, expires: now() + CACHE_MS, catalog: { version: 1, tracks, configured: true }, allowlist, token };
  }

  async function load() {
    const settings = typeof config === "function" ? config() : config;
    if (!settings) return null;
    if (!isDriveId(settings.folderId)) throw new Error("Invalid folder");
    const key = JSON.stringify([settings.folderId, settings.clientEmail, settings.privateKey]);
    if (cached?.key === key && now() < cached.expires) return cached;
    if (pending?.key === key) return pending.promise;
    cached = null;
    const promise = ingest(settings, key);
    pending = { key, promise };
    try {
      const result = await promise;
      if (pending?.promise === promise) cached = result;
      return result;
    } finally {
      if (pending?.promise === promise) pending = null;
    }
  }

  function preflight(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response(null, { status: 405, headers: { ...CORS, Allow: "GET, HEAD, OPTIONS" } });
    }
    return null;
  }

  async function catalogHandler(request) {
    const early = preflight(request);
    if (early) return early;
    try {
      const loaded = await load();
      return json(loaded?.catalog || { configured: false, tracks: [] }, 200, request.method);
    } catch {
      return json({ configured: true, tracks: [], message: FRIENDLY_ERROR }, 503, request.method);
    }
  }

  async function audioHandler(request) {
    const early = preflight(request);
    if (early) return early;
    try {
      const loaded = await load();
      if (!loaded) return json({ message: "Music catalog is not configured." }, 404, request.method);
      const params = new URL(request.url).searchParams;
      const trackId = params.get("track");
      const fileId = params.getAll("track").length === 1 && loaded.allowlist.get(trackId);
      if (!fileId) return json({ message: "Track not found." }, 404, request.method);
      const headers = {
        Authorization: ["Bearer", loaded.token].join(" "),
        "Accept-Encoding": "identity",
      };
      if (request.headers.has("range")) headers.Range = request.headers.get("range");
      const upstream = await timedFetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
        method: request.method, headers,
      }, true);
      const outputHeaders = new Headers({ ...CORS, "Cache-Control": "no-store", "Accept-Ranges": "bytes" });
      for (const name of ["Content-Length", "Content-Range", "Content-Type", "Accept-Ranges"]) {
        if (upstream.headers.has(name)) outputHeaders.set(name, upstream.headers.get(name));
      }
      if (upstream.status === 416) {
        await upstream.body?.cancel();
        outputHeaders.delete("Content-Length");
        outputHeaders.delete("Content-Type");
        return new Response(null, { status: 416, headers: outputHeaders });
      }
      if (![200, 206].includes(upstream.status) || !/^audio\//i.test(upstream.headers.get("content-type") || "")) {
        await upstream.body?.cancel();
        throw new Error("Audio unavailable");
      }
      if (request.method === "HEAD") {
        await upstream.body?.cancel();
        return new Response(null, { status: upstream.status, headers: outputHeaders });
      }
      if (!upstream.body) throw new Error("Audio unavailable");
      const reader = upstream.body.getReader();
      const first = await readAudio(reader);
      const prefix = new TextDecoder().decode(first.value?.subarray(0, 256)).trimStart();
      if (first.done || /^(?:<!doctype\s+html|<html\b|<\?xml\b|\{\s*"error"\s*:)/i.test(prefix)) {
        await reader.cancel();
        throw new Error("Audio unavailable");
      }
      // Forward backpressure and cancellation instead of materializing large private masters.
      let initial = first.value;
      const body = new ReadableStream({
        async pull(controller) {
          try {
            if (initial) {
              controller.enqueue(initial);
              initial = null;
              return;
            }
            const part = await readAudio(reader);
            if (part.done) controller.close();
            else controller.enqueue(part.value);
          } catch {
            await reader.cancel().catch(() => {});
            controller.error(new Error("Audio stream interrupted"));
          }
        },
        cancel(reason) { return reader.cancel(reason); },
      });
      return new Response(body, { status: upstream.status, headers: outputHeaders });
    } catch {
      return json({ message: FRIENDLY_ERROR }, 503, request.method);
    }
  }

  async function resolveAudioProxy(candidates = []) {
    const fileIds = candidates.map(googleDriveFileId).filter(Boolean);
    if (!fileIds.length) return "";
    const loaded = await load();
    if (!loaded) return "";
    for (const fileId of fileIds) {
      const track = [...loaded.allowlist].find(([, allowedFile]) => allowedFile === fileId);
      if (track) return `/api/drive-catalog/audio?track=${encodeURIComponent(track[0])}`;
    }
    return "";
  }

  return { catalogHandler, audioHandler, resolveAudioProxy };
}

export const driveCatalogService = createDriveCatalogService();
