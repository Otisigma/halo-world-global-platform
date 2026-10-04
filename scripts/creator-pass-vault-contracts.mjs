import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { createStemVaultHandler } from "../netlify/functions/stem-vault.mjs";
import { STANDARD_VAULT_CAPACITY_BYTES as cap } from "../lib/creator-pass.js";

const migration = await readFile(new URL("../netlify/database/migrations/20261004040000_stem-vault-reservations.sql", import.meta.url), "utf8");
assert.match(migration, /WHERE member_id = p_member FOR UPDATE/);
assert.match(migration, /used_bytes = used_bytes \+ p_bytes/);
assert.match(migration, /v_chunk\.content_hash <> p_hash/);
assert.match(migration, /subscription_status = 'active' AND subscription_expires_at > clock_timestamp()/);
assert.doesNotMatch(migration, /pack\.status\s*=/, "archived legacy files must consume capacity");
assert.doesNotMatch(migration, /DELETE FROM halo_stem_vault_chunks/, "abandoned reservations cannot be freed without deleting blobs");

const uploadId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const standard = { subscriptionTier: "STANDARD", subscriptionStatus: "inactive" };
const premium = { subscriptionTier: "PREMIUM", subscriptionStatus: "active", subscriptionExpiresAt: "2099-01-01T00:00:00Z" };
function fixture({ used = 0, pass = standard, authenticated = true, origin = true, unavailable = false } = {}) {
  const state = { used, pass, chunks: new Map(), blobs: new Map(), packs: [], files: [], writes: 0 };
  const db = { async sql(strings, ...values) {
    if (unavailable) throw new Error("Quota DB unavailable");
    const query = strings.join("?");
    if (query.includes("halo_reserve_stem_chunk")) {
      const [member, upload, stem, index, count, bytes, hash] = values;
      assert.equal(member, "owner");
      const key = `${upload}/${stem}/${index}`;
      const prior = state.chunks.get(key);
      const isPremium = state.pass.subscriptionTier === "PREMIUM" && state.pass.subscriptionStatus === "active";
      if (!isPremium && state.used > cap) return [{ result: "capacity" }];
      if (prior) return [{ result: prior.byte_size === bytes && prior.content_hash === hash && prior.chunk_count === count ? "retry" : "conflict" }];
      if (!isPremium && state.used + bytes > cap) return [{ result: "capacity" }];
      state.used += bytes;
      state.chunks.set(key, { chunk_index: index, chunk_count: count, byte_size: bytes, content_hash: hash });
      return [{ result: "reserved" }];
    }
    if (query.includes("FROM halo_stem_vault_chunks")) {
      if (query.includes("SUM(byte_size)")) {
        const [member, upload] = values;
        assert.equal(member, "owner", "retry reservations are scoped to the authenticated owner");
        return [{ reserved_bytes: [...state.chunks].filter(([key]) => key.startsWith(`${upload}/`)).reduce((sum, [, chunk]) => sum + chunk.byte_size, 0) }];
      }
      const [member, upload, stem] = values;
      assert.equal(member, "owner");
      return [...state.chunks].filter(([key]) => key.startsWith(`${upload}/${stem}/`)).map(([, value]) => value).sort((a, b) => a.chunk_index - b.chunk_index);
    }
    if (query.includes("halo_finalize_stem_pack")) {
      const [member, id, metadata, files] = values;
      assert.equal(member, "owner");
      if (state.pass.subscriptionTier !== "PREMIUM" && state.used > cap) return [{ result: "capacity" }];
      if (!state.packs.some(pack => pack.id === id)) {
        state.packs.push({ ...JSON.parse(metadata), id, member_id: member, created_at: new Date(), updated_at: new Date(), status: "private" });
        state.files.push(...JSON.parse(files).map(file => ({ ...file, pack_id: id, stem_type: file.stemType, original_filename: file.filename, byte_size: file.byteSize, content_type: file.contentType })));
      }
      return [{ result: "saved" }];
    }
    if (query.includes("used_bytes FROM")) return [{ used_bytes: state.used }];
    if (query.includes("UPDATE halo_stem_packs")) {
      const pack = state.packs.find(pack => pack.id === values[0] && pack.member_id === values[1]);
      if (!pack) return [];
      pack.status = "archived";
      return [{ id: pack.id }];
    }
    if (query.includes("FROM halo_stem_files")) return state.files.filter(file => !values.length || file.pack_id === values[0] || values[0] === "owner");
    if (query.includes("SELECT * FROM halo_stem_packs WHERE id")) return state.packs.filter(pack => pack.id === values[0] && pack.member_id === values[1]);
    if (query.includes("FROM halo_stem_packs")) return state.packs.filter(pack => pack.status === "private");
    throw new Error(`Unexpected query: ${query}`);
  } };
  const stemStore = {
    async set(key, bytes) {
      assert.ok(key.startsWith("owner/"));
      if (state.failStorage) throw new Error("Blob write interrupted");
      state.writes += 1;
      state.blobs.set(key, bytes);
    },
    async get(key) { return state.blobs.get(key) || null; },
    async list({ prefix }) { return { blobs: [...state.blobs.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
  };
  const handler = createStemVaultHandler({ getDatabase: async () => db, getUser: async () => authenticated ? { id: "owner" } : null,
    verifyRequestOrigin: async () => origin, stemStore, membershipFor: async () => ({ member_id: "owner" }), passFor: async () => state.pass });
  return { handler, state };
}
function chunkRequest({ id = uploadId, stem = "drums", index = 0, count = 1, bytes = new Uint8Array([1, 2, 3]) } = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ uploadId: id, stemType: stem, chunkIndex: index, chunkCount: count })) form.set(name, String(value));
  form.set("chunk", new File([bytes], "stem.wav"));
  return new Request("https://halo.example/api/stem-vault", { method: "POST", body: form });
}
const jsonRequest = body => new Request("https://halo.example/api/stem-vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const finalizeBody = { action: "finalize", uploadId, title: "My pack", rightsAttested: true,
  files: ["drums", "bass"].map(stemType => ({ stemType, filename: `${stemType}.wav`, contentType: "audio/wav", chunkCount: 1, byteSize: 3 })) };

