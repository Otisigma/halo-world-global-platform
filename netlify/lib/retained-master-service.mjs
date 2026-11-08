import { createHash, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { directUploadConfig, presignObjectUrl, MASTER_PLAYBACK_URL_TTL_SECONDS } from "./direct-upload-storage.mjs";
import { describeMasterSource, readObservedMaster } from "./master-provenance-observation.mjs";
import { retainedMasterConfig, loadSnapshotKeys, loadPublicSnapshotKeys, retainMasterBytes, signSnapshot, verifySnapshot,
  snapshotStorageCommitment, checkRetainedSnapshot, SNAPSHOT_LIMITATION } from "./retained-master.mjs";

export async function ownedSnapshotVersion(db, owner, songId, versionId) {
  const rows = await db.sql`
    SELECT v.audio_storage_key, v.audio_blob_prefix, v.audio_chunk_count, v.audio_byte_size
    FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
    WHERE s.id = ${songId} AND v.id = ${versionId} AND s.owner_member_id = ${owner}
      AND s.status = 'active' AND v.status = 'active' AND v.version_type = 'sale_master' LIMIT 1
  `;
  return rows[0] || null;
}

export function authenticatedSnapshot(row, keys, config) {
  const envelope = { record: row.record, signature: row.signature };
  if (!verifySnapshot(envelope, keys) || row.record.recordId !== row.id || row.record.songId !== row.song_id
    || row.record.versionId !== row.version_id
    || snapshotStorageCommitment(config.storage, row.storage_key, row.storage_version_id) !== row.record.storageCommitment) {
    throw Object.assign(new Error("Retained snapshot record failed authentication"), { code: "record_invalid" });
  }
  return envelope;
}

export async function captureRegisteredMaster({ db, owner, songId, versionId, parentRecordId = "", relationship = "original",
  config, keys, blobStore, sourceStorage, fetchImpl = fetch, uuid = randomUUID, now = () => new Date() }) {
  const row = await ownedSnapshotVersion(db, owner, songId, versionId);
  if (!row) return { state: "not_eligible", message: "No active sale master is available for retained capture." };
  const source = describeMasterSource(row, owner, songId, versionId);
  if ((parentRecordId === "") !== (relationship === "original") || !["original", "revision", "remix", "edit"].includes(relationship)) {
    throw new Error("Invalid snapshot lineage relationship");
  }
  if (parentRecordId) {
    const parents = await db.sql`
      SELECT * FROM halo_retained_master_snapshots WHERE id = ${parentRecordId}
        AND owner_member_id = ${owner} AND status = 'ready' LIMIT 1
    `;
    if (!parents[0]) throw new Error("Parent snapshot is not available to this owner");
    authenticatedSnapshot(parents[0], keys, config);
  }
  const captureSourceId = parentRecordId
    ? createHash("sha256").update(JSON.stringify([source.id, parentRecordId, relationship])).digest("hex") : source.id;
  const id = uuid(), attempt = uuid();
  const claimed = await db.sql`
    INSERT INTO halo_retained_master_snapshots
      (id, owner_member_id, song_id, version_id, source_id, status, attempt_id, lease_until, parent_record_id, relationship)
    VALUES (${id}, ${owner}, ${songId}, ${versionId}, ${captureSourceId}, 'pending', ${attempt},
      NOW() + INTERVAL '5 minutes', ${parentRecordId}, ${relationship})
    ON CONFLICT (owner_member_id, song_id, version_id, source_id) DO UPDATE
      SET status = 'pending', attempt_id = EXCLUDED.attempt_id, lease_until = EXCLUDED.lease_until, updated_at = NOW()
      WHERE halo_retained_master_snapshots.status = 'failed'
        OR (halo_retained_master_snapshots.status = 'pending' AND halo_retained_master_snapshots.lease_until < NOW())
    RETURNING *
  `;
  if (!claimed[0]) {
    const existing = await db.sql`
      SELECT * FROM halo_retained_master_snapshots
      WHERE owner_member_id = ${owner} AND song_id = ${songId} AND version_id = ${versionId}
        AND source_id = ${captureSourceId} LIMIT 1
    `;
    if (existing[0]?.status === "ready") {
      const envelope = authenticatedSnapshot(existing[0], keys, config);
      return { state: "ready", recordId: envelope.record.recordId, alreadyCaptured: true, limitation: SNAPSHOT_LIMITATION };
    }
    return { state: "pending", message: "Snapshot capture is in progress. Retry after its lease expires if interrupted." };
  }
  const job = claimed[0];
  try {
    const permitted = await db.sql`
      INSERT INTO halo_master_provenance_read_limits (owner_member_id, last_started) VALUES (${owner}, NOW())
      ON CONFLICT (owner_member_id) DO UPDATE SET last_started = NOW()
      WHERE halo_master_provenance_read_limits.last_started <= NOW() - INTERVAL '1 minute'
      RETURNING owner_member_id
    `;
    if (!permitted.length) {
      await db.sql`UPDATE halo_retained_master_snapshots SET status = 'failed', updated_at = NOW()
        WHERE id = ${job.id} AND attempt_id = ${attempt} AND status = 'pending'`;
      return { state: "rate_limited", message: "Wait one minute before another master read." };
    }
    const createdAt = now();
    const key = `snapshots/${job.id}/${attempt}.bin`;
    const bytes = readObservedMaster(source, { blobStore, storage: sourceStorage, fetchImpl });
    const retained = await retainMasterBytes({ config, key, bytes, expectedBytes: source.size, now: createdAt, fetchImpl });
    const envelope = signSnapshot({
      schemaVersion: 1, recordId: job.id, songId, versionId, keyId: keys.keyId,
      sha256: retained.sha256, byteSize: retained.byteSize, createdAt: createdAt.toISOString(),
      retainUntil: retained.retainUntil, storageCommitment: retained.storageCommitment,
      sourceType: source.type, sourceConsistency: "mutable_read",
      parentRecordId: job.parent_record_id, relationship: job.relationship,
    }, keys);
    const saved = await db.sql`
      UPDATE halo_retained_master_snapshots SET status = 'ready', storage_key = ${retained.key},
        storage_version_id = ${retained.versionId}, record = ${JSON.stringify(envelope.record)}::jsonb,
        signature = ${envelope.signature}, updated_at = NOW()
      WHERE id = ${job.id} AND attempt_id = ${attempt} AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
          WHERE s.id = ${songId} AND v.id = ${versionId} AND s.owner_member_id = ${owner}
            AND s.status = 'active' AND v.status = 'active' AND v.version_type = 'sale_master'
            AND COALESCE(v.audio_storage_key, '') = ${String(row.audio_storage_key || "")}
            AND COALESCE(v.audio_blob_prefix, '') = ${String(row.audio_blob_prefix || "")}
            AND COALESCE(v.audio_chunk_count, 0) = ${Number(row.audio_chunk_count || 0)}
            AND v.audio_byte_size = ${source.size}
        ) RETURNING id
    `;
    if (!saved.length) throw new Error("Master registration changed or capture lease was superseded");
    return { state: "ready", recordId: job.id, limitation: SNAPSHOT_LIMITATION };
  } catch (error) {
    await db.sql`
      UPDATE halo_retained_master_snapshots SET status = 'failed', updated_at = NOW()
      WHERE id = ${job.id} AND attempt_id = ${attempt} AND status = 'pending'
    `;
    throw error;
  }
}

export async function verifyRetainedRow(row, config, keys, fetchImpl = fetch) {
  const envelope = authenticatedSnapshot(row, keys, config);
  const digest = await checkRetainedSnapshot({ config, key: row.storage_key, versionId: row.storage_version_id,
    byteSize: row.record.byteSize, retainUntil: row.record.retainUntil, fetchImpl });
  return { result: digest.sha256 === row.record.sha256 ? "retained_bytes_match" : "retained_bytes_differ",
    recordId: row.id, limitation: SNAPSHOT_LIMITATION };
}

export function pinnedSnapshotPlayback(row, config, keys, method = "GET") {
  const envelope = authenticatedSnapshot(row, keys, config);
  if (Date.parse(envelope.record.retainUntil) <= Date.now()) throw new Error("Recorded snapshot retention has expired");
  return presignObjectUrl({ config: config.storage, key: row.storage_key,
    method: method === "HEAD" ? "HEAD" : "GET", queryParams: { versionId: row.storage_version_id },
    expiresIn: Math.min(MASTER_PLAYBACK_URL_TTL_SECONDS, Math.floor((Date.parse(envelope.record.retainUntil) - Date.now()) / 1000)) });
}

// Call only after the normal catalog/Dreamweaver authorization has resolved this version.
export async function retainedMasterPlayback(db, authorizedVersionId, authorizedOwnerId, method, env = process.env) {
  if (env.HALO_RETAINED_MASTER_PLAYBACK !== "true") return null;
  const versions = await db.sql`
    SELECT v.audio_storage_key, v.audio_blob_prefix, v.audio_chunk_count, v.audio_byte_size,
      v.song_id, v.version_type, s.owner_member_id FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
    WHERE v.id = ${authorizedVersionId} AND v.status = 'active' AND s.status = 'active'
      AND s.owner_member_id = ${authorizedOwnerId} LIMIT 1
  `;
  if (!versions[0]) throw new Error("Authorized master registration is no longer available");
  const version = versions[0];
  if (version.version_type !== "sale_master") return null;
  const config = retainedMasterConfig(env);
  if (!config) throw new Error("Retained master playback is enabled without retained storage");
  const source = describeMasterSource(version, version.owner_member_id, version.song_id, authorizedVersionId);
  const records = await db.sql`
    SELECT * FROM halo_retained_master_snapshots WHERE owner_member_id = ${version.owner_member_id}
      AND song_id = ${version.song_id} AND version_id = ${authorizedVersionId}
      AND source_id = ${source.id} AND status = 'ready' LIMIT 1
  `;
  if (!records[0]) throw new Error("The finalized master snapshot is not ready; mutable playback is disabled");
  return pinnedSnapshotPlayback(records[0], config, loadPublicSnapshotKeys(env), method);
}

export async function safeCaptureRegisteredMaster(db, owner, songId, versionId) {
  try {
    const config = retainedMasterConfig();
    if (!config) return { state: "disabled", message: "Retained snapshot capture is not enabled. Upload storage remains mutable." };
    const keys = loadSnapshotKeys();
    return await captureRegisteredMaster({ db, owner, songId, versionId, config, keys,
      blobStore: getStore({ name: "halo-song-catalog-audio", consistency: "strong" }), sourceStorage: directUploadConfig() });
  } catch {
    console.error(JSON.stringify({ event: "retained_master_capture_failed" }));
    return { state: "failed", message: "Audio upload succeeded, but retained snapshot capture failed. Retry from the verification workspace; no retained stamp was confirmed." };
  }
}
