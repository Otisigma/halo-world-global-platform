import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
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
} from "../lib/google-drive.mjs";

// Opens a Google Drive resumable upload session for a song's sale master.
// Only small JSON metadata passes through this function; the browser streams the file to
// the returned `uploadUrl` in 5 MB chunks (see /public/js/chunkedUploader.js).
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function browserOrigin(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin") || "";
  return origin && origin === requestOrigin ? origin : requestOrigin;
}

export default async function uploadHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  try {
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
    const db = await getDatabase();
    const membership = await ensureMembership(db, user);
    const protocolVersion = payload.protocolVersion;
    if (protocolVersion != null && protocolVersion !== 2) return json({ message: "Unsupported Drive upload protocol", protocolVersion: 2, revision: process.env.COMMIT_REF || "" }, 409);
    const uploadId = String(payload.uploadId || "");
    if (protocolVersion === 2 && !/^[a-f0-9]{64}$/.test(uploadId)) return json({ message: "A content-derived uploadId is required" }, 400);
    const store = protocolVersion === 2 ? driveSessionStore() : null;
    const key = store ? driveSessionKey(membership.member_id, songId, uploadId) : "";
    let saved = store ? await store.get(key, { type: "json" }) : null;
    if (saved) {
      if (saved.fileSize !== upload.byteSize || saved.fileName !== upload.fileName || saved.contentType !== upload.contentType || saved.origin !== browserOrigin(request)) return json({ message: "The saved upload belongs to different file details or origin" }, 409);
      if (payload.versionId && String(payload.versionId) !== String(saved.versionId)) return json({ message: "The saved upload target version does not match" }, 409);
      if (payload.action === "checkpoint") {
        const offset = payload.confirmedOffset;
        if (!Number.isSafeInteger(offset) || offset < (saved.confirmedOffset || 0) || offset > saved.fileSize) return json({ message: "Invalid or regressing Drive checkpoint" }, 400);
        saved = await saveDriveSession(store, key, { confirmedOffset: offset });
      }
      if (saved.phase === "transferring") {
        const file = await getDriveFile(drive, saved.fileId);
        if (file && Number(file.size) === saved.fileSize) {
          const verified = verifyDriveMasterFile(file, { folderId: drive.folderId, ownerMemberId: membership.member_id, songId, byteSize: saved.fileSize, versionId: saved.versionId, uploadId, fileId: saved.fileId });
          if (!verified.ok) return json({ message: verified.message }, verified.status);
          saved = await saveDriveSession(store, key, { phase: "completing", confirmedOffset: saved.fileSize });
        }
      }
      return json({ ...saved, driveUpload: true, protocolVersion: 2, revision: process.env.COMMIT_REF || "", resumed: true });
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
      ...(store ? { uploadId, protocolVersion: 2, phase: "transferring", confirmedOffset: 0, origin: browserOrigin(request) } : {}),
    };
    if (store) {
      // Conditional creation makes a lost response/reload return the same winning session.
      await store.setJSON(key, candidate, { onlyIfNew: true });
      saved = await store.get(key, { type: "json" });
      if (!saved) throw new Error("The Drive session could not be persisted");
      if (saved.fileSize !== upload.byteSize || saved.fileName !== upload.fileName || saved.contentType !== upload.contentType || saved.origin !== browserOrigin(request) || (payload.versionId && String(payload.versionId) !== String(saved.versionId))) return json({ message: "A different upload target or file already owns this identity" }, 409);
    }
    return json({ ...(saved || candidate), revision: process.env.COMMIT_REF || "" });
  } catch (error) {
    console.error("Drive upload session failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Google Drive upload session could not be created. Try again shortly." }, 502);
  }
}

export const config = { path: "/api/upload/drive-session" };
