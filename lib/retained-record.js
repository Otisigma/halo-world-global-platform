export const SNAPSHOT_DOMAIN = "HALO retained snapshot v1\n";
export const SNAPSHOT_FIELDS = Object.freeze(["schemaVersion", "recordId", "songId", "versionId", "keyId", "sha256", "byteSize", "createdAt",
  "retainUntil", "storageCommitment", "sourceType", "sourceConsistency", "parentRecordId", "relationship"]);

export function canonicalSnapshotPayload(record) {
  if (!record || Object.keys(record).length !== SNAPSHOT_FIELDS.length
    || SNAPSHOT_FIELDS.some(field => !Object.hasOwn(record, field))) throw new Error("Invalid signed snapshot fields");
  return SNAPSHOT_DOMAIN + JSON.stringify(SNAPSHOT_FIELDS.map(field => record[field]));
}

function base64Bytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid encoded verification data");
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export async function verifySnapshotInBrowser(envelope, publishedKeys, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new Error("Secure browser cryptography is unavailable");
  const record = envelope?.record;
  if (record?.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(record.sha256 || "")
    || !Number.isSafeInteger(record.byteSize) || record.byteSize < 1 || record.byteSize > 200 * 1024 * 1024
    || record.sourceConsistency !== "mutable_read" || !Number.isFinite(Date.parse(record.createdAt))
    || !Number.isFinite(Date.parse(record.retainUntil)) || Date.parse(record.retainUntil) <= Date.parse(record.createdAt)) {
    throw new Error("Invalid signed snapshot record");
  }
  const key = publishedKeys?.keys?.find(key => key.id === record.keyId);
  if (!key) throw new Error("The snapshot verification key is not published");
  const imported = await cryptoProvider.subtle.importKey("spki", base64Bytes(key.spki), { name: "Ed25519" }, false, ["verify"]);
  const authentic = await cryptoProvider.subtle.verify("Ed25519", imported, base64Bytes(envelope.signature),
    new TextEncoder().encode(canonicalSnapshotPayload(record)));
  if (!authentic) throw new Error("Snapshot signature is invalid");
  return record;
}

export async function compareSnapshotFile(file, record, cryptoProvider = globalThis.crypto) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 100 * 1024 * 1024) {
    throw new Error("Choose a non-empty file no larger than 100 MiB");
  }
  if (file.size !== record.byteSize) return false;
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw new Error("The local file could not be read completely");
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return hex === record.sha256;
}
