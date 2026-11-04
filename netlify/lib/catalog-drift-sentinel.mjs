// Proactive catalog drift detection: compares what the database says (intended state) with what
// storage and review records actually hold, then applies only safe, idempotent repairs.
// It never invents readiness, unbinds audio, or advances publication; missing bytes are escalated.

export const DRIFT_DEFAULTS = Object.freeze({ limit: 12, budgetMilliseconds: 20_000, graceMinutes: 2 });

function errorMessage(error) {
  return error instanceof Error ? error.message : "unknown error";
}

export function storageDriftFingerprint(versionId) {
  return `catalog-drift:storage:${versionId}`;
}

// Rotates which bound versions are sampled each run so every master is eventually re-verified.
export function rotationSalt(now = new Date(), windowMinutes = 10) {
  return String(Math.floor(now.getTime() / (windowMinutes * 60_000)));
}

export async function verifyStoredAudio(row, { audioStore, storageConfig, inspectChunks, headObject }) {
  const prefix = String(row.audio_blob_prefix || "");
  const storageKey = String(row.audio_storage_key || "");
  const byteSize = Number(row.audio_byte_size) || 0;
  if (prefix) {
    const chunkCount = Number(row.audio_chunk_count) || 0;
    if (!chunkCount || !byteSize) return { state: "drift", kind: "chunk_metadata_missing", detail: "Bound chunked audio has no chunk count or byte size." };
    const status = await inspectChunks(audioStore, { prefix, chunkCount, byteSize });
    if (status.complete) return { state: "healthy", kind: "chunked" };
    return {
      state: "drift",
      kind: "chunks_incomplete",
      detail: `Stored ${status.storedBytes} of ${byteSize} bytes; missing parts ${status.missingChunks.join(", ") || "none"}, invalid parts ${status.invalidChunks.join(", ") || "none"}.`,
    };
  }
  if (storageKey) {
    if (!storageConfig) return { state: "unverifiable", kind: "direct_storage_unconfigured" };
    let stored;
    try {
      stored = await headObject(storageConfig, storageKey);
    } catch (error) {
      // An outage is not evidence of missing bytes; try again on a later run.
      return { state: "unverifiable", kind: "direct_storage_unreachable", detail: errorMessage(error) };
    }
    if (!stored) return { state: "drift", kind: "direct_object_missing", detail: "Master storage reports the object is missing." };
    if (byteSize && stored !== byteSize) return { state: "drift", kind: "direct_size_mismatch", detail: `Storage holds ${stored} bytes; catalog expects ${byteSize}.` };
    return { state: "healthy", kind: "direct" };
  }
  return { state: "drift", kind: "storage_reference_missing", detail: "Audio URL is bound but no storage reference is recorded." };
}

export async function auditCatalogDrift(db, {
  audioStore,
  storageConfig = null,
  inspectChunks,
  headObject,
  repairReview,
  report,
  resolve,
  issueKey,
  limit = DRIFT_DEFAULTS.limit,
  budgetMilliseconds = DRIFT_DEFAULTS.budgetMilliseconds,
  graceMinutes = DRIFT_DEFAULTS.graceMinutes,
  now = new Date(),
  clock = () => Date.now(),
} = {}) {
  const deadline = clock() + budgetMilliseconds;
  const summary = {
    reviews: { checked: 0, repaired: 0, failed: 0 },
    storage: { checked: 0, healthy: 0, drifted: 0, unverifiable: 0, alertsFailed: 0 },
    stoppedEarly: false,
    drifts: [],
  };

  // Drift 1: audio changed after the last Dream Weaver review, so readiness is stale.
  // The grace window avoids racing an upload whose finalize is still running the review.
  const staleReviews = await db.sql`
    SELECT song.id, song.owner_member_id
    FROM halo_song_catalog song
    WHERE song.status = 'active'
      AND EXISTS (
        SELECT 1 FROM halo_song_versions version
        WHERE version.song_id = song.id AND version.status = 'active'
          AND version.audio_url IS NOT NULL
          AND version.updated_at < NOW() - make_interval(mins => ${graceMinutes})
          AND (song.reviewed_at IS NULL OR version.updated_at > song.reviewed_at)
      )
    ORDER BY song.reviewed_at ASC NULLS FIRST
    LIMIT ${limit}
  `;
  for (const row of staleReviews) {
    if (clock() >= deadline) { summary.stoppedEarly = true; break; }
    summary.reviews.checked += 1;
    try {
      await repairReview(row.id, row.owner_member_id);
      summary.reviews.repaired += 1;
      summary.drifts.push({ type: "stale_review", songId: row.id, action: "review_rerun" });
    } catch (error) {
      summary.reviews.failed += 1;
      summary.drifts.push({ type: "stale_review", songId: row.id, action: "review_failed", detail: errorMessage(error) });
    }
  }

  // Drift 2: the catalog points at audio whose bytes are missing or wrong in storage.
  const bound = summary.stoppedEarly ? [] : await db.sql`
    SELECT version.id, version.song_id, version.version_type, version.audio_blob_prefix, version.audio_chunk_count,
      version.audio_byte_size, version.audio_storage_key, song.owner_member_id, song.title,
      COALESCE(sync.dreamweaver_status, 'pending') AS dreamweaver_status
    FROM halo_song_versions version
    JOIN halo_song_catalog song ON song.id = version.song_id
    LEFT JOIN halo_song_publication_sync sync ON sync.song_id = song.id
    WHERE song.status = 'active' AND version.status = 'active'
      AND version.audio_url LIKE '/api/song-catalog/audio%'
      AND version.updated_at < NOW() - make_interval(mins => ${graceMinutes})
    ORDER BY md5(version.id || ${rotationSalt(now)})
    LIMIT ${limit}
  `;
  for (const row of bound) {
    if (clock() >= deadline) { summary.stoppedEarly = true; break; }
    summary.storage.checked += 1;
    const fingerprint = storageDriftFingerprint(row.id);
    let verdict;
    try {
      verdict = await verifyStoredAudio(row, { audioStore, storageConfig, inspectChunks, headObject });
    } catch (error) {
      verdict = { state: "unverifiable", kind: "inspection_failed", detail: errorMessage(error) };
    }
    if (verdict.state === "unverifiable") { summary.storage.unverifiable += 1; continue; }
    try {
      if (verdict.state === "healthy") {
        summary.storage.healthy += 1;
        await resolve(issueKey(fingerprint), `Stored ${verdict.kind} audio re-verified for version ${row.id}.`, {
          source: "catalog-drift-sentinel",
          verification: { resultSummary: "Storage bytes match the catalog record.", source: "catalog-drift-sentinel" },
        });
        continue;
      }
      summary.storage.drifted += 1;
      const liveClaim = row.dreamweaver_status === "ready";
      summary.drifts.push({ type: "storage", songId: row.song_id, versionId: row.id, kind: verdict.kind, liveClaim });
      await report({
        source: "scheduled",
        category: "catalog-storage",
        severity: liveClaim ? "critical" : "high",
        title: `Catalog audio drift: ${String(row.title || "Untitled").slice(0, 120)} (${row.version_type})`,
        details: `${verdict.detail} Re-upload this version's audio in the Song Catalog. HALO did not unbind or alter the record.`,
        pagePath: "/song-catalog/",
        fingerprint,
        metadata: { songId: row.song_id, versionId: row.id, versionType: row.version_type, kind: verdict.kind, dreamweaverStatus: row.dreamweaver_status },
      });
    } catch (error) {
      summary.storage.alertsFailed += 1;
      console.warn("Catalog drift alert could not be recorded", errorMessage(error));
    }
  }
  return summary;
}
