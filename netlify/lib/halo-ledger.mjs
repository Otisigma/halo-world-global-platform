import { randomUUID } from "node:crypto";

/** All recognised ledger event categories. */
export const LEDGER_CATEGORIES = new Set([
  "upload_event",
  "issue_report",
  "fix_record",
  "department_action",
  "approval_event",
  "agent_activity",
  "feature_request",
  "system_event",
  "route_health",
  "maintenance_lifecycle",
]);

/** Valid outcome values. */
const OUTCOMES = new Set(["success", "failure", "pending", "cancelled"]);
const ROUTE_HEALTH_STATES = new Set(["working", "attention", "broken", "disconnected"]);

/**
 * Write one entry to halo_ledger.
 *
 * @param {object} db   – database connection from @netlify/database
 * @param {object} opts – ledger entry fields
 * @returns {Promise<string>} the new entry id
 */
export async function appendLedgerEntry(db, {
  actorId = "system",
  actorType = "system",
  eventCategory,
  refSongId = null,
  refIssueId = null,
  refReleaseId = null,
  refAgentId = null,
  summary = "",
  details = {},
  body = "",
  pipelineStage = null,
  outcome = "success",
} = {}) {
  if (!LEDGER_CATEGORIES.has(eventCategory)) {
    throw new Error(`Unknown ledger event category: ${eventCategory}`);
  }
  if (outcome && !OUTCOMES.has(outcome)) {
    throw new Error(`Unknown ledger outcome value: ${outcome}`);
  }
  const id = randomUUID();
  const safeOutcome = outcome || "success";
  const detailsJson = JSON.stringify(details);

  await db.sql`
    INSERT INTO halo_ledger (
      id, actor_id, actor_type, event_category,
      ref_song_id, ref_issue_id, ref_release_id, ref_agent_id,
      summary, details, body, pipeline_stage, outcome, created_at
    ) VALUES (
      ${id}, ${actorId}, ${actorType}, ${eventCategory},
      ${refSongId}, ${refIssueId}, ${refReleaseId}, ${refAgentId},
      ${String(summary).trim().slice(0, 500)},
      ${detailsJson}::jsonb,
      ${String(body).trim().slice(0, 10000)},
      ${pipelineStage},
      ${safeOutcome},
      NOW()
    )
  `;
  return id;
}

/**
 * Persist one route-health chart snapshot in halo_route_health_entries and halo_ledger.
 */
export async function appendRouteHealthEntry(db, {
  actorId = "system",
  actorType = "system",
  pagePath = "/halo",
  chartStatus = "working",
  stateCounts = {},
  routeStates = [],
  triggerType = "scheduled",
  commandName = "halo-signal-check",
  notes = "",
} = {}) {
  if (!ROUTE_HEALTH_STATES.has(chartStatus)) {
    throw new Error(`Unknown route-health chart status: ${chartStatus}`);
  }
  const normalizedCounts = {
    working: Number(stateCounts.working || 0),
    attention: Number(stateCounts.attention || 0),
    broken: Number(stateCounts.broken || 0),
    disconnected: Number(stateCounts.disconnected || 0),
  };
  const summary = `Route health chart: ${chartStatus.toUpperCase()} (${normalizedCounts.working} working · ${normalizedCounts.attention} attention · ${normalizedCounts.broken} broken · ${normalizedCounts.disconnected} disconnected)`;
  const ledgerEntryId = await appendLedgerEntry(db, {
    actorId,
    actorType,
    eventCategory: "route_health",
    summary,
    details: {
      chartStatus,
      stateCounts: normalizedCounts,
      routeStates,
      triggerType,
      commandName,
    },
    body: notes || `Persisted route health snapshot for ${pagePath}.`,
    outcome: chartStatus === "working" ? "success" : "failure",
  });
  await db.sql`
    INSERT INTO halo_route_health_entries (
      id, ledger_entry_id, page_path, chart_status, state_counts, route_states, created_at
    ) VALUES (
      ${randomUUID()}, ${ledgerEntryId}, ${String(pagePath || "/halo").slice(0, 500)}, ${chartStatus},
      ${JSON.stringify(normalizedCounts)}::jsonb, ${JSON.stringify(routeStates)}::jsonb, NOW()
    )
  `;
  return ledgerEntryId;
}
