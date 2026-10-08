import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createReleaseConveyorHandler } from "../lib/release-conveyor-http.mjs";
import { prepareReleaseAudio, downloadReleaseAudio } from "../lib/release-conveyor-audio.mjs";

export default createReleaseConveyorHandler({
  getDatabase, getUser, verifyRequestOrigin, ensureMembership,
  prepareAudio: prepareReleaseAudio, downloadAudio: downloadReleaseAudio,
});

export const config = { path: "/api/release-conveyor" };
