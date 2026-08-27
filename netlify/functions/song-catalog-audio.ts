import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { runDreamweaverReview } from "./song-catalog.js";

function getAudioStore() {
  return getStore({ name: "halo-song-catalog-audio", consistency: "strong" });
}
const ALLOWED_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-wav", "audio/flac"]);
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
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

function normalizeAudioContentType(value: unknown, filename = "") {
  const contentType = cleanText(value, 80).split(";")[0].toLowerCase();
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-mp3": "audio/mpeg",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "video/mp4": "audio/mp4",
    "audio/x-aac": "audio/aac",
    "application/ogg": "audio/ogg",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/x-flac": "audio/flac",
    "application/x-flac": "audio/flac",
  };
  if (aliases[contentType]) return aliases[contentType];
  if (ALLOWED_TYPES.has(contentType)) return contentType;
  if (/\.flac$/i.test(filename)) return "audio/flac";
  if (/\.wav$/i.test(filename)) return "audio/wav";
  if (/\.aac$/i.test(filename)) return "audio/aac";
  if (/\.ogg$/i.test(filename)) return "audio/ogg";
  if (/\.webm$/i.test(filename)) return "audio/webm";
  if (/\.(?:m4a|mp4)$/i.test(filename)) return "audio/mp4";
  if (/\.mp3$/i.test(filename)) return "audio/mpeg";
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

async function ownedVersion(db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string, versionId: string, songId = "") {
  const rows = songId
    ? await db.sql`
        SELECT version.id, version.song_id, version.audio_blob_prefix, version.audio_chunk_count,
          version.audio_content_type, version.audio_byte_size, version.audio_filename
        FROM halo_song_versions version
        JOIN halo_song_catalog song ON song.id = version.song_id
        WHERE version.id = ${versionId} AND song.id = ${songId}
          AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active' AND version.status = 'active'
        LIMIT 1
      `
    : await db.sql`
        SELECT version.id, version.song_id, version.audio_blob_prefix, version.audio_chunk_count,
          version.audio_content_type, version.audio_byte_size, version.audio_filename
        FROM halo_song_versions version
        JOIN halo_song_catalog song ON song.id = version.song_id
        WHERE version.id = ${versionId}
          AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active' AND version.status = 'active'
        LIMIT 1
      `;
  return rows[0] || null;
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
  if (!songId || !versionId || !uploadId || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount)) return json({ message: "The audio upload sequence is invalid" }, 400);
  if (chunkIndex < 0 || chunkIndex >= chunkCount || chunkCount < 1 || chunkCount > MAX_CHUNKS) return json({ message: "The audio upload sequence is invalid" }, 400);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) return json({ message: "Song audio uploads are limited to 128 MB" }, 413);
  if (!(chunk instanceof Blob) || !chunk.size || chunk.size > MAX_CHUNK_BYTES) return json({ message: "That audio upload chunk is invalid" }, 413);
  const contentType = normalizeAudioContentType(form.get("contentType") || chunk.type, filename);
  if (!contentType) return json({ message: "Upload an MP3, M4A, AAC, OGG, WebM, WAV, or FLAC audio file" }, 415);
  if (!(await ownedVersion(db, ownerMemberId, versionId, songId))) return json({ message: "That song version was not found" }, 404);
  const prefix = `${ownerMemberId}/${versionId}/${uploadId}/parts/`;
  await getAudioStore().set(`${prefix}${String(chunkIndex).padStart(3, "0")}`, chunk);
  return json({ message: "Audio chunk uploaded", chunkIndex });
}

async function removeUpload(prefix: string) {
  if (!prefix) return;
  const stored = await getAudioStore().list({ prefix });
  await Promise.all(stored.blobs.map(blob => getAudioStore().delete(blob.key)));
}

async function finalizeUpload(payload: Record<string, unknown>, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const songId = cleanId(payload.songId);
  const versionId = cleanId(payload.versionId);
  const uploadId = cleanUploadId(payload.uploadId);
  const chunkCount = Number.parseInt(String(payload.chunkCount || ""), 10);
  const byteSize = Number.parseInt(String(payload.byteSize || ""), 10);
  const durationSeconds = Math.max(0, Math.min(86_400, Math.round(Number(payload.durationSeconds) || 0)));
  const filename = cleanText(payload.filename, 180) || "song-audio";
  const contentType = normalizeAudioContentType(payload.contentType, filename);
  if (!songId || !versionId || !uploadId || !contentType || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) return json({ message: "The finished audio details are incomplete" }, 400);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) return json({ message: "Song audio uploads are limited to 128 MB" }, 413);
  const version = await ownedVersion(db, ownerMemberId, versionId, songId);
  if (!version) return json({ message: "That song version was not found" }, 404);
  const prefix = `${ownerMemberId}/${versionId}/${uploadId}/parts/`;
  const stored = await getAudioStore().list({ prefix });
  if (stored.blobs.length !== chunkCount) return json({ message: "The audio upload is incomplete. Try it again." }, 409);
  const audioUrl = `/api/song-catalog/audio?versionId=${encodeURIComponent(versionId)}`;
  await db.sql`
    UPDATE halo_song_versions
    SET audio_url = ${audioUrl}, audio_blob_prefix = ${prefix}, audio_chunk_count = ${chunkCount},
      audio_content_type = ${contentType}, audio_byte_size = ${byteSize}, audio_filename = ${filename},
      duration_seconds = CASE WHEN ${durationSeconds} > 0 THEN ${durationSeconds} ELSE duration_seconds END,
      mastering_status = CASE WHEN version_type IN ('radio_edit', 'clean') AND mastering_status = 'not_started' THEN 'queued' ELSE mastering_status END,
      updated_at = NOW()
    WHERE id = ${versionId}
  `;
  await runDreamweaverReview(songId, ownerMemberId);
  if (version.audio_blob_prefix && version.audio_blob_prefix !== prefix) await removeUpload(version.audio_blob_prefix).catch(() => undefined);
  return json({ message: "Audio uploaded, routed, and checked by Dream Weaver", songId, versionId, audioUrl });
}

