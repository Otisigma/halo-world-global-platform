import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMasterProvenanceHandler } from "../netlify/lib/master-provenance-api.mjs";
import { describeMasterSource, readObservedMaster } from "../netlify/lib/master-provenance-observation.mjs";
import { sealMasterBytes, verifyMasterBytes, loadProvenanceKeys } from "../netlify/lib/master-provenance.mjs";
import { safeObserveUploadedMaster } from "../netlify/lib/master-upload-observation.mjs";

const owner = "owner-1";
const song = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const prefix = `${owner}/${version}/session-12345/parts/`;
const row = { audio_storage_key: "", audio_blob_prefix: prefix, audio_chunk_count: 2, audio_byte_size: 6 };
const asStream = bytes => new ReadableStream({ start(c) { c.enqueue(Uint8Array.from(bytes)); c.close(); } });
const keyring = loadProvenanceKeys({ HALO_PROVENANCE_ACTIVE_KEY: "v1", HALO_PROVENANCE_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 7).toString("base64") }) });

test("authenticated setup diagnostics distinguish missing keys and migration without exposing secrets", async () => {
  let error, user = { id: "user" };
  const db = { sql: async parts => {
    if (error?.code !== "provenance_keys_missing") throw error;
    if (parts.join("?").includes("SELECT v.audio_storage_key")) return [row];
    return [];
  } };
  const handler = createMasterProvenanceHandler({
    getUser: async () => user, getDatabase: async () => db, ensureMembership: async () => ({ member_id: owner }),
    loadProvenanceKeys: () => { throw error; }, verifyRequestOrigin: () => {}, logError: () => {},
  });
  const request = () => new Request(`https://site.test/api/song-catalog/master-provenance?songId=${song}&versionId=${version}`);
  for (const [code, expected] of [["provenance_keys_missing", "provenance_keys_missing"],
    ["42P01", "provenance_schema_missing"], ["42703", "provenance_schema_missing"], ["ECONNRESET", "provenance_unavailable"]]) {
    error = Object.assign(new Error("private-token storage-secret"), { code });
    const response = await handler(request());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, expected);
    assert.doesNotMatch(JSON.stringify(body), /private-token|storage-secret/);
  }
  assert.throws(() => loadProvenanceKeys({}), { code: "provenance_keys_missing" });
  user = null;
  assert.equal((await handler(request())).status, 401, "configuration details require authentication");
});

