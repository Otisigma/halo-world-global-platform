import { getDatabase } from "@netlify/database";
import { runAgentCouncil, sendAgentReportWebhook } from "../lib/agent-team.mjs";
import { recordScheduledHeartbeat } from "../lib/scheduled-heartbeats.mjs";

export default async function haloAgentDailyHandler() {
  const db = await getDatabase();
  try {
    const report = await runAgentCouncil(db, { triggerType: "scheduled" });
    let delivered = false;
    try {
      delivered = await sendAgentReportWebhook(report);
    } catch (error) {
      console.error("HALO agent daily webhook failed", error instanceof Error ? error.message : "unknown error");
    }
    await recordScheduledHeartbeat(db, "halo-agent-daily", delivered ? "success" : "failure", {
      reportDate: report.reportDate,
      delivered
    });
    console.log("HALO Agent Council daily report generated", {
      date: report.reportDate,
      status: report.status,
      healthScore: report.synthesis.healthScore,
      delivered
    });
  } catch (error) {
    await recordScheduledHeartbeat(db, "halo-agent-daily", "failure", {
      error: error instanceof Error ? error.message : "unknown error"
    });
    throw error;
  }
}

export const config = {
  schedule: "30 7 * * *"
};
