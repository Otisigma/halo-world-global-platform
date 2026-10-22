import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildDeckCompanion, buildReleaseKit, cleanCompanionTrack, parseReleaseKit, releaseKitSvg, RELEASE_KIT_STORAGE_KEY, sessionTimestamp } from "../lib/dreamweaver-deck.js";

const track = { id: "track-one", title: "Opening", artist: "Artist", bpm: 124, key: "8A", energy: 4, playing: true, sourceUrl: "https://private.invalid/audio?secret=hidden", audioAsset: { file: "private.wav" } };
const second = { ...track, id: "track-two", title: "Lift", energy: 8 };
assert.equal(buildDeckCompanion().current, null);
assert.match(buildDeckCompanion().nextMove, /Load a track/);
assert.equal(cleanCompanionTrack({ empty: true, id: "empty" }), null);
assert.equal(cleanCompanionTrack({ id: "bad", energy: Infinity }).energy, 5);
assert.equal(cleanCompanionTrack({ id: "bad", bpm: -20 }).bpm, 40);
const snapshot = {
  decks: { A: track, B: second }, crossfader: 90, nextTrack: track,
  recommendation: { decision: "mix", transitionStyle: "long-blend", setArc: [{ title: "Opening", purpose: "Breathe" }] },
  energyCurve: [2, 5, 10, 999], phase: "peak", personaId: "butterfly"
};
const model = buildDeckCompanion(snapshot);
assert.equal(model.current.id, second.id, "Crossfader-led live deck supplies context");
assert.match(model.persona, /Butterfly/);
assert.match(model.nextMove, /Prepare Opening/);
assert.deepEqual(model.energyCurve, [2, 5, 10, 10]);
assert.match(buildDeckCompanion({ ...snapshot, recommendation: { decision: "hold" } }).nextMove, /Hold/);
assert.match(buildDeckCompanion({ ...snapshot, recommendation: { decision: "silence" } }).nextMove, /silence/);
assert.equal(buildDeckCompanion({ ...snapshot, decks: { A: track, B: { ...second, playing: false } } }).deck, "A", "A paused deck never displaces the live one");
assert.equal(snapshot.energyCurve[3], 999, "Companion never mutates the performance state");
assert.equal(sessionTimestamp(3661), "61:01");
assert.equal(sessionTimestamp(-1), "00:00");

const input = { title: "Night arc", artist: "DJ", format: "mix_album", notes: "Protect the break", audience: "late listeners", tracks: [track, { ...second, offsetSeconds: 240 }], mixId: "12345678-abcd-4567-8901-123456789012" };
const kit = buildReleaseKit(input);
assert.deepEqual(buildReleaseKit(input), kit, "Generation is deterministic");
assert.equal(kit.status, "draft");
assert.equal(kit.chapters.length, 4);
assert.match(kit.tracklist, /02\. 04:00 Artist — Lift/);
assert.equal(kit.destination, `/dreamweaver/?mix=${input.mixId}`);
assert.match(kit.shareCaption, /Dreamweaver|dreamweaver/);
assert.match(kit.disclosure, /No audio, rights approval, mastering approval, or publication/);
assert.match(kit.timestampNote, /not verified/);
assert.ok(!JSON.stringify(kit).includes("private.invalid"));
assert.ok(!JSON.stringify(kit).includes("private.wav"));
assert.deepEqual(parseReleaseKit(JSON.stringify({ ...kit, status: "published", rightsConfirmed: true })), kit, "Imported drafts are rebuilt from whitelisted data, never trusted approvals");
assert.equal(parseReleaseKit("{broken"), null);
assert.equal(parseReleaseKit("x".repeat(250001)), null);
assert.equal(parseReleaseKit("null"), null);
assert.equal(parseReleaseKit('{"version":1}'), null);
assert.throws(() => buildReleaseKit({ tracks: [] }), /Play a track/);
assert.equal(buildReleaseKit({ ...input, mixId: "https://evil.invalid" }).destination, "");
assert.equal(buildReleaseKit({ ...input, tracks: Array(250).fill(track) }).tracks.length, 200);
const attack = buildReleaseKit({ ...input, title: '<script>alert("x")</script>&', artist: '"><image href="https://evil.invalid"/>' });
for (const card of [true, false]) {
  const svg = releaseKitSvg(attack, { card });
  assert.ok(!svg.includes("<script>"));
  assert.ok(!svg.includes("<image"));
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /HUMAN REVIEW REQUIRED/);
  assert.match(svg, card ? /width="1200" height="630"/ : /width="1080" height="1080"/);
}

