import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { cleanShowId, serializeShow } from "../lib/radio-programming.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function loadConnections(db, user, slug) {
  const memberId = user?.id || "";
  const pageRows = await db.sql`
    SELECT slug, status, owner_member_id FROM halo_artist_pages
    WHERE slug = ${slug} AND (status = 'published' OR owner_member_id = ${memberId} OR ${isOwner(user)})
    LIMIT 1
  `;
  if (!pageRows.length) return null;
  const [followRows, activityRows, playRows, showRows] = await Promise.all([
    db.sql`
      SELECT COUNT(*)::int AS follower_count,
        EXISTS (
          SELECT 1 FROM halo_artist_follows viewer_follow
          WHERE viewer_follow.artist_slug = ${slug} AND viewer_follow.member_id = ${memberId}
        ) AS following
      FROM halo_artist_follows
      WHERE artist_slug = ${slug}
    `,
    db.sql`
      SELECT id, kind, title, description, url, starts_at, created_at
      FROM halo_artist_activity
      WHERE artist_slug = ${slug} AND status = 'published'
      ORDER BY COALESCE(starts_at, created_at) DESC
      LIMIT 12
    `,
    db.sql`
      SELECT id, room, title, artist_name, release_url, source, started_at
      FROM halo_radio_play_history
      WHERE artist_slug = ${slug}
      ORDER BY started_at DESC
      LIMIT 8
    `,
    db.sql`
      SELECT show.*,
        EXISTS (
          SELECT 1 FROM halo_radio_show_subscriptions subscription
          WHERE subscription.show_id = show.id AND subscription.member_id = ${memberId}
        ) AS subscribed,
        (SELECT COUNT(*)::int FROM halo_radio_show_subscriptions subscription WHERE subscription.show_id = show.id) AS subscriber_count
      FROM halo_radio_shows show
      WHERE show.artist_slug = ${slug} AND show.status = 'published'
      ORDER BY show.day_of_week, show.start_time_utc
    `
  ]);
  return {
    authenticated: Boolean(user?.id),
    following: Boolean(followRows[0]?.following),
    followerCount: Number(followRows[0]?.follower_count || 0),
    activity: activityRows.map(row => ({
      id: Number(row.id),
      kind: row.kind,
      title: row.title,
      description: row.description || "",
      url: row.url || "",
      startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString()
    })),
    recentPlays: playRows.map(row => ({
      id: Number(row.id),
      room: row.room,
      title: row.title,
      artistName: row.artist_name,
      releaseUrl: row.release_url || "",
      source: row.source,
      startedAt: new Date(row.started_at).toISOString()
    })),
    upcomingShows: showRows.map(row => serializeShow(row)).sort((first, second) => first.startsAt.localeCompare(second.startsAt))
  };
}

export default async function artistConnectionsHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const url = new URL(request.url);
    if (request.method === "GET") {
      const slug = cleanShowId(url.searchParams.get("slug"));
      if (!slug) return json({ message: "Add an artist room handle" }, 400);
      const state = await loadConnections(db, user, slug);
      return state ? json(state) : json({ message: "Artist room not found" }, 404);
    }
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin artist actions are not accepted" }, 403);
    }
    if (!user?.id) return json({ message: "Join or sign in to follow this artist" }, 401);
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ message: "Request body must be valid JSON" }, 400);
    }
    if (payload.action !== "follow") return json({ message: "Unknown artist action" }, 400);
    const slug = cleanShowId(payload.slug);
    const pageRows = await db.sql`SELECT slug FROM halo_artist_pages WHERE slug = ${slug} AND status = 'published' LIMIT 1`;
    if (!pageRows.length) return json({ message: "Artist room not found" }, 404);
    const membership = await ensureMembership(db, user);
    if (payload.following === false) {
      await db.sql`DELETE FROM halo_artist_follows WHERE artist_slug = ${slug} AND member_id = ${membership.member_id}`;
    } else {
      await db.sql`
        INSERT INTO halo_artist_follows (artist_slug, member_id, notify_radio, notify_releases)
        VALUES (${slug}, ${membership.member_id}, TRUE, TRUE)
        ON CONFLICT (artist_slug, member_id) DO UPDATE SET
          notify_radio = TRUE,
          notify_releases = TRUE,
          updated_at = NOW()
      `;
    }
    const state = await loadConnections(db, user, slug);
    return json({ ...state, message: payload.following === false ? "Artist follow removed" : "Artist followed inside HALO" });
  } catch (error) {
    console.error("HALO artist connections failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The artist connection could not be updated right now" }, 500);
  }
}

export const config = { path: "/api/artist/connections" };
