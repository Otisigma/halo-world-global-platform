import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, chown } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { captureRegisteredMaster } from "../netlify/lib/retained-master-service.mjs";
import { loadSnapshotKeys } from "../netlify/lib/retained-master.mjs";

const exec = promisify(execFile);
const pgBin = (await exec("pg_config", ["--bindir"])).stdout.trim();
await exec(`${pgBin}/initdb`, ["--version"]);
const directory = await mkdtemp("/tmp/halo-retained-db-");
const root = process.getuid?.() === 0;
const user = root ? "postgres" : process.env.USER;
const asPostgres = (command, args) => root ? exec("runuser", ["-u", "postgres", "--", command, ...args]) : exec(command, args);
const execute = async query => (await exec(`${pgBin}/psql`, ["-X", "-qAt", "-h", directory, "-U", user,
  "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", query])).stdout.trim();
const literal = value => value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const db = { sql: async (parts, ...values) => {
  const query = parts.reduce((sql, part, index) => sql + (index ? literal(values[index - 1]) : "") + part, "");
  if (/^\s*UPDATE/i.test(query) && !/\bRETURNING\b/i.test(query)) { await execute(query); return []; }
  return JSON.parse(await execute(`WITH result AS (${query}) SELECT COALESCE(json_agg(result), '[]'::json) FROM result`));
} };
const songId = "11111111-1111-4111-8111-111111111111", versionId = "22222222-2222-4222-8222-222222222222";
const prefix = `owner/${versionId}/session-12345/parts/`;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keys = loadSnapshotKeys({ HALO_PROVENANCE_SIGNING_KEY_ID: "v1",
  HALO_PROVENANCE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  HALO_PROVENANCE_PUBLIC_KEYS: JSON.stringify({ v1: publicKey.export({ type: "spki", format: "pem" }) }) });
const config = { retentionDays: 1, storage: { bucket: "retained", region: "us-east-1", accessKeyId: "test",
  secretAccessKey: "test", endpoint: "https://storage.example.test", forcePathStyle: true } };
let releasePut, enteredPut, storageBytes, retention, putCount = 0;
let entered = new Promise(resolve => { enteredPut = resolve; });
let blocked = new Promise(resolve => { releasePut = resolve; });
const fetchImpl = async (url, options = {}) => {
  if (options.method === "PUT") {
    putCount++;
    const chunks = [];
    for await (const bytes of options.body) chunks.push(bytes);
    storageBytes = Buffer.concat(chunks);
    retention = options.headers["x-amz-object-lock-retain-until-date"];
    enteredPut();
    await blocked;
    return new Response(null, { headers: { "x-amz-version-id": "retained-version" } });
  }
  assert.equal(new URL(url).searchParams.get("versionId"), "retained-version");
  return new Response(options.method === "HEAD" ? null : storageBytes, { headers: {
    "x-amz-version-id": "retained-version", "x-amz-object-lock-mode": "COMPLIANCE",
    "x-amz-object-lock-retain-until-date": retention, "content-length": String(storageBytes.length),
  } });
};
const deps = { db, owner: "owner", songId, versionId, config, keys, sourceStorage: null, fetchImpl,
  blobStore: { get: async () => new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3)); controller.close(); } }) } };
let running = false;
try {
  if (root) await chown(directory, Number((await exec("id", ["-u", "postgres"])).stdout), Number((await exec("id", ["-g", "postgres"])).stdout));
  await asPostgres(`${pgBin}/initdb`, ["-D", `${directory}/data`, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  await asPostgres(`${pgBin}/pg_ctl`, ["-D", `${directory}/data`, "-o", `-k ${directory} -h '' -p 5432`,
    "-l", `${directory}/postgres.log`, "-w", "start"]);
  running = true;
  await execute(`
    CREATE TABLE halo_song_catalog (id TEXT PRIMARY KEY, owner_member_id TEXT, status TEXT);
    CREATE TABLE halo_song_versions (id TEXT PRIMARY KEY, song_id TEXT, version_type TEXT, status TEXT,
      audio_storage_key TEXT, audio_blob_prefix TEXT, audio_chunk_count INTEGER, audio_byte_size INTEGER);
    ${await readFile(new URL("../netlify/database/migrations/20261108010000_master_provenance_observations.sql", import.meta.url), "utf8")}
    ${await readFile(new URL("../netlify/database/migrations/20261108020000_retained_master_snapshots.sql", import.meta.url), "utf8")}
    INSERT INTO halo_song_catalog VALUES ('${songId}', 'owner', 'active');
    INSERT INTO halo_song_versions VALUES ('${versionId}', '${songId}', 'sale_master', 'active', '', '${prefix}', 1, 3);
  `);
  await execute(await readFile(new URL("../netlify/database/migrations/20261108020000_retained_master_snapshots.sql", import.meta.url), "utf8"));
  const first = captureRegisteredMaster(deps);
  await entered;
  const overlap = await captureRegisteredMaster(deps);
  assert.equal(overlap.state, "pending", "overlapping function instances cannot claim the same source");
  releasePut();
  const receipt = await first;
  assert.equal(receipt.state, "ready");
  assert.equal((await captureRegisteredMaster(deps)).alreadyCaptured, true);
  assert.equal(putCount, 1);
  assert.equal(await execute("SELECT count(*) FROM halo_retained_master_snapshots WHERE status='ready'"), "1");

  await execute(`UPDATE halo_song_versions SET audio_blob_prefix='owner/${versionId}/next/parts/';
    UPDATE halo_master_provenance_read_limits SET last_started=NOW()-INTERVAL '2 minutes';`);
  entered = new Promise(resolve => { enteredPut = resolve; });
  blocked = new Promise(resolve => { releasePut = resolve; });
  const replaced = captureRegisteredMaster(deps);
  await entered;
  await execute(`UPDATE halo_song_versions SET audio_blob_prefix='owner/${versionId}/replacement/parts/';`);
  releasePut();
  await assert.rejects(replaced, /registration changed/);
  assert.equal(await execute("SELECT count(*) FROM halo_retained_master_snapshots WHERE status='failed'"), "1");
  assert.equal(await execute("SELECT count(*) FROM halo_retained_master_snapshots WHERE status='ready'"), "1",
    "a concurrent replacement cannot certify a different registration");

  await execute("UPDATE halo_master_provenance_read_limits SET last_started=NOW()-INTERVAL '2 minutes'");
  entered = new Promise(resolve => { enteredPut = resolve; });
  blocked = new Promise(resolve => { releasePut = resolve; });
  const expiredAttempt = captureRegisteredMaster(deps);
  await entered;
  const releaseExpired = releasePut;
  await execute(`UPDATE halo_retained_master_snapshots SET lease_until=NOW()-INTERVAL '1 minute' WHERE status='pending';
    UPDATE halo_master_provenance_read_limits SET last_started=NOW()-INTERVAL '2 minutes';`);
  entered = new Promise(resolve => { enteredPut = resolve; });
  blocked = new Promise(resolve => { releasePut = resolve; });
  const recovery = captureRegisteredMaster(deps);
  await entered;
  releasePut();
  assert.equal((await recovery).state, "ready");
  releaseExpired();
  await assert.rejects(expiredAttempt, /superseded/);
  assert.equal(await execute("SELECT count(*) FROM halo_retained_master_snapshots WHERE status='ready'"), "2",
    "an expired attempt cannot overwrite or fail a newer completed lease");
  console.log("Retained snapshot PostgreSQL contracts passed: migration, concurrent claim, idempotent retry and replacement CAS.");
} finally {
  if (running) await asPostgres(`${pgBin}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
