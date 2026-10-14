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
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(guardSource, sandbox);

const { HaloRecorderGuard, useRecorderGuard } = sandbox;
assert.equal(typeof HaloRecorderGuard, "function", "Recorder guard exports a global constructor");
assert.equal(typeof useRecorderGuard, "function", "Recorder guard exposes a hook-style entry point");
const evaluate = HaloRecorderGuard.evaluate;

const idle = evaluate({ isRecording: false, masterBusLevel: 0.95, cueBusActive: true, activeCueDecks: ["A"] });
assert.equal(idle.isSecureToRecord, true, "Guard stays secure while the recorder is not running");
assert.equal(idle.bleedDetected, false);
assert.equal(idle.warningMessage, "");

const cleanRecording = evaluate({ isRecording: true, masterBusLevel: 0.95, cueBusActive: false });
assert.equal(cleanRecording.state, "secure", "Hot master without cue monitoring is not a bleed condition");

const quietCue = evaluate({ isRecording: true, masterBusLevel: 0.5, cueBusActive: true, activeCueDecks: ["B"] });
assert.equal(quietCue.state, "secure", "Cue monitoring below the master limit stays secure");
assert.match(quietCue.message, /Deck B/, "Secure copy still names the active cue deck");

const triggered = evaluate({ isRecording: true, masterBusLevel: 0.92, cueBusActive: true, activeCueDecks: ["A", "B"] });
assert.equal(triggered.state, "triggered", "Recording + active cue + master near limit triggers the guard");
assert.equal(triggered.isSecureToRecord, false);
assert.equal(triggered.bleedDetected, true);
assert.match(triggered.warningMessage, /Deck A and Deck B/, "Warning names the cue decks");
assert.match(triggered.warningMessage, /92%/, "Warning reports the master level");
assert.match(triggered.warningMessage, /Release CUE/, "Warning is actionable");

assert.equal(evaluate({ isRecording: true, masterBusLevel: Number.NaN, cueBusActive: true }).state, "secure", "Invalid levels are treated as silence");
assert.equal(evaluate({ isRecording: true, masterBusLevel: 0.8, cueBusActive: true }).state, "secure", "The configured limit itself is not exceeded");
assert.equal(evaluate({ isRecording: true, masterBusLevel: 0.7, cueBusActive: true }, { masterLimit: 0.6 }).state, "triggered", "The master limit is configurable");

for (const state of [idle, cleanRecording, quietCue, triggered]) {
  assert.doesNotMatch(`${state.title} ${state.message || ""} ${state.warningMessage}`, /zero bleed|guarantee|pristine|100% clean/i, "Guard copy never promises absolute silence");
}

let clock = 0;
let inputs = { isRecording: false, masterBusLevel: 0, cueBusActive: false, activeCueDecks: [] };
const statuses = [];
const guard = useRecorderGuard({ readInputs: () => inputs, onStatusChange: status => statuses.push(status), now: () => clock });
assert.equal(sandbox.__interval, 250, "Guard samples the recorder feed four times per second");
assert.equal(statuses.at(-1).state, "secure", "Guard publishes an initial secure state");

inputs = { isRecording: true, masterBusLevel: 0.9, cueBusActive: true, activeCueDecks: ["A"] };
guard.tick();
assert.equal(statuses.at(-1).state, "triggered", "Guard publishes the triggered state");

clock = 500;
inputs = { ...inputs, masterBusLevel: 0.4 };
guard.tick();
assert.equal(guard.state.state, "triggered", "Warning is held briefly so transient peaks do not flicker");
assert.match(guard.state.warningMessage, /90%/, "Held warning keeps the last hot peak");

clock = 700;
inputs = { ...inputs, activeCueDecks: ["B"] };
guard.tick();
assert.equal(statuses.at(-1).state, "triggered");
assert.match(statuses.at(-1).warningMessage, /Deck B/, "Held warning follows the cue deck that is active now");
assert.doesNotMatch(statuses.at(-1).warningMessage, /Deck A/);

clock = 2500;
guard.tick();
assert.equal(statuses.at(-1).state, "secure", "Guard clears once the hold window passes");

