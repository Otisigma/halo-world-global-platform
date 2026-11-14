import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDiscovererHandler } from "../netlify/lib/discoverer-milestones.mjs";
import { artistMilestoneCard, milestoneRequest } from "../discoverer-milestones.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("netlify/database/migrations/20261027060000_discoverer_milestones.sql");
const api = await read("netlify/lib/discoverer-milestones.mjs");
assert.match(migration, /AFTER UPDATE OF status ON halo_radio_tracks/);
assert.doesNotMatch(migration, /AFTER INSERT|living_chart_votes|user_dm_messages|votes_up\s*[>=]/);
assert.match(migration, /OLD.status = 'rotation'/);
assert.match(migration, /NEW.reviewed_at IS NULL OR NEW.reviewed_by_member_id IS NULL/);
assert.match(migration, /ORDER BY vote.updated_at, vote.member_id COLLATE "C"\s+LIMIT 20/);
assert.match(migration, /ON CONFLICT \(release_id\) DO NOTHING/);
assert.match(migration, /ON DELETE SET NULL/);
assert.match(api, /award.member_id = \$\{memberId\}/);
assert.match(api, /release.owner_member_id = \$\{memberId\} OR page.owner_member_id = \$\{memberId\}/);
assert.match(api, /preference.discoverer_in_app = TRUE AND award.notified_at IS NOT NULL/);

let queries = [];
let fail = false;
let limited = false;
const db = {
  async sql(strings, ...values) {
    const query = strings.join("?");
    queries.push({ query, values });
    if (fail) throw new Error("database down");
    if (query.includes("halo_discoverer_request_limits")) return limited ? [] : [{ member_id: "fan" }];
    return [];
  }
};
const dependencies = {
  getDatabase: async () => db,
  getUser: async () => ({ id: "fan" }),
  verifyRequestOrigin: async () => true,
  ensureMembership: async (_db, user) => ({ member_id: user.id })
};
const handler = createDiscovererHandler(dependencies);
const request = (body, options = {}) => new Request("https://halo.test/api/discoverer-milestones", body === undefined
  ? options : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...options });
assert.equal((await handler(request(undefined, { method: "DELETE" }))).status, 405);
assert.equal((await createDiscovererHandler({ ...dependencies, getUser: async () => null })(request())).status, 401);
assert.equal((await createDiscovererHandler({ ...dependencies, verifyRequestOrigin: async () => false })(request({ action: "preferences", enabled: true }))).status, 403);
assert.equal((await handler(request({ action: "preferences", enabled: "yes" }))).status, 400);
assert.equal((await handler(request({ action: "seen", releaseId: "../private" }))).status, 400);
assert.equal((await handler(request({ action: "trigger", releaseId: "private" }))).status, 400);
assert.equal((await handler(request({ action: "send", recipients: ["anyone"] }))).status, 400);
assert.equal((await handler(request({ action: "preferences", enabled: true, padding: "x".repeat(1001) }))).status, 413);
assert.equal((await handler(request({}, { body: "{" }))).status, 400);
assert.equal((await handler(request({}, { headers: { "Content-Type": "text/plain" } }))).status, 415);
queries = [];
const state = await (await handler(request({ action: "seen", releaseId: "public-song", memberId: "victim" }))).json();
assert.deepEqual(state, { enabled: false, notifications: [], milestones: [], thankYouDeliveryAvailable: false });
assert.ok(queries.every(query => !query.values.includes("victim")), "caller cannot select a recipient");
assert.ok(queries.some(query => query.query.includes("COALESCE(seen_at, NOW())")), "read receipts are idempotent");
limited = true;
assert.equal((await handler(request({ action: "preferences", enabled: true }))).status, 429);
limited = false;
fail = true;
assert.equal((await handler(request())).status, 503);
fail = false;
assert.equal((await handler(request())).status, 200, "a failed read is safe to retry");
globalThis.fetch = async () => new Response("<html>Unavailable</html>");
await assert.rejects(milestoneRequest(), /Celebrations are unavailable/, "a static fallback must not be interpreted as API success");
delete globalThis.fetch;

