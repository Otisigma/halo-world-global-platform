import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { analyzeSetPreflight } from "../netlify/lib/dj-preflight.mjs";

const [guardSource, deckPage] = await Promise.all([
  readFile(new URL("../dj-recorder-guard.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);

const sandbox = { console, setTimeout };
vm.createContext(sandbox);
vm.runInContext(guardSource, sandbox);
const { HaloRecorderGuard } = sandbox;

class Node {
  constructor() { this.connections = []; }
  connect(node) { this.connections.push(node); return node; }
}
class Param {
  setValueAtTime(value) { this.value = value; }
}
function context() {
  return {
    state: "running", currentTime: 0, destination: new Node(),
    createGain() { return Object.assign(new Node(), { gain: new Param() }); },
    createDynamicsCompressor() {
      return Object.assign(new Node(), Object.fromEntries(["threshold", "knee", "ratio", "attack", "release"].map(key => [key, new Param()])));
    },
    createMediaStreamDestination() { return Object.assign(new Node(), { stream: { getAudioTracks: () => [{ readyState: "live", enabled: true, muted: false }] } }); },
    createMediaStreamSource(stream) { return Object.assign(new Node(), { stream }); },
    createChannelSplitter() { return new Node(); },
    createAnalyser() { return Object.assign(new Node(), { level: 0, reads: 0, getFloatTimeDomainData(data) { this.reads += 1; data.fill(this.level); } }); }
  };
}
function setup() {
  const audio = context();
  const statuses = [];
  const guard = new HaloRecorderGuard({
    context: audio,
    wait: async ms => { audio.currentTime += ms / 1000; },
    onStatusChange: state => statuses.push(state)
  });
  return { audio, guard, statuses };
}
function reaches(source, target, seen = new Set()) {
  if (source === target) return true;
  if (seen.has(source)) return false;
  seen.add(source);
  return source.connections.some(node => reaches(node, target, seen));
}
const { guard, audio, statuses } = setup();
const deckGain = audio.createGain();
const cue = audio.createGain();
const liveMaster = audio.createGain();
const filler = audio.createGain();
const roomInput = audio.createGain();
deckGain.connect(liveMaster);
deckGain.connect(guard.musicBus);
cue.connect(audio.destination);
filler.connect(liveMaster);
roomInput.connect(liveMaster);
liveMaster.connect(audio.destination);
assert.equal(reaches(deckGain, guard.destination), true, "Deck music reaches the recorder");
assert.equal(reaches(guard.musicBus, guard.limiter), true, "Music is limited before recording");
assert.deepEqual(guard.musicBus.connections, [guard.limiter], "Music cannot bypass the limiter");
for (const excluded of [cue, filler, roomInput, liveMaster]) {
  assert.equal(reaches(excluded, guard.destination), false, "Monitor sources cannot reach recording");
}
assert.equal(reaches(guard.musicBus, audio.destination), false, "Recorder graph does not double live playback");
assert.equal(guard.feed.probe.stream, guard.destination.stream, "Preflight probes the actual recorder stream");
assert.equal(reaches(guard.feed.probe, guard.analysers[0]), true);
assert.equal(reaches(guard.feed.probe, guard.analysers[1]), true);
assert.equal(statuses[0].state, "idle", "Idle is not falsely labelled secure");

assert.equal(HaloRecorderGuard.isQuietFrame(new Float32Array(2048)), true);
for (const value of [.001, .01, Number.NaN, Infinity]) {
  assert.equal(HaloRecorderGuard.isQuietFrame(new Float32Array(2048).fill(value)), false, "Noise, DC and invalid samples fail closed");
}
for (const frequency of [50, 60]) {
  const hum = Float32Array.from({ length: 2048 }, (_, i) => .001 * Math.sin(2 * Math.PI * frequency * i / 48000));
  assert.equal(HaloRecorderGuard.isQuietFrame(hum), false, `${frequency} Hz mains hum is not a quiet feed`);
}
const transient = new Float32Array(2048);
transient[1] = .001;
assert.equal(HaloRecorderGuard.isQuietFrame(transient), false, "A short transient cannot hide below RMS threshold");

let starts = 0;
const createRecorder = stream => {
  assert.equal(stream, guard.destination.stream);
  return { start(timeslice) { starts += 1; assert.equal(timeslice, 1000); } };
};
await guard.start(createRecorder, () => true);
assert.equal(starts, 1);
assert.equal(guard.analysers[0].reads, 8);
assert.equal(guard.analysers[1].reads, 8, "Both channels are measured independently, avoiding phase cancellation");
assert.equal(guard.state.state, "recording");
guard.analysers[1].level = .001;
await assert.rejects(guard.start(createRecorder, () => true), /Noise or audio/);
assert.equal(starts, 1, "Every start requires a new passing preflight");
assert.equal(guard.state.state, "blocked");
guard.analysers[1].level = 0;
await assert.rejects(guard.start(createRecorder, () => false), /Stop both decks/);
audio.state = "suspended";
await assert.rejects(guard.start(createRecorder, () => true), /Stop both decks/);
audio.state = "running";
guard.destination.stream.getAudioTracks = () => [];
await assert.rejects(guard.start(createRecorder, () => true), /unavailable/);
for (const track of [
  { readyState: "ended", enabled: true, muted: false },
  { readyState: "live", enabled: false, muted: false },
  { readyState: "live", enabled: true, muted: true }
]) {
  const unavailable = setup().guard;
  unavailable.destination.stream.getAudioTracks = () => [track];
  await assert.rejects(unavailable.start(() => { throw new Error("must not create"); }, () => true), /unavailable/);
}
const changedFeed = setup().guard;
const preflightStart = changedFeed.start(() => { throw new Error("must not create"); }, () => {
  if (changedFeed.state.state === "ready") changedFeed.destination.stream.getAudioTracks = () => [];
  return true;
});
await assert.rejects(preflightStart, /changed after preflight/);

const frozen = setup().guard;
frozen.wait = async () => {};
await assert.rejects(frozen.start(() => { throw new Error("must not create"); }, () => true), /running audio feed/);
const unreadable = setup().guard;
unreadable.analysers[0].getFloatTimeDomainData = () => {};
await assert.rejects(unreadable.start(() => {}, () => true), /Noise or audio/);
const racing = setup().guard;
let release;
racing.wait = () => release ? Promise.resolve() : new Promise(resolve => { release = resolve; });
const pending = racing.start(() => {}, () => false);
await assert.rejects(racing.start(() => {}, () => true), /already in progress/);
release();
await assert.rejects(pending, /Stop both decks/);

assert.doesNotMatch(deckPage, /deckReviewPanel|initDeckReviewPanel|Current mix \/\/ review|id="takeoverQc"/, "Old readiness/review and QC block is removed");
assert.match(deckPage, /^<!DOCTYPE html>/i, "The deck remains a complete HTML page, not a patch fragment");
assert.match(deckPage, /<\/html>\s*$/);
assert.doesNotMatch(deckPage, /^@@/m);
for (const script of deckPage.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (!/type="application\/ld\+json"/.test(script[0])) new vm.Script(script[1]);
}
assert.match(deckPage, /cueGain\.connect\(context\.destination\)/);
assert.match(deckPage, /gain\.connect\(recorderGuardState\.guard\.musicBus\)/, "Recorder receives only deck music gains");
assert.doesNotMatch(deckPage, /limiter\.connect\(audioEngine\.recordingDestination\)/, "Live master with continuity audio is not recorded");
assert.match(deckPage, /await recorderGuardState\.guard\.start\(/, "Recording starts through the measured preflight gate");
assert.doesNotMatch(deckPage, /recorder\.start\(/, "Deck cannot bypass the isolation start gate");
assert.match(deckPage, /await autoBuildTakeover\(\)/, "Audio upload triggers automatic full-set preparation");
assert.match(deckPage, /recordingState\.starting \|\| recordingState\.recorder\?\.state === "recording"/, "Repeated start requests cannot replace an active recorder");

const buildSource = deckPage.slice(deckPage.indexOf("    async function prepareTakeoverAudio("), deckPage.indexOf("    async function runSetPreflight("));
let requests = [];
let responseMode = "ready";
let backendReport = null;
const buildSandbox = {
  console, Set, Number,
  tracks: [],
  takeoverSession: { name: "DJ HALO", minutes: 30, dj: "halo" },
  takeoverBuildState: { promise: null, signature: "", readySignature: "", revision: 0 },
  recordingState: { takeoverPlan: [], playedTrackIds: new Set(), starting: false },
  audioEngine: { context: { decodeAudioData: async data => { if (data === "bad") throw new Error("corrupt"); return { duration: 60 }; } } },
  elements: { recordingStart: {}, recordingStatus: {}, recordingNote: {}, recordingRig: {}, search: {} },
  ensureAudio: async () => {},
  trackHasPlayableAudio: track => Boolean(track.audioBuffer || track.audioAsset?.file || track.stemAssets),
  preflightTrackPayload: track => ({ id: track.id, title: track.title }),
  fetch: async (url, options) => {
    const payload = JSON.parse(options.body);
    requests.push(payload);
    let orderedTracks = payload.tracks;
    if (responseMode === "missing") orderedTracks = orderedTracks.slice(0, 1);
    if (responseMode === "duplicate") orderedTracks = orderedTracks.map(() => orderedTracks[0]);
    if (responseMode === "foreign") orderedTracks = [{ id: "foreign" }, ...orderedTracks.slice(1)];
    return { ok: true, json: async () => ({ report: backendReport || { status: responseMode, orderedTracks, transitions: [], qualityScore: 90 } }) };
  },
  renderPreflight: () => {}, updateTakeoverQualityControl: () => {},
  renderTracks: () => {}, renderQueue: () => {},
  window: {}, djMode: "club"
};
vm.createContext(buildSandbox);
vm.runInContext(buildSource, buildSandbox);
assert.equal(await buildSandbox.autoBuildTakeover(), false, "Empty library cannot build");
const song = id => ({ id, audioAsset: { file: { arrayBuffer: async () => id === "bad" ? "bad" : "audio" } } });
buildSandbox.tracks.push(song("one"), song("bad"), { id: "empty-stems", stemAssets: {} });
assert.equal(await buildSandbox.autoBuildTakeover(), false, "Files and empty stem objects do not count as decoded playable songs");
assert.equal(requests.length, 0, "Set planner is not called with fewer than two playable songs");
buildSandbox.tracks.push(song("two"), song("three"));
assert.equal(await buildSandbox.autoBuildTakeover(), true);
assert.deepEqual(requests.at(-1).tracks.map(track => track.id), ["one", "two", "three"], "Every decoded playable song enters the full-set build");
assert.deepEqual(Array.from(buildSandbox.recordingState.takeoverPlan), ["one", "two", "three"]);
assert.equal(buildSandbox.tracks.find(track => track.id === "three").duration, 60);
assert.equal(await buildSandbox.autoBuildTakeover(), true);
assert.equal(requests.length, 1, "Prepared set is reused without rebuilding or starting playback");
for (const mode of ["blocked", "missing", "duplicate", "foreign"]) {
  responseMode = mode;
  await assert.rejects(buildSandbox.buildTakeoverPlan(buildSandbox.tracks.filter(track => track.audioBuffer)), /stopped|every playable song/);
}
await assert.rejects(buildSandbox.buildTakeoverPlan([buildSandbox.tracks[0], buildSandbox.tracks[0]]), /at least two playable songs/, "Two copies of one song cannot form a takeover");
const draftSongs = [{ id: "draft-a", bpm: 124 }, { id: "draft-b", bpm: 130 }];
backendReport = analyzeSetPreflight({ tracks: draftSongs });
assert.equal(backendReport.status, "draft");
await buildSandbox.buildTakeoverPlan(draftSongs);
assert.deepEqual(Array.from(buildSandbox.recordingState.takeoverPlan).sort(), ["draft-a", "draft-b"], "Complete non-blocked draft sets remain usable");
backendReport = null;
buildSandbox.takeoverBuildState.readySignature = "";
responseMode = "ready";
buildSandbox.recordingState.recorder = { state: "recording" };
buildSandbox.tracks.push(song("four"));
assert.equal(await buildSandbox.autoBuildTakeover(), false, "Uploads during a recording do not rewrite its locked set");

buildSandbox.recordingState.recorder = null;
buildSandbox.recordingState.starting = true;
const lockedOrder = Array.from(buildSandbox.recordingState.takeoverPlan);
assert.equal(await buildSandbox.autoBuildTakeover(), false, "Mutation-triggered builds are also blocked throughout recorder startup");
assert.deepEqual(Array.from(buildSandbox.recordingState.takeoverPlan), lockedOrder);
buildSandbox.recordingState.starting = false;
assert.equal(await buildSandbox.autoBuildTakeover(), true);

buildSandbox.deckState = { A: { id: "one" }, B: { id: "two" } };
buildSandbox.elements.mixIntent = { value: "hold" };
buildSandbox.setAutomatedCrossfader = () => {};
buildSandbox.scheduleAutomatedTransition = () => {};
buildSandbox.recordingState.takeoverTracks = new Map(buildSandbox.tracks.filter(track => track.audioBuffer).map(track => [track.id, track]));
const sequencing = deckPage.slice(deckPage.indexOf("    function nextTakeoverTrack("), deckPage.indexOf("    async function prepareAutomatedDeck(")) +
  deckPage.slice(deckPage.indexOf("    function startAutomatedMix("), deckPage.indexOf("    function stopAutomatedMix("));
vm.runInContext(sequencing, buildSandbox);
for (let run = 0; run < 2; run += 1) {
  buildSandbox.startAutomatedMix();
  assert.equal(buildSandbox.nextTakeoverTrack().id, "three", "Every recording restarts the prepared song cursor");
  assert.equal(buildSandbox.nextTakeoverTrack().id, "four");
  assert.equal(buildSandbox.nextTakeoverTrack(), null);
}
buildSandbox.tracks = buildSandbox.tracks.filter(track => track.id !== "three");
buildSandbox.startAutomatedMix();
assert.equal(buildSandbox.nextTakeoverTrack().id, "three", "Deleting a library card cannot delete a song from the active recording snapshot");

buildSandbox.window.MediaRecorder = function () {};
buildSandbox.loadTrack = (deck, id, track) => { buildSandbox.deckState[deck] = { ...track, playing: false }; };
buildSandbox.prepareDeckContinuityPreroll = async () => true;
buildSandbox.stopAutomatedMix = () => {};
buildSandbox.stopTakeoverDecks = () => {};
buildSandbox.showToast = () => {};
buildSandbox.clearInterval = () => {};
let created = 0;
buildSandbox.createCompatibleRecorder = () => { created += 1; throw new Error("Unexpected recorder construction"); };
buildSandbox.recorderGuardState = { guard: { start: async factory => {
  buildSandbox.takeoverBuildState.revision += 1;
  return factory({});
} } };
vm.runInContext(deckPage.slice(deckPage.indexOf("    async function startTakeoverRecording("), deckPage.indexOf("    async function publishFinishedMix(")), buildSandbox);
await buildSandbox.startTakeoverRecording();
assert.equal(created, 0, "A library change during quiet-feed preflight blocks recorder construction");
assert.match(buildSandbox.elements.recordingStatus.textContent, /library changed/);
assert.equal(buildSandbox.recordingState.starting, false, "Failed startup releases its lock");

let stoppedDecks = 0;
buildSandbox.deckState.A.playing = true;
buildSandbox.stopTakeoverDecks = () => { stoppedDecks += 1; };
await buildSandbox.startTakeoverRecording();
assert.equal(stoppedDecks, 0, "Failed preflight does not stop existing live playback");
assert.equal(buildSandbox.deckState.A.playing, true);
assert.match(buildSandbox.elements.recordingStatus.textContent, /Stop both decks/);

const watchdogSandbox = {
  window: { HaloRecorderGuard },
  recorderGuardState: { guard: setup().guard },
  recordingState: { failed: false },
  elements: { recordingRig: {}, recordingStatus: {}, recordingStart: {} },
  finishTakeoverRecording: () => { stoppedDecks += 1; },
  setInterval: callback => callback
};
watchdogSandbox.recorderGuardState.guard.destination.stream.getAudioTracks = () => [];
vm.createContext(watchdogSandbox);
vm.runInContext(deckPage.slice(deckPage.indexOf("        recordingState.elapsedTimer = setInterval("), deckPage.indexOf('        showToast("Recording started"')), watchdogSandbox);
watchdogSandbox.recordingState.elapsedTimer();
assert.equal(watchdogSandbox.recordingState.failed, true, "A lost feed stops and discards the active recording");
assert.equal(stoppedDecks, 1);
assert.equal(watchdogSandbox.recorderGuardState.guard.state.state, "blocked");

for (const name of ["triggerKick", "triggerTone", "playBridgeSynth"]) {
  assert.match(deckPage, new RegExp(`function ${name}\\([^\\n]+\\n      if \\(recordingState.starting \\|\\| recordingState.recorder\\?\\.state === "recording"\\) return;`), "Deck-input synthesis cannot enter a recording");
}

const missingProbeSandbox = {
  recorderGuardState: { guard: null },
  audioEngine: { context: { createMediaStreamDestination() {} } },
  elements: { recorderGuard: {} },
  window: { HaloRecorderGuard: Object.assign(function () { throw new Error("Missing stream probe"); }, { renderIndicator() {} }) }
};
vm.createContext(missingProbeSandbox);
vm.runInContext(deckPage.slice(deckPage.indexOf("    function attachRecorderGuardToDeck("), deckPage.indexOf("    async function ensureAudio(")), missingProbeSandbox);
assert.doesNotThrow(() => missingProbeSandbox.attachRecorderGuardToDeck(), "Missing recorder probes cannot prevent normal live playback");
assert.equal(missingProbeSandbox.recorderGuardState.guard, null);
assert.equal(missingProbeSandbox.recorderGuardState.status.state, "blocked");

for (const state of ["idle", "playing", "starting", "recording"]) {
  for (const pendingPlayback of [null, "A"]) {
    let loaded = 0;
    let played = 0;
    let built = 0;
    const uploadSandbox = {
      tracks: [], selectedImportDeck: "A", pendingPlaybackDeck: pendingPlayback,
      deckState: { A: { playing: state === "playing" } },
      recordingState: { starting: state === "starting", recorder: { state: state === "recording" ? "recording" : "inactive" } },
      takeoverBuildState: { revision: 0 },
      elements: { driveButton: {}, folderButton: {}, search: {}, importStatus: { classList: { remove() {}, add() {} } } },
      embeddedArtworkUrl: async () => "",
      renderTracks() {}, updateDeck() {}, showToast() {}, window: {},
      loadTrack: () => { loaded += 1; },
      startDeckAudio: async () => { played += 1; },
      autoBuildTakeover: async () => { built += 1; }
    };
    vm.createContext(uploadSandbox);
    vm.runInContext(deckPage.slice(deckPage.indexOf("    async function handleDriveUpload("), deckPage.indexOf("    syncMaintenanceDockLabel();", deckPage.indexOf("    async function handleDriveUpload("))), uploadSandbox);
    await uploadSandbox.handleDriveUpload({ target: { files: [{ name: "new.wav", type: "audio/wav" }], value: "file" } });
    assert.equal(uploadSandbox.tracks.length, 1, "Uploads still index songs in every state");
    assert.equal(built, 1, "Uploads still request automatic preparation");
    assert.equal(loaded, state === "idle" ? 1 : 0, "Uploads cannot replace live decks or locked recording decks");
    assert.equal(played, state === "idle" && pendingPlayback ? 1 : 0, "Pending upload playback cannot bypass recording locks");
  }
}

console.log("DJ recorder contracts passed: isolated music routing, stereo quiet-feed start gate, and decoded full-set takeover preparation.");
