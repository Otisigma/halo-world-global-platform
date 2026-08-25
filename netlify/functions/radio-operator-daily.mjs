import { getDatabase } from "@netlify/database";
import { runRadioOperator } from "../lib/radio-operator.mjs";

export default async function radioOperatorDailyHandler() {
  const db = await getDatabase();
  const briefing = await runRadioOperator(db, { triggerType: "scheduled" });

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
