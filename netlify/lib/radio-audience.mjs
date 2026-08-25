import { getDatabase } from "@netlify/database";

/**
 * A heartbeat is credited to the most recent play in the same room that started before it.
 * `duration_seconds` defaults to 0 in the play log, so the attribution window falls back to
 * ten minutes and is clamped so one mislogged row cannot swallow hours of listening.
 */
function minutes(seconds) {
  return Math.round((Number(seconds || 0) / 60) * 10) / 10;
}

function count(value) {
  return Number(value || 0);
}

function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

/**
 * Reads the radio audience picture for a rolling window.
 *
 * Listener minutes come from `radio_heartbeat` events, which carry the seconds actually
 * listened since the previous beat. Counting elapsed seconds rather than beats keeps the
 * total honest when a browser throttles timers in a background tab.
 */
export async function readRadioAudience(days = 7) {
  const db = await getDatabase();
  const windowDays = Number.isInteger(days) ? Math.min(365, Math.max(1, days)) : 7;
  const interval = `${windowDays} days`;

  const [overviewRows, concurrentRows, roomRows, artistRows, creatorRows, dailyRows] = await Promise.all([
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE event_name = 'radio_tune_in')::int AS tune_ins,
        COUNT(*) FILTER (WHERE event_name = 'radio_skip')::int AS skips,
        COUNT(*) FILTER (WHERE event_name = 'radio_heartbeat')::int AS heartbeats,
        COUNT(DISTINCT anonymous_id)::int AS unique_listeners,
        COUNT(DISTINCT session_id)::int AS sessions,
        COALESCE(SUM(
          CASE
            WHEN event_name = 'radio_heartbeat' AND jsonb_typeof(metadata->'seconds') = 'number'
              THEN (metadata->>'seconds')::numeric
            ELSE 0
          END
        ), 0) AS listened_seconds
      FROM analytics_events
      WHERE created_at >= NOW() - ${interval}::interval
        AND event_name IN ('radio_tune_in', 'radio_heartbeat', 'radio_tune_out', 'radio_skip')
    `,
    db.sql`
      SELECT COUNT(DISTINCT session_id)::int AS concurrent_listeners
      FROM analytics_events
      WHERE event_name = 'radio_heartbeat'
        AND created_at >= NOW() - INTERVAL '2 minutes'
    `,
    db.sql`
      SELECT
        COALESCE(NULLIF(metadata->>'room', ''), 'unknown') AS room,
        COUNT(*) FILTER (WHERE event_name = 'radio_tune_in')::int AS tune_ins,
        COUNT(*) FILTER (WHERE event_name = 'radio_skip')::int AS skips,
        COUNT(DISTINCT anonymous_id)::int AS unique_listeners,
        COALESCE(SUM(
          CASE
            WHEN event_name = 'radio_heartbeat' AND jsonb_typeof(metadata->'seconds') = 'number'
              THEN (metadata->>'seconds')::numeric
            ELSE 0
          END
        ), 0) AS listened_seconds
      FROM analytics_events
      WHERE created_at >= NOW() - ${interval}::interval
        AND event_name IN ('radio_tune_in', 'radio_heartbeat', 'radio_tune_out', 'radio_skip')
      GROUP BY 1
      ORDER BY listened_seconds DESC, room ASC
      LIMIT 20
    `,
    db.sql`
      SELECT
        play.artist_slug,
        play.artist_name,
        COUNT(DISTINCT heartbeat.anonymous_id)::int AS unique_listeners,
        COUNT(DISTINCT play.play_id)::int AS plays_heard,
        COALESCE(SUM((heartbeat.metadata->>'seconds')::numeric), 0) AS listened_seconds
      FROM analytics_events heartbeat
      JOIN LATERAL (
        SELECT history.id AS play_id, history.artist_slug, history.artist_name
        FROM halo_radio_play_history history
        WHERE history.room = heartbeat.metadata->>'room'
          AND history.started_at <= heartbeat.created_at
          AND heartbeat.created_at < history.started_at + make_interval(
            secs => LEAST(GREATEST(COALESCE(NULLIF(history.duration_seconds, 0), 600), 60), 3600)
          )
        ORDER BY history.started_at DESC
        LIMIT 1
      ) play ON TRUE
      WHERE heartbeat.event_name = 'radio_heartbeat'
        AND heartbeat.created_at >= NOW() - ${interval}::interval
        AND jsonb_typeof(heartbeat.metadata->'seconds') = 'number'
      GROUP BY play.artist_slug, play.artist_name
      ORDER BY listened_seconds DESC, play.artist_name ASC
      LIMIT 25
    `,
    db.sql`
      SELECT
        metadata->>'artist' AS artist_name,
        COALESCE(NULLIF(metadata->>'room', ''), 'unknown') AS room,
        COUNT(DISTINCT anonymous_id)::int AS unique_listeners,
        COALESCE(SUM(
          CASE WHEN jsonb_typeof(metadata->'seconds') = 'number' THEN (metadata->>'seconds')::numeric ELSE 0 END
        ), 0) AS listened_seconds
      FROM analytics_events
      WHERE event_name = 'radio_heartbeat'
        AND created_at >= NOW() - ${interval}::interval
        AND COALESCE(metadata->>'artist', '') <> ''
      GROUP BY 1, 2
      ORDER BY listened_seconds DESC, artist_name ASC
      LIMIT 25
    `,
    db.sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) FILTER (WHERE event_name = 'radio_tune_in')::int AS tune_ins,
        COUNT(DISTINCT anonymous_id)::int AS unique_listeners,
        COALESCE(SUM(
          CASE
            WHEN event_name = 'radio_heartbeat' AND jsonb_typeof(metadata->'seconds') = 'number'
              THEN (metadata->>'seconds')::numeric
            ELSE 0
          END
        ), 0) AS listened_seconds
      FROM analytics_events
      WHERE created_at >= NOW() - ${interval}::interval
        AND event_name IN ('radio_tune_in', 'radio_heartbeat', 'radio_tune_out', 'radio_skip')
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 90
    `
  ]);

  const overview = overviewRows[0] || {};
  const tuneIns = count(overview.tune_ins);
  const skips = count(overview.skips);
  const listenedSeconds = count(overview.listened_seconds);
  const sessions = count(overview.sessions);
  const attributedSeconds = artistRows.reduce((total, row) => total + count(row.listened_seconds), 0);

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    live: {
      concurrentListeners: count(concurrentRows[0]?.concurrent_listeners)
    },
    totals: {
      tuneIns,
      skips,
      skipRate: tuneIns ? Math.round((skips / tuneIns) * 1000) / 1000 : 0,
      heartbeats: count(overview.heartbeats),
      uniqueListeners: count(overview.unique_listeners),
      sessions,
      listenerMinutes: minutes(listenedSeconds),
      averageSessionMinutes: sessions ? minutes(listenedSeconds / sessions) : 0
    },
    coverage: {
      listenerMinutes: minutes(listenedSeconds),
      attributedMinutes: minutes(attributedSeconds),
      unattributedMinutes: minutes(Math.max(0, listenedSeconds - attributedSeconds))
    },
    rooms: roomRows.map(row => ({
      room: row.room,
      tuneIns: count(row.tune_ins),
      skips: count(row.skips),
      uniqueListeners: count(row.unique_listeners),
      listenerMinutes: minutes(row.listened_seconds)
    })),
    artists: artistRows.map(row => ({
      artistSlug: row.artist_slug || "",
      artistName: row.artist_name,
      uniqueListeners: count(row.unique_listeners),
      playsHeard: count(row.plays_heard),
      listenerMinutes: minutes(row.listened_seconds)
    })),
    mixCreators: creatorRows.map(row => ({
      artistName: row.artist_name,
      room: row.room,
      uniqueListeners: count(row.unique_listeners),
      listenerMinutes: minutes(row.listened_seconds)
    })),
    daily: dailyRows.map(row => ({
      date: isoDate(row.day),
      tuneIns: count(row.tune_ins),
      uniqueListeners: count(row.unique_listeners),
      listenerMinutes: minutes(row.listened_seconds)
    }))
  };
}

