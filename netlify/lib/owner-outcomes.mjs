import { isOwner } from "./halo-x.mjs";

export function outcomeRate(numerator, denominator) {
  return denominator > 0 ? Math.round(numerator / denominator * 1000) / 10 : null;
}

async function source(name, load, serialize) {
  try {
    const rows = await load();
    return { status: "available", metrics: serialize(rows[0]) };
  } catch {
    console.error(`HALO owner outcomes source unavailable: ${name}`);
    return { status: "unavailable", metrics: null };
  }
}

const count = value => Number(value || 0);

export async function loadOwnerOutcomes(db, user, now = new Date()) {
  if (!isOwner(user)) throw new Error("Owner access is required");
  const end = now.toISOString();
  const start = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const previousStart = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [creators, listeners, playback, operations] = await Promise.all([
    source("creators", () => db.sql`
      SELECT COUNT(*)::int AS projects,
        COUNT(*) FILTER (
          WHERE completed_rooms @> ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13]::SMALLINT[]
        )::int AS prepared
      FROM halo_release_house_projects
      WHERE created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
    `, row => {
      const projects = count(row.projects);
      const prepared = count(row.prepared);
      return { projects, prepared, preparationRate: outcomeRate(prepared, projects) };
    }),
    source("listeners", () => db.sql`
      WITH members AS (
        SELECT s.member_id,
          BOOL_OR(s.started_at < ${start}::timestamptz) AS previous_week,
          BOOL_OR(s.started_at >= ${start}::timestamptz) AS current_week
        FROM halo_listening_sessions s
        JOIN halo_listening_preferences p ON p.member_id = s.member_id
        WHERE p.enabled = TRUE AND p.consent_at IS NOT NULL AND s.started_at >= p.consent_at
          AND s.started_at >= ${previousStart}::timestamptz AND s.started_at < ${end}::timestamptz
        GROUP BY s.member_id
      )
      SELECT COUNT(*) FILTER (WHERE previous_week)::int AS previous_listeners,
        COUNT(*) FILTER (WHERE current_week)::int AS current_listeners,
        COUNT(*) FILTER (WHERE previous_week AND current_week)::int AS returning_listeners
      FROM members
    `, row => {
      const previousListeners = count(row.previous_listeners);
      const returningListeners = count(row.returning_listeners);
      return {
        previousListeners, currentListeners: count(row.current_listeners), returningListeners,
        returnRate: outcomeRate(returningListeners, previousListeners)
      };
    }),
    source("playback", () => db.sql`
      WITH attempts AS (
        SELECT anonymous_id, metadata->>'play_id' AS play_id, MIN(created_at) AS attempted_at
        FROM analytics_events
        WHERE event_name = 'shop_playback_attempt'
          AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
          AND COALESCE(metadata->>'play_id', '') <> ''
        GROUP BY anonymous_id, metadata->>'play_id'
      ), outcomes AS (
        SELECT a.anonymous_id, a.play_id,
          BOOL_OR(e.event_name = 'shop_playback_ready') AS ready,
          BOOL_OR(e.event_name = 'shop_playback_failed') AS failed
        FROM attempts a
        LEFT JOIN analytics_events e ON e.anonymous_id = a.anonymous_id
          AND e.metadata->>'play_id' = a.play_id
          AND e.event_name IN ('shop_playback_ready', 'shop_playback_failed')
          AND e.created_at >= ${start}::timestamptz AND e.created_at < ${end}::timestamptz
        GROUP BY a.anonymous_id, a.play_id
      )
      SELECT COUNT(*)::int AS attempts,
        COUNT(*) FILTER (WHERE ready)::int AS ready,
        COUNT(*) FILTER (WHERE failed)::int AS failed,
        COUNT(*) FILTER (WHERE NOT COALESCE(ready, FALSE) AND NOT COALESCE(failed, FALSE))::int AS unknown
      FROM outcomes
    `, row => {
      const attempts = count(row.attempts);
      const ready = count(row.ready);
      return {
        attempts, ready, failed: count(row.failed), unknown: count(row.unknown),
        startRate: outcomeRate(ready, attempts)
      };
    }),
    source("operations", () => db.sql`
      SELECT COUNT(*) FILTER (
          WHERE status <> 'healed' AND first_seen_at < ${end}::timestamptz
        )::int AS open_issues,
        COUNT(*) FILTER (
          WHERE first_seen_at >= ${start}::timestamptz AND first_seen_at < ${end}::timestamptz
        )::int AS new_issues,
        COUNT(*) FILTER (
          WHERE source = 'scheduled' AND first_seen_at >= ${start}::timestamptz AND first_seen_at < ${end}::timestamptz
        )::int AS scheduled_issues,
        COUNT(*) FILTER (
          WHERE status = 'healed' AND healed_at >= ${start}::timestamptz AND healed_at < ${end}::timestamptz
        )::int AS healed_issues
      FROM maintenance_issues
      WHERE status <> 'healed' OR first_seen_at >= ${start}::timestamptz OR healed_at >= ${start}::timestamptz
    `, row => ({
      openIssues: count(row.open_issues), newIssues: count(row.new_issues),
      scheduledIssues: count(row.scheduled_issues), healedIssues: count(row.healed_issues)
    }))
  ]);
  return {
    generatedAt: end, window: { days: 7, start, end, previousStart },
    sources: { creators, listeners, playback, operations }
  };
}
