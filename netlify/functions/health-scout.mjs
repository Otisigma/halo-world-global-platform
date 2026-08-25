import { getDatabase } from "@netlify/database";
import { runMaintenanceSweep } from "../lib/maintenance-sweep.mjs";

export default async function healthScoutHandler(_request, context) {
  const baseUrl = context?.site?.url || globalThis.Netlify?.env?.get("URL") || globalThis.Netlify?.env?.get("DEPLOY_PRIME_URL");
  if (!baseUrl) {
    console.error("Health scout skipped because the site URL is unavailable");
    return;
  }

  const db = getDatabase();
  const sweep = await runMaintenanceSweep(db, baseUrl);
  console.log("HALO maintenance sweep completed", sweep);

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
