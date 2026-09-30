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
    const master = await findOwnedSaleMaster(db, membership.member_id, songId);
    if (!master) return json({ message: "That song's Sale master version was not found" }, 404);
    const file = await getDriveFile(drive, fileId);
    const verified = verifyDriveMasterFile(file, { folderId: drive.folderId, ownerMemberId: membership.member_id, songId, byteSize: payload.fileSize });
    if (!verified.ok) return json({ message: verified.message }, verified.status);
    await db.sql`
      UPDATE halo_song_versions
      SET drive_file_id = ${fileId}, drive_file_name = ${verified.fileName}, drive_byte_size = ${verified.byteSize},
        drive_uploaded_at = NOW(), updated_at = NOW()
      WHERE id = ${master.id} AND song_id = ${songId}
    `;
    return json({
      message: "Master archived in Google Drive and linked to the song's Sale master.",
      songId,
      versionId: master.id,
      masterFileId: fileId,
      fileName: verified.fileName,
      fileSize: verified.byteSize,
      replacedFileId: master.drive_file_id && master.drive_file_id !== fileId ? master.drive_file_id : "",
      storage: "google_drive",
      persisted: true,
    }, 201);
  } catch (error) {
    console.error("Catalog master reference failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The master reference could not be saved. Try again shortly." }, 502);
  }
}

export const config = { path: "/api/catalog/tracks" };
