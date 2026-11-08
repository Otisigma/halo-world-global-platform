import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, webcrypto } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { retainedMasterConfig, loadSnapshotKeys, loadPublicSnapshotKeys, retainMasterBytes, verifySnapshot, signSnapshot,
  snapshotStorageCommitment, checkRetainedSnapshot } from "../netlify/lib/retained-master.mjs";
import { captureRegisteredMaster, verifyRetainedRow, pinnedSnapshotPlayback, retainedMasterPlayback } from "../netlify/lib/retained-master-service.mjs";
import { createRetainedMasterHandler } from "../netlify/lib/retained-master-api.mjs";
import { verifySnapshotInBrowser, compareSnapshotFile } from "../lib/retained-record.js";
import { presignObjectUrl } from "../netlify/lib/direct-upload-storage.mjs";

const songId = "11111111-1111-4111-8111-111111111111", versionId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const env = {
  HALO_RETAINED_MASTER_ENABLED: "true", HALO_PROVENANCE_STORAGE_BUCKET: "retained",
  HALO_PROVENANCE_STORAGE_ACCESS_KEY_ID: "test", HALO_PROVENANCE_STORAGE_SECRET_ACCESS_KEY: "test-secret",
  HALO_PROVENANCE_STORAGE_ENDPOINT: "https://storage.example.test", HALO_PROVENANCE_RETENTION_DAYS: "30",
  HALO_PROVENANCE_SIGNING_KEY_ID: "v1",
  HALO_PROVENANCE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  HALO_PROVENANCE_PUBLIC_KEYS: JSON.stringify({ v1: publicKey.export({ type: "spki", format: "pem" }) }),
};
const config = retainedMasterConfig(env), keys = loadSnapshotKeys(env);
const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6);
const stream = values => new ReadableStream({ start(controller) { controller.enqueue(values); controller.close(); } });
const iterable = async function* () { yield bytes; };
const hash = value => createHash("sha256").update(value).digest("hex");

function fakeStorage() {
  const records = new Map(), calls = [];
  let next = 0;
  const state = { records, calls, mode: "COMPLIANCE", versioning: true, corrupt: false, latest: "" };
  state.fetch = async (raw, options = {}) => {
    const url = new URL(raw);
    const method = options.method || "GET";
    calls.push({ url, method, headers: options.headers });
    if (method === "PUT") {
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      assert.equal(data.length, Number(options.headers["Content-Length"]));
      assert.equal(options.headers["x-amz-checksum-sha256"], Buffer.from(hash(data), "hex").toString("base64"));
      assert.match(url.searchParams.get("X-Amz-SignedHeaders"), /x-amz-object-lock-mode/);
      const version = `version-${++next}`;
      records.set(version, { data, retention: options.headers["x-amz-object-lock-retain-until-date"] });
      state.latest = version;
      return new Response(null, { headers: { "x-amz-version-id": state.versioning ? version : "null" } });
    }
    const version = url.searchParams.get("versionId");
    assert.ok(version, "all retained reads pin an explicit version");
    const stored = records.get(version);
    if (!stored) return new Response(null, { status: 404 });
    const headers = { "x-amz-version-id": version, "content-length": String(stored.data.length),
      "x-amz-object-lock-mode": state.mode, "x-amz-object-lock-retain-until-date": stored.retention };
    return new Response(method === "HEAD" ? null : state.corrupt ? Buffer.alloc(stored.data.length, 9) : stored.data, { headers });
  };
  return state;
}

test("explicit configuration, rotated public keys and pinned signing query", () => {
  assert.equal(retainedMasterConfig({}), null);
  assert.throws(() => retainedMasterConfig({ HALO_RETAINED_MASTER_ENABLED: "true" }));
  assert.throws(() => retainedMasterConfig({ ...env, HALO_PROVENANCE_RETENTION_DAYS: "0" }));
  assert.throws(() => loadSnapshotKeys({ ...env, HALO_PROVENANCE_PUBLIC_KEYS: "{}" }));
  assert.equal(loadPublicSnapshotKeys({ HALO_PROVENANCE_PUBLIC_KEYS: env.HALO_PROVENANCE_PUBLIC_KEYS }).publicKeys.size, 1,
    "verification does not require a private key");
  const url = new URL(presignObjectUrl({ config: config.storage, key: "snapshot.bin", queryParams: { versionId: "v+/=" } }));
  assert.equal(url.searchParams.get("versionId"), "v+/=");
  assert.throws(() => presignObjectUrl({ config: config.storage, key: "x", queryParams: { versionId: "null" } }));
});

