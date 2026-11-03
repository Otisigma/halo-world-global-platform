import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, chown } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { createFanCurationsHandler } from "../netlify/lib/fan-curations.mjs";
import { loadMemberRewards } from "../netlify/lib/track-drops.mjs";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migration = await readFile(`${root}/netlify/database/migrations/20261103110000_fan_curation_rewards.sql`, "utf8");
let pgBin;
try { pgBin = (await exec("pg_config", ["--bindir"])).stdout.trim(); await exec(`${pgBin}/initdb`, ["--version"]); }
catch { throw new Error("PostgreSQL tools required for test:fan-curations:db. Install PostgreSQL and retry; this test does not skip database verification."); }
const directory = await mkdtemp("/tmp/halo-fan-curation-contracts-");
let running = false;
const asPostgres = async (command, args) => process.getuid?.() === 0
  ? exec("runuser", ["-u", "postgres", "--", command, ...args]) : exec(command, args);
const psqlArgs = ["-X", "-qAt", "-h", directory, "-U", process.getuid?.() === 0 ? "postgres" : process.env.USER,
  "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
const execute = async query => (await exec(`${pgBin}/psql`, [...psqlArgs, "-c", query], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const literal = value => value == null ? "NULL"
  : Array.isArray(value) ? `ARRAY[${value.map(literal).join(",")}]`
    : typeof value === "boolean" || typeof value === "number" ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
const db = { sql: async (strings, ...values) => {
  const query = strings.reduce((result, part, index) => result + (index ? literal(values[index - 1]) : "") + part, "");
  return JSON.parse(await execute(`SELECT COALESCE(json_agg(row), '[]'::json) FROM (${query}) row`));
} };
function handler(member) {
  return createFanCurationsHandler({
    getDatabase: () => db, getUser: () => member ? { id: member } : null,
    verifyRequestOrigin: () => true, ensureMembership: () => {}
  });
}
const request = (member, body, path = "/api/fan-curations") => handler(member)(new Request(`https://halo.example${path}`, {
  method: body ? "POST" : "GET",
  headers: { Origin: "https://halo.example", "Content-Type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {})
}));
const tracks = start => Array.from({ length: 3 }, (_, i) => `release-${String(start + i).padStart(2, "0")}`);
const save = (member, start = 0) => request(member, { action: "save", title: `Collection ${start}`, releaseIds: tracks(start) });
const redeem = (member, curationId) => request(member, { action: "redeem", curationId, rewardId: "listening-card" });
const wallet = async member => (await (await request(member)).json()).wallet;
let groups = 0;
async function check(name, run) { await run(); groups++; console.log(`PASS DB: ${name}`); }

try {
  if (process.getuid?.() === 0) {
    const uid = Number((await exec("id", ["-u", "postgres"])).stdout);
    const gid = Number((await exec("id", ["-g", "postgres"])).stdout);
    await chown(directory, uid, gid);
  }
  await asPostgres(`${pgBin}/initdb`, ["-D", `${directory}/data`, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  await asPostgres(`${pgBin}/pg_ctl`, ["-D", `${directory}/data`, "-o", `-k ${directory} -h '' -p 5432`,
    "-l", `${directory}/postgres.log`, "-w", "start"]);
  running = true;
  await execute(`
    CREATE TABLE halo_memberships(member_id TEXT PRIMARY KEY);
    CREATE TABLE halo_song_catalog(id TEXT PRIMARY KEY);
    CREATE TABLE halo_release_campaigns(id TEXT PRIMARY KEY, title TEXT, artist TEXT, status TEXT, visibility TEXT, release_date DATE);
    ${await readFile(`${root}/netlify/database/migrations/20261019030000_track_drop_notifications.sql`, "utf8")}
    ${migration}
    INSERT INTO halo_memberships VALUES ('alice'), ('bob'), ('charlie'), ('no-consent'), ('quota'), ('privacy'), ('browser-member');
    INSERT INTO halo_member_notification_preferences(member_id, rewards_enabled)
      SELECT member_id, member_id <> 'no-consent' FROM halo_memberships;
    INSERT INTO halo_release_campaigns
      SELECT 'release-' || lpad(i::text, 2, '0'), 'Song ' || i, 'Artist ' || i, 'published', 'public', CURRENT_DATE FROM generate_series(0, 20) i;
    INSERT INTO halo_release_campaigns VALUES ('private-track', 'Private title', 'Private artist', 'published', 'private', CURRENT_DATE),
      ('draft-track', 'Draft title', 'Draft artist', 'draft', 'public', CURRENT_DATE);
  `);
  await check("real discover/save/earn/redeem/download loop and existing lifetime tiers", async () => {
    const state = await (await request("alice")).json();
    assert.equal(state.releases.length, 21);
    assert.ok(!JSON.stringify(state).includes("Private title") && !JSON.stringify(state).includes("Draft title"));
    const saved = await save("alice");
    assert.equal(saved.status, 201);
    const first = await saved.json();
    assert.equal(first.rewardGranted, true);
    assert.deepEqual(await wallet("alice"), { enabled: true, earned: 25, spent: 0, available: 25 });
    assert.equal((await request("alice", null, `/api/fan-curations/card?curationId=${first.curationId}`)).status, 404);
    assert.equal((await redeem("alice", first.curationId)).status, 201);
    assert.deepEqual(await wallet("alice"), { enabled: true, earned: 25, spent: 25, available: 0 });
    assert.equal((await redeem("alice", first.curationId)).status, 200);
    const card = await request("alice", null, `/api/fan-curations/card?curationId=${first.curationId}`);
    assert.equal(card.status, 200);
    assert.match(await card.text(), /Song 0.*Artist 0[\s\S]*Song 1.*Artist 1[\s\S]*Song 2.*Artist 2/);
    const earned = await loadMemberRewards(db, "alice", true);
    assert.equal(earned.points, 25, "card spending must not lower lifetime reward tiers");
    assert.equal(earned.breakdown[2].points, 25);
    await execute(migration);
    assert.equal((await wallet("alice")).spent, 25, "retrying migration must preserve debits");
  });
  await check("same track set, daily award, concurrent saves and private release rejection", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => save("bob").then(async r => ({ status: r.status, ...await r.json() }))));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.equal(new Set(results.map(r => r.curationId)).size, 1);
    assert.equal(results.filter(r => r.rewardGranted).length, 1);
    const reordered = await request("bob", { action: "save", title: "Another title", releaseIds: tracks(0).reverse() });
    assert.equal(reordered.status, 200);
    assert.equal((await reordered.json()).curationId, results[0].curationId);
    assert.equal((await (await save("bob", 3)).json()).rewardGranted, false);
    assert.equal((await wallet("bob")).earned, 25);
    for (const release of ["private-track", "draft-track", "missing-track"]) {
      assert.equal((await request("bob", { action: "save", title: "No", releaseIds: [release, ...tracks(0).slice(0, 2)] })).status, 409);
    }
    assert.equal(await execute("SELECT COUNT(*) FROM halo_fan_curations WHERE member_id = 'bob'"), "2");
    // UTC date, not browser time or payload timestamps, controls the next award.
    await execute("UPDATE halo_member_reward_events SET reward_key = 'fan-curation:2000-01-01' WHERE member_id = 'bob'");
    assert.equal((await (await save("bob", 6)).json()).rewardGranted, true);
    assert.equal((await wallet("bob")).earned, 50);
  });
  await check("concurrent claims cannot overspend or charge a duplicate", async () => {
    const a = await (await save("charlie", 0)).json(), b = await (await save("charlie", 3)).json();
    const claims = await Promise.all([redeem("charlie", a.curationId), redeem("charlie", b.curationId)]);
    assert.deepEqual(claims.map(r => r.status).sort(), [201, 409]);
    assert.deepEqual(await wallet("charlie"), { enabled: true, earned: 25, spent: 25, available: 0 });
    const owner = await execute("SELECT curation_id FROM halo_fan_reward_redemptions WHERE member_id = 'charlie'");
    const repeats = await Promise.all(Array.from({ length: 8 }, () => redeem("charlie", owner)));
    assert.ok(repeats.every(r => r.status === 200));
    assert.equal(await execute("SELECT COUNT(*) FROM halo_fan_reward_redemptions WHERE member_id = 'charlie'"), "1");
  });
  await check("ownership, consent, publication withdrawal and account deletion are enforced", async () => {
    const alice = JSON.parse(await execute("SELECT json_agg(row) FROM (SELECT id FROM halo_fan_curations WHERE member_id = 'alice') row"))[0].id;
    assert.equal((await redeem("bob", alice)).status, 404);
    assert.equal((await request("bob", null, `/api/fan-curations/card?curationId=${alice}`)).status, 404);
    const noConsent = await (await save("no-consent", 0)).json();
    assert.equal(noConsent.rewardGranted, false);
    assert.equal((await wallet("no-consent")).earned, 0);
    assert.equal((await redeem("no-consent", noConsent.curationId)).status, 409);
    await execute("UPDATE halo_member_notification_preferences SET rewards_enabled = FALSE WHERE member_id = 'alice'");
    assert.equal((await redeem("alice", alice)).status, 409);
    assert.equal((await request("alice", null, `/api/fan-curations/card?curationId=${alice}`)).status, 200);
    await execute("UPDATE halo_release_campaigns SET visibility = 'private' WHERE id = 'release-00'");
    const withdrawn = await (await request("alice")).json();
    assert.equal(withdrawn.curations[0].tracks[0].title, null);
    assert.equal(withdrawn.curations[0].tracks[0].publicPath, null);
    assert.equal((await request("alice", null, `/api/fan-curations/card?curationId=${alice}`)).status, 409);
    await execute("UPDATE halo_release_campaigns SET visibility = 'public' WHERE id = 'release-00'");
    await execute("DELETE FROM halo_memberships WHERE member_id = 'charlie'");
    assert.equal(await execute("SELECT COUNT(*) FROM halo_fan_curations WHERE member_id = 'charlie'"), "0");
    assert.equal(await execute("SELECT COUNT(*) FROM halo_fan_reward_redemptions WHERE member_id = 'charlie'"), "0");
  });
  await check("daily save quota and malformed direct SQL inputs fail without grants", async () => {
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) => save("quota", index)));
    assert.equal(responses.filter(r => r.status === 201).length, 10);
    assert.equal(responses.filter(r => r.status === 429).length, 1);
    assert.equal((await wallet("quota")).earned, 25);
    for (const array of ["ARRAY['release-00', 'release-00', 'release-01']", "ARRAY['release-00', NULL, 'release-01']",
      "ARRAY[['release-00','release-01','release-02']]"]) {
      assert.equal(await execute(`SELECT halo_save_fan_curation('quota', 'Bad', ${array}) ->> 'result'`), "invalid");
    }
    assert.equal(await execute("SELECT COUNT(*) FROM halo_fan_curations WHERE member_id = 'quota'"), "10");
    await execute("UPDATE halo_fan_curations SET created_at = NOW() - INTERVAL '2 days' WHERE member_id = 'quota'");
    await execute(`INSERT INTO halo_fan_curations(member_id, title, release_ids, release_set, created_at)
      SELECT 'quota', 'Stored collection', picked.ids, picked.ids, NOW() - INTERVAL '2 days'
      FROM (SELECT ARRAY['release-' || lpad(a::text,2,'0'), 'release-' || lpad(b::text,2,'0'), 'release-' || lpad(c::text,2,'0')] ids
        FROM generate_series(0,20) a, generate_series(0,20) b, generate_series(0,20) c
        WHERE a < b AND b < c) picked
      WHERE NOT EXISTS (SELECT 1 FROM halo_fan_curations stored WHERE stored.member_id = 'quota' AND stored.release_set = picked.ids)
      LIMIT 40`);
    assert.equal((await save("quota", 15)).status, 429, "50 total curations must remain a hard bound");
  });
  await check("consent changes serialize with saves and no award leaks across member accounts", async () => {
    const revocation = execute("BEGIN; UPDATE halo_member_notification_preferences SET rewards_enabled = FALSE WHERE member_id = 'privacy'; SELECT pg_sleep(1) /* fan-consent-lock */; COMMIT");
    let locked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      locked = await execute("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event = 'PgSleep' AND query LIKE '%fan-consent-lock%')") === "t";
      if (locked) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(locked, true, "observe the real revocation transaction holding the preference lock");
    const [response] = await Promise.all([save("privacy"), revocation]);
    const result = await response.json();
    assert.equal(result.rewardGranted, false);
    assert.equal((await wallet("privacy")).earned, 0);
    const guest = await request(null);
    assert.equal(guest.status, 401);
    const bob = await (await request("bob")).json();
    assert.ok(bob.curations.every(c => !c.title.startsWith("Stored")));
  });
  console.log(`Fan curation PostgreSQL contracts passed (${groups} groups).`);

  if (process.argv.includes("--serve")) {
    const member = "browser-member", handle = handler(member);
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1:8877");
        if (url.pathname.startsWith("/api/fan-curations")) {
          const body = [];
          for await (const chunk of req) body.push(chunk);
          const response = await handle(new Request(url, {
            method: req.method, headers: req.headers,
            ...(req.method === "POST" ? { body: Buffer.concat(body) } : {})
          }));
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer())); return;
        }
        if (url.pathname === "/identity.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(`window.haloIdentity = {getUser: async () => ({id:"browser-member"}), onAuthChange: () => () => {}};
            window.dispatchEvent(new CustomEvent("halo-identity-ready", {detail:window.haloIdentity}));`); return;
        }
        if (url.pathname.startsWith("/api/")) { res.writeHead(404); res.end("{}"); return; }
        const path = resolve(root, `.${url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname}`);
        if (!path.startsWith(`${root}/`) || ![".html", ".css", ".js", ".webp", ".png", ".svg", ".webmanifest"].includes(extname(path))) {
          res.writeHead(404); res.end(); return;
        }
        const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
          ".webp": "image/webp", ".png": "image/png", ".webmanifest": "application/manifest+json" };
        res.setHeader("Content-Type", types[extname(path)]);
        res.end(await readFile(path));
      } catch { res.writeHead(500); res.end("Test fixture unavailable"); }
    });
    await new Promise(resolve => server.listen(8877, "127.0.0.1", resolve));
    console.log("Browser fixture ready at http://127.0.0.1:8877/album-concierge/#fan-curations (real disposable PostgreSQL, fixture identity only).");
    await new Promise(resolve => {
      const stop = () => server.close(resolve);
      process.once("SIGTERM", stop); process.once("SIGINT", stop);
    });
  }
} finally {
  if (running) await asPostgres(`${pgBin}/pg_ctl`, ["-D", `${directory}/data`, "-m", "fast", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
