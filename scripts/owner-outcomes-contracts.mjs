import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { loadOwnerOutcomes, outcomeRate } from "../netlify/lib/owner-outcomes.mjs";
import { isOwner } from "../netlify/lib/halo-x.mjs";
import { allowedEvents, cleanMetadata } from "../netlify/lib/stats.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [api, client, page, shop] = await Promise.all([
  read("netlify/functions/halo-control-center.mjs"), read("owner-outcomes.js"),
  read("halo-command.html"), read("music/music.js")
]);
const owner = { id: "owner", app_metadata: { roles: ["halo-owner"] } };
const now = new Date("2026-11-10T08:00:00Z");
const queries = [];
const fixture = {
  creators: { projects: 4, prepared: 1 },
  listeners: { previous_listeners: 3, current_listeners: 5, returning_listeners: 2 },
  playback: { attempts: 8, ready: 4, failed: 3, unknown: 2 },
  operations: { open_issues: 5, new_issues: 3, scheduled_issues: 1, healed_issues: 2 }
};
function database(fail = "") {
  return { async sql(strings, ...values) {
    const query = strings.join("?");
    queries.push({ query, values });
    assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
    const key = query.includes("halo_release_house_projects") ? "creators"
      : query.includes("halo_listening_sessions") ? "listeners"
        : query.includes("analytics_events") ? "playback" : "operations";
    if (fail === key) throw new Error("private SQL details");
    if (key === "listeners") {
      assert.match(query, /p.enabled = TRUE AND p.consent_at IS NOT NULL AND s.started_at >= p.consent_at/);
      assert.match(query, /previous_week AND current_week/);
      assert.doesNotMatch(query, /analytics_events|halo_memberships|email/);
    }
    if (key === "playback") {
      assert.match(query, /e.anonymous_id = a.anonymous_id/);
      assert.match(query, /GROUP BY anonymous_id, metadata->>'play_id'/);
      assert.match(query, /NOT COALESCE\(ready, FALSE\) AND NOT COALESCE\(failed, FALSE\)/);
    }
    return [fixture[key]];
  } };
}
assert.equal(outcomeRate(0, 0), null, "no denominator is not a zero or perfect rate");
assert.equal(outcomeRate(1, 3), 33.3);
assert.equal(outcomeRate(0, 4), 0);
assert.equal(outcomeRate(4, 4), 100);
for (const user of [null, { id: "member", user_metadata: { roles: ["owner"] } }]) {
  await assert.rejects(loadOwnerOutcomes(database(), user, now), /Owner access/);
}
assert.equal(queries.length, 0, "library authorization precedes database reads");
const outcomes = await loadOwnerOutcomes(database(), owner, now);
assert.equal(queries.length, 4);
assert.equal(outcomes.window.start, "2026-11-03T08:00:00.000Z");
assert.equal(outcomes.window.previousStart, "2026-10-27T08:00:00.000Z");
assert.equal(outcomes.sources.creators.metrics.preparationRate, 25);
assert.equal(outcomes.sources.listeners.metrics.returnRate, 66.7);
assert.equal(outcomes.sources.playback.metrics.startRate, 50);
assert.equal(outcomes.sources.playback.metrics.unknown, 2);
assert.doesNotMatch(JSON.stringify(outcomes), /member_id|anonymous_id|play_id|email/);
const originalError = console.error;
const logs = [];
console.error = message => logs.push(message);
try {
  for (const key of Object.keys(fixture)) {
    const partial = await loadOwnerOutcomes(database(key), owner, now);
    assert.deepEqual(partial.sources[key], { status: "unavailable", metrics: null });
    assert.equal(Object.values(partial.sources).filter(s => s.status === "available").length, 3);
  }
} finally {
  console.error = originalError;
}
assert.equal(logs.length, 4);
assert.ok(logs.every(log => !log.includes("private SQL details")));

