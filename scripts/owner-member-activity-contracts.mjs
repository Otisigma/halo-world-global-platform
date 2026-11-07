import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  cleanMemberId, loadOwnerMemberActivity, loadOwnerMemberDirectory, pagePathFrom, SUPPORT_EXCERPT_LIMIT
} from "../netlify/lib/owner-member-activity.mjs";
import { loadOwnerSignups } from "../netlify/lib/owner-signups.mjs";
import { isOwner } from "../netlify/lib/halo-x.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [api, client, page, library] = await Promise.all([
  read("netlify/functions/halo-control-center.mjs"), read("owner-member-activity.js"),
  read("halo-command.html"), read("netlify/lib/owner-member-activity.mjs")
]);
const owner = { id: "owner", app_metadata: { roles: ["halo-owner"] } };
const nonOwners = [null, { id: "member", user_metadata: { roles: ["owner"] } }];
const timestamp = "2026-10-29T12:00:00.000Z";
const later = "2026-10-29T13:00:00.000Z";
const malicious = "<img src=x onerror=alert(1)>";
const memberA = "a1b2c3d4-0000-4000-8000-000000000001";
const memberB = "a1b2c3d4-0000-4000-8000-000000000002";

const supportRows = [
  { request_key: "r1", submitter_id: memberA, category: "support", title: `Help ${malicious}`, details: "x".repeat(4000),
    page_url: "https://halo.test/track-drops/?token=secret#private", visibility: "private", status: "received",
    staff_note: "Private staff note", vote_count: 0, created_at: later, updated_at: later },
  { request_key: "r2", submitter_id: memberA, category: "feature", title: "Public idea", details: "Add playlist sharing please",
    page_url: null, visibility: "public", status: "planned", staff_note: "Private staff note", vote_count: 3, created_at: timestamp, updated_at: later },
  { request_key: "r3", submitter_id: memberB, category: "bug", title: "Other member private bug", details: "Another member's private detail",
    page_url: "https://halo.test/other/", visibility: "private", status: "received", staff_note: null, vote_count: 0, created_at: later, updated_at: later }
];