let f = fixture();
assert.equal((await f.handler(chunkRequest())).status, 200);
assert.equal(f.state.used, 3);
assert.equal((await f.handler(chunkRequest())).status, 200);
assert.equal(f.state.used, 3, "identical chunk retries must not double-charge");
assert.equal((await f.handler(chunkRequest({ bytes: new Uint8Array([4, 5, 6]) }))).status, 409);
assert.equal(f.state.writes, 2, "conflicting retry must not overwrite the existing blob");
assert.equal((await f.handler(chunkRequest({ stem: "bass" }))).status, 200);
const forged = structuredClone(finalizeBody);
forged.files[0].byteSize = 1;
assert.equal((await f.handler(jsonRequest(forged))).status, 400, "finalize must not trust declared sizes");
assert.equal((await f.handler(jsonRequest(finalizeBody))).status, 201);
assert.equal((await f.handler(jsonRequest(finalizeBody))).status, 201, "finalize retry must not duplicate files");
assert.equal(f.state.files.length, 2);
await f.handler(jsonRequest({ action: "archive", packId: uploadId }));
const listing = await (await f.handler(new Request("https://halo.example/api/stem-vault"))).json();
assert.equal(listing.capacity.usedBytes, 6, "archive retains stored-byte usage");
assert.equal(listing.capacity.capacityBytes, cap);
assert.equal(listing.creatorPass.subscriptionTier, "STANDARD");

