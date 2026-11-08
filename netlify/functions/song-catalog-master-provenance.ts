import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { directUploadConfig } from "../lib/direct-upload-storage.mjs";
import { loadProvenanceKeys } from "../lib/master-provenance.mjs";
import { createMasterProvenanceHandler } from "../lib/master-provenance-api.mjs";

const audioStore = getStore({ name: "halo-song-catalog-audio", consistency: "strong" });

export default createMasterProvenanceHandler({
  getUser,
  getDatabase,
  ensureMembership,
  verifyRequestOrigin,
  loadProvenanceKeys: () => loadProvenanceKeys(),
  audioStore,
  storageConfig: () => directUploadConfig(),
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  randomUUID,
  now: () => new Date(),
  logError: (message: string) => console.error(message),
});

export const config = { path: "/api/song-catalog/master-provenance" };
