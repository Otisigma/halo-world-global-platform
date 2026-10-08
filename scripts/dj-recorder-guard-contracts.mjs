import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

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
    createMediaStreamDestination() { return Object.assign(new Node(), { stream: { getAudioTracks: () => [{ readyState: "live" }] } }); },
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
    return { ok: true, json: async () => ({ report: { status: responseMode, orderedTracks, transitions: [], qualityScore: 90 } }) };
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

console.log("DJ recorder contracts passed: isolated music routing, stereo quiet-feed start gate, and decoded full-set takeover preparation.");
