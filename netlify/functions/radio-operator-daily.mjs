import { getDatabase } from "@netlify/database";
import { textDailyCheck } from "../lib/owner-alerts.mjs";
import { runRadioOperator } from "../lib/radio-operator.mjs";

export default async function radioOperatorDailyHandler() {
  const db = await getDatabase();
  let briefing;
  try {
    briefing = await runRadioOperator(db, { triggerType: "scheduled" });
  } catch (error) {
    await textDailyCheck("Radio Operator", { status: "failed", lines: [error instanceof Error ? error.message : "unknown error"] });
    throw error;
  }
  await textDailyCheck("Radio Operator", {
    lines: [`Station ${briefing.stationGrade || "unknown"}, listener mins ${briefing.signals?.audience?.listenerMinutes ?? 0}`]
  });

  console.log("HALO radio operator briefing generated", {
    date: briefing.briefingDate,
    grade: briefing.stationGrade,
    listenerMinutes: briefing.signals?.audience?.listenerMinutes ?? 0,
    projectedMonthlyUsageUsd: briefing.signals?.cost?.projectedMonthlyUsageUsd ?? 0,
    usedFallback: briefing.usedFallback
  });
}

export const config = {
  schedule: "0 5 * * *"
};
