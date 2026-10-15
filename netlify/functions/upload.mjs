import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { uploadProtocol, requireUploadProtocol } from "../lib/resumable-upload.mjs";
import {
  DRIVE_MASTER_MAX_BYTES,
  DRIVE_UPLOAD_CHUNK_BYTES,
  cleanSongId,
  createResumableUploadSession,
  findOwnedSaleMaster,
  googleDriveConfig,
  validateDriveMasterUpload,
  driveSessionStore,
  driveSessionKey,
  saveDriveSession,
  getDriveFile,
  verifyDriveMasterFile,
  driveReviewResult,
} from "../lib/google-drive.mjs";

// Opens a Google Drive resumable upload session for a song's sale master.
// Only small JSON metadata passes through this function; the browser streams the file to
// the returned `uploadUrl` in 5 MB chunks (see /public/js/chunkedUploader.js).
function json(body, status = 200) {
  return Response.json({ ...body, ...uploadProtocol() }, { status, headers: { "Cache-Control": "no-store" } });
}

function browserOrigin(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin") || "";
  return origin && origin === requestOrigin ? origin : requestOrigin;
}

export default async function uploadHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  try {
    requireUploadProtocol(request);
    const drive = googleDriveConfig();
    if (!drive) return json({ driveUpload: false, message: "Google Drive master uploads are not configured" }, 503);
    const user = await getUser();
    if (!user?.id) return json({ message: "Join or sign in to upload a master copy" }, 401);
    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin master uploads are not accepted" }, 403); }
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") return json({ message: "Send the master upload details as JSON" }, 400);
    const upload = validateDriveMasterUpload({ fileName: payload.fileName, fileType: payload.fileType, fileSize: payload.fileSize });
    if (!upload.ok) return json({ message: upload.message, maxBytes: DRIVE_MASTER_MAX_BYTES }, upload.status);
    const songId = cleanSongId(payload.songId);
    if (!songId) return json({ message: "songId is required" }, 400);
    const protocolVersion = payload.protocolVersion;
    if (protocolVersion != null && protocolVersion !== 2) return json({ message: "Unsupported Drive upload protocol" }, 409);
    const uploadId = String(payload.uploadId || "");
    if (protocolVersion === 2 && !/^[a-f0-9]{64}$/.test(uploadId)) return json({ message: "A content-derived uploadId is required" }, 400);
    const db = await getDatabase();
    const membership = await ensureMembership(db, user);
    const store = protocolVersion === 2 ? driveSessionStore() : null;
    const key = store ? driveSessionKey(membership.member_id, songId, uploadId) : "";
    let saved = store ? await store.get(key, { type: "json" }) : null;
    if (saved) {
      if (saved.fileSize !== upload.byteSize || saved.fileName !== upload.fileName || saved.contentType !== upload.contentType || saved.origin !== browserOrigin(request)) return json({ message: "The saved upload belongs to different file details or origin" }, 409);
      if (payload.versionId && String(payload.versionId) !== String(saved.versionId)) return json({ message: "The saved upload target version does not match" }, 409);
      if (saved.phase === "registered") {
        const canonical = await findOwnedSaleMaster(db, membership.member_id, songId);
        if (!canonical || String(canonical.id) !== String(saved.versionId) || canonical.drive_file_id !== saved.fileId) {
          saved = await saveDriveSession(store, key, { phase: "review_pending", registeredResult: driveReviewResult(saved) }, { generation: saved.generation || 0, fileId: saved.fileId });
        }
      }
      if (payload.action === "renew") {
        if (!Number.isSafeInteger(payload.generation) || payload.generation < 0 || !["expired_404", "expired_410"].includes(payload.resetReason)) return json({ message: "Send the expired session generation and reset reason" }, 400);
        // Check the durable record again before opening a replacement; another retry may
        // already have renewed or registered this upload.
        const current = await store.getWithMetadata(key, { type: "json" });
        if (!current) return json({ message: "The saved Drive upload session was not found" }, 404);
        if (!current.etag) throw new Error("The Drive session could not be renewed safely without its durable revision");
        saved = current.data;
        if (payload.generation === (saved.generation || 0) && saved.phase === "transferring") {
          const file = await getDriveFile(drive, saved.fileId);
          if (file && Number(file.size) === saved.fileSize) {
            const verified = verifyDriveMasterFile(file, { folderId: drive.folderId, ownerMemberId: membership.member_id, songId, byteSize: saved.fileSize, versionId: saved.versionId, uploadId, fileId: saved.fileId });
            if (!verified.ok) return json({ message: verified.message }, verified.status);
            saved = await saveDriveSession(store, key, { phase: "completing", confirmedOffset: saved.fileSize }, { generation: saved.generation || 0, fileId: saved.fileId });
          } else {
            const replacement = await createResumableUploadSession(drive, {
              fileName: saved.fileName, contentType: saved.contentType, byteSize: saved.fileSize,
              origin: saved.origin, description: "HALO sale master · resumed after session expiry",
              appProperties: { haloOwnerMemberId: membership.member_id, haloSongId: songId, haloVersionId: String(saved.versionId), haloUploadId: uploadId },
            });
            const renewed = { ...saved, ...replacement, confirmedOffset: 0, generation: (saved.generation || 0) + 1, resetReason: payload.resetReason, resetAt: new Date().toISOString() };
            let result;
            try { result = await store.setJSON(key, renewed, { onlyIfMatch: current.etag }); }
            catch (error) {
              saved = await store.get(key, { type: "json" });
              if (saved?.generation !== renewed.generation || saved?.fileId !== renewed.fileId || saved?.uploadUrl !== renewed.uploadUrl) throw error;
            }
            saved = await store.get(key, { type: "json" });
            if (!saved) throw new Error("The renewed Drive session could not be read");
            if (saved.generation === renewed.generation && saved.fileId === renewed.fileId && saved.uploadUrl === renewed.uploadUrl && saved.confirmedOffset === 0 && saved.resetReason === renewed.resetReason) return json({ ...saved, resumed: false });
            if (result?.modified && (saved.generation || 0) === (current.data.generation || 0)) throw new Error("The renewed Drive session could not be confirmed. Retry the saved upload.");
          }
        }
        return json({ ...saved, resumed: true });
      }
      if (payload.action === "checkpoint") {
        const generation = payload.generation == null ? 0 : payload.generation;
        if (generation !== (saved.generation || 0)) return json({ message: "The Drive session generation changed. Retry to reconnect to the current session." }, 409);
        const offset = payload.confirmedOffset;
        if (!Number.isSafeInteger(offset) || offset < (saved.confirmedOffset || 0) || offset > saved.fileSize) return json({ message: "Invalid or regressing Drive checkpoint" }, 400);
        saved = await saveDriveSession(store, key, { confirmedOffset: offset }, { generation, fileId: saved.fileId });
      }
      if (saved.phase === "transferring") {
        const file = await getDriveFile(drive, saved.fileId);
        if (file && Number(file.size) === saved.fileSize) {
          const verified = verifyDriveMasterFile(file, { folderId: drive.folderId, ownerMemberId: membership.member_id, songId, byteSize: saved.fileSize, versionId: saved.versionId, uploadId, fileId: saved.fileId });
          if (!verified.ok) return json({ message: verified.message }, verified.status);
          saved = await saveDriveSession(store, key, { phase: "completing", confirmedOffset: saved.fileSize }, { generation: saved.generation || 0, fileId: saved.fileId });
        }
      }
      return json({ ...saved, driveUpload: true, resumed: true });
    }
    if (payload.action === "checkpoint") return json({ message: "The saved Drive upload session was not found" }, 404);
    const master = await findOwnedSaleMaster(db, membership.member_id, songId);
    if (!master) return json({ message: "Add a Sale master version to this song before uploading its master" }, 404);
    if (payload.versionId && String(payload.versionId) !== String(master.id)) return json({ message: "The Sale master changed. Review the upload target before retrying." }, 409);
    const title = cleanText(payload.title, 160) || String(master.title || "");
    const artist = cleanText(payload.artist, 120) || String(master.artist_name || "");
    const { uploadUrl, fileId } = await createResumableUploadSession(drive, {
      fileName: upload.fileName,
      contentType: upload.contentType,
      byteSize: upload.byteSize,
      origin: browserOrigin(request),
      description: [artist, title].filter(Boolean).join(" — ") + " · HALO sale master",
      appProperties: { haloOwnerMemberId: membership.member_id, haloSongId: songId, haloVersionId: String(master.id), ...(store ? { haloUploadId: uploadId } : {}) },
    });
    const candidate = {
      driveUpload: true,
      uploadUrl,
      fileId,
      songId,
      versionId: master.id,
      fileName: upload.fileName,
      contentType: upload.contentType,
      fileSize: upload.byteSize,
      chunkSize: DRIVE_UPLOAD_CHUNK_BYTES,
      ...(store ? { uploadId, protocolVersion: 2, phase: "transferring", confirmedOffset: 0, generation: 0, resetReason: "", origin: browserOrigin(request) } : {}),
    };
    if (store) {
      // Conditional creation makes a lost response/reload return the same winning session.
      try { await store.setJSON(key, candidate, { onlyIfNew: true }); }
      catch (error) {
        saved = await store.get(key, { type: "json" });
        if (!saved) throw error;
      }
      saved = await store.get(key, { type: "json" });
      if (!saved) throw new Error("The Drive session could not be persisted");
      if (saved.fileSize !== upload.byteSize || saved.fileName !== upload.fileName || saved.contentType !== upload.contentType || saved.origin !== browserOrigin(request) || (payload.versionId && String(payload.versionId) !== String(saved.versionId))) return json({ message: "A different upload target or file already owns this identity" }, 409);
      if (saved.phase === "registered") {
        const canonical = await findOwnedSaleMaster(db, membership.member_id, songId);
        if (!canonical || String(canonical.id) !== String(saved.versionId) || canonical.drive_file_id !== saved.fileId) saved = await saveDriveSession(store, key, { phase: "review_pending", registeredResult: driveReviewResult(saved) }, { generation: saved.generation || 0, fileId: saved.fileId });
      }
    }
    return json(saved || candidate);
  } catch (error) {
    if (error?.status === 409) return json({ message: error.message }, 409);
    console.error("Drive upload session failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Google Drive upload session could not be created. Try again shortly." }, 502);
  }
}

export const config = { path: "/api/upload/drive-session" };
