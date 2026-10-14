// Immutable chunk sessions: Netlify's conditional writes, not process-local locks, arbitrate retries.
import { createHash } from "node:crypto";

export const AUDIO_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
export const AUDIO_UPLOAD_MAX_BYTES = 128 * 1024 * 1024;
export const AUDIO_UPLOAD_MAX_CHUNKS = Math.ceil(AUDIO_UPLOAD_MAX_BYTES / AUDIO_CHUNK_MAX_BYTES);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const conflict = () => ({ ok: false, status: 409, message: "This chunk belongs to a different upload. Start a new upload session." });
const finalized = () => ({ ok: false, status: 409, finalized: true, message: "This upload is already finalized" });
export const audioChunkKey = (prefix, index) => `${prefix}${String(index).padStart(3, "0")}`;
export const audioUploadPrefix = (ownerMemberId, versionId, uploadId) => `${ownerMemberId}/${versionId}/${uploadId}/parts/`;
export const audioSessionKey = prefix => `${prefix}session.json`;
export const audioFinalizationKey = prefix => `${prefix}finalized.json`;
export const audioRetirementKey = prefix => `${prefix}retired.json`;

const retired = receipt => ({
  ok: false, status: 409, retired: true, successorUploadId: receipt.successorUploadId,
  message: "This upload was deleted. Start a new upload session.",
});

export async function getAudioUploadRetirement(store, prefix) {
  return store.get(audioRetirementKey(prefix), { type: "json" });
}

export async function retireAudioUpload(store, prefix, successorUploadId) {
  const receipt = { successorUploadId };
  const result = await store.setJSON(audioRetirementKey(prefix), receipt, { onlyIfNew: true });
  return result.modified ? receipt : getAudioUploadRetirement(store, prefix);
}

/** No coercion of booleans, null, fractions, signs, exponents, or numeric prefixes. */
export function parseUploadInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : NaN;
}

export function cleanChunkChecksum(value) {
  const checksum = String(value ?? "").trim().toLowerCase();
  return SHA256_PATTERN.test(checksum) ? checksum : "";
}

export async function sha256OfBlob(blob) {
  return createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
}

export function validateUploadShape({ chunkCount, byteSize, chunkSize }) {
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > AUDIO_UPLOAD_MAX_CHUNKS) {
    return { ok: false, status: 400, message: "The audio upload sequence is invalid" };
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > AUDIO_UPLOAD_MAX_BYTES) {
    return { ok: false, status: 413, message: "Song audio uploads are limited to 128 MB" };
  }
  if (chunkSize !== undefined && (!Number.isSafeInteger(chunkSize) || chunkSize < 1
    || chunkSize > AUDIO_CHUNK_MAX_BYTES || Math.ceil(byteSize / chunkSize) !== chunkCount)) {
    return { ok: false, status: 400, message: "That chunk size does not match the declared upload" };
  }
  return { ok: true };
}

export function validateChunkSequence({ chunkIndex, chunkCount, byteSize, chunkBytes, chunkSize, offset }) {
  const shape = validateUploadShape({ chunkCount, byteSize, chunkSize });
  if (!shape.ok) return shape;
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
    return { ok: false, status: 400, message: "The audio upload sequence is invalid" };
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > AUDIO_CHUNK_MAX_BYTES) {
    return { ok: false, status: 413, message: "That audio upload chunk is invalid" };
  }
  // Old clients omit chunkSize; even a last-part-first upload determines the uniform layout.
  const size = chunkSize ?? (chunkCount === 1 ? byteSize
    : chunkIndex < chunkCount - 1 ? chunkBytes : (byteSize - chunkBytes) / (chunkCount - 1));
  if (!validateUploadShape({ chunkCount, byteSize, chunkSize: size }).ok
    || chunkBytes !== (chunkIndex === chunkCount - 1 ? byteSize - size * chunkIndex : size)) {
    return { ok: false, status: 400, message: "That chunk size does not match the declared upload" };
  }
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset !== chunkIndex * size)) {
    return { ok: false, status: 400, message: "That chunk offset does not match the declared upload" };
  }
  return { ok: true, chunkSize: size };
}

