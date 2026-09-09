import { timingSafeEqual } from "node:crypto";
import { getStatsDatabase, jsonResponse } from "../lib/stats.mjs";

function authorized(request) {
  const expectedToken = process.env.STATS_ADMIN_TOKEN;
  if (!expectedToken) return false;

  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);

  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function rowNumber(value) {
  return Number(value || 0);
}

export default async function statsSummaryHandler(request) {
  if (request.method !== "GET") {
    return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "GET" });
  }

  if (!process.env.STATS_ADMIN_TOKEN) {
    return jsonResponse({ message: "Stats reporting is not configured" }, 503);
  }

  if (!authorized(request)) {
    return jsonResponse({ message: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const requestedDays = Number(new URL(request.url).searchParams.get("days") || 30);
  const days = Number.isInteger(requestedDays) ? Math.min(365, Math.max(1, requestedDays)) : 30;

  try {
    const db = await getStatsDatabase();
    const interval = `${days} days`;

    const [overviewRows, eventRows, dailyRows, pageRows, funnelRows, commercialRows, creatorRows, listeningRows, listeningVariantRows] = await Promise.all([
      db.sql`
        SELECT
          COUNT(*)::int AS total_events,
          COUNT(DISTINCT anonymous_id)::int AS unique_visitors,
          COUNT(DISTINCT session_id)::int AS sessions,
          COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
          COUNT(DISTINCT DATE(created_at))::int AS active_days
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
      `,
      db.sql`
        SELECT event_name, COUNT(*)::int AS events, COUNT(DISTINCT anonymous_id)::int AS visitors
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
        GROUP BY event_name
        ORDER BY events DESC, event_name ASC
      `,
      db.sql`
        SELECT
          DATE(created_at) AS date,
          COUNT(*)::int AS events,
          COUNT(DISTINCT anonymous_id)::int AS visitors,
          COUNT(DISTINCT session_id)::int AS sessions
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
      db.sql`
        SELECT page_path, COUNT(*)::int AS views, COUNT(DISTINCT anonymous_id)::int AS visitors
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
          AND event_name = 'page_view'
        GROUP BY page_path
        ORDER BY views DESC, page_path ASC
        LIMIT 20
      `,
      db.sql`
        SELECT
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'page_view')::int AS reached_site,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name IN ('enter_console', 'open_dj_deck'))::int AS entered_product,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name IN ('import_local_audio', 'import_track', 'load_youtube'))::int AS imported_media,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name IN ('sync_decks', 'sync_telemetry'))::int AS completed_performance_action
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
      `,
      db.sql`
        SELECT
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'open_artist_pro')::int AS opened_artist_pro,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'artist_pro_form_start')::int AS started_application,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'artist_pro_application_submit')::int AS submitted_application,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'artist_pro_application_success')::int AS completed_application
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
      `,
      db.sql`
        SELECT
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name IN ('open_release_house', 'release_project_opened'))::int AS opened_release_house,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'release_project_created')::int AS created_release_project,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'release_room_completed')::int AS completed_release_room,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'release_next_action_opened')::int AS continued_release_journey
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
      `,
      db.sql`
        SELECT
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'music_player_open')::int AS opened_player,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'music_playback_start')::int AS started_playback,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'music_preview_reached')::int AS reached_preview_limit,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'music_preview_continue')::int AS continued_listening,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'music_playback_complete')::int AS completed_playback,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE event_name = 'music_external_open')::int AS opened_external,
          COALESCE(ROUND(AVG((metadata->>'seconds')::numeric) FILTER (
            WHERE event_name = 'music_player_close' AND metadata ? 'seconds'
          )), 0)::int AS average_listen_seconds
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
      `,
      db.sql`
        WITH listener_variants AS (
          SELECT anonymous_id, metadata->>'variant' AS variant, MIN(created_at) AS opened_at
          FROM analytics_events
          WHERE created_at >= NOW() - ${interval}::interval
            AND event_name = 'music_player_open'
            AND metadata->>'variant' IN ('quick_15', 'sample_30', 'full_listen')
          GROUP BY anonymous_id, metadata->>'variant'
        )
        SELECT
          listener_variants.variant,
          COUNT(DISTINCT listener_variants.anonymous_id)::int AS listeners,
          COUNT(DISTINCT listener_variants.anonymous_id) FILTER (WHERE event.event_name = 'music_playback_start')::int AS started_playback,
          COUNT(DISTINCT listener_variants.anonymous_id) FILTER (WHERE event.event_name = 'music_preview_continue')::int AS continued_listening,
          COUNT(DISTINCT listener_variants.anonymous_id) FILTER (WHERE event.event_name = 'music_playback_complete')::int AS completed_playback,
          COUNT(DISTINCT listener_variants.anonymous_id) FILTER (
            WHERE event.event_name IN ('open_payment', 'open_halo_x_mix_edition_checkout', 'payment_checkout_started')
          )::int AS commercial_intent,
          COALESCE(ROUND(AVG((event.metadata->>'seconds')::numeric) FILTER (
            WHERE event.event_name = 'music_player_close' AND event.metadata ? 'seconds'
          )), 0)::int AS average_listen_seconds
        FROM listener_variants
        LEFT JOIN analytics_events event
          ON event.anonymous_id = listener_variants.anonymous_id
          AND event.created_at >= listener_variants.opened_at
        GROUP BY listener_variants.variant
        ORDER BY listener_variants.variant
      `
    ]);

    const overview = overviewRows[0] || {};
    const funnel = funnelRows[0] || {};
    const commercial = commercialRows[0] || {};
    const creator = creatorRows[0] || {};
    const listening = listeningRows[0] || {};

    return jsonResponse({
      periodDays: days,
      generatedAt: new Date().toISOString(),
      overview: {
        totalEvents: rowNumber(overview.total_events),
        uniqueVisitors: rowNumber(overview.unique_visitors),
        sessions: rowNumber(overview.sessions),
        pageViews: rowNumber(overview.page_views),
        activeDays: rowNumber(overview.active_days)
      },
      funnel: {
        reachedSite: rowNumber(funnel.reached_site),
        enteredProduct: rowNumber(funnel.entered_product),
        importedMedia: rowNumber(funnel.imported_media),
        completedPerformanceAction: rowNumber(funnel.completed_performance_action)
      },
      commercial: {
        openedArtistPro: rowNumber(commercial.opened_artist_pro),
        startedApplication: rowNumber(commercial.started_application),
        submittedApplication: rowNumber(commercial.submitted_application),
        completedApplication: rowNumber(commercial.completed_application)
      },
      creatorFunnel: {
        openedReleaseHouse: rowNumber(creator.opened_release_house),
        createdReleaseProject: rowNumber(creator.created_release_project),
        completedReleaseRoom: rowNumber(creator.completed_release_room),
        continuedReleaseJourney: rowNumber(creator.continued_release_journey)
      },
      listening: {
        openedPlayer: rowNumber(listening.opened_player),
        startedPlayback: rowNumber(listening.started_playback),
        reachedPreviewLimit: rowNumber(listening.reached_preview_limit),
        continuedListening: rowNumber(listening.continued_listening),
        completedPlayback: rowNumber(listening.completed_playback),
        openedExternal: rowNumber(listening.opened_external),
        averageListenSeconds: rowNumber(listening.average_listen_seconds)
      },
      listeningVariants: listeningVariantRows.map(row => ({
        variant: row.variant,
        listeners: rowNumber(row.listeners),
        startedPlayback: rowNumber(row.started_playback),
        continuedListening: rowNumber(row.continued_listening),
        completedPlayback: rowNumber(row.completed_playback),
        commercialIntent: rowNumber(row.commercial_intent),
        averageListenSeconds: rowNumber(row.average_listen_seconds)
      })),
      events: eventRows.map(row => ({
        eventName: row.event_name,
        events: rowNumber(row.events),
        visitors: rowNumber(row.visitors)
      })),
      daily: dailyRows.map(row => ({
        date: row.date,
        events: rowNumber(row.events),
        visitors: rowNumber(row.visitors),
        sessions: rowNumber(row.sessions)
      })),
      pages: pageRows.map(row => ({
        pagePath: row.page_path,
        views: rowNumber(row.views),
        visitors: rowNumber(row.visitors)
      }))
    });
  } catch (error) {
    console.error("Stats summary failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "Stats summary is unavailable" }, 500);
  }
}

export const config = {
  path: "/api/stats/summary"
};
