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
  clearInterval() { sandbox.__cleared = true; },
  setTimeout(handler) { return setTimeout(handler, 0); }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(guardSource, sandbox);

const { HaloRecorderGuard, useRecorderGuard } = sandbox;
assert.equal(typeof HaloRecorderGuard, "function", "Recorder guard exports a global constructor");
assert.equal(typeof useRecorderGuard, "function", "Recorder guard exposes a hook-style entry point");
const evaluate = HaloRecorderGuard.evaluate;

const idle = evaluate({ isRecording: false, masterBusLevel: 0.95, cueBusActive: true, activeCueDecks: ["A"] });
assert.equal(idle.isSecureToRecord, false, "An idle recorder cannot claim isolation before preflight");
assert.equal(idle.state, "pending");
assert.equal(idle.bleedDetected, false);
assert.equal(idle.warningMessage, "");

const cleanRecording = evaluate({ isRecording: true, isolationVerified: true, masterBusLevel: 0.95, cueBusActive: false });
assert.equal(cleanRecording.state, "secure", "A verified recorder can capture music");

const quietCue = evaluate({ isRecording: true, isolationVerified: true, masterBusLevel: 0.95, cueBusActive: true, activeCueDecks: ["B"] });
assert.equal(quietCue.state, "secure", "Hot music and monitor-only CUE do not imply capture leakage");
assert.match(quietCue.message, /CUE stays monitor-only/);

const triggered = evaluate({ isolationError: "Recorder quiet-feed preflight detected unexpected audio." });
assert.equal(triggered.state, "triggered", "Preflight failure triggers the guard before recording");
assert.equal(triggered.isSecureToRecord, false);
assert.equal(triggered.bleedDetected, true);
assert.match(triggered.warningMessage, /unexpected audio/, "Warning reports the actual isolation failure");

assert.equal(evaluate({ isRecording: true, masterBusLevel: Number.NaN, cueBusActive: true }).state, "pending", "Invalid levels cannot establish isolation");

for (const state of [idle, cleanRecording, quietCue, triggered]) {
  assert.doesNotMatch(`${state.title} ${state.message || ""} ${state.warningMessage}`, /zero bleed|guarantee|pristine|100% clean/i, "Guard copy never promises absolute silence");
}

let inputs = { isRecording: false, masterBusLevel: 0, cueBusActive: false, activeCueDecks: [] };
const statuses = [];
const guard = useRecorderGuard({ readInputs: () => inputs, onStatusChange: status => statuses.push(status) });
assert.equal(sandbox.__interval, 250, "Guard samples the recorder feed four times per second");
assert.equal(statuses.at(-1).state, "pending", "Guard publishes an unverified initial state");

inputs = { isolationError: "Feed is not quiet." };
guard.tick();
assert.equal(statuses.at(-1).state, "triggered", "Guard publishes the triggered state");

inputs = { isolationVerified: true, isRecording: true, cueBusActive: true };
guard.tick();
assert.equal(statuses.at(-1).state, "secure", "Only a successful preflight clears the guard");
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
assert.equal(title.textContent, "Audio bleed guard triggered");
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
assert.match(deckPage, /isolationVerified: recordingState\.isolationVerified/, "Guard reports the measured preflight result");
assert.match(deckPage, /recorderGuardState\.guard\?\.tick\(\);/, "Cue toggles refresh the guard immediately");
assert.match(deckPage, /cueGain\.connect\(context\.destination\)/, "CUE monitoring stays on the local output path");
assert.match(deckPage, /recordingFeed\?\.connectMusicSource\(gain\)/, "Recorder taps only the deck music gains");
assert.doesNotMatch(deckPage, /(?:masterGain|limiter|cueGain)\.connect\(audioEngine\.recordingDestination\)/, "Master, microphone monitoring and CUE never feed capture");
assert.doesNotMatch(deckPage, /cueGain\.connect\(audioEngine\.recordingDestination\)/, "CUE monitoring is never routed into the recorder");