inputs = { isRecording: true, masterBusLevel: 0.9, cueBusActive: true, activeCueDecks: ["A"] };
clock = 3000;
guard.tick();
inputs = { isRecording: true, masterBusLevel: 0.9, cueBusActive: false, activeCueDecks: [] };
clock = 3100;
guard.tick();
assert.equal(statuses.at(-1).state, "secure", "Releasing CUE clears the guard immediately");
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
assert.match(deckPage, /masterBusLevel: isRecording && cueBusActive \? recorderGuardMasterLevel\(\) : 0/, "Guard reads the master bus level only when it can affect the result");
assert.match(deckPage, /recorderGuardState\.guard\?\.tick\(\);/, "Cue toggles refresh the guard immediately");
assert.match(deckPage, /cueGain\.connect\(context\.destination\)/, "CUE monitoring stays on the local output path");
assert.match(deckPage, /gain\.connect\(audioEngine\.recordingGain\)/, "Recorder taps only the deck music gains");
assert.match(deckPage, /recordingGain\.connect\(recordingLimiter\)/, "Music capture retains its own level and limiter");
assert.match(deckPage, /recordingLimiter\.connect\(audioEngine\.recordingDestination\)/, "Recorder uses a dedicated music destination");
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
  constructor() {
    this.connections = [];
    for (const parameter of ["gain", "threshold", "knee", "ratio", "attack", "release", "frequency", "Q", "delayTime"]) {
      this[parameter] = { value: 1, setValueAtTime(value) { this.value = value; } };
    }
  }
  connect(node) { this.connections.push(node); }
}
class AudioContext {
  constructor() { this.destination = new AudioNode(); this.currentTime = 0; this.state = "running"; }
  createGain() { return new AudioNode(); }
  createDynamicsCompressor() { return new AudioNode(); }
  createAnalyser() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createDelay() { return new AudioNode(); }
  createMediaStreamDestination() { const node = new AudioNode(); node.stream = {}; return node; }
}
const readinessTimers = new Map();
let timerId = 0;
const rig = {
  window: { AudioContext },
  audioEngine: { context: null, decks: { A: {}, B: {} } },
  deckState: {},
  elements: { importStatus: { classList: { remove() {} } }, recordingStatus: {} },
  updateAudioCrossfader() {},
  reportAudioHealth() {},
  attachRecorderGuardToDeck() {},
  setTimeout(handler) { const id = ++timerId; readinessTimers.set(id, handler); return id; },
  clearTimeout(id) { readinessTimers.delete(id); },
  fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
};
vm.createContext(rig);
for (const name of ["ensureAudio", "prepareDeckAudio", "verifyTakeoverTracksReady"]) {
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
const microphone = new AudioNode();
microphone.connect(graph.masterGain);
const uiTone = new AudioNode();
uiTone.connect(graph.context.destination);
assert.equal(reaches(microphone, graph.recordingDestination), false, "Monitored microphone is excluded from capture");
assert.equal(reaches(uiTone, graph.recordingDestination), false, "Speaker/UI/system feedback is excluded from capture");
assert.equal(reaches(graph.masterGain, graph.recordingDestination), false, "Master output has no path to capture");
const destination = graph.recordingDestination;
await rig.ensureAudio();
assert.equal(graph.recordingDestination, destination, "Repeated starts reuse one isolated graph without duplicate taps");
assert.equal(graph.decks.A.gain.connections.length, 2, "Music gain has one speaker tap and one recorder tap");

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

assert.ok(startSource.indexOf("await verifyTakeoverTracksReady()") < startSource.indexOf("createCompatibleRecorder("), "Readiness precedes even recorder construction");
assert.ok(startSource.indexOf("await verifyTakeoverTracksReady()") < startSource.indexOf("recorder.start("), "Readiness precedes capture start");
assert.match(startSource, /recordingState\.starting/, "Concurrent start requests cannot create duplicate recorders");
assert.match(startSource, /finally\s*\{\s*recordingState\.starting = false/, "Failed starts can be retried");

console.log("DJ recorder guard contracts: isolated graph, decoded readiness, transport gating, bleed detection, and indicator rendering passed.");
