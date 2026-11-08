import { randomUUID } from "node:crypto";
import { MASTER_UPLOAD_MAX_BYTES, directUploadConfig } from "./direct-upload-storage.mjs";
import { loadProvenanceKeys, sealMasterBytes, sealObservedDigest, verifyProvenanceRecord } from "./master-provenance.mjs";
import { describeMasterSource, readObservedMaster } from "./master-provenance-observation.mjs";
import { safeCaptureRegisteredMaster } from "./retained-master-service.mjs";
import { provenanceFailure } from "./master-provenance-errors.mjs";

export async function recordMasterObservation(db, owner, songId, versionId, row, source, keyring, deps) {
  const fields = { schemaVersion: 1, byteSize: source.size,
    ownerId: owner, songId, versionId, sourceType: source.type, sourceId: source.id,
    createdAt: deps.now().toISOString() };
  let seal;
  if (deps.observedDigest) {
    if (deps.observedDigest.sourceId !== source.id || deps.observedDigest.byteSize !== source.size) {
      return { result: "stale", message: "Master changed before its byte observation could be recorded." };
    }
    seal = sealObservedDigest({ ...fields, sha256: deps.observedDigest.sha256,
      createdAt: deps.observedDigest.createdAt }, keyring);
  } else {
    const bytes = readObservedMaster(source, { blobStore: deps.audioStore, storage: deps.storageConfig(), fetchImpl: deps.fetchImpl });
    seal = await sealMasterBytes({ ...fields, bytes, expectedBytes: source.size, maxBytes: MASTER_UPLOAD_MAX_BYTES, keyring });
  }
  const id = deps.randomUUID();
  // Commit only if ownership and the registered source still match the bytes read.
  const inserted = await db.sql`
    INSERT INTO halo_master_provenance_observations (id, owner_member_id, song_id, version_id, record, mac)
    SELECT ${id}, ${owner}, ${songId}, ${versionId}, ${JSON.stringify(seal.record)}::jsonb, ${seal.mac}
    FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
    WHERE s.id = ${songId} AND v.id = ${versionId} AND s.owner_member_id = ${owner}
      AND s.status = 'active' AND v.status = 'active' AND v.version_type = 'sale_master'
      AND COALESCE(v.audio_storage_key, '') = ${String(row.audio_storage_key || "")}
      AND COALESCE(v.audio_blob_prefix, '') = ${String(row.audio_blob_prefix || "")}
      AND COALESCE(v.audio_chunk_count, 0) = ${Number(row.audio_chunk_count || 0)}
      AND v.audio_byte_size = ${source.size}
    RETURNING id
  `;
  if (!inserted.length) return { result: "stale", message: "Master changed before its byte observation could be recorded." };
  return { observationId: id, result: "observed", sha256: seal.record.sha256, byteSize: source.size,
    createdAt: seal.record.createdAt, message: "Master byte observation recorded automatically." };
}

export async function safeObserveUploadedMaster(db, owner, songId, versionId, audioStore, overrides = {}) {
  const deps = { audioStore, storageConfig: directUploadConfig, fetchImpl: fetch,
    loadProvenanceKeys, randomUUID, now: () => new Date(), logError: message => console.error(message), ...overrides };
  try {
    const rows = await db.sql`
      SELECT v.audio_storage_key, v.audio_blob_prefix, v.audio_chunk_count, v.audio_byte_size
      FROM halo_song_versions v JOIN halo_song_catalog s ON s.id = v.song_id
      WHERE s.id = ${songId} AND v.id = ${versionId} AND s.owner_member_id = ${owner}
        AND s.status = 'active' AND v.status = 'active' AND v.version_type = 'sale_master'
      LIMIT 1
    `;
    if (!rows[0]) return { result: "not_applicable", message: "Automatic master observations apply to active sale masters only." };
    const row = rows[0];
    const source = describeMasterSource(row, owner, songId, versionId);
    const keyring = deps.loadProvenanceKeys();
    // Lost-response retries reuse an authenticated observation for this registered source.
    const existing = await db.sql`
      SELECT id, record, mac FROM halo_master_provenance_observations
      WHERE owner_member_id = ${owner} AND song_id = ${songId} AND version_id = ${versionId}
        AND record->>'sourceId' = ${source.id}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    const previous = existing[0];
    if (previous && verifyProvenanceRecord(previous, keyring) && previous.record.ownerId === owner
      && previous.record.songId === songId && previous.record.versionId === versionId
      && previous.record.sourceId === source.id && previous.record.byteSize === source.size) {
      return { result: "observed", observationId: String(previous.id), reused: true,
        message: "Registered master's existing byte observation is available." };
    }
    if (deps.observedDigest) return await recordMasterObservation(db, owner, songId, versionId, row, source, keyring, deps);
    const permitted = await db.sql`
      INSERT INTO halo_master_provenance_read_limits (owner_member_id, last_started) VALUES (${owner}, NOW())
      ON CONFLICT (owner_member_id) DO UPDATE SET last_started = NOW()
      WHERE halo_master_provenance_read_limits.last_started <= NOW() - INTERVAL '1 minute'
      RETURNING owner_member_id
    `;
    if (!permitted.length) return { result: "rate_limited",
      message: "Master saved; automatic byte observation was rate-limited. Wait a minute, then use Record observation in the master panel." };
    return await recordMasterObservation(db, owner, songId, versionId, row, source, keyring, deps);
  } catch (error) {
    deps.logError(JSON.stringify({ event: "master_upload_observation_failed" }));
    const failure = provenanceFailure(error);
    return { result: "unavailable", ...failure };
  }
}

export async function processUploadedMaster(db, owner, songId, versionId, audioStore) {
  let observation;
  // Share the retained pipeline's authenticated digest rather than reading the master twice.
  const provenance = await safeCaptureRegisteredMaster(db, owner, songId, versionId, async observedDigest => {
    observation = await safeObserveUploadedMaster(db, owner, songId, versionId, audioStore, { observedDigest });
  });
  if (!observation) observation = await safeObserveUploadedMaster(db, owner, songId, versionId, audioStore);
  return { provenance, observation };
}
