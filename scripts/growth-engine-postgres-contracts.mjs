import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { createGrowthStore } from "../netlify/lib/growth-engine-store.mjs";

const executable = promisify(execFile);
const pgBin = "/usr/lib/postgresql/16/bin";
if (spawnSync(`${pgBin}/initdb`, ["--version"]).status !== 0) {
  console.log("Growth PostgreSQL contracts skipped: local PostgreSQL binaries unavailable");
} else {
  const directory = await mkdtemp("/tmp/halo-growth-pg-");
  let server;
  try {
    await executable(`${pgBin}/initdb`, ["-D", `${directory}/data`, "-A", "trust", "--no-locale"]);
    server = spawn(`${pgBin}/postgres`, ["-D", `${directory}/data`, "-k", directory, "-h", "", "-p", "5432"],
      { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    server.stderr.on("data", chunk => { errors += chunk; });
    async function sql(query) {
      const { stdout } = await executable("psql", ["-X", "-q", "--csv", "-v", "ON_ERROR_STOP=1",
        "-h", directory, "-U", process.env.USER || "runner", "-d", "postgres", "-c", query]);
      const rows = [];
      let row = [], field = "", quoted = false;
      for (let index = 0; index < stdout.length; index++) {
        const character = stdout[index];
        if (character === '"') {
          if (quoted && stdout[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted;
        } else if (!quoted && (character === "," || character === "\n")) {
          row.push(field); field = "";
          if (character === "\n") { rows.push(row); row = []; }
        } else field += character;
      }
      const keys = rows.shift() || [];
      return rows.map(values => Object.fromEntries(keys.map((key, index) => {
        const value = values[index];
        return [key, value === "" ? null : /^[{[]/.test(value) ? JSON.parse(value) : value];
      })));
    }
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await sql("SELECT 1"); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, errors);
    await sql(`
      CREATE TABLE halo_song_catalog (id text PRIMARY KEY, owner_member_id text, title text,
        artist_name text, genre text, rights_status text, artwork_url text, status text,
        artwork_blob_prefix text, artwork_uploaded_at timestamptz);
      CREATE TABLE halo_song_versions (id text PRIMARY KEY, song_id text, version_type text,
        status text, artwork_url text, audio_url text, audio_storage_key text, audio_blob_prefix text,
        audio_chunk_count integer, drive_file_id text, video_url text, duration_seconds integer, updated_at timestamptz,
        artwork_blob_prefix text, artwork_uploaded_at timestamptz);
      INSERT INTO halo_song_catalog VALUES ('song', 'owner', 'Track', 'Artist', 'House', 'cleared', '/cover.jpg', 'active', 'cover/1', NOW());
      INSERT INTO halo_song_versions VALUES ('master', 'song', 'sale_master', 'active', '', '/master.wav', '', '', 0, '', '', 60, NOW(), '', NULL);
    `);
    const migration = await readFile(new URL("../netlify/database/migrations/20261014120000_growth_engine.sql", import.meta.url), "utf8");
    await sql(migration);
    await sql(migration);
    const quote = value => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
    const db = { sql: (strings, ...values) => sql(strings.reduce((query, string, index) =>
      query + string + (index < values.length ? quote(values[index]) : ""), "")) };
    const store = createGrowthStore(db);
    const input = { requestKey: "one", rights: { master: true, visual: true, promotion: true } };
    const campaign = await store.ingest("owner", "song", input);
    assert.equal((await store.ingest("owner", "song", input)).id, campaign.id, "idempotent campaign creation");
    assert.equal((await store.get("owner", campaign.id)).jobs.length, 1);
    assert.equal(await store.get("other", campaign.id), null);
    assert.equal(await store.ingest("other", "song", input), null);
    const claims = await Promise.all([store.claim("owner", campaign.id), store.claim("owner", campaign.id)]);
    assert.equal(claims.filter(Boolean).length, 1, "only one concurrent worker claims a job");
    const job = claims.find(Boolean);
    assert.ok(await store.loadAuthorizedCampaign("owner", campaign.id));
    assert.equal(await store.complete({ ...job, lease_token: "stale" }, { result: {}, next: [] }), false);
    assert.equal(await store.complete(job, {
      result: { ingested: true }, next: [{ id: "analysis", kind: "analysis", key: "analysis", payload: {} }],
    }), true);
    assert.equal(await store.complete(job, { result: {}, next: [] }), false, "completion is fenced and idempotent");
    const analysis = await store.claim("owner", campaign.id);
    assert.equal(analysis.kind, "analysis");
    assert.equal(await store.fail(analysis, "blocked", "Install decoder"), true);
    assert.equal(await store.retry("other", campaign.id, analysis.id), false);
    assert.equal(await store.retry("owner", campaign.id, analysis.id), true);
    assert.equal(await store.claim("owner", campaign.id), null, "retry backoff is enforced");
    await sql("UPDATE halo_growth_jobs SET available_at = NOW() - INTERVAL '1 second' WHERE id = 'analysis'");
    const retry = await store.claim("owner", campaign.id);
    assert.equal(Number(retry.attempts), 2);
    await sql("UPDATE halo_growth_jobs SET locked_until = NOW() - INTERVAL '1 second' WHERE id = 'analysis'");
    assert.equal(await store.complete(retry, { result: {}, next: [] }), false);
    const reclaimed = await store.claim("owner", campaign.id);
    assert.equal(Number(reclaimed.attempts), 3);
    assert.notEqual(reclaimed.lease_token, retry.lease_token);
    await sql("UPDATE halo_growth_jobs SET locked_until = NOW() - INTERVAL '1 second' WHERE id = 'analysis'");
    assert.equal(await store.claim("owner", campaign.id), null);
    const final = (await store.get("owner", campaign.id)).jobs.find(item => item.id === "analysis");
    assert.equal(final.status, "failed", "expired final attempt becomes a terminal failure");
    assert.ok(final.audit.some(event => event.event === "exhausted"));
    assert.equal(await store.retry("owner", campaign.id, final.id), false);
    await sql("UPDATE halo_song_catalog SET artwork_blob_prefix = 'cover/2', artwork_uploaded_at = NOW() WHERE id = 'song'");
    assert.equal(await store.loadAuthorizedCampaign("owner", campaign.id), null, "same-URL artwork replacement invalidates prior rights attestation");
    const updated = await store.ingest("owner", "song", { ...input, requestKey: "new-artwork" });
    assert.ok(await store.loadAuthorizedCampaign("owner", updated.id));
    await sql("UPDATE halo_song_catalog SET rights_status = 'disputed' WHERE id = 'song'");
    assert.equal(await store.loadAuthorizedCampaign("owner", updated.id), null);
    await sql("UPDATE halo_song_catalog SET rights_status = 'cleared' WHERE id = 'song'");
    await sql("UPDATE halo_song_versions SET audio_url = '/replacement.wav' WHERE id = 'master'");
    assert.equal(await store.loadAuthorizedCampaign("owner", updated.id), null, "master changes invalidate the campaign");

    // Invalid downstream inserts must roll back the successful parent checkpoint.
    const second = await store.ingest("owner", "song", { ...input, requestKey: "two" });
    const secondJob = await store.claim("owner", second.id);
    await assert.rejects(() => store.complete(secondJob, {
      result: { ingested: true }, next: [{ id: "invalid", kind: "unknown", key: "invalid", payload: {} }],
    }));
    assert.equal((await store.get("owner", second.id)).jobs[0].status, "running");
    console.log("Growth PostgreSQL contracts passed: migration, ownership, atomicity, concurrent claims, retries and lease fencing");
  } finally {
    if (server && server.exitCode === null) {
      await new Promise(resolve => { server.once("exit", resolve); server.kill("SIGTERM"); });
    }
    await rm(directory, { recursive: true, force: true });
  }
}
