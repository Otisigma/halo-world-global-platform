import { appendLedgerEntry } from "./halo-ledger.mjs";
import { issueKeyForFingerprint, reportIssue, resolveIssue } from "./maintenance.mjs";

export const SCHEDULED_HEARTBEAT_SLA = Object.freeze([
  { agentKey: "halo-agent-daily", maxAgeMinutes: 26 * 60 },
  { agentKey: "health-scout", maxAgeMinutes: 35 },
  { agentKey: "radio-health-scout", maxAgeMinutes: 20 },
  { agentKey: "outreach-weekly", maxAgeMinutes: 9 * 24 * 60 },
  { agentKey: "artist-agent-weekly", maxAgeMinutes: 9 * 24 * 60 }
]);

export async function recordScheduledHeartbeat(db, agentKey, status = "success", details = {}) {
  await appendLedgerEntry(db, {
    actorId: "system",
    actorType: "system",
    eventCategory: "system_event",
    summary: `Scheduled heartbeat: ${agentKey} (${status})`,
    details: {
      lifecycleEvent: "scheduled_heartbeat",
      agentKey,
      status,
      ...details
    },
    body: `${agentKey} scheduled heartbeat recorded.`,
    outcome: status === "success" ? "success" : "failure"
  });
}

async function latestHeartbeatAt(db, agentKey) {
  const [row] = await db.sql`
    SELECT created_at
    FROM halo_ledger
    WHERE event_category = 'system_event'
      AND details->>'lifecycleEvent' = 'scheduled_heartbeat'
      AND details->>'agentKey' = ${agentKey}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return row?.created_at ? new Date(row.created_at) : null;
}

export async function reconcileScheduledHeartbeats(db, now = new Date()) {
  let stale = 0;
  for (const heartbeat of SCHEDULED_HEARTBEAT_SLA) {
    const lastSeenAt = await latestHeartbeatAt(db, heartbeat.agentKey);
    const maxAgeMs = heartbeat.maxAgeMinutes * 60 * 1000;
    const ageMs = lastSeenAt ? now.getTime() - lastSeenAt.getTime() : Number.POSITIVE_INFINITY;
    const fingerprint = `scheduled-heartbeat:${heartbeat.agentKey}`;
    const issueKey = issueKeyForFingerprint(fingerprint);
    if (ageMs > maxAgeMs) {
      stale += 1;
      await reportIssue({
        source: "scheduled",
        category: "operations",
        severity: "high",
        title: `Scheduled heartbeat missed: ${heartbeat.agentKey}`,
        details: lastSeenAt
          ? `${heartbeat.agentKey} has not recorded a run since ${lastSeenAt.toISOString()}.`
          : `${heartbeat.agentKey} has not recorded any scheduled heartbeat yet.`,
        pagePath: "/halo-command.html",
        fingerprint,
        metadata: {
          agentKey: heartbeat.agentKey,
          maxAgeMinutes: heartbeat.maxAgeMinutes,
          lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null
        }
      });
      continue;
    }
    await resolveIssue(issueKey, `${heartbeat.agentKey} heartbeat is within SLA.`, {
      source: "scheduled_heartbeat",
      verification: {
        command: "scheduled-heartbeat-monitor",
        checkIds: [heartbeat.agentKey],
        resultSummary: `${heartbeat.agentKey} heartbeat is within SLA.`,
        confidence: 0.95,
        checkedAt: now.toISOString()
      }
    });
  }
  return { stale };
}
