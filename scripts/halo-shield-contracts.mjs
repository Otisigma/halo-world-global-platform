import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { createShieldHandler, publicShieldStatus } from "../netlify/lib/halo-shield.mjs";
import { allowedEvents, authorizeStatsAdmin } from "../netlify/lib/stats.mjs";
import { PUBLIC_ROUTE_REGISTRY } from "../lib/route-registry.js";

const now = Date.parse("2026-10-18T06:00:00Z");
const snapshot = {
  windowStart: "2026-10-18T05:59:00Z",
  observedAt: "2026-10-18T06:00:00Z",
  outcomes: { protected: true, healthy: true, blocked: 12, isolated: 3, privateRule: "not public" },
  telemetry: { trace: ["private-route"], score: 99, fingerprint: "synthetic-private-marker" },
  unexpected: "must not leak"
};
let stored = structuredClone(snapshot);
let reads = 0;
let writes = 0;
const store = {
  async get() { reads++; return stored; },
  async setJSON(key, value) { assert.equal(key, "latest"); writes++; stored = value; }
};
const publicHandler = createShieldHandler({ getStore: () => store, now: () => now });
const previousToken = process.env.STATS_ADMIN_TOKEN;
const credential = randomBytes(32).toString("hex");
process.env.STATS_ADMIN_TOKEN = credential;
const internalHandler = createShieldHandler({
  getStore: () => store, authorize: authorizeStatsAdmin, internal: true, now: () => now
});
const request = (path = "", options = {}) => new Request(`https://halo.test/api/halo-shield${path}`, options);
const auth = { Authorization: ["Bearer", credential].join(" ") };

