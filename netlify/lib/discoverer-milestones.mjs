import { isValidReleaseId } from "./catalog-chart.mjs";
import { safeTrackDropText } from "./track-drops.mjs";

const LIMIT = 20;
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }
});

export async function loadDiscovererState(db, memberId) {
  const [preferences, awards, milestones] = await Promise.all([
    db.sql`SELECT discoverer_in_app FROM halo_member_notification_preferences WHERE member_id = ${memberId}`,
    db.sql`
      SELECT release.id, release.title, release.artist, award.discoverer_rank, award.notified_at, award.seen_at
      FROM halo_release_discoverers award
      JOIN halo_release_campaigns release ON release.id = award.release_id
      JOIN halo_release_milestones milestone ON milestone.release_id = release.id
      JOIN halo_radio_tracks track ON track.id = milestone.track_id
      JOIN halo_member_notification_preferences preference ON preference.member_id = award.member_id
      WHERE award.member_id = ${memberId} AND release.status IN ('passed', 'published')
        AND track.status = 'rotation' AND track.reviewed_at IS NOT NULL
        AND track.reviewed_by_member_id IS NOT NULL
        AND preference.discoverer_in_app = TRUE AND award.notified_at IS NOT NULL
      ORDER BY award.notified_at DESC, release.id
      LIMIT ${LIMIT}
    `,
    db.sql`
      SELECT release.id, release.title, release.artist, milestone.reached_at,
        (SELECT COUNT(*)::int FROM halo_release_discoverers award WHERE award.release_id = release.id) AS supporter_count
      FROM halo_release_milestones milestone
      JOIN halo_release_campaigns release ON release.id = milestone.release_id
      LEFT JOIN halo_artist_pages page ON page.slug = release.artist_slug
      WHERE release.owner_member_id = ${memberId} OR page.owner_member_id = ${memberId}
      ORDER BY milestone.reached_at DESC, release.id
      LIMIT ${LIMIT}
    `
  ]);
  const release = row => ({
    releaseId: row.id, title: safeTrackDropText(row.title), artist: safeTrackDropText(row.artist, 120)
  });
  return {
    enabled: Boolean(preferences[0]?.discoverer_in_app),
    notifications: awards.map(row => ({
      ...release(row), rank: Number(row.discoverer_rank), unread: !row.seen_at,
      message: `You are Discoverer #${Number(row.discoverer_rank)}. This release reached reviewed radio rotation.`
    })),
    milestones: milestones.map(row => ({
      ...release(row), supporterCount: Number(row.supporter_count), reachedAt: new Date(row.reached_at).toISOString()
    })),
    thankYouDeliveryAvailable: false
  };
}

export function createDiscovererHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      const user = await getUser();
      if (!user?.id) return json({ message: "Sign in to view your discoverer celebrations" }, 401);
      let payload;
      if (request.method === "POST") {
        try {
          if ((await verifyRequestOrigin(request)) === false) throw new Error("Invalid origin");
        } catch { return json({ message: "Cross-origin changes are not accepted" }, 403); }
        if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ message: "Send JSON" }, 415);
        if (Number(request.headers.get("content-length")) > 1000) return json({ message: "Request too large" }, 413);
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > 1000) return json({ message: "Request too large" }, 413);
        try { payload = JSON.parse(text); } catch { return json({ message: "Invalid JSON" }, 400); }
        if (!payload || Array.isArray(payload) || typeof payload !== "object") return json({ message: "Choose an alert action" }, 400);
        if (payload.action === "preferences") {
          if (typeof payload.enabled !== "boolean") return json({ message: "Choose on or off" }, 400);
        } else if (payload.action === "seen") {
          if (typeof payload.releaseId !== "string" || !isValidReleaseId(payload.releaseId)) return json({ message: "Choose a release" }, 400);
        } else {
          return json({ message: "Only private alert preferences and read receipts are supported. Thank-you delivery is unavailable." }, 400);
        }
      }
      const db = await getDatabase();
      // Use the authenticated identity, never a caller-supplied recipient/member.
      const { member_id: memberId } = await ensureMembership(db, user);
      if (payload) {
        const allowed = await db.sql`
          INSERT INTO halo_discoverer_request_limits (member_id) VALUES (${memberId})
          ON CONFLICT (member_id) DO UPDATE SET
            window_start = CASE WHEN halo_discoverer_request_limits.window_start <= clock_timestamp() - INTERVAL '1 minute'
              THEN clock_timestamp() ELSE halo_discoverer_request_limits.window_start END,
            attempts = CASE WHEN halo_discoverer_request_limits.window_start <= clock_timestamp() - INTERVAL '1 minute'
              THEN 1 ELSE halo_discoverer_request_limits.attempts + 1 END
          WHERE halo_discoverer_request_limits.window_start <= clock_timestamp() - INTERVAL '1 minute'
            OR halo_discoverer_request_limits.attempts < 30
          RETURNING member_id
        `;
        if (!allowed.length) return json({ message: "Too many alert changes. Please wait a minute." }, 429);
      }
      if (payload?.action === "preferences") {
        // One bounded, idempotent write per request; no fan-out or external send.
        await db.sql`
          INSERT INTO halo_member_notification_preferences (member_id, discoverer_in_app)
          VALUES (${memberId}, ${payload.enabled})
          ON CONFLICT (member_id) DO UPDATE SET discoverer_in_app = EXCLUDED.discoverer_in_app, updated_at = NOW()
          WHERE halo_member_notification_preferences.discoverer_in_app IS DISTINCT FROM EXCLUDED.discoverer_in_app
        `;
      } else if (payload?.action === "seen") {
        await db.sql`
          UPDATE halo_release_discoverers SET seen_at = COALESCE(seen_at, NOW())
          WHERE release_id = ${payload.releaseId} AND member_id = ${memberId} AND notified_at IS NOT NULL AND seen_at IS NULL
        `;
      }
      return json(await loadDiscovererState(db, memberId));
    } catch {
      return json({ message: "Discoverer celebrations are temporarily unavailable. Please retry." }, 503);
    }
  };
}
