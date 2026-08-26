import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const artworkStore = getStore({ name: "halo-song-catalog-artwork", consistency: "strong" });
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_UPLOAD_BYTES / MAX_CHUNK_BYTES);

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanId(value: unknown) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanUploadId(value: unknown) {
  const id = cleanText(value, 80);
  return /^[a-z0-9-]{12,80}$/i.test(id) ? id : "";
}

function normalizeImageContentType(value: unknown, filename = "") {
  const contentType = cleanText(value, 80).split(";")[0].toLowerCase();
  if (ALLOWED_TYPES.has(contentType)) return contentType;
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (/\.png$/i.test(filename)) return "image/png";
  if (/\.webp$/i.test(filename)) return "image/webp";
  return "";
}

function requestedByteRange(value: string | null, byteSize: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, byteSize - suffixLength);
    end = byteSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : byteSize - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= byteSize || end < start) return false;
  return { start, end: Math.min(end, byteSize - 1) };
}

async function ownedSong(db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string, songId: string) {
  const rows = await db.sql`
    SELECT id, artwork_url, artwork_blob_prefix, artwork_chunk_count, artwork_byte_size, artwork_content_type, artwork_filename
    FROM halo_song_catalog
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active'
    LIMIT 1
  `;
  return rows[0] || null;
}

async function ownedVersion(db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string, versionId: string, songId = "") {
  const rows = songId
    ? await db.sql`
        SELECT version.id, version.song_id, version.artwork_url, version.artwork_blob_prefix, version.artwork_chunk_count,
          version.artwork_content_type, version.artwork_byte_size, version.artwork_filename
        FROM halo_song_versions version
        JOIN halo_song_catalog song ON song.id = version.song_id
        WHERE version.id = ${versionId} AND song.id = ${songId}
          AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active' AND version.status = 'active'
        LIMIT 1
      `
    : await db.sql`
        SELECT version.id, version.song_id, version.artwork_url, version.artwork_blob_prefix, version.artwork_chunk_count,
          version.artwork_content_type, version.artwork_byte_size, version.artwork_filename
        FROM halo_song_versions version
        JOIN halo_song_catalog song ON song.id = version.song_id
        WHERE version.id = ${versionId}
          AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active' AND version.status = 'active'
        LIMIT 1
      `;
  return rows[0] || null;
}

async function touchSong(db: Awaited<ReturnType<typeof getDatabase>>, songId: string, ownerMemberId: string) {
  await db.sql`UPDATE halo_song_catalog SET updated_at = NOW() WHERE id = ${songId} AND owner_member_id = ${ownerMemberId}`;
}

async function removeArtwork(prefix: string) {
  if (!prefix) return;
  const stored = await artworkStore.list({ prefix });
  await Promise.all(stored.blobs.map(blob => artworkStore.delete(blob.key)));
}

async function uploadChunk(request: Request, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const form = await request.formData();
  const songId = cleanId(form.get("songId"));
  const versionId = cleanId(form.get("versionId"));
  const uploadId = cleanUploadId(form.get("uploadId"));
  const chunkIndex = Number.parseInt(String(form.get("chunkIndex") || ""), 10);
  const chunkCount = Number.parseInt(String(form.get("chunkCount") || ""), 10);
  const byteSize = Number.parseInt(String(form.get("byteSize") || ""), 10);
  const filename = cleanText(form.get("filename"), 180);
  const chunk = form.get("chunk");
  if (!songId || !uploadId || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount)) return json({ message: "The artwork upload sequence is invalid" }, 400);
  if (chunkIndex < 0 || chunkIndex >= chunkCount || chunkCount < 1 || chunkCount > MAX_CHUNKS) return json({ message: "The artwork upload sequence is invalid" }, 400);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) return json({ message: "Artwork uploads are limited to 20 MB" }, 413);
  if (!(chunk instanceof Blob) || !chunk.size || chunk.size > MAX_CHUNK_BYTES) return json({ message: "That artwork chunk is invalid" }, 413);
  const contentType = normalizeImageContentType(form.get("contentType") || chunk.type, filename);
  if (!contentType) return json({ message: "Upload a JPEG, PNG, or WebP image file" }, 415);
  const owner = versionId ? await ownedVersion(db, ownerMemberId, versionId, songId) : await ownedSong(db, ownerMemberId, songId);
  if (!owner) return json({ message: versionId ? "That song version was not found" : "That song was not found" }, 404);
  const prefix = `${ownerMemberId}/${versionId || songId}/${uploadId}/parts/`;
  await artworkStore.set(`${prefix}${String(chunkIndex).padStart(3, "0")}`, chunk);
  return json({ message: "Artwork chunk uploaded", chunkIndex });
}

