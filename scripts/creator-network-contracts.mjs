import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCreatorNetworkHandler, profileInput, projectInput, canRespond } from "../netlify/lib/creator-network.mjs";
import { PUBLIC_ROUTE_REGISTRY, canonicalizeRoutePath } from "../lib/route-registry.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, api, html, client, routes, preview] = await Promise.all([
  read("netlify/database/migrations/20261003095500_create_creator_network.sql"),
  read("netlify/lib/creator-network.mjs"), read("creator-network/index.html"),
  read("creator-network/network.js"), read("netlify.toml"), read("creators/index.html")
]);

for (const table of ["profiles", "projects", "participants"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS halo_creator_${table}`));
}
for (const table of ["halo_memberships", "halo_artist_pages", "halo_song_catalog", "halo_song_versions", "halo_stem_packs", "halo_artist_rights_works"]) {
  assert.ok(migration.includes(`REFERENCES ${table}(`), `Reuse ${table}`);
}
assert.match(migration, /PRIMARY KEY \(project_id, member_id\)/);
assert.match(migration, /discoverable BOOLEAN NOT NULL DEFAULT FALSE/);
assert.match(migration, /status IN \('pending', 'accepted', 'declined'\)/);
assert.doesNotMatch(migration, /(?:^|;\s*)(?:DROP|TRUNCATE|DELETE)\s/im);
assert.equal(PUBLIC_ROUTE_REGISTRY.find(r => r.route === "/creator-network/")?.file, "creator-network/index.html");
assert.equal(canonicalizeRoutePath("/creator-network/"), "/creator-network/");
assert.match(routes, /from = "\/creator-network\/"\s+to = "\/creator-network\/index.html"/);
assert.match(preview, /href="\/creator-network\/"/);
assert.match(html, /src="\/identity.js"/);
assert.match(html, /src="\/site-monitor.js"/);
assert.match(html, /data-halo-guide=/);
for (const route of ["/artist/dashboard", "/artists/", "/song-catalog/", "/dreamweaver-lab/", "/mixes/"]) {
  assert.ok(html.includes(`href="${route}"`));
}
assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML/);
assert.match(client, /sessionVersion/);
assert.match(api, /WHERE discoverable = TRUE AND member_id <>/);
assert.match(api, /WHERE cp.member_id = \$\{memberId\} OR p.owner_member_id = \$\{memberId\}/);
assert.doesNotMatch(api, /SELECT.*email|halo_artist_rights_participants|@netlify\/blobs/);

const profile = profileInput({ displayName: "Creator", roles: ["Producer", "Producer"], bpmMin: "120", bpmMax: 128 });
assert.deepEqual(profile.roles, ["Producer"]);
assert.equal(profile.discoverable, false);
assert.equal(profile.bpmMin, 120);
for (const bad of [
  { displayName: "" }, { displayName: "x", bpmMin: 120 },
  { displayName: "x", bpmMin: 140, bpmMax: 120 },
  { displayName: "x", roles: ["x".repeat(81)] },
  { displayName: "x", roles: Array(13).fill("Producer") },
  { displayName: "x", discoverable: "true" }, { displayName: "x", bpmMin: true, bpmMax: true }
]) assert.throws(() => profileInput(bad));
assert.throws(() => projectInput({ title: "Song", songVersionId: "version" }));
assert.throws(() => projectInput({ title: "Song", bpm: 120.5 }));
assert.throws(() => projectInput({ title: "Song", kind: "money" }));
assert.equal(projectInput({ title: "Session", songId: "song", songVersionId: "version" }).songId, "song");

const project = { id: "project", owner_member_id: "owner", status: "open" };
const invite = { member_id: "creator", kind: "invite", status: "pending" };
assert.equal(canRespond(invite, project, "creator"), true);
assert.equal(canRespond(invite, project, "owner"), false);
assert.equal(canRespond(invite, project, "stranger"), false);
assert.equal(canRespond({ ...invite, kind: "application" }, project, "owner"), true);
assert.equal(canRespond({ ...invite, kind: "application" }, project, "creator"), false);
assert.equal(canRespond({ ...invite, status: "accepted" }, project, "creator"), false);
assert.equal(canRespond(invite, { ...project, status: "closed" }, "creator"), false);

function fixture({ memberId = "owner", origin = async () => true, authenticated = true, sql = () => [] } = {}) {
  const calls = [];
  let memberships = 0;
  const handler = createCreatorNetworkHandler({
    getUser: async () => authenticated ? { id: memberId } : null,
    getDatabase: async () => ({
      sql: async (parts, ...params) => {
        const query = parts.join("?").replace(/\s+/g, " ").trim();
        calls.push({ query, params });
        return sql(query, params);
      }
    }),
    ensureMembership: async () => { memberships++; return { member_id: memberId }; },
    verifyRequestOrigin: origin
  });
  return {
    calls, membershipCount: () => memberships,
    request: (body, method = "POST", query = "") => handler(new Request(`https://halo.test/api/creator-network${query}`, {
      method, headers: { Origin: "https://halo.test", "Content-Type": "application/json" },
      ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {})
    }))
  };
}

