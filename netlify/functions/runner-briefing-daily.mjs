import { getDatabase } from "@netlify/database";
import { buildRunnerBriefing, storeRunnerBriefing, ukHour } from "../lib/runner-briefing.mjs";
import { textDailyCheck } from "../lib/owner-alerts.mjs";
import { recordScheduledHeartbeat } from "../lib/scheduled-heartbeats.mjs";

// Runs at 07:00 and 08:00 UTC so the briefing lands at 08:00 UK time in both GMT and BST.
export default async function runnerBriefingDailyHandler() {
  const now = new Date();
  if (ukHour(now) !== 8) return;
  const db = getDatabase();
  try {
    const briefing = await buildRunnerBriefing(db, { now, triggerType: "scheduled" });
    await storeRunnerBriefing(db, briefing);
    await recordScheduledHeartbeat(db, "runner-briefing-daily", "success", {
      briefingDate: briefing.briefingDate,
      coverage: briefing.coverage
    });
    const moves = (briefing.leverageMoves || []).slice(0, 2).map((move, i) => `${i + 1}. ${move?.title || move?.action || move}`);
    await textDailyCheck("Runners Briefing", {
      lines: [`Sources ${briefing.coverage.available}/${briefing.coverage.total} read`, ...moves]
    });
    console.log("HALO Runners Briefing stored", { date: briefing.briefingDate, coverage: briefing.coverage });
  } catch (error) {
    await recordScheduledHeartbeat(db, "runner-briefing-daily", "failure", {
      error: error instanceof Error ? error.message : "unknown error"
    }).catch(() => {});
    await textDailyCheck("Runners Briefing", { status: "failed", lines: [error instanceof Error ? error.message : "unknown error"] });
    throw error;
  }
}

export const config = {
  schedule: "0 7,8 * * *"
};
