import { normalizeCatalog } from "./catalog-curator.js";

const CANONICAL_HOST = "halo-world-global-platform.netlify.app";
const MAX_BYTES = 1024 * 1024;

export function previewOrigin(value) {
  const url = new URL(value);
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  const deployed = url.protocol === "https:" && !url.port &&
    (url.hostname === CANONICAL_HOST || /^[a-z0-9-]+--halo-world-global-platform\.netlify\.app$/.test(url.hostname));
  if ((!local && !deployed) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Preview requires the canonical site, its Netlify preview, or loopback");
  }
  return url.origin;
}

export function previewCandidate(payload, origin) {
  const base = previewOrigin(origin);
  if (payload?.configured !== true) throw new Error("Canonical catalog is unconfigured");
  const catalog = normalizeCatalog(payload);
  const track = catalog.tracks.find(entry => entry.public === true);
  if (!track) throw new Error("Canonical catalog has no eligible public entry");
  const proxy = `/api/drive-catalog/audio?track=${encodeURIComponent(track.id)}`;
  // The isolated comparison intentionally excludes unreviewed external primary media hosts.
  const primary = new URL(track.streamUrl, base);
  return {
    iframe: `https://drive.google.com/file/d/${track.driveFileId}/preview`,
    primary: primary.origin === base ? primary.href : "",
    proxy: new URL(proxy, base).href
  };
}

export async function loadPreviewCandidate({ origin, fetchImpl = globalThis.fetch, timeoutMs = 8000, source = "live-catalog" }) {
  const evidence = {
    command: "GET /api/drive-catalog (redirect:error; bounded JSON; no credentials)",
    source, mocked: source === "fixture", status: "blocked",
    observation: "", playback: "not tested"
  };
  let timer;
  const controller = new AbortController();
  try {
    const base = previewOrigin(origin);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) throw new Error("Timeout must be 1–8000 ms");
    if (!["live-catalog", "fixture"].includes(source)) throw new Error("Invalid evidence source");
    const candidate = await Promise.race([
      (async () => {
        const response = await fetchImpl(`${base}/api/drive-catalog`, {
          redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal
        });
        if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") || "")) {
          throw new Error("Canonical catalog did not return successful JSON");
        }
        if (Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) throw new Error("Catalog exceeds preview limit");
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error("Catalog exceeds preview limit");
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          return previewCandidate(JSON.parse(new TextDecoder().decode(bytes)), base);
        } finally {
          void reader.cancel().catch(() => {});
        }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Canonical catalog timed out"));
        }, timeoutMs);
      })
    ]);
    evidence.status = "partially feasible";
    evidence.observation = source === "fixture"
      ? "Mocked catalog/schema only; no live URL or browser playback tested."
      : "Eligible canonical entry received. Public manifest consent is not proof of anonymous Drive sharing or playback.";
    if (!candidate.primary) evidence.observation += " External primary media host is not allowlisted; only that probe is blocked. The requested iframe and authorized proxy remain available.";
    return { candidate, evidence };
  } catch (error) {
    // Never echo URLs, catalog bodies, IDs, or upstream error details into the report.
    const known = /^(?:Canonical catalog|Canonical catalog has|Catalog exceeds|Primary media|Timeout must|Preview requires|Invalid evidence)/;
    evidence.observation = known.test(error.message) ? error.message : "Catalog unavailable or invalid; no live playback tested";
    return { candidate: null, evidence };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
