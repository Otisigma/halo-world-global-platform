import { getDatabase } from "@netlify/database";
import { listActiveArtistPlans, reserveArtistRun, runArtistAgentTeam } from "../lib/artist-agents.mjs";

// Weekly briefings run one artist at a time and stop at the plan's own quota, so a busy roster can
// never quietly spend more inference than the plans it was sold under.
export default async function artistAgentWeeklyHandler() {
  const db = await getDatabase();
  const plans = await listActiveArtistPlans(db, 12);
  const results = [];

  for (const plan of plans) {
    const reserved = await reserveArtistRun(db, plan.artistSlug);
    if (!reserved) {
      results.push({ artistSlug: plan.artistSlug, skipped: "quota_reached" });
      continue;
    }
    try {
      const report = await runArtistAgentTeam(db, plan.artistSlug, { triggerType: "scheduled", plan: reserved });
      results.push(report
        ? { artistSlug: plan.artistSlug, status: report.status, momentum: report.momentum, kept: report.grounding.recommendationsKept }
        : { artistSlug: plan.artistSlug, skipped: "signals_unavailable" });
    } catch (error) {
      console.error("HALO artist agent weekly run failed", plan.artistSlug, error instanceof Error ? error.message : "unknown error");
      results.push({ artistSlug: plan.artistSlug, skipped: "run_failed" });
    }
  }

  console.log("HALO artist agent weekly briefings generated", { artists: plans.length, results });
}

export const config = {
  schedule: "15 8 * * 1"
};
