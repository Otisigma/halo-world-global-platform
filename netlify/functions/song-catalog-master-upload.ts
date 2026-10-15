import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import {
  MASTER_UPLOAD_MAX_BYTES,
  MASTER_UPLOAD_URL_TTL_SECONDS,
  buildMasterObjectKey,
  deleteStoredObject,
  directUploadConfig,
  headStoredObject,
  isOwnedMasterObjectKey,
  presignObjectUrl,
  validateMasterUpload,
} from "../lib/direct-upload-storage.mjs";
import { MASTER_VERSION_TYPE } from "../lib/master-copy.mjs";
import { runDreamweaverReview } from "./song-catalog.js";
import { completeMasterUpload, masterPartUrl, masterUploadStatus, restartMasterUpload } from "../lib/multipart-master-upload.mjs";
import { ensureUploadSession, resumableUploadId, uploadProtocol, requireUploadProtocol, saveUploadPhase, uploadSessionKey, uploadStatusFields, uploadWasReplaced, requireUploadGeneration, uploadReplacementToken } from "../lib/resumable-upload.mjs";

// Large master copies bypass Netlify function payload limits: this endpoint only exchanges small
// JSON metadata. `presign` issues a short-lived PUT URL the browser uploads to directly, and
// `register` records the verified object key on the song's canonical `sale_master` version.
const audioStore = getStore({ name: "halo-song-catalog-audio", consistency: "strong" });
const uploadSessions = getStore({ name: "halo-master-upload-sessions", consistency: "strong" });

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json({ ...body as object, ...uploadProtocol() }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanId(value: unknown) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

async function ownedMasterVersion(db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string, songId: string, versionId: string) {
  const rows = await db.sql`
    SELECT version.id, version.song_id, version.audio_blob_prefix, version.audio_storage_key
    FROM halo_song_versions version
    JOIN halo_song_catalog song ON song.id = version.song_id
    WHERE version.id = ${versionId} AND song.id = ${songId}
      AND version.version_type = ${MASTER_VERSION_TYPE}
      AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active' AND version.status = 'active'
    LIMIT 1
  `;
  return rows[0] || null;
}

async function presignMasterUpload(payload: Record<string, unknown>, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const storage = directUploadConfig();
  if (!storage) return json({ directUpload: false, message: "Direct master storage is not configured; use the standard upload." }, 503);
  const songId = cleanId(payload.songId);
  const versionId = cleanId(payload.versionId);
  if (!songId || !versionId) return json({ message: "A valid song and sale master version are required" }, 400);
  const upload = validateMasterUpload({ filename: payload.fileName, contentType: payload.fileType, fileSize: payload.fileSize });
  if (!upload.ok) return json({ message: upload.message, maxBytes: MASTER_UPLOAD_MAX_BYTES }, upload.status);
  if (!(await ownedMasterVersion(db, ownerMemberId, songId, versionId))) return json({ message: "That sale master version was not found" }, 404);
  const fileKey = buildMasterObjectKey({ ownerMemberId, songId, versionId, uploadId: randomUUID(), filename: upload.filename });
  const uploadUrl = presignObjectUrl({ config: storage, method: "PUT", key: fileKey, contentType: upload.contentType, expiresIn: MASTER_UPLOAD_URL_TTL_SECONDS });
  return json({
    directUpload: true,
    method: "PUT",
    uploadUrl,
    fileKey,
    contentType: upload.contentType,
    headers: { "Content-Type": upload.contentType },
    expiresIn: MASTER_UPLOAD_URL_TTL_SECONDS,
    maxBytes: MASTER_UPLOAD_MAX_BYTES,
  });
}

async function registerMasterUpload(payload: Record<string, unknown>, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string, resumablePrefix = "") {
  const storage = directUploadConfig();
  if (!storage) return json({ directUpload: false, message: "Direct master storage is not configured" }, 503);
  const songId = cleanId(payload.songId);
  const versionId = cleanId(payload.versionId);
  const fileKey = cleanText(payload.fileKey, 400);
  if (!songId || !versionId || !fileKey) return json({ message: "The uploaded master details are incomplete" }, 400);
  if (!isOwnedMasterObjectKey(fileKey, { ownerMemberId, songId, versionId })) return json({ message: "That master upload does not belong to this version" }, 403);
  const upload = validateMasterUpload({ filename: payload.originalName, contentType: payload.fileType, fileSize: payload.fileSize });
  if (!upload.ok) return json({ message: upload.message, maxBytes: MASTER_UPLOAD_MAX_BYTES }, upload.status);
  const version = await ownedMasterVersion(db, ownerMemberId, songId, versionId);
  if (!version) return json({ message: "That sale master version was not found" }, 404);
  const prefix = resumablePrefix || `${ownerMemberId}/${versionId}/direct/${fileKey}/`;
  let session = await ensureUploadSession(uploadSessions, prefix, {
    byteSize: upload.byteSize, filename: upload.filename, contentType: upload.contentType,
  }, async () => ({ key: fileKey }));
  requireUploadGeneration(session, payload.generation);
  if (session.key !== fileKey) return json({ message: "This completion belongs to an older upload attempt." }, 409);
  const alreadyRegistered = version.audio_storage_key === fileKey;
  if (uploadWasReplaced(session, version, alreadyRegistered)) {
    return json({ message: "This upload was replaced by another file.", resetReason: "upload_replaced" }, 409);
  }
  if (["registered", "review_pending"].includes(session.phase)) {
    if (!alreadyRegistered) return json({ message: "This upload was replaced by another file.", resetReason: "upload_replaced" }, 409);
    return json(session.result);
  }
  const storedBytes = await headStoredObject(storage, fileKey);
  if (!storedBytes) return json({ message: "The master file was not found in storage. Upload it again." }, 409);
  if (storedBytes !== upload.byteSize || storedBytes > MASTER_UPLOAD_MAX_BYTES) {
    await deleteStoredObject(storage, fileKey).catch(() => undefined);
    return json({ message: "The stored master file size does not match the upload. Upload it again." }, 409);
  }

  const durationSeconds = Math.max(0, Math.min(86_400, Math.round(Number(payload.durationSeconds) || 0)));
  const audioUrl = `/api/song-catalog/audio?versionId=${encodeURIComponent(versionId)}`;
  session = await saveUploadPhase(uploadSessions, prefix, session, "completing", null, {
    catalogBefore: session.catalogBefore || { blobPrefix: String(version.audio_blob_prefix || ""), storageKey: String(version.audio_storage_key || "") },
  });
  if (!alreadyRegistered) {
    const updated = await db.sql`
    UPDATE halo_song_versions
    SET audio_url = ${audioUrl}, audio_storage_key = ${fileKey}, audio_blob_prefix = '', audio_chunk_count = 0,
      audio_content_type = ${upload.contentType}, audio_byte_size = ${storedBytes}, audio_filename = ${upload.filename},
      duration_seconds = CASE WHEN ${durationSeconds} > 0 THEN ${durationSeconds} ELSE duration_seconds END,
      updated_at = NOW()
    WHERE id = ${versionId} AND song_id = ${songId}
      AND COALESCE(audio_blob_prefix, '') = ${String(version.audio_blob_prefix || "")}
      AND COALESCE(audio_storage_key, '') = ${String(version.audio_storage_key || "")}
    RETURNING id
  `;
    if (!updated.length) return json({ message: "Another upload replaced this version. Check status before retrying." }, 409);
  }
  let result = {
    message: "Master copy uploaded directly to storage and registered as the canonical sale master.",
    songId, versionId, audioUrl, storage: "direct", persisted: true, lockedIn: true,
    confirmedAt: new Date().toISOString(), phase: "review_pending", ...uploadProtocol(),
  };
  session = await saveUploadPhase(uploadSessions, prefix, session, "review_pending", result);
  try {
    await runDreamweaverReview(songId, ownerMemberId);
    const reviewed = { ...result, phase: "registered" };
    await saveUploadPhase(uploadSessions, prefix, session, "registered", reviewed);
    result = reviewed;
  } catch {
    // A review outage must not turn a persisted master into a failed transfer.
  }
  if (version.audio_storage_key && version.audio_storage_key !== fileKey) await deleteStoredObject(storage, String(version.audio_storage_key)).catch(() => undefined);
  if (version.audio_blob_prefix) {
    const stored = await audioStore.list({ prefix: String(version.audio_blob_prefix) }).catch(() => ({ blobs: [] }));
    await Promise.all(stored.blobs.map(blob => audioStore.delete(blob.key))).catch(() => undefined);
  }
  return json(result);
}

async function resumableMasterUpload(payload: Record<string, unknown>, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const storage = directUploadConfig();
  if (!storage) return json({ directUpload: false, message: "Direct master storage is not configured; use the standard upload." }, 503);
  const songId = cleanId(payload.songId);
  const versionId = cleanId(payload.versionId);
  const uploadId = resumableUploadId(payload.uploadId);
  if (!songId || !versionId || !uploadId) return json({ message: "The resumable master details are invalid" }, 400);
  const upload = validateMasterUpload({ filename: payload.fileName, contentType: payload.fileType, fileSize: payload.fileSize });
  if (!upload.ok) return json({ message: upload.message }, upload.status);
  const version = await ownedMasterVersion(db, ownerMemberId, songId, versionId);
  if (!version) return json({ message: "That sale master version was not found" }, 404);
  const prefix = `${ownerMemberId}/${versionId}/${uploadId}/`;
  const options = { store: uploadSessions, prefix, storage };
  let session = await uploadSessions.get(uploadSessionKey(prefix), { type: "json" });
  if (session && (session.byteSize !== upload.byteSize || session.filename !== upload.filename || session.contentType !== upload.contentType)) {
    return json({ message: "The master upload metadata does not match this session." }, 409);
  }
  if (payload.action === "restart") {
    if (!session || !uploadWasReplaced(session, version, version.audio_storage_key === session.key)) {
      return json({ message: "Only a replaced upload can be restarted explicitly." }, 409);
    }
    if (payload.expectedReplacement !== uploadReplacementToken(version)) {
      return json({ message: "The current audio changed. Check status and confirm the replacement again." }, 409);
    }
    const restarted = await restartMasterUpload({ ...options, scope: { ownerMemberId, songId, versionId }, uploadId, upload,
      expectedGeneration: payload.expectedGeneration,
      catalogBefore: { blobPrefix: String(version.audio_blob_prefix || ""), storageKey: String(version.audio_storage_key || "") } });
    return json({ directUpload: true, ...uploadStatusFields(restarted, 0) });
  }
  if (session && payload.action !== "status") requireUploadGeneration(session, payload.generation);
  if (session && uploadWasReplaced(session, version, version.audio_storage_key === session.key)) {
    return json({ ...uploadStatusFields(session, 0), result: null, message: "This upload was replaced by another file.",
      resetReason: "upload_replaced", replacementToken: uploadReplacementToken(version) }, 409);
  }
  if (session && version.audio_storage_key === session.key) {
    if (!session.result) {
      const result = { songId, versionId, audioUrl: `/api/song-catalog/audio?versionId=${encodeURIComponent(versionId)}`,
        storage: "direct", persisted: true, lockedIn: true, phase: "review_pending", confirmedAt: new Date().toISOString(), ...uploadProtocol() };
      session = await saveUploadPhase(uploadSessions, prefix, session, "review_pending", result);
    }
    if (payload.action === "status") return json({ directUpload: true, ...uploadStatusFields(session, session.byteSize) });
    if (payload.action === "complete") return json(session.result);
  }
  if (payload.action === "status") {
    const status = await masterUploadStatus({ ...options, scope: { ownerMemberId, songId, versionId }, uploadId, upload });
    return json({ directUpload: true, ...uploadStatusFields(status.session, status.uploadedBytes) });
  }
  if (payload.action === "part") {
    return json(await masterPartUrl({ ...options, generation: payload.generation, start: typeof payload.startByte === "number" ? payload.startByte : NaN }));
  }
  const fileKey = await completeMasterUpload({ ...options, upload, generation: payload.generation });
  return await registerMasterUpload({ ...payload, fileKey, originalName: upload.filename }, db, ownerMemberId, prefix);
}

export default async function songCatalogMasterUploadHandler(request: Request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405, { Allow: "POST" });
  try {
    requireUploadProtocol(request);
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Join or sign in to upload a master copy" }, 401);
    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin master uploads are not accepted" }, 403); }
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload) return json({ message: "Choose a supported master upload action" }, 400);
    const membership = await ensureMembership(db, user);
    if (["status", "part", "complete", "restart"].includes(String(payload.action))) return await resumableMasterUpload(payload, db, membership.member_id);
    if (payload.action === "presign") return await presignMasterUpload(payload, db, membership.member_id);
    if (payload.action === "register") return await registerMasterUpload(payload, db, membership.member_id);
    return json({ message: "Choose a supported master upload action" }, 400);
  } catch (error) {
    if (error instanceof Error && "status" in error) return json({ message: error.message,
      storageCode: "storageCode" in error ? error.storageCode : undefined,
      storageStatus: "storageStatus" in error ? error.storageStatus : undefined }, Number(error.status));
    console.error("Master upload failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Master uploads are temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/song-catalog/master-upload" };
