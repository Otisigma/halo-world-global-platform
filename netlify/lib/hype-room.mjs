import { randomUUID } from "node:crypto";
import { FeedError, uuid, readBody, rateLimit, visiblePost } from "./signal-feed.mjs";
import { resolveReleaseArtworkFields } from "./release-artwork.mjs";

export const HYPE_HISTORY_LIMIT = 50;
export const HYPE_MESSAGE_LIMIT = 500;
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" }
});

export function createHypeRoomHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new FeedError("Cross-origin room requests are not accepted", 403);
      }
      if (request.method === "POST") {
        let valid = false;
        try { valid = origin === url.origin && (await verifyRequestOrigin(request)) !== false; } catch {}
        if (!valid) throw new FeedError("Cross-origin room changes are not accepted", 403);
      }
      const user = await getUser();
      if (!user?.id) throw new FeedError("Sign in to join this Hype Room", 401);
      let payload;
      if (request.method === "POST") {
        payload = await readBody(request, 4000);
        const actions = {
          message: ["action", "roomId", "body", "confirmAudience"],
          report: ["action", "roomId", "messageId", "reason"],
          block: ["action", "roomId", "messageId"],
          remove: ["action", "roomId", "messageId"]
        };
        const fields = Object.hasOwn(actions, payload.action) ? actions[payload.action] : null;
        if (!fields || Object.keys(payload).some(key => !fields.includes(key))) throw new FeedError("Unsupported room action or field");
        if (payload.action === "message") {
          if (typeof payload.body !== "string" || !payload.body.trim() || payload.body.length > HYPE_MESSAGE_LIMIT) {
            throw new FeedError(`Write 1–${HYPE_MESSAGE_LIMIT} characters`);
          }
          if (payload.confirmAudience !== true) throw new FeedError("Confirm sharing with this post's audience");
        } else {
          uuid(payload.messageId);
          if (payload.action === "report" && (typeof payload.reason !== "string" || payload.reason.trim().length < 3 || payload.reason.length > 500)) {
            throw new FeedError("Describe the safety concern in 3–500 characters");
          }
        }
      }
      if ([...url.searchParams.keys()].some(key => key !== "roomId")) throw new FeedError("Unsupported room query");
      const roomId = uuid(payload?.roomId ?? url.searchParams.get("roomId"));
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      const memberId = membership.member_id;
      // Rooms are existing posts, never caller-created channels. Recheck access on every request.
      const post = await visiblePost(db, roomId, memberId);
      if (payload) {
        await rateLimit(db, memberId, "write");
        if (payload.action === "message") {
          const rows = await db.sql`
            INSERT INTO halo_signal_feed_comments (id, post_id, member_id, author_name, body)
            SELECT ${randomUUID()}, p.id, ${memberId}, ${membership.display_name || "HALO member"}, ${payload.body.trim()}
            FROM halo_signal_feed_posts p WHERE p.id = ${roomId}
              AND (p.visibility = 'PUBLIC' OR p.member_id = ${memberId} OR ${memberId} = ANY(p.audience))
              AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b WHERE
                (b.member_id = ${memberId} AND b.target_member_id = p.member_id)
                OR (b.target_member_id = ${memberId} AND b.member_id = p.member_id))
            RETURNING id
          `;
          if (!rows.length) throw new FeedError("Room no longer available", 404);
          return json({ id: rows[0].id }, 201);
        }
        const messages = await db.sql`SELECT member_id FROM halo_signal_feed_comments
          WHERE id = ${payload.messageId} AND post_id = ${roomId} LIMIT 1`;
        const target = messages[0]?.member_id;
        if (!target) throw new FeedError("Message not found in this room", 404);
        if (payload.action === "remove") {
          if (target !== memberId) throw new FeedError("Only your own messages can be removed", 403);
          await db.sql`DELETE FROM halo_signal_feed_comments
            WHERE id = ${payload.messageId} AND post_id = ${roomId} AND member_id = ${memberId}`;
        } else {
          if (target === memberId) throw new FeedError("Choose another member's message");
          if (payload.action === "block") {
            await db.sql`INSERT INTO halo_signal_blocks (member_id, target_member_id)
              VALUES (${memberId}, ${target}) ON CONFLICT DO NOTHING`;
          } else {
            await db.sql`INSERT INTO halo_signal_reports (reporter_member_id, target_member_id, reason)
              VALUES (${memberId}, ${target}, ${`Hype Room ${roomId}, comment ${payload.messageId}: ${payload.reason.trim()}`})`;
          }
        }
        return json({ ok: true });
      }
      const rows = await db.sql`
        SELECT c.id, c.author_name, c.body, c.created_at, c.member_id = ${memberId} AS own
        FROM halo_signal_feed_comments c WHERE c.post_id = ${roomId}
          AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b WHERE
            (b.member_id = ${memberId} AND b.target_member_id = c.member_id)
            OR (b.target_member_id = ${memberId} AND b.member_id = c.member_id))
          AND (c.parent_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM halo_signal_feed_comments parent JOIN halo_signal_blocks b
              ON (b.member_id = ${memberId} AND b.target_member_id = parent.member_id)
              OR (b.target_member_id = ${memberId} AND b.member_id = parent.member_id)
            WHERE parent.id = c.parent_id))
        ORDER BY c.created_at DESC, c.id DESC LIMIT ${HYPE_HISTORY_LIMIT}
      `;
      const events = await db.sql`
        SELECT release.id AS release_id, release.title, release.artist, milestone.reached_at,
          release.artwork_url, release.imported_artwork_url, release.artwork_override_url
        FROM halo_signal_feed_posts p
        JOIN halo_release_campaigns release ON release.id = p.release_id
        JOIN halo_release_milestones milestone ON milestone.release_id = release.id
        JOIN halo_radio_tracks track ON track.id = milestone.track_id
        WHERE p.id = ${roomId} AND release.status = 'published'
          AND COALESCE(release.visibility, 'public') = 'public'
          AND track.status = 'rotation' AND track.reviewed_at IS NOT NULL AND track.reviewed_by_member_id IS NOT NULL
        LIMIT 1
      `;
      return json({
        roomId, visibility: post.visibility,
        messages: rows.reverse().map(row => ({
          id: row.id, authorName: row.author_name, body: row.body, own: row.own,
          createdAt: new Date(row.created_at).toISOString()
        })),
        milestone: events[0] ? {
          kind: "reviewed-radio-rotation", releaseId: events[0].release_id,
          title: events[0].title, artist: events[0].artist, reachedAt: new Date(events[0].reached_at).toISOString(),
          artwork: resolveReleaseArtworkFields({
            artworkUrl: events[0].artwork_url, importedArtworkUrl: events[0].imported_artwork_url,
            artworkOverrideUrl: events[0].artwork_override_url
          }).artwork
        } : null
      });
    } catch (error) {
      if (error instanceof FeedError) return json({ message: error.message }, error.status);
      return json({ message: "Hype Room is unavailable. Please retry." }, 503);
    }
  };
}