for (const origin of [async () => false, async () => { throw new Error("Bad origin"); }]) {
  const f = fixture({ origin });
  assert.equal((await f.request({ action: "save_profile", displayName: "x" })).status, 403);
  assert.equal(f.membershipCount(), 0);
  assert.equal(f.calls.length, 0);
}
const anonymous = fixture({ authenticated: false });
assert.equal((await anonymous.request(null, "GET")).status, 401);
assert.equal((await anonymous.request({ action: "apply", projectId: "project" })).status, 401);
assert.equal(anonymous.calls.length, 0);
const invalid = fixture();
for (const body of ["{", "null", "[]", { action: "unknown" }, { action: "respond", projectId: "project", status: "executed" }]) {
  assert.equal((await invalid.request(body)).status, 400);
}
assert.equal(invalid.calls.length, 0);
assert.equal((await invalid.request(null, "DELETE")).status, 405);
assert.equal((await invalid.request(null, "GET", "?bpm=invalid")).status, 400);

const self = fixture();
assert.equal((await self.request({ action: "save_profile", displayName: "Me", memberId: "victim" })).status, 200);
assert.equal(self.calls[0].params[0], "owner", "Identity comes from membership, never request body");
const voidOrigin = fixture({ origin: () => undefined });
assert.equal((await voidOrigin.request({ action: "save_profile", displayName: "Me" })).status, 200);
const denied = fixture();
assert.equal((await denied.request({ action: "save_profile", displayName: "Me", artistSlug: "other-room" })).status, 403);
for (const links of [
  { songId: "other-song" }, { stemPackId: "other-stems" }, { rightsWorkId: "other-rights" }
]) {
  assert.equal((await denied.request({ action: "create_project", title: "x", ...links })).status, 403);
}
assert.ok(denied.calls.every(c => !c.query.startsWith("INSERT")));
const wrongVersion = fixture({ sql: query => query.includes("FROM halo_song_catalog") ? [{ id: "song" }] : [] });
assert.equal((await wrongVersion.request({ action: "create_project", title: "x", songId: "song", songVersionId: "other-version" })).status, 403);
assert.ok(wrongVersion.calls.some(c => c.query.includes("song_id = ?") && c.params.includes("song")));

const create = fixture({ sql: () => [{ id: "owned" }] });
assert.equal((await create.request({ action: "create_project", title: "Session", songId: "song", stemPackId: "stems", rightsWorkId: "rights" })).status, 200);
assert.ok(create.calls.at(-1).query.startsWith("INSERT INTO halo_creator_projects"));
assert.equal(create.calls.at(-1).params[1], "owner");

const workflowSql = (query, params) => {
  if (query.startsWith("SELECT * FROM halo_creator_projects")) return [project];
  if (query.startsWith("SELECT * FROM halo_creator_participants")) return [invite];
  if (query.includes("FROM halo_creator_profiles")) return [{ member_id: "creator" }];
  if (query.startsWith("INSERT INTO halo_creator_participants") || query.startsWith("UPDATE halo_creator_participants")) return [{ member_id: params[1] }];
  return [];
};
const owner = fixture({ sql: workflowSql });
assert.equal((await owner.request({ action: "invite", projectId: "project", memberId: "creator" })).status, 200);
assert.equal((await owner.request({ action: "invite", projectId: "project", memberId: "owner" })).status, 400);
assert.equal((await owner.request({ action: "respond", projectId: "project", memberId: "creator", status: "accepted" })).status, 403);
assert.equal((await owner.request({ action: "close_project", projectId: "project" })).status, 200);
const creator = fixture({ memberId: "creator", sql: workflowSql });
assert.equal((await creator.request({ action: "apply", projectId: "project" })).status, 200);
assert.equal((await creator.request({ action: "invite", projectId: "project", memberId: "stranger" })).status, 403);
assert.equal((await creator.request({ action: "close_project", projectId: "project" })).status, 403);
for (const choice of ["accepted", "declined"]) {
  assert.equal((await creator.request({ action: "respond", projectId: "project", status: choice })).status, 200);
}
assert.ok(creator.calls.filter(c => c.query.startsWith("UPDATE")).every(c => c.query.includes("status = 'pending'") && c.query.includes("status = 'open'")));
const stranger = fixture({ memberId: "stranger", sql: workflowSql });
assert.equal((await stranger.request({ action: "respond", projectId: "project", memberId: "creator", status: "accepted" })).status, 403);
const applicationOwner = fixture({ sql: query => query.includes("FROM halo_creator_participants") && query.startsWith("SELECT")
  ? [{ ...invite, kind: "application" }] : workflowSql(query, []) });
assert.equal((await applicationOwner.request({ action: "respond", projectId: "project", memberId: "creator", status: "accepted" })).status, 200);
const closed = fixture({ sql: query => query.includes("FROM halo_creator_projects") ? [{ ...project, status: "closed" }] : [] });
assert.equal((await closed.request({ action: "invite", projectId: "project", memberId: "creator" })).status, 409);
const duplicate = fixture({ sql: query => query.startsWith("INSERT") ? [] : workflowSql(query, []) });
assert.equal((await duplicate.request({ action: "invite", projectId: "project", memberId: "creator" })).status, 409);
const race = fixture({ memberId: "creator", sql: query => query.startsWith("UPDATE") ? [] : workflowSql(query, []) });
assert.equal((await race.request({ action: "respond", projectId: "project", status: "accepted" })).status, 409);

const discovery = fixture();
const response = await discovery.request(null, "GET", "?role=Vocalist&genre=House&bpm=124&language=English&key=A%20minor");
assert.equal(response.status, 200);
assert.equal(response.headers.get("Cache-Control"), "no-store");
assert.equal((await response.json()).memberId, "owner");
assert.equal(discovery.calls.length, 4);
assert.ok(discovery.calls.some(c => c.params.includes(124) && c.params.includes("Vocalist")));
console.log("Creator Network contracts passed: validation, identity, origin, ownership, discovery and participant lifecycle");