/**
 * The proof card for a single artist: what the radio actually delivered them.
 */
export async function readArtistProof(artistSlug, days = 30) {
  const db = await getDatabase();
  const windowDays = Number.isInteger(days) ? Math.min(365, Math.max(1, days)) : 30;
  const interval = `${windowDays} days`;

  const [playRows, audienceRows, followRows] = await Promise.all([
    db.sql`
      SELECT
        COUNT(*)::int AS plays,
        MAX(started_at) AS last_played_at,
        COALESCE(MAX(artist_name), '') AS artist_name
      FROM halo_radio_play_history
      WHERE artist_slug = ${artistSlug}
        AND started_at >= NOW() - ${interval}::interval
    `,
    db.sql`
      SELECT
        COUNT(DISTINCT heartbeat.anonymous_id)::int AS unique_listeners,
        COALESCE(SUM((heartbeat.metadata->>'seconds')::numeric), 0) AS listened_seconds
      FROM analytics_events heartbeat
      JOIN LATERAL (
        SELECT history.artist_slug
        FROM halo_radio_play_history history
        WHERE history.room = heartbeat.metadata->>'room'
          AND history.started_at <= heartbeat.created_at
          AND heartbeat.created_at < history.started_at + make_interval(
            secs => LEAST(GREATEST(COALESCE(NULLIF(history.duration_seconds, 0), 600), 60), 3600)
          )
        ORDER BY history.started_at DESC
        LIMIT 1
      ) play ON TRUE
      WHERE heartbeat.event_name = 'radio_heartbeat'
        AND heartbeat.created_at >= NOW() - ${interval}::interval
        AND jsonb_typeof(heartbeat.metadata->'seconds') = 'number'
        AND play.artist_slug = ${artistSlug}
    `,
    db.sql`
      SELECT COUNT(*)::int AS followers
      FROM halo_artist_follows
      WHERE artist_slug = ${artistSlug}
    `
  ]);

  const play = playRows[0] || {};
  const audience = audienceRows[0] || {};

  return {
    artistSlug,
    artistName: play.artist_name || artistSlug,
    windowDays,
    plays: count(play.plays),
    lastPlayedAt: play.last_played_at ? new Date(play.last_played_at).toISOString() : null,
    uniqueListeners: count(audience.unique_listeners),
    listenerMinutes: minutes(audience.listened_seconds),
    followers: count(followRows[0]?.followers)
  };
}
