import { createHash } from "node:crypto";

export const AUDIO_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const MASTER_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export function uploadError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

export function resumableUploadId(value) {
  return /^[a-f0-9]{64}$/.test(String(value || "")) ? String(value) : "";
}

export function uploadSessionKey(prefix) {
  return `${prefix}session`;
}

export async function ensureUploadSession(store, prefix, details, create = async () => ({}), discard = async () => {}) {
  const key = uploadSessionKey(prefix);
  let session = await store.get(key, { type: "json" });
  if (!session) {
    const candidate = { ...details, ...await create(), createdAt: new Date().toISOString() };
    try {
      const result = await store.setJSON(key, candidate, { onlyIfNew: true });
      session = result.modified ? candidate : await store.get(key, { type: "json" });
      if (!result.modified) await discard(candidate);
    } catch (error) {
      // A lost write response may still have committed the session.
      session = await store.get(key, { type: "json" });
      if (!session || session.storageUploadId !== candidate.storageUploadId) await discard(candidate);
      if (!session) throw error;
    }
  }
  if (!session || Object.keys(details).some(key => session[key] !== details[key])) {
    throw uploadError("This upload identifier belongs to a different file.");
  }
  return session;
}

export async function confirmedUploadBytes(store, prefix, session) {
  let uploadedBytes = 0;
  const chunkCount = Math.ceil(session.byteSize / session.chunkSize);
  for (let index = 0; index < chunkCount; index += 1) {
    const part = await store.getMetadata(`${prefix}parts/${String(index).padStart(3, "0")}`);
    if (!part) break;
    const expected = Math.min(session.chunkSize, session.byteSize - uploadedBytes);
    if (part.metadata?.byteSize !== expected || !part.metadata?.sha256) {
      throw uploadError("The saved upload chunk is invalid.");
    }
    uploadedBytes += expected;
  }
  return uploadedBytes;
}

export async function appendUploadChunk(store, prefix, session, start, bytes) {
  if (!Number.isSafeInteger(start) || start < 0 || start >= session.byteSize || start % session.chunkSize) {
    throw uploadError("The upload offset is invalid.", 400);
  }
  const expected = Math.min(session.chunkSize, session.byteSize - start);
  if (bytes.byteLength !== expected) throw uploadError("The upload chunk size is invalid.", 400);
  const uploadedBytes = await confirmedUploadBytes(store, prefix, session);
  if (start > uploadedBytes) throw uploadError("Upload chunks must be sent in order.");
  const key = `${prefix}parts/${String(start / session.chunkSize).padStart(3, "0")}`;
  const sha256 = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  // Immutable parts make simultaneous retries safe across serverless instances.
  const result = await store.set(key, bytes, { onlyIfNew: true, metadata: { byteSize: expected, sha256 } });
  if (!result.modified) {
    const saved = await store.getMetadata(key);
    if (saved?.metadata?.sha256 !== sha256 || saved?.metadata?.byteSize !== expected) {
      throw uploadError("A different chunk is already stored at that offset.");
    }
  }
  return confirmedUploadBytes(store, prefix, session);
}

export async function readUploadChunk(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) throw uploadError("An upload chunk is required.", 400);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw uploadError("The upload chunk is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