const queries = [];
function database({ fail = "" } = {}) {
  return { async sql(strings, ...values) {
    const query = strings.join("?");
    queries.push({ query, values });
    assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i, "member activity reads must never mutate");
    const limit = Number(query.match(/LIMIT (\d+)\b/)?.[1]);
    assert.ok(limit >= 1 && limit <= 30, `every member activity query must be bounded: ${query}`);
    if (fail && query.includes(fail)) throw new Error("private database detail");
    if (query.includes("FROM halo_memberships") && query.includes("WHERE member_id =")) {
      return [memberA, memberB].includes(values[0]) ? [{ member_id: values[0], display_name: `Member ${malicious}`,
        email: `${malicious}@example.test`, tier: "member", source: "membership", joined_at: timestamp, last_seen_at: later }] : [];
    }
    if (query.includes("FROM halo_memberships")) {
      assert.match(query, /ORDER BY last_seen_at DESC, member_id ASC/);
      return [memberA, memberB].map(id => ({ member_id: id, display_name: `Member ${malicious}`, email: `${id}@example.test`,
        tier: "member", joined_at: timestamp, last_seen_at: later }));
    }
    if (query.includes("FROM halo_support_requests") && query.includes("ANY(")) {
      const ids = values[0];
      return [memberA, memberB].filter(id => ids.includes(id)).map(id => {
        const rows = supportRows.filter(row => row.submitter_id === id);
        return { submitter_id: id, total: rows.length, open: rows.filter(row => !["resolved", "closed"].includes(row.status)).length };
      });
    }
    if (query.includes("FROM halo_support_requests")) {
      assert.match(query, /WHERE submitter_id = \?/);
      assert.match(query, /ORDER BY created_at DESC, request_key ASC/);
      assert.doesNotMatch(query, /staff_note|\*/, "private staff notes must not be selected");
      return supportRows.filter(row => row.submitter_id === values[0]);
    }
    if (query.includes("FROM analytics_events")) {
      assert.match(query, /event_name = 'page_view'/);
      assert.match(query, /GROUP BY page_path/);
      assert.doesNotMatch(query, /halo_memberships|member_id|SELECT[^]*anonymous_id/i, "anonymous analytics must stay aggregate and unlinked");
      return [{ page_path: "/halo", views: 40, sessions: 12 }, { page_path: `/${malicious}`, views: 1, sessions: 1 }];
    }
    if (query.includes("halo_relationship_auth_events")) {
      assert.doesNotMatch(query, /session_key/);
      assert.match(query, /ORDER BY occurred_at DESC, id DESC/);
      return [{ id: 2, event_type: "login", occurred_at: later, session_key: "not returned" }, { id: 1, event_type: "signup", occurred_at: timestamp }];
    }
    if (query.includes("halo_member_reward_events")) return [{ reward_key: "k", points: 5, reason: "Enabled Track Drops", created_at: timestamp }];
    if (query.includes("halo_release_house_submissions")) {
      assert.match(query, /WHERE owner_member_id = \?/);
      return [{ id: "s", pathway: "halo_catalog_review", artist_name: "Artist", track_title: "Song", status: "pending_review", created_at: timestamp, updated_at: timestamp }];
    }
    if (query.includes("halo_listening_sessions")) {
      assert.match(query, /p\.enabled = TRUE AND p\.consent_at IS NOT NULL/, "listening history requires active opt-in");
      return [{ id: "l", outcome: "listen_complete", started_at: timestamp, title: "Opted-in song" }];
    }
    if (query.includes("halo_relationship_signups")) {
      assert.match(query, /WHERE linked_member_id = \?/);
      assert.doesNotMatch(query, /first_name/);
      return [{ source: "dreamweaver_satellite", status: "linked_member", consent_at: timestamp, first_signup_at: timestamp, last_signup_at: timestamp }];
    }
    if (query.includes("halo_member_notification_preferences")) {
      return [{ track_drops_in_app: true, track_drops_email: false, email_consent_at: timestamp, updated_at: later }];
    }
    throw new Error(`Unexpected query: ${query}`);
  } };
}

// Owner authorization happens before any query.
for (const user of nonOwners) {
  await assert.rejects(loadOwnerMemberDirectory(database(), user), /Owner access/);
  await assert.rejects(loadOwnerMemberActivity(database(), user, memberA), /Owner access/);
}
assert.equal(queries.length, 0, "non-owners must be denied before queries");

assert.equal(cleanMemberId(memberA), memberA);
for (const invalid of ["", "x y", "a'; DROP TABLE x", "a/b", null, 42, "x".repeat(161)]) assert.equal(cleanMemberId(invalid), "");
assert.equal(await loadOwnerMemberActivity(database(), owner, "bad id"), null);
assert.equal(queries.length, 0, "invalid member IDs must not query");
assert.equal(pagePathFrom("https://halo.test/a/b?token=secret#x"), "/a/b");
assert.equal(pagePathFrom("not a url"), null);

const directory = await loadOwnerMemberDirectory(database(), owner);
assert.equal(directory.limit, 30);
assert.equal(directory.members.status, "available");
assert.deepEqual(directory.members.rows.map(row => row.requests), [{ total: 2, open: 2 }, { total: 1, open: 1 }]);
assert.equal(directory.anonymousPages.status, "available");
assert.equal(directory.anonymousPages.windowDays, 7);
assert.deepEqual(Object.keys(directory.anonymousPages.rows[0]).sort(), ["pagePath", "sessions", "views"]);
assert.doesNotMatch(JSON.stringify(directory.anonymousPages), /@example|member|anonymous_id|session_id/i);

