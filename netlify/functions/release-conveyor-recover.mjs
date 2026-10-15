import { getDatabase } from "@netlify/database";
import { recoverCatalogReleases } from "../lib/release-conveyor-service.mjs";
import { prepareReleaseAudio } from "../lib/release-conveyor-audio.mjs";
import { auditHaloInfrastructure, auditHaloAssets } from "../lib/halo-watchdog.mjs";

export default async function releaseConveyorRecover() {
  const infrastructure = await auditHaloInfrastructure(process.env.URL);
  const result = await recoverCatalogReleases(await getDatabase(), prepareReleaseAudio, 10, {
    infrastructure, assetAuditor: submission => auditHaloAssets(submission, process.env.URL),
  });
  console.log("HALO watchdog pulse", { ...result, infrastructure });
  return new Response(null, { status: 204 });
}

export const config = { schedule: "*/5 * * * *" };
