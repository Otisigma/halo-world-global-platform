import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { DNA_TERMS } from "../lib/creative-dna.js";
import { dnaInput, dnaOwner, dnaProfile, dnaQuota, dnaSearch, saveDna, searchInput } from "../netlify/lib/creative-dna.mjs";
import { createCreatorNetworkHandler } from "../netlify/lib/creator-network.mjs";

const databaseUrl = process.env.CREATIVE_DNA_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log("Creative DNA PostgreSQL contracts skipped: set CREATIVE_DNA_TEST_DATABASE_URL to a disposable test database");
  process.exit(0);
}
const schema = `dna_contract_${randomUUID().replaceAll("-", "")}`;
const env = { ...process.env, PGDATABASE: databaseUrl };
async function psql(sql, params = []) {
  const args = ["--dbname", databaseUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  params.forEach((value, index) => {
    if (value !== null) args.push(`--set=p${index}=${Array.isArray(value) ? `{${value.map(item => `"${String(item).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}` : String(value)}`);
  });
  return new Promise((resolve, reject) => {
    const child = spawn("psql", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
    child.stdin.end(`SET search_path TO ${schema}; ${sql}`);
  });
}
const db = {
  sql: async (parts, ...params) => {
    const sql = parts.map((part, index) =>
      part + (index < params.length ? params[index] === null ? "NULL" : `:'p${index}'` : "")
    ).join("");
    const output = await psql(`WITH query_result AS (${sql})
      SELECT COALESCE(json_agg(query_result), '[]'::json) FROM query_result;`, params);
    return JSON.parse(output);
  }
};
const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [networkMigration, dnaMigration] = await Promise.all([
  read("netlify/database/migrations/20261003095500_create_creator_network.sql"),
  read("netlify/database/migrations/20261006060000_create_creative_dna.sql")
]);
const input = (revision, overrides = {}) => dnaInput({
  action: "save_dna", creativeStatement: "Café atmospheric production", creativeGoals: "Create together",
  workflowNotes: "PRIVATE WORKFLOW", visibility: "public", expectedRevision: revision,
  termIds: ["sonic:atmospheric", "mood:uplifting"], ...overrides
});

try {
  await psql(`CREATE SCHEMA ${schema};
    CREATE TABLE halo_memberships(member_id TEXT PRIMARY KEY);
    CREATE TABLE halo_artist_pages(slug TEXT PRIMARY KEY);
    CREATE TABLE halo_song_catalog(id TEXT PRIMARY KEY);
    CREATE TABLE halo_song_versions(id TEXT PRIMARY KEY);
    CREATE TABLE halo_stem_packs(id TEXT PRIMARY KEY);
    CREATE TABLE halo_artist_rights_works(id TEXT PRIMARY KEY);
    CREATE TABLE halo_signal_blocks(member_id TEXT NOT NULL, target_member_id TEXT NOT NULL);
    CREATE TABLE halo_creator_passes(member_id TEXT PRIMARY KEY, subscription_tier TEXT,
      subscription_status TEXT, subscription_expires_at TIMESTAMPTZ, trial_ends_at TIMESTAMPTZ);
    CREATE TABLE halo_release_campaigns(id TEXT PRIMARY KEY, owner_member_id TEXT, title TEXT,
      official_url TEXT, status TEXT, release_date DATE);
    ${networkMigration}
    ${dnaMigration}`);
  await psql(dnaMigration);
  const vocabulary = JSON.parse(await psql("SELECT json_agg(t ORDER BY id) FROM halo_creator_dna_terms t"));
  assert.deepEqual(vocabulary, [...DNA_TERMS].sort((a, b) => a.id.localeCompare(b.id)).map(term => ({ ...term })));
  await psql(`
    INSERT INTO halo_memberships VALUES ('public'),('members'),('private'),('hidden'),('premium'),('expired'),('viewer');
    INSERT INTO halo_creator_profiles(member_id, display_name, bio, roles, genres, languages, discoverable)
    SELECT member_id, 'Creator ' || member_id, 'Atmospheric bio', ARRAY['Producer'], ARRAY['House'], ARRAY['English'],
      member_id <> 'hidden' FROM halo_memberships;
    INSERT INTO halo_creator_passes VALUES
      ('premium','PREMIUM','active',NOW() + INTERVAL '1 day',NULL),
      ('expired','PREMIUM','active',NOW() - INTERVAL '1 second',NULL);`);
  const first = await Promise.allSettled([
    saveDna(db, "public", input(0, { creativeStatement: "FIRST" })),
    saveDna(db, "public", input(0, { creativeStatement: "SECOND", termIds: ["skill:production"] }))
  ]);
  assert.equal(first.filter(result => result.status === "fulfilled").length, 1, "Exactly one revision-zero creation succeeds");
  assert.equal(first.find(result => result.status === "rejected").reason.status, 409);
  const persisted = await dnaOwner(db, "public");
  assert.equal(persisted.dna.revision, 1);
  assert.deepEqual(persisted.dna.termIds, first.find(result => result.status === "fulfilled").value.dna.termIds);
  const updates = await Promise.allSettled([
    saveDna(db, "public", input(1)),
    saveDna(db, "public", input(1, { creativeGoals: "Conflicting", termIds: ["mood:dark"] }))
  ]);
  assert.equal(updates.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await dnaOwner(db, "public")).dna.revision, 2);
  const beforeInvalid = await dnaOwner(db, "public");
  await assert.rejects(psql(`SELECT * FROM halo_save_creator_dna(
    'public','INVALID','goals','notes','public',2,ARRAY['sonic:not-allowed']);`));
  assert.deepEqual((await dnaOwner(db, "public")).dna, beforeInvalid.dna, "Invalid tag update rolls back revision, text and tags");
  await assert.rejects(psql(`SELECT * FROM halo_save_creator_dna(
    'public',repeat('x',601),'goals','notes','public',2,ARRAY['mood:dark']);`));
  assert.deepEqual((await dnaOwner(db, "public")).dna, beforeInvalid.dna);
  await assert.rejects(psql(`SELECT * FROM halo_save_creator_dna(
    'public','test','','','public',2,ARRAY['mood:dark','mood:dark']);`));
  await assert.rejects(psql(`SELECT * FROM halo_save_creator_dna(
    'public','test','','','public',2,(SELECT array_agg(id) FROM halo_creator_dna_terms WHERE dimension='sonic'));`));
  await saveDna(db, "public", input(2));
  const capTerms = DNA_TERMS.filter(term => term.dimension === "sonic").map(term => term.id);
  await saveDna(db, "hidden", input(0, { termIds: capTerms.slice(0, 8) }));
  await assert.rejects(psql(`INSERT INTO halo_creator_dna_tags VALUES('hidden','sonic:experimental','sonic');`));
  await psql(`UPDATE halo_creator_dna_tags SET dimension = 'sonic'
    WHERE member_id = 'hidden' AND term_id = 'sonic:atmospheric';`);
  await assert.rejects(psql(`INSERT INTO halo_creator_dna_tags VALUES('hidden','mood:dark','sonic');`));
  await assert.rejects(psql(`UPDATE halo_creator_profiles SET public_profile_id = NULL WHERE member_id='hidden';`));
  await assert.rejects(psql(`UPDATE halo_creator_profiles SET public_profile_id =
    (SELECT public_profile_id FROM halo_creator_profiles WHERE member_id='public') WHERE member_id='hidden';`));
  for (const [member, visibility] of [["members", "members"], ["private", "private"], ["premium", "public"], ["expired", "public"]]) {
    await saveDna(db, member, input(0, { visibility }));
  }
  await saveDna(db, "private", input(1, { visibility: "private", creativeStatement: "SECRETUNIQUE", termIds: ["mood:dark"] }));
  const url = suffix => new URL(`https://halo.test/api/creator-network?view=dna_search${suffix}`);
  const search = (suffix = "", memberId = null) => dnaSearch(db, memberId, searchInput(url(suffix), memberId));
  const anonymous = await search();
  assert.equal(anonymous.total, 3, "Public excludes members/private/hidden profiles");
  assert.equal(anonymous.creators[0].displayName, "Creator premium");
  assert.ok(anonymous.creators.find(row => row.displayName === "Creator expired").premiumVerified === false);
  assert.ok(anonymous.creators.every(row => !row.canInvite));
  await psql(`UPDATE halo_creator_passes SET subscription_status='trialing',
    trial_ends_at=NOW()+INTERVAL '1 day', subscription_expires_at=NULL WHERE member_id='premium';`);
  assert.equal((await search()).creators.find(row => row.displayName === "Creator premium").premiumVerified, true);
  await psql(`UPDATE halo_creator_passes SET subscription_expires_at=NOW()-INTERVAL '1 second' WHERE member_id='premium';`);
  assert.equal((await search()).creators.find(row => row.displayName === "Creator premium").premiumVerified, false);
  await psql(`UPDATE halo_creator_passes SET trial_ends_at=NOW()-INTERVAL '1 second', subscription_expires_at=NULL WHERE member_id='premium';`);
  assert.equal((await search()).creators.find(row => row.displayName === "Creator premium").premiumVerified, false);
  await psql(`UPDATE halo_creator_passes SET subscription_status='active',
    subscription_expires_at=NOW()+INTERVAL '1 day' WHERE member_id='premium';`);
  const authenticated = await search("", "viewer");
  assert.equal(authenticated.total, 4, "Authenticated users also see members-only DNA");
  assert.ok(!JSON.stringify(authenticated).includes("PRIVATE WORKFLOW"));
  assert.equal((await search("&q=SECRETUNIQUE", "viewer")).total, 0);
  assert.equal((await search("&term=mood:dark", "viewer")).total, 0, "Private tags never influence counts");
  assert.equal((await search("&role=Producer&genre=House&language=English&bpm=124")).total, 0);
  assert.equal((await search("&q=Café&term=sonic:atmospheric")).total, 3);
  const seen = [];
  let cursor = "";
  do {
    const result = await search(`&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(result.total, 3);
    seen.push(...result.creators.map(row => row.publicProfileId));
    cursor = result.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 3);
  assert.equal(seen.length, 3);
  const ids = JSON.parse(await psql("SELECT json_object_agg(member_id,public_profile_id) FROM halo_creator_profiles"));
  await assert.rejects(dnaProfile(db, null, ids.members), error => error.status === 404);
  await assert.rejects(dnaProfile(db, "viewer", ids.private), error => error.status === 404);
  await assert.rejects(dnaProfile(db, "viewer", ids.hidden), error => error.status === 404);
  await psql(`INSERT INTO halo_release_campaigns VALUES
    ('published','public','Public release','https://example.com/release','published',CURRENT_DATE),
    ('draft','public','Draft release','https://example.com/draft','draft',CURRENT_DATE),
    ('unsafe','public','Unsafe link','https://example.com/?token=secret','published',CURRENT_DATE);
    INSERT INTO halo_creator_projects(id,owner_member_id,title) VALUES('open','public','Open');
    INSERT INTO halo_creator_projects(id,owner_member_id,title,status) VALUES('closed','public','Closed','closed');
    INSERT INTO halo_creator_projects(id,owner_member_id,title) VALUES('viewer-open','viewer','Viewer open');
    INSERT INTO halo_creator_projects(id,owner_member_id,title,status) VALUES('viewer-closed','viewer','Viewer closed','closed');`);
  const visitor = await dnaProfile(db, "viewer", ids.public);
  assert.equal(visitor.releases.length, 1);
  assert.deepEqual(visitor.projects, [{ id: "viewer-open", title: "Viewer open" }]);
  assert.deepEqual((await dnaProfile(db, null, ids.public)).projects, [], "Anonymous visitors have no invitation choices");
  assert.ok(!JSON.stringify(visitor).includes("PRIVATE WORKFLOW"));
  assert.deepEqual((await dnaProfile(db, "public", ids.public)).projects, [{ id: "open", title: "Open" }]);
  await psql("INSERT INTO halo_signal_blocks VALUES('public','viewer'),('viewer','premium');");
  assert.equal((await search("", "viewer")).total, 2, "Both block directions excluded");
  await assert.rejects(dnaProfile(db, "viewer", ids.public), error => error.status === 404);
  await assert.rejects(dnaProfile(db, "viewer", ids.premium), error => error.status === 404);
  const handlerFor = memberId => createCreatorNetworkHandler({
    getDatabase: async () => db, getUser: async request => {
      assert.ok(request instanceof Request); return { id: memberId };
    }, ensureMembership: async () => ({ member_id: memberId }),
    verifyRequestOrigin: () => true
  });
  const request = (memberId, body, suffix = "") => handlerFor(memberId)(new Request(`https://halo.test/api/creator-network${suffix}`, {
    method: body ? "POST" : "GET", headers: { origin: "https://halo.test", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  }));
  assert.equal((await request("public", { action: "invite", projectId: "open", publicProfileId: ids.members })).status, 200);
  assert.equal((await request("public", { action: "invite", projectId: "open", publicProfileId: ids.private })).status, 404);
  assert.equal((await request("public", { action: "invite", projectId: "open", memberId: "viewer" })).status, 404);
  assert.equal((await request("viewer", { action: "apply", projectId: "open" })).status, 404);
  assert.equal((await request("viewer", { action: "invite", projectId: "open", publicProfileId: ids.members })).status, 403);
  assert.equal(await psql("SELECT member_id FROM halo_creator_participants WHERE project_id='open'"), "members");
  const workspace = await (await request("viewer")).json();
  assert.ok(!workspace.creators.some(row => ["public", "premium"].includes(row.member_id)), "Legacy member workspace also honors bilateral blocks");
  const firstHandlerPage = await (await request("viewer", null, "?view=dna_search&limit=1")).json();
  assert.ok(firstHandlerPage.nextCursor);
  assert.equal((await request("viewer", null, `?view=dna_search&limit=1&cursor=${firstHandlerPage.nextCursor}`)).status, 200);
  assert.equal((await request("viewer", null, `?view=dna_search&limit=1&q=changed&cursor=${firstHandlerPage.nextCursor}`)).status, 400);
  await psql("DELETE FROM halo_creator_dna_rate_limits;");
  const quotas = await Promise.allSettled(Array.from({ length: 24 }, () => dnaQuota(db, "viewer", "write")));
  assert.equal(quotas.filter(result => result.status === "fulfilled").length, 20);
  assert.ok(quotas.filter(result => result.status === "rejected").every(result => result.reason.status === 429));
  await psql("UPDATE halo_creator_dna_rate_limits SET window_start=NOW()-INTERVAL '61 seconds';");
  await dnaQuota(db, "viewer", "write");
  assert.equal(await psql("SELECT attempts FROM halo_creator_dna_rate_limits WHERE bucket='member:viewer:write'"), "1");
  await psql("INSERT INTO halo_creator_dna_rate_limits(bucket,attempts) VALUES('public:search',239);");
  const globalQuota = await Promise.allSettled([dnaQuota(db, null, "search"), dnaQuota(db, null, "search")]);
  assert.equal(globalQuota.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(globalQuota.find(result => result.status === "rejected").reason.status, 429);
  await psql("DELETE FROM halo_creator_profiles WHERE member_id='private';");
  assert.equal(await psql("SELECT count(*) FROM halo_creator_dna WHERE member_id='private'"), "0");
  assert.equal(await psql("SELECT count(*) FROM halo_creator_dna_tags WHERE member_id='private'"), "0");
  console.log("Creative DNA PostgreSQL contracts passed: actual migration twice, vocabulary, parallel create/update conflicts, atomic tags, constraints, visibility, search, keyset pagination, links, Premium expiry, blocks and concurrent quotas");
} finally {
  await psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}
