// Chunk-session rules for large song-version audio uploads (alternate versions, WAV masters, stems).
// Clients upload numbered parts to /api/song-catalog/audio in any order and retry freely; each part
// lands on a deterministic key, carries the session's declared shape in blob metadata, and is only
// assembled (streamed back in index order) after finalize proves the set is exact and consistent.
import { createHash } from "node:crypto";

export const AUDIO_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
export const AUDIO_UPLOAD_MAX_BYTES = 128 * 1024 * 1024;
export const AUDIO_UPLOAD_MAX_CHUNKS = Math.ceil(AUDIO_UPLOAD_MAX_BYTES / AUDIO_CHUNK_MAX_BYTES);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const audioChunkKey = (prefix, index) => `${prefix}${String(index).padStart(3, "0")}`;
export const audioUploadPrefix = (ownerMemberId, versionId, uploadId) => `${ownerMemberId}/${versionId}/${uploadId}/parts/`;

export function cleanChunkChecksum(value) {
  const checksum = String(value ?? "").trim().toLowerCase();
  return SHA256_PATTERN.test(checksum) ? checksum : "";
}

export async function sha256OfBlob(blob) {
  return createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
}

/** Validates the declared upload shape and this chunk's place in it before anything is stored. */
export function validateChunkSequence({ chunkIndex, chunkCount, byteSize, chunkBytes }) {
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > AUDIO_UPLOAD_MAX_CHUNKS
    || chunkIndex < 0 || chunkIndex >= chunkCount) {
    return { ok: false, status: 400, message: "The audio upload sequence is invalid" };
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > AUDIO_UPLOAD_MAX_BYTES) {
    return { ok: false, status: 413, message: "Song audio uploads are limited to 128 MB" };
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > AUDIO_CHUNK_MAX_BYTES) {
    return { ok: false, status: 413, message: "That audio upload chunk is invalid" };
  }
  // Every part but the last is full-size, so a non-final part must split the file into exactly chunkCount parts.
  if (chunkIndex < chunkCount - 1 && Math.ceil(byteSize / chunkBytes) !== chunkCount) {
    return { ok: false, status: 400, message: "That chunk size does not match the declared upload" };
  }
  if (chunkIndex === chunkCount - 1 && chunkBytes > byteSize) {
    return { ok: false, status: 400, message: "That chunk size does not match the declared upload" };
  }
  return { ok: true };
}

/**
 * Stores one part on its deterministic key so retries overwrite instead of duplicating. Parts that
 * disagree with the session's declared shape, or whose bytes do not match the client's checksum,
 * are refused so a stale or corrupted retry can never be mixed into another upload.
 */
export async function storeAudioChunk(store, { prefix, chunkIndex, chunkCount, byteSize, chunk, checksum = "" }) {
  const sequence = validateChunkSequence({ chunkIndex, chunkCount, byteSize, chunkBytes: chunk?.size });
  if (!sequence.ok) return sequence;
  const sha256 = await sha256OfBlob(chunk);
  if (checksum && checksum !== sha256) {
    return { ok: false, status: 422, message: "That audio chunk was corrupted in transit. Retry the chunk." };
  }
  const stored = await store.list({ prefix });
  const siblingKey = stored.blobs.map(blob => String(blob?.key || "")).find(key => key !== audioChunkKey(prefix, chunkIndex));
  if (siblingKey) {
    const sibling = (await store.getMetadata(siblingKey))?.metadata || {};
    if (Number(sibling.chunkCount) !== chunkCount || Number(sibling.byteSize) !== byteSize) {
      return { ok: false, status: 409, message: "This chunk belongs to a different upload. Start a new upload session." };
    }
  }
  await store.set(audioChunkKey(prefix, chunkIndex), chunk, { metadata: { size: chunk.size, chunkCount, byteSize, sha256 } });
  return { ok: true, chunkIndex, sha256 };
}

/**
 * Inspects every stored part of a session. A set is complete only when parts 0..N-1 all exist,
 * share the declared shape, every part but the last has the same size, and the sizes sum to byteSize.
 */
export async function inspectAudioUpload(store, { prefix, chunkCount, byteSize }) {
  const stored = await store.list({ prefix });
  const keys = new Set(stored.blobs.map(blob => String(blob?.key || "")));
  const parts = await Promise.all(Array.from({ length: chunkCount }, async (_, index) => {
    const key = audioChunkKey(prefix, index);
    if (!keys.has(key)) return null;
    const metadata = (await store.getMetadata(key))?.metadata || {};
    return { index, size: Number(metadata.size), chunkCount: Number(metadata.chunkCount), byteSize: Number(metadata.byteSize), sha256: String(metadata.sha256 || "") };
  }));
  const receivedChunks = parts.filter(Boolean).map(part => part.index);
  const missingChunks = parts.map((part, index) => part ? -1 : index).filter(index => index >= 0);
  const fullSize = parts.find(part => part && part.index < chunkCount - 1)?.size;
  const invalidChunks = parts.filter(part => part && (
    !Number.isSafeInteger(part.size) || part.size < 1 || part.size > AUDIO_CHUNK_MAX_BYTES
    || part.chunkCount !== chunkCount || part.byteSize !== byteSize
    || (part.index < chunkCount - 1 && part.size !== fullSize)
    || (part.index === chunkCount - 1 && fullSize !== undefined && part.size > fullSize)
  )).map(part => part.index);
  const storedBytes = parts.reduce((sum, part) => sum + (part && Number.isSafeInteger(part.size) ? part.size : 0), 0);
  // With every full-size part consistent, a wrong total can only come from the final part.
  if (!missingChunks.length && !invalidChunks.length && storedBytes !== byteSize) invalidChunks.push(chunkCount - 1);
  const complete = missingChunks.length === 0 && invalidChunks.length === 0 && storedBytes === byteSize;
  return {
    complete,
    chunkCount,
    byteSize,
    storedBytes,
    receivedChunks,
    missingChunks,
    invalidChunks,
    chunkChecksums: Object.fromEntries(parts.filter(part => part?.sha256).map(part => [part.index, part.sha256])),
  };
}

/** Deletes the parts finalize rejected so the client's retry re-uploads exactly those chunks. */
export async function discardAudioChunks(store, prefix, indexes) {
  await Promise.all(indexes.map(index => store.delete(audioChunkKey(prefix, index))));
}
