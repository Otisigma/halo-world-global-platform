import {
  allowedEvents,
  cleanIdentifier,
  cleanMetadata,
  cleanPagePath,
  getStatsDatabase,
  jsonResponse
} from "../lib/stats.mjs";

export default async function statsEventHandler(request) {
  if (request.method !== "POST") {
    return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) {
    return jsonResponse({ message: "Event payload is too large" }, 413);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return jsonResponse({ message: "Cross-origin events are not accepted" }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ message: "Event payload must be valid JSON" }, 400);
  }

  const eventName = typeof payload.eventName === "string" ? payload.eventName.trim() : "";
  const anonymousId = cleanIdentifier(payload.anonymousId);
  const sessionId = cleanIdentifier(payload.sessionId);

  if (!allowedEvents.has(eventName) || !anonymousId || !sessionId) {
    return jsonResponse({ message: "Event payload is invalid" }, 422);
  }

  try {
    const db = await getStatsDatabase();
    const insertedRows = await db.sql`
      INSERT INTO analytics_events (
        event_name,
        anonymous_id,
        session_id,
        page_path,
        metadata
      )
      SELECT
        ${eventName},
        ${anonymousId},
        ${sessionId},
        ${cleanPagePath(payload.pagePath)},
        ${JSON.stringify(cleanMetadata(payload.metadata))}::jsonb
      WHERE (
        SELECT COUNT(*)
        FROM analytics_events
        WHERE session_id = ${sessionId}
          AND created_at >= NOW() - INTERVAL '1 minute'
      ) < 120
      RETURNING id
    `;

    if (insertedRows.length === 0) {
      return jsonResponse({ message: "Event rate limit exceeded" }, 429, { "Retry-After": "60" });
    }

    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    console.error("Stats event storage failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "Event could not be stored" }, 500);
  }
}

export const config = {
  path: "/api/stats/events"
};
