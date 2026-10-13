import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, api, migration] = await Promise.all([
  read("signal-network/index.html"),
  read("signal-network/circle-directory.js"),
  read("signal-network/signal-network.css"),
  read("netlify/functions/circle-members.mjs"),
  read("netlify/database/migrations/20261013210000_create_circle_members.sql")
]);

const checks = [
  [page.includes('id="circleDirectory"') && page.includes("Circle Members") && page.includes('src="/signal-network/circle-directory.js"'), "ships the Circle Members directory section and loader"],
  [["Artist Core", "Creative Team", "Extended World"].every(name => page.includes(`>${name}</h3>`) && page.includes(`+ Add to ${name}`)), "renders the three tiers with exact names and add actions"],
  [["artistCoreList", "creativeTeamList", "extendedWorldList"].every(id => page.includes(`id="${id}"`)), "exposes the three member list containers"],
  [page.includes('id="circleInviteDialog"') && page.includes('id="circleInviteEmail"') && page.includes('id="circleInviteCircle"') && page.includes('id="circleInviteRole"'), "provides the invite dialog with email, circle, and role"],
  [!/getElementById\('[A-Za-z]+List\.innerHTML/.test(script) && !script.includes("row.innerHTML"), "fixes the malformed list clearing and avoids HTML injection in rows"],
  [script.includes('"/api/circles/members"') && script.includes('credentials: "same-origin"'), "loads members from /api/circles/members"],
  [api.includes('config = { path: "/api/circles/members" }') && api.includes("ensureMembership") && api.includes("await verifyRequestOrigin") && api.includes("owner_member_id = ${memberId}"), "protects the circle API with membership, same-origin checks, and owner scoping"],
  [api.includes("Invite limit reached") && api.includes("MAX_MEMBERS"), "rate limits invites and caps circle size"],
  [migration.includes("CREATE TABLE IF NOT EXISTS halo_circle_members") && migration.includes("CHECK (circle_name IN ('artist_core', 'creative_team', 'extended_world'))") && migration.includes("CHECK (status IN ('pending', 'active'))"), "persists circle membership with tier and status constraints"],
  [styles.includes(".circle-directory") && styles.includes(".circle-member__status.is-pending") && styles.includes("prefers-reduced-motion"), "styles the dark directory with status badges and reduced motion"]
];

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.className = ""; this.textContent = ""; this.title = ""; this._innerHTML = ""; }
  set innerHTML(value) { this._innerHTML = value; this.children = []; }
  get innerHTML() { return this._innerHTML; }
  append(...nodes) { this.children.push(...nodes); }
  get classList() { return { toggle: () => {} }; }
}
function fakeDocument(ids) {
  const elements = new Map(ids.map(id => [id, new FakeElement("ul")]));
  return {
    elements,
    createElement: tag => new FakeElement(tag),
    getElementById: id => elements.get(id) || null,
    querySelector: () => null
  };
}

const directory = await import(pathToFileURL(resolve(root, "signal-network/circle-directory.js")).href);
const members = [
  { email: "owner@haloworld.com", circle_name: "artist_core", role: "admin", status: "active", self: true },
  { email: "producer@example.com", circle_name: "creative_team", role: "collaborator", status: "pending" },
  { email: "<img src=x onerror=alert(1)>@example.com", circle_name: "extended_world", role: "viewer", status: "active" },
  { email: "unknown@example.com", circle_name: "mystery", role: "viewer", status: "pending" },
  null,
  { circle_name: "artist_core" }
];

const groups = directory.groupMembersByCircle(members);
assert.equal(groups.artist_core.length, 1, "artist core groups its members");
assert.equal(groups.creative_team.length, 1, "creative team groups its members");
assert.equal(groups.extended_world.length, 2, "unknown circles fall back to Extended World");

const doc = fakeDocument(["artistCoreList", "creativeTeamList", "extendedWorldList"]);
doc.elements.get("artistCoreList").append(new FakeElement("li"));
directory.renderCircleMembers(members, doc);
assert.equal(doc.elements.get("artistCoreList").children.length, 1, "artist core list is cleared before rendering");
assert.equal(doc.elements.get("creativeTeamList").children.length, 1, "creative team list is rendered");
const unsafeRow = doc.elements.get("extendedWorldList").children[0];
assert.equal(unsafeRow.children[0].children[0].textContent, members[2].email, "emails are written as text, not HTML");
assert.equal(unsafeRow.innerHTML, "", "member rows never use innerHTML");
assert.equal(doc.elements.get("creativeTeamList").children[0].children[1].className, "circle-member__status is-pending", "pending invites get a pending badge");

const partialDoc = fakeDocument(["creativeTeamList"]);
assert.doesNotThrow(() => directory.renderCircleMembers(members, partialDoc), "rendering tolerates missing tier lists");
directory.renderCircleMembers([], partialDoc);
assert.equal(partialDoc.elements.get("creativeTeamList").children[0].className, "circle-member circle-member--empty", "empty tiers show an empty state");

let requestedUrl = "";
const loaded = await directory.fetchCircleMembers({
  doc: fakeDocument(["artistCoreList", "creativeTeamList", "extendedWorldList"]),
  fetchImpl: async url => { requestedUrl = url; return { ok: true, json: async () => ({ members }) }; }
});
assert.equal(requestedUrl, "/api/circles/members", "fetches the circle members endpoint");
assert.equal(loaded.creative_team.length, 1, "fetchCircleMembers renders API members");

const originalError = console.error;
console.error = () => {};
const failed = await directory.fetchCircleMembers({
  doc: fakeDocument([]),
  fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: "Sign in" }) })
});
console.error = originalError;
assert.equal(failed, null, "API failures are handled without throwing");

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Circle directory contracts: ${checks.length}/${checks.length} checks passed, rendering behaviour verified.`);
