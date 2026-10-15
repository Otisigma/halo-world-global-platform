import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { uploadProtocol, requireUploadProtocol } from "../lib/resumable-upload.mjs";
import { MASTER_VERSION_TYPE } from "../lib/master-copy.mjs";
import {
  cleanSongId,
  findOwnedSaleMaster,
  getDriveFile,
  googleDriveConfig,
  isDriveId,
  verifyDriveMasterFile,
  driveSessionStore,
  driveSessionKey,
  saveDriveSession,
  driveReviewResult,
} from "../lib/google-drive.mjs";

// Records a completed Google Drive master upload on the song's canonical sale master version.
// The Drive file is re-read with the service account, so only complete files inside the
// masters folder that were opened for this member + song can be stored in the catalog.
function json(body, status = 200) {
  return Response.json({ ...body, ...uploadProtocol() }, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function catalogTracksHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  try {
    requireUploadProtocol(request);
    const drive = googleDriveConfig();
    if (!drive) return json({ driveUpload: false, message: "Google Drive master uploads are not configured" }, 503);
    const user = await getUser();
    if (!user?.id) return json({ message: "Join or sign in to update the catalog" }, 401);
    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin catalog updates are not accepted" }, 403); }
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") return json({ message: "Send the master reference as JSON" }, 400);
    const songId = cleanSongId(payload.songId);
    const fileId = String(payload.masterFileId || "").trim();
    if (!songId || !isDriveId(fileId)) return json({ message: "songId and masterFileId are required" }, 400);
    if (payload.protocolVersion != null && payload.protocolVersion !== 2) return json({ message: "Unsupported Drive upload protocol" }, 409);
    const uploadId = String(payload.uploadId || "");
    if (payload.protocolVersion === 2 && !/^[a-f0-9]{64}$/.test(uploadId)) return json({ message: "A saved upload identity is required" }, 400);
    const db = await getDatabase();
    const membership = await ensureMembership(db, user);
    const store = payload.protocolVersion === 2 ? driveSessionStore() : null;
    const key = store ? driveSessionKey(membership.member_id, songId, uploadId) : "";
    let session = store ? await store.get(key, { type: "json" }) : null;
    if (store && (!session || session.fileId !== fileId || (payload.versionId && String(payload.versionId) !== String(session.versionId)))) return json({ message: "The master reference does not match the saved upload session" }, 409);
    let master = await findOwnedSaleMaster(db, membership.member_id, songId);
    const targetVersionId = session?.versionId || master?.id;
    async function review() {
      const registeredResult = driveReviewResult(session);
      session = await saveDriveSession(store, key, { phase: "review_pending", registeredResult }, { generation: session.generation || 0, fileId });
      return json(session.registeredResult, 409);
    }
    if (session?.registeredResult) {
      if (session.phase === "review_pending") return json(session.registeredResult, 409);
      if (!master || String(master.id) !== String(session.versionId) || master.drive_file_id !== fileId) return await review();
      return json(session.registeredResult);
    }
    if (!master && !session) return json({ message: "That song's Sale master version was not found" }, 404);
    const file = await getDriveFile(drive, fileId);
    const verified = verifyDriveMasterFile(file, { folderId: drive.folderId, ownerMemberId: membership.member_id, songId, byteSize: session?.fileSize || payload.fileSize, versionId: session?.versionId || master?.id, uploadId: session ? uploadId : "", fileId });
    if (!verified.ok) return json({ message: verified.message }, verified.status);
    if (session && (!master || String(session.versionId) !== String(master.id) || (session.registrationResultPending && master.drive_file_id !== fileId && (master.drive_file_id || "") !== session.registrationResultPending.replacedFileId))) {
      return await review();
    }
    const registeredResult = session?.registrationResultPending || {
      message: "Master archived in Google Drive and linked to the song's Sale master.",
      songId,
      versionId: master.id,
      masterFileId: fileId,
      fileName: verified.fileName,
      fileSize: verified.byteSize,
      replacedFileId: master.drive_file_id && master.drive_file_id !== fileId ? master.drive_file_id : "",
      storage: "google_drive",
      persisted: true,
      ...(session ? { ...uploadProtocol(), phase: "registered" } : {}),
    };
    if (session) {
      session = await saveDriveSession(store, key, { phase: "completing", registrationResultPending: registeredResult }, { generation: session.generation || 0, fileId });
      if (session.registeredResult) {
        master = await findOwnedSaleMaster(db, membership.member_id, songId);
        if (session.phase === "review_pending") return json(session.registeredResult, 409);
        if (!master || String(master.id) !== String(session.versionId) || master.drive_file_id !== fileId) return await review();
        return json(session.registeredResult);
      }
    }
    // Save registration intent before SQL so a lost SQL/Blobs acknowledgement keeps its result.
    if (master.drive_file_id !== fileId) {
      const updated = await db.sql`
      WITH canonical AS (
        SELECT version.id FROM halo_song_versions version
        JOIN halo_song_catalog song ON song.id = version.song_id
        WHERE song.id = ${songId} AND song.owner_member_id = ${membership.member_id} AND song.status = 'active'
          AND version.version_type = ${MASTER_VERSION_TYPE} AND version.status = 'active'
        ORDER BY (version.audio_url <> '') DESC, version.created_at ASC, version.id ASC LIMIT 1
      )
      UPDATE halo_song_versions
      SET drive_file_id = ${fileId}, drive_file_name = ${verified.fileName}, drive_byte_size = ${verified.byteSize},
        drive_uploaded_at = NOW(), updated_at = NOW()
      WHERE id = ${master.id} AND song_id = ${songId} AND status = 'active'
        AND id = (SELECT id FROM canonical) AND COALESCE(drive_file_id, '') = ${master.drive_file_id || ""}
      RETURNING id
    `;
      if (!updated.length) {
        master = await findOwnedSaleMaster(db, membership.member_id, songId);
        if (!master || String(master.id) !== String(targetVersionId) || master.drive_file_id !== fileId) {
          if (session) return await review();
          return json({ message: "The canonical Sale master changed during registration. Review the uploaded file before retrying." }, 409);
        }
      }
    }
    master = await findOwnedSaleMaster(db, membership.member_id, songId);
    if (!master || String(master.id) !== String(targetVersionId) || master.drive_file_id !== fileId) {
      if (session) return await review();
      return json({ message: "The canonical Sale master changed during registration. The uploaded file is preserved for review." }, 409);
    }
    if (session) {
      session = await saveDriveSession(store, key, { phase: "registered", registeredResult, confirmedOffset: verified.byteSize }, { generation: session.generation || 0, fileId });
      return json(session.registeredResult, 201);
    }
    return json(registeredResult, 201);
  } catch (error) {
    if (error?.status === 409) return json({ message: error.message }, 409);
    console.error("Catalog master reference failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The master reference could not be saved. Try again shortly." }, 502);
  }
}

export const config = { path: "/api/catalog/tracks" };
