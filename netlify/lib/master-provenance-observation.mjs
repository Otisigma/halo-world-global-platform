import { createHash } from "node:crypto";
import { audioChunkKey, AUDIO_CHUNK_MAX_BYTES, AUDIO_UPLOAD_MAX_CHUNKS } from "./chunked-audio-upload.mjs";
import { MASTER_UPLOAD_MAX_BYTES, isOwnedMasterObjectKey, presignObjectUrl } from "./direct-upload-storage.mjs";

// An observation authenticates only the byte sequence read, not a stable canonical object.
export function describeMasterSource(row, ownerId, songId, versionId) {
  const size = Number(row.audio_byte_size);
  const key = String(row.audio_storage_key || "");
  const prefix = String(row.audio_blob_prefix || "");
  const count = Number(row.audio_chunk_count || 0);
  if (!Number.isSafeInteger(size) || size < 1 || size > MASTER_UPLOAD_MAX_BYTES) throw new Error("Invalid master size");
  let type;
  if (key && !prefix && isOwnedMasterObjectKey(key, { ownerMemberId: ownerId, songId, versionId })) type = "direct";
  else if (!key && prefix.startsWith(`${ownerId}/${versionId}/`) && /^[a-zA-Z0-9/-]+\/parts\/$/.test(prefix)
    && Number.isInteger(count) && count >= 1 && count <= AUDIO_UPLOAD_MAX_CHUNKS && size <= count * AUDIO_CHUNK_MAX_BYTES) type = "chunks";
  else throw new Error("Invalid master source");
  const id = createHash("sha256").update(JSON.stringify([type, key, prefix, count, size])).digest("hex");
  return { type, id, key, prefix, count, size };
}

function withinDeadline(promise, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Error("Storage read timed out"));
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Storage read timed out")), remaining); })])
    .finally(() => clearTimeout(timer));
}

async function* boundedStream(stream, limit, deadline) {
  if (!stream || typeof stream.getReader !== "function") throw new Error("Storage stream unavailable");
  const reader = stream.getReader();
  let total = 0;
  let ended = false;
  try {
    while (true) {
      const item = await withinDeadline(reader.read(), deadline);
      if (item.done) { ended = true; break; }
      if (!(item.value instanceof Uint8Array)) throw new Error("Invalid storage bytes");
      total += item.value.byteLength;
      if (total > limit) throw new Error("Storage object exceeds bound");
      yield item.value;
    }
  } finally {
    if (!ended) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* readObservedMaster(source, { blobStore, storage, fetchImpl = fetch, timeoutMs = 30000 }) {
  const deadline = Date.now() + timeoutMs;
  if (source.type === "direct") {
    if (!storage) throw new Error("Storage unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await withinDeadline(fetchImpl(presignObjectUrl({ config: storage, key: source.key, expiresIn: 60 }), {
        method: "GET", redirect: "error", signal: controller.signal,
      }), deadline);
      if (!response.ok) throw new Error("Storage read failed");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) !== source.size)) throw new Error("Storage length mismatch");
      yield* boundedStream(response.body, source.size, deadline);
    } finally { controller.abort(); clearTimeout(timer); }
    return;
  }
  for (let index = 0; index < source.count; index++) {
    let abandoned = false;
    const pending = blobStore.get(audioChunkKey(source.prefix, index), { type: "stream" }).then(stream => {
      if (abandoned && stream?.cancel) stream.cancel().catch(() => {});
      return stream;
    });
    let stream;
    try { stream = await withinDeadline(pending, deadline); }
    catch (error) { abandoned = true; throw error; }
    yield* boundedStream(stream, Math.min(AUDIO_CHUNK_MAX_BYTES, source.size), deadline);
  }
}
