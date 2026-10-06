import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../halo-safe-text.js";
import {
  CONTROL_ROOM_HISTORY_KEY,
  FAILURE_TYPES,
  REPAIR_EVENT_LABELS,
  REPAIR_STATUS,
  classifyCheck,
  createControlRoom,
  createRepairEvent,
  describeControlRoomSurface,
  evaluateWatcher,
  isUnsafeHref,
  ownerAgentForFailure,
  summarizeRepairHistory
} from "../lib/dj-control-room.js";
import { DASH_FIX_AGENTS, HALO_BUTTON_WATCHER_REGISTRY, canonicalizeWatcherTarget, watchersForPage, watchersForRegion } from "../lib/watcher-registry.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [deck, monitor, packageJson] = await Promise.all([read("dj-deck.html"), read("site-monitor.js"), read("package.json")]);

// --- Minimal DOM fake covering the selectors the control room uses. ---
class FakeElement {
  constructor(tagName, attributes = {}, textContent = "", options = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = textContent;
    this.value = options.value;
    this.hidden = Boolean(options.hidden);
    this.parent = options.parent || null;
    this.children = [];
  }
  get id() { return this.attributes.get("id") || ""; }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  matches(selector) {
    if (selector === "a[href]") return this.tagName === "A" && this.hasAttribute("href");
    if (selector === 'input[type="hidden"],input[type="file"]') return this.tagName === "INPUT" && ["hidden", "file"].includes(this.getAttribute("type"));
    return false;
  }
  closest(selector) {
    let node = this.parent;
    while (node) {
      if (node.tagName === selector.toUpperCase()) return node;
      node = node.parent;
    }
    return null;
  }
  querySelector(selector) {
    if (selector === "img[alt]") return this.children.find(child => child.tagName === "IMG" && child.hasAttribute("alt")) || null;
    return null;
  }
}

class FakeDocument {
  constructor(elements) { this.elements = elements; }
  querySelectorAll(selector) {
    if (selector === "button,a,input,select,textarea") return this.elements.filter(element => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName));
    if (selector === "a[href]") return this.elements.filter(element => element.matches("a[href]"));
    if (selector === "[data-watcher-id]") return this.elements.filter(element => element.hasAttribute("data-watcher-id"));
    if (selector === "label[for]") return this.elements.filter(element => element.tagName === "LABEL" && element.hasAttribute("for"));
    return [];
  }
  querySelector(selector) {
    const watcherId = selector.match(/data-watcher-id="([^"]+)"/);
    if (watcherId) return this.elements.find(element => element.getAttribute("data-watcher-id") === watcherId[1]) || null;
    return null;
  }
  getElementById(id) { return this.elements.find(element => element.id === id) || null; }
}

function memoryStorage() {
  const store = new Map();
  return { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), store };
}

const isVisible = element => !element.hidden;
const djLocation = { pathname: "/dj-deck.html", origin: "https://halo.world" };

// 1. Null-safe text normalisation (root cause of the Runtime Watcher crash).
const { HaloSafeText } = globalThis;
assert.equal(HaloSafeText.lower(undefined), "");
assert.equal(HaloSafeText.lower(null, "Fallback"), "fallback");
assert.equal(HaloSafeText.upper(undefined), "");
assert.equal(HaloSafeText.lower(42), "42");
assert.equal(HaloSafeText.eventKey({}), "", "Autofill keydown events without event.key must not crash.");
assert.equal(HaloSafeText.eventKey(undefined), "");
assert.equal(HaloSafeText.eventKey({ key: "S" }), "s");

assert.match(deck, /<script src="\/halo-safe-text\.js"><\/script>\s*<script src="\/upload-progress\.js">/, "DJ deck must load shared safe-text helpers before its inline scripts.");
assert.match(deck, /const haloText = window\.HaloSafeText \|\|/, "DJ deck must bind the shared safe-text helpers with a local fallback.");
assert.doesNotMatch(deck, /winner\.track\.sonicWeather\.toLowerCase\(\)/, "Tracks imported from Drive or links have no sonicWeather; never lowercase it directly.");
assert.match(deck, /haloText\.lower\(winner\.track\.sonicWeather, TRACK_DNA_DEFAULTS\.sonicWeather\)/);
assert.doesNotMatch(deck, /event\.key\.toLowerCase\(\)/, "Keyboard shortcuts must tolerate keydown events without a key.");
assert.match(deck, /const key = haloText\.eventKey\(event\);/);
assert.doesNotMatch(deck, /document\.activeElement\.tagName/, "Keyboard shortcuts must tolerate a null activeElement.");
assert.doesNotMatch(deck, /takeoverSession\.name\.toLowerCase\(\)|mimeType\.toLowerCase\(\)|filter\.trim\(\)\.toLowerCase\(\)|deckId\.toLowerCase\(\)/, "DJ deck string normalisation must go through haloText.");

