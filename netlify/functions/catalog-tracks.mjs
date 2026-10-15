import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
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
} from "../lib/google-drive.mjs";

// Records a completed Google Drive master upload on the song's canonical sale master version.
// The Drive file is re-read with the service account, so only complete files inside the
// masters folder that were opened for this member + song can be stored in the catalog.
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function catalogTracksHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  try {
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
    const db = await getDatabase();
    const membership = await ensureMembership(db, user);
    if (payload.protocolVersion != null && payload.protocolVersion !== 2) return json({ message: "Unsupported Drive upload protocol", protocolVersion: 2, revision: process.env.COMMIT_REF || "" }, 409);
    const uploadId = String(payload.uploadId || "");
    if (payload.protocolVersion === 2 && !/^[a-f0-9]{64}$/.test(uploadId)) return json({ message: "A saved upload identity is required" }, 400);
    const store = payload.protocolVersion === 2 ? driveSessionStore() : null;
    const key = store ? driveSessionKey(membership.member_id, songId, uploadId) : "";
    let session = store ? await store.get(key, { type: "json" }) : null;
    if (store && (!session || session.fileId !== fileId || (payload.versionId && String(payload.versionId) !== String(session.versionId)))) return json({ message: "The master reference does not match the saved upload session" }, 409);
    if (session?.registeredResult) return json(session.registeredResult, session.phase === "review_pending" ? 409 : 200);
    const master = await findOwnedSaleMaster(db, membership.member_id, songId);
    if (!master && !session) return json({ message: "That song's Sale master version was not found" }, 404);
    const file = await getDriveFile(drive, fileId);
    const verified = verifyDriveMasterFile(file, { folderId: drive.folderId, ownerMemberId: membership.member_id, songId, byteSize: session?.fileSize || payload.fileSize, versionId: session?.versionId || master?.id, uploadId: session ? uploadId : "", fileId });
    if (!verified.ok) return json({ message: verified.message }, verified.status);
    if (session && (!master || String(session.versionId) !== String(master.id) || (session.registrationResultPending && master.drive_file_id !== fileId && (master.drive_file_id || "") !== session.registrationResultPending.replacedFileId))) {
      const registeredResult = { message: "The Sale master version changed. The uploaded file is preserved for review; it was not attached to the new version.", phase: "review_pending", masterFileId: fileId, songId, versionId: session.versionId, protocolVersion: 2, revision: process.env.COMMIT_REF || "" };
      await saveDriveSession(store, key, { phase: "review_pending", registeredResult });
      return json(registeredResult, 409);
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
      ...(session ? { protocolVersion: 2, phase: "registered", revision: process.env.COMMIT_REF || "" } : {}),
    };
    if (session) {
      session = await saveDriveSession(store, key, { phase: "completing", registrationResultPending: registeredResult });
      if (session.registeredResult) return json(session.registeredResult, session.phase === "review_pending" ? 409 : 200);
    }
    // Save registration intent before SQL so a lost SQL/Blobs acknowledgement keeps its result.
    if (master.drive_file_id !== fileId) await db.sql`
      UPDATE halo_song_versions
      SET drive_file_id = ${fileId}, drive_file_name = ${verified.fileName}, drive_byte_size = ${verified.byteSize},
        drive_uploaded_at = NOW(), updated_at = NOW()
      WHERE id = ${master.id} AND song_id = ${songId}
    `;
    if (session) {
      session = await saveDriveSession(store, key, { phase: "registered", registeredResult, confirmedOffset: verified.byteSize });
      return json(session.registeredResult, 201);
    }
    return json(registeredResult, 201);
  } catch (error) {
    console.error("Catalog master reference failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The master reference could not be saved. Try again shortly." }, 502);
  }
}

export const config = { path: "/api/catalog/tracks" };
