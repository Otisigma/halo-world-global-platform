import { getDatabase } from "@netlify/database";
import { generateDailyReport, sendReportEmail, sendReportWebhook } from "../lib/halo-x.mjs";

export default async function haloDailyReportHandler() {
  const db = await getDatabase();
  const report = await generateDailyReport(db);
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
  console.log("HALO daily report generated", { date: report.date, delivery });
}

export const config = {
  schedule: "0 8 * * *"
};
