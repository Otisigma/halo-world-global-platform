import { getDatabase } from "@netlify/database";
import { textDailyCheck } from "../lib/owner-alerts.mjs";
import { generateDailyReport, sendReportEmail, sendReportWebhook } from "../lib/halo-x.mjs";

export default async function haloDailyReportHandler() {
  const db = await getDatabase();
  let report;
  try {
    report = await generateDailyReport(db);
  } catch (error) {
    await textDailyCheck("Daily Report", { status: "failed", lines: [error instanceof Error ? error.message : "unknown error"] });
    throw error;
  }
  const delivery = { email: false, webhook: false };
  try {
    delivery.email = await sendReportEmail(report);
  } catch (error) {
    console.error("HALO daily report email failed", error instanceof Error ? error.message : "unknown error");
  }
  try {
    delivery.webhook = await sendReportWebhook(report);
  } catch (error) {
    console.error("HALO daily report webhook failed", error instanceof Error ? error.message : "unknown error");
  }
  const m = report.metrics || {};
  await textDailyCheck("Daily Report", {
    lines: [`Joined ${m.joinedToday ?? 0}, active 24h ${m.active24h ?? 0}, visitors ${m.uniqueVisitorsToday ?? 0}`,
      `Artist Pro waiting ${m.artistProAwaitingReview ?? 0}, support ${m.supportSignalsToday ?? 0}`]
  });
  console.log("HALO daily report generated", { date: report.date, delivery });
}

export const config = {
  schedule: "0 8 * * *"
};
