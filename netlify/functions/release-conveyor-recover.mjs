import { getDatabase } from "@netlify/database";
import { recoverCatalogReleases } from "../lib/release-conveyor-service.mjs";
import { prepareReleaseAudio } from "../lib/release-conveyor-audio.mjs";

export default async function releaseConveyorRecover() {
  await recoverCatalogReleases(await getDatabase(), prepareReleaseAudio);
  return new Response(null, { status: 204 });
}

export const config = { schedule: "*/15 * * * *" };