// Exercise the real route with external services replaced.
function route(user) {
  const calls = { db: 0 };
  const context = {
    Response, URL, Buffer, console, isOwner, loadOwnerOutcomes,
    getUser: async () => user,
    getDatabase: () => { calls.db++; return database(); },
    loadControlCenter: async () => ({ pulse: {} })
  };
  vm.runInNewContext(api.replace(/^import .*;\n/gm, "")
    .replace("export default async function", "async function")
    .replace("export const config", "const config") + "\nthis.handler = haloControlCenterHandler;", context);
  return { handler: context.handler, calls };
}
for (const user of [null, { id: "member", user_metadata: { roles: ["owner"] } }, owner]) {
  const current = route(user);
  for (const method of ["GET", "HEAD", "POST", "PUT"]) {
    const response = await current.handler(new Request("https://halo.test/api/halo-control-center?view=outcomes", { method }));
    const expected = method === "PUT" ? 405 : !user ? 401 : user !== owner ? 403 : method === "POST" ? 405 : method === "HEAD" ? 204 : 200;
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (expected === 200) assert.ok((await response.json()).outcomes.sources);
  }
  assert.equal(current.calls.db, user === owner ? 1 : 0);
}
assert.match(page, /id="ownerOutcomes"[^>]*hidden/);
assert.match(page, /src="\/owner-outcomes.js"/);
assert.doesNotMatch(client, /innerHTML|localStorage|sessionStorage|sendBeacon/);