const [deck, page, controller, packageSource] = await Promise.all([
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../dreamweaver/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dreamweaver/deck-companion.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);
for (const source of [deck, page]) {
  assert.match(source, /src="\/dreamweaver\/deck-companion.js"/);
  assert.match(source, /id="dreamweaverDeckCompanion"/);
}
assert.ok(JSON.parse(packageSource).scripts["test:dreamweaver-assets"].includes("dreamweaver-deck-contracts.mjs"), "New contracts run in the existing test suite");

// Exercise the real bridge and successful/failed playback boundary without starting an audio graph.
const bridge = deck.slice(deck.indexOf("window.haloDreamweaverDeckSnapshot ="), deck.indexOf("    function setSessionSaveStatus"));
const bridgeContext = {
  window: { location: { search: "?dj=halo" } }, URLSearchParams,
  deckState: { A: track, B: second },
  elements: { crossfader: { value: 50 }, energyCurve: { value: "journey" }, setPhase: { value: "opening" } },
  energyCurves: { journey: [3, 5, 8] }, tracks: [track, second],
  currentRecommendation: { trackId: second.id, setArc: [{ trackId: second.id, purpose: "Lift" }] },
  recordingState: { publishedMixId: input.mixId }
};
vm.runInNewContext(bridge, bridgeContext);
const bridged = bridgeContext.window.haloDreamweaverDeckSnapshot();
assert.equal(bridged.nextTrack.id, second.id);
assert.equal(bridged.mixId, input.mixId);
assert.ok(!JSON.stringify(bridged).includes("private"));
bridged.decks.A.title = "Modified";
bridged.energyCurve[0] = 10;
assert.equal(track.title, "Opening");
assert.equal(bridgeContext.energyCurves.journey[0], 3);

const startSource = deck.slice(deck.indexOf("    async function startDeckAudio("), deck.indexOf("    function startDeckSource("));
const emitted = [];
const boundary = {
  audioEngine: { halo: { setLiveIntelligenceInputState() {}, scheduleLiveIntelligenceRestore() {} }, decks: { A: {} } },
  ensureAudio: async () => ({ currentTime: 0 }), startDeckAudioSources: async () => "started",
  recordingState: { startedAt: 123, recorder: { state: "recording" } },
  deckState: { A: track }, window: { dispatchEvent(event) { emitted.push(event); } },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
};
vm.createContext(boundary);
vm.runInContext(startSource, boundary);
assert.equal(await boundary.startDeckAudio("A"), "started");
assert.equal(emitted.length, 1);
assert.equal(emitted[0].type, "halo:deck-playback-started");
assert.equal(emitted[0].detail.recordingId, "123");
assert.ok(!JSON.stringify(emitted[0]).includes("private"));
boundary.startDeckAudioSources = async () => { throw new Error("decode failed"); };
await assert.rejects(boundary.startDeckAudio("A"), /decode failed/);
assert.equal(emitted.length, 1, "Failed playback never enters the release tracklist");

// Run the controller with lightweight DOM boundaries to test the actual user actions.
class Node {
  constructor() { this.value = ""; this.hidden = false; this.dataset = {}; this.events = {}; this.style = {}; this.maxLength = -1; }
  addEventListener(type, handler) { this.events[type] = handler; }
  dispatchEvent(event) { this.events[event.type]?.(event); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  click() { this.events.click?.({ preventDefault() {} }); }
}
function boot({ deckSurface = true, raw = "", query = "", storageBlocked = false } = {}) {
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return nodes.get(selector);
  };
  const host = get("#dreamweaverDeckCompanion");
  host.hidden = true;
  host.dataset.surface = deckSurface ? "deck" : "dreamweaver";
  host.querySelector = get;
  host.querySelectorAll = () => [];
  const fields = { projectTitle: new Node(), djName: new Node(), tracklist: new Node(), reviewIntent: new Node(), campaignHook: new Node(), rightsConfirmed: { checked: false }, masteringStatus: { value: "not_started" } };
  fields.projectTitle.value = "Keep my edit";
  const flightplan = { elements: { namedItem: name => fields[name] } };
  const events = new Map();
  const stored = new Map([[RELEASE_KIT_STORAGE_KEY, raw]]);
  const context = {
    buildDeckCompanion, buildReleaseKit, cleanCompanionTrack, parseReleaseKit, releaseKitSvg, RELEASE_KIT_STORAGE_KEY,
    RELEASE_KIT_DISCLOSURE: kit.disclosure, URLSearchParams, Blob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    location: { search: query }, performance: { now: () => 1000 }, Date,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => { if (storageBlocked) throw new Error("blocked"); stored.set(key, value); } },
    document: { querySelector: selector => selector === "#mixFlightplanForm" ? flightplan : get(selector), createElement: () => new Node() },
    window: { haloDreamweaverDeckSnapshot: () => ({ ...snapshot, recordingId: "123", publishedRecordingId: "123", mixId: kit.mixId }), addEventListener: (type, handler) => events.set(type, handler), removeEventListener: type => events.delete(type) },
    FormData: class { *[Symbol.iterator]() { yield* Object.entries({ title: "Test release", artist: "DJ" }); } },
    Event: class { constructor(type) { this.type = type; } },
    setInterval: () => 1, clearInterval() {}, setTimeout: handler => handler()
  };
  vm.runInNewContext(controller.replace(/^import .*;\n/, ""), context);
  return { host, get, fields, events, stored };
}
const ui = boot();
assert.equal(ui.host.hidden, false);
ui.get("[data-kit-form]").dispatchEvent({ type: "submit", preventDefault() {} });
assert.match(ui.get("[data-status]").textContent, /Play a track/);
ui.events.get("halo:deck-playback-started")({ detail: { deck: "A", track, recordingId: "123" } });
ui.events.get("halo:deck-playback-started")({ detail: { deck: "B", track: second, recordingId: "123" } });
ui.get("[data-kit-form]").dispatchEvent({ type: "submit", preventDefault() {} });
assert.match(ui.get("[data-tracklist]").textContent, /Opening[\s\S]*Lift/);
ui.get("[data-flightplan]").click();
assert.equal(ui.fields.projectTitle.value, "Keep my edit");
assert.equal(ui.fields.djName.value, "DJ");
assert.equal(ui.fields.rightsConfirmed.checked, false);
assert.equal(ui.fields.masteringStatus.value, "not_started");
ui.get("[data-handoff]").click();
assert.equal(parseReleaseKit(ui.stored.get(RELEASE_KIT_STORAGE_KEY)).mixId, kit.mixId);
const blocked = boot({ storageBlocked: true });
blocked.events.get("halo:deck-playback-started")({ detail: { deck: "A", track, recordingId: "123" } });
blocked.get("[data-kit-form]").dispatchEvent({ type: "submit", preventDefault() {} });
let prevented = false;
blocked.get("[data-handoff]").events.click({ preventDefault() { prevented = true; } });
assert.equal(prevented, true, "Blocked storage prevents navigation with a missing draft");
assert.match(blocked.get("[data-status]").textContent, /storage unavailable/);
ui.get("[data-reset]").click();
assert.equal(ui.get("[data-preview]").hidden, true);
assert.equal(ui.get("[data-build]").disabled, true);
ui.events.get("halo:deck-playback-started")({ detail: { deck: "B", track: second, recordingId: "123" } });
ui.get("[data-kit-form]").dispatchEvent({ type: "submit", preventDefault() {} });
assert.equal(ui.get("[data-handoff]").hidden, true, "A reset log cannot attach a partial session to the previous recording");
const unrelated = boot();
unrelated.events.get("halo:deck-playback-started")({ detail: { deck: "A", track } });
unrelated.get("[data-kit-form]").dispatchEvent({ type: "submit", preventDefault() {} });
assert.equal(unrelated.get("[data-handoff]").hidden, true, "Unrecorded sessions never inherit a previously published mix");
assert.equal(boot({ deckSurface: false }).host.hidden, true, "Normal Dreamweaver visits remain unchanged");
const raw = JSON.stringify({ ...kit, savedAt: Date.now() });
const received = boot({ deckSurface: false, raw, query: `?deck-kit=1&mix=${kit.mixId}` });
assert.equal(received.host.hidden, false);
received.get("[data-campaign]").click();
assert.match(received.get("#campaignHeadline").value, /Night arc/);
received.get("#campaignHeadline").value = "Keep this hook";
received.get("[data-campaign]").click();
assert.equal(received.get("#campaignHeadline").value, "Keep this hook");
assert.equal(boot({ deckSurface: false, raw, query: "?deck-kit=1&mix=another-mix" }).host.hidden, true, "A draft cannot attach to a different mix");
assert.equal(boot({ deckSurface: false, raw: JSON.stringify({ ...kit, savedAt: 0 }), query: `?deck-kit=1&mix=${kit.mixId}` }).host.hidden, true, "Stale handoffs are ignored");
console.log("Dreamweaver deck V2 contracts passed: advisory context, deterministic kit, escaped artwork, private-data boundaries, playback capture, safe draft handoff and unchanged release gates.");