// 2. Navigation Tester: no placeholder links on the DJ deck.
assert.doesNotMatch(deck, /href="#"/, "DJ deck must not ship placeholder href=\"#\" links.");
assert.match(deck, /<a class="recording-download" id="recordingDownload" download>/, "Recording download link receives its href only when a recording exists.");
for (const href of ["#", "", "   ", "javascript:void(0)", " JavaScript:alert(1)", "java\tscript:alert(1)", "vbscript:x", "data:text/html,hi", undefined, null]) {
  assert.equal(isUnsafeHref(href), true, `isUnsafeHref must flag ${JSON.stringify(href)}`);
}
for (const href of ["/halo-live.html", "/mixes/", "https://halo.world/halo", "#section", "mailto:hi@halo.world"]) {
  assert.equal(isUnsafeHref(href), false, `isUnsafeHref must allow ${href}`);
}
assert.match(monitor, /cycle\?\.module\?\.isUnsafeHref/, "Navigation Tester must use the centralized unsafe-link validator.");

// 3. Watcher registry describes the full DJ deck header.
const header = watchersForRegion("dj-deck-header");
assert.deepEqual(
  header.map(({ id, target }) => [id, target]),
  [
    ["dj-deck-header-live", "/halo-live.html"],
    ["dj-deck-header-halo-x", "/halo-x.html"],
    ["dj-deck-header-mixes", "/mixes/"],
    ["dj-deck-header-dreamweaver", "/dreamweaver/"],
    ["dj-deck-header-portal", "/halo"]
  ],
  "DJ deck header watchers must describe every header route control."
);
assert.equal(header.find(watcher => watcher.id === "dj-deck-header-live").label, "HALO Live (DJ deck header)");
assert.equal(header.find(watcher => watcher.id === "dj-deck-header-halo-x").label, "DJ HALO X (DJ deck header)");
const topActions = deck.match(/<div class="top-actions">([\s\S]*?)<\/div>\s*<\/header>/);
assert.ok(topActions, "DJ deck header actions must exist.");
for (const watcher of header) {
  assert.ok(watcher.controlText, `${watcher.id} must declare controlText for fallback resolution.`);
  const anchor = topActions[1].match(new RegExp(`<a class="compact-button" href="([^"]+)"[^>]*data-watcher-id="${watcher.id}"[^>]*>([^<]+)</a>`));
  assert.ok(anchor, `DJ deck header must tag ${watcher.id} with data-watcher-id.`);
  assert.equal(canonicalizeWatcherTarget(anchor[1]), watcher.target, `${watcher.id} href must resolve to ${watcher.target}.`);
  assert.equal(anchor[2].trim(), watcher.controlText, `${watcher.id} control text must match the registry.`);
}
const description = describeControlRoomSurface("/dj-deck");
assert.equal(description.pageRoute, "/dj-deck.html");
assert.equal(description.surface, "dj-deck");
assert.equal(description.regions["dj-deck-header"].length, header.length);

// Pretty URL forms must resolve back to registry routes.
assert.equal(canonicalizeWatcherTarget("/dj-deck"), "/dj-deck.html");
assert.equal(canonicalizeWatcherTarget("/halo-live"), "/halo-live.html");
assert.equal(canonicalizeWatcherTarget("/halo.html"), "/halo");
assert.equal(canonicalizeWatcherTarget("/music"), "/music/");
assert.equal(canonicalizeWatcherTarget(undefined), "");
assert.equal(watchersForPage("/dj-deck").length, watchersForPage("/dj-deck.html").length);
for (const watcher of HALO_BUTTON_WATCHER_REGISTRY) {
  assert.equal(canonicalizeWatcherTarget(watcher.target), watcher.target, `${watcher.id} target must stay canonical.`);
}