async function finalizeUpload(payload: Record<string, unknown>, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const songId = cleanId(payload.songId);
  const versionId = cleanId(payload.versionId);
  const uploadId = cleanUploadId(payload.uploadId);
  const chunkCount = Number.parseInt(String(payload.chunkCount || ""), 10);
  const byteSize = Number.parseInt(String(payload.byteSize || ""), 10);
  const filename = cleanText(payload.filename, 180) || "artwork";
  const contentType = normalizeImageContentType(payload.contentType, filename);
  if (!songId || !uploadId || !contentType || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) return json({ message: "The finished artwork details are incomplete" }, 400);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) return json({ message: "Artwork uploads are limited to 20 MB" }, 413);
  const owner = versionId ? await ownedVersion(db, ownerMemberId, versionId, songId) : await ownedSong(db, ownerMemberId, songId);
  if (!owner) return json({ message: versionId ? "That song version was not found" : "That song was not found" }, 404);
  const prefix = `${ownerMemberId}/${versionId || songId}/${uploadId}/parts/`;
  const stored = await artworkStore.list({ prefix });
  if (stored.blobs.length !== chunkCount) return json({ message: "The artwork upload is incomplete. Try it again." }, 409);
  if (versionId) {
    const artworkUrl = `/api/song-catalog/artwork?versionId=${encodeURIComponent(versionId)}`;
    await db.sql`
      UPDATE halo_song_versions
      SET artwork_url = ${artworkUrl},
          artwork_blob_prefix = ${prefix},
          artwork_chunk_count = ${chunkCount},
          artwork_content_type = ${contentType},
          artwork_byte_size = ${byteSize},
          artwork_filename = ${filename},
          artwork_uploaded_at = NOW(),
          updated_at = NOW()
      WHERE id = ${versionId} AND song_id = ${songId}
    `;
    await touchSong(db, songId, ownerMemberId);
    if (owner.artwork_blob_prefix && owner.artwork_blob_prefix !== prefix) await removeArtwork(String(owner.artwork_blob_prefix)).catch(() => undefined);
    return json({ artwork_url: artworkUrl, message: "Version artwork uploaded successfully", songId, versionId });
  }
  const artworkUrl = `/api/song-catalog/artwork?songId=${encodeURIComponent(songId)}`;
  await db.sql`
    UPDATE halo_song_catalog
    SET artwork_url = ${artworkUrl},
        artwork_blob_prefix = ${prefix},
        artwork_chunk_count = ${chunkCount},
        artwork_content_type = ${contentType},
        artwork_byte_size = ${byteSize},
        artwork_filename = ${filename},
        artwork_uploaded_at = NOW(),
        updated_at = NOW()
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId}
  `;
  if (owner.artwork_blob_prefix && owner.artwork_blob_prefix !== prefix) await removeArtwork(String(owner.artwork_blob_prefix)).catch(() => undefined);
  return json({ artwork_url: artworkUrl, message: "Artwork uploaded successfully", songId });
}

async function readArtworkRange(song: Record<string, unknown>, range: { start: number; end: number }) {
  const chunkCount = Number(song.artwork_chunk_count || 0);
  const prefix = String(song.artwork_blob_prefix || "");
  const chunkBytes = MAX_CHUNK_BYTES;
  const firstChunk = Math.floor(range.start / chunkBytes);
  const lastChunk = Math.floor(range.end / chunkBytes);
  if (firstChunk >= chunkCount || lastChunk >= chunkCount) throw new Error("Artwork range is invalid");
  const chunks: Uint8Array[] = [];
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    const part = await artworkStore.get(`${prefix}${String(index).padStart(3, "0")}`, { type: "arrayBuffer" });
    if (!part) throw new Error("Artwork chunk is missing");
    chunks.push(new Uint8Array(part));
  }
  const image = new Uint8Array(range.end - range.start + 1);
  let written = 0;
  for (let index = 0; index < chunks.length && written < image.byteLength; index += 1) {
    const chunkNumber = firstChunk + index;
    const chunkStart = chunkNumber * chunkBytes;
    const sourceStart = Math.max(0, range.start - chunkStart);
    const sourceEnd = Math.min(chunks[index].byteLength, range.end - chunkStart + 1);
    const slice = chunks[index].subarray(sourceStart, sourceEnd);
    image.set(slice, written);
    written += slice.byteLength;
  }
  if (written !== image.byteLength) throw new Error("Artwork range is incomplete");
  return image;
}