const matchesShape = (manifest, { chunkCount, byteSize, chunkSize }) => manifest.chunkCount === chunkCount
  && manifest.byteSize === byteSize && (chunkSize === undefined || manifest.chunkSize === chunkSize);

export async function storeAudioChunk(store, { prefix, chunkIndex, chunkCount, byteSize, chunk, checksum = "", chunkSize, offset }) {
  const sequence = validateChunkSequence({ chunkIndex, chunkCount, byteSize, chunkBytes: chunk?.size, chunkSize, offset });
  if (!sequence.ok) return sequence;
  const sha256 = await sha256OfBlob(chunk);
  if (checksum && checksum !== sha256) {
    return { ok: false, status: 422, message: "That audio chunk was corrupted in transit. Retry the chunk." };
  }
  const retirement = await getAudioUploadRetirement(store, prefix);
  if (retirement) return retired(retirement);
  if (await store.get(audioFinalizationKey(prefix), { type: "json" })) return finalized();
  const previous = await store.get(audioSessionKey(prefix), { type: "json" });
  let canonicalSize = sequence.chunkSize;
  if (previous) {
    if (!matchesShape(previous, { chunkCount, byteSize, chunkSize })) return conflict();
    canonicalSize = previous.chunkSize;
  } else {
    // Adopt legacy parts only when their original declared shape and uniform layout agree.
    const legacy = await Promise.all(Array.from({ length: AUDIO_UPLOAD_MAX_CHUNKS }, (_, index) => store.getMetadata(audioChunkKey(prefix, index))));
    for (let index = 0; index < legacy.length; index += 1) {
      const part = legacy[index]?.metadata;
      if (!part) continue;
      if (!matchesShape(part, { chunkCount, byteSize })
        || !validateChunkSequence({ chunkIndex: index, chunkCount, byteSize, chunkBytes: part.size, chunkSize: canonicalSize }).ok) return conflict();
    }
  }
  const pinnedSequence = validateChunkSequence({ chunkIndex, chunkCount, byteSize, chunkBytes: chunk.size, chunkSize: canonicalSize, offset });
  if (!pinnedSequence.ok) return conflict();
  const shape = { chunkCount, byteSize, chunkSize: canonicalSize };
  // First writers contend on one durable manifest before any part can be accepted.
  const claim = await store.setJSON(audioSessionKey(prefix), shape, { onlyIfNew: true });
  const manifest = claim.modified ? shape : await store.get(audioSessionKey(prefix), { type: "json" });
  if (!manifest || !matchesShape(manifest, { chunkCount, byteSize, chunkSize })
    || !validateChunkSequence({ chunkIndex, chunkCount, byteSize, chunkBytes: chunk.size, chunkSize: manifest.chunkSize, offset }).ok) return conflict();
  // Omitted chunkSize is compatible with an explicitly pinned single-chunk layout.
  shape.chunkSize = manifest.chunkSize;
  if (await store.get(audioFinalizationKey(prefix), { type: "json" })) return finalized();
  const metadata = { size: chunk.size, ...shape, sha256 };
  const result = await store.set(audioChunkKey(prefix, chunkIndex), chunk, { onlyIfNew: true, metadata });
  if (!result.modified) {
    const existing = (await store.getMetadata(audioChunkKey(prefix, chunkIndex)))?.metadata;
    if (!existing || !matchesShape(existing, { ...shape, chunkSize: existing.chunkSize === undefined ? undefined : shape.chunkSize })
      || existing.size !== chunk.size || existing.sha256 !== sha256) return conflict();
  }
  return { ok: true, chunkIndex, sha256 };
}

