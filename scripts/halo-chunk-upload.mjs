#!/usr/bin/env node
// HALO chunked audio uploader for large alternate-version files (WAV masters, Spanish mixes, edits).
// Streams a local file to /api/song-catalog/audio in 4 MB numbered parts with per-chunk SHA-256,
// retries transient failures with backoff, resumes from the server's upload_status, and finalizes.
//
//   HALO_UPLOAD_TOKEN=<Netlify Identity access token> HALO_BASE_URL=https://<site> \
//     node scripts/halo-chunk-upload.mjs --song <songId> --version <versionId> --file ./mix.wav
//   ...or watch a drop folder (finished files move to uploaded/ or failed/):
//     node scripts/halo-chunk-upload.mjs --song <songId> --version <versionId> --watch ./staging_uploads
import { createHash } from "node:crypto";
import { createReadStream, watch } from "node:fs";
import { mkdir, open, readdir, rename, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
export const AUDIO_PATH = "/api/song-catalog/audio";
export const AUDIO_EXTENSIONS = new Map([
  [".wav", "audio/wav"], [".flac", "audio/flac"], [".mp3", "audio/mpeg"], [".m4a", "audio/mp4"],
  [".mp4", "audio/mp4"], [".aac", "audio/aac"], [".ogg", "audio/ogg"], [".webm", "audio/webm"],
]);
const RETRYABLE_STATUSES = new Set([408, 422, 425, 429, 500, 502, 503, 504]);
const PARTIAL_SUFFIXES = /\.(?:tmp|part|partial|crdownload|download)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const sha256 = data => createHash("sha256").update(data).digest("hex");

export class UploadError extends Error {
  constructor(message, status = 0, data = {}) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.data = data;
  }
}

/** Only HTTPS targets may receive the bearer token; plain HTTP is limited to local dev servers. */
export function resolveBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new UploadError("Set HALO_BASE_URL (or --base) to the HALO site URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new UploadError("HALO_BASE_URL must use https:// (http:// is only allowed for localhost)");
  return url.origin;
}

export function audioContentType(filePath) {
  return AUDIO_EXTENSIONS.get(extname(filePath).toLowerCase()) || "";
}

export function isCandidateAudioFile(name) {
  const file = basename(String(name || ""));
  return Boolean(file) && !file.startsWith(".") && !PARTIAL_SUFFIXES.test(file) && Boolean(audioContentType(file));
}

/** Calls the audio API with bearer auth, a same-origin Origin header, per-request timeouts, and backoff retries. */
export function createAudioApiClient({ baseUrl, token, fetchImpl = fetch, timeoutMs = 60_000, retryDelays = [1000, 2000, 4000, 8000, 16000], sleepImpl = sleep, log = () => {} }) {
  const origin = resolveBaseUrl(baseUrl);
  if (!String(token || "").trim()) throw new UploadError("Set HALO_UPLOAD_TOKEN to a signed-in HALO access token");
  const endpoint = new URL(AUDIO_PATH, origin).href;
  const authScheme = "Bearer";
  const headers = { Authorization: [authScheme, String(token).trim()].join(" "), Origin: origin, Accept: "application/json" };

  async function send(buildInit, label, reconcile) {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      let data;
      let failure;
      try {
        const init = buildInit();
        response = await fetchImpl(endpoint, { method: "POST", ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
        try {
          data = await response.json();
        } catch (error) {
          if (response.ok) throw error;
          data = {};
        }
      } catch (error) {
        failure = new UploadError(`${label} failed: ${error instanceof Error ? error.message : "network error"}`);
      }
      if (!failure && response.ok) return data;
      if (!failure) {
        failure = new UploadError(data?.message || `${label} failed with HTTP ${response.status}`, response.status, data);
        if (!RETRYABLE_STATUSES.has(response.status)) {
          if (response.status === 409 && data?.finalized === true && reconcile) {
            const recovered = await reconcile();
            if (recovered) return recovered;
          }
          throw failure;
        }
      }
      if (attempt < retryDelays.length) {
        log(`${label}: reconciling before retry in ${retryDelays[attempt]} ms`);
        await sleepImpl(retryDelays[attempt]);
      }
      // A failed acknowledgement does not mean the write failed. Never repeat a write
      // without a fresh status read, including after the final allowed attempt.
      const recovered = reconcile ? await reconcile() : null;
      if (recovered) return recovered;
      if (attempt >= retryDelays.length) throw failure;
    }
  }

  return {
    endpoint,
    json: (payload, label = String(payload?.action || "request"), reconcile) => send(() => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), label, reconcile),
    form: (fields, label = "chunk", reconcile) => send(() => {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) {
        if (value instanceof Blob) form.append(name, value, fields.filename || "audio");
        else form.append(name, String(value));
      }
      return { body: form };
    }, label, reconcile),
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(filePath)) hash.update(data);
  return hash.digest("hex");
}

