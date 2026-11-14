import { FeedError, readBody, uuid } from "./signal-feed.mjs";

const json = (body, status = 200) => Response.json(body, {
  status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {})
  }
});

export function createListeningEventsHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if (url.search || (origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site"
        || (request.method === "GET" && request.headers.get("x-halo-listening") !== "1")) {
        throw new FeedError("Unsupported listening request", 403);
      }
      if (request.method === "POST") {
        let valid = false;
        try { valid = origin === url.origin && (await verifyRequestOrigin(request)) !== false; } catch {}
        if (!valid) throw new FeedError("Same-origin request required", 403);
      }
      const user = await getUser();
      if (!user?.id) throw new FeedError("Sign in to manage optional listening analytics", 401);
      const privacySignal = request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1";
      let payload;
      if (request.method === "POST") {
        payload = await readBody(request, 1024);
        const fields = {
          consent: ["action", "enabled"],
          listen_start: ["action", "releaseId"],
          listen_complete: ["action", "receipt"],
          listen_abandon: ["action", "receipt"]
        };
        const keys = typeof payload.action === "string" && Object.hasOwn(fields, payload.action) ? fields[payload.action] : null;
        if (!keys || Object.keys(payload).length !== keys.length || Object.keys(payload).some(key => !keys.includes(key))) {
          throw new FeedError("Unsupported event or property");
        }
        if (payload.action === "consent") {
          if (typeof payload.enabled !== "boolean") throw new FeedError("Choose a consent setting");
        } else if (payload.action === "listen_start") {
          if (typeof payload.releaseId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.releaseId)) {
            throw new FeedError("Choose a published release");
          }
        } else {
          uuid(payload.receipt);
        }
        if (privacySignal && !(payload.action === "consent" && payload.enabled === false)) {
          throw new FeedError("Listening analytics disabled by privacy settings", 403);
        }
      }
      const db = await getDatabase();
      if (!payload) {
        const rows = await db.sql`SELECT enabled FROM halo_listening_preferences WHERE member_id = ${user.id}`;
        return json({ enabled: !privacySignal && rows[0]?.enabled === true });
      }
      // Only verified Identity users can create membership-linked preferences.
      await ensureMembership(db, user);
      const rows = await db.sql`
        SELECT * FROM halo_ingest_listening(
          ${user.id}, ${payload.action}, ${payload.releaseId ?? null},
          ${payload.receipt ?? null}::uuid, ${payload.enabled ?? null}::boolean
        )
      `;
      const result = rows[0];
      if (!result) throw new Error("Missing ingestion result");
      const statuses = { consent_required: 403, rate_limited: 429, unavailable: 404 };
      if (Object.hasOwn(statuses, result.result)) return json({ message: result.result }, statuses[result.result]);
      return json(payload.action === "consent"
        ? { enabled: payload.enabled }
        : { accepted: true, ...(result.receipt ? { receipt: result.receipt } : {}) }, 202);
    } catch (error) {
      if (error instanceof FeedError) return json({ message: error.message }, error.status);
      // Never log payloads, Identity IDs, receipts, or database error details.
      return json({ message: "Listening analytics unavailable" }, 503);
    }
  };
}
