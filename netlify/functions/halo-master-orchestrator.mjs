import { getDatabase } from "@netlify/database";
import { runHaloMasterPulse } from "../lib/halo-master-orchestrator.mjs";

export default async function haloMasterOrchestrator() {
  await runHaloMasterPulse(await getDatabase());
  return new Response(null, { status: 204 });
}

export const config = { schedule: "*/15 * * * *" };
