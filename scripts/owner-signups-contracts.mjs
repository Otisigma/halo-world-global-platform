import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { loadOwnerSignups } from "../netlify/lib/owner-signups.mjs";
import { isOwner } from "../netlify/lib/halo-x.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [api, relations, client, page, command] = await Promise.all([
  read("netlify/functions/halo-control-center.mjs"), read("netlify/functions/halo-relations.mjs"),
  read("owner-signups.js"), read("halo-command.html"), read("halo-command.js")
]);
const owner = { id: "owner", app_metadata: { roles: ["halo-owner"] } };
const timestamp = "2026-10-29T12:00:00.000Z";
const maliciousEmail = "<img src=x onerror=alert(1)>@example.test";
const queries = [];
const db = { async sql(strings) {
  const query = strings.join("?");
  queries.push(query);
  assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i, "signup reads must never mutate");
  assert.match(query, /LIMIT 30\b/);
  if (query.includes("halo_relationship_signups")) {
    assert.match(query, /ORDER BY s\.last_signup_at DESC, s\.email ASC/);
    return [{ email: maliciousEmail, source: "dreamweaver_satellite", status: "linked_member",
      first_signup_at: timestamp, last_signup_at: timestamp, consent_at: timestamp,
      first_name: "Not returned", linked_member_name: "Not returned" }];
  }
  if (query.includes("halo_member_notification_preferences")) {
    assert.match(query, /JOIN halo_memberships m ON m\.member_id = p\.member_id/);
    assert.match(query, /WHERE p\.track_drops_email = TRUE AND p\.email_consent_at IS NOT NULL/);
    assert.match(query, /ORDER BY p\.email_consent_at DESC, p\.member_id ASC/);
    return [
      { email: "opted@example.test", track_drops_email: true, email_consent_at: timestamp, updated_at: timestamp },
      { email: "revoked@example.test", track_drops_email: false, email_consent_at: timestamp },
      { email: "missing@example.test", track_drops_email: true, email_consent_at: null },
      { email: "disabled@example.test", track_drops_email: false, email_consent_at: null }
    ].filter(row => row.track_drops_email === true && row.email_consent_at !== null);
  }
  assert.match(query, /FROM halo_artist_pro_leads/);
  assert.match(query, /ORDER BY updated_at DESC, id ASC/);
  return [{ email: "application@example.test", source: "artist_pro_page", status: "declined",
    consent_at: timestamp, created_at: timestamp, updated_at: timestamp, message: "Private application text" }];
} };

for (const user of [null, { id: "member", user_metadata: { roles: ["owner"] } }]) {
  await assert.rejects(loadOwnerSignups(db, user), /Owner access/);
}
assert.equal(queries.length, 0, "data helper must deny non-owners before queries");
const signups = await loadOwnerSignups(db, owner);
assert.equal(queries.length, 3);
assert.equal(signups.limitPerSource, 30);
assert.equal(signups.sources.dreamweaver.rows[0].consentAt, timestamp);
assert.equal(signups.sources.artistPro.rows[0].status, "declined", "application state must not become subscription state");
assert.deepEqual(signups.sources.trackDrops.rows.map(row => row.email), ["opted@example.test"]);
assert.equal(signups.sources.dreamweaver.rows[0].source, "dreamweaver_satellite");
assert.equal(signups.sources.artistPro.rows[0].source, "artist_pro_page");
assert.doesNotMatch(JSON.stringify(signups), /Not returned|Private application text|revoked@example/);

for (const missing of ["halo_relationship_signups", "halo_member_notification_preferences", "halo_artist_pro_leads"]) {
  const result = await loadOwnerSignups({ sql(strings) {
    if (strings.join("").includes(missing)) throw new Error("private database detail");
    return db.sql(strings);
  } }, owner);
  const key = { halo_relationship_signups: "dreamweaver", halo_member_notification_preferences: "trackDrops", halo_artist_pro_leads: "artistPro" }[missing];
  assert.equal(result.sources[key].status, "unavailable");
  assert.equal(result.sources[key].rows, null);
  assert.equal(Object.values(result.sources).filter(source => source.status === "available").length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private database detail/);
}
const empty = await loadOwnerSignups({ sql: async () => [] }, owner);
assert.ok(Object.values(empty.sources).every(source => source.status === "available" && source.rows.length === 0));