test("automatic uploads observe actual storage, reuse retries, and report failures without rejecting uploads", async () => {
  const state = { row: { ...row }, existing: null, reads: 0, inserts: 0, limited: false, changed: false, logs: [] };
  const db = { sql: async (parts, ...values) => {
    const text = parts.join("?");
    if (text.includes("SELECT v.audio_storage_key")) return state.row ? [state.row] : [];
    if (text.includes("SELECT id, record, mac")) return state.existing ? [state.existing] : [];
    if (text.includes("INSERT INTO halo_master_provenance_read_limits")) return state.limited ? [] : [{ owner_member_id: owner }];
    if (text.includes("INSERT INTO halo_master_provenance_observations")) {
      if (state.changed) return [];
      state.inserts++;
      state.existing = { id: values[0], record: JSON.parse(values[4]), mac: values[5] };
      return [{ id: values[0] }];
    }
    throw new Error("Unexpected query");
  } };
  const store = { get: async key => { state.reads++; return asStream(key.endsWith("000") ? [1, 2, 3] : [4, 5, 6]); } };
  const deps = { loadProvenanceKeys: () => keyring, storageConfig: () => null,
    randomUUID: () => "55555555-5555-4555-8555-555555555555",
    now: () => new Date("2026-11-08T08:00:00.000Z"), logError: message => state.logs.push(message) };
  const run = overrides => safeObserveUploadedMaster(db, owner, song, version, store, { ...deps, ...overrides });
  const first = await run();
  assert.equal(first.result, "observed");
  assert.equal(state.reads, 2);
  assert.equal(state.existing.record.sha256, createHash("sha256").update(Uint8Array.of(1, 2, 3, 4, 5, 6)).digest("hex"));
  state.limited = true;
  assert.equal((await run()).reused, true);
  assert.equal(state.inserts, 1);
  assert.equal(state.reads, 2);
  state.existing = null;
  assert.equal((await run()).result, "rate_limited");
  assert.equal(state.reads, 2);
  state.limited = false; state.changed = true;
  assert.equal((await run()).result, "stale");
  state.changed = false;
  assert.equal((await run({ loadProvenanceKeys: () => { throw new Error("secret"); } })).result, "unavailable");
  assert.deepEqual(state.logs, ['{"event":"master_upload_observation_failed","code":"provenance_unavailable"}']);
  state.row = null;
  assert.equal((await run()).result, "not_applicable");
  state.row = { ...row };
  assert.equal((await run({ audioStore: { get: async () => null } })).result, "unavailable");

  state.row = { audio_storage_key: `masters/${owner}/${song}/${version}/123/file.wav`, audio_byte_size: 3 };
  const storage = { bucket: "test", region: "us-east-1", accessKeyId: "id", secretAccessKey: "secret",
    endpoint: "https://example.test", forcePathStyle: true };
  assert.equal((await run({ storageConfig: () => storage, fetchImpl: async () => new Response(Uint8Array.of(7, 8, 9)) })).result, "observed");
  assert.equal(state.existing.record.sourceType, "direct");
  state.existing = null; state.limited = true;
  const digest = { sourceId: describeMasterSource(state.row, owner, song, version).id,
    sha256: createHash("sha256").update(Uint8Array.of(7, 8, 9)).digest("hex"),
    byteSize: 3, createdAt: "2026-11-08T08:00:00.000Z" };
  assert.equal((await run({ observedDigest: digest, fetchImpl: () => { throw new Error("must not re-read"); } })).result, "observed");
  assert.equal(state.existing.record.sha256, digest.sha256);
  state.existing = null;
  assert.equal((await run({ observedDigest: { ...digest, sourceId: "changed" } })).result, "stale");
});

test("both upload routes feed observations and refresh the existing workspace", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const name of ["song-catalog-master-upload.ts", "song-catalog-audio.ts"]) {
    const source = await readFile(new URL(`../netlify/functions/${name}`, import.meta.url), "utf8");
    assert.match(source, /processUploadedMaster\(db, ownerMemberId, songId, versionId, audioStore\)/);
    assert.match(source, /observation\.message/);
    assert.match(source, /provenance,?\s*observation/);
  }
  const client = await readFile(new URL("../song-catalog/song-catalog.js", import.meta.url), "utf8");
  assert.match(client, /void masterProvenancePanel\?\.refreshHistory\(\)/);
  assert.match(client, /note=`\$\{data\.message\}\. \$\{receipt\.message\}`/);
});

