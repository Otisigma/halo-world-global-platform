// Google Drive archive for large master copies.
// The server authenticates to Drive API v3 with a service account (RS256 JWT signed with
// node:crypto, so no Google SDK dependency is required), pre-generates the Drive file id, and
// opens a resumable upload session. The browser then streams the file straight to Google in
// 5 MB chunks, so multi-hundred-megabyte WAV masters never pass through Netlify functions.
import { createSign } from "node:crypto";
import { normalizeMasterContentType, safeMasterFilename } from "./direct-upload-storage.mjs";
import { MASTER_VERSION_TYPE } from "./master-copy.mjs";

export const DRIVE_MASTER_MAX_BYTES = 2000 * 1024 * 1024;
export const DRIVE_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

/** Reads service-account + folder settings; returns null when the Drive archive is not configured. */
export function googleDriveConfig(env = process.env) {
  let clientEmail = String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  let privateKey = String(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "");
  const json = String(env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (json) {
    try {
      const parsed = JSON.parse(json);
      clientEmail = clientEmail || String(parsed.client_email || "").trim();
      privateKey = privateKey || String(parsed.private_key || "");
    } catch {
      return null;
    }
  }
  privateKey = privateKey.replace(/\\n/g, "\n").trim();
  const folderId = String(env.GOOGLE_DRIVE_MASTERS_FOLDER_ID || "").trim();
  if (!clientEmail || !privateKey.includes("PRIVATE KEY") || !isDriveId(folderId)) return null;
  return { clientEmail, privateKey, folderId };
}

export function isDriveId(value) {
  return DRIVE_ID_PATTERN.test(String(value || ""));
}

const DRIVE_LINK_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

/**
 * Normalizes a pasted shareable Google Drive link for a master file. No API credentials are
 * involved: only https drive.google.com / docs.google.com links are accepted, anything else
 * returns "" so callers can reject it.
 */
export function cleanGoogleDriveUrl(value) {
  const text = String(value ?? "").trim().slice(0, 1200);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !DRIVE_LINK_HOSTS.has(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/** Validates master metadata before a Drive session is opened. */
export function validateDriveMasterUpload({ fileName, fileType, fileSize } = {}) {
  const name = String(fileName || "").trim();
  if (!name) return { ok: false, status: 400, message: "fileName is required" };
  const byteSize = Number(fileSize);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) return { ok: false, status: 400, message: "fileSize must be a positive whole number of bytes" };
  if (byteSize > DRIVE_MASTER_MAX_BYTES) return { ok: false, status: 413, message: `Drive master uploads are limited to ${DRIVE_MASTER_MAX_BYTES / 1024 / 1024} MB` };
  const contentType = normalizeMasterContentType(fileType, name);
  if (!contentType) return { ok: false, status: 415, message: "Upload a WAV, M4A, FLAC, AAC, MP3, OGG, or WebM master file" };
  return { ok: true, byteSize, contentType, fileName: safeMasterFilename(name) };
}

const bearer = token => ["Bearer", token].join(" ");
const base64url = value => Buffer.from(value).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function buildServiceAccountAssertion(config, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: config.clientEmail, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(config.privateKey).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${header}.${claims}.${signature}`;
}

async function readGoogleError(response) {
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.error_description || (typeof body?.error === "string" ? body.error : "") || `HTTP ${response.status}`;
}

export async function getDriveAccessToken(config, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: buildServiceAccountAssertion(config) }).toString(),
  });
  if (!response.ok) throw new Error(`Google service account authentication failed: ${await readGoogleError(response)}`);
  const data = await response.json();
  if (!data?.access_token) throw new Error("Google service account authentication returned no access token");
  return data.access_token;
}

async function generateDriveFileId(accessToken, fetchImpl) {
  const response = await fetchImpl(`${DRIVE_API}/files/generateIds?count=1&space=drive&type=files`, { headers: { Authorization: bearer(accessToken) } });
  if (!response.ok) throw new Error(`Drive file id generation failed: ${await readGoogleError(response)}`);
  const data = await response.json();
  const id = data?.ids?.[0];
  if (!isDriveId(id)) throw new Error("Drive returned an invalid file id");
  return id;
}

/**
 * Opens a resumable upload session inside the configured masters folder.
 * `origin` must be the browser origin so Google answers the chunk PUTs with CORS headers.
 * The file id is generated up-front so the client never depends on the final upload body.
 */
export async function createResumableUploadSession(config, { fileName, contentType, byteSize, origin, appProperties = {}, description = "" }, { fetchImpl = fetch } = {}) {
  const accessToken = await getDriveAccessToken(config, { fetchImpl });
  const fileId = await generateDriveFileId(accessToken, fetchImpl);
  const headers = {
    Authorization: bearer(accessToken),
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": contentType,
    "X-Upload-Content-Length": String(byteSize),
  };
  if (origin) headers.Origin = origin;
  const response = await fetchImpl(`${DRIVE_UPLOAD_API}?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,mimeType`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: fileId, name: fileName, mimeType: contentType, parents: [config.folderId], description: String(description || "").slice(0, 500), appProperties }),
  });
  if (!response.ok) throw new Error(`Drive resumable session could not be created: ${await readGoogleError(response)}`);
  const uploadUrl = response.headers.get("location") || "";
  if (!isGoogleUploadUrl(uploadUrl)) throw new Error("Drive did not return a resumable upload URL");
  return { uploadUrl, fileId };
}

export function isGoogleUploadUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files" && url.searchParams.has("upload_id");
  } catch {
    return false;
  }
}

/** Reads the uploaded Drive file so the catalog only stores verified, in-folder references. */
export async function getDriveFile(config, fileId, { fetchImpl = fetch } = {}) {
  if (!isDriveId(fileId)) return null;
  const accessToken = await getDriveAccessToken(config, { fetchImpl });
  const response = await fetchImpl(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,size,mimeType,parents,trashed,appProperties,webViewLink`, {
    headers: { Authorization: bearer(accessToken) },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Drive file lookup failed: ${await readGoogleError(response)}`);
  return response.json();
}

/** Confirms a Drive file is a complete master in the masters folder, owned by this member and song. */
export function verifyDriveMasterFile(file, { folderId, ownerMemberId, songId, byteSize }) {
  if (!file || file.trashed) return { ok: false, status: 404, message: "The uploaded master was not found in Google Drive" };
  if (!Array.isArray(file.parents) || !file.parents.includes(folderId)) return { ok: false, status: 403, message: "That Drive file is not in the HALO masters folder" };
  const props = file.appProperties || {};
  if (props.haloOwnerMemberId !== ownerMemberId || props.haloSongId !== songId) return { ok: false, status: 403, message: "That Drive master does not belong to this song" };
  const storedBytes = Number(file.size);
  if (!Number.isSafeInteger(storedBytes) || storedBytes < 1) return { ok: false, status: 409, message: "The Drive master upload is incomplete. Upload it again." };
  if (byteSize && storedBytes !== Number(byteSize)) return { ok: false, status: 409, message: "The Drive master size does not match the selected file. Upload it again." };
  return { ok: true, byteSize: storedBytes, fileName: safeMasterFilename(file.name), contentType: String(file.mimeType || "") };
}

export function cleanSongId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

/** The member's active canonical sale master for a song (the only place a Drive master is recorded). */
export async function findOwnedSaleMaster(db, ownerMemberId, songId) {
  const rows = await db.sql`
    SELECT version.id, version.song_id, song.title, song.artist_name, version.drive_file_id
    FROM halo_song_versions version
    JOIN halo_song_catalog song ON song.id = version.song_id
    WHERE song.id = ${songId} AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active'
      AND version.version_type = ${MASTER_VERSION_TYPE} AND version.status = 'active'
    ORDER BY (version.audio_url <> '') DESC, version.created_at ASC, version.id ASC
    LIMIT 1
  `;
  return rows[0] || null;
}
