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

export async function reconcileScheduledHeartbeats(db, now = new Date()) {
  const agentKeys = SCHEDULED_HEARTBEAT_SLA.map(item => item.agentKey);
  const rows = await db.sql`
    SELECT DISTINCT ON (details->>'agentKey')
      details->>'agentKey' AS agent_key,
      details->>'status' AS status,
      created_at
    FROM halo_ledger
    WHERE event_category = 'system_event'
      AND details->>'lifecycleEvent' = 'scheduled_heartbeat'
      AND details->>'agentKey' = ANY(${agentKeys})
    ORDER BY details->>'agentKey', created_at DESC
  `;
  const latestByAgent = new Map(
    rows.map(row => [row.agent_key, {
      seenAt: row.created_at ? new Date(row.created_at) : null,
      status: String(row.status || "unknown")
    }])
  );
  let stale = 0;
  let failed = 0;
  const tasks = [];
  for (const heartbeat of SCHEDULED_HEARTBEAT_SLA) {
    const latest = latestByAgent.get(heartbeat.agentKey) || null;
    const lastSeenAt = latest?.seenAt || null;
    const maxAgeMs = heartbeat.maxAgeMinutes * 60 * 1000;
    const ageMs = lastSeenAt ? now.getTime() - lastSeenAt.getTime() : Number.POSITIVE_INFINITY;
    const isStale = ageMs > maxAgeMs;
    const isFailed = Boolean(latest && latest.status !== "success" && !isStale);
    const staleFingerprint = `scheduled-heartbeat:missed:${heartbeat.agentKey}`;
    const staleIssueKey = issueKeyForFingerprint(staleFingerprint);
    const failedFingerprint = `scheduled-heartbeat:failed:${heartbeat.agentKey}`;
    const failedIssueKey = issueKeyForFingerprint(failedFingerprint);
    if (isStale) stale += 1;
    if (isFailed) failed += 1;
    if (isStale) {
      tasks.push(reportIssue({
        source: "scheduled",
        category: "operations",
        severity: "high",
        title: `Scheduled heartbeat missed: ${heartbeat.agentKey}`,
        details: lastSeenAt
          ? `${heartbeat.agentKey} has not recorded a run since ${lastSeenAt.toISOString()}.`
          : `${heartbeat.agentKey} has not recorded any scheduled heartbeat yet.`,
        pagePath: "/halo-command.html",
        fingerprint: staleFingerprint,
        metadata: {
          agentKey: heartbeat.agentKey,
          maxAgeMinutes: heartbeat.maxAgeMinutes,
          lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
          lastStatus: latest?.status || null
        }
      }));
    } else {
      tasks.push(resolveIssue(staleIssueKey, `${heartbeat.agentKey} heartbeat freshness is within SLA.`, {
        source: "scheduled_heartbeat",
        verification: {
          command: "scheduled-heartbeat-monitor",
          checkIds: [heartbeat.agentKey, "freshness"],
          resultSummary: `${heartbeat.agentKey} heartbeat freshness is within SLA.`,
          confidence: 0.95,
          checkedAt: now.toISOString()
        }
      }));
    }
    if (isFailed) {
      tasks.push(reportIssue({
        source: "scheduled",
        category: "operations",
        severity: "high",
        title: `Scheduled heartbeat failing: ${heartbeat.agentKey}`,
        details: `${heartbeat.agentKey} recorded a ${latest?.status || "unknown"} heartbeat at ${lastSeenAt?.toISOString() || "unknown time"}.`,
        pagePath: "/halo-command.html",
        fingerprint: failedFingerprint,
        metadata: {
          agentKey: heartbeat.agentKey,
          lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
          lastStatus: latest?.status || null
        }
      }));
    } else {
      tasks.push(resolveIssue(failedIssueKey, `${heartbeat.agentKey} heartbeat status is healthy.`, {
        source: "scheduled_heartbeat",
        verification: {
          command: "scheduled-heartbeat-monitor",
          checkIds: [heartbeat.agentKey, "status"],
          resultSummary: `${heartbeat.agentKey} heartbeat status is healthy.`,
          confidence: 0.95,
          checkedAt: now.toISOString()
        }
      }));
    }
  }
  const results = await Promise.allSettled(tasks);
  const failures = results.filter(result => result.status === "rejected");
  if (failures.length) {
    const message = failures
      .slice(0, 4)
      .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason || "unknown failure"))
      .join("; ");
    throw new Error(message);
  }
  return { stale, failed };
}