class Element {
  constructor() { this.children = []; this.textContent = ""; this.hidden = false; this.listeners = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
  text() { return this.textContent + this.children.map(child => child.text()).join("\n"); }
}
const ids = ["ownerOutcomes", "outcomeSources", "outcomeStatus", "outcomeRefresh", "outcomeTitle", "identityButton"];
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
elements.ownerOutcomes.hidden = true;
const events = {};
const requests = [];
let authChange;
let respond = async () => Response.json({ outcomes });
vm.runInNewContext(client, {
  document: { getElementById: id => elements[id], createElement: () => new Element() },
  window: {
    location: { hash: "#ownerOutcomes" },
    addEventListener: (name, callback) => { events[name] = callback; },
    haloIdentity: { onAuthChange(callback) { authChange = callback; } }
  },
  AbortController, setTimeout, clearTimeout, Date,
  fetch: (url, options) => {
    assert.equal(url, "/api/halo-control-center?view=outcomes");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    requests.push(options);
    return respond();
  }
});
const settle = () => new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 0);
events.hashchange();
assert.equal(elements.ownerOutcomes.scrolled, undefined, "private anchor cannot reveal the panel before authorization");
events["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
assert.equal(elements.ownerOutcomes.scrolled, true, "deep link must scroll after the owner-only panel becomes visible");
assert.equal(elements.outcomeTitle.focused, true, "deep link must focus the accessible dashboard heading");
assert.equal(elements.outcomeSources.children.length, 4);
assert.match(elements.outcomeSources.text(), /1 \/ 4 new projects prepared \(25%\)/);
assert.match(elements.outcomeSources.text(), /2 \/ 3 prior-week listeners returned \(66.7%\)/);
assert.match(elements.outcomeSources.text(), /4 \/ 8 attempts reached playing \(50%\)/);
assert.match(elements.outcomeSources.text(), /Not measured: whether artists finished without help/);
assert.match(elements.outcomeSources.text(), /Not proven: detection before any user was affected/);
assert.match(elements.outcomeStatus.text(), /Recorded evidence/);
const partial = structuredClone(outcomes);
partial.sources.listeners = { status: "unavailable", metrics: null };
respond = async () => Response.json({ outcomes: partial });
elements.outcomeRefresh.listeners.click();
await settle();
assert.match(elements.outcomeStatus.text(), /Partial coverage/);
assert.match(elements.outcomeSources.text(), /Unavailable - this source could not be read/);
respond = async () => Response.json({}, { status: 503 });
elements.outcomeRefresh.listeners.click();
await settle();
assert.equal(elements.outcomeSources.children.length, 0, "errors clear stale results");
assert.match(elements.outcomeStatus.text(), /Outcome review unavailable/);
let late;
respond = () => new Promise(resolve => { late = resolve; });
elements.outcomeRefresh.listeners.click();
authChange();
assert.equal(requests.at(-1).signal.aborted, true);
late(Response.json({ outcomes }));
await settle();
assert.equal(elements.ownerOutcomes.hidden, true);
assert.equal(elements.outcomeSources.children.length, 0, "late data cannot restore a signed-out panel");
elements.ownerOutcomes.scrolled = false;
events.hashchange();
assert.equal(elements.ownerOutcomes.scrolled, false, "hash changes cannot reopen the signed-out panel");
respond = async () => Response.json({}, { status: 403 });
events["halo-owner-operations"]({ detail: { authorized: true } });
await settle();
assert.equal(elements.ownerOutcomes.hidden, true);

// Shop reliability measures intent -> real media playing, not play() promise resolution.
const recorded = [];
class AudioStub {
  constructor() { this.events = {}; this.paused = true; }
  addEventListener(name, callback) { this.events[name] = callback; }
  play() { return this.nextPlay || Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
}
const context = {
  Audio: AudioStub, document: {},
  window: { crypto: { randomUUID }, haloStats: { track: (event, metadata) => recorded.push({ event, metadata }) } },
  formatAudioStreamUrl: url => url || ""
};
const classSource = shop.match(/  class HaloGlobalPlayer \{[\s\S]*?\n  \}/)?.[0];
assert.ok(classSource);
vm.runInNewContext(classSource + "\nthis.Player = HaloGlobalPlayer;", context);
const player = new context.Player();
player.renderBar = () => {};
player.syncButtons = () => {};
player.track = { id: "one", src: "https://halo.test/one.mp3" };
player.resume();
assert.equal(recorded.length, 1);
assert.equal(recorded[0].event, "shop_playback_attempt");
await settle();
assert.equal(recorded.length, 1, "resolved play() alone does not count as playing");
player.audio.events.playing();
player.audio.events.playing();
player.fail("failed after start");
player.fail("duplicate failure");
assert.deepEqual(recorded.map(item => item.event), ["shop_playback_attempt", "shop_playback_ready", "shop_playback_failed"]);
assert.equal(new Set(recorded.map(item => item.metadata.play_id)).size, 1);
assert.ok(recorded.every(item => Object.keys(item.metadata).join() === "play_id"), "health reports contain no URLs or member identities");
player.audio.nextPlay = Promise.reject(new Error("network"));
player.resume();
await settle();
assert.equal(recorded.at(-1).event, "shop_playback_failed");
assert.notEqual(recorded.at(-1).metadata.play_id, recorded[0].metadata.play_id);
player.audio.nextPlay = Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
player.resume();
await settle();
assert.equal(recorded.at(-1).event, "shop_playback_attempt", "cancellation is unknown, not a transport failure");
const length = recorded.length;
player.close();
player.audio.events.error();
assert.equal(recorded.length, length, "closing a player cannot emit a false failure");
context.window.crypto = undefined;
player.track = { id: "legacy", src: "https://halo.test/legacy.mp3" };
player.audio.nextPlay = Promise.resolve();
player.resume();
assert.equal(recorded.at(-1).event, "shop_playback_attempt", "telemetry cannot require randomUUID support to play music");
assert.ok(recorded.at(-1).metadata.play_id);
for (const name of ["shop_playback_attempt", "shop_playback_ready", "shop_playback_failed"]) assert.ok(allowedEvents.has(name));
assert.deepEqual(cleanMetadata({ play_id: "abc", private_url: "secret" }), { play_id: "abc" });
console.log("Owner outcome contracts passed: aggregate measures, owner-only route, missing data, auth races and observed shop playback.");
