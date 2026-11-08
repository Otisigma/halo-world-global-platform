import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DOMAIN = "HALO master provenance record v1\n";
const VERSION = /^[A-Za-z0-9_-]{1,64}$/;
const HEX = /^[0-9a-f]{64}$/;
const FIELDS = ["schemaVersion", "keyVersion", "ownerId", "songId", "versionId", "sourceType", "sourceId", "byteSize", "sha256", "createdAt"];
const configurationError = message => Object.assign(new Error(message), { code: "provenance_keys_missing" });

/**
 * Load versioned, independently generated keys from a server-side JSON object.
 * Keys are canonical base64-encoded random bytes, not passwords.
 */
export function loadProvenanceKeys(env = process.env) {
  let encoded;
  try {
    encoded = JSON.parse(env.HALO_PROVENANCE_KEYS || "");
  } catch {
    throw configurationError("Provenance keys are not configured correctly");
  }
  const activeVersion = env.HALO_PROVENANCE_ACTIVE_KEY;
  if (!encoded || Array.isArray(encoded) || typeof encoded !== "object" || typeof activeVersion !== "string" || !VERSION.test(activeVersion)) {
    throw configurationError("Provenance keys are not configured correctly");
  }
  const keys = new Map();
  for (const [version, value] of Object.entries(encoded)) {
    if (!VERSION.test(version) || typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw configurationError("Provenance keys are not configured correctly");
    }
    const key = Buffer.from(value, "base64");
    if (key.length < 32 || key.toString("base64") !== value) throw configurationError("Provenance keys are not configured correctly");
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) throw configurationError("Provenance active key is unavailable");
  return { activeVersion, keys };
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const keys = Object.keys(record);
  if (keys.length !== FIELDS.length || FIELDS.some(field => !Object.hasOwn(record, field))) return false;
  if (record.schemaVersion !== 1 || typeof record.keyVersion !== "string" || !VERSION.test(record.keyVersion)) return false;
  if (![record.ownerId, record.songId, record.versionId].every(value => validText(value, 128))) return false;
  if (!["direct", "chunks"].includes(record.sourceType) || !validText(record.sourceId, 400)) return false;
  if (!Number.isSafeInteger(record.byteSize) || record.byteSize < 1 || typeof record.sha256 !== "string" || !HEX.test(record.sha256)) return false;
  if (typeof record.createdAt !== "string") return false;
  const time = new Date(record.createdAt);
  return !Number.isNaN(time.getTime()) && time.toISOString() === record.createdAt;
}

function encodedRecord(record) {
  return DOMAIN + JSON.stringify(FIELDS.map(field => record[field]));
}

function getKey(keyring, version) {
  const key = keyring?.keys instanceof Map ? keyring.keys.get(version) : null;
  if (!Buffer.isBuffer(key) || key.length < 32) throw configurationError("Provenance key version is unavailable");
  return key;
}

/** Hash actual bytes as a bounded stream, rejecting truncation, excess and read failures. */
export async function hashMasterBytes(bytes, { expectedBytes, maxBytes }) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < expectedBytes) {
    throw new Error("Invalid expected master size");
  }
  if (!bytes || typeof bytes[Symbol.asyncIterator] !== "function") throw new Error("A byte stream is required");
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of bytes) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Master stream returned non-byte data");
    byteSize += chunk.byteLength;
    if (!Number.isSafeInteger(byteSize) || byteSize > expectedBytes || byteSize > maxBytes) throw new Error("Master stream exceeds expected size");
    hash.update(chunk);
  }
  if (byteSize !== expectedBytes) throw new Error("Master stream ended before expected size");
  return { byteSize, sha256: hash.digest("hex") };
}

/**
 * Seal only after reading the actual bytes. Callers must obtain the stream from authorized,
 * stable storage and arrange atomic persistence; this primitive does neither.
 */
export async function sealMasterBytes({ bytes, expectedBytes, maxBytes, ownerId, songId, versionId, sourceType, sourceId, createdAt, keyring }) {
  const keyVersion = keyring?.activeVersion;
  getKey(keyring, keyVersion);
  const record = { schemaVersion: 1, keyVersion, ownerId, songId, versionId, sourceType, sourceId, byteSize: expectedBytes, sha256: "0".repeat(64), createdAt };
  if (!validRecord(record)) throw new Error("Invalid provenance record");
  const digest = await hashMasterBytes(bytes, { expectedBytes, maxBytes });
  return sealObservedDigest({ ...record, sha256: digest.sha256 }, keyring);
}

// Server-only: callers must authenticate the storage observation, never use a client digest.
export function sealObservedDigest(fields, keyring) {
  const record = { ...fields, keyVersion: keyring?.activeVersion };
  const key = getKey(keyring, record.keyVersion);
  if (!validRecord(record)) throw new Error("Invalid provenance record");
  const mac = createHmac("sha256", key).update(encodedRecord(record)).digest("hex");
  return { record, mac };
}

/** Authenticate the record itself; this does not establish that stored bytes still match. */
export function verifyProvenanceRecord(seal, keyring) {
  const { record, mac } = seal || {};
  if (!validRecord(record) || typeof mac !== "string" || !HEX.test(mac)) return false;
  const expected = createHmac("sha256", getKey(keyring, record.keyVersion)).update(encodedRecord(record)).digest();
  return timingSafeEqual(expected, Buffer.from(mac, "hex"));
}

/** Authenticate the record and independently read and compare all supplied bytes. */
export async function verifyMasterBytes(seal, bytes, { maxBytes, keyring }) {
  if (!verifyProvenanceRecord(seal, keyring)) return false;
  const actual = await hashMasterBytes(bytes, { expectedBytes: seal.record.byteSize, maxBytes });
  return timingSafeEqual(Buffer.from(actual.sha256, "hex"), Buffer.from(seal.record.sha256, "hex"));
}
