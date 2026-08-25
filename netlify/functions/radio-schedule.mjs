import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { cleanShowId, serializeShow } from "../lib/radio-programming.mjs";

const rooms = new Set(["club", "chill", "lounge"]);
const showTypes = new Set(["music", "discovery", "interview", "dj", "magazine", "community", "special"]);
const showStatuses = new Set(["draft", "published", "paused"]);
const activityKinds = new Set(["radio", "magazine", "release", "event", "replay", "community"]);
const activityStatuses = new Set(["draft", "published"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "https://halo.world");
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return raw.startsWith("/") ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    return "";
  }
}

function cleanTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function loadSchedule(db, user) {
  const memberId = user?.id || "";
  const manage = isOwner(user);
  const rows = await db.sql`
    SELECT show.*,
      EXISTS (
        SELECT 1 FROM halo_radio_show_subscriptions subscription
        WHERE subscription.show_id = show.id AND subscription.member_id = ${memberId}
      ) AS subscribed,
      (SELECT COUNT(*)::int FROM halo_radio_show_subscriptions subscription WHERE subscription.show_id = show.id) AS subscriber_count
    FROM halo_radio_shows show
    WHERE (${manage} OR show.status = 'published')
    ORDER BY show.day_of_week, show.start_time_utc, show.title
  `;
  const shows = rows.map(row => serializeShow(row)).sort((first, second) => first.startsAt.localeCompare(second.startsAt));
  const playRows = await db.sql`
    SELECT history.id, history.room, history.title, history.artist_name, history.artist_slug,
      history.release_url, history.source, history.started_at, page.artwork_url
    FROM halo_radio_play_history history
    LEFT JOIN halo_artist_pages page ON page.slug = history.artist_slug
    ORDER BY history.started_at DESC
    LIMIT 12
  `;
  return {
    shows,
    canManage: manage,
    authenticated: Boolean(user?.id),
    recentPlays: playRows.map(row => ({
      id: Number(row.id),
      room: row.room,
      title: row.title,
      artistName: row.artist_name,
      artistSlug: row.artist_slug || "",
      releaseUrl: row.release_url || "",
      source: row.source,
      startedAt: new Date(row.started_at).toISOString(),
      artworkUrl: row.artwork_url || ""
    }))
  };
}