test("chunk observations read actual bounded bytes in order and authenticate them", async () => {
  const source = describeMasterSource(row, owner, song, version);
  const store = { get: async key => asStream(key.endsWith("000") ? [1, 2, 3] : [4, 5, 6]) };
  const read = () => readObservedMaster(source, { blobStore: store });
  const seal = await sealMasterBytes({ bytes: read(), expectedBytes: 6, maxBytes: 200, ownerId: owner, songId: song, versionId: version, sourceType: source.type, sourceId: source.id, createdAt: new Date().toISOString(), keyring });
  assert.equal(seal.record.sha256, createHash("sha256").update(Buffer.from([1, 2, 3, 4, 5, 6])).digest("hex"));
  assert.equal(await verifyMasterBytes(seal, read(), { maxBytes: 200, keyring }), true);
  const altered = { get: async () => asStream([1, 2, 3]) };
  assert.equal(await verifyMasterBytes(seal, readObservedMaster(source, { blobStore: altered }), { maxBytes: 200, keyring }), false);
  await assert.rejects(() => verifyMasterBytes(seal, readObservedMaster(source, { blobStore: { get: async () => asStream([1]) } }), { maxBytes: 200, keyring }), /ended/);
  await assert.rejects(() => verifyMasterBytes(seal, readObservedMaster(source, { blobStore: { get: async () => null } }), { maxBytes: 200, keyring }), /unavailable/);
  await assert.rejects(() => verifyMasterBytes(seal, readObservedMaster(source, { blobStore: { get: async () => asStream([1, 2, 3, 4, 5, 6, 7]) } }), { maxBytes: 200, keyring }), /exceeds/);
  assert.throws(() => describeMasterSource({ ...row, audio_blob_prefix: `other/${version}/session/parts/` }, owner, song, version));
  assert.throws(() => describeMasterSource({ ...row, audio_chunk_count: 999 }, owner, song, version));
  assert.notEqual(source.id, describeMasterSource({ ...row, audio_blob_prefix: `${owner}/${version}/different/parts/` }, owner, song, version).id);
});