// Exercise the real card event handlers without introducing a DOM/test dependency.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.disabled = false; this.checked = false; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener(name, callback) { this.events[name] = callback; }
}
globalThis.document = { createElement: tag => new Element(tag) };
let copied = "";
let rejectCopy = false;
Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { clipboard: { writeText: async text => { if (rejectCopy) throw new Error("denied"); copied = text; } } }
});
const card = artistMilestoneCard({ title: "<img onerror=alert(1)>", artist: "Artist", supporterCount: 7 });
const flatten = element => [element, ...element.children.flatMap(flatten)];
const elements = flatten(card);
assert.ok(elements.some(element => element.textContent?.includes("7 eligible early discoverers")));
const buttons = elements.filter(element => element.tag === "button");
assert.equal(buttons[1].disabled, true, "unsupported recording cannot be started");
const consent = elements.find(element => element.tag === "input");
assert.equal(buttons[0].disabled, true);
await buttons[0].events.click();
assert.equal(copied, "", "no copy without acknowledgement");
consent.checked = true;
consent.events.change();
await buttons[0].events.click();
assert.ok(copied.includes("<img onerror=alert(1)>"), "plain text draft, not HTML");
assert.equal(elements.at(-1).textContent, "Draft copied. Nothing has been sent.");
rejectCopy = true;
await buttons[0].events.click();
assert.match(elements.at(-1).textContent, /Copy unavailable.*Nothing has been sent/);
delete globalThis.document;

