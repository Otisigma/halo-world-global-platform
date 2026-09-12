import { getDatabase } from "@netlify/database";
import { runMaintenanceSweep } from "../lib/maintenance-sweep.mjs";
import { escalateStaleMaintenanceIssues, retryDispatchQueue } from "../lib/maintenance.mjs";
import { reconcileScheduledHeartbeats, recordScheduledHeartbeat } from "../lib/scheduled-heartbeats.mjs";

export default async function healthScoutHandler(_request, context) {
  const baseUrl = context?.site?.url || globalThis.Netlify?.env?.get("URL") || globalThis.Netlify?.env?.get("DEPLOY_PRIME_URL");
  const db = getDatabase();
  if (!baseUrl) {
    console.error("Health scout skipped because the site URL is unavailable");
    await recordScheduledHeartbeat(db, "health-scout", "failure", { reason: "site_url_unavailable" });
    return;
  }

  try {
    const sweep = await runMaintenanceSweep(db, baseUrl);
    const dispatchRetries = await retryDispatchQueue(db, { limit: 10 });
    const staleIssues = await escalateStaleMaintenanceIssues(db, { limit: 20 });
    const heartbeats = await reconcileScheduledHeartbeats(db);
    await recordScheduledHeartbeat(db, "health-scout", "success", {
      sweepStatus: sweep.status,
      failedChecks: sweep.failedChecks,
      dispatchRetries,
      staleIssues,
      heartbeats
    });
    console.log("HALO maintenance sweep completed", { sweep, dispatchRetries, staleIssues, heartbeats });
  } catch (error) {
    await recordScheduledHeartbeat(db, "health-scout", "failure", {
      error: error instanceof Error ? error.message : "unknown error"
    });
    throw error;
  }

  try {
    await db.sql`
      DELETE FROM maintenance_report_events
      WHERE created_at < NOW() - INTERVAL '1 day'
    `;
  } catch (error) {
    console.error("Maintenance rate-limit cleanup failed", error instanceof Error ? error.message : "unknown error");
  }
}

export const config = {
  schedule: "*/15 * * * *"
};
