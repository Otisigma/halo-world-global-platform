import { createHash, randomUUID } from "node:crypto";
import { uploadBuildRevision } from "./upload-build.mjs";

export const AUDIO_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const MASTER_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const uploadProtocol = () => ({ protocolVersion: 2, revision: uploadBuildRevision || process.env.COMMIT_REF || null });

export function requireUploadProtocol(request) {
  const protocol = request.headers.get("x-upload-protocol");
  if (protocol && protocol !== "2") throw uploadError("This upload protocol is incompatible. Reload the page.", 409);
  const revision = request.headers.get("x-upload-revision");
  const serverRevision = uploadProtocol().revision;
  if (revision && serverRevision && revision !== serverRevision) {
    throw uploadError("The upload page and server are running different builds. Refresh the page before retrying.", 409);
  }
}

export function uploadStatusFields(session, uploadedBytes) {
  return { ...uploadProtocol(), uploadedBytes, chunkSize: session.chunkSize,
    generation: String(session.generation || session.storageUploadId || session.createdAt),
    resetReason: session.resetReason || null, phase: session.phase || "transferring",
    result: session.result ? { ...session.result, ...uploadProtocol() } : null };
}

export function uploadPartsPrefix(prefix, session) {
  return session.partsPrefix || `${prefix}parts/`;
}

export function requireUploadGeneration(session, generation) {
  if ((generation || session.resetFromGeneration) && generation !== uploadStatusFields(session, 0).generation) {
    throw uploadError("This request belongs to an older upload attempt. Check status before retrying.", 409);
  }
}

export async function restartUploadSession(store, prefix, expectedGeneration, state = {}, create = async () => ({}), discard = async () => {}) {
  const key = uploadSessionKey(prefix);
  const saved = await store.getWithMetadata(key, { type: "json" });
  if (!saved?.etag) throw uploadError("Upload state could not be checked safely. Please retry.", 503);
  if (!expectedGeneration || uploadStatusFields(saved.data, 0).generation !== expectedGeneration) {
    throw uploadError("The upload attempt changed. Check status before restarting.");
  }
  const generation = randomUUID();
  const candidate = { ...saved.data, ...state, ...await create(generation), generation,
    resetFromGeneration: expectedGeneration, resetReason: "user_restart", phase: "transferring", result: null,
    createdAt: new Date().toISOString() };
  try {
    const result = await store.setJSON(key, candidate, { onlyIfMatch: saved.etag });
    const confirmed = await store.get(key, { type: "json" });
    if (!result.modified || confirmed?.generation !== generation) {
      throw uploadError("The upload attempt changed. Check status before restarting.");
    }
    return confirmed;
  } catch (error) {
    const confirmed = await store.get(key, { type: "json" });
    if (confirmed?.generation === generation) return confirmed;
    await discard(candidate);
    throw error;
  }
}

export async function saveUploadPhase(store, prefix, session, phase, result = null, state = {}) {
  const key = uploadSessionKey(prefix);
  const saved = await store.getWithMetadata(key, { type: "json" });
  if (saved && !saved.etag) throw uploadError("Upload state could not be checked safely. Please retry.", 503);
  if (!saved || (saved.data.generation || saved.data.storageUploadId || saved.data.createdAt)
    !== (session.generation || session.storageUploadId || session.createdAt)) {
    throw uploadError("The upload session changed. Check status before retrying.");
  }
  const candidate = { ...saved.data, ...state, phase, result };
  const matches = value => value && JSON.stringify(value) === JSON.stringify(candidate);
  if (["registered", "review_pending"].includes(saved.data.phase) && phase === "completing") return saved.data;
  try {
    const written = await store.setJSON(key, candidate, { onlyIfMatch: saved.etag });
    if (written.modified) {
      const confirmed = await store.get(key, { type: "json" });
      if (matches(confirmed)) return confirmed;
      throw uploadError("Upload state could not be confirmed. Please retry.", 503);
    }
  } catch (error) {
    const confirmed = await store.get(key, { type: "json" });
    if (matches(confirmed)) return confirmed;
    throw error;
  }
  throw uploadError("The upload session changed. Check status before retrying.");
}

export function uploadWasReplaced(session, version, registered) {
  if (registered) return false;
  if (["registered", "review_pending"].includes(session.phase)) return true;
  return Boolean(session.catalogBefore && (
    session.catalogBefore.blobPrefix !== String(version.audio_blob_prefix || "")
    || session.catalogBefore.storageKey !== String(version.audio_storage_key || "")
  ));
}

export function uploadReplacementToken(version) {
  return createHash("sha256").update(JSON.stringify({
    blobPrefix: String(version.audio_blob_prefix || ""), storageKey: String(version.audio_storage_key || ""),
  })).digest("hex");
}

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
    const candidate = { ...details, ...await create(), generation: randomUUID(), phase: "transferring",
      resetReason: null, result: null, createdAt: new Date().toISOString() };
    try {
      const result = await store.setJSON(key, candidate, { onlyIfNew: true });
      // Conditional writes in the installed SDK report modified without verifying HTTP errors.
      // Confirm durable state rather than treating that flag as proof of persistence.
      session = await store.get(key, { type: "json" });
      if (result.modified && !session) throw uploadError("Upload session could not be confirmed. Please retry.", 503);
      if (session?.generation !== candidate.generation) await discard(candidate);
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
    const part = await store.getMetadata(`${uploadPartsPrefix(prefix, session)}${String(index).padStart(3, "0")}`);
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
  const key = `${uploadPartsPrefix(prefix, session)}${String(start / session.chunkSize).padStart(3, "0")}`;
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