async function serveArtwork(request: Request, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const params = new URL(request.url).searchParams;
  const versionId = cleanId(params.get("versionId"));
  const songId = cleanId(params.get("songId"));
  const owner = versionId ? await ownedVersion(db, ownerMemberId, versionId) : songId ? await ownedSong(db, ownerMemberId, songId) : null;
  if (!owner?.artwork_blob_prefix || !owner.artwork_chunk_count || !owner.artwork_byte_size) return json({ message: "Song artwork was not found" }, 404);
  const byteSize = Number(owner.artwork_byte_size);
  const range = requestedByteRange(request.headers.get("range"), byteSize);
  if (range === false) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${byteSize}`, "Cache-Control": "private, no-store" } });
  const headers: Record<string, string> = {
    "Content-Type": String(owner.artwork_content_type || "application/octet-stream"),
    "Content-Length": String(range ? range.end - range.start + 1 : byteSize),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "Content-Disposition": `inline; filename="${String(owner.artwork_filename || "artwork").replace(/[^a-zA-Z0-9._ -]/g, "")}"`,
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${byteSize}`;
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  if (range) return new Response(await readArtworkRange(owner, range), { status: 206, headers });
  const prefix = String(owner.artwork_blob_prefix);
  const chunkCount = Number(owner.artwork_chunk_count);
  const image = new ReadableStream({
    async start(controller) {
      try {
        for (let index = 0; index < chunkCount; index += 1) {
          const part = await artworkStore.get(`${prefix}${String(index).padStart(3, "0")}`, { type: "arrayBuffer" });
          if (!part) throw new Error("Artwork chunk is missing");
          controller.enqueue(new Uint8Array(part));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(image, { headers });
}

async function deleteArtwork(payload: Record<string, unknown>, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const songId = cleanId(payload.songId);
  const versionId = cleanId(payload.versionId);
  if (!songId) return json({ message: "A valid song ID is required" }, 400);
  const owner = versionId ? await ownedVersion(db, ownerMemberId, versionId, songId) : await ownedSong(db, ownerMemberId, songId);
  if (!owner) return json({ message: versionId ? "That song version was not found" : "That song was not found" }, 404);
  if (versionId) {
    await db.sql`
      UPDATE halo_song_versions
      SET artwork_url = NULL, artwork_blob_prefix = '', artwork_chunk_count = 0,
          artwork_content_type = '', artwork_byte_size = 0, artwork_filename = '',
          artwork_uploaded_at = NULL, updated_at = NOW()
      WHERE id = ${versionId} AND song_id = ${songId}
    `;
    await touchSong(db, songId, ownerMemberId);
    if (owner.artwork_blob_prefix) await removeArtwork(String(owner.artwork_blob_prefix)).catch(() => undefined);
    return json({ message: "Version artwork removed", songId, versionId });
  }
  await db.sql`
    UPDATE halo_song_catalog
    SET artwork_url = NULL, artwork_blob_prefix = NULL, artwork_chunk_count = NULL,
        artwork_content_type = NULL, artwork_byte_size = NULL, artwork_filename = NULL,
        artwork_uploaded_at = NULL, updated_at = NOW()
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId}
  `;
  if (owner.artwork_blob_prefix) await removeArtwork(String(owner.artwork_blob_prefix)).catch(() => undefined);
  return json({ message: "Artwork removed", songId });
}

export default async function songCatalogArtworkHandler(request: Request) {
  if (!["GET", "HEAD", "POST", "DELETE"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, HEAD, POST, DELETE" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Join or sign in to use song artwork" }, 401);
    const membership = await ensureMembership(db, user);
    if (["GET", "HEAD"].includes(request.method)) return serveArtwork(request, db, membership.member_id);
    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin artwork requests are not accepted" }, 403); }
    if (request.method === "DELETE") {
      const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
      if (!payload) return json({ message: "A valid request body is required" }, 400);
      return deleteArtwork(payload, db, membership.member_id);
    }
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return uploadChunk(request, db, membership.member_id);
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || payload.action !== "finalize_upload") return json({ message: "Choose a supported artwork action" }, 400);
    return finalizeUpload(payload, db, membership.member_id);
  } catch (error) {
    console.error("Song catalog artwork failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Song artwork is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/song-catalog/artwork" };