/** Same file + version + chunk size always maps to the same session, so a restarted upload resumes. */
export function deterministicUploadId({ versionId, fileSha256, chunkSize }) {
  return `cli-${sha256(`${versionId}:${fileSha256}:${chunkSize}`).slice(0, 40)}`;
}

export async function uploadAudioFile({ filePath, songId, versionId, client, chunkSize = CHUNK_BYTES, durationSeconds = 0, log = () => {} }) {
  if (!UUID.test(String(songId || "")) || !UUID.test(String(versionId || ""))) throw new UploadError("--song and --version must be HALO song and version IDs");
  const contentType = audioContentType(filePath);
  if (!contentType) throw new UploadError(`Unsupported audio file: ${basename(filePath)} (use WAV, FLAC, MP3, M4A, AAC, OGG, or WebM)`);
  const { size: byteSize } = await stat(filePath);
  if (!byteSize) throw new UploadError(`${basename(filePath)} is empty`);
  if (byteSize > MAX_UPLOAD_BYTES) throw new UploadError(`${basename(filePath)} is larger than the 128 MB song audio limit`);
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > CHUNK_BYTES) throw new UploadError("Chunk size must be between 1 byte and 4 MB");

  const filename = basename(filePath);
  const chunkCount = Math.ceil(byteSize / chunkSize);
  const uploadId = deterministicUploadId({ versionId, fileSha256: await sha256File(filePath), chunkSize });
  const session = { songId, versionId, uploadId, chunkCount, byteSize, chunkSize };
  const readStatus = async () => {
    const current = await client.json({ action: "upload_status", ...session }, "upload status");
    if (!current || typeof current.finalized !== "boolean" || !Array.isArray(current.receivedChunks)
      || !Array.isArray(current.invalidChunks) || !current.chunkChecksums || typeof current.chunkChecksums !== "object"
      || current.chunkCount !== chunkCount || current.byteSize !== byteSize) {
      throw new UploadError("The server returned invalid upload progress. No chunks were sent.");
    }
    return current;
  };
  const status = await readStatus();
  if (status.finalized) {
    log(`${filename} is already uploaded and finalized`);
    return { ...session, alreadyFinalized: true, uploadedChunks: 0, skippedChunks: chunkCount };
  }

  const handle = await open(filePath, "r");
  let uploadedChunks = 0;
  try {
    const readChunk = async index => {
      const start = index * chunkSize;
      const length = Math.min(chunkSize, byteSize - start);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      if (bytesRead !== length) throw new UploadError(`${filename} changed while uploading; drop it again once it is fully written`);
      return buffer;
    };
    const sendChunk = async (index, buffer) => {
      const checksum = sha256(buffer);
      const reconcileChunk = async () => {
        const current = await readStatus();
        const storedChecksum = current.chunkChecksums?.[index];
        if (storedChecksum && storedChecksum !== checksum) throw new UploadError("The stored chunk conflicts with this file. Start a new upload.", 409);
        return storedChecksum === checksum && !(current.invalidChunks || []).includes(index) ? { confirmed: true } : null;
      };
      if (await reconcileChunk()) return;
      await client.form({
        songId, versionId, uploadId, filename, contentType,
        chunkIndex: index, chunkCount, byteSize, chunkSize, offset: index * chunkSize, chunkSha256: checksum,
        chunk: new Blob([buffer], { type: contentType }),
      }, `chunk ${index + 1}/${chunkCount}`, reconcileChunk);
      uploadedChunks += 1;
      log(`uploaded chunk ${index + 1}/${chunkCount} (${Math.round(((index + 1) / chunkCount) * 100)}%)`);
    };

    const stored = status.chunkChecksums || {};
    const invalid = new Set(status.invalidChunks || []);
    for (let index = 0; index < chunkCount; index += 1) {
      const buffer = await readChunk(index);
      if (!invalid.has(index) && stored[index] === sha256(buffer)) continue;
      await sendChunk(index, buffer);
    }

    const finalize = () => client.json({ action: "finalize_upload", ...session, filename, contentType, durationSeconds }, "finalize", async () => {
      const current = await readStatus();
      return current.finalized ? {
        alreadyFinalized: true, persisted: true, audioUrl: `/api/song-catalog/audio?versionId=${encodeURIComponent(versionId)}`,
      } : null;
    });
    for (let round = 0; ; round += 1) {
      try {
        const result = await finalize();
        log(`${filename} finalized: ${result.message || "upload complete"}`);
        return { ...session, ...result, uploadedChunks, skippedChunks: chunkCount - uploadedChunks };
      } catch (error) {
        const resend = [...new Set([...(error?.data?.missingChunks || []), ...(error?.data?.invalidChunks || [])])];
        if (!(error instanceof UploadError) || error.status !== 409 || !resend.length || round >= 2) throw error;
        log(`server is missing ${resend.length} chunk(s); re-sending before finalizing again`);
        for (const index of resend) await sendChunk(index, await readChunk(index));
      }
    }
  } finally {
    await handle.close();
  }
}

