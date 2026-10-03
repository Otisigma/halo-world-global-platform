import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createCreatorNetworkHandler, profileInput, projectInput, canRespond } from "../netlify/lib/creator-network.mjs";
import { PUBLIC_ROUTE_REGISTRY, canonicalizeRoutePath } from "../lib/route-registry.js";
import { curatedCreators, withCuratedCreators } from "../lib/creator-directory.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, api, html, client, routes, preview, home] = await Promise.all([
  read("netlify/database/migrations/20261003095500_create_creator_network.sql"),
  read("netlify/lib/creator-network.mjs"), read("creator-network/index.html"),
  read("creator-network/network.js"), read("netlify.toml"), read("creators/index.html"), read("halo.html")
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
assert.match(html, /src="\/halo-hud.js"/);
assert.match(html, /href="\/halo-hud.css"/);
assert.match(html, /data-halo-guide=/);
assert.match(html, /id="publicDirectory"/);
assert.match(html, /id="publicCreators"/);
assert.match(html, /id="studioPlayer" controls/);
assert.match(html, /id="pipelineTitle"/);
assert.match(html, /Open Dreamweaver/);
assert.match(html, /id="studioTrack"/);
assert.doesNotMatch(html, /name="robots" content="noindex/);
assert.match(home, /href="\/creator-network\/"/);
assert.match(home, /href="\/signal-network\/"/);
assert.match(html, /id="orbits"/);
assert.match(html, /Core Studio Vault/);
assert.match(html, /Inner Crew/);
assert.match(html, /Network Peers/);
assert.match(html, /Public Signal/);
assert.match(html, /id="guardianForm"/);
assert.match(client, /\/api\/studio-guardian/);
assert.deepEqual(curatedCreators().map(creator => creator.display_name), ["DJ Halo", "DJ Butterfly", "DJ Romy"]);
assert.ok(curatedCreators().every(creator => creator.verified && creator.curated && !creator.member_id));
assert.deepEqual(curatedCreators({ language: "Swahili" })[0].languages, ["English", "Swahili"]);
assert.equal(curatedCreators({ genre: "Jazz" }).length, 0);
assert.equal(curatedCreators({ bpm: 124 }).length, 0, "Do not invent tempo ranges for curated artists");
assert.equal(withCuratedCreators([{ display_name: "DJ Halo" }]).length, 3);
assert.equal(withCuratedCreators([{ display_name: "DJ Halo" }])[0].verified, undefined, "A matching display name cannot confer verification");
for (const route of ["/artist/dashboard", "/artists/", "/song-catalog/", "/dreamweaver-lab/", "/mixes/"]) {
  assert.ok(html.includes(`href="${route}"`));
}
assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML/);
assert.match(client, /sessionVersion/);
assert.match(api, /WHERE discoverable = TRUE AND member_id <>/);
assert.match(api, /SELECT display_name, bio, artist_slug, roles, genres, languages, bpm_min, bpm_max/);
assert.match(api, /LIMIT 48/);
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
const publicDiscovery = fixture({ authenticated: false, sql: () => [{
  display_name: "Opt-in Producer", bio: "Available for sessions", artist_slug: "producer-room",
  roles: ["Producer"], genres: ["House"], languages: ["English"], bpm_min: 118, bpm_max: 126
}] });
const publicResponse = await publicDiscovery.request(null, "GET", "?view=public&genre=House");
assert.equal(publicResponse.status, 200);
const publicState = await publicResponse.json();
assert.equal(publicState.creators[0].display_name, "Opt-in Producer");
assert.equal("member_id" in publicState.creators[0], false, "Public cards never expose member identity");
assert.equal(publicDiscovery.membershipCount(), 0, "Public discovery does not create a member session");
assert.ok(publicDiscovery.calls[0].query.includes("discoverable = TRUE"));
assert.ok(!publicDiscovery.calls[0].query.includes("split_preference"), "Public discovery omits private split preferences");
const invalidPublic = fixture({ authenticated: false });
assert.equal((await invalidPublic.request(null, "GET", "?view=public&bpm=invalid")).status, 400);
const offlineDirectory = fixture({ authenticated: false, sql: () => { throw new Error("Database unavailable"); } });
const offlineState = await (await offlineDirectory.request(null, "GET", "?view=public")).json();
assert.equal(offlineState.directoryUnavailable, true);
assert.equal(offlineState.creators.length, 3, "Curated discovery remains available without a database");
assert.equal(offlineDirectory.membershipCount(), 0);
assert.equal((await offlineDirectory.request(null, "GET", "?view=public&role=DJ&language=Swahili")).status, 200);
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
assert.equal(discovery.calls.length, 5);
assert.ok(discovery.calls.some(c => c.params.includes(124) && c.params.includes("Vocalist")));
const ownedQuery = discovery.calls.find(c => c.query.includes("WHERE p.owner_member_id = ? OR EXISTS"));
assert.ok(ownedQuery);
assert.ok(!ownedQuery.query.includes("LIMIT"), "Discovery caps must not hide member projects");
const requestsQuery = discovery.calls.find(c => c.query.includes("WHERE cp.member_id = ? OR p.owner_member_id = ?"));
assert.ok(requestsQuery);
assert.ok(!requestsQuery.query.includes("LIMIT"), "History must not displace actionable requests");
const crowded = fixture({ sql: query => {
  if (query.includes("WHERE p.owner_member_id = ? OR EXISTS")) return [{ id: "older-owned", owner_member_id: "owner" }];
  if (query.includes("WHERE p.status = 'open' AND p.owner_member_id <>")) return Array.from({ length: 100 }, (_, i) => ({ id: `newer-${i}` }));
  return [];
} });
const crowdedState = await (await crowded.request(null, "GET")).json();
assert.equal(crowdedState.projects.length, 101);
assert.equal(crowdedState.projects[0].id, "older-owned");
const busyRequests = fixture({ sql: query => query.includes("WHERE cp.member_id = ? OR p.owner_member_id = ?")
  ? [...Array.from({ length: 100 }, (_, i) => ({ project_id: `newer-${i}`, status: "accepted" })),
    { project_id: "older-pending", status: "pending" }]
  : [] });