const databaseUrl = process.env.DISCOVERER_TEST_DATABASE_URL;
if (databaseUrl) {
  const exec = promisify(execFile);
  const schema = `discoverer_test_${process.pid}`;
  const sql = async (text, scoped = true) => {
    const { stdout } = await exec("psql", [databaseUrl, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", text], {
      env: { ...process.env, ...(scoped ? { PGOPTIONS: `-c search_path=${schema}` } : {}) },
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  };
  await sql(`CREATE SCHEMA ${schema}`, false);
  try {
    // Minimal fixtures retain the real domain's keys, timestamps and relationships.
    await sql(`
      CREATE TABLE halo_memberships (member_id TEXT PRIMARY KEY);
      CREATE TABLE halo_artist_pages (slug TEXT PRIMARY KEY, owner_member_id TEXT);
      CREATE TABLE halo_release_campaigns (id TEXT PRIMARY KEY, title TEXT DEFAULT 'Release', artist TEXT DEFAULT 'Artist',
        status TEXT DEFAULT 'published', owner_member_id TEXT, artist_slug TEXT);
      CREATE TABLE halo_radio_tracks (id TEXT PRIMARY KEY, release_id TEXT REFERENCES halo_release_campaigns(id),
        member_id TEXT NOT NULL REFERENCES halo_memberships(member_id), status TEXT DEFAULT 'preview',
        reviewed_at TIMESTAMPTZ, reviewed_by_member_id TEXT, rights_confirmed BOOLEAN DEFAULT TRUE);
      CREATE TABLE halo_radio_votes (track_id TEXT REFERENCES halo_radio_tracks(id) ON DELETE CASCADE,
        member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE CASCADE, vote SMALLINT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(track_id, member_id));
      CREATE TABLE halo_member_notification_preferences (member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
        updated_at TIMESTAMPTZ DEFAULT NOW());
      ${migration}
    `);
    await sql(migration); // Retry-safe migration; no re-awarding existing rotations.
    await sql(`
      INSERT INTO halo_memberships VALUES ('owner'), ('page-owner'), ('down'), ('late'),
        ('fan-a'), ('fan-b'), ('optout'), ('deleted'), ('changed');
      INSERT INTO halo_memberships SELECT 'extra-' || n FROM generate_series(1,25) n;
      INSERT INTO halo_artist_pages VALUES ('artist', 'page-owner');
      INSERT INTO halo_release_campaigns (id, owner_member_id, artist_slug) VALUES ('release-one', 'owner', 'artist'), ('release-two', 'owner', 'artist');
      INSERT INTO halo_release_campaigns (id, status, owner_member_id) VALUES ('private-release', 'draft', 'owner');
      INSERT INTO halo_radio_tracks (id, release_id, member_id) VALUES
        ('track-one', 'release-one', 'owner'), ('track-two', 'release-two', 'owner'), ('private-track', 'private-release', 'owner');
      INSERT INTO halo_member_notification_preferences (member_id, discoverer_in_app) VALUES ('fan-a', TRUE), ('fan-b', TRUE);
      INSERT INTO halo_radio_votes (track_id, member_id, vote, updated_at) VALUES
        ('track-one', 'owner', 1, '2026-01-01'), ('track-one', 'page-owner', 1, '2026-01-01'),
        ('track-one', 'down', -1, '2026-01-01'), ('track-one', 'deleted', 1, '2026-01-01'),
        ('track-one', 'fan-b', 1, '2026-01-02'), ('track-one', 'fan-a', 1, '2026-01-02'),
        ('track-one', 'optout', 1, '2026-01-03'), ('track-one', 'changed', -1, '2026-01-01');
      UPDATE halo_radio_votes SET vote = 1, updated_at = '2026-01-04' WHERE member_id = 'changed';
      INSERT INTO halo_radio_votes (track_id, member_id, vote, updated_at)
        SELECT 'track-one', 'extra-' || n, 1, '2026-02-01'::timestamptz + n * INTERVAL '1 second' FROM generate_series(1,25) n;
      DELETE FROM halo_memberships WHERE member_id = 'deleted';
      UPDATE halo_radio_tracks SET status = 'rotation' WHERE id = 'track-one';
    `);
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_milestones"), "0", "votes and unreviewed/direct rotation never grant milestones");
    await sql("UPDATE halo_radio_tracks SET status = 'preview' WHERE id = 'track-one'");
    const promote = id => `UPDATE halo_radio_tracks SET status = 'rotation', reviewed_at = NOW(), reviewed_by_member_id = 'owner' WHERE id = '${id}'`;
    await sql(promote("private-track"));
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_milestones"), "0", "private releases do not celebrate");
    await Promise.all([sql(`BEGIN; ${promote("track-one")}; SELECT pg_sleep(0.15); COMMIT;`), sql(promote("track-one"))]);
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_milestones"), "1");
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_discoverers"), "20", "bounded recipient snapshot");
    assert.equal(await sql("SELECT member_id || ':' || discoverer_rank FROM halo_release_discoverers ORDER BY discoverer_rank LIMIT 3"),
      "fan-a:1\nfan-b:2\noptout:3", "stable ties and owner exclusion");
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_discoverers WHERE notified_at IS NOT NULL"), "2", "opt-in only");
    assert.equal(await sql("SELECT discoverer_rank FROM halo_release_discoverers WHERE member_id = 'changed'"), "4",
      "a prior downvote does not count as early support");
    await sql(`
      INSERT INTO halo_radio_votes (track_id, member_id, vote) VALUES ('track-one', 'late', 1);
      UPDATE halo_radio_votes SET vote = -1 WHERE member_id = 'fan-a';
      UPDATE halo_radio_tracks SET status = 'preview' WHERE id = 'track-one';
      ${promote("track-one")};
    `);
    assert.equal(await sql("SELECT discoverer_rank FROM halo_release_discoverers WHERE member_id = 'fan-a'"), "1", "ranks do not drift");
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_discoverers WHERE member_id = 'late'"), "0", "no late additions on retry");
    await sql(`
      CREATE FUNCTION fail_awards() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END; $$;
      CREATE TRIGGER fail_awards BEFORE INSERT ON halo_release_discoverers FOR EACH ROW EXECUTE FUNCTION fail_awards();
      INSERT INTO halo_radio_votes (track_id, member_id, vote) VALUES ('track-two', 'fan-a', 1);
    `);
    await assert.rejects(sql(promote("track-two")), /injected failure/);
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_milestones WHERE release_id = 'release-two'"), "0", "failure rolls back event too");
    assert.equal(await sql("SELECT status FROM halo_radio_tracks WHERE id = 'track-two'"), "preview");
    await sql("DROP TRIGGER fail_awards ON halo_release_discoverers");
    await sql(promote("track-two"));
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_milestones WHERE release_id = 'release-two'"), "1", "safe retry after rollback");
    await sql(`
      INSERT INTO halo_release_campaigns (id, owner_member_id) VALUES ('release-race', 'owner');
      INSERT INTO halo_radio_tracks (id, release_id, member_id) VALUES
        ('race-a', 'release-race', 'owner'), ('race-b', 'release-race', 'owner');
      INSERT INTO halo_radio_votes (track_id, member_id, vote) VALUES ('race-a', 'fan-a', 1), ('race-b', 'fan-b', 1);
    `);
    await Promise.all([sql(`BEGIN; ${promote("race-a")}; SELECT pg_sleep(0.15); COMMIT;`), sql(promote("race-b"))]);
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_milestones WHERE release_id = 'release-race'"), "1");
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_discoverers WHERE release_id = 'release-race'"), "1",
      "competing versions of one release cannot merge or duplicate rank snapshots");

    // Run production API SQL against PostgreSQL, including filters and concurrent rate limiting.
    const literal = value => value == null ? "NULL" : typeof value === "boolean" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    const realDb = { async sql(strings, ...values) {
      const query = strings.reduce((text, part, index) => text + part + (index < values.length ? literal(values[index]) : ""), "");
      const rows = /^\s*SELECT/i.test(query)
        ? `SELECT COALESCE(json_agg(result), '[]'::json) FROM (${query}) result`
        : /RETURNING/i.test(query) ? `WITH result AS (${query}) SELECT COALESCE(json_agg(result), '[]'::json) FROM result` : query;
      const output = await sql(rows);
      return output.startsWith("[") ? JSON.parse(output) : [];
    } };
    const forMember = member => createDiscovererHandler({ ...dependencies, getDatabase: async () => realDb, getUser: async () => ({ id: member }) });
    const fan = await (await forMember("fan-a")(request())).json();
    assert.equal(fan.notifications[0].rank, 1);
    assert.deepEqual(fan.milestones, [], "fans cannot inspect artist dashboards");
    assert.doesNotMatch(JSON.stringify(fan), /member_id|fan-b|owner|supported_at/, "fan identities and raw votes never leave API");
    const owner = await (await forMember("owner")(request())).json();
    assert.equal(owner.milestones.find(item => item.releaseId === "release-one").supporterCount, 20);
    assert.deepEqual(owner.notifications, []);
    assert.equal((await (await forMember("page-owner")(request())).json()).milestones.length, 2, "artist-page ownership is recognised");
    assert.deepEqual((await (await forMember("down")(request())).json()).milestones, []);
    assert.deepEqual((await (await forMember("optout")(request({ action: "preferences", enabled: true }))).json()).notifications, [],
      "later consent does not retroactively send a celebration");
    const change = enabled => forMember("fan-a")(request({ action: "preferences", enabled }));
    await change(false);
    assert.deepEqual((await (await forMember("fan-a")(request())).json()).notifications, [], "opt-out hides all cards immediately");
    await change(true);
    await forMember("fan-a")(request({ action: "seen", releaseId: "release-one", memberId: "fan-b" }));
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_discoverers WHERE member_id = 'fan-b' AND seen_at IS NOT NULL"), "0");
    await sql("UPDATE halo_discoverer_request_limits SET attempts = 29 WHERE member_id = 'fan-a'");
    const raced = await Promise.all([change(true), change(true)]);
    assert.deepEqual(raced.map(response => response.status).sort(), [200, 429], "atomic rate limit cannot be bypassed concurrently");
    await sql("UPDATE halo_release_campaigns SET status = 'draft' WHERE id = 'release-one'");
    assert.ok(!(await (await forMember("fan-b")(request())).json()).notifications.some(item => item.releaseId === "release-one"),
      "withdrawn release is not disclosed");
    await sql("DELETE FROM halo_memberships WHERE member_id = 'fan-b'");
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_discoverers WHERE member_id = 'fan-b'"), "0");
    await sql("DELETE FROM halo_radio_tracks WHERE id = 'track-one'");
    assert.equal(await sql("SELECT COUNT(*) FROM halo_release_milestones WHERE release_id = 'release-one'"), "1", "deletion retains idempotency tombstone");
    console.log("Discoverer PostgreSQL integration contracts passed");
  } finally { await sql(`DROP SCHEMA ${schema} CASCADE`, false); }
} else {
  console.log("PostgreSQL integration skipped (set DISCOVERER_TEST_DATABASE_URL to an isolated test database)");
}
console.log("Discoverer API, privacy, migration and UI contracts passed");
