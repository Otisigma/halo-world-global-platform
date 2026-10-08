import { respondOracle } from "../../lib/halo-oracle-engine.js";

const MAX_BODY_BYTES = 8000;
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers }
});

async function loadPublishedCatalog() {
  const { default: catalogHandler } = await import("./release-catalog.mjs");
  const response = await catalogHandler(new Request("https://halo.local/api/release-catalog"));
  if (!response.ok) throw new Error("Catalog unavailable");
  return (await response.json()).releases;
}

export function createOracleHandler({ loadCatalog = loadPublishedCatalog } = {}) {
  return async request => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Send application/json" }, 415);
    const declaredSize = Number(request.headers.get("content-length"));
    if (declaredSize > MAX_BODY_BYTES) return json({ error: "Prompt too large" }, 413);
    let body;
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "JSON body required" }, 400);
    try {
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return json({ error: "Prompt too large" }, 413);
        }
        chunks.push(value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    } finally {
      reader.releaseLock();
    }
    if (!body || typeof body.message !== "string" || !body.message.trim() || body.message.length > 1200
      || (body.contextTrackId !== undefined && (typeof body.contextTrackId !== "string" || body.contextTrackId.length > 100))
      || (body.favoriteTrackIds !== undefined && (!Array.isArray(body.favoriteTrackIds) || body.favoriteTrackIds.length > 50
        || body.favoriteTrackIds.some(id => typeof id !== "string" || id.length > 100)))) {
      return json({ error: "Invalid Oracle prompt" }, 400);
    }
    try {
      const releases = await loadCatalog();
      if (!Array.isArray(releases)) throw new Error("Invalid catalog");
      return json(respondOracle(body, releases));
    } catch {
      return json({ error: "Oracle catalog temporarily unavailable. Please try again." }, 503);
    }
  };
}

export default createOracleHandler();
export const config = { path: "/api/halo-oracle" };
