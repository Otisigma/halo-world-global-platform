import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directUploadConfig, presignObjectUrl, MASTER_UPLOAD_MAX_BYTES } from "./direct-upload-storage.mjs";
import { hashMasterBytes } from "./master-provenance.mjs";
import { SNAPSHOT_FIELDS, canonicalSnapshotPayload } from "../../lib/retained-record.js";

const FIELDS = SNAPSHOT_FIELDS;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const SNAPSHOT_LIMITATION = "Signed retained snapshot of bytes read. Original uploads and playback remain mutable; chunk reads can combine concurrent writes. Signature and retention do not establish copyright ownership or an independently witnessed creation time.";

export function retainedMasterConfig(env = process.env) {
  if (env.HALO_RETAINED_MASTER_ENABLED !== "true") return null;
  const storage = directUploadConfig({
    HALO_MASTER_STORAGE_BUCKET: env.HALO_PROVENANCE_STORAGE_BUCKET,
    HALO_MASTER_STORAGE_REGION: env.HALO_PROVENANCE_STORAGE_REGION,
    HALO_MASTER_STORAGE_ENDPOINT: env.HALO_PROVENANCE_STORAGE_ENDPOINT,
    HALO_MASTER_STORAGE_FORCE_PATH_STYLE: env.HALO_PROVENANCE_STORAGE_FORCE_PATH_STYLE,
    HALO_MASTER_STORAGE_ACCESS_KEY_ID: env.HALO_PROVENANCE_STORAGE_ACCESS_KEY_ID,
    HALO_MASTER_STORAGE_SECRET_ACCESS_KEY: env.HALO_PROVENANCE_STORAGE_SECRET_ACCESS_KEY,
  });
  const retentionDays = Number(env.HALO_PROVENANCE_RETENTION_DAYS);
  if (!storage || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("Retained snapshot storage or retention is not configured");
  }
  return { storage, retentionDays };
}

export function loadPublicSnapshotKeys(env = process.env) {
  const encoded = JSON.parse(env.HALO_PROVENANCE_PUBLIC_KEYS || "");
  if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) throw new Error("Snapshot verification keys are unavailable");
  const publicKeys = new Map();
  for (const [id, pem] of Object.entries(encoded)) {
    if (!KEY_ID.test(id) || typeof pem !== "string") throw new Error("Invalid snapshot verification key");
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Snapshot verification requires Ed25519");
    publicKeys.set(id, key);
  }
  return { publicKeys };
}

export function loadSnapshotKeys(env = process.env) {
  const keyId = env.HALO_PROVENANCE_SIGNING_KEY_ID;
  if (!KEY_ID.test(keyId || "")) throw new Error("Snapshot signing key ID is unavailable");
  const privateKey = createPrivateKey(env.HALO_PROVENANCE_SIGNING_PRIVATE_KEY || "");
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Snapshot signing requires Ed25519");
  const { publicKeys } = loadPublicSnapshotKeys(env);
  const derived = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const published = publicKeys.get(keyId)?.export({ type: "spki", format: "der" });
  if (!published || !derived.equals(published)) throw new Error("Active signing and verification keys differ");
  return { keyId, privateKey, publicKeys };
}

export function validSnapshotRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).length !== FIELDS.length
    || FIELDS.some(field => !Object.hasOwn(record, field))) return false;
  if (record.schemaVersion !== 1 || ![record.recordId, record.songId, record.versionId].every(id => typeof id === "string" && ID.test(id))
    || !KEY_ID.test(record.keyId || "") || !HEX.test(record.sha256 || "") || !HEX.test(record.storageCommitment || "")
    || !Number.isSafeInteger(record.byteSize) || record.byteSize < 1 || record.byteSize > MASTER_UPLOAD_MAX_BYTES
    || !["direct", "chunks"].includes(record.sourceType) || record.sourceConsistency !== "mutable_read") return false;
  if (record.parentRecordId !== "" && !ID.test(record.parentRecordId)) return false;
  if (!["original", "revision", "remix", "edit"].includes(record.relationship)
    || (record.parentRecordId === "") !== (record.relationship === "original")) return false;
  for (const field of ["createdAt", "retainUntil"]) {
    if (typeof record[field] !== "string" || !Number.isFinite(Date.parse(record[field]))
      || new Date(record[field]).toISOString() !== record[field]) return false;
  }
  return Date.parse(record.retainUntil) > Date.parse(record.createdAt);
}

export function snapshotPayload(record) {
  if (!validSnapshotRecord(record)) throw new Error("Invalid retained snapshot record");
  return canonicalSnapshotPayload(record);
}

export function signSnapshot(record, keys) {
  if (record.keyId !== keys.keyId) throw new Error("Snapshot signing key mismatch");
  return { record, signature: sign(null, Buffer.from(snapshotPayload(record)), keys.privateKey).toString("base64") };
}

export function verifySnapshot(envelope, keys) {
  if (!validSnapshotRecord(envelope?.record) || typeof envelope.signature !== "string") return false;
  const bytes = Buffer.from(envelope.signature, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== envelope.signature) return false;
  const key = keys.publicKeys.get(envelope.record.keyId);
  if (!key) throw new Error("Retained snapshot verification key is unavailable");
  return verify(null, Buffer.from(snapshotPayload(envelope.record)), key, bytes);
}

