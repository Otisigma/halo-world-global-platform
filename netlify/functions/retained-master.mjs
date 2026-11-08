import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { directUploadConfig } from "../lib/direct-upload-storage.mjs";
import { retainedMasterConfig, loadSnapshotKeys, loadPublicSnapshotKeys } from "../lib/retained-master.mjs";
import { createRetainedMasterHandler } from "../lib/retained-master-api.mjs";

export default createRetainedMasterHandler({
  database: getDatabase, user: getUser, membership: ensureMembership, origin: verifyRequestOrigin,
  config: retainedMasterConfig, signingKeys: loadSnapshotKeys, publicKeys: loadPublicSnapshotKeys,
  sourceStorage: directUploadConfig,
  blobStore: () => getStore({ name: "halo-song-catalog-audio", consistency: "strong" }),
  fetch: (...args) => fetch(...args), log: message => console.error(message),
});
export const config = { path: "/api/master-snapshots" };