/** Resolves once the file size stops changing, so half-copied drops are never uploaded. */
export async function waitForStableFile(filePath, { intervalMs = 2000, stableChecks = 2, sleepImpl = sleep } = {}) {
  let lastSize = -1;
  let stable = 0;
  while (stable < stableChecks) {
    const { size } = await stat(filePath);
    stable = size > 0 && size === lastSize ? stable + 1 : 0;
    lastSize = size;
    if (stable < stableChecks) await sleepImpl(intervalMs);
  }
  return lastSize;
}

/** Watches a drop folder and uploads each finished audio file one at a time. Returns a stop function. */
export async function watchFolder({ dir, upload, log = console.log, stableOptions = {} }) {
  const root = resolve(dir);
  const uploadedDir = join(root, "uploaded");
  const failedDir = join(root, "failed");
  await Promise.all([mkdir(uploadedDir, { recursive: true }), mkdir(failedDir, { recursive: true })]);
  const seen = new Set();
  let queue = Promise.resolve();

  const enqueue = name => {
    if (!isCandidateAudioFile(name) || seen.has(name)) return queue;
    seen.add(name);
    queue = queue.then(async () => {
      const filePath = join(root, name);
      try {
        if (!(await stat(filePath).catch(() => null))?.isFile()) return;
        await waitForStableFile(filePath, stableOptions);
        log(`uploading ${name}`);
        await upload(filePath);
        await rename(filePath, join(uploadedDir, name));
        log(`done: ${name} → uploaded/`);
      } catch (error) {
        log(`failed: ${name}: ${error instanceof Error ? error.message : error}`);
        await rename(filePath, join(failedDir, name)).catch(() => undefined);
      } finally {
        seen.delete(name);
      }
    });
    return queue;
  };

  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isFile()) enqueue(entry.name);
  const watcher = watch(root, (_event, name) => { if (name) enqueue(String(name)); });
  return { idle: () => queue, stop: () => watcher.close() };
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" }, watch: { type: "string" }, song: { type: "string" }, version: { type: "string" },
      base: { type: "string" }, duration: { type: "string" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || (!values.file && !values.watch)) {
    console.log("Usage: HALO_UPLOAD_TOKEN=<token> HALO_BASE_URL=<https://site> node scripts/halo-chunk-upload.mjs --song <songId> --version <versionId> (--file <audio> | --watch <folder>)");
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  const client = createAudioApiClient({ baseUrl: values.base || process.env.HALO_BASE_URL, token: process.env.HALO_UPLOAD_TOKEN, log: console.log });
  const upload = filePath => uploadAudioFile({
    filePath, songId: values.song, versionId: values.version, client,
    durationSeconds: Math.max(0, Math.round(Number(values.duration) || 0)), log: console.log,
  });
  if (values.file) {
    const result = await upload(resolve(values.file));
    console.log(JSON.stringify({ uploadId: result.uploadId, audioUrl: result.audioUrl, uploadedChunks: result.uploadedChunks, skippedChunks: result.skippedChunks, alreadyFinalized: Boolean(result.alreadyFinalized) }));
    return;
  }
  const watcher = await watchFolder({ dir: values.watch, upload });
  console.log(`Watching ${resolve(values.watch)} — drop finished audio files to upload them (Ctrl+C to stop).`);
  process.once("SIGINT", () => { watcher.stop(); process.exit(0); });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
