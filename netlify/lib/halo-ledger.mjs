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
]);

/** Valid outcome values. */
const OUTCOMES = new Set(["success", "failure", "pending", "cancelled"]);

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
