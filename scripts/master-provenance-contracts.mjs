import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { hashMasterBytes, loadProvenanceKeys, sealMasterBytes, verifyMasterBytes, verifyProvenanceRecord } from "../netlify/lib/master-provenance.mjs";

const key1 = Buffer.alloc(32, 1);
const key2 = Buffer.alloc(32, 2);
const env = { HALO_PROVENANCE_ACTIVE_KEY: "v1", HALO_PROVENANCE_KEYS: JSON.stringify({ v1: key1.toString("base64"), v2: key2.toString("base64") }) };
const keyring = loadProvenanceKeys(env);
const bytes = Buffer.from("actual master bytes");
const stream = (...parts) => Readable.from(parts);
const source = { expectedBytes: bytes.length, maxBytes: 100, ownerId: "owner", songId: "song", versionId: "master", sourceType: "direct", sourceId: "masters/owner/song/master/upload/audio.wav", createdAt: "2026-11-08T03:00:00.000Z", keyring };
const seal = await sealMasterBytes({ ...source, bytes: stream(bytes.subarray(0, 3), bytes.subarray(3)) });
assert.equal(seal.record.sha256, createHash("sha256").update(bytes).digest("hex"));
assert.equal(seal.mac, createHmac("sha256", key1).update("HALO master provenance record v1\n" + JSON.stringify([1, "v1", "owner", "song", "master", "direct", source.sourceId, bytes.length, seal.record.sha256, source.createdAt])).digest("hex"));
assert.equal(verifyProvenanceRecord(seal, keyring), true);
assert.equal(await verifyMasterBytes(seal, stream(bytes), { maxBytes: 100, keyring }), true);
assert.equal(await verifyMasterBytes(seal, stream(Buffer.alloc(bytes.length)), { maxBytes: 100, keyring }), false);
assert.equal(verifyProvenanceRecord({ ...seal, mac: "0".repeat(64) }, keyring), false);
assert.equal(verifyProvenanceRecord({ ...seal, mac: "not-a-mac" }, keyring), false);
assert.equal(verifyProvenanceRecord(null, keyring), false);
for (const [field, replacement] of Object.entries({ ownerId: "other", songId: "other", versionId: "other", sourceType: "chunks", sourceId: "other", byteSize: bytes.length + 1, sha256: "0".repeat(64), createdAt: "2026-11-08T04:00:00.000Z", keyVersion: "v2" })) {
  assert.equal(verifyProvenanceRecord({ ...seal, record: { ...seal.record, [field]: replacement } }, keyring), false, `${field} must be authenticated`);
}
assert.equal(verifyProvenanceRecord({ ...seal, record: { ...seal.record, extra: true } }, keyring), false);

const rotated = loadProvenanceKeys({ ...env, HALO_PROVENANCE_ACTIVE_KEY: "v2" });
assert.equal(verifyProvenanceRecord(seal, rotated), true, "retained keys verify old records");
const next = await sealMasterBytes({ ...source, keyring: rotated, bytes: stream(bytes), sourceType: "chunks", sourceId: "owner/master/session/parts/" });
assert.equal(next.record.keyVersion, "v2");
assert.equal(await verifyMasterBytes(next, stream(bytes.subarray(0, 4), bytes.subarray(4)), { maxBytes: 100, keyring: rotated }), true);
const removed = loadProvenanceKeys({ HALO_PROVENANCE_ACTIVE_KEY: "v2", HALO_PROVENANCE_KEYS: JSON.stringify({ v2: key2.toString("base64") }) });
assert.throws(() => verifyProvenanceRecord(seal, removed), /unavailable/);
for (const invalid of [
  {},
  { ...env, HALO_PROVENANCE_KEYS: "not-json" },
  { ...env, HALO_PROVENANCE_ACTIVE_KEY: "missing" },
  { ...env, HALO_PROVENANCE_KEYS: JSON.stringify({ v1: Buffer.alloc(31).toString("base64") }) },
  { ...env, HALO_PROVENANCE_KEYS: JSON.stringify({ v1: "not base64" }) },
]) assert.throws(() => loadProvenanceKeys(invalid));
await assert.rejects(() => hashMasterBytes(stream(bytes.subarray(1)), { expectedBytes: bytes.length, maxBytes: 100 }), /ended/);
await assert.rejects(() => hashMasterBytes(stream(bytes, Buffer.from("x")), { expectedBytes: bytes.length, maxBytes: 100 }), /exceeds/);
await assert.rejects(() => hashMasterBytes(stream("not bytes"), { expectedBytes: 9, maxBytes: 100 }), /non-byte/);
await assert.rejects(() => hashMasterBytes(stream(bytes), { expectedBytes: bytes.length, maxBytes: 1 }), /Invalid/);
await assert.rejects(() => sealMasterBytes({ ...source, createdAt: "yesterday", bytes: stream(bytes) }), /Invalid provenance/);
async function* broken() { yield bytes.subarray(0, 2); throw new Error("storage failed"); }
await assert.rejects(() => sealMasterBytes({ ...source, bytes: broken() }), /storage failed/);
console.log("Master provenance contracts passed");