// 4. Watcher self-repair: stale selectors (e.g. host-rewritten pretty hrefs) re-bind silently.
function headerElements({ rewriteHrefs = false, tagged = false, omit = [] } = {}) {
  return header.filter(watcher => !omit.includes(watcher.id)).map(watcher => {
    const href = rewriteHrefs ? watcher.target.replace(/\.html$/, "").replace(/(.)\/$/, "$1") : watcher.target;
    const attributes = { class: "compact-button", href };
    if (tagged) attributes["data-watcher-id"] = watcher.id;
    return new FakeElement("a", attributes, watcher.controlText);
  });
}
{
  const elements = headerElements({ rewriteHrefs: true });
  const root = new FakeDocument(elements);
  const live = evaluateWatcher(root, header[0], { origin: djLocation.origin });
  assert.equal(live.status, "green");
  assert.equal(live.resolvedVia, "canonical-target");

  const repairs = [];
  const room = createControlRoom({ root, location: djLocation, storage: memoryStorage(), sessionId: "deck-session", isVisible, emit: event => repairs.push(event) });
  const first = room.cycle();
  assert.ok(first.watcherResults.every(result => result.status === "green"), "Re-bound watchers must report green.");
  assert.ok(first.watcherResults.every(result => !("element" in result)), "Watcher results must not leak DOM nodes.");
  assert.ok(elements.every(element => element.getAttribute("data-watcher-id")), "Re-binding tags each control with data-watcher-id.");
  assert.equal(repairs.filter(event => event.status === REPAIR_STATUS.resolved).length, header.length);
  assert.ok(repairs.every(event => event.details.assignedAgent && event.sessionId === "deck-session"));
  const second = room.cycle();
  assert.ok(second.watcherResults.every(result => result.resolvedVia === "selector"), "After repair the canonical selector matches directly.");
  assert.equal(second.events.length, 0, "A repaired surface must stay quiet.");
}

// 5. Missing header controls are escalated once to the Routing Agent.
{
  const root = new FakeDocument(headerElements({ tagged: true, omit: ["dj-deck-header-live", "dj-deck-header-halo-x"] }));
  const events = [];
  const room = createControlRoom({ root, location: djLocation, storage: memoryStorage(), isVisible, emit: event => events.push(event) });
  const { watcherResults, state } = room.cycle();
  const failing = watcherResults.filter(result => result.status === "red").map(result => result.id).sort();
  assert.deepEqual(failing, ["dj-deck-header-halo-x", "dj-deck-header-live"]);
  const failed = events.filter(event => event.status === REPAIR_STATUS.failed);
  assert.equal(failed.length, 2);
  assert.ok(failed.every(event => event.details.issueType === FAILURE_TYPES.missingControl && event.details.assignedAgent === DASH_FIX_AGENTS.routing));
  assert.equal(events.filter(event => event.status === REPAIR_STATUS.attempted).length, 2, "Every repair attempt is logged.");
  room.cycle();
  assert.equal(events.length, 4, "Escalated defects are not re-logged every cycle.");
  assert.equal(state.surface, "dj-deck");
  assert.deepEqual(state.repairs, { attempted: 2, resolved: 0, failed: 2 });
}

// 6. Unsafe/placeholder links and unnamed controls.
{
  const hiddenPlaceholder = new FakeElement("a", { class: "recording-download", id: "recordingDownload", href: "#", download: "" }, "Download recorded set", { hidden: true });
  const visiblePlaceholder = new FakeElement("a", { href: "#" }, "Broken link");
  const scriptLink = new FakeElement("a", { href: "javascript:alert(1)" }, "Script link");
  const label = new FakeElement("label", { for: "mixTitleInput" }, "Mix title");
  const labelledInput = new FakeElement("input", { id: "mixTitleInput", type: "text" }, "");
  const wrapper = new FakeElement("label", {}, "Pack title");
  const wrappedInput = new FakeElement("input", { type: "text" }, "", { parent: wrapper });
  const unnamedInput = new FakeElement("input", { type: "search", placeholder: "Search tracks" }, "");
  const iconButton = new FakeElement("button", { class: "icon" }, "");
  const root = new FakeDocument([...headerElements({ tagged: true }), hiddenPlaceholder, visiblePlaceholder, scriptLink, label, labelledInput, wrapper, wrappedInput, unnamedInput, iconButton]);
  const events = [];
  createControlRoom({ root, location: djLocation, storage: memoryStorage(), isVisible, emit: event => events.push(event) }).cycle();
  assert.equal(hiddenPlaceholder.hasAttribute("href"), false, "Hidden placeholder hrefs are removed silently.");
  assert.equal(visiblePlaceholder.getAttribute("href"), "#", "Visible placeholder links are never rewritten.");
  assert.equal(scriptLink.getAttribute("href"), "javascript:alert(1)", "Unsafe schemes are left for human security review.");
  assert.equal(labelledInput.getAttribute("aria-label"), null, "<label for> associations already name a field; no repair needed.");
  assert.equal(wrappedInput.getAttribute("aria-label"), null, "Wrapping <label> elements already name a field; no repair needed.");
  assert.equal(unnamedInput.getAttribute("aria-label"), "Search tracks", "Unnamed fields borrow their existing placeholder copy.");
  assert.equal(iconButton.getAttribute("aria-label"), null, "Controls without a safe name source are not invented.");
  const byType = type => events.filter(event => event.details.issueType === type && event.status !== REPAIR_STATUS.attempted);
  assert.deepEqual(byType(FAILURE_TYPES.unsafeLink).map(event => event.status).sort(), [REPAIR_STATUS.failed, REPAIR_STATUS.failed, REPAIR_STATUS.resolved]);
  assert.deepEqual(byType(FAILURE_TYPES.unnamedControl).map(event => event.status).sort(), [REPAIR_STATUS.failed, REPAIR_STATUS.resolved]);
  assert.ok(byType(FAILURE_TYPES.unnamedControl).every(event => event.details.assignedAgent === DASH_FIX_AGENTS.ui));
}