test("retained upload is bounded, checksum signed, read back by version, and compliance checked", async () => {
  const storage = fakeStorage();
  const result = await retainMasterBytes({ config, key: "snapshots/x.bin", bytes: iterable(), expectedBytes: bytes.length, fetchImpl: storage.fetch });
  assert.equal(result.sha256, hash(bytes));
  storage.records.set("replacement", { data: Buffer.alloc(6, 8), retention: result.retainUntil });
  storage.latest = "replacement";
  const checked = await checkRetainedSnapshot({ config, key: result.key, versionId: result.versionId,
    byteSize: result.byteSize, retainUntil: result.retainUntil, fetchImpl: storage.fetch });
  assert.equal(checked.sha256, hash(bytes), "later writes cannot redirect the pinned read");
  storage.mode = "GOVERNANCE";
  await assert.rejects(checkRetainedSnapshot({ config, key: result.key, versionId: result.versionId,
    byteSize: result.byteSize, retainUntil: result.retainUntil, fetchImpl: storage.fetch }), /retention/);
  storage.mode = "COMPLIANCE";
  storage.records.get(result.versionId).retention = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(checkRetainedSnapshot({ config, key: result.key, versionId: result.versionId,
    byteSize: result.byteSize, retainUntil: result.retainUntil, fetchImpl: storage.fetch }), /retention/);
  await assert.rejects(retainMasterBytes({ config, key: "x", bytes: iterable(), expectedBytes: 5, fetchImpl: storage.fetch }), /bound/);
  await assert.rejects(retainMasterBytes({ config, key: "x", bytes: iterable(), expectedBytes: 7, fetchImpl: storage.fetch }), /incomplete/);
  const unversioned = fakeStorage(); unversioned.versioning = false;
  await assert.rejects(retainMasterBytes({ config, key: "x", bytes: iterable(), expectedBytes: 6, fetchImpl: unversioned.fetch }), /versioning/);
  const corrupt = fakeStorage(); corrupt.corrupt = true;
  await assert.rejects(retainMasterBytes({ config, key: "x", bytes: iterable(), expectedBytes: 6, fetchImpl: corrupt.fetch }), /differ/);
});

