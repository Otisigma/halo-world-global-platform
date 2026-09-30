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
    const master = await findOwnedSaleMaster(db, membership.member_id, songId);
    if (!master) return json({ message: "Add a Sale master version to this song before uploading its master" }, 404);
    const title = cleanText(payload.title, 160) || String(master.title || "");
    const artist = cleanText(payload.artist, 120) || String(master.artist_name || "");
    const { uploadUrl, fileId } = await createResumableUploadSession(drive, {
      fileName: upload.fileName,
      contentType: upload.contentType,
      byteSize: upload.byteSize,
      origin: browserOrigin(request),
      description: [artist, title].filter(Boolean).join(" — ") + " · HALO sale master",
      appProperties: { haloOwnerMemberId: membership.member_id, haloSongId: songId, haloVersionId: String(master.id) },
    });
    return json({
      driveUpload: true,
      uploadUrl,
      fileId,
      songId,
      versionId: master.id,
      fileName: upload.fileName,
      contentType: upload.contentType,
      fileSize: upload.byteSize,
      chunkSize: DRIVE_UPLOAD_CHUNK_BYTES,
    });
  } catch (error) {
    console.error("Drive upload session failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Google Drive upload session could not be created. Try again shortly." }, 502);
  }
}

export const config = { path: "/api/upload/drive-session" };
