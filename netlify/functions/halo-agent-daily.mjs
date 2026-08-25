import { getDatabase } from "@netlify/database";
import { runAgentCouncil, sendAgentReportWebhook } from "../lib/agent-team.mjs";

export default async function haloAgentDailyHandler() {
  const db = await getDatabase();
  const report = await runAgentCouncil(db, { triggerType: "scheduled" });
  let delivered = false;
  try {
    delivered = await sendAgentReportWebhook(report);
  } catch (error) {
    console.error("HALO agent daily webhook failed", error instanceof Error ? error.message : "unknown error");
  }
  console.log("HALO Agent Council daily report generated", {
    date: report.reportDate,
    status: report.status,
    healthScore: report.synthesis.healthScore,
    delivered
  });
}

export const config = {
  schedule: "30 7 * * *"
};