function fixture() {
  const storage = fakeStorage();
  const state = { owner: "owner-1", limited: false, sourceChanged: false, records: new Map(), logs: [], user: { id: "user" } };
  const row = { audio_storage_key: "", audio_blob_prefix: `owner-1/${versionId}/session-12345/parts/`, audio_chunk_count: 1, audio_byte_size: 6,
    owner_member_id: "owner-1", song_id: songId, version_type: "sale_master" };
  let counter = 10;
  const db = { sql: async (parts, ...values) => {
    const sql = parts.join("?");
    if (sql.includes("SELECT v.audio_storage_key")) return state.owner === "owner-1" ? [row] : [];
    if (sql.includes("INSERT INTO halo_master_provenance_read_limits")) return state.limited ? [] : [{ owner_member_id: state.owner }];
    if (sql.includes("INSERT INTO halo_retained_master_snapshots")) {
      const existing = [...state.records.values()].find(r => r.source_id === values[4]);
      if (existing && existing.status !== "failed") return [];
      const job = existing || { id: values[0], owner_member_id: values[1], song_id: values[2], version_id: values[3],
        source_id: values[4], parent_record_id: values[6], relationship: values[7] };
      job.attempt_id = values[5]; job.status = "pending"; state.records.set(job.id, job);
      return [job];
    }
    if (sql.includes("SET status = 'ready'")) {
      if (state.sourceChanged) return [];
      const record = state.records.get(values[4]);
      assert.equal(record.attempt_id, values[5]);
      Object.assign(record, { status: "ready", storage_key: values[0], storage_version_id: values[1],
        record: JSON.parse(values[2]), signature: values[3] });
      return [{ id: record.id }];
    }
    if (sql.includes("SET status = 'failed'")) {
      const job = state.records.get(values[0]);
      if (job?.attempt_id === values[1]) job.status = "failed";
      return [];
    }
    if (sql.includes("SET published_at")) {
      const job = state.records.get(values[0]);
      if (job?.owner_member_id !== values[1]) return [];
      job.published_at = sql.includes("published_at = NULL") ? null : new Date().toISOString();
      return [{ id: job.id }];
    }
    if (sql.includes("SELECT id, status")) return [...state.records.values()].filter(r => r.owner_member_id === values[0]);
    if (sql.includes("SELECT *")) {
      let records = [...state.records.values()];
      if (sql.includes("WHERE id =")) records = records.filter(r => r.id === values[0]);
      if (sql.includes("owner_member_id =")) {
        records = records.filter(r => r.owner_member_id === (sql.includes("WHERE id =") ? values[1] : values[0]));
      }
      if (sql.includes("source_id =")) records = records.filter(r => r.source_id === values.at(-1));
      if (sql.includes("published_at IS NOT NULL")) records = records.filter(r => r.published_at && r.status === "ready");
      if (sql.includes("AND status = 'ready'")) records = records.filter(r => r.status === "ready");
      return records;
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const deps = { db, owner: "owner-1", songId, versionId, config, keys,
    blobStore: { get: async () => stream(bytes) }, sourceStorage: null, fetchImpl: storage.fetch,
    uuid: () => `44444444-4444-4444-8444-${String(counter++).padStart(12, "0")}` };
  const handler = createRetainedMasterHandler({
    database: async () => db, user: async () => state.user, membership: async () => ({ member_id: state.owner }),
    origin: req => { if (req.headers.get("origin") !== "https://halo.test") throw new Error("origin"); },
    config: () => state.disabled ? null : config, signingKeys: () => keys, publicKeys: () => keys, blobStore: () => deps.blobStore,
    sourceStorage: () => null, fetch: storage.fetch, log: message => state.logs.push(message),
  });
  return { state, storage, deps, handler };
}

test("capture idempotency, ownership, signature, version-specific verification and declared lineage", async () => {
  const { state, storage, deps } = fixture();
  const receipt = await captureRegisteredMaster(deps);
  assert.equal(receipt.state, "ready");
  const row = state.records.get(receipt.recordId);
  assert.equal(verifySnapshot({ record: row.record, signature: row.signature }, keys), true);
  assert.equal((await captureRegisteredMaster(deps)).alreadyCaptured, true);
  assert.equal(storage.calls.filter(c => c.method === "PUT").length, 1, "a retry does not create another retained object");
  assert.equal((await verifyRetainedRow(row, config, keys, storage.fetch)).result, "retained_bytes_match");
  const playback = new URL(pinnedSnapshotPlayback(row, config, keys));
  assert.equal(playback.searchParams.get("versionId"), row.storage_version_id);
  assert.equal(await retainedMasterPlayback(deps.db, versionId, "owner-1", "GET", {}), null, "pinned playback is opt-in");
  const pinned = new URL(await retainedMasterPlayback(deps.db, versionId, "owner-1", "GET", { ...env, HALO_RETAINED_MASTER_PLAYBACK: "true" }));
  assert.equal(pinned.searchParams.get("versionId"), row.storage_version_id);
  const child = await captureRegisteredMaster({ ...deps, parentRecordId: row.id, relationship: "remix" });
  assert.equal(state.records.get(child.recordId).record.parentRecordId, row.id);
  assert.equal(state.records.get(child.recordId).record.relationship, "remix");
  row.record.sha256 = "0".repeat(64);
  assert.equal(verifySnapshot({ record: row.record, signature: row.signature }, keys), false);
  state.owner = "other";
  assert.equal((await captureRegisteredMaster(deps)).state, "not_eligible");
  const stale = fixture(); stale.state.sourceChanged = true;
  await assert.rejects(captureRegisteredMaster(stale.deps), /registration changed/);
  assert.equal([...stale.state.records.values()][0].status, "failed");
});

test("public sharing is opt-in; owner endpoints reject cross-owner, origin, invalid records and excessive reads", async () => {
  const { state, deps, handler } = fixture();
  const receipt = await captureRegisteredMaster(deps);
  const request = (action, method = "GET", origin = "https://halo.test") => new Request(
    `https://halo.test/api/master-snapshots?action=${action}&recordId=${receipt.recordId}`, { method, headers: { origin } });
  assert.equal((await handler(request("public"))).status, 404);
  assert.equal((await handler(request("share", "POST", "https://evil.test"))).status, 403);
  assert.equal((await handler(request("share", "POST"))).status, 200);
  state.user = null;
  const publicResult = await (await handler(request("public"))).json();
  assert.deepEqual(Object.keys(publicResult).sort(), ["limitation", "record", "signature"]);
  assert.doesNotMatch(JSON.stringify(publicResult), /owner-1|storage_key|storage_version_id|test-secret|snapshots\//);
  assert.equal((await handler(request("manifest"))).status, 401);
  state.user = { id: "user" }; state.owner = "other";
  assert.equal((await handler(request("manifest"))).status, 404);
  state.owner = "owner-1"; state.limited = true;
  assert.equal((await handler(request("verify", "POST"))).status, 429);
  state.limited = false;
  assert.equal((await handler(request("verify", "POST"))).status, 200);
  state.disabled = true;
  assert.equal((await handler(request("unshare", "POST"))).status, 200, "revoking sharing does not require storage configuration");
  assert.equal((await handler(request("public"))).status, 404);
  state.disabled = false;
  state.records.get(receipt.recordId).signature = Buffer.alloc(64).toString("base64");
  assert.equal((await handler(request("manifest"))).status, 409);
});

test("browser independently verifies signatures and compares local bytes with retained trusted keys", async () => {
  const now = new Date(), until = new Date(now.getTime() + 86400000);
  const record = { schemaVersion: 1, recordId, songId, versionId, keyId: "v1", sha256: hash(bytes), byteSize: 6,
    createdAt: now.toISOString(), retainUntil: until.toISOString(), storageCommitment: snapshotStorageCommitment(config.storage, "x", "v1"),
    sourceType: "chunks", sourceConsistency: "mutable_read", parentRecordId: "", relationship: "original" };
  const envelope = signSnapshot(record, keys);
  const publicKeys = { keys: [{ id: "v1", spki: publicKey.export({ type: "spki", format: "der" }).toString("base64") }] };
  assert.deepEqual(await verifySnapshotInBrowser(envelope, publicKeys, webcrypto), record);
  await assert.rejects(verifySnapshotInBrowser({ ...envelope, record: { ...record, byteSize: 7 } }, publicKeys, webcrypto), /signature/);
  const file = { size: 6, arrayBuffer: async () => bytes.buffer };
  assert.equal(await compareSnapshotFile(file, record, webcrypto), true);
  assert.equal(await compareSnapshotFile(file, { ...record, sha256: "0".repeat(64) }, webcrypto), false);
  await assert.rejects(compareSnapshotFile({ size: 101 * 1024 * 1024 }, record, webcrypto), /100 MiB/);
  assert.equal(verifySnapshot(envelope, loadPublicSnapshotKeys({ HALO_PROVENANCE_PUBLIC_KEYS: env.HALO_PROVENANCE_PUBLIC_KEYS })), true);
  const directory = await mkdtemp("/tmp/halo-offline-contract-");
  try {
    await writeFile(`${directory}/record.json`, JSON.stringify(envelope));
    await writeFile(`${directory}/trusted.pem`, publicKey.export({ type: "spki", format: "pem" }));
    await writeFile(`${directory}/master.wav`, bytes);
    const command = new URL("./verify-master-snapshot.mjs", import.meta.url).pathname;
    const args = [command, "--manifest", `${directory}/record.json`, "--key", `${directory}/trusted.pem`, "--audio", `${directory}/master.wav`];
    const result = await promisify(execFile)(process.execPath, args);
    assert.equal(JSON.parse(result.stdout).file, "exact_bytes_match");
    await writeFile(`${directory}/master.wav`, Uint8Array.of(9, 9, 9, 9, 9, 9));
    await assert.rejects(promisify(execFile)(process.execPath, args), /differ/);
  } finally { await rm(directory, { recursive: true }); }
});

test("retained capture feeds an HMAC observation without a second source read", async () => {
  const { safeObserveUploadedMaster } = await import("../netlify/lib/master-upload-observation.mjs");
  const { loadProvenanceKeys, verifyProvenanceRecord } = await import("../netlify/lib/master-provenance.mjs");
  const { state, deps } = fixture();
  const keyring = loadProvenanceKeys({ HALO_PROVENANCE_ACTIVE_KEY: "v1",
    HALO_PROVENANCE_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 7).toString("base64") }) });
  let observationRow, sourceReads = 0, result;
  const db = { sql: async (parts, ...values) => {
    const text = parts.join("?");
    if (text.includes("SELECT id, record, mac FROM halo_master_provenance_observations")) return observationRow ? [observationRow] : [];
    if (text.includes("INSERT INTO halo_master_provenance_observations")) {
      observationRow = { id: values[0], record: JSON.parse(values[4]), mac: values[5] };
      return [{ id: values[0] }];
    }
    return deps.db.sql(parts, ...values);
  } };
  const blobStore = { get: async () => { sourceReads++; return stream(bytes); } };
  const onObserved = async observedDigest => {
    state.limited = true;
    result = await safeObserveUploadedMaster(db, deps.owner, songId, versionId, blobStore, {
      observedDigest, loadProvenanceKeys: () => keyring, logError: () => assert.fail("unexpected observation failure"),
    });
  };
  const first = await captureRegisteredMaster({ ...deps, db, blobStore, onObserved });
  assert.equal(first.state, "ready");
  assert.equal(result.result, "observed");
  assert.equal(sourceReads, 1);
  assert.equal(verifyProvenanceRecord(observationRow, keyring), true);
  assert.equal(observationRow.record.sha256, state.records.get(first.recordId).record.sha256);
  const retry = await captureRegisteredMaster({ ...deps, db, blobStore, onObserved });
  assert.equal(retry.alreadyCaptured, true);
  assert.equal(result.reused, true);
  assert.equal(sourceReads, 1);
});

test("both upload paths wire explicit capture results; satellite shares one ledger and no file upload", async () => {
  const markup = await readFile(new URL("../provenance/verify/index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../provenance/verify/verify.css", import.meta.url), "utf8");
  assert.match(markup, /aria-describedby="recordIdHelp recordIdHint"/);
  assert.match(markup, /aria-describedby="songIdHelp"/);
  assert.match(markup, /<summary aria-label="About the snapshot record ID"/);
  assert.match(markup, /Neither ID is a signing key/);
  assert.match(markup, /\?record=SNAPSHOT_ID/);
  assert.match(markup, /Use the snapshot ID, not the song ID/);
  assert.match(markup, /aria-describedby="retentionHelp"/);
  assert.match(markup, /uploading again will not enable it/);
  const catalog = await readFile(new URL("../song-catalog/index.html", import.meta.url), "utf8");
  const catalogClient = await readFile(new URL("../song-catalog/song-catalog.js", import.meta.url), "utf8");
  assert.match(catalog, /Song ID \(SID\)/);
  assert.match(catalog, /id="catalogSongId" type="text" readonly/);
  assert.match(catalog, /aria-describedby="catalogSongIdHelp"/);
  assert.match(catalogClient, /setValue\("#catalogSongId",song\?\.id\|\|""\)/);
  assert.match(styles, /width: 44px; height: 44px/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  for (const path of ["netlify/functions/song-catalog-master-upload.ts", "netlify/functions/song-catalog-audio.ts"]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /processUploadedMaster\(db, ownerMemberId, songId, versionId, audioStore\)/);
    assert.match(source, /provenance\.state === "ready"/);
    if (path.endsWith("song-catalog-audio.ts")) {
      assert.match(source, /retainedMasterPlayback\(db, version\.id, authorizedMasterOwner, request\.method\)/);
      assert.match(source, /Mutable-source fallback is disabled/);
    }
  }
  const satellite = await readFile(new URL("../provenance/verify/verify.js", import.meta.url), "utf8");
  assert.match(satellite, /verifySnapshotInBrowser/);
  assert.match(satellite, /compareSnapshotFile/);
  assert.doesNotMatch(satellite, /append\(.+localFile|body:.+localFile|HALO_PROVENANCE_SIGNING_PRIVATE_KEY/);
  assert.match(satellite, /error\.status !== 404/);
});
