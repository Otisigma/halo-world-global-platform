import { getDatabase } from "@netlify/database";
import { runCampaignWorker } from "../lib/master-campaigns.mjs";

export default async function masterCampaignWorker() {
  const result = await runCampaignWorker(await getDatabase());
  console.log("Master campaign worker", { scanned: result.scanned });
}
export const config = { schedule: "* * * * *" };
