import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [guardSource, deckPage] = await Promise.all([
  readFile(new URL("../dj-recorder-guard.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);

const sandbox = {
  console,
  globalThis: null,
  setInterval(handler, interval) { sandbox.__interval = interval; sandbox.__handler = handler; return 1; },
  clearInterval() { sandbox.__cleared = true; }
};
let advanceClock = true;
sandbox.setTimeout = (handler, delay) => {
  if (advanceClock && sandbox.feedContext) sandbox.feedContext.currentTime += delay / 1000;
  handler();
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(guardSource, sandbox);

const { HaloRecorderGuard, useRecorderGuard } = sandbox;
assert.equal(typeof HaloRecorderGuard, "function", "Recorder guard exports a global constructor");
assert.equal(typeof useRecorderGuard, "function", "Recorder guard exposes a hook-style entry point");
const evaluate = HaloRecorderGuard.evaluate;

const idle = evaluate({ isRecording: false, masterBusLevel: 0.95, cueBusActive: true, activeCueDecks: ["A"] });
assert.equal(idle.isSecureToRecord, false, "Idle state cannot claim isolation without a preflight");
assert.equal(idle.bleedDetected, false);
assert.match(idle.warningMessage, /preflight/);

const confirmed = { isolationConfirmed: true, preflightPassed: true };
const cleanRecording = evaluate({ ...confirmed, isRecording: true, masterBusLevel: 0.95, cueBusActive: false });
assert.equal(cleanRecording.state, "secure", "Confirmed recording is secure");

const quietCue = evaluate({ ...confirmed, isRecording: true, masterBusLevel: 0.99, cueBusActive: true, activeCueDecks: ["B"] });
assert.equal(quietCue.state, "secure", "Monitor-only CUE does not trigger false bleed warnings, even with a hot music bus");

const triggered = evaluate({ ...confirmed, isolationConfirmed: false, isRecording: true });
assert.equal(triggered.state, "triggered", "Loss of the isolated feed triggers the guard");
assert.equal(triggered.isSecureToRecord, false);
assert.equal(triggered.bleedDetected, false, "Unavailable isolation is not misrepresented as detected bleed");
assert.equal(evaluate({ isolationConfirmed: true }).isSecureToRecord, false, "A connected tap alone cannot replace preflight");

for (const state of [idle, cleanRecording, quietCue, triggered]) {
  assert.doesNotMatch(`${state.title} ${state.message || ""} ${state.warningMessage}`, /zero bleed|guarantee|pristine|100% clean/i, "Guard copy never promises absolute silence");
}

let inputs = {};
const statuses = [];
const guard = useRecorderGuard({ readInputs: () => inputs, onStatusChange: status => statuses.push(status) });
assert.equal(sandbox.__interval, 250, "Guard samples the recorder feed four times per second");
assert.equal(statuses.at(-1).state, "triggered", "Guard starts fail-closed");

inputs = { ...confirmed, isRecording: true, cueBusActive: true };
guard.tick();
assert.equal(statuses.at(-1).state, "secure", "Guard publishes confirmed isolation");
inputs = { ...inputs, isolationConfirmed: false };
guard.tick();
assert.equal(statuses.at(-1).state, "triggered", "Loss of isolation is not delayed by a hold window");
guard.destroy();
assert.equal(sandbox.__cleared, true, "Guard stops its watchdog on destroy");

const classes = new Set();
const title = { textContent: "" };
const message = { textContent: "" };
const indicator = {
  dataset: {},
  attributes: {},
  classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
  setAttribute(name, value) { this.attributes[name] = value; },
  querySelector(selector) { return selector === "[data-recorder-guard-title]" ? title : selector === "[data-recorder-guard-message]" ? message : null; }
};
HaloRecorderGuard.renderIndicator(indicator, triggered);
assert.equal(indicator.dataset.state, "triggered");
assert.ok(classes.has("is-triggered") && !classes.has("is-secure"), "Indicator switches to the triggered style");
assert.equal(indicator.attributes.role, "alert", "Triggered indicator is announced as an alert");
assert.equal(indicator.attributes["aria-live"], "assertive", "Alert live region is assertive");
assert.equal(title.textContent, "Recorder isolation not confirmed");
assert.equal(message.textContent, triggered.warningMessage);
HaloRecorderGuard.renderIndicator(indicator, cleanRecording);
assert.ok(classes.has("is-secure") && !classes.has("is-triggered"), "Indicator returns to the secure style");
assert.equal(title.textContent, "Recorder isolation secure");
assert.equal(indicator.attributes["aria-live"], "polite", "Secure status live region is polite");

assert.match(deckPage, /<script src="\/dj-recorder-guard\.js" defer><\/script>/, "DJ deck loads the recorder guard");
const guardIndex = deckPage.indexOf('id="recorderGuard"');
const rigIndex = deckPage.indexOf('id="recordingRig"');
const recorderTitleIndex = deckPage.indexOf('id="recordingTitle"');
assert.ok(rigIndex > -1 && guardIndex > rigIndex && guardIndex < recorderTitleIndex, "Indicator sits directly above the Takeover recorder heading");
assert.match(deckPage, /data-recorder-guard-title/, "Indicator exposes a title slot");
assert.match(deckPage, /data-recorder-guard-message/, "Indicator exposes a message slot");
assert.match(deckPage, /function attachRecorderGuardToDeck\(/, "DJ deck wires the recorder guard");
assert.match(deckPage, /const isRecording = recordingState\.recorder\?\.state === "recording"/, "Guard reads the live recorder state");
assert.match(deckPage, /const cueBusActive = activeCueDecks\.length > 0/, "Guard reads cue bus activity");
assert.match(deckPage, /preflightPassed: recordingState\.preflightPassed/, "Guard requires the preflight result");
assert.match(deckPage, /recorderGuardState\.guard\?\.tick\(\);/, "Cue toggles refresh the guard immediately");
assert.match(deckPage, /cueGain\.connect\(context\.destination\)/, "CUE monitoring stays on the local output path");
assert.match(deckPage, /createRecordingFeed\(audioEngine\.context, audioEngine\.limiter\)/, "Recorder taps the post-limiter music bus");
assert.doesNotMatch(deckPage, /cueGain\.connect\(audioEngine\.recordingDestination\)/, "CUE monitoring is never routed into the recorder");

class Node {
  constructor() { this.connections = []; }
  connect(node) { this.connections.push(node); return node; }
}
let level = 0;
const audioTrack = { readyState: "live", enabled: true, muted: false };
const context = {
  state: "running", currentTime: 0,
  createMediaStreamDestination() { return Object.assign(new Node(), { stream: { getAudioTracks: () => [audioTrack] } }); },
  createMediaStreamSource() { return new Node(); },
  createAnalyser() { return Object.assign(new Node(), { getFloatTimeDomainData: data => data.fill(level) }); }
};
sandbox.feedContext = context;
const musicBus = new Node();
const feed = HaloRecorderGuard.createRecordingFeed(context, musicBus);
assert.deepEqual(musicBus.connections, [feed.destination], "Only the supplied post-limiter bus connects to the recording destination");
assert.deepEqual(feed.probe.connections, [feed.analyser]);
assert.equal(feed.analyser.connections.length, 0, "Probe is analysis-only, with no feedback path");
const runPreflight = () => HaloRecorderGuard.preflight(feed, { isMusicIdle: () => true });
assert.equal(await runPreflight(), true, "Quiet live feed passes");
level = 0.01;
await assert.rejects(runPreflight(), /preflight failed/, "Noise fails closed");
level = Number.NaN;
await assert.rejects(runPreflight(), /preflight failed/, "Invalid samples fail closed");
level = 0;
context.state = "suspended";
await assert.rejects(runPreflight(), /preflight failed/, "Suspended context fails closed");
context.state = "running";
advanceClock = false;
await assert.rejects(runPreflight(), /preflight failed/, "A stalled audio clock cannot confirm silence");
advanceClock = true;
audioTrack.readyState = "ended";
await assert.rejects(runPreflight(), /preflight failed/, "Dead stream fails closed");
audioTrack.readyState = "live";
await assert.rejects(HaloRecorderGuard.preflight({ ...feed }, { isMusicIdle: () => true }), /preflight failed/, "Unowned feeds fail closed");
await assert.rejects(HaloRecorderGuard.preflight(feed), /preflight failed/, "Missing idle check fails closed");
let checks = 0;
await assert.rejects(HaloRecorderGuard.preflight(feed, { isMusicIdle: () => ++checks < 3 }), /preflight failed/, "Music starting mid-preflight fails closed");
assert.ok(deckPage.indexOf("await window.HaloRecorderGuard.preflight(") < deckPage.indexOf("recorder.start(1000)"), "Isolation preflight gates recorder start");

// Exercise the page's real routing and takeover functions, not just source patterns.
function pageFunction(name) {
  const start = deckPage.search(new RegExp(`^    (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Page function ${name} exists`);
  const remainder = deckPage.slice(start + 1);
  const next = remainder.search(/^    (?:async )?function \w+\(/m);
  return deckPage.slice(start, next < 0 ? deckPage.length : start + 1 + next);
}
for (const match of deckPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
const noop = () => {};
const param = () => ({ value: 0, setValueAtTime: noop, setTargetAtTime: noop });
const graphNodes = [];
const makeNode = () => {
  const node = new Node();
  for (const key of ["gain", "frequency", "Q", "delayTime", "threshold", "knee", "ratio", "attack", "release"]) node[key] = param();
  graphNodes.push(node);
  return node;
};
context.destination = makeNode();
context.createGain = makeNode;
context.createBiquadFilter = makeNode;
context.createDelay = makeNode;
context.createDynamicsCompressor = makeNode;
const channel = () => ({ stemSources: {}, source: null });
Object.assign(sandbox, {
  window: sandbox,
  AudioContext: function () { return context; },
  audioEngine: { context: null, recordingFeed: null, decks: { A: channel(), B: channel() } },
  reportAudioHealth: noop, updateAudioCrossfader: noop, attachContinuityGuardToDeck: noop
});
vm.runInContext(pageFunction("ensureAudio"), sandbox);
sandbox.HaloRecorderGuard = undefined;
await sandbox.ensureAudio();
assert.equal(sandbox.audioEngine.recordingFeed, null, "Playback initializes even if the deferred guard has not loaded");
sandbox.HaloRecorderGuard = HaloRecorderGuard;
await sandbox.ensureAudio();
const graphFeed = sandbox.audioEngine.recordingFeed;
assert.ok(graphFeed, "Recorder feed attaches when the guard becomes available");
assert.deepEqual(graphNodes.filter(node => node.connections.includes(graphFeed.destination)), [sandbox.audioEngine.limiter], "Page routes only its limiter into the recorder");
function reaches(source, target, seen = new Set()) {
  if (source === target) return true;
  if (seen.has(source)) return false;
  seen.add(source);
  return source.connections.some(node => reaches(node, target, seen));
}
for (const deck of Object.values(sandbox.audioEngine.decks)) {
  assert.equal(reaches(deck.gain, graphFeed.destination), true, "Music channel reaches recorder through limiter");
  assert.equal(reaches(deck.cueGain, graphFeed.destination), false, "CUE has no directed path to recorder");
  assert.equal(reaches(deck.cueGain, context.destination), true, "CUE remains audible locally");
}

const buffer = { duration: 180, length: 48000 };
const uploaded = id => ({ id, title: id, audioAsset: { file: { arrayBuffer: async () => new ArrayBuffer(8) } } });
const startButton = { disabled: false };
let builds = 0;
let loadCalls = 0;
let stopCalls = 0;
let constructions = 0;
let recorderStarts = 0;
let failIsolation = false;
const recording = {
  recorder: null, starting: false, preparing: null, preparedKey: "", takeoverPlan: [],
  preflightPassed: false, playedTrackIds: new Set()
};
Object.assign(sandbox, {
  recordingState: recording,
  takeoverSession: { name: "DJ HALO", dj: "halo", minutes: 30 },
  djMode: "club", tracks: [uploaded("one")], trackQueue: [],
  deckState: { A: { id: "live", playing: true }, B: { id: "idle", playing: false } },
  continuityState: { fillerNodes: [] },
  recorderGuardState: {},
  elements: {
    recordingStart: startButton, recordingStatus: {}, recordingNote: {},
    recordingRig: {}, search: { value: "" }, mixIntent: { value: "hold" }
  },
  ensureAudio: async () => context,
  fetch: async (url, options) => {
    builds += 1;
    const songs = JSON.parse(options.body).tracks;
    return { ok: true, json: async () => ({ report: {
      orderedTracks: songs.slice().reverse(), transitions: [], status: "ready", qualityScore: 90
    } }) };
  },
  preflightTrackPayload: track => ({ id: track.id, title: track.title }),
  renderPreflight: noop, renderTracks: noop, renderQueue: noop, updateTakeoverQualityControl: noop,
  loadTrack(deckId, id) { loadCalls += 1; sandbox.deckState[deckId] = { ...sandbox.tracks.find(track => track.id === id), playing: false }; },
  stopAutomatedMix: () => { stopCalls += 1; }, stopTakeoverDecks: () => { stopCalls += 1; },
  showToast: noop, clearInterval: noop,
  createCompatibleRecorder: () => {
    constructions += 1;
    return { state: "inactive", mimeType: "audio/webm", addEventListener: noop,
      start() { this.state = "recording"; recorderStarts += 1; }, stop() { this.state = "inactive"; } };
  },
  MediaRecorder: function () {},
  document: { querySelector: () => ({ textContent: "" }) },
  syncDecks: noop, startDeckAudio: async () => {}, stopDeckAudio: noop, updateDeck: noop,
  startAutomatedMix: noop, updateRecordingProgress: noop
});
sandbox.setAutomatedCrossfader = noop;
sandbox.scheduleAutomatedTransition = noop;
context.decodeAudioData = async () => buffer;
for (const name of ["trackHasPlayableAudio", "trackAudioReady", "takeoverLibraryKey", "updateTakeoverRecorderAvailability",
  "prepareTrackAudio", "prepareTakeoverSet", "buildTakeoverPlan", "startTakeoverRecording",
  "triggerKick", "triggerTone", "playBridgeSynth", "startDeckContinuityFiller",
  "startAutomatedMix", "nextTakeoverTrack"]) {
  vm.runInContext(pageFunction(name), sandbox);
}
await sandbox.prepareTakeoverSet();
assert.equal(startButton.disabled, true, "One song cannot enable recording");
assert.equal(builds, 0, "One song never requests a set build");
assert.equal(sandbox.trackHasPlayableAudio({ stemAssets: {} }), false, "Empty stems are not playable");
assert.equal(sandbox.trackHasPlayableAudio({ stemAssets: { vocals: {} } }), false, "Missing stem media is not playable");
sandbox.tracks.push(uploaded("two"), uploaded("three"), { id: "metadata-only" });
await sandbox.prepareTakeoverSet();
assert.equal(builds, 1, "Audio loading automatically builds a complete set");
assert.equal(startButton.disabled, false, "Two or more decoded songs enable recording");
assert.deepEqual(Array.from(recording.takeoverPlan), ["three", "two", "one"], "Whole set follows preflight order, excluding metadata-only cards");
assert.ok(sandbox.tracks.slice(0, 3).every(track => track.audioAsset.buffer === buffer), "Preparation reuses decoded shared assets");
assert.equal(loadCalls, 0, "Background building never replaces a live deck");
assert.equal(sandbox.deckState.A.playing, true, "Background building leaves live playback running");
await sandbox.prepareTakeoverSet();
assert.equal(builds, 1, "Unchanged libraries reuse the prepared set");
const realPreflight = HaloRecorderGuard.preflight;
HaloRecorderGuard.preflight = async (feed, options) => {
  if (failIsolation) throw new Error("Isolation unavailable");
  return realPreflight(feed, options);
};
await sandbox.startTakeoverRecording();
assert.equal(recorderStarts, 0, "Live music prevents a quiet-feed recording start");
assert.equal(constructions, 0, "Preflight must pass before the recorder is even constructed");
assert.equal(loadCalls, 0, "Failed isolation does not replace decks");
assert.equal(stopCalls, 0, "Failed preflight leaves existing live playback untouched");
sandbox.deckState.A.playing = false;
failIsolation = true;
await sandbox.startTakeoverRecording();
assert.equal(recorderStarts, 0, "Unavailable isolation cannot be bypassed");
failIsolation = false;
await Promise.all([sandbox.startTakeoverRecording(), sandbox.startTakeoverRecording()]);
assert.equal(recorderStarts, 1, "Concurrent start requests open only one recorder after isolation");
assert.equal(loadCalls, 2, "Prepared first two songs load only after isolation passes");
assert.equal(recording.preflightPassed, true);
assert.equal(sandbox.nextTakeoverTrack().id, "one", "All remaining songs follow the cached order");
sandbox.startAutomatedMix();
assert.equal(recording.trackCursor, 2, "A new recording resets the cached set cursor");
assert.equal(sandbox.nextTakeoverTrack().id, "one", "A repeated recording does not skip previously consumed songs");
// These real page functions must return before creating any synthetic source.
context.createOscillator = () => { throw new Error("Synthetic audio must not enter a recording"); };
sandbox.triggerKick("A", 0);
sandbox.triggerTone("A", 0, 440, "sine", 1, 1);
sandbox.playBridgeSynth("A", 1000, "8A", "9A");
sandbox.startDeckContinuityFiller();
recording.recorder.state = "inactive";
recording.preparedKey = "";
recording.takeoverPlan = [];
sandbox.tracks = [uploaded("invalid"), uploaded("valid")];
context.decodeAudioData = async () => { throw new Error("Bad audio"); };
await sandbox.prepareTakeoverSet();
assert.equal(startButton.disabled, true, "Undecodable files cannot enable the recorder");
assert.equal(recording.takeoverPlan.length, 0, "Failed audio loading cannot reuse a stale set");
context.decodeAudioData = async () => buffer;
sandbox.fetch = async () => ({ ok: true, json: async () => ({ report: {
  orderedTracks: [{ id: "invalid" }, { id: "invalid" }], transitions: [], status: "ready"
} }) });
await sandbox.prepareTakeoverSet();
assert.equal(startButton.disabled, true, "Duplicate or incomplete server orders cannot enable recording");
assert.equal(recording.takeoverPlan.length, 0, "Invalid orders fail closed");
HaloRecorderGuard.preflight = realPreflight;

console.log("DJ recorder guard contracts: quiet-feed isolation, music-only graph, automatic takeover preparation, and safe recording starts passed.");
