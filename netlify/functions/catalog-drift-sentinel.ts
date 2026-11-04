import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { inspectAudioUpload } from "../lib/chunked-audio-upload.mjs";
import { directUploadConfig, headStoredObject } from "../lib/direct-upload-storage.mjs";
import { auditCatalogDrift } from "../lib/catalog-drift-sentinel.mjs";
import { issueKeyForFingerprint, reportIssue, resolveIssue } from "../lib/maintenance.mjs";
import { recordScheduledHeartbeat } from "../lib/scheduled-heartbeats.mjs";
import { runDreamweaverReview } from "./song-catalog.js";

export default async function catalogDriftSentinel() {
  const db = await getDatabase();
  try {
    const summary = await auditCatalogDrift(db, {
      audioStore: getStore({ name: "halo-song-catalog-audio", consistency: "strong" }),
      storageConfig: directUploadConfig(),
      inspectChunks: inspectAudioUpload,
      headObject: headStoredObject,
      repairReview: runDreamweaverReview,
      report: reportIssue,
      resolve: resolveIssue,
      issueKey: issueKeyForFingerprint,
    });
    const healthy = summary.reviews.failed === 0 && summary.storage.alertsFailed === 0;
    await recordScheduledHeartbeat(db, "catalog-drift-sentinel", healthy ? "success" : "failure", {
      reviews: summary.reviews, storage: summary.storage, stoppedEarly: summary.stoppedEarly, driftCount: summary.drifts.length,
    });
    console.log("HALO catalog drift sentinel", { reviews: summary.reviews, storage: summary.storage, stoppedEarly: summary.stoppedEarly });
  } catch (error) {
    await recordScheduledHeartbeat(db, "catalog-drift-sentinel", "failure", { error: error instanceof Error ? error.message : "unknown error" }).catch(() => undefined);
    throw error;
  }
  return new Response(null, { status: 204 });
}

export const config = { schedule: "*/10 * * * *" };