const busyState = await (await busyRequests.request(null, "GET")).json();
assert.equal(busyState.participants.length, 101);
assert.equal(busyState.participants.at(-1).status, "pending");

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    hidden: false, textContent: "", draft: "", children: [], className: "",
    listeners: new Map(),
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    querySelector() { return element("mock-button"); },
    querySelectorAll() { return [element("health-button"), element("council-button")]; },
    reset() { this.draft = ""; },
    get elements() { return []; }
  });
  return elements.get(id);
}
let authChanged;
const executableClient = client.replace(/^import \{ curatedCreators \} from "\/lib\/creator-directory.js";\s*/, "");
vm.runInNewContext(executableClient, {
  curatedCreators,
  document: { getElementById: element, createElement: tag => ({
    tagName: tag.toUpperCase(), textContent: "", children: [], addEventListener() {},
    append(...children) { this.children.push(...children); }, setAttribute() {}
  }) },
  URLSearchParams,
  FormData: class { [Symbol.iterator]() { return [][Symbol.iterator](); } },
  fetch: async url => ({
    ok: true,
    json: async () => String(url).includes("release-catalog") ? { releases: [] } : { creators: [] }
  }),
  window: { haloIdentity: {
    getUser: async () => null, onAuthChange: callback => { authChanged = callback; }
  } }
});
await new Promise(resolve => setImmediate(resolve));
element("project").draft = "Private unreleased collaboration brief";
element("creators").children = ["Previous member's discovery"];
authChanged();
await new Promise(resolve => setImmediate(resolve));
assert.equal(element("project").draft, "", "Account changes must clear unsaved briefs");
assert.deepEqual(element("creators").children, []);
assert.equal(element("workspace").hidden, true);
vm.runInNewContext(executableClient, {
  curatedCreators,
  document: { getElementById: element, createElement: tag => ({
    tagName: tag.toUpperCase(), textContent: "", children: [], addEventListener() {},
    append(...children) { this.children.push(...children); }, setAttribute() {}
  }) },
  URLSearchParams,
  FormData: class { [Symbol.iterator]() { return [][Symbol.iterator](); } },
  fetch: async url => ({
    ok: true,
    json: async () => String(url).includes("release-catalog") ? { releases: [] }
      : String(url).includes("studio-guardian") ? {
        health: { score: 50, status: "blocked", summary: "Agreement review needed", provider: "checklist",
          audioInsights: ["Metadata only; no audio analysis"], actionableNextSteps: ["Review participant consent"] }
      }
      : String(url).includes("view=public") ? { creators: [] }
      : { memberId: "owner", profile: null, creators: curatedCreators(), projects: [], participants: [] }
  }),
  window: { haloIdentity: { getUser: async () => ({ id: "owner" }), onAuthChange() {} } }
});
await new Promise(resolve => setImmediate(resolve));
assert.equal(element("workspace").hidden, false);
assert.equal(element("creators").children.length, 3, "Curated profiles render in the member workspace without fabricated private metadata");
assert.equal(element("guardianProject").children[0].value, "", "A project is required before requesting a Guardian review");
assert.ok(element("creators").children.every(card => card.children.every(child => child.textContent !== "Invite to project")));
element("guardianProject").value = "project";
await element("guardianForm").listeners.get("submit")({
  preventDefault() {}, currentTarget: element("guardianForm"), submitter: { value: "health" }
});
assert.equal(element("guardianReport").children[0].textContent, "50/100 · blocked");
assert.equal(element("guardianReport").children.at(-1).textContent, "Review mode: checklist · Advisory only");
assert.equal(element("health-button").disabled, false, "Review controls recover after the request");
element("guardianProject").value = "another-project";
element("guardianProject").listeners.get("change")();
assert.equal(element("guardianReport").children.length, 0, "Changing projects clears the previous project's review");
element("guardianProject").value = "project";
const pendingReview = element("guardianForm").listeners.get("submit")({
  preventDefault() {}, currentTarget: element("guardianForm"), submitter: { value: "health" }
});
element("guardianProject").value = "another-project";
element("guardianProject").listeners.get("change")();
await pendingReview;
assert.equal(element("guardianReport").children.length, 0, "A response for an old project cannot render under a new selection");
console.log("Creator Network contracts passed: validation, identity, origin, ownership, discovery and participant lifecycle");