// 7. Runtime exceptions never crash the loop and are classified.
{
  const events = [];
  const room = createControlRoom({ root: new FakeDocument(headerElements({ tagged: true })), location: djLocation, storage: memoryStorage(), isVisible, emit: event => events.push(event) });
  assert.doesNotThrow(() => room.cycle({ runtimeErrors: [undefined, null, { message: undefined }, "Uncaught TypeError: Cannot read properties of undefined (reading 'toLowerCase')", { message: "Audio decode failed", source: "/services/haloAudioEngine.js" }] }));
  const runtime = events.filter(event => event.details.issueType === FAILURE_TYPES.runtimeException && event.status === REPAIR_STATUS.failed);
  assert.ok(runtime.length >= 2);
  assert.ok(runtime.some(event => event.details.assignedAgent === DASH_FIX_AGENTS.playback));
}
assert.equal(ownerAgentForFailure(FAILURE_TYPES.runtimeException, { detail: "Cannot read properties of undefined (reading 'toLowerCase')" }), DASH_FIX_AGENTS.ui);
assert.equal(ownerAgentForFailure(FAILURE_TYPES.runtimeException, { detail: "release catalog fetch failed" }), DASH_FIX_AGENTS.content);
assert.equal(ownerAgentForFailure(FAILURE_TYPES.unsafeLink), DASH_FIX_AGENTS.routing);
assert.equal(ownerAgentForFailure(FAILURE_TYPES.missingControl, { ownerAgent: DASH_FIX_AGENTS.playback }), DASH_FIX_AGENTS.playback);
assert.equal(ownerAgentForFailure(FAILURE_TYPES.missingControl, { ownerAgent: "Rogue Agent" }), DASH_FIX_AGENTS.routing, "Owner agents must come from the Dash fix roster.");

// 8. Monitor findings are classified with failure type + owner agent (the reported panel).
const reportedPanel = [
  [{ name: "Interaction Tester", category: "accessibility" }, FAILURE_TYPES.unnamedControl, DASH_FIX_AGENTS.ui],
  [{ name: "Navigation Tester", category: "navigation" }, FAILURE_TYPES.unsafeLink, DASH_FIX_AGENTS.routing],
  [{ name: "Runtime Watcher", category: "runtime", detail: "Uncaught TypeError: Cannot read properties of undefined (reading 'toLowerCase')" }, FAILURE_TYPES.runtimeException, DASH_FIX_AGENTS.ui],
  [{ name: "Dash AI Link Aggregator", category: "navigation" }, FAILURE_TYPES.watcherFailure, DASH_FIX_AGENTS.routing],
  [{ name: "Watcher: HALO Live (DJ deck header)", category: "navigation", watcherId: "dj-deck-header-live", status: "red", ownerAgent: DASH_FIX_AGENTS.routing }, FAILURE_TYPES.missingControl, DASH_FIX_AGENTS.routing],
  [{ name: "Watcher: DJ HALO X (DJ deck header)", category: "navigation", watcherId: "dj-deck-header-halo-x", status: "yellow", ownerAgent: DASH_FIX_AGENTS.routing }, FAILURE_TYPES.routeMismatch, DASH_FIX_AGENTS.routing],
  [{ name: "Audio Scout", category: "audio" }, FAILURE_TYPES.audioSignal, DASH_FIX_AGENTS.playback]
];
for (const [check, type, owner] of reportedPanel) {
  const defect = classifyCheck(check, "/dj-deck");
  assert.equal(defect.type, type, `${check.name} must classify as ${type}`);
  assert.equal(defect.ownerAgent, owner, `${check.name} must route to ${owner}`);
  assert.equal(defect.pagePath, "/dj-deck.html");
  assert.equal(defect.surface, "dj-deck");
}