/** Strong per-key reads avoid list pagination and eventually consistent listings. */
export async function inspectAudioUpload(store, { prefix, chunkCount, byteSize, chunkSize }) {
  const shape = validateUploadShape({ chunkCount, byteSize, chunkSize });
  if (!shape.ok) return shape;
  const manifest = await store.get(audioSessionKey(prefix), { type: "json" });
  if (manifest && !matchesShape(manifest, { chunkCount, byteSize, chunkSize })) return conflict();
  const parts = await Promise.all(Array.from({ length: chunkCount }, async (_, index) => {
    const metadata = (await store.getMetadata(audioChunkKey(prefix, index)))?.metadata;
    return metadata ? { index, ...metadata } : null;
  }));
  const receivedChunks = parts.filter(Boolean).map(part => part.index);
  const missingChunks = parts.map((part, index) => part ? -1 : index).filter(index => index >= 0);
  const fullSize = manifest?.chunkSize ?? (chunkCount === 1 ? chunkSize ?? parts[0]?.size
    : parts.find(part => part && part.index < chunkCount - 1)?.size
      ?? (parts[chunkCount - 1] ? (byteSize - parts[chunkCount - 1].size) / (chunkCount - 1) : undefined));
  if (chunkSize !== undefined && fullSize !== undefined && chunkSize !== fullSize) return conflict();
  const invalidChunks = parts.filter(part => part && (
    !Number.isSafeInteger(part.size) || part.size < 1 || part.size > AUDIO_CHUNK_MAX_BYTES
    || part.chunkCount !== chunkCount || part.byteSize !== byteSize
    || (manifest && part.chunkSize !== undefined && part.chunkSize !== manifest.chunkSize)
    || !SHA256_PATTERN.test(part.sha256 || "")
    || !validateChunkSequence({ chunkIndex: part.index, chunkCount, byteSize, chunkBytes: part.size, chunkSize: fullSize }).ok
    || (part.index < chunkCount - 1 && part.size !== fullSize)
    || (part.index === chunkCount - 1 && fullSize !== undefined && part.size !== byteSize - fullSize * part.index)
  )).map(part => part.index);
  const storedBytes = parts.reduce((sum, part) => sum + (part && Number.isSafeInteger(part.size) ? part.size : 0), 0);
  if (!missingChunks.length && !invalidChunks.length && storedBytes !== byteSize) invalidChunks.push(chunkCount - 1);
  let confirmedBytes = 0;
  for (const part of parts) {
    if (!part || invalidChunks.includes(part.index)) break;
    confirmedBytes += part.size;
  }
  return {
    ok: true,
    complete: missingChunks.length === 0 && invalidChunks.length === 0 && storedBytes === byteSize,
    chunkCount,
    byteSize,
    chunkSize: fullSize ?? chunkSize ?? null,
    storedBytes,
    confirmedBytes,
    receivedChunks,
    missingChunks,
    invalidChunks,
    chunkChecksums: Object.fromEntries(parts.filter(part => part?.sha256 && !invalidChunks.includes(part.index)).map(part => [part.index, part.sha256])),
  };
}

/** A durable seal pins finalize metadata before the database pointer is published; retries recover it. */
export async function sealAudioUpload(store, { prefix, chunkCount, byteSize, chunkSize, ...details }) {
  const retirement = await getAudioUploadRetirement(store, prefix);
  if (retirement) return retired(retirement);
  const status = await inspectAudioUpload(store, { prefix, chunkCount, byteSize, chunkSize });
  if (!status.ok) return status;
  if (!status.complete) return { ...status, ok: false, status: 409, message: "The audio upload is incomplete. Re-send missing chunks, or start a new session for conflicting chunks." };
  const receipt = { chunkCount, byteSize, chunkSize: status.chunkSize, ...details };
  const result = await store.setJSON(audioFinalizationKey(prefix), receipt, { onlyIfNew: true });
  const sealed = result.modified ? receipt : await store.get(audioFinalizationKey(prefix), { type: "json" });
  if (!sealed || !matchesShape(sealed, { chunkCount, byteSize, chunkSize })) return conflict();
  return { ok: true, receipt: sealed };
}