f = fixture({ used: cap - 3 });
const simultaneous = await Promise.all([f.handler(chunkRequest()), f.handler(chunkRequest({ id: otherId }))]);
assert.deepEqual(simultaneous.map(response => response.status).sort(), [200, 413]);
assert.equal(f.state.writes, 1, "capacity denial happens before blob storage");
f = fixture({ used: cap, pass: premium });
assert.equal((await f.handler(chunkRequest())).status, 200, "premium can exceed the Standard cap");
assert.equal((await f.handler(chunkRequest({ bytes: new Uint8Array(4 * 1024 * 1024 + 1) }))).status, 400);
assert.equal((await f.handler(chunkRequest({ count: 129 }))).status, 400, "premium keeps finite stem limits");
await f.handler(chunkRequest({ stem: "bass" }));
f.state.pass = standard;
assert.equal((await f.handler(jsonRequest(finalizeBody))).status, 413, "expired/downgraded Premium cannot finalize over cap");
f = fixture();
await f.handler(chunkRequest());
await f.handler(chunkRequest({ stem: "bass" }));
f.state.blobs.set(`owner/${uploadId}/bass/000`, new Uint8Array([9, 9, 9]).buffer);
assert.equal((await f.handler(jsonRequest(finalizeBody))).status, 409, "stored content is verified, not just counts");
f = fixture({ unavailable: true });
assert.equal((await f.handler(chunkRequest())).status, 500);
assert.equal(f.state.writes, 0, "quota database errors fail closed");
assert.equal((await f.handler(new Request("https://halo.example/api/stem-vault"))).status, 500);
f = fixture();
f.state.failStorage = true;
assert.equal((await f.handler(chunkRequest())).status, 500);
assert.equal(f.state.used, 3, "interrupted writes retain reservations conservatively");
f.state.failStorage = false;
assert.equal((await f.handler(chunkRequest())).status, 200);
assert.equal(f.state.used, 3, "retrying an interrupted write consumes no extra capacity");
const retryQuota = await (await f.handler(new Request(`https://halo.example/api/stem-vault?uploadId=${uploadId}`))).json();
assert.equal(retryQuota.capacity.uploadReservedBytes, 3, "batch preflight credits its own durable reservations");
const otherQuota = await (await f.handler(new Request(`https://halo.example/api/stem-vault?uploadId=${otherId}`))).json();
assert.equal(otherQuota.capacity.uploadReservedBytes, 0, "other upload IDs receive no reservation credit");
assert.equal((await fixture({ authenticated: false }).handler(chunkRequest())).status, 401);
assert.equal((await fixture({ origin: false }).handler(chunkRequest())).status, 403);
assert.equal((await fixture().handler(jsonRequest(finalizeBody))).status, 409);

const deck = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");
const saveSource = deck.slice(deck.indexOf("    async function saveStemPack(event)"), deck.indexOf("    async function archiveStemPack(packId)"));
const retryListeners = deck.slice(deck.indexOf('    elements.stemVaultForm.addEventListener("change"'), deck.indexOf('    elements.stemVaultForm.addEventListener("reset"'));
const listeners = new Map();
const batch = new Map([["drums", new File([new Uint8Array(3)], "drums.wav")], ["bass", new File([new Uint8Array(3)], "bass.wav")]]);
const attempts = [];
let nextId = 0;
let failUpload = true;
const uiState = { authenticated: true, loading: false, retryUploadId: null, packs: [] };
const noop = () => {};
class Input { type = "file"; }
const uiContext = {
  stemVaultState: uiState, File, HTMLInputElement: Input,
  FormData: class {
    constructor(form) { this.data = form ? batch : new Map(); }
    get(name) { return this.data.get(name); }
    append(name, value) { this.data.set(name, value); }
  },
  elements: { stemVaultForm: { addEventListener(name, fn) { listeners.set(name, fn); }, reset: noop, elements: { bpm: {} } } },
  crypto: { randomUUID: () => `retry-${++nextId}` },
  normalizedAudioType: () => "audio/wav", audioDuration: async () => 1,
  renderStemVault: noop, setStemVaultStatus: noop, syncStemVaultTracks: noop, showToast: noop,
  stemVaultUi: { start: noop, progress: noop, fail: noop, success: noop },
  window: { HaloUploadProgress: { async uploadChunkedFile(options) {
    attempts.push(options.buildBody({ chunkIndex: 0, chunkCount: 1, start: 0, end: 3 }).get("uploadId"));
    if (failUpload) throw new Error("Retryable interruption");
  } } },
  fetch: async (_url, options) => ({
    ok: true, json: async () => options?.method === "POST"
      ? { pack: { title: "Saved", stems: [], sourceProvider: "halo" } }
      : { capacity: { unlimited: false, usedBytes: cap, capacityBytes: cap, uploadReservedBytes: 6 } }
  })
};
runInNewContext(`${saveSource}\n${retryListeners}\nglobalThis.saveBatch = saveStemPack;`, uiContext);
await uiContext.saveBatch({ preventDefault: noop });
await uiContext.saveBatch({ preventDefault: noop });
assert.deepEqual(attempts, ["retry-1", "retry-1"], "unchanged failed batches retry with the same upload ID, even at capacity");
listeners.get("change")({ target: new Input() });
await uiContext.saveBatch({ preventDefault: noop });
assert.equal(attempts.at(-1), "retry-2", "changing file selection starts a new upload identity");
failUpload = false;
await uiContext.saveBatch({ preventDefault: noop });
assert.equal(uiState.retryUploadId, null, "successful save clears retry identity");