async function saveShow(db, user, payload) {
  if (!isOwner(user)) return json({ message: "Station desk access is required" }, 403);
  const membership = await ensureMembership(db, user);
  const id = cleanShowId(payload.id || payload.title);
  const title = cleanText(payload.title, 140);
  const room = rooms.has(payload.room) ? payload.room : "";
  const showType = showTypes.has(payload.showType) ? payload.showType : "music";
  const status = showStatuses.has(payload.status) ? payload.status : "draft";
  const dayOfWeek = Number.parseInt(payload.dayOfWeek, 10);
  const startTimeUtc = cleanText(payload.startTimeUtc, 5);
  const durationMinutes = Number.parseInt(payload.durationMinutes, 10);
  const artistSlug = cleanShowId(payload.artistSlug);
  const artistRows = artistSlug ? await db.sql`SELECT slug FROM halo_artist_pages WHERE slug = ${artistSlug} LIMIT 1` : [];
  if (!id || !title || !room || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !/^\d{2}:\d{2}$/.test(startTimeUtc)) {
    return json({ message: "Add a valid show title, room, day, and UTC start time" }, 400);
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return json({ message: "Show duration must be between 15 and 480 minutes" }, 400);
  }
  if (artistSlug && !artistRows.length) return json({ message: "The linked artist room was not found" }, 400);
  const artworkUrl = cleanUrl(payload.artworkUrl);
  if (cleanText(payload.artworkUrl, 1000) && !artworkUrl) return json({ message: "Use a valid show artwork URL" }, 400);
  await db.sql`
    INSERT INTO halo_radio_shows (
      id, room, title, description, host_name, producer_name, show_type, day_of_week,
      start_time_utc, duration_minutes, artist_slug, artwork_url, status, created_by_member_id
    ) VALUES (
      ${id}, ${room}, ${title}, ${cleanText(payload.description, 1200)}, ${cleanText(payload.hostName, 120)},
      ${cleanText(payload.producerName, 120)}, ${showType}, ${dayOfWeek}, ${startTimeUtc}, ${durationMinutes},
      ${artistSlug || null}, ${artworkUrl}, ${status}, ${membership.member_id}
    )
    ON CONFLICT (id) DO UPDATE SET
      room = EXCLUDED.room,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      host_name = EXCLUDED.host_name,
      producer_name = EXCLUDED.producer_name,
      show_type = EXCLUDED.show_type,
      day_of_week = EXCLUDED.day_of_week,
      start_time_utc = EXCLUDED.start_time_utc,
      duration_minutes = EXCLUDED.duration_minutes,
      artist_slug = EXCLUDED.artist_slug,
      artwork_url = EXCLUDED.artwork_url,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;
  return json({ ...(await loadSchedule(db, user)), message: `${title} saved to the station grid` });
}

async function toggleSubscription(db, user, payload) {
  if (!user?.id) return json({ message: "Join or sign in to follow a show" }, 401);
  const membership = await ensureMembership(db, user);
  const showId = cleanShowId(payload.showId);
  const showRows = await db.sql`SELECT id FROM halo_radio_shows WHERE id = ${showId} AND status = 'published' LIMIT 1`;
  if (!showRows.length) return json({ message: "That show is not available" }, 404);
  if (payload.subscribed === false) {
    await db.sql`DELETE FROM halo_radio_show_subscriptions WHERE show_id = ${showId} AND member_id = ${membership.member_id}`;
  } else {
    await db.sql`
      INSERT INTO halo_radio_show_subscriptions (show_id, member_id)
      VALUES (${showId}, ${membership.member_id})
      ON CONFLICT (show_id, member_id) DO NOTHING
    `;
  }
  return json({ ...(await loadSchedule(db, user)), message: payload.subscribed === false ? "Show reminder removed" : "Show followed inside HALO" });
}

async function logPlay(db, user, payload) {
  if (!isOwner(user)) return json({ message: "Station desk access is required" }, 403);
  const membership = await ensureMembership(db, user);
  const room = rooms.has(payload.room) ? payload.room : "";
  const title = cleanText(payload.title, 160);
  const artistName = cleanText(payload.artistName, 140);
  const artistSlug = cleanShowId(payload.artistSlug);
  const source = new Set(["station-desk", "live", "autodj", "replay"]).has(payload.source) ? payload.source : "station-desk";
  const startedAt = cleanTimestamp(payload.startedAt) || new Date().toISOString();
  if (!room || !title || !artistName) return json({ message: "Add the room, track, and artist before logging a play" }, 400);
  const artistRows = artistSlug ? await db.sql`SELECT slug FROM halo_artist_pages WHERE slug = ${artistSlug} LIMIT 1` : [];
  if (artistSlug && !artistRows.length) return json({ message: "The linked artist room was not found" }, 400);
  const releaseUrl = cleanUrl(payload.releaseUrl);
  if (cleanText(payload.releaseUrl, 1000) && !releaseUrl) return json({ message: "Use a valid release URL" }, 400);
  await db.sql`
    INSERT INTO halo_radio_play_history (
      room, title, artist_name, artist_slug, release_url, source, started_at, duration_seconds, created_by_member_id
    ) VALUES (
      ${room}, ${title}, ${artistName}, ${artistSlug || null}, ${releaseUrl}, ${source}, ${startedAt},
      ${Math.max(0, Math.min(14400, Number.parseInt(payload.durationSeconds, 10) || 0))}, ${membership.member_id}
    )
  `;
  return json({ ...(await loadSchedule(db, user)), message: `${title} added to play history` });
}

async function saveActivity(db, user, payload) {
  if (!isOwner(user)) return json({ message: "Station desk access is required" }, 403);
  const membership = await ensureMembership(db, user);
  const artistSlug = cleanShowId(payload.artistSlug);
  const title = cleanText(payload.title, 180);
  const kind = activityKinds.has(payload.kind) ? payload.kind : "radio";
  const status = activityStatuses.has(payload.status) ? payload.status : "published";
  const artistRows = await db.sql`SELECT slug FROM halo_artist_pages WHERE slug = ${artistSlug} LIMIT 1`;
  if (!artistRows.length || !title) return json({ message: "Choose an existing artist room and add an activity title" }, 400);
  const url = cleanUrl(payload.url);
  if (cleanText(payload.url, 1000) && !url) return json({ message: "Use a valid activity URL" }, 400);
  await db.sql`
    INSERT INTO halo_artist_activity (
      artist_slug, kind, title, description, url, starts_at, status, created_by_member_id
    ) VALUES (
      ${artistSlug}, ${kind}, ${title}, ${cleanText(payload.description, 1200)}, ${url},
      ${cleanTimestamp(payload.startsAt)}, ${status}, ${membership.member_id}
    )
  `;
  return json({ ...(await loadSchedule(db, user)), message: `${title} connected to the artist room` });
}

export default async function radioScheduleHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (request.method === "GET") return json(await loadSchedule(db, user));
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin station actions are not accepted" }, 403);
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ message: "Request body must be valid JSON" }, 400);
    }
    if (payload.action === "save_show") return saveShow(db, user, payload);
    if (payload.action === "subscribe") return toggleSubscription(db, user, payload);
    if (payload.action === "log_play") return logPlay(db, user, payload);
    if (payload.action === "save_activity") return saveActivity(db, user, payload);
    return json({ message: "Unknown station action" }, 400);
  } catch (error) {
    console.error("HALO radio schedule failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The station schedule could not be loaded right now" }, 500);
  }
}

export const config = { path: "/api/radio/schedule" };