export function snapshotStorageCommitment(storage, key, versionId) {
  return createHash("sha256").update(JSON.stringify([storage.bucket, storage.endpoint, storage.region, key, versionId])).digest("hex");
}

async function responseBytes(response, expectedBytes, signal) {
  if (!response.ok || !response.body) throw new Error("Retained snapshot cannot be read");
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== expectedBytes) throw new Error("Retained snapshot length changed");
  async function* bytes() {
    const reader = response.body.getReader();
    let ended = false;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) { ended = true; break; }
        yield value;
      }
    } finally {
      if (!ended) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return hashMasterBytes(bytes(), { expectedBytes, maxBytes: MASTER_UPLOAD_MAX_BYTES });
}

export async function checkRetainedSnapshot({ config, key, versionId, byteSize, retainUntil, fetchImpl = fetch, timeoutMs = 30000 }) {
  if (!versionId || versionId === "null" || !Number.isFinite(Date.parse(retainUntil))
    || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MASTER_UPLOAD_MAX_BYTES) throw new Error("A valid pinned storage version and retention are required");
  const signal = AbortSignal.timeout(timeoutMs);
  const head = await fetchImpl(presignObjectUrl({ config: config.storage, method: "HEAD", key, queryParams: { versionId }, expiresIn: 60 }),
    { method: "HEAD", redirect: "error", signal });
  const retained = head.headers.get("x-amz-object-lock-retain-until-date");
  if (!head.ok || head.headers.get("x-amz-version-id") !== versionId || Number(head.headers.get("content-length")) !== byteSize
    || head.headers.get("x-amz-object-lock-mode") !== "COMPLIANCE" || !retained
    || !Number.isFinite(Date.parse(retained)) || Date.parse(retained) < Date.parse(retainUntil)
    || Date.parse(retained) <= Date.now()) throw new Error("Pinned snapshot retention could not be confirmed");
  const response = await fetchImpl(presignObjectUrl({ config: config.storage, key, queryParams: { versionId }, expiresIn: 60 }),
    { redirect: "error", signal });
  if (response.headers.get("x-amz-version-id") !== versionId) {
    await response.body?.cancel();
    throw new Error("Storage returned a different snapshot version");
  }
  return responseBytes(response, byteSize, signal);
}

export async function retainMasterBytes({ config, key, bytes, expectedBytes, now = new Date(), fetchImpl = fetch, timeoutMs = 30000 }) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MASTER_UPLOAD_MAX_BYTES) throw new Error("Invalid snapshot size");
  const retainUntil = new Date(now.getTime() + config.retentionDays * 86400000).toISOString();
  const headers = { "x-amz-object-lock-mode": "COMPLIANCE", "x-amz-object-lock-retain-until-date": retainUntil };
  const signal = AbortSignal.timeout(timeoutMs);
  const hash = createHash("sha256");
  let count = 0;
  async function* upload() {
    for await (const chunk of bytes) {
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new Error("Snapshot source returned non-byte data");
      count += chunk.byteLength;
      if (count > expectedBytes || count > MASTER_UPLOAD_MAX_BYTES) throw new Error("Snapshot source exceeds bound");
      hash.update(chunk);
      yield chunk;
    }
    if (count !== expectedBytes) throw new Error("Snapshot source is incomplete");
  }
  const directory = await mkdtemp(join(tmpdir(), "halo-retained-"));
  const filename = join(directory, "master.bin");
  try {
    await pipeline(Readable.from(upload()), createWriteStream(filename, { flags: "wx", mode: 0o600 }), { signal });
    const digest = hash.digest("hex");
    headers["x-amz-checksum-sha256"] = Buffer.from(digest, "hex").toString("base64");
    const url = presignObjectUrl({ config: config.storage, method: "PUT", key, contentType: "application/octet-stream", extraHeaders: headers, expiresIn: 60 });
    const stream = createReadStream(filename);
    let response;
    try {
      response = await fetchImpl(url, { method: "PUT", redirect: "error", signal, duplex: "half", body: stream,
        headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(expectedBytes) } });
    } finally { stream.destroy(); }
    if (!response.ok || count !== expectedBytes) throw new Error("Retained snapshot upload was not confirmed");
    const versionId = response.headers.get("x-amz-version-id");
    if (!versionId || versionId === "null") throw new Error("Snapshot storage does not provide versioning");
    const stored = await checkRetainedSnapshot({ config, key, versionId, byteSize: expectedBytes, retainUntil, fetchImpl, timeoutMs });
    if (stored.sha256 !== digest) throw new Error("Retained snapshot bytes differ from uploaded bytes");
    return { key, versionId, sha256: digest, byteSize: count, retainUntil,
      storageCommitment: snapshotStorageCommitment(config.storage, key, versionId) };
  } finally {
    await rm(filename, { force: true });
    await rm(directory, { recursive: true });
  }
}