async function readAudioRange(version: Record<string, unknown>, range: { start: number; end: number }) {
  const chunkCount = Number(version.audio_chunk_count || 0);
  const prefix = String(version.audio_blob_prefix || "");
  const firstPart = await getAudioStore().get(`${prefix}000`, { type: "arrayBuffer" });
  if (!firstPart) throw new Error("Song audio chunk is missing");
  const chunkBytes = firstPart.byteLength;
  const firstChunk = Math.floor(range.start / chunkBytes);
  const lastChunk = Math.floor(range.end / chunkBytes);
  if (!chunkBytes || firstChunk >= chunkCount || lastChunk >= chunkCount) throw new Error("Song audio range is invalid");
  const chunks: Uint8Array[] = [];
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    const part = index === 0 ? firstPart : await getAudioStore().get(`${prefix}${String(index).padStart(3, "0")}`, { type: "arrayBuffer" });
    if (!part) throw new Error("Song audio chunk is missing");
    chunks.push(new Uint8Array(part));
  }
  const audio = new Uint8Array(range.end - range.start + 1);
  let written = 0;
  for (let index = 0; index < chunks.length && written < audio.byteLength; index += 1) {
    const chunkNumber = firstChunk + index;
    const chunkStart = chunkNumber * chunkBytes;
    const sourceStart = Math.max(0, range.start - chunkStart);
    const sourceEnd = Math.min(chunks[index].byteLength, range.end - chunkStart + 1);
    const slice = chunks[index].subarray(sourceStart, sourceEnd);
    audio.set(slice, written);
    written += slice.byteLength;
  }
  if (written !== audio.byteLength) throw new Error("Song audio range is incomplete");
  return audio;
}

async function serveAudio(request: Request, db: Awaited<ReturnType<typeof getDatabase>>, ownerMemberId: string) {
  const versionId = cleanId(new URL(request.url).searchParams.get("versionId"));
  const version = versionId ? await ownedVersion(db, ownerMemberId, versionId) : null;
  if (!version?.audio_blob_prefix || !version.audio_chunk_count || !version.audio_byte_size) return json({ message: "Song audio was not found" }, 404);
  const byteSize = Number(version.audio_byte_size);
  const range = requestedByteRange(request.headers.get("range"), byteSize);
  if (range === false) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${byteSize}`, "Cache-Control": "private, no-store" } });
  const headers: Record<string, string> = {
    "Content-Type": String(version.audio_content_type || "application/octet-stream"),
    "Content-Length": String(range ? range.end - range.start + 1 : byteSize),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${String(version.audio_filename || "song-audio").replace(/[^a-zA-Z0-9._ -]/g, "")}"`,
    "Vary": "Range",
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${byteSize}`;
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  if (range) return new Response(await readAudioRange(version, range), { status: 206, headers });
  const prefix = String(version.audio_blob_prefix);
  const chunkCount = Number(version.audio_chunk_count);
  const audio = new ReadableStream({
    async start(controller) {
      try {
        for (let index = 0; index < chunkCount; index += 1) {
          const part = await getAudioStore().get(`${prefix}${String(index).padStart(3, "0")}`, { type: "arrayBuffer" });
          if (!part) throw new Error("Song audio chunk is missing");
          controller.enqueue(new Uint8Array(part));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(audio, { headers });
}

export default async function songCatalogAudioHandler(request: Request) {
  if (!["GET", "HEAD", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, HEAD, POST" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Join or sign in to use song audio" }, 401);
    const membership = await ensureMembership(db, user);
    if (["GET", "HEAD"].includes(request.method)) return serveAudio(request, db, membership.member_id);
    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin audio uploads are not accepted" }, 403); }
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return uploadChunk(request, db, membership.member_id);
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || payload.action !== "finalize_upload") return json({ message: "Choose a supported audio action" }, 400);
    return finalizeUpload(payload, db, membership.member_id);
  } catch (error) {
    console.error("Song catalog audio failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Song audio is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/song-catalog/audio" };
