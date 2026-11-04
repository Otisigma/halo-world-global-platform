import { createHash } from "node:crypto";
import { appendLedgerEntry } from "./halo-ledger.mjs";

const kinds = new Set(["binding", "transport", "autoplay", "canvas", "canonical", "runtime"]);
const states = new Set(["detected", "recovery_available", "recovered", "unresolved", "disabled"]);
const targets = new Set(["player", "showcase", "canvas", "canonical", "runtime"]);
const pages = new Set(["/dreamweaver/", "/album-concierge/"]);

export function normalizeSentinelEvent(payload) {
  if (!payload || !kinds.has(payload.kind) || !states.has(payload.state)
    || !targets.has(payload.target) || !pages.has(payload.page)) {
    throw new Error("Invalid Sentinel event");
  }
  const { kind, state, target, page } = payload;
  return {
    kind, state, target, page,
    severity: ["canonical", "autoplay"].includes(kind) ? "warning" : "critical",
    signature: createHash("sha256").update(`${page}|${kind}|${target}|${state}`).digest("hex")
  };
}

export function createSentinelEventsHandler({ getDatabase, acceptReport, append = appendLedgerEntry }) {
  return async request => {
    const json = (body, status) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ message: "Same-origin reports required" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ message: "JSON required" }, 415);
    let payload;
    const reader = request.body?.getReader();
    if (!reader) return json({ message: "Event body required" }, 400);
    try {
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) {
          await reader.cancel();
          return json({ message: "Event is too large" }, 413);
        }
        chunks.push(value);
      }
      payload = normalizeSentinelEvent(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      return json({ message: "Invalid Sentinel event" }, 400);
    } finally {
      reader.releaseLock();
    }
    try {
      if (!await acceptReport(request)) return json({ message: "Report rate limit reached" }, 429);
      const id = await append(getDatabase(), {
        actorId: "halo-sentinel-browser", actorType: "system", eventCategory: "system_event",
        refAgentId: "halo-sentinel", summary: `Sentinel ${payload.kind}: ${payload.state}`,
        details: { ...payload, evidence: "untrusted-browser-observation", sourceFixApplied: false },
        outcome: payload.state === "recovered" ? "success" : "pending"
      });
      return json({ stored: true, id }, 201);
    } catch (error) {
      console.error("HALO Sentinel ledger write failed", error instanceof Error ? error.message : "unknown error");
      return json({ stored: false, message: "Sentinel event could not be stored" }, 503);
    }
  };
}