test("direct reads reject redirects, bad lengths and stalled storage", async () => {
  const source = describeMasterSource({ audio_storage_key: `masters/${owner}/${song}/${version}/123/file.wav`, audio_byte_size: 3 }, owner, song, version);
  const storage = { bucket: "test", region: "us-east-1", accessKeyId: "id", secretAccessKey: "secret", endpoint: "https://example.test", forcePathStyle: true };
  let options;
  const fetchImpl = async (_url, init) => { options = init; return new Response(Uint8Array.of(1, 2, 3)); };
  const result = [];
  for await (const chunk of readObservedMaster(source, { storage, fetchImpl })) result.push(...chunk);
  assert.deepEqual(result, [1, 2, 3]);
  assert.equal(options.redirect, "error");
  const drain = async iterable => { for await (const _ of iterable) {} };
  await assert.rejects(() => drain(readObservedMaster(source, { storage, fetchImpl: async () => new Response(Uint8Array.of(1), { headers: { "content-length": "1" } }) })), /length/);
  await assert.rejects(() => drain(readObservedMaster(source, { storage, fetchImpl: async () => new Promise(() => {}), timeoutMs: 10 })), /timed out/);
  const chunkSource = describeMasterSource(row, owner, song, version);
  let release, cancelled = false;
  const pending = new Promise(resolve => { release = resolve; });
  await assert.rejects(() => drain(readObservedMaster(chunkSource, { blobStore: { get: () => pending }, timeoutMs: 10 })), /timed out/);
  release(new ReadableStream({ cancel() { cancelled = true; } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

// Exercise the real handler with isolated identity, storage and database dependencies.
test("endpoint authenticates, limits, detects stale sources and verifies observed bytes", async () => {
  const state = { user: { id: "user" }, owner, row: { ...row }, limited: false, records: new Map(), changed: false, logged: [] };
  const db = { sql: async (parts, ...values) => {
    const text = parts.join("?");
    if (text.includes("SELECT v.audio_storage_key")) return state.owner === owner && state.row ? [state.row] : [];
    if (state.fail) throw new Error("secret-storage-url https://bucket.test?X-Amz-Signature=abc");
    if (text.includes("SELECT id, record, created_at")) {
      state.listQuery = { text, values };
      return [...state.records].map(([id, value], index) => ({ id, ...value, created_at: new Date(Date.UTC(2026, 10, 8, 3, 1, index)) }))
        .reverse().slice(0, values.at(-1));
    }
    if (text.includes("SELECT record, mac")) return state.records.has(values[0]) ? [state.records.get(values[0])] : [];
    if (text.includes("INSERT INTO halo_master_provenance_read_limits")) { if (state.limited) return []; state.limited = true; return [{ owner_member_id: owner }]; }
    if (text.includes("INSERT INTO halo_master_provenance_observations")) {
      if (state.changed) return [];
      state.records.set(values[0], { record: JSON.parse(values[4]), mac: values[5] });
      return [{ id: values[0] }];
    }
    throw new Error("Unexpected query");
  } };
  let ids = 0;
  const handler = createMasterProvenanceHandler({
    getDatabase: async () => db,
    getUser: async () => state.user,
    verifyRequestOrigin: request => { if (request.headers.get("origin") !== "https://site.test") throw new Error("origin"); },
    ensureMembership: async () => ({ member_id: state.owner }),
    loadProvenanceKeys: () => keyring,
    audioStore: { get: async key => asStream(key.endsWith("000") ? [1, 2, 3] : [4, 5, 6]) },
    storageConfig: () => null,
    fetchImpl: async () => { throw new Error("direct storage is not used by this fixture"); },
    randomUUID: () => `33333333-3333-4333-8333-${String(++ids).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 10, 8, 3, 0, ids)),
    logError: message => state.logged.push(message),
  });
  const list = (extra = "") => handler(new Request(`https://site.test/api/song-catalog/master-provenance?songId=${song}&versionId=${version}${extra}`));
  const request = (action, extra = "", headers = {}) => new Request(`https://site.test/api/song-catalog/master-provenance?action=${action}&songId=${song}&versionId=${version}${extra}`, { method: "POST", headers: { origin: "https://site.test", ...headers } });
  state.user = null;
  assert.equal((await handler(request("observe"))).status, 401);
  state.user = { id: "user" };
  assert.equal((await handler(request("observe", "", { origin: "https://evil.test" }))).status, 403);
  assert.equal((await handler(new Request(`https://site.test/api/song-catalog/master-provenance?action=observe&songId=${song}&versionId=${version}`, { method: "POST" }))).status, 403);
  state.owner = "other";
  assert.equal((await handler(request("observe"))).status, 404);
  state.owner = owner;
  const response = await handler(request("observe"));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.result, "observed");
  assert.match(body.limitation, /not a certificate/);
  assert.equal(body.sha256, createHash("sha256").update(Buffer.from([1, 2, 3, 4, 5, 6])).digest("hex"));
  assert.equal((await handler(request("verify", `&observationId=${body.observationId}`))).status, 429);
  state.limited = false;
  const verify = await handler(request("verify", `&observationId=${body.observationId}`));
  assert.equal((await verify.json()).result, "observed_bytes_match");
  state.row = { ...row, audio_blob_prefix: `${owner}/${version}/replacement/parts/` };
  assert.equal((await handler(request("verify", `&observationId=${body.observationId}`))).status, 409);
  state.row = { ...row };
  state.records.get(body.observationId).mac = "0".repeat(64);
  assert.equal((await handler(request("verify", `&observationId=${body.observationId}`))).status, 409);
  state.changed = true; state.limited = false;
  assert.equal((await handler(request("observe"))).status, 409);

  state.changed = false; state.limited = false;
  const second = await (await handler(request("observe"))).json();
  const history = await list();
  assert.equal(history.status, 200);
  assert.equal(history.headers.get("cache-control"), "private, no-store");
  const listed = await history.json();
  assert.deepEqual(Object.keys(listed).sort(), ["hasMore", "limitation", "observations", "songId", "versionId"]);
  assert.deepEqual(listed.observations.map(item => item.observationId), [second.observationId, body.observationId], "newest first");
  assert.deepEqual(Object.keys(listed.observations[0]).sort(), ["byteSize", "createdAt", "matchesCurrentSource", "observationId", "recordAuthenticated", "sha256", "sourceType"]);
  assert.equal(listed.observations[0].recordAuthenticated, "not_checked");
  assert.equal(listed.observations[0].createdAt, second.createdAt, "history uses the authenticated record timestamp rather than the later database insertion time");
  assert.equal(listed.observations[0].matchesCurrentSource, true);
  assert.doesNotMatch(JSON.stringify(listed), /mac|sourceId|parts\/|owner-1|0{64}/);
  assert.match(state.listQuery.text, /owner_member_id = \? AND song_id = \? AND version_id = \?/);
  assert.match(state.listQuery.text, /ORDER BY created_at DESC, id DESC/);
  const page = await (await list("&limit=1")).json();
  assert.equal(page.observations.length, 1);
  assert.equal(page.hasMore, true);
  for (const bad of ["&limit=0", "&limit=51", "&limit=2.5", "&limit=x"]) assert.equal((await list(bad)).status, 400);
  assert.equal((await handler(new Request(`https://site.test/api/song-catalog/master-provenance?songId=bad&versionId=${version}`))).status, 400);
  state.row = { ...row, audio_blob_prefix: `${owner}/${version}/replacement/parts/` };
  assert.equal((await (await list()).json()).observations[0].matchesCurrentSource, false);
  state.row = { ...row };
  state.user = null;
  assert.equal((await list()).status, 401);
  state.user = { id: "user" }; state.owner = "other";
  assert.equal((await list()).status, 404);
  state.owner = owner;
  assert.equal((await handler(new Request("https://site.test/api/song-catalog/master-provenance", { method: "DELETE" }))).status, 405);

  state.fail = true;
  assert.equal((await list()).status, 503);
  state.limited = false;
  assert.equal((await handler(request("observe"))).status, 503);
  state.fail = false;
  assert.deepEqual(state.logged, ['{"event":"master_provenance_failed","action":"list","code":"provenance_unavailable"}', '{"event":"master_provenance_failed","action":"observe","code":"provenance_unavailable"}']);
});

test("Netlify adapter is a thin wiring layer over the tested handler", async () => {
  const { readFile } = await import("node:fs/promises");
  const adapter = await readFile(new URL("../netlify/functions/song-catalog-master-provenance.ts", import.meta.url), "utf8");
  assert.match(adapter, /export default createMasterProvenanceHandler\(\{/);
  for (const dependency of ["getUser", "getDatabase", "ensureMembership", "verifyRequestOrigin", "loadProvenanceKeys", "audioStore", "storageConfig", "fetchImpl", "randomUUID", "now", "logError"]) {
    assert.match(adapter, new RegExp(`\\b${dependency}\\b`), dependency);
  }
  assert.match(adapter, /path: "\/api\/song-catalog\/master-provenance"/);
  assert.doesNotMatch(adapter, /db\.sql|INSERT|SELECT|sealMasterBytes|verifyMasterBytes/, "behavior belongs in the injectable module");
});

test("manifest returns only fields from an authenticated, exactly scoped record", async () => {
  const observationId = "44444444-4444-4444-8444-444444444444";
  const source = describeMasterSource(row, owner, song, version);
  const bytes = Uint8Array.of(9, 8, 7);
  const once = async function* () { yield bytes; };
  const seal = await sealMasterBytes({ bytes: once(), expectedBytes: 3, maxBytes: 200, ownerId: owner, songId: song, versionId: version,
    sourceType: source.type, sourceId: source.id, createdAt: "2026-11-08T03:00:00.000Z", keyring });
  const state = { owner, rows: new Map([[observationId, { owner, record: seal.record, mac: seal.mac }]]), keys: () => keyring, logged: [], fail: false };
  const db = { sql: async (parts, ...values) => {
    const text = parts.join("?");
    if (state.fail) throw new Error("postgres://user:secret@db.test/raw failure");
    if (text.includes("SELECT v.audio_storage_key")) return values[2] === owner ? [row] : [];
    if (text.includes("SELECT record, mac")) {
      assert.match(text, /id = \? AND owner_member_id = \? AND song_id = \? AND version_id = \?/);
      const found = state.rows.get(values[0]);
      return found && found.owner === values[1] ? [{ record: found.record, mac: found.mac }] : [];
    }
    throw new Error("Unexpected query");
  } };
  const handler = createMasterProvenanceHandler({
    getDatabase: async () => db, getUser: async () => ({ id: "user" }), ensureMembership: async () => ({ member_id: state.owner }),
    verifyRequestOrigin: () => { throw new Error("GET manifest must not depend on Origin"); }, loadProvenanceKeys: () => state.keys(),
    logError: message => state.logged.push(message),
  });
  const manifest = (id = observationId, extra = "") => handler(new Request(`https://site.test/api/song-catalog/master-provenance?action=manifest&songId=${song}&versionId=${version}&observationId=${id}${extra}`));

  const ok = await manifest();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  const body = await ok.json();
  assert.deepEqual(Object.keys(body).sort(), ["byteSize", "createdAt", "limitation", "observationId", "sha256"]);
  assert.deepEqual({ ...body, limitation: undefined }, { observationId, sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: 3, createdAt: "2026-11-08T03:00:00.000Z", limitation: undefined });
  assert.match(body.limitation, /not a certificate/);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(`${seal.mac}|${source.id}|parts/|${owner}`));

  assert.equal((await manifest("55555555-5555-4555-8555-555555555555")).status, 404, "missing observation");
  assert.equal((await manifest("not-a-uuid")).status, 400);
  assert.equal((await handler(new Request(`https://site.test/api/song-catalog/master-provenance?action=unknown&songId=${song}&versionId=${version}`))).status, 400);
  state.owner = "intruder";
  assert.equal((await manifest()).status, 404, "another member cannot read the owner's manifest");
  state.owner = owner;

  const original = state.rows.get(observationId);
  for (const tampered of [
    { ...original, mac: "0".repeat(64) },
    { ...original, record: { ...seal.record, sha256: "f".repeat(64) } },
    { ...original, record: { ...seal.record, extra: true } },
    { ...original, record: null },
  ]) {
    state.rows.set(observationId, tampered);
    const response = await manifest();
    assert.equal(response.status, 409);
    assert.doesNotMatch(await response.text(), /[0-9a-f]{64}/);
  }
  // A database row relabelled to another member/song is rejected by the authenticated record fields.
  const foreign = await sealMasterBytes({ bytes: once(), expectedBytes: 3, maxBytes: 200, ownerId: "other-owner", songId: song, versionId: version,
    sourceType: source.type, sourceId: source.id, createdAt: "2026-11-08T03:00:00.000Z", keyring });
  state.rows.set(observationId, { owner, ...foreign });
  assert.equal((await manifest()).status, 409);
  const otherSong = await sealMasterBytes({ bytes: once(), expectedBytes: 3, maxBytes: 200, ownerId: owner, songId: "66666666-6666-4666-8666-666666666666", versionId: version,
    sourceType: source.type, sourceId: source.id, createdAt: "2026-11-08T03:00:00.000Z", keyring });
  state.rows.set(observationId, { owner, ...otherSong });
  assert.equal((await manifest()).status, 409);
  state.rows.set(observationId, original);

  state.keys = () => { throw new Error("Provenance keys are not configured correctly"); };
  assert.equal((await manifest()).status, 503, "unconfigured keys");
  state.keys = () => loadProvenanceKeys({ HALO_PROVENANCE_ACTIVE_KEY: "v2", HALO_PROVENANCE_KEYS: JSON.stringify({ v2: Buffer.alloc(32, 8).toString("base64") }) });
  const retired = await manifest();
  assert.equal(retired.status, 503, "record key version no longer retained");
  assert.doesNotMatch(await retired.text(), /[0-9a-f]{64}/);
  state.keys = () => keyring;
  assert.equal(state.logged.length, 0, "expected outcomes are not failure events");

  state.fail = true;
  assert.equal((await manifest()).status, 503);
  assert.deepEqual(state.logged, ['{"event":"master_provenance_failed","action":"manifest","code":"provenance_unavailable"}']);
});
