import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { watchersForPage, canonicalizeWatcherTarget } from "../lib/watcher-registry.js";

const monitor = await readFile(new URL("../site-monitor.js", import.meta.url), "utf8");
const deck = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");

function extractFunctionSource(name) {
  const start = monitor.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name} in the maintenance monitor`);
  const functionStart = monitor.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
  const braceStart = monitor.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < monitor.length; index += 1) {
    if (monitor[index] === "{") depth += 1;
    if (monitor[index] === "}" && --depth === 0) return monitor.slice(functionStart, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function makeLink(href, options = {}) {
  const attributes = new Map([["href", href]]);
  return {
    tagName: "A",
    dataset: {},
    textContent: options.text || "",
    getClientRects() { return [{}]; },
    matches() { return false; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    get attributes() { return attributes; }
  };
}

function createContext({ links = [], controls = [], registry = [], recorderState = "" } = {}) {
  const events = [];
  const requests = [];
  const document = {
    images: [],
    getElementById() { return null; },
    querySelector(selector) {
      if (selector === "#recorderGuard") return recorderState ? { dataset: { state: recorderState } } : null;
      return controls.find(control => control.selector === selector)?.element || null;
    },
    querySelectorAll(selector) {
      if (selector === "a[href]") return links.filter(link => link.getAttribute("href") !== null);
      if (selector === "a") return links;
      if (selector === "button,a,input,select,textarea") return [...controls.map(control => control.element), ...links];
      return [];
    }
  };
  const window = {
    location: { origin: "https://halo.test", pathname: "/dj-deck.html" },
    __haloAudioHealth: null,
    dispatchEvent(event) { events.push(event); }
  };
  const context = vm.createContext({
    URL,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window,
    document,
    submittedFindings: new Set(),
    runtimeIssues: [],
    resourceIssues: [],
    navigator: { onLine: true },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ accepted: true }) };
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    loadWatcherRegistryModule: async () => ({
      available: true,
      watchersForPage: () => registry,
      canonicalize: canonicalizeWatcherTarget
    }),
    STATUS_RANK: { green: 0, yellow: 1, red: 2 },
    STATUS_LABEL: { green: "WORKING", yellow: "ATTENTION", red: "BROKEN" },
    normalizeWatcherState(status) { return ["green", "yellow", "red"].includes(status) ? status : "red"; }
  });
  return { context, document, window, events, requests };
}

function expose(context, names) {
  vm.runInContext(`${names.map(name => extractFunctionSource(name)).join("\n\n")}\n${names.map(name => `this.${name} = ${name};`).join("\n")}`, context);
}

const helperContext = createContext().context;
expose(helperContext, ["isSafeLinkDestination", "quarantineLink", "hasAccessibleControlName", "visible"]);
assert.equal(helperContext.isSafeLinkDestination(null), false, "null links fail closed");
assert.equal(helperContext.isSafeLinkDestination(" javascript:alert(1)"), false, "script URLs fail closed case-insensitively");
assert.equal(helperContext.isSafeLinkDestination("data:text/html,unsafe"), false, "data URLs fail closed");
assert.equal(helperContext.isSafeLinkDestination("#"), false, "placeholder links fail closed");
assert.equal(helperContext.isSafeLinkDestination("/halo-live.html"), true, "local routes remain safe");
assert.equal(helperContext.isSafeLinkDestination("https://halo.world/"), true, "HTTPS links remain available");
assert.equal(helperContext.isSafeLinkDestination("https://user@example.test/"), false, "credential-bearing links fail closed");
assert.equal(helperContext.visible(null), false, "missing nodes do not crash visibility checks");
assert.equal(helperContext.hasAccessibleControlName({ textContent: "Play", getAttribute: () => null }), true);
assert.equal(helperContext.hasAccessibleControlName({ textContent: "", getAttribute: () => null }), false, "unnamed controls are detected");

const unsafeLink = makeLink("javascript:alert(1)");
helperContext.quarantineLink(unsafeLink);
assert.equal(unsafeLink.getAttribute("href"), null, "unsafe destinations are removed");
assert.equal(unsafeLink.getAttribute("aria-disabled"), "true", "quarantined links are identified as disabled");

const routeWatcher = {
  id: "dj-deck-header-live",
  label: "HALO Live (DJ deck header)",
  selector: ".missing-live-link",
  target: "/halo-live.html",
  ownerAgent: "Routing Agent"
};
const reboundLink = makeLink("/halo-live");
const reboundFixture = createContext({ links: [reboundLink], registry: [routeWatcher] });
expose(reboundFixture.context, ["isSafeLinkDestination", "quarantineLink", "runWatcherChecks"]);
const reboundDash = await reboundFixture.context.runWatcherChecks();
assert.equal(reboundDash.status, "green", "a unique canonical link can rebind a stale selector");
assert.equal(reboundDash.watchers[0].action, "rebound");

const staleLink = makeLink("/wrong-local-route");
const repairFixture = createContext({
  controls: [{ selector: routeWatcher.selector, element: staleLink }],
  registry: [routeWatcher]
});
expose(repairFixture.context, ["isSafeLinkDestination", "quarantineLink", "runWatcherChecks"]);
const repairedDash = await repairFixture.context.runWatcherChecks();
assert.equal(staleLink.getAttribute("href"), "/halo-live.html", "known safe local watcher links self-repair to the trusted registry target");
assert.equal(repairedDash.status, "green");
assert.equal(repairedDash.repairs.length, 1);
expose(repairFixture.context, ["safeResource", "journalControlRoomEvent", "reportFindings"]);
const repairedReport = { dataset: {}, textContent: "" };
await repairFixture.context.reportFindings([], repairedReport, repairedDash);
assert.match(repairedReport.textContent, /auto-repaired and verified\. No remaining risk/);
assert.equal(repairFixture.events.find(event => event.type === "halo:journal-event")?.detail?.eventType, "qa_repair", "verified repairs are recorded in the existing audit stream");

const unsafeWatcherLink = makeLink("javascript:alert(1)", { text: "HALO Live" });
const unsafeFixture = createContext({
  controls: [{ selector: routeWatcher.selector, element: unsafeWatcherLink }],
  links: [unsafeWatcherLink],
  registry: [routeWatcher]
});
expose(unsafeFixture.context, ["isSafeLinkDestination", "quarantineLink", "runWatcherChecks"]);
const escalatedDash = await unsafeFixture.context.runWatcherChecks();
assert.equal(unsafeWatcherLink.getAttribute("href"), null, "unsafe watcher links are quarantined");
assert.equal(escalatedDash.watchers[0].action, "escalated", "unsafe watcher links are escalated rather than rewritten");
assert.equal(escalatedDash.status, "red");
expose(unsafeFixture.context, ["isSafeLinkDestination", "quarantineLink", "hasAccessibleControlName", "visible", "runChecks", "safeResource", "journalControlRoomEvent", "reportFindings"]);
const unsafeFindings = await unsafeFixture.context.runChecks();
assert.ok(unsafeFindings.some(check => check.watcherId === routeWatcher.id && check.action === "escalated"));
const unsafeReport = { dataset: {}, textContent: "" };
await unsafeFixture.context.reportFindings(unsafeFindings, unsafeReport, unsafeFixture.window.__haloDashAI);
const escalationEvent = unsafeFixture.events.find(event => event.type === "halo:journal-event" && event.detail?.eventType === "qa_issue");
assert.equal(escalationEvent?.detail?.details?.outcome, "escalated");
assert.equal(unsafeFixture.requests[0]?.url, "/api/issues", "unhealed watcher issues reuse the existing maintenance queue");
assert.equal(JSON.parse(unsafeFixture.requests[0].options.body).metadata.watcherId, routeWatcher.id, "maintenance reports retain watcher context");

assert.equal(canonicalizeWatcherTarget("/halo-live"), "/halo-live.html", "watcher legacy aliases resolve to the registry's canonical target");
assert.equal(canonicalizeWatcherTarget("/halo-x"), "/halo-x.html");
assert.ok(monitor.includes("function hasAccessibleControlName"));
assert.ok(monitor.includes("Watcher registry could not be loaded; route checks fail closed."));
assert.ok(monitor.includes('outcome: "healed_and_verified"'));
assert.ok(monitor.includes("watcherSelector"));
assert.ok(monitor.includes("Recorder Safety Guard"));
assert.ok(monitor.includes("Healthy · ${checks.length} checks passed"));
assert.match(deck, /src="\/site-monitor\.js" defer/);
assert.match(deck, /id="recorderGuard" data-state="secure"/);
assert.match(deck, /data-status="checking"[^>]*><span/);
assert.match(monitor, /has-maintenance-dock \.halo-qa-launcher/);

const unlabeledControl = {
  tagName: "BUTTON",
  textContent: "",
  value: "",
  getClientRects() { return [{}]; },
  matches() { return false; },
  getAttribute() { return null; }
};
const pageLink = makeLink("/safe", { text: "Safe destination" });
const genericUnsafeLink = makeLink("#", { text: "Unsafe placeholder" });
const scanFixture = createContext({
  controls: [{ element: unlabeledControl }],
  links: [pageLink, genericUnsafeLink],
  recorderState: "triggered"
});
scanFixture.context.runWatcherChecks = async () => ({
  status: "green",
  statusLabel: "WORKING",
  watcherCount: 0,
  issueCount: 0,
  watchers: [],
  repairs: []
});
expose(scanFixture.context, ["isSafeLinkDestination", "quarantineLink", "hasAccessibleControlName", "visible", "runChecks"]);
const findings = await scanFixture.context.runChecks();
assert.equal(genericUnsafeLink.getAttribute("href"), null, "unsafe page links are disabled during checks");
assert.ok(findings.some(check => check.name === "Interaction Tester" && check.count === 1), "unnamed controls are detected");
assert.ok(findings.some(check => check.name === "Navigation Tester" && check.count === 1), "unsafe links are escalated");
assert.ok(findings.some(check => check.name === "Recorder Safety Guard" && check.count === 1), "recorder risk is surfaced in the DJ control room");

const healthyFixture = createContext();
expose(healthyFixture.context, ["isSafeLinkDestination", "quarantineLink", "hasAccessibleControlName", "visible", "runWatcherChecks", "runChecks", "safeResource", "journalControlRoomEvent", "reportFindings"]);
const healthyChecks = await healthyFixture.context.runChecks();
const healthyStatus = healthyFixture.events.find(event => event.type === "halo:control-room-update")?.detail;
assert.equal(healthyStatus.status, "healthy", "healthy state remains quiet and is not escalated");
assert.equal(healthyStatus.issueCount, 0);
const healthyReport = { dataset: {}, textContent: "" };
await healthyFixture.context.reportFindings(healthyChecks, healthyReport, healthyFixture.window.__haloDashAI);
assert.match(healthyReport.textContent, /Healthy · .*checks passed/);
assert.equal(healthyFixture.events.some(event => event.type === "halo:journal-event"), false, "a healthy scan emits no maintenance alert");

console.log("DJ control-room contracts: null safety, safe links, watcher repair/rebinding, escalation, and deck wiring passed.");
