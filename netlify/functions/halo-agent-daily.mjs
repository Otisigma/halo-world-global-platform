import { getDatabase } from "@netlify/database";
import { runAgentCouncil, sendAgentReportWebhook } from "../lib/agent-team.mjs";
import { textDailyCheck } from "../lib/owner-alerts.mjs";
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
    const top = report.synthesis?.priorities?.[0]?.title;
    await textDailyCheck("Agent Council", {
      lines: [`Health ${report.synthesis?.healthScore ?? "?"}/100, status ${report.status}`, top ? `Top: ${top}` : ""]
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
    await textDailyCheck("Agent Council", { status: "failed", lines: [error instanceof Error ? error.message : "unknown error"] });
    throw error;
  }
}

export const config = {
  schedule: "30 7 * * *"
};
