import { jsonResponse } from "./stats.mjs";

const MAX_AGE_MS = 5 * 60_000;
const MAX_BODY_BYTES = 64 * 1024;
const SNAPSHOT_KEY = "latest";

function validSnapshot(value, now) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.windowStart !== "string" || typeof value.observedAt !== "string") return false;
  const start = Date.parse(value.windowStart);
  const end = Date.parse(value.observedAt);
  const outcomes = value.outcomes;
  return Number.isFinite(start) && Number.isFinite(end) && start <= end && end <= now &&
    outcomes && typeof outcomes.protected === "boolean" && typeof outcomes.healthy === "boolean" &&
    Number.isSafeInteger(outcomes.blocked) && outcomes.blocked >= 0 &&
    Number.isSafeInteger(outcomes.isolated) && outcomes.isolated >= 0;
}

export function publicShieldStatus(snapshot, now = Date.now()) {
  const verified = validSnapshot(snapshot, now) && now - Date.parse(snapshot.observedAt) < MAX_AGE_MS;
  return {
    brand: "Halo Shield",
    service: "Halo Music",
    verification: verified ? "verified" : "unavailable",
    windowStart: verified ? new Date(snapshot.windowStart).toISOString() : null,
    observedAt: verified ? new Date(snapshot.observedAt).toISOString() : null,
    outcomes: {
      protected: verified ? snapshot.outcomes.protected : null,
      healthy: verified ? snapshot.outcomes.healthy : null,
      blocked: verified ? snapshot.outcomes.blocked : null,
      isolated: verified ? snapshot.outcomes.isolated : null
    }
  };
}

export function createShieldHandler({ getStore, authorize, now = Date.now, internal = false }) {
  return async (request) => {
    const methods = internal ? ["GET", "POST"] : ["GET"];
    if (!methods.includes(request.method)) {
      return jsonResponse({ message: "Method not allowed" }, 405, { Allow: methods.join(", ") });
    }
    if (internal && !authorize(request)) {
      return jsonResponse({ message: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }
    try {
      if (request.method === "POST") {
        // Bound the streamed body too; Content-Length is not a trustworthy limit.
        const reader = request.body?.getReader();
        if (!reader) return jsonResponse({ message: "Invalid report" }, 400);
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return jsonResponse({ message: "Report too large" }, 413);
          }
          chunks.push(value);
        }
        let snapshot;
        try {
          snapshot = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return jsonResponse({ message: "Invalid report" }, 400);
        }
        if (!validSnapshot(snapshot, now()) || now() - Date.parse(snapshot.observedAt) > MAX_AGE_MS) {
          return jsonResponse({ message: "Invalid report" }, 400);
        }
        await getStore().setJSON(SNAPSHOT_KEY, snapshot);
        return jsonResponse({ accepted: true }, 202);
      }
      const snapshot = await getStore().get(SNAPSHOT_KEY, { type: "json" });
      return jsonResponse(internal ? { snapshot } : publicShieldStatus(snapshot, now()));
    } catch {
      return jsonResponse(internal
        ? { message: "Shield telemetry unavailable" }
        : publicShieldStatus(null, now()), 503);
    }
  };
}