try {
  const response = await publicHandler(request("?admin=true&include=telemetry", { headers: auth }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.deepEqual(result, {
    brand: "Halo Shield", service: "Halo Music", verification: "verified",
    windowStart: new Date(snapshot.windowStart).toISOString(), observedAt: new Date(snapshot.observedAt).toISOString(),
    outcomes: { protected: true, healthy: true, blocked: 12, isolated: 3 }
  });
  assert.doesNotMatch(JSON.stringify(result), /private|score|fingerprint|unexpected|trace/);
  const before = reads;
  for (const headers of [{}, { Authorization: "******" }]) {
    for (const method of ["GET", "POST"]) {
      const denied = await internalHandler(request("/internal", { method, headers }));
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control"), "no-store");
    }
  }
  delete process.env.STATS_ADMIN_TOKEN;
  assert.equal((await internalHandler(request("/internal", { headers: auth }))).status, 401);
  assert.equal(reads, before);
  assert.equal(writes, 0);
  process.env.STATS_ADMIN_TOKEN = credential;
  const privateResponse = await internalHandler(request("/internal", { headers: auth }));
  assert.deepEqual((await privateResponse.json()).snapshot, snapshot);
  assert.equal(privateResponse.headers.get("cache-control"), "no-store");
  assert.equal((await publicHandler(request("", { method: "POST" }))).status, 405);
  assert.equal((await internalHandler(request("/internal", { method: "DELETE", headers: auth }))).status, 405);

  async function post(body, expected) {
    const response = await internalHandler(request("/internal", {
      method: "POST", headers: auth, body: typeof body === "string" ? body : JSON.stringify(body)
    }));
    assert.equal(response.status, expected);
  }
  await post(snapshot, 202);
  assert.deepEqual(stored.telemetry, snapshot.telemetry);
  for (const body of [
    "{", null, {}, { ...snapshot, observedAt: "not a date" },
    { ...snapshot, windowStart: "2026-10-18T07:00:00Z" },
    { ...snapshot, observedAt: "2026-10-18T06:01:00Z" },
    { ...snapshot, observedAt: "2026-10-18T05:50:00Z", windowStart: "2026-10-18T05:49:00Z" },
    ...[-1, 1.5, "12", Number.MAX_SAFE_INTEGER + 1].map(blocked => ({
      ...snapshot, outcomes: { ...snapshot.outcomes, blocked }
    })),
    { ...snapshot, outcomes: { ...snapshot.outcomes, protected: "true" } }
  ]) await post(body, 400);
  await post("x".repeat(65537), 413);
  assert.equal(writes, 1);

  for (const value of [null, {}, { ...snapshot, observedAt: "bad" }]) {
    assert.equal(publicShieldStatus(value, now).verification, "unavailable");
  }
  const expired = publicShieldStatus(snapshot, now + 300001);
  assert.equal(expired.verification, "unavailable");
  assert.deepEqual(expired.outcomes, { protected: null, healthy: null, blocked: null, isolated: null });
  const negative = publicShieldStatus({ ...snapshot, outcomes: { protected: false, healthy: false, blocked: 0, isolated: 0 } }, now);
  assert.deepEqual(negative.outcomes, { protected: false, healthy: false, blocked: 0, isolated: 0 });
  const failure = createShieldHandler({ getStore() { throw new Error("private storage detail"); } });
  const unavailable = await failure(request());
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(JSON.stringify(await unavailable.json()), /storage|detail/);
} finally {
  if (previousToken === undefined) delete process.env.STATS_ADMIN_TOKEN;
  else process.env.STATS_ADMIN_TOKEN = previousToken;
}

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("halo-shield/index.html");
const css = read("halo-shield/shield.css");
const js = read("halo-shield/shield.js");
const home = read("halo.html");
assert.match(html, /Halo Shield/);
assert.match(html, /Halo Music/);
assert.match(html, /Awaiting verification/);
assert.match(html, /Clear protection status\.<br>Verified results, at a glance\./);
assert.match(html, /<dt>Threats contained<\/dt>/);
assert.doesNotMatch(html, /in-house defense|operational details|technology behind them/i);
assert.doesNotMatch(html + js, /fingerprint|splinter|tarpit|scoring|recursive|Bearer|internal|telemetry/i);
assert.match(css, /--shield-bg: #100d0b/);
assert.match(css, /--shield-panel: #211a16/);
assert.match(css, /--shield-cold: #a5c4cf/);
assert.match(css, /:focus-visible/);
assert.match(html, /class="shield-public" data-motion="paused"/);
assert.match(html, /class="shield-art" aria-hidden="true"/);
assert.match(html, /href="#main">Skip to content/);
assert.match(html, /id="motion-toggle"[^>]*aria-pressed="false" hidden>Ambient motion/);
assert.match(html, /<noscript>[\s\S]*No current protection status has been verified/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /animation: none !important; transition: none !important/);
assert.match(css, /\[data-motion="paused"\][^{]*\{ animation-play-state: paused/);
assert.doesNotMatch(js, /Math\.random|innerHTML|requestAnimationFrame/, "presentation must not fabricate or interpolate verified counts");
assert.match(read("music/index.html"), /href="\/halo-shield\/"/);
assert.ok(PUBLIC_ROUTE_REGISTRY.some(({ route, file, menuLabel }) =>
  route === "/halo-shield/" && file === "halo-shield/index.html" && menuLabel === "HALO SHIELD"
), "Halo Shield must participate in menu health checks");
assert.match(read("netlify.toml"), /from = "\/netlify\/\*"\s+to = "\/404.html"\s+status = 404\s+force = true/);
const homePromotion = home.match(/<section(?=[^>]*aria-labelledby="halo-shield-promo-title")[\s\S]*?<\/section>/)?.[0];
assert.ok(homePromotion, "homepage must include an accessible Halo Shield promotion card");
assert.match(homePromotion, /href="\/halo-shield\/"/, "homepage promotion must link to Halo Shield");
assert.match(homePromotion, /current protection status and verified results/i, "homepage promotion must focus on visible results");
assert.doesNotMatch(homePromotion, /fingerprint|splinter|tarpit|scoring|recursive|telemetry|internal/i, "homepage promotion must not disclose internal mechanics");
const careMenu = home.match(/<section[^>]*aria-labelledby="halo-lane-care"[\s\S]*?<\/section>/)?.[0];
assert.ok(careMenu, "homepage must retain its Care menu");
const shieldMenuLink = careMenu.match(/<a href="\/halo-shield\/"[\s\S]*?<\/a>/)?.[0];
assert.ok(shieldMenuLink, "Care must link directly to public Halo Shield");
for (const surface of [shieldMenuLink, homePromotion]) {
  assert.match(surface, /View protection status/, "Shield entry points must use a consistent CTA");
  assert.match(surface, /data-stat-event="open_halo_shield"/);
  assert.doesNotMatch(surface, /\/admin|\/api\/|DistroKid|affiliate|referral/i);
}
assert.match(shieldMenuLink, /renderMenuStatusBadge\('\/halo-shield\/', 'Halo Shield'\)/);
const statusTargets = home.match(/const MENU_STATUS_GROUP_TARGETS = \[([\s\S]*?)\];/)?.[1];
assert.match(statusTargets, /route: '\/halo-shield\/', label: 'HALO SHIELD'/);
assert.ok(allowedEvents.has("open_halo_shield"), "Shield discovery analytics must be allowlisted");

const elements = new Map();
const publicHandlers = {};
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    textContent: "", dataset: {}, attributes: {},
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { publicHandlers[`${id}:${name}`] = callback; }
  });
  return elements.get(id);
};
let payload = publicShieldStatus(snapshot, Date.now());
let expiryCallback;
const motionPreference = {
  matches: false,
  addEventListener(name, callback) { publicHandlers[`motion:${name}`] = callback; }
};
const browser = {
  document: { getElementById: element, body: { dataset: {} } },
  window: { matchMedia: () => motionPreference },
  fetch: async (url, options) => {
    assert.equal(url, "/api/halo-shield");
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => payload };
  },
  AbortSignal, Date, setInterval() {},
  setTimeout(callback) { expiryCallback = callback; }, clearTimeout() {}
};
vm.createContext(browser);
vm.runInContext(js, browser);
await new Promise(resolve => setImmediate(resolve));
assert.equal(element("motion-toggle").hidden, false);
assert.equal(element("motion-toggle").getAttribute("aria-pressed"), "true");
publicHandlers["motion-toggle:click"]();
assert.equal(browser.document.body.dataset.motion, "paused");
assert.equal(element("motion-toggle").getAttribute("aria-pressed"), "false");
publicHandlers["motion-toggle:click"]();
assert.equal(browser.document.body.dataset.motion, "playing");
motionPreference.matches = true;
publicHandlers["motion:change"]();
assert.equal(browser.document.body.dataset.motion, "paused");
assert.equal(element("motion-toggle").getAttribute("aria-pressed"), "false");
await vm.runInContext("loadStatus()", browser);
assert.equal(element("protected").textContent, "Awaiting verification");
assert.equal(element("status-panel").dataset.state, "awaiting");
payload = publicShieldStatus({ ...snapshot, windowStart: new Date(Date.now() - 60000).toISOString(), observedAt: new Date().toISOString() });
await vm.runInContext("loadStatus()", browser);
assert.equal(element("protected").textContent, "Protected");
assert.equal(element("healthy").textContent, "Healthy");
assert.equal(element("blocked").textContent, "12");
assert.equal(element("status-panel").dataset.state, "verified");
assert.equal(element("status-panel").getAttribute("aria-busy"), "false");
expiryCallback();
assert.equal(element("protected").textContent, "Awaiting verification");
assert.equal(element("status-panel").dataset.state, "awaiting");
assert.equal(element("blocked").textContent, "—");
for (const outcomes of [
  { protected: false, healthy: false, blocked: 0, isolated: 0 },
  { protected: true, healthy: true, blocked: -1, isolated: 0 },
  { protected: true, healthy: true, blocked: 1.5, isolated: 0 }
]) {
  payload = { ...payload, outcomes };
  await vm.runInContext("loadStatus()", browser);
  assert.equal(element("protected").textContent, outcomes.blocked === 0 ? "Not confirmed" : "Awaiting verification");
  assert.equal(element("blocked").textContent, outcomes.blocked === 0 ? "0" : "—");
}
let finishStatus;
let statusRequests = 0;
browser.fetch = () => {
  statusRequests++;
  return new Promise(resolve => { finishStatus = resolve; });
};
const pendingStatus = vm.runInContext("loadStatus()", browser);
assert.equal(element("refresh").disabled, true);
assert.equal(element("refresh-label").textContent, "Checking status…");
assert.equal(element("status-panel").getAttribute("aria-busy"), "true");
await vm.runInContext("loadStatus()", browser);
assert.equal(statusRequests, 1, "refresh and polling must not overlap");
finishStatus({ ok: false });
await pendingStatus;
assert.equal(element("refresh-label").textContent, "Refresh status");
assert.equal(element("status-panel").getAttribute("aria-busy"), "false");
browser.fetch = async () => { throw new Error("Offline"); };
await vm.runInContext("loadStatus()", browser);
assert.equal(element("blocked").textContent, "—");
assert.equal(element("refresh").disabled, false);
assert.doesNotMatch(read("halo-shield/admin.js"), /localStorage|sessionStorage|innerHTML/);
assert.match(read("netlify/functions/halo-shield.mjs"), /path: "\/api\/halo-shield"/);
assert.match(read("netlify/functions/halo-shield-internal.mjs"), /authorize: authorizeStatsAdmin/);
assert.match(read("netlify/functions/halo-shield-internal.mjs"), /internal: true/);

const operatorElements = new Map();
const operatorElement = id => {
  if (!operatorElements.has(id)) operatorElements.set(id, { value: "", textContent: "", hidden: true, addEventListener() {} });
  return operatorElements.get(id);
};
const handlers = {};
operatorElement("operator-form").addEventListener = (name, callback) => { handlers[name] = callback; };
operatorElement("clear-report").addEventListener = (name, callback) => { handlers.clear = callback; };
let operatorFetch;
const operatorBrowser = {
  document: { getElementById: operatorElement, addEventListener(name, callback) { handlers[name] = callback; } },
  window: { addEventListener() {} }, AbortController,
  fetch: (...args) => operatorFetch(...args),
  setTimeout() {}, clearTimeout() {}
};
vm.createContext(operatorBrowser);
vm.runInContext(read("halo-shield/admin.js"), operatorBrowser);
operatorElement("operator-token").value = credential;
operatorFetch = async (url, options) => {
  assert.equal(url, "/api/halo-shield/internal");
  assert.equal(options.headers.Authorization, ["Bearer", credential].join(" "));
  assert.equal(operatorElement("operator-token").value, "");
  return { ok: true, json: async () => ({ snapshot }) };
};
await handlers.submit({ preventDefault() {} });
assert.equal(operatorElement("operator-report").hidden, false);
assert.deepEqual(JSON.parse(operatorElement("operator-report").textContent), snapshot);
handlers.clear();
assert.equal(operatorElement("operator-report").textContent, "");
assert.equal(operatorElement("operator-report").hidden, true);
operatorFetch = async () => ({ ok: false });
await handlers.submit({ preventDefault() {} });
assert.equal(operatorElement("operator-report").hidden, true);
assert.match(operatorElement("operator-status").textContent, /Access denied/);
let finishRead;
operatorFetch = () => new Promise(resolve => { finishRead = resolve; });
const pendingRead = handlers.submit({ preventDefault() {} });
handlers.clear();
finishRead({ ok: true, json: async () => ({ snapshot }) });
await pendingRead;
assert.equal(operatorElement("operator-report").textContent, "");
assert.equal(operatorElement("operator-report").hidden, true);
console.log("Halo Shield contracts passed: public allowlist, authenticated telemetry, validation, stale/failure states, UI and theme.");