// Optional real PostgreSQL exercises the SQL row locks, rather than the handler's DB stub.
if (process.env.HALO_VAULT_TEST_DATABASE_URL) {
  const exec = promisify(execFile);
  const schema = `vault_contract_${process.pid}`;
  const connection = process.env.HALO_VAULT_TEST_DATABASE_URL;
  const sql = async (query, scoped = true) => (await exec("psql", [connection, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query],
    { env: { ...process.env, PGOPTIONS: scoped ? `-c search_path=${schema}` : "" } })).stdout.trim();
  const metadata = JSON.stringify({ title: "SQL pack", description: "", sourceProvider: "halo", sourceProjectUrl: "", generationPrompt: "", bpm: 124, key: "", genre: "", mood: "" });
  const files = JSON.stringify(finalizeBody.files.map(file => ({ ...file, durationSeconds: 0 })));
  try {
    await sql(`CREATE SCHEMA ${schema}`, false);
    await sql("CREATE TABLE halo_memberships(member_id TEXT PRIMARY KEY); CREATE TABLE halo_creator_passes(member_id TEXT PRIMARY KEY, subscription_tier TEXT, subscription_status TEXT, subscription_expires_at TIMESTAMPTZ, trial_ends_at TIMESTAMPTZ);");
    await sql(await readFile(new URL("../netlify/database/migrations/20260815120000_create-halo-stem-vault.sql", import.meta.url), "utf8"));
    await sql(`INSERT INTO halo_memberships VALUES ('owner'); INSERT INTO halo_stem_packs(id,member_id,title,status) VALUES ('${otherId}','owner','Archived legacy','archived'); INSERT INTO halo_stem_files(pack_id,stem_type,original_filename,blob_key,chunk_count,content_type,byte_size) VALUES ('${otherId}','drums','legacy.wav','legacy/',1,'audio/wav',10);`);
    await sql(migration);
    assert.equal(await sql("SELECT used_bytes FROM halo_stem_vault_usage"), "10");
    await sql(`UPDATE halo_stem_vault_usage SET used_bytes=${cap - 3}`);
    const hash = "a".repeat(64);
    const reserve = stem => sql(`SELECT halo_reserve_stem_chunk('owner','${uploadId}','${stem}',0,1,3,'${hash}')`);
    // Each sql() call launches its own psql process and independent database connection.
    assert.deepEqual((await Promise.all([reserve("drums"), reserve("bass")])).sort(), ["capacity", "reserved"]);
    const storedStem = await sql("SELECT stem_type FROM halo_stem_vault_chunks");
    assert.equal(await reserve(storedStem), "retry");
    assert.equal(await sql(`SELECT halo_reserve_stem_chunk('owner','${uploadId}','${storedStem}',0,1,3,'${"b".repeat(64)}')`), "conflict");
    assert.equal(await sql("SELECT used_bytes FROM halo_stem_vault_usage"), String(cap));
    await sql("INSERT INTO halo_creator_passes VALUES ('owner','PREMIUM','active',NOW()+INTERVAL '1 day',NULL)");
    assert.equal(await reserve(storedStem === "bass" ? "drums" : "bass"), "reserved");
    assert.equal(await sql("SELECT halo_stem_vault_capacity('owner') IS NULL"), "t");
    await sql("UPDATE halo_creator_passes SET subscription_expires_at = NOW()-INTERVAL '1 second'");
    assert.equal(await sql(`SELECT halo_finalize_stem_pack('owner','${uploadId}','${metadata}'::jsonb,'${files}'::jsonb)`), "capacity");
    await sql("UPDATE halo_creator_passes SET subscription_expires_at = NULL");
    assert.equal(await sql("SELECT halo_stem_vault_capacity('owner')"), String(cap), "active without authoritative expiry is Standard");
    assert.equal(await sql("BEGIN; UPDATE halo_creator_passes SET subscription_status='active', subscription_expires_at=NOW()+INTERVAL '0.1 seconds'; SELECT pg_sleep(0.2); SELECT halo_stem_vault_capacity('owner'); COMMIT;"), String(cap), "premium expiry is checked at enforcement time, not the transaction start");
    await sql("UPDATE halo_creator_passes SET subscription_expires_at=NULL");
    await sql("UPDATE halo_creator_passes SET subscription_status='trialing', trial_ends_at=NOW()+INTERVAL '1 day'");
    assert.equal(await sql("SELECT halo_stem_vault_capacity('owner') IS NULL"), "t");
    await sql("UPDATE halo_creator_passes SET subscription_tier='STANDARD'");
    assert.equal(await sql(`SELECT halo_finalize_stem_pack('owner','${uploadId}','${metadata}'::jsonb,'${files}'::jsonb)`), "capacity", "a tier downgrade denies over-cap finalization");
    await sql("UPDATE halo_creator_passes SET subscription_tier='PREMIUM'");
    assert.equal(await sql(`SELECT halo_finalize_stem_pack('owner','${uploadId}','${metadata}'::jsonb,'${files}'::jsonb)`), "saved");
    assert.equal(await sql(`SELECT halo_finalize_stem_pack('owner','${uploadId}','${metadata}'::jsonb,'${files}'::jsonb)`), "saved");
    assert.equal(await sql(`SELECT COUNT(*) FROM halo_stem_files WHERE pack_id='${uploadId}'`), "2");
    const beforeArchive = await sql("SELECT used_bytes FROM halo_stem_vault_usage");
    await sql(`UPDATE halo_stem_packs SET status='archived' WHERE id='${uploadId}'`);
    assert.equal(await sql("SELECT used_bytes FROM halo_stem_vault_usage"), beforeArchive, "archiving a newly finalized pack retains usage");
    const failedId = "33333333-3333-4333-8333-333333333333";
    for (const stem of ["drums", "bass"]) {
      assert.equal(await sql(`SELECT halo_reserve_stem_chunk('owner','${failedId}','${stem}',0,1,3,'${hash}')`), "reserved");
    }
    const beforeFailure = await sql("SELECT used_bytes FROM halo_stem_vault_usage");
    const invalidFiles = JSON.parse(files);
    invalidFiles[1].contentType = "invalid/audio";
    await assert.rejects(sql(`SELECT halo_finalize_stem_pack('owner','${failedId}','${metadata}'::jsonb,'${JSON.stringify(invalidFiles)}'::jsonb)`), /halo_stem_files_content_type_check/);
    assert.equal(await sql(`SELECT COUNT(*) FROM halo_stem_packs WHERE id='${failedId}'`), "0", "file insertion failure rolls back the pack");
    assert.equal(await sql(`SELECT COUNT(*) FROM halo_stem_files WHERE pack_id='${failedId}'`), "0", "second-file failure rolls back the first file");
    assert.equal(await sql("SELECT used_bytes FROM halo_stem_vault_usage"), beforeFailure, "failed finalize retains durable reservations");
    assert.equal(await sql(`SELECT halo_finalize_stem_pack('owner','${failedId}','${metadata}'::jsonb,'${files}'::jsonb)`), "saved", "retry succeeds after an atomic rollback");
    console.log("PASS: PostgreSQL independent-connection concurrency, archived accounting, retries, expiry/downgrade and atomic finalize rollback");
  } finally {
    await sql(`DROP SCHEMA IF EXISTS ${schema} CASCADE`, false);
  }
}
console.log("Creator Pass vault contracts passed");
