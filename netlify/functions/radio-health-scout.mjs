import { getDatabase } from "@netlify/database";
import { inspectRadioHealth } from "../lib/radio-health.mjs";
import { issueKeyForFingerprint, reportIssue, resolveIssue } from "../lib/maintenance.mjs";
import { recordScheduledHeartbeat } from "../lib/scheduled-heartbeats.mjs";

async function reconcileCheck({ fingerprint, healthy, title, details, severity = "high", metadata = {} }) {
  const issueKey = issueKeyForFingerprint(fingerprint);
  if (healthy) {
    await resolveIssue(issueKey, `${title} passed its automated radio verification.`, {
      source: "radio_health_scout",
      verification: {
        command: "radio-health-scout",
        checkIds: [fingerprint],
        resultSummary: `${title} passed its automated radio verification.`,
        confidence: 0.9,
        checkedAt: new Date().toISOString()
      }
    });
    return;
  }
  await reportIssue({
    source: "scheduled",
    category: "radio",
    severity,
    title,
    details,
    pagePath: "/radio/",
    fingerprint,
    metadata
  });
}

export default async function radioHealthScoutHandler() {
  const db = getDatabase();
  const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!baseUrl) {
    console.error("Radio health scout skipped because the site URL is unavailable");
    await recordScheduledHeartbeat(db, "radio-health-scout", "failure", { reason: "site_url_unavailable" });
    return;
  }
  try {
    const health = await inspectRadioHealth(baseUrl);
    const checks = [
      {
        fingerprint: "radio-health|station-api",
        healthy: health.status !== "offline",
        title: "Halo Radio station API is unavailable",
        details: health.summary,
        severity: "critical",
        metadata: { status: health.status, checkedAt: health.checkedAt }
      },
      {
        fingerprint: "radio-health|clock",
        healthy: health.timing.healthy,
        title: "Halo Radio timing is stale",
        details: health.timing.message,
        metadata: { dataAgeMs: health.dataAgeMs, checkedAt: health.checkedAt }
      },
      {
        fingerprint: "radio-health|data",
        healthy: health.data.healthy,
        title: "Halo Radio station data is invalid",
        details: health.data.errors.join("; ") || "Station metadata failed validation.",
        metadata: { errors: health.data.errors, checkedAt: health.checkedAt }
      }
    ];

    for (const room of health.rooms) {
      checks.push({
        fingerprint: `radio-health|room|${room.id}`,
        healthy: room.reachable,
        title: `${room.name} signal is not live`,
        details: room.configured ? room.message : `${room.name} has no HTTPS stream configured.`,
        severity: room.configured ? "critical" : "high",
        metadata: {
          room: room.id,
          configured: room.configured,
          statusCode: room.statusCode,
          latencyMs: room.latencyMs,
          checkedAt: health.checkedAt
        }
      });
    }

    await Promise.all(checks.map(reconcileCheck));
    await recordScheduledHeartbeat(db, "radio-health-scout", "success", {
      status: health.status,
      roomCount: health.rooms.length
    });
  } catch (error) {
    await recordScheduledHeartbeat(db, "radio-health-scout", "failure", {
      error: error instanceof Error ? error.message : "unknown error"
    });
    throw error;
  }
}

export const config = {
  schedule: "*/5 * * * *"
};