// Exercise the real route with external services replaced, as in existing VM contracts.
function route(user, { fail = false, origin = true } = {}) {
  const calls = { db: 0, signups: 0, operations: 0, mutations: 0 };
  const context = {
    Response, URL, Buffer, console: { error() {} }, isOwner,
    getUser: async () => user,
    getDatabase: () => { calls.db++; return db; },
    loadOwnerSignups: async (...args) => { calls.signups++; if (fail) throw new Error("private error"); return loadOwnerSignups(...args); },
    loadControlCenter: async () => { calls.operations++; return { pulse: {}, activity: [], commands: [] }; },
    createAgentCommand: async () => { calls.mutations++; return { id: 1 }; },
    verifyRequestOrigin: async () => origin, requestPreflight: () => ({})
  };
  vm.runInNewContext(api.replace(/^import .*;\n/gm, "")
    .replace("export default async function", "async function")
    .replace("export const config", "const config") + "\nthis.handler = haloControlCenterHandler;", context);
  return { calls, handler: context.handler };
}
const request = (method, query = "?view=signups") => new Request(`https://halo.test/api/halo-control-center${query}`, {
  method, ...(method === "POST" ? { body: JSON.stringify({ message: "test" }) } : {})
});
for (const user of [null, { id: "member", user_metadata: { roles: ["owner"] } }]) {
  const f = route(user);
  for (const method of ["GET", "HEAD", "POST"]) {
    const response = await f.handler(request(method));
    assert.equal(response.status, user ? 403 : 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.doesNotMatch(await response.text(), /@example|sources/);
  }
  assert.equal(f.calls.db, 0);
}
const f = route(owner);
assert.equal((await f.handler(request("HEAD"))).status, 204);
assert.equal(f.calls.db, 0, "menu HEAD must not query signup data");
for (const method of ["POST", "DELETE"]) {
  const response = await f.handler(request(method));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}
assert.equal(f.calls.signups, 0);
let response = await f.handler(request("GET"));
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal((await response.json()).signups.sources.trackDrops.rows.length, 1);
response = await f.handler(request("GET", ""));
assert.deepEqual(Object.keys(await response.json()).sort(), ["activity", "commands", "pulse"]);
assert.equal(f.calls.signups, 1, "normal operations must not load private signup rows");
assert.equal(f.calls.mutations, 0);
response = await route(owner, { fail: true }).handler(request("GET"));
assert.equal(response.status, 503);
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.doesNotMatch(await response.text(), /private error/);
const deniedMutation = route(owner, { origin: false });
assert.equal((await deniedMutation.handler(request("POST", ""))).status, 403);
assert.equal(deniedMutation.calls.mutations, 0, "existing mutations must retain origin verification");
const mutation = route(owner);
assert.equal((await mutation.handler(request("POST", ""))).status, 201);
assert.equal(mutation.calls.mutations, 1);
assert.equal(mutation.calls.signups, 0);

assert.match(relations, /loadRelationshipSignups\(db\)/);
assert.match(relations, /dreamweaverSignups: dreamweaverRows\.map/);
assert.match(relations, /isOwner\(user\)/);
assert.match(relations, /verifyRequestOrigin\(request\)/);
assert.match(relations, /private, no-store/);
assert.match(page, /id="ownerSignups"[^>]*hidden/);
assert.match(page, /src="\/owner-signups\.js"/);
assert.match(command, /halo-owner-operations/);
assert.doesNotMatch(client, /innerHTML|outerHTML|insertAdjacentHTML|clipboard|localStorage|sessionStorage|sendBeacon/);
for (const file of [
  "netlify/functions/halo-satellite-status.mjs", "netlify/functions/stats-summary.mjs",
  "netlify/lib/dreamweaver-telemetry.mjs", "netlify/lib/control-center.mjs",
  "netlify/lib/agent-team.mjs"
]) {
  const source = await read(file);
  assert.doesNotMatch(source, /owner-signups|relationship-signups|loadOwnerSignups|loadRelationshipSignups/,
    `${file} must not load signup rows into public/aggregate/model data`);
}

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.textContent = ""; this.hidden = false; this.listeners = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  text() { return this.textContent + this.children.map(child => child.text()).join(" "); }
}
const elements = Object.fromEntries(["ownerSignups", "signupSources", "signupStatus", "signupRefresh", "identityButton"].map(id => [id, new Element()]));
elements.ownerSignups.hidden = true;
const listeners = {};
let authChange, fetches = 0, pending, lastSignal;
let nextResponse = () => Promise.resolve(Response.json({ signups }));
vm.runInNewContext(client, {
  document: { getElementById: id => elements[id], createElement: tag => new Element(tag) },
  window: {
    addEventListener: (name, callback) => { listeners[name] = callback; },
    haloIdentity: { onAuthChange(callback) { authChange = callback; } }
  },
  AbortController, setTimeout, clearTimeout, Date,
  fetch: (url, options) => {
    fetches++;
    assert.equal(url, "/api/halo-control-center?view=signups");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    lastSignal = options.signal;
    return nextResponse();
  }
});
const settle = () => new Promise(resolve => setImmediate(resolve));
assert.equal(fetches, 0);
listeners["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
assert.equal(elements.ownerSignups.hidden, false);
assert.ok(elements.signupSources.text().includes(maliciousEmail), "email markup must stay literal text");
assert.match(elements.signupSources.text(), /not a general newsletter|not generic newsletter/);
assert.match(elements.signupSources.text(), /maximum 30/);
assert.match(elements.signupSources.text(), /Revoked or missing consent is excluded/);
assert.ok(!elements.signupSources.children.some(child => child.tag === "img"));
nextResponse = () => new Promise(resolve => { pending = resolve; });
elements.signupRefresh.listeners.click();
assert.equal(elements.signupSources.children.length, 0, "refresh must remove stale preferences");
elements.identityButton.listeners.click();
assert.equal(lastSignal.aborted, true);
pending(Response.json({ signups }));
await settle();
assert.equal(elements.ownerSignups.hidden, true);
assert.equal(elements.signupSources.children.length, 0, "late responses must not restore signed-out PII");
nextResponse = () => Promise.resolve(Response.json({ signups }));
listeners["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
authChange("logout", null);
assert.equal(elements.signupSources.children.length, 0);
nextResponse = () => Promise.resolve(new Response(null, { status: 403 }));
listeners["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
assert.equal(elements.ownerSignups.hidden, true);
assert.equal(elements.signupSources.children.length, 0);
console.log("Owner signup privacy, consent, API and rendering contracts passed.");