function deckFunction(name) {
  const start = deckPage.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Deck defines ${name}`);
  const brace = deckPage.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < deckPage.length; index += 1) {
    if (deckPage[index] === "{") depth += 1;
    if (deckPage[index] === "}" && --depth === 0) {
      return `${deckPage.slice(start, index + 1)}`;
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

class AudioNode {
  constructor(context) {
    this.context = context;
    context.nodes.push(this);
    this.connections = [];
    this.outputs = new Map();
    this.signal = 0;
    for (const parameter of ["gain", "threshold", "knee", "ratio", "attack", "release", "frequency", "Q", "delayTime"]) {
      this[parameter] = { value: 1, setValueAtTime(value) { this.value = value; } };
    }
  }
  connect(node, output = 0) { this.connections.push(node); this.outputs.set(node, output); }
  disconnect(node) {
    assert.ok(this.connections.includes(node), "Disconnect targets an existing capture edge");
    this.connections = this.connections.filter(connection => connection !== node);
  }
  getFloatTimeDomainData(samples) {
    this.reads = (this.reads || 0) + 1;
    const signal = (node, visited = new Set(), channel = 0) => {
      if (visited.has(node)) return 0;
      const next = new Set(visited).add(node);
      const ownSignal = Array.isArray(node.signal) ? node.signal[channel] : node.signal;
      return ownSignal + (node.streamDestination ? signal(node.streamDestination, next, channel) : 0) + this.context.nodes
        .filter(source => source.connections.includes(node))
        .reduce((sum, source) => sum + signal(source, next, source.isSplitter ? source.outputs.get(node) : channel), 0);
    };
    samples.fill(this.sampleOverride ?? signal(this));
  }
}
class AudioContext {
  constructor() { this.nodes = []; this.destination = new AudioNode(this); this.currentTime = 0; this.sampleRate = 48000; this.state = "running"; }
  createGain() { return new AudioNode(this); }
  createDynamicsCompressor() { return new AudioNode(this); }
  createAnalyser() { return new AudioNode(this); }
  createBiquadFilter() { return new AudioNode(this); }
  createDelay() { return new AudioNode(this); }
  createChannelSplitter() { const node = new AudioNode(this); node.isSplitter = true; return node; }
  createMediaStreamSource(stream) { const node = new AudioNode(this); node.streamDestination = stream.destination; return node; }
  createMediaStreamDestination() {
    const node = new AudioNode(this);
    node.track = { readyState: "live", enabled: true, muted: false };
    node.stream = { destination: node, getAudioTracks: () => [node.track] };
    return node;
  }
}
const readinessTimers = new Map();
let timerId = 0;
const rig = {
  window: { AudioContext, HaloRecorderGuard },
  audioEngine: { context: null, decks: { A: {}, B: {} } },
  deckState: {},
  elements: { importStatus: { classList: { remove() {} } }, recordingStatus: {} },
  updateAudioCrossfader() {},
  reportAudioHealth() {},
  attachRecorderGuardToDeck() {},
  recorderGuardState: {},
  recordingState: {},
  setTimeout(handler) { const id = ++timerId; readinessTimers.set(id, handler); return id; },
  clearTimeout(id) { readinessTimers.delete(id); },
  fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
};
vm.createContext(rig);
for (const name of ["ensureAudio", "prepareDeckAudio", "verifyTakeoverTracksReady", "verifyTakeoverRecorderIsolation"]) {
  vm.runInContext(`async ${deckFunction(name)}`, rig);
}
await rig.ensureAudio();
const { audioEngine: graph } = rig;
function reaches(source, target, visited = new Set()) {
  if (source === target) return true;
  if (!source || visited.has(source)) return false;
  visited.add(source);
  return source.connections.some(node => reaches(node, target, visited));
}
for (const deck of Object.values(graph.decks)) {
  assert.ok(reaches(deck.input, graph.recordingDestination), "Track output reaches the isolated recording stream");
  assert.ok(reaches(deck.gain, graph.context.destination), "Music still reaches speakers");
  assert.ok(reaches(deck.cueGain, graph.context.destination), "Local cue playback is unchanged");
  assert.equal(reaches(deck.cueGain, graph.recordingDestination), false, "Cue-only output cannot reach recording");
}
const microphone = new AudioNode(graph.context);
microphone.connect(graph.masterGain);
const uiTone = new AudioNode(graph.context);
uiTone.connect(graph.context.destination);
assert.equal(reaches(microphone, graph.recordingDestination), false, "Monitored microphone is excluded from capture");
assert.equal(reaches(uiTone, graph.recordingDestination), false, "Speaker/UI/system feedback is excluded from capture");
assert.equal(reaches(graph.masterGain, graph.recordingDestination), false, "Master output has no path to capture");
const destination = graph.recordingDestination;
await rig.ensureAudio();
assert.equal(graph.recordingDestination, destination, "Repeated starts reuse one isolated graph without duplicate taps");
assert.equal(graph.decks.A.gain.connections.length, 2, "Music gain has one speaker tap and one recorder tap");

assert.deepEqual(graph.recordingGain.connections, [graph.recordingFeed.limiter], "Capture cannot bypass the music limiter");
assert.ok(graph.recordingFeed.limiter.connections.includes(destination), "Only the post-limiter bus feeds the destination");
assert.equal(graph.recordingGain.gain.value, .82, "Recorder headroom is unchanged");
for (const parameter of ["threshold", "knee", "ratio", "attack", "release"]) {
  assert.equal(graph.recordingFeed.limiter[parameter].value, graph.limiter[parameter].value, "Recorder limiter settings are preserved");
}
graph.decks.A.gain.signal = .8;
graph.decks.B.cueGain.signal = .9;
microphone.signal = .7;
uiTone.signal = .6;
const preflight = rig.verifyTakeoverRecorderIsolation();
assert.equal(reaches(graph.decks.A.gain, destination), false, "Only the capture music tap is detached during quiet-feed measurement");
assert.equal(reaches(graph.decks.A.gain, graph.context.destination), true, "Preflight does not mute music speakers");
assert.equal(reaches(graph.decks.B.cueGain, graph.context.destination), true, "Preflight leaves active CUE monitoring untouched");
assert.equal(rig.recordingState.isolationVerified, false, "Preflight remains unverified while sampling");
await preflight;
assert.equal(rig.recordingState.isolationVerified, true);
assert.equal(graph.recordingFeed.analyser.reads, 4, "Preflight measures multiple full analyser windows");
assert.equal(graph.decks.A.gain.connections.length, 2, "Preflight restores exactly one capture tap");

const leak = new AudioNode(graph.context);
leak.signal = .02;
leak.connect(graph.recordingGain);
await assert.rejects(rig.verifyTakeoverRecorderIsolation(), /unexpected audio/, "Unexpected feed signal blocks preflight even without music");
assert.equal(rig.recordingState.isolationVerified, false);
assert.equal(graph.decks.A.gain.connections.length, 2, "Failed preflight restores capture without duplicating speaker routing");
leak.disconnect(graph.recordingGain);
for (const stereoSignal of [[.0002, 0], [0, .0002], [.02, -.02]]) {
  leak.signal = stereoSignal;
  leak.connect(destination);
  await assert.rejects(rig.verifyTakeoverRecorderIsolation(), /unexpected audio/, "Both captured channels detect leakage, including destination bypass and opposite-phase stereo");
  leak.disconnect(destination);
}
leak.signal = .02;
for (const invalid of [Number.NaN, Infinity]) {
  graph.recordingFeed.analyser.sampleOverride = invalid;
  await assert.rejects(rig.verifyTakeoverRecorderIsolation(), /unexpected audio/, "Invalid samples fail closed");
}
delete graph.recordingFeed.analyser.sampleOverride;
destination.track.readyState = "ended";
await assert.rejects(rig.verifyTakeoverRecorderIsolation(), /isolated state/, "An ended stream cannot arm capture");
destination.track.readyState = "live";
graph.context.state = "suspended";
await assert.rejects(rig.verifyTakeoverRecorderIsolation(), /isolated state/, "A suspended graph cannot establish quietness");
graph.context.state = "running";
const musicGain = graph.recordingGain;
graph.recordingGain = graph.masterGain;
await assert.rejects(rig.verifyTakeoverRecorderIsolation(), /routing changed/, "Replacing the music bus with the master bus blocks capture");
graph.recordingGain = musicGain;
const cueGain = graph.decks.B.cueGain;
graph.decks.B.cueGain = graph.decks.A.gain;
await assert.rejects(rig.verifyTakeoverRecorderIsolation(), /isolated state/, "A music source aliased to CUE fails graph validation");
graph.decks.B.cueGain = cueGain;
const changingGraph = rig.verifyTakeoverRecorderIsolation();
const changeAssertion = assert.rejects(changingGraph, /routing changed/, "Routing is revalidated across asynchronous preflight");
graph.recordingDestination = graph.context.destination;
await changeAssertion;
graph.recordingDestination = destination;
await rig.verifyTakeoverRecorderIsolation();
assert.equal(graph.decks.A.gain.connections.length, 2, "Repeated success and failure cannot accumulate capture taps");

const decoded = { duration: 120 };
rig.deckState = { A: { audioBuffer: decoded }, B: { audioBuffer: decoded } };
await rig.verifyTakeoverTracksReady();
assert.equal(readinessTimers.size, 0, "Cached buffers pass readiness and clear the timeout");

let finishDecode;
let decodeCalls = 0;
graph.context.decodeAudioData = () => {
  decodeCalls += 1;
  return new Promise(resolve => { finishDecode = resolve; });
};
const fileTrack = { title: "Opening track", audioAsset: { file: { arrayBuffer: async () => new ArrayBuffer(8) } } };
rig.deckState.A = fileTrack;
let ready = false;
const loading = rig.verifyTakeoverTracksReady().then(() => { ready = true; });
await new Promise(resolve => setImmediate(resolve));
assert.equal(ready, false, "Readiness stays pending until decoding completes, not just until a file exists");
const sameLoad = rig.prepareDeckAudio(graph.context, "A");
assert.equal(decodeCalls, 1, "Concurrent readiness checks share the decode promise");
finishDecode(decoded);
await Promise.all([loading, sameLoad]);
assert.equal(fileTrack.audioBuffer, decoded, "The decoded buffer is cached for playback");
assert.equal(readinessTimers.size, 0, "Successful decode removes the timeout");

const stemResolvers = [];
graph.context.decodeAudioData = () => new Promise(resolve => stemResolvers.push(resolve));
rig.deckState.A = { stemAssets: { drums: { url: "/drums.wav" }, vocals: { url: "/vocals.wav" } } };
ready = false;
const stemLoad = rig.verifyTakeoverTracksReady().then(() => { ready = true; });
await new Promise(resolve => setImmediate(resolve));
stemResolvers[0](decoded);
await new Promise(resolve => setImmediate(resolve));
assert.equal(ready, false, "Every stem must decode before the recorder is ready");
stemResolvers[1](decoded);
await stemLoad;
assert.equal(ready, true);

graph.context.decodeAudioData = async () => { throw new Error("Decode failed"); };
rig.deckState.A = { ...fileTrack, audioBuffer: null, audioAsset: { file: fileTrack.audioAsset.file } };
await assert.rejects(rig.verifyTakeoverTracksReady(), /Decode failed/, "Decode failure blocks capture");
assert.equal(rig.deckState.A.audioAsset.promise, null, "Failed decoding clears the shared promise for retry");
assert.equal(readinessTimers.size, 0, "Failed decoding clears the readiness timeout");
graph.context.decodeAudioData = async () => decoded;
await rig.verifyTakeoverTracksReady();

rig.deckState.A = { stemAssets: {} };
await assert.rejects(rig.verifyTakeoverTracksReady(), /no playable stems/, "An empty stem pack cannot pass readiness");

rig.deckState.A = { audioAsset: { file: { arrayBuffer: () => new Promise(() => {}) } } };
const timedOut = rig.verifyTakeoverTracksReady();
const timeoutAssertion = assert.rejects(timedOut, /timed out/, "A stalled load blocks recording with actionable feedback");
readinessTimers.values().next().value();
await timeoutAssertion;
assert.equal(readinessTimers.size, 0, "Timeout rejection removes its timer");

let finishFile;
rig.deckState.A = { audioAsset: { file: { arrayBuffer: () => new Promise(resolve => { finishFile = resolve; }) } } };
const changedTrack = rig.verifyTakeoverTracksReady();
rig.deckState.A = { audioBuffer: decoded };
finishFile(new ArrayBuffer(8));
await assert.rejects(changedTrack, /changed while loading/, "Replacing a track during decode cannot arm stale capture");

const startSource = deckFunction("startTakeoverRecording");
let recorderCount = 0;
let captureStarted = false;
rig.window.MediaRecorder = class {};
Object.assign(rig, {
  takeoverSession: { name: "HALO", dj: "halo", minutes: 1 },
  recordingState: {},
  document: { querySelector: () => ({ textContent: "" }) },
  buildTakeoverPlan: async () => {},
  trackHasPlayableAudio: () => true,
  createCompatibleRecorder(stream) {
    assert.equal(stream, graph.recordingDestination.stream, "Transport uses only the isolated music stream");
    recorderCount += 1;
    return {
      state: "inactive",
      addEventListener() {},
      start() { this.state = "recording"; captureStarted = true; },
      stop() { this.state = "inactive"; }
    };
  },
  syncDecks() {},
  setAutomatedCrossfader() {},
  stopDeckAudio() {},
  startDeckAudio: async () => {},
  updateDeck() {},
  startAutomatedMix() {},
  stopAutomatedMix() {},
  stopTakeoverDecks() {},
  updateRecordingProgress() {},
  showToast() {},
  setInterval: () => 1,
  clearInterval() {}
});
Object.assign(rig.elements, { recordingStart: {}, recordingRig: {}, recordingNote: {} });
vm.runInContext(`async ${startSource}`, rig);
graph.context.decodeAudioData = () => new Promise(resolve => { finishDecode = resolve; });
rig.deckState = {
  A: { audioAsset: { file: fileTrack.audioAsset.file } },
  B: { audioBuffer: decoded }
};
const starting = rig.startTakeoverRecording();
await new Promise(resolve => setImmediate(resolve));
assert.equal(recorderCount, 0, "A loading track prevents MediaRecorder construction");
assert.equal(captureStarted, false, "No capture begins while decoding is pending");
assert.equal(rig.elements.recordingStart.disabled, true, "Start control stays disabled during readiness checks");
await rig.startTakeoverRecording();
assert.equal(recorderCount, 0, "A repeated start request cannot bypass readiness");
finishDecode(decoded);
await starting;
assert.equal(recorderCount, 1);
assert.equal(captureStarted, true, "Transport starts capture after decoding completes");
assert.equal(rig.recordingState.starting, false);

rig.recordingState.recorder.stop();
captureStarted = false;
graph.context.decodeAudioData = async () => { throw new Error("Decode failed"); };
rig.deckState.A = { audioAsset: { file: fileTrack.audioAsset.file } };
await rig.startTakeoverRecording();
assert.equal(recorderCount, 1, "Decode failures never construct another recorder");
assert.equal(captureStarted, false);
assert.equal(rig.elements.recordingStart.disabled, false, "Readiness failures allow retry");
assert.match(rig.elements.recordingStatus.textContent, /Decode failed/, "Readiness failures reach the UI");

graph.context.decodeAudioData = async () => decoded;
rig.deckState.A = { audioBuffer: decoded };
leak.connect(graph.recordingGain);
await rig.startTakeoverRecording();
assert.equal(recorderCount, 1, "A non-quiet feed blocks even MediaRecorder construction");
assert.equal(captureStarted, false, "No capture starts after failed isolation preflight");
assert.match(rig.elements.recordingStatus.textContent, /unexpected audio/, "Isolation errors reach the existing recorder status");
assert.equal(rig.elements.recordingStart.disabled, false, "Isolation failure allows a clean retry");
leak.disconnect(graph.recordingGain);

const originalRead = graph.recordingFeed.analyser.getFloatTimeDomainData;
graph.recordingFeed.analyser.getFloatTimeDomainData = function (samples) {
  originalRead.call(this, samples);
  rig.deckState.A = { audioBuffer: decoded };
};
await rig.startTakeoverRecording();
assert.equal(recorderCount, 1, "Track replacement during asynchronous preflight cannot arm stale capture");
assert.match(rig.elements.recordingStatus.textContent, /tracks changed during recorder preflight/);
graph.recordingFeed.analyser.getFloatTimeDomainData = originalRead;
await rig.startTakeoverRecording();
assert.equal(recorderCount, 2, "A retry constructs a recorder only after a new preflight passes");
assert.equal(captureStarted, true);
assert.equal(graph.decks.A.gain.connections.length, 2, "Repeated recording starts retain exactly one music capture tap");

assert.ok(startSource.indexOf("await verifyTakeoverTracksReady()") < startSource.indexOf("createCompatibleRecorder("), "Readiness precedes even recorder construction");
assert.ok(startSource.indexOf("await verifyTakeoverTracksReady()") < startSource.indexOf("recorder.start("), "Readiness precedes capture start");
assert.ok(startSource.indexOf("await verifyTakeoverRecorderIsolation()") < startSource.indexOf("createCompatibleRecorder("), "Quiet-feed isolation precedes arming");
assert.ok(startSource.indexOf("await verifyTakeoverRecorderIsolation()") < startSource.indexOf("recorder.start("), "Quiet-feed isolation precedes capture start");
assert.match(startSource, /recordingState\.starting/, "Concurrent start requests cannot create duplicate recorders");
assert.match(startSource, /finally\s*\{\s*recordingState\.starting = false/, "Failed starts can be retried");

console.log("DJ recorder guard contracts: post-limiter music capture, monitor-only CUE, quiet-feed preflight, fail-closed transport, readiness, and repeat starts passed.");
