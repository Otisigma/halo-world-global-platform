// Signal threads: messages bound to one content item so comments and one-word
// reactions render directly beneath the active Wire post or track.
//   GET  /api/signal/messages?target_id=<wire post ID | track ID>
//   POST /api/signal/messages { "target_id", "message" }
// Threads are members-only, like the Industry Wire they hang off. The floating
// satellite chat stays a separate, unscoped, browser-local stream.

export const SIGNAL_THREAD_LIMIT = 50;
export const SIGNAL_MESSAGE_MAX_LENGTH = 500;
export const SIGNAL_TARGET_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;
const MAX_BODY_BYTES = 4_000;
const RATE_LIMIT = 12;

export function cleanSignalTargetId(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SIGNAL_TARGET_PATTERN.test(id) ? id : "";
}

export function cleanSignalMessage(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, SIGNAL_MESSAGE_MAX_LENGTH) : "";
}

export function signalMessagePayload(row) {
  return {
    id: String(row.id),
    target_id: row.target_id,
    user_identifier: row.user_identifier,
    message: row.message,
    created_at: new Date(row.created_at).toISOString()
  };
}

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...headers } });
}

export function createSignalMessagesHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  return async function signalMessagesHandler(request) {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
    try {
      const user = await getUser();
      if (!user?.id) return json({ message: "Sign in to Signal Network to join the thread" }, 401);

      if (request.method === "GET") {
        const targetId = cleanSignalTargetId(new URL(request.url).searchParams.get("target_id"));
        if (!targetId) return json({ message: "Choose a Wire post or track" }, 400);
        const db = await getDatabase();
        await ensureMembership(db, user);
        const rows = await db.sql`
          SELECT id, target_id, user_identifier, message, created_at
          FROM halo_signal_thread_messages
          WHERE target_id = ${targetId} AND hidden = FALSE
          ORDER BY created_at DESC, id DESC
          LIMIT ${SIGNAL_THREAD_LIMIT}
        `;
        // Newest window, displayed oldest-first so the thread reads like a conversation.
        return json({ target_id: targetId, messages: rows.map(signalMessagePayload).reverse() });
      }

      let sameOrigin = false;
      try { sameOrigin = (await verifyRequestOrigin(request)) !== false; } catch { sameOrigin = false; }
      if (!sameOrigin) return json({ message: "Cross-origin Signal messages are not accepted" }, 403);
      if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "Signal message is too large" }, 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ message: "Signal message is too large" }, 413);
      let body = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      if (!body || typeof body !== "object") return json({ message: "Request body must be valid JSON" }, 400);
      const targetId = cleanSignalTargetId(body.target_id);
      const message = cleanSignalMessage(body.message);
      if (!targetId) return json({ message: "Choose a Wire post or track" }, 400);
      if (!message) return json({ message: "Write a message or a one-word reaction" }, 400);

      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      const memberId = membership.member_id;
      const rateRows = await db.sql`
        SELECT COUNT(*)::int AS total FROM halo_signal_thread_messages
        WHERE sender_member_id = ${memberId} AND created_at >= NOW() - INTERVAL '5 minutes'
      `;
      if (Number(rateRows[0]?.total || 0) >= RATE_LIMIT) return json({ message: "Signal limit reached. Take a short pause." }, 429);
      const userIdentifier = cleanSignalMessage(membership.display_name).slice(0, 80) || "HALO member";
      const rows = await db.sql`
        INSERT INTO halo_signal_thread_messages (target_id, sender_member_id, user_identifier, message)
        VALUES (${targetId}, ${memberId}, ${userIdentifier}, ${message})
        RETURNING id, target_id, user_identifier, message, created_at
      `;
      return json({ message: signalMessagePayload(rows[0]) }, 201);
    } catch (error) {
      console.error("Signal thread request failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Signal threads are temporarily unavailable" }, 500);
    }
  };
}
