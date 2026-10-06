import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, rm, access } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { createCreatorNetworkHandler } from "../netlify/lib/creator-network.mjs";
import { loadOwnDNA, loadDNAVocabulary, createCreativeDNAHandler } from "../netlify/lib/creative-dna.mjs";
import { DNA_TERMS, emptyDNA, validateDNA, dnaFilters, readDNACursor, nextDNACursor } from "../lib/creative-dna.js";
import { defaultMusicHomeConfig } from "../lib/music-home.js";

// Use the existing PostgreSQL tools when present, never a production database or an external service.
let bin;
try {
  bin = execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  await access(resolve(bin, "initdb"));
} catch {
  console.log("Creative DNA PostgreSQL integration skipped: existing PostgreSQL binaries unavailable (domain/API contracts still run).");
  process.exit(0);
}
// Unix socket paths are length-limited, so keep the repository-local directory name short.
const scratch = resolve(`.d${process.pid}`);
const data = resolve(scratch, "data"), port = String(55000 + process.pid % 1000);
const run = promisify(execFile);
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", scratch, "-p", port, "-U", "dna_test", "-d", "postgres"];
const execute = sql => execFileSync(resolve(bin, "psql"), [...args, "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const literal = value => value == null ? "NULL" : typeof value === "boolean" ? String(value) :
  typeof value === "number" ? String(value) : Array.isArray(value) ? `ARRAY[${value.map(literal).join(",")}]::text[]` :
  `'${String(value).replaceAll("'", "''")}'`;
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
let started = false;
await mkdir(scratch);
try {
  execFileSync(resolve(bin, "initdb"), ["-D", data, "-U", "dna_test", "--no-locale", "-A", "trust"], { stdio: "pipe" });
  try {
    execFileSync(resolve(bin, "pg_ctl"), ["-D", data, "-l", resolve(scratch, "postgres.log"), "-o", `-k ${scratch} -p ${port} -h ''`, "-w", "start"], { stdio: "pipe" });
  } catch (error) {
    console.error(await readFile(resolve(scratch, "postgres.log"), "utf8"));
    throw error;
  }
  started = true;
  execute(`
    CREATE TABLE halo_memberships(member_id TEXT PRIMARY KEY, display_name TEXT, tier TEXT DEFAULT 'member', last_seen_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE halo_artist_pages(slug TEXT PRIMARY KEY, owner_member_id TEXT, status TEXT);
    CREATE TABLE halo_song_catalog(id TEXT PRIMARY KEY);
    CREATE TABLE halo_song_versions(id TEXT PRIMARY KEY);
    CREATE TABLE halo_stem_packs(id TEXT PRIMARY KEY);
    CREATE TABLE halo_artist_rights_works(id TEXT PRIMARY KEY);
    CREATE TABLE halo_signal_blocks(member_id TEXT, target_member_id TEXT, PRIMARY KEY(member_id, target_member_id));
    CREATE TABLE halo_signal_profiles(member_id TEXT PRIMARY KEY, discoverable BOOLEAN DEFAULT TRUE, availability TEXT DEFAULT 'open',
      headline TEXT DEFAULT '', bio TEXT DEFAULT '', roles TEXT[] DEFAULT '{}', genres TEXT[] DEFAULT '{}',
      skills TEXT[] DEFAULT '{}', looking_for TEXT[] DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW(),
      region_code TEXT DEFAULT '', region_label TEXT DEFAULT '', map_visible BOOLEAN DEFAULT FALSE, accent TEXT DEFAULT 'gold');
    CREATE TABLE halo_creator_passes(member_id TEXT PRIMARY KEY, subscription_tier TEXT, subscription_status TEXT,
      subscription_expires_at TIMESTAMPTZ, trial_ends_at TIMESTAMPTZ);
    INSERT INTO halo_memberships(member_id, display_name) VALUES ('owner', 'Owner'), ('viewer', 'Viewer'),
      ('concurrent', 'Concurrent'), ('standard', 'Standard'), ('new-member', 'New');
    INSERT INTO halo_artist_pages VALUES ('owned-room', 'owner', 'published'), ('other-room', 'viewer', 'published');
  `);
  execute(await read("netlify/database/migrations/20261003095500_create_creator_network.sql"));
  execute(await read("netlify/database/migrations/20261004050000_create_music_homes.sql"));
  const migration = await read("netlify/database/migrations/20261006050000_create_creative_dna.sql");
  execute(migration);
  execute(migration);
  const catalog = JSON.parse(execute("SELECT jsonb_agg(jsonb_build_object('id',id,'category',category,'label',label,'aliases',aliases,'normalizedKey',normalized_key,'active',active) ORDER BY id) FROM halo_creator_interest_terms"));
  assert.deepEqual(catalog, [...DNA_TERMS].sort((a, b) => a.id.localeCompare(b.id)));
  execute(`INSERT INTO halo_creator_profiles(member_id, display_name, bio, genres, artist_slug, discoverable)
    VALUES ('owner','Owner','Do not replace my bio',ARRAY['House'],'owned-room',TRUE),
      ('viewer','Viewer','', '{}',NULL,TRUE), ('standard','Standard','',ARRAY['House'],NULL,TRUE);
    INSERT INTO halo_signal_profiles(member_id) VALUES ('owner'), ('viewer'), ('standard');
    INSERT INTO halo_creator_passes VALUES ('owner','PREMIUM','active','2099-01-01',NULL);`);
  const items = [{ termId: "sound.house", category: "sound", label: "House", relationship: "inspired", audience: "public" },
    { termId: "sound.jazz", category: "sound", label: "Jazz", relationship: "learning", audience: "members" },
    { termId: "tools.sampling", category: "tools", label: "Sampling", relationship: "", audience: "private" },
    { termId: null, category: "beyond", label: "Ceramics", relationship: "", audience: "public" }];
  const save = (target, revision, assignments = items, audience = "public", discovery = true, enabled = true) =>
    `SELECT halo_save_creative_dna(${literal(target)},'Creator',${revision},${enabled},${literal(audience)},${discovery},${literal(JSON.stringify(assignments))}::jsonb)`;
  const project = (viewer, destination = "network", discovery = false, slug = "") => JSON.parse(execute(
    `SELECT halo_creative_dna_projection('owner',${literal(viewer)},${literal(destination)},${discovery},${literal(slug)})`));
  const match = (viewer, ids, mode = "any", category = "", destination = "network") =>
    execute(`SELECT halo_creative_dna_matches('owner',${literal(viewer)},${literal(destination)},${literal(category)},${literal(ids)},${literal(mode)})`) === "t";
  assert.equal(execute(save("owner", 0)), "1");
  assert.equal(execute("SELECT bio || ':' || array_to_string(genres,',') || ':' || artist_slug FROM halo_creator_profiles WHERE member_id='owner'"),
    "Do not replace my bio:House:owned-room");
  assert.equal(project(null).length, 2);
  assert.equal(project("viewer").length, 3);
  assert.equal(project("viewer", "public-network").length, 2, "Public directory caps even authenticated audiences");
  for (const viewer of [null, "viewer", "owner"]) for (const destination of ["public-network", "artist", "home"]) {
    assert.deepEqual(project(viewer, destination, false, "owned-room").map(i => i.label), ["House", "Ceramics"],
      `${destination}: signed-in owner and other viewers never receive member/private terms`);
  }
  assert.equal(project("viewer", "network", true).length, 2, "Custom labels and private terms are not indexed");
  assert.equal(match(null, ["sound.jazz"]), false);
  assert.equal(match(null, ["sound.house", "sound.jazz"], "all"), false);
  assert.equal(match("viewer", ["sound.house", "sound.jazz"], "all"), true);
  assert.equal(match("viewer", ["tools.sampling"]), false);
  assert.equal(match("viewer", [], "any", "beyond"), false);
  assert.equal(match("viewer", [], "any", "sound"), true);
  assert.equal(match("viewer", []), true, "No interest filters never excludes empty profiles");
  for (const section of ["private", "members", "public"]) for (const audience of ["private", "members", "public"]) {
    execute(`UPDATE halo_creator_profiles SET creative_dna_audience=${literal(section)} WHERE member_id='owner';
      UPDATE halo_creator_interests SET audience=${literal(audience)} WHERE member_id='owner' AND term_id='sound.house'`);
    const publicExpected = section === "public" && audience === "public";
    const memberExpected = section !== "private" && audience !== "private";
    assert.equal(project(null).some(i => i.termId === "sound.house"), publicExpected);
    assert.equal(project("viewer").some(i => i.termId === "sound.house"), memberExpected);
    assert.equal(match(null, ["sound.house"]), publicExpected);
    assert.equal(match("viewer", ["sound.house"]), memberExpected);
    for (const viewer of [null, "viewer", "owner"]) for (const destination of ["public-network", "artist", "home"]) {
      assert.equal(project(viewer, destination, false, "owned-room").some(i => i.termId === "sound.house"), publicExpected);
      if (destination !== "artist") assert.equal(match(viewer, ["sound.house"], "any", "", destination), publicExpected);
    }
  }
  execute("UPDATE halo_creator_profiles SET creative_dna_audience='public' WHERE member_id='owner'; UPDATE halo_creator_interests SET audience='public' WHERE member_id='owner' AND term_id='sound.house'");
  for (const direction of ["('owner','viewer')", "('viewer','owner')"]) {
    execute(`INSERT INTO halo_signal_blocks VALUES ${direction}`);
    assert.deepEqual(project("viewer"), []);
    for (const destination of ["public-network", "artist", "home"]) {
      assert.deepEqual(project("viewer", destination, false, "owned-room"), [], "Public surfaces retain bidirectional blocks");
    }
    assert.equal(match("viewer", ["sound.house"]), false);
    execute("DELETE FROM halo_signal_blocks");
  }
  execute("UPDATE halo_creator_profiles SET creative_dna_discovery=FALSE WHERE member_id='owner'");
  assert.equal(project("viewer").length, 3);
  assert.equal(match("viewer", ["sound.house"]), false);
  execute("UPDATE halo_creator_profiles SET creative_dna_discovery=TRUE WHERE member_id='owner'");
  assert.equal(project(null, "artist", false, "owned-room").length, 2);
  assert.deepEqual(project(null, "artist", false, "other-room"), []);
  assert.deepEqual(project("owner", "artist", false, "other-room"), []);
  execute("UPDATE halo_artist_pages SET owner_member_id='viewer' WHERE slug='owned-room'");
  assert.deepEqual(project(null, "artist", false, "owned-room"), [], "Ownership transfer immediately revokes old DNA");
  assert.deepEqual(project("owner", "artist", false, "owned-room"), []);
  execute("UPDATE halo_artist_pages SET owner_member_id='owner' WHERE slug='owned-room'; UPDATE halo_creator_profiles SET artist_slug=NULL WHERE member_id='owner'");
  assert.deepEqual(project(null, "artist", false, "owned-room"), [], "Unlinking immediately revokes artist display");
  assert.deepEqual(project("owner", "artist", false, "owned-room"), []);
  execute("UPDATE halo_creator_profiles SET artist_slug='owned-room', discoverable=FALSE WHERE member_id='owner'");
  assert.deepEqual(project(null), []);
  assert.deepEqual(project("viewer", "home"), []);
  execute("UPDATE halo_creator_profiles SET discoverable=TRUE WHERE member_id='owner'; UPDATE halo_signal_profiles SET discoverable=FALSE WHERE member_id='owner'");
  assert.deepEqual(project("viewer", "signal"), []);
  execute("UPDATE halo_signal_profiles SET discoverable=TRUE WHERE member_id='owner'");
  for (const assignments of [
    [items[0], items[0]], [{ ...items[0], termId: "invalid" }], [{ ...items[0], category: "tools" }],
    Array.from({ length: 5 }, (_, i) => ({ ...items[3], label: `Custom ${i}` })),
    [...DNA_TERMS.filter(t => t.category === "sound").map(t => ({ ...items[0], termId: t.id })), { ...items[3], category: "sound" }],
    Array.from({ length: 25 }, (_, i) => ({ ...items[0], termId: DNA_TERMS[i].id, category: DNA_TERMS[i].category })),
    [{ ...items[3], label: "House", category: "sound" }],
    [{ ...items[3], label: null }]
  ]) {
    assert.throws(() => execute(save("owner", 1, assignments)));
    assert.equal(execute("SELECT creative_dna_revision FROM halo_creator_profiles WHERE member_id='owner'"), "1");
    assert.equal(project("viewer").length, 3, "Invalid replacement rolls back deletion and revision");
  }
  const first = run(resolve(bin, "psql"), [...args, "-c", `BEGIN; ${save("concurrent", 0, [items[0]])}; SELECT pg_sleep(0.15); COMMIT;`]);
  const second = run(resolve(bin, "psql"), [...args, "-c", save("concurrent", 0, [items[1]])]);
  await Promise.all([first, second]);
  assert.equal(execute("SELECT creative_dna_revision FROM halo_creator_profiles WHERE member_id='concurrent'"), "1",
    "Concurrent first saves serialize on the canonical profile");
  assert.equal(execute("SELECT count(*) FROM halo_creator_interests WHERE member_id='concurrent'"), "1");
  const concurrentUpdates = await Promise.all([1, 2].map(choice => run(resolve(bin, "psql"), [...args, "-c",
    `SELECT COALESCE(halo_save_creative_dna('concurrent','Creator',1,TRUE,'public',TRUE,${literal(JSON.stringify([items[choice % 2]]))}::jsonb)::text, 'conflict')`])));
  assert.deepEqual(concurrentUpdates.map(result => result.stdout.trim()).sort(), ["2", "conflict"]);
  assert.equal(execute("SELECT count(*) FROM halo_creator_interests WHERE member_id='concurrent'"), "1", "Concurrent updates never mix or lose assignments");
  assert.equal(execute(save("new-member", 99)), "");
  assert.equal(execute("SELECT count(*) FROM halo_creator_profiles WHERE member_id='new-member'"), "0", "A conflict does not create unrelated profile data");
  const legacy = defaultMusicHomeConfig("owner");
  legacy.layoutModules = legacy.layoutModules.slice(0, 4);
  execute(`INSERT INTO halo_music_homes(member_id,config) VALUES ('owner',${literal(JSON.stringify(legacy))}::jsonb)`);
  assert.equal(execute(`SELECT halo_valid_music_home_layout(${literal(JSON.stringify(defaultMusicHomeConfig("owner").layoutModules))}::jsonb)`), "t");
  execute(migration);
  assert.equal(execute("SELECT jsonb_array_length(config->'layoutModules') FROM halo_music_homes WHERE member_id='owner'"), "4", "Retry does not rewrite legacy configurations");
  assert.equal(project("viewer").length, 3, "Migration retries preserve saved interests");
  const hiddenHome = defaultMusicHomeConfig("owner");
  hiddenHome.layoutModules.find(module => module.type === "CREATIVE_DNA").isVisible = false;
  execute(`UPDATE halo_music_homes SET config=${literal(JSON.stringify(hiddenHome))}::jsonb WHERE member_id='owner'`);
  assert.deepEqual(project("viewer", "home"), [], "Hidden destinations cannot expose DNA through the API");
  assert.deepEqual(project("owner", "home"), [], "Owner access is separate from the public home projection");
  assert.equal(project("viewer", "network").length, 3, "Home layout never changes shared content or discovery settings");
  execute(`UPDATE halo_music_homes SET config=${literal(JSON.stringify(legacy))}::jsonb WHERE member_id='owner'`);

  const db = { async sql(parts, ...values) {
    const sql = parts.reduce((query, part, index) => query + (index ? literal(values[index - 1]) : "") + part, "").trim();
    if (/^(INSERT|UPDATE|DELETE)/i.test(sql) && !/RETURNING/i.test(sql)) { execute(sql); return []; }
    const wrapped = /^(INSERT|UPDATE|DELETE)/i.test(sql)
      ? `WITH result AS (${sql}) SELECT COALESCE(jsonb_agg(row_to_json(result)), '[]') FROM result`
      : `SELECT COALESCE(jsonb_agg(row_to_json(result)), '[]') FROM (${sql}) result`;
    return JSON.parse(execute(wrapped));
  } };
  assert.equal((await loadOwnDNA(db, "owner")).items.length, 4, "Private editor retains owner-only assignments");
  execute("UPDATE halo_creator_interest_terms SET active=FALSE WHERE id='sound.house'");
  execute(migration);
  assert.equal((await loadDNAVocabulary(db)).find(t => t.id === "sound.house").active, false, "Migration retries never reactivate moderated terms");
  for (const destination of ["network", "signal", "public-network", "artist", "home"]) {
    assert.ok(project("owner", destination, false, "owned-room").every(i => i.termId !== "sound.house"));
  }
  assert.equal(match("viewer", ["sound.house"]), false, "Inactive canonical interests are never indexed");
  assert.throws(() => execute(save("owner", 1)), "Saving an inactive canonical term fails atomically");
  assert.throws(() => execute(save("owner", 1, [{ ...items[3], category: "sound", label: "house music" }])),
    "Custom aliases cannot circumvent a retired canonical term");
  assert.equal(execute("SELECT creative_dna_revision FROM halo_creator_profiles WHERE member_id='owner'"), "1");
  const creativeDNA = createCreativeDNAHandler({ getDatabase: async () => db, getUser: async () => ({ id: "identity" }),
    ensureMembership: async () => ({ member_id: "owner" }), verifyRequestOrigin: async () => undefined });
  const dnaPost = body => creativeDNA(new Request("https://halo.test/api/creative-dna", { method: "POST",
    headers: { Origin: "https://halo.test", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const suggested = await (await dnaPost({ action: "suggest", consent: true, selectedText: "house and jazz" })).json();
  assert.deepEqual(suggested.suggestions.map(i => i.termId), ["sound.jazz"], "Suggestions obey the live moderated vocabulary");
  assert.equal((await dnaPost({ action: "save", dna: await loadOwnDNA(db, "owner") })).status, 400);
  assert.equal((await loadOwnDNA(db, "owner")).items.length, 4, "Retired items remain removable in the private editor");
  execute("UPDATE halo_creator_interest_terms SET active=TRUE WHERE id='sound.house'");
  const network = createCreatorNetworkHandler({ getDatabase: async () => db, getUser: async () => ({ id: "identity" }),
    ensureMembership: async () => ({ member_id: "viewer" }), verifyRequestOrigin: async () => true });
  const get = query => network(new Request(`https://halo.test/api/creator-network?view=public&${query}`));
  let payload = await (await get("interests=sound.house")).json();
  assert.equal(payload.creators.length, 1);
  assert.equal(payload.creators[0].display_name, "Owner");
  assert.equal("member_id" in payload.creators[0], false);
  assert.equal("split_preference" in payload.creators[0], false);
  assert.equal(payload.creators[0].creative_dna.length, 2);
  payload = await (await get("interests=sound.jazz")).json();
  assert.equal(payload.creators.length, 0, "No public search leakage from member interests");
  execute("INSERT INTO halo_signal_blocks VALUES ('owner','viewer')");
  assert.equal((await (await get("interests=sound.house")).json()).creators.length, 0, "Authenticated public directory respects both directions of blocks");
  execute("DELETE FROM halo_signal_blocks");
  execute(`INSERT INTO halo_memberships(member_id, display_name)
    SELECT 'page-' || n, 'Page ' || n FROM generate_series(1,65) n;
    INSERT INTO halo_creator_profiles(member_id,display_name,discoverable,updated_at)
      SELECT member_id,display_name,TRUE,'2026-01-01T00:00:00.123456Z'::timestamptz
      FROM halo_memberships WHERE member_id LIKE 'page-%';
    SELECT halo_save_creative_dna(member_id,display_name,0,TRUE,'public',TRUE,${literal(JSON.stringify([items[0]]))}::jsonb)
      FROM halo_memberships WHERE member_id LIKE 'page-%';`);
  const pageOne = await (await get("interests=sound.house")).json();
  assert.equal(pageOne.creators.length, 48);
  assert.equal(pageOne.creators[0].premium_verified, true, "Premium priority stays ahead of interest filters and cursor pages");
  assert.ok(pageOne.nextCursor);
  assert.equal(JSON.parse(atob(pageOne.nextCursor)).time, "2026-01-01T00:00:00.123456Z");
  const pageTwo = await (await get(`interests=sound.house&cursor=${encodeURIComponent(pageOne.nextCursor)}`)).json();
  assert.equal(pageTwo.creators.length, 18);
  assert.equal(new Set([...pageOne.creators, ...pageTwo.creators].map(c => c.display_name)).size, 66,
    "Stable keyset pages do not repeat or skip equal-time creators");
  assert.ok(pageOne.creators.every(c => !Object.hasOwn(c, "cursor_key") && !Object.hasOwn(c, "cursor_time") && !Object.hasOwn(c, "member_id")));
  const source = await read("netlify/functions/signal-network.mjs");
  const context = { dnaFilters, readDNACursor, nextDNACursor };
  vm.runInNewContext(source.replace(/^import .+;\s*/gm, "").replaceAll("export default ", "").replaceAll("export ", "") +
    "\nglobalThis.discoverSignal = discover; globalThis.saveSignalProfile = saveProfile;", context);
  const discovered = await context.discoverSignal(db, "viewer", new URL("https://halo.test/?interests=sound.house,sound.jazz&interestMode=all"));
  assert.equal(discovered.collaborators.length, 1);
  assert.equal(discovered.collaborators[0].creativeDNA.length, 3);
  assert.equal(discovered.collaborators[0].premiumVerified, true);
  await context.saveSignalProfile(db, "owner", { headline: "New Signal headline", discoverable: true });
  assert.equal(project("viewer", "signal").length, 3, "Signal profile edits preserve canonical interests");
  assert.equal(execute("SELECT creative_dna_revision FROM halo_creator_profiles WHERE member_id='owner'"), "1");
  execute(save("viewer", 0, [items[0], items[1]]));
  const shared = await context.discoverSignal(db, "viewer", new URL("https://halo.test/"));
  assert.equal(shared.collaborators[0].sharedInterests.length, 2);
  execute("UPDATE halo_creator_profiles SET creative_dna_discovery=FALSE WHERE member_id='viewer'");
  const optedOut = await context.discoverSignal(db, "viewer", new URL("https://halo.test/"));
  assert.equal(optedOut.collaborators[0].sharedInterests.length, 0);
  const ownerNetwork = createCreatorNetworkHandler({ getDatabase: async () => db, getUser: async () => ({ id: "identity" }),
    ensureMembership: async () => ({ member_id: "owner" }), verifyRequestOrigin: async () => true });
  const post = body => ownerNetwork(new Request("https://halo.test/api/creator-network", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await post({ action: "save_profile", displayName: "Updated", discoverable: true, artistSlug: "owned-room" })).status, 200);
  assert.equal(project("viewer").length, 3, "Normal Creator Pass saves preserve DNA");
  assert.equal((await post({ action: "save_profile", displayName: "Updated", artistSlug: "other-room" })).status, 403);
  execute("INSERT INTO halo_creator_projects(id, owner_member_id,title) VALUES ('brief','owner','Brief'); INSERT INTO halo_signal_blocks VALUES ('viewer','owner')");
  assert.equal((await post({ action: "invite", projectId: "brief", memberId: "viewer" })).status, 409);
  assert.equal(execute("SELECT count(*) FROM halo_creator_participants"), "0", "Blocked invitations cannot write participants");
  execute("DELETE FROM halo_signal_blocks");
  assert.equal(execute(save("owner", 1, items, "private", false, false)), "2");
  assert.deepEqual(project(null), []);
  assert.equal(match("viewer", ["sound.house"]), false);
  console.log("Creative DNA PostgreSQL integration passed: retry-safe migration, constraints, real concurrent writes/rollback, privacy, artist revocation, config compatibility, Creator/Signal queries and blocked invitations.");
} finally {
  if (started) execFileSync(resolve(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "pipe" });
  await rm(scratch, { recursive: true, force: true });
}