queries.length = 0;
const activity = await loadOwnerMemberActivity(database(), owner, memberA);
assert.ok(queries.every(({ query }) => !query.includes("analytics_events")), "member history must never read anonymous analytics");
assert.ok(Object.values(activity.sources).every(source => source.status === "available"), "every source query must satisfy its privacy contract");
assert.equal(activity.limitPerSource, 20);
assert.equal(activity.member.id, memberA);
assert.equal(activity.pageHistory.status, "unavailable");
assert.match(activity.pageHistory.reason, /not linked to members/);
assert.equal(activity.artistPro.status, "not_linked");
const requests = activity.sources.requests.rows;
assert.deepEqual(requests.map(row => row.title), [`Help ${malicious}`, "Public idea"]);
assert.equal(requests[0].pagePath, "/track-drops/", "query strings and fragments must not be returned");
assert.equal(requests[1].pagePath, null);
assert.ok(requests[0].excerpt.length <= SUPPORT_EXCERPT_LIMIT, "support details are bounded");
const serialized = JSON.stringify(activity);
assert.doesNotMatch(serialized, /Private staff note|Other member private bug|Another member's private detail|token=secret|not returned|request_key|r1/);
assert.equal(activity.sources.trackDrops.rows[0].emailOptIn, false, "revoked Track Drops email consent must read as not opted in");
assert.equal(activity.sources.trackDrops.rows[0].consentAt, null);
assert.equal(activity.sources.dreamweaver.rows[0].source, "dreamweaver_satellite");
assert.equal(activity.sources.listening.rows[0].releaseTitle, "Opted-in song");
const otherActivity = await loadOwnerMemberActivity(database(), owner, memberB);
assert.deepEqual(otherActivity.sources.requests.rows.map(row => row.title), ["Other member private bug"]);
assert.equal(await loadOwnerMemberActivity(database(), owner, "unknown-member"), null);

for (const [table, key] of [["halo_support_requests", "requests"], ["halo_relationship_auth_events", "accountEvents"],
  ["halo_listening_sessions", "listening"], ["halo_release_house_submissions", "releaseHouse"], ["halo_member_notification_preferences", "trackDrops"]]) {
  const partial = await loadOwnerMemberActivity(database({ fail: table }), owner, memberA);
  assert.equal(partial.sources[key].status, "unavailable");
  assert.equal(partial.sources[key].rows, null, "unavailable sources must not masquerade as empty");
  assert.doesNotMatch(JSON.stringify(partial), /private database detail/);
}
const partialDirectory = await loadOwnerMemberDirectory(database({ fail: "analytics_events" }), owner);
assert.equal(partialDirectory.anonymousPages.status, "unavailable");
assert.equal(partialDirectory.members.status, "available");
const noCounts = await loadOwnerMemberDirectory(database({ fail: "ANY(" }), owner);
assert.ok(noCounts.members.rows.every(row => row.requests === null), "unreadable request counts are not zero");

// Route: real handler with external services replaced.
function route(user, { fail = false } = {}) {
  const calls = { db: 0, members: 0, activity: 0, signups: 0, operations: 0 };
  const db = database();
  const context = {
    Response, URL, Buffer, console: { error() {} }, isOwner, cleanMemberId,
    getUser: async () => user,
    getDatabase: () => { calls.db++; return db; },
    loadOwnerSignups: async (...args) => { calls.signups++; return loadOwnerSignups(...args); },
    loadOwnerMemberDirectory: async (...args) => { calls.members++; if (fail) throw new Error("private error"); return loadOwnerMemberDirectory(...args); },
    loadOwnerMemberActivity: async (...args) => { calls.activity++; if (fail) throw new Error("private error"); return loadOwnerMemberActivity(...args); },
    loadControlCenter: async () => { calls.operations++; return { pulse: {}, activity: [], commands: [] }; },
    createAgentCommand: async () => ({ id: 1 }),
    verifyRequestOrigin: async () => true, requestPreflight: () => ({})
  };
  vm.runInNewContext(api.replace(/^import .*;\n/gm, "")
    .replace("export default async function", "async function")
    .replace("export const config", "const config") + "\nthis.handler = haloControlCenterHandler;", context);
  return { calls, handler: context.handler };
}
const call = (method, query) => new Request(`https://halo.test/api/halo-control-center${query}`, {
  method, ...(method === "POST" ? { body: JSON.stringify({ message: "test" }) } : {})
});
for (const user of nonOwners) {
  const denied = route(user);
  for (const query of ["?view=members", `?view=member&member=${memberA}`]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await denied.handler(call(method, query));
      assert.equal(response.status, user ? 403 : 401);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.doesNotMatch(await response.text(), /@example|Member|requests/);
    }
  }
  assert.equal(denied.calls.db, 0);
}
const allowed = route(owner);
for (const method of ["POST", "PUT"]) {
  const response = await allowed.handler(call(method, "?view=members"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}
assert.equal((await allowed.handler(call("HEAD", "?view=members"))).status, 204);
assert.equal(allowed.calls.db, 0, "menu HEAD and rejected methods must not read member data");
let response = await allowed.handler(call("GET", "?view=member&member=bad%20id"));
assert.equal(response.status, 400);
response = await allowed.handler(call("GET", "?view=member&member=unknown-member"));
assert.equal(response.status, 404);
assert.equal(response.headers.get("cache-control"), "private, no-store");
response = await allowed.handler(call("GET", "?view=members"));
assert.equal(response.headers.get("cache-control"), "private, no-store");
const directoryBody = await response.json();
assert.equal(directoryBody.directory.members.rows.length, 2);
response = await allowed.handler(call("GET", `?view=member&member=${memberA}`));
const activityBody = await response.json();
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal(activityBody.activity.sources.requests.rows.length, 2);
response = await allowed.handler(call("GET", ""));
assert.deepEqual(Object.keys(await response.json()).sort(), ["activity", "commands", "pulse"], "operations view must not include member rows");
response = await allowed.handler(call("GET", "?view=signups"));
assert.ok((await response.json()).signups.sources, "existing signup review remains available");
assert.equal(allowed.calls.signups, 1);
response = await route(owner, { fail: true }).handler(call("GET", "?view=members"));
assert.equal(response.status, 503);
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.doesNotMatch(await response.text(), /private error/);

// Page wiring and public isolation.
assert.match(page, /id="ownerMembers"[^>]*hidden/);
assert.match(page, /id="ownerSignups"[^>]*hidden/, "existing signup panel remains");
assert.match(page, /src="\/owner-member-activity\.js"/);
assert.match(page, /src="\/owner-signups\.js"/);
assert.match(page, /Page-by-page history is not recorded for members/);
assert.doesNotMatch(client, /innerHTML|outerHTML|insertAdjacentHTML|clipboard|localStorage|sessionStorage|sendBeacon|mailto:|method:\s*"POST"/);
assert.doesNotMatch(library, /\b(INSERT|UPDATE|DELETE)\b|staff_note|anonymous_id/);
for (const file of [
  "netlify/functions/halo-satellite-status.mjs", "netlify/functions/stats-summary.mjs", "netlify/functions/stats-event.mjs",
  "netlify/functions/support-feedback.mjs", "netlify/lib/dreamweaver-telemetry.mjs", "netlify/lib/control-center.mjs",
  "netlify/lib/agent-team.mjs", "halo.html", "lib/route-registry.js"
]) {
  assert.doesNotMatch(await read(file), /owner-member-activity|loadOwnerMember/, `${file} must not expose member histories`);
}

// Client: text-only rendering, denial clears, stale responses cannot restore data.
class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.textContent = ""; this.hidden = false; this.listeners = {}; this.attributes = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() {}
  text() { return this.textContent + " " + this.children.map(child => child.text()).join(" "); }
  find(predicate) { return predicate(this) ? this : this.children.map(child => child.find(predicate)).find(Boolean); }
}
const ids = ["ownerMembers", "memberDirectory", "memberDetail", "memberPages", "memberStatus", "memberRefresh", "identityButton"];
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
elements.ownerMembers.hidden = true;
const listeners = {};
let authChange, pending;
const signals = [];
const fetched = [];
let respond = url => Promise.resolve(Response.json(url.includes("view=members") ? directoryBody : activityBody));
vm.runInNewContext(client, {
  document: { getElementById: id => elements[id], createElement: tag => new Element(tag) },
  window: {
    addEventListener: (name, callback) => { listeners[name] = callback; },
    haloIdentity: { onAuthChange(callback) { authChange = callback; } }
  },
  AbortController, setTimeout, clearTimeout, Date, encodeURIComponent, String, Error,
  fetch: (url, options) => {
    fetched.push(url);
    assert.match(url, /^\/api\/halo-control-center\?view=(members|member&member=[\w-]+)$/);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.method, undefined, "member review is read-only");
    signals.push(options.signal);
    return respond(url);
  }
});
const settle = () => new Promise(resolve => setImmediate(resolve));
assert.equal(fetched.length, 0, "no private request before owner confirmation");
listeners["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
assert.equal(elements.ownerMembers.hidden, false);
assert.ok(elements.memberDirectory.text().includes(`Member ${malicious}`), "names stay literal text");
assert.ok(!elements.memberDirectory.find(child => child.tag === "img"));
assert.match(elements.memberDirectory.text(), /2 requests \(2 open\)/);
assert.match(elements.memberPages.text(), /Not linked to any member/);
assert.match(elements.memberStatus.text(), /not a total count/);
const button = elements.memberDirectory.find(child => child.tag === "button");
button.listeners.click();
await settle();
const detailText = elements.memberDetail.text();
assert.ok(detailText.includes(`Help ${malicious}`));
assert.match(detailText, /page history is not known/);
assert.match(detailText, /\/track-drops\//);
assert.match(detailText, /Track Drops email: not opted in/);
assert.match(detailText, /not newsletter consent/);
assert.match(detailText, /not linked to member accounts/);
assert.match(detailText, /Opted-in listening reports/);
assert.doesNotMatch(detailText, /Private staff note|token=secret/);
assert.ok(!elements.memberDetail.find(child => child.tag === "img"));

// Sign-out while a detail request is pending: aborted and late data ignored.
respond = () => new Promise(resolve => { pending = resolve; });
button.listeners.click();
elements.identityButton.listeners.click();
assert.equal(signals.at(-1).aborted, true);
pending(Response.json(activityBody));
await settle();
assert.equal(elements.ownerMembers.hidden, true);
assert.equal(elements.memberDirectory.children.length, 0);
assert.doesNotMatch(elements.memberDetail.text(), /Help|@example/, "late responses must not restore signed-out member data");

// Auth change while directory is pending.
respond = () => new Promise(resolve => { pending = resolve; });
listeners["halo-owner-operations"]({ detail: { authorized: true } });
authChange("logout", null);
assert.equal(signals.at(-1).aborted, true);
pending(Response.json(directoryBody));
await settle();
assert.equal(elements.memberDirectory.children.length, 0);
assert.equal(elements.memberPages.children.length, 0);

// Owner authorization loss (403) clears the panel.
respond = () => Promise.resolve(new Response(null, { status: 403 }));
listeners["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
assert.equal(elements.ownerMembers.hidden, true);
assert.equal(elements.memberDirectory.children.length, 0);
respond = url => Promise.resolve(Response.json(url.includes("view=members") ? directoryBody : activityBody));
listeners["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
listeners["halo-owner-operations"]({ detail: { authorized: false } });
assert.equal(elements.ownerMembers.hidden, true);
assert.equal(elements.memberDirectory.children.length, 0);

console.log("Owner member activity privacy, attribution, request ownership, API and rendering contracts passed.");