// 9. Structured repair events + persisted learning history.
{
  const defect = classifyCheck({ name: "Navigation Tester" }, "/dj-deck.html");
  const event = createRepairEvent({ defect, status: REPAIR_STATUS.resolved, action: "Removed placeholder href", sessionId: "s1", now: new Date("2026-10-06T00:00:00Z") });
  assert.deepEqual(event.labels, [...REPAIR_EVENT_LABELS]);
  assert.deepEqual(REPAIR_EVENT_LABELS, ["MACHINE_GENERATED", "AUTO_REPAIR"]);
  assert.equal(event.type, "AUTO_REPAIR_AUDIT");
  assert.equal(event.timestamp, "2026-10-06T00:00:00.000Z");
  assert.deepEqual(Object.keys(event.details).sort(), ["actionTaken", "assignedAgent", "attempt", "defectId", "issueType", "targetElement"]);

  const storage = memoryStorage();
  const brokenHeader = () => new FakeDocument(headerElements({ tagged: true, omit: ["dj-deck-header-live"] }));
  for (let pageLoad = 0; pageLoad < 3; pageLoad += 1) {
    createControlRoom({ root: brokenHeader(), location: djLocation, storage, isVisible }).cycle();
  }
  const persisted = JSON.parse(storage.getItem(CONTROL_ROOM_HISTORY_KEY));
  assert.equal(persisted.length, 6, "History persists attempts and outcomes across page loads.");
  const { state } = createControlRoom({ root: brokenHeader(), location: djLocation, storage, isVisible }).cycle();
  assert.equal(state.recurringPatterns.length, 1);
  assert.equal(state.recurringPatterns[0].issueType, FAILURE_TYPES.missingControl);
  assert.equal(state.recurringPatterns[0].contractCandidate, true, "Repeated failures are promoted as regression-contract candidates.");
  assert.equal(summarizeRepairHistory([null, {}, "bad"]).length, 0);

  const throwingStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  assert.doesNotThrow(() => createControlRoom({ root: brokenHeader(), location: djLocation, storage: throwingStorage, isVisible }).cycle());
  storage.setItem(CONTROL_ROOM_HISTORY_KEY, "{not json");
  assert.doesNotThrow(() => createControlRoom({ root: brokenHeader(), location: djLocation, storage, isVisible }).cycle());
}

// 10. Site monitor wiring stays silent and routes through the shared pipeline.
assert.match(monitor, /import\("\/lib\/dj-control-room\.js"\)/, "Site monitor must load the shared DJ control room.");
assert.match(monitor, /halo:control-room-repair/);
assert.match(monitor, /halo:control-room-update/);
assert.match(monitor, /eventType: "auto_repair"/, "Repair events must be journaled.");
assert.match(monitor, /labels: "MACHINE_GENERATED,AUTO_REPAIR"/, "Escalations must be tagged as machine generated.");
assert.match(monitor, /control-room\|recurring\|/, "Recurring patterns must be escalated for contract promotion.");
assert.match(monitor, /fetch\("\/api\/issues"/, "Escalations must use the shared maintenance issue pipeline.");
assert.doesNotMatch(monitor, /\balert\(|\bconfirm\(|\bprompt\(/, "The control room must never interrupt users.");
assert.doesNotMatch(monitor, /watcher\.status\.toUpperCase\(\)/);
assert.match(monitor, /cycle\.module\.hasAccessibleName\(element, document\)/, "Interaction Tester must treat label associations as accessible names.");

const scripts = JSON.parse(packageJson).scripts;
assert.match(scripts.test, /dj-control-room-contracts\.mjs/);
assert.match(scripts["contracts:ai-maintenance"], /dj-control-room-contracts\.mjs/);

console.log("DJ control room contracts passed.");
