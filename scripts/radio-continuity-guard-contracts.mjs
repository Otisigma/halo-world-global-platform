import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [guardSource, radioPage, radioClient, deckPage, telemetryApi, audioEngineSource] = await Promise.all([
  readFile(new URL("../dj-continuity-guard.js", import.meta.url), "utf8"),
  readFile(new URL("../radio/index.html", import.meta.url), "utf8"),
  readFile(new URL("../radio/radio.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/telemetry.mjs", import.meta.url), "utf8"),
  readFile(new URL("../services/haloAudioEngine.js", import.meta.url), "utf8")
]);

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const braceStart = source.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(source.slice(start - 6, start) === "async " ? start - 6 : start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

let scheduledIntervalMs = 0;
const sandbox = {
  console,
  globalThis: null,
  setInterval(handler, interval) {
    scheduledIntervalMs = interval;
    sandbox.__intervalHandler = handler;
    return 1;
  },
  clearInterval() {},
  haloStats: { track() {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(guardSource, sandbox);

assert.equal(typeof sandbox.HaloContinuityGuard, "function", "Continuity guard exports a global constructor");

const statuses = [];
const telemetry = [];
const filler = [];
let playbackExpected = true;
let levelDb = -12;
let boundary = null;

const guard = new sandbox.HaloContinuityGuard({
  config: {
    maxAllowedSilenceMs: 250,
    recoveryHoldMs: 200
  },
  isPlaybackExpected: () => playbackExpected,
  getLevelDb: () => levelDb,
  getBoundaryState: () => boundary,
  onPreroll: detail => telemetry.push({ type: "preroll-callback", detail }),
  onCriticalBoundary: detail => telemetry.push({ type: "critical-callback", detail }),
  startFiller: detail => filler.push({ type: "start", detail }),
  stopFiller: detail => filler.push({ type: "stop", detail }),
  onTelemetry: detail => telemetry.push(detail),
  onStatusChange: detail => statuses.push(detail)
}).init();

assert.equal(scheduledIntervalMs, 100, "Continuity guard samples at least 10Hz by default");

boundary = {
  activeDeckId: "A",
  incomingDeckId: "B",
  incomingReady: true,
  remainingSec: 10
};
guard.tick();
assert.ok(telemetry.some(event => event.event === "preroll_started"), "Predictive pre-roll triggers before the boundary");

boundary = {
  activeDeckId: "A",
  incomingDeckId: "B",
  incomingReady: false,
  remainingSec: 3
};
guard.tick();
assert.equal(guard.fillerActive, true, "Filler bridge engages at the critical boundary when the incoming deck is unready");
assert.ok(filler.some(event => event.type === "start"), "Critical boundary starts the bridge immediately");

boundary = null;
levelDb = -100;
guard.fillerActive = false;
guard.silentDurationMs = 0;
guard.recoveryDurationMs = 0;
guard.tick();
guard.tick();
assert.equal(guard.fillerActive, false, "Playback can tolerate brief low signal inside the window");
guard.tick();
assert.equal(guard.fillerActive, true, "Active playback cannot remain silent beyond the configured maximum silence window");
assert.ok(telemetry.some(event => event.event === "filler_engaged" && event.reason === "silence_watchdog"), "Silence watchdog telemetry is emitted");

playbackExpected = false;
levelDb = -12;
guard.tick();
assert.equal(guard.fillerActive, false, "Explicit pause behavior is preserved and clears the bridge");
assert.equal(statuses.at(-1)?.state, "idle", "Idle status is restored when playback is not expected");

assert.match(radioPage, /id="continuityStatus"/, "Radio UI exposes continuity status");
assert.match(radioPage, /id="continuityTelemetry"/, "Radio UI exposes continuity telemetry");
assert.match(radioClient, /window\.__haloRadioContinuity/, "Radio client exports continuity monitor state");
assert.match(radioClient, /Continuity Guard/, "Radio monitoring rail names the continuity guard");
assert.match(radioClient, /radio_continuity_bridge/, "Radio telemetry tracks bridge activation");
assert.match(deckPage, /\/dj-continuity-guard\.js/, "DJ deck loads the shared continuity guard");
assert.match(deckPage, /CONTINUITY BRIDGE ACTIVE/, "DJ deck master status exposes bridge activity");
assert.match(deckPage, /continuity: \{ \.\.\.audioHealth\.continuity \}/, "DJ deck audio health payload carries continuity state");
assert.match(telemetryApi, /telemetry\.continuity/, "Telemetry API accepts continuity state");

const deckSandbox = {
  guardOptions: null,
  startFillerCalls: 0,
  stopFillerCalls: 0,
  qcCalls: [],
  reportCalls: [],
  updateTakeoverQualityControlCalls: 0,
  continuityState: { guard: null, analyser: null, analyserData: null, fillerGain: null, fillerNodes: [], fillerTimeout: 0 },
  audioEngine: {
    context: {
      destination: {},
      createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, connect() {} }; },
      createGain() { return { gain: { value: 1 }, connect() {} }; }
    },
    masterGain: { connect() {} },
    decks: { A: { gain: { connect() {} } }, B: { gain: { connect() {} } } }
  },
  audioHealth: {
    status: "ready",
    message: "Audio engine is running and checking deck output.",
    continuity: { state: "idle", message: "Continuity guard standing by.", fillerActive: false, recoveries: 0 }
  },
  recordingState: { takeoverPlan: [], playedTrackIds: new Set(), qualityScore: 88 },
  deckState: {
    A: { title: "Alpha", artist: "Artist A", bpm: 124, playing: true, empty: false },
    B: { title: "Beta", artist: "Artist B", bpm: 125, playing: false, empty: false }
  },
  elements: {
    qcContinuity: { classList: { toggle() {} } },
    qcContinuityValue: { textContent: "" },
    masterBpm: { textContent: "" },
    masterTrack: { textContent: "" },
    masterStatus: { dataset: {}, textContent: "" }
  },
  window: {
    HaloContinuityGuard: class {
      constructor(options) { deckSandbox.guardOptions = options; }
      init() { return this; }
    },
    haloStats: { track() {} }
  },
  setQcCheck(container, output, status, message) {
    output.textContent = message;
    deckSandbox.qcCalls.push({ status, message });
  },
  updateTakeoverQualityControl() {
    deckSandbox.updateTakeoverQualityControlCalls += 1;
  },
  reportAudioHealth(status, message) {
    deckSandbox.reportCalls.push({ status, message });
  },
  activeDeckId() {
    return deckSandbox.deckState.A.playing ? "A" : "B";
  },
  startDeckContinuityFiller() {
    deckSandbox.startFillerCalls += 1;
  },
  stopDeckContinuityFiller() {
    deckSandbox.stopFillerCalls += 1;
  },
  prepareDeckContinuityPreroll() { return Promise.resolve(); },
  deckContinuityLevelDb() { return -24; },
  deckContinuityBoundaryState() {
    return { activeDeckId: "A", incomingDeckId: "B", remainingSec: 3, incomingReady: false };
  }
};
vm.createContext(deckSandbox);
vm.runInContext([
  extractFunctionSource(deckPage, "continuityStatusLabel"),
  extractFunctionSource(deckPage, "updateMasterReadout"),
  extractFunctionSource(deckPage, "attachContinuityGuardToDeck")
].join("\n\n"), deckSandbox);

deckSandbox.attachContinuityGuardToDeck();
assert.equal(typeof deckSandbox.guardOptions?.onStatusChange, "function", "DJ deck wiring registers continuity status callbacks");
deckSandbox.guardOptions.startFiller({ reason: "silence_watchdog" });
assert.equal(deckSandbox.startFillerCalls, 1, "DJ deck wiring forwards filler activation to the deck bridge");
deckSandbox.guardOptions.stopFiller({ reason: "audio_recovered" });
assert.equal(deckSandbox.stopFillerCalls, 1, "DJ deck wiring forwards filler release to the deck bridge");
deckSandbox.guardOptions.onStatusChange({
  state: "bridge-active",
  message: "Continuity guard active. Audible bridge engaged.",
  fillerActive: true,
  recoveries: 2
});
assert.equal(deckSandbox.audioHealth.continuity.state, "bridge-active", "DJ deck stores continuity state in audio health");
assert.match(deckSandbox.elements.masterStatus.textContent, /CONTINUITY BRIDGE ACTIVE/, "DJ master readout shows bridge state");
assert.equal(deckSandbox.elements.masterStatus.dataset.continuityState, "bridge-active", "DJ master readout publishes continuity state for UI hooks");
deckSandbox.guardOptions.onStatusChange({
  state: "normal",
  message: "Continuity guard locked. Audio recovered.",
  fillerActive: false,
  recoveries: 2
});
assert.ok(deckSandbox.updateTakeoverQualityControlCalls > 0, "DJ deck returns continuity control to the standard quality monitor after recovery");
assert.ok(deckSandbox.reportCalls.length >= 2, "DJ deck republishes continuity updates through audio health events");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

async function createDeckHarness() {
  let clock = 10000;
  let timerId = 0;
  const timers = new Map();
  const sources = [];
  class Param {
    constructor(value = 1) { this.value = value; this.events = []; }
    cancelScheduledValues(time) { this.events.push(["cancel", time]); }
    setValueAtTime(value, time) { this.value = value; this.events.push(["set", value, time]); }
    setTargetAtTime(value, time) { this.value = value; this.events.push(["target", value, time]); }
    exponentialRampToValueAtTime(value, time) {
      assert.ok(value > 0);
      this.value = value;
      this.events.push(["ramp", value, time]);
    }
  }
  class Node {
    constructor() {
      this.inputs = [];
      this.outputs = [];
      for (const name of ["gain", "frequency", "Q", "delayTime", "threshold", "knee", "ratio", "attack", "release", "playbackRate"]) this[name] = new Param();
      this.fftSize = 512;
      this.handlers = [];
    }
    connect(node) { node.inputs.push(this); this.outputs.push(node); return node; }
    disconnect(target) {
      for (const node of this.outputs.filter(node => !target || node === target)) node.inputs = node.inputs.filter(input => input !== this);
      this.outputs = target ? this.outputs.filter(node => node !== target) : [];
      this.disconnected = true;
    }
    sample(seen = new Set()) {
      if (seen.has(this)) return 0;
      const next = new Set(seen).add(this);
      if (this.isSource) return this.started != null && this.started <= clock / 1000 && (this.stopped == null || this.stopped > clock / 1000)
        ? (this.buffer?.signal ?? .2) : 0;
      return this.inputs.reduce((sum, node) => sum + node.sample(next), 0) * (this.isGain ? this.gain.value : 1);
    }
    getFloatTimeDomainData(data) { data.fill(this.sample()); }
    addEventListener(type, callback) { if (type === "ended") this.handlers.push(callback); }
    start(when) { this.started = when; }
    stop(when = clock / 1000) { this.stops ||= []; this.stops.push(when); this.stopped = when; }
  }
  class Context {
    constructor() { this.state = "running"; this.destination = new Node(); }
    get currentTime() { return clock / 1000; }
    createGain() { const node = new Node(); node.isGain = true; return node; }
    createAnalyser() { return new Node(); }
    createBiquadFilter() { return new Node(); }
    createDynamicsCompressor() { return new Node(); }
    createDelay() { return new Node(); }
    createMediaStreamDestination() { return new Node(); }
    createBufferSource() { const node = new Node(); node.isSource = true; sources.push(node); return node; }
    createOscillator() { return this.createBufferSource(); }
    async resume() { this.state = "running"; }
    async decodeAudioData(bytes) { return bytes; }
  }
  const channel = () => ({
    source: null, stemSources: {}, stemGains: {}, stems: { bass: true, hats: true, vocals: true },
    playbackGeneration: 0, level: 0
  });
  const env = {
    console, Float32Array, Uint8Array, Map, Set,
    Date: { now: () => clock }, performance: { now: () => clock },
    audioEngine: { context: null, masterGain: null, decks: { A: channel(), B: channel() }, shutdown: false, lifecycleGeneration: 0 },
    continuityState: { guard: null, fillerInstance: null, fillerInstances: new Set(), fillerNodes: [], fillerTimeout: 0 },
    recordingState: {
      automationGeneration: 0, pendingHandoff: null, cancelFade: null, effectTimers: [],
      recorder: { state: "recording" }, activeDeck: "A", playedTrackIds: new Set(), transitionHistory: [], takeoverPlan: [], transitionCount: 0
    },
    recorderGuardState: { guard: null },
    selectedImportDeck: "A", pendingPlaybackDeck: null, pendingAudioRequest: null,
    audioImportGeneration: 0, trackImportGeneration: 0,
    deckState: {
      A: { id: "a", title: "A", bpm: 120, originalBpm: 120, duration: 100, playing: false, audioBuffer: { duration: 100, signal: .2 } },
      B: { id: "b", title: "B", bpm: 120, originalBpm: 120, duration: 100, playing: false, audioBuffer: { duration: 100, signal: .2 } }
    },
    audioHealth: { status: "ready", message: "", continuity: {} },
    elements: {
      crossfader: { value: "0" }, importStatus: { classList: { remove() {}, add() {} }, textContent: "" },
      driveButton: { disabled: false, textContent: "" }, folderButton: { disabled: false },
      importButton: { disabled: false, textContent: "" }, musicUrl: { value: "" },
      driveUpload: { click() {} }, folderUpload: { click() {} }, search: { value: "" },
      recordingStatus: { textContent: "" }, recordingNote: { textContent: "" },
      recordingStart: { disabled: false }, recordingRig: { className: "" },
      performancePolicyCopy: { textContent: "" }
    },
    document: { querySelectorAll: () => [], querySelector: () => ({ value: 0, style: {}, textContent: "", classList: { toggle() {} }, setAttribute() {} }) },
    window: { AudioContext: Context, haloStats: { track() {} } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, at: clock + delay, cleared: false }); return id; },
    clearTimeout(id) { if (timers.has(id)) timers.get(id).cleared = true; },
    setInterval() { return ++timerId; }, clearInterval() {},
    requestAnimationFrame(callback) { return env.setTimeout(() => callback(clock), 16); },
    cancelAnimationFrame(id) { env.clearTimeout(id); },
    reportAudioHealth() {}, updateTakeoverQualityControl() {}, updateMasterReadout() {}, updateDeck() {}, updateBoothDisplay() {}, renderTracks() {},
    setQcCheck() {}, showToast() {}, updateRangeFill() {},
    activeDeckId: () => "A", renderBreathPlan() {}, setActiveBreathStage() {}, setPerformancePhase() {},
    scheduleBreathStages() {}, recordTransitionObservation() {}, prepareAutomatedDeck: async () => true, formatRecordingTime: String,
    beatPhaseOffset: () => .2, tracks: [], EMPTY_TRACK: { title: "Empty", empty: true, playing: false },
    modeProfiles: { club: { policy: "policy" } }, djMode: "club", takeoverSession: { name: "HALO", dj: "halo" },
    createTransitionPlan: () => ({ style: "loop-lock", loopLock: true, hardCut: true, cleanPlay: 1, effectWindow: 1, transition: 32, bars: 2, effectMove: "vocals", breathPlan: { release: "release" } })
  };
  Object.assign(env.window, { setTimeout: env.setTimeout, clearTimeout: env.clearTimeout, setInterval: env.setInterval, clearInterval: env.clearInterval });
  vm.createContext(env);
  vm.runInContext(guardSource, env);
  vm.runInContext(audioEngineSource, env);
  const functions = [
    "cleanupDeckContinuityFillerNodes", "stopDeckContinuityFiller", "startDeckContinuityFiller",
    "deckContinuityLevelDb", "deckContinuityReady", "deckHandoffConfirmed", "cancelDeckHandoff",
    "waitForDeckHandoff", "deckHandoffCurrent", "deckPlaybackAbort", "deckPlaybackFailureCurrent", "decodeDeckAsset", "prepareDeckContinuityPreroll",
    "deckContinuityBoundaryState", "attachContinuityGuardToDeck", "recorderGuardMasterLevel",
    "ensureAudio", "updateAudioCrossfader", "matchDeckLevels", "stopDeckAudio", "startDeckAudio", "createDeckRecordingTap", "startDeckSource",
    "startDeckAudioSources", "restoreDeckStems", "setStemState", "setCueMonitor", "resetDeckEffects", "loadTrack",
    "ejectDeck", "setAutomatedCrossfader", "animateAutomatedCrossfader", "queuePerformanceMove",
    "loopOutgoingTail", "openTransitionPlan", "moveTransitionPlan", "scheduleAutomatedTransition",
    "playPercussionBridge", "dropDrumsBridge", "triggerKick",
    "stopAutomatedMix", "stopTakeoverDecks", "shutdownDeckPage", "finishTakeoverRecording",
    "trackDeckAuxiliarySource", "triggerTone", "cancelTakeoverStartupRecorder", "startTakeoverRecording",
    "captureDeckImportTarget", "deckImportTargetCurrent", "selectDeckAudioFiles", "requestTrackAudio",
    "handleDriveUpload", "importTrack"
  ];
  vm.runInContext(functions.map(name => extractFunctionSource(deckPage, name)).join("\n\n"), env);
  await env.ensureAudio();
  return {
    env, timers, sources,
    async runTimer(id, evenIfCleared = false) {
      const timer = timers.get(id);
      assert.ok(timer, `Missing timer ${id}`);
      if (timer.cleared && !evenIfCleared) return;
      timer.cleared = true;
      clock = Math.max(clock, timer.at);
      const result = timer.callback();
      result?.catch(error => { env.callbackError = error; });
      await settle();
      if (env.callbackError) throw env.callbackError;
      return { result };
    },
    async nextTimer() {
      const next = [...timers].filter(([, timer]) => !timer.cleared).sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, "Expected a pending timer");
      return this.runTimer(next[0]);
    },
    advance(ms) { clock += ms; }
  };
}

// The program tap cannot hear filler or cue-only material; the recorder tap still can.
{
  const { env } = await createDeckHarness();
  env.deckState.A.playing = true;
  const continuity = env.continuityState.guard;
  continuity.tick();
  continuity.tick();
  assert.equal(continuity.fillerActive, true);
  assert.ok(env.recorderGuardMasterLevel() > .01, "The master recorder meter retains filler");
  for (let index = 0; index < 8; index += 1) continuity.tick();
  assert.equal(continuity.fillerActive, true, "Filler cannot recover the guard from its own signal");
  await env.startDeckAudio("B");
  env.audioEngine.decks.B.cueGain.gain.value = .42;
  for (let index = 0; index < 8; index += 1) continuity.tick();
  assert.equal(continuity.fillerActive, true, "Muted/cue-only incoming audio cannot count as program recovery");
  assert.equal(env.deckHandoffConfirmed("B", false), true, "Muted incoming source may be prepared");
  assert.equal(env.deckHandoffConfirmed("B"), false, "A muted source is not an audible handoff");
  env.setAutomatedCrossfader(100);
  for (let index = 0; index < 4; index += 1) continuity.tick();
  assert.equal(continuity.fillerActive, false, "Real routed program audio releases filler");
}

// Stops and ejects invalidate pending local decoding without stale writes.
for (const action of ["stop", "eject", "replace"]) {
  const { env, sources } = await createDeckHarness();
  const decode = deferred();
  env.audioEngine.context.decodeAudioData = () => decode.promise;
  const state = { id: "pending", title: "Pending", bpm: 120, audioAsset: { file: { arrayBuffer: async () => new ArrayBuffer(4) } } };
  env.deckState.B = state;
  const playing = env.startDeckAudio("B");
  await settle();
  if (action === "stop") env.stopDeckAudio("B");
  if (action === "eject") env.ejectDeck("B");
  if (action === "replace") {
    env.tracks.push({ id: "replacement", title: "Replacement", bpm: 120, audioBuffer: { duration: 120 } });
    env.loadTrack("B", "replacement");
  }
  decode.resolve({ duration: 60 });
  await assert.rejects(playing, { name: "AbortError" });
  assert.equal(sources.length, 0, `${action} prevents late source creation`);
  assert.equal(state.audioBuffer, undefined, `${action} prevents stale deck buffer writes`);
  assert.equal(state.audioAsset.buffer, undefined, `${action} prevents stale asset cache writes`);
  assert.equal(env.deckState.B.playing, false);
}

// Stem fetch, body read and decode boundaries are independently cancellable.
for (const stage of ["fetch", "body", "decode"]) {
  const { env, sources } = await createDeckHarness();
  const pending = deferred();
  const asset = { url: "/owned-stem.wav" };
  env.deckState.B = { id: "stems", title: "Stems", bpm: 120, stemAssets: { drums: asset } };
  env.fetch = () => stage === "fetch" ? pending.promise : Promise.resolve({
    ok: true, arrayBuffer: () => stage === "body" ? pending.promise : Promise.resolve({ duration: 60 })
  });
  if (stage === "decode") env.audioEngine.context.decodeAudioData = () => pending.promise;
  const playing = env.startDeckAudio("B");
  await settle();
  env.stopDeckAudio("B");
  pending.resolve(stage === "fetch" ? { ok: true, arrayBuffer: async () => ({ duration: 60 }) } : { duration: 60 });
  await assert.rejects(playing, { name: "AbortError" });
  assert.equal(sources.length, 0, `Stopping at the stem ${stage} await prevents late sources`);
  assert.equal(asset.buffer, undefined);
}

// Pre-roll owns captured assets, not a later state.audioAsset reached through a callback.
for (const action of ["replace-state", "replace-asset", "eject"]) {
  const { env, sources } = await createDeckHarness();
  const decode = deferred();
  env.audioEngine.context.decodeAudioData = () => decode.promise;
  const asset = { file: { arrayBuffer: async () => new ArrayBuffer(4) } };
  const state = { id: "pre-roll", title: "Pre-roll", bpm: 120, audioAsset: asset };
  env.deckState.B = state;
  const preparing = env.prepareDeckContinuityPreroll("B");
  await settle();
  const replacement = { file: { arrayBuffer: async () => new ArrayBuffer(8) } };
  if (action === "replace-state") env.deckState.B = { id: "new", title: "New", bpm: 125, audioAsset: replacement };
  if (action === "replace-asset") state.audioAsset = replacement;
  if (action === "eject") env.ejectDeck("B");
  decode.resolve({ duration: 45 });
  await assert.rejects(preparing, { name: "AbortError" });
  assert.equal(asset.buffer, undefined);
  assert.equal(replacement.buffer, undefined, "Old pre-roll callbacks cannot write into the replacement asset");
  assert.equal(state.audioBuffer, undefined);
  assert.equal(env.deckState.B.audioBuffer, undefined);
  assert.equal(sources.length, 0);
}

// Overlapping starts and even rejected stale resumes belong only to the latest generation.
{
  const { env, sources } = await createDeckHarness();
  const first = deferred();
  let reads = 0;
  const asset = { file: { arrayBuffer: () => ++reads === 1 ? first.promise : Promise.resolve({ duration: 70 }) } };
  env.deckState.B = { id: "overlap", title: "Overlap", bpm: 120, audioAsset: asset };
  const stale = env.startDeckAudio("B");
  await settle();
  const latest = env.startDeckAudio("B");
  assert.equal(await latest, true);
  const currentSource = env.audioEngine.decks.B.source;
  first.resolve({ duration: 30 });
  await assert.rejects(stale, { name: "AbortError" });
  assert.equal(sources.length, 1);
  assert.equal(env.audioEngine.decks.B.source, currentSource);
  assert.equal(env.deckState.B.duration, 70);
  const resume = deferred();
  env.audioEngine.context.state = "suspended";
  env.audioEngine.context.resume = () => resume.promise;
  const resuming = env.startDeckAudio("A");
  env.ejectDeck("A");
  resume.reject(new Error("Old resume failed"));
  await assert.rejects(resuming, { name: "AbortError" }, "Stale resume errors propagate cancellation, not playback faults");
}

// Captured filler cleanup cannot stop a replacement, even if stop itself throws.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  env.startDeckContinuityFiller();
  const old = env.continuityState.fillerInstance;
  env.stopDeckContinuityFiller();
  const cleanupId = old.timeout;
  assert.ok(old.gain.gain.events.some(event => event[0] === "set" && event[1] === 0), "Fade lands on exact zero");
  assert.ok(old.nodes.filter(node => node.isSource).every(node => node.stopped > env.audioEngine.context.currentTime), "Source stops are audio-clock scheduled");
  old.nodes[0].stop = () => { throw new Error("Already ended"); };
  env.startDeckContinuityFiller();
  const replacement = env.continuityState.fillerInstance;
  await harness.runTimer(cleanupId, true);
  assert.equal(env.continuityState.fillerInstance, replacement);
  assert.equal(replacement.nodes[0].stopped, undefined, "Old fade cleanup never stops the new filler");
  assert.equal(old.nodes[0].disconnected, true, "A stop error cannot bypass disconnect");
  assert.equal(old.gain.disconnected, true);
}

// Incoming source time, running context and current signal are all required.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  await env.startDeckAudio("B", .5);
  env.setAutomatedCrossfader(100);
  assert.equal(env.deckHandoffConfirmed("B"), false, "A future source cannot confirm a handoff");
  harness.advance(600);
  assert.equal(env.deckHandoffConfirmed("B"), true);
  env.audioEngine.context.state = "suspended";
  assert.equal(env.deckHandoffConfirmed("B"), false);
  env.audioEngine.context.state = "running";
  env.audioEngine.decks.B.source.buffer.signal = 0;
  assert.equal(env.deckHandoffConfirmed("B"), false, "Historical signal flags cannot authorize silence");
}

// A loop stays authorized while decode is pending, but a failure or cancellation releases it.
for (const action of ["fail", "cancel"]) {
  const harness = await createDeckHarness();
  const { env, sources } = harness;
  await env.startDeckAudio("A");
  const outgoing = env.audioEngine.decks.A.source;
  const decode = deferred();
  env.audioEngine.context.decodeAudioData = () => decode.promise;
  env.deckState.B = { id: "b", title: "Pending B", bpm: 120, audioAsset: { file: { arrayBuffer: async () => new ArrayBuffer(4) } } };
  env.scheduleAutomatedTransition({});
  await harness.nextTimer();
  await harness.nextTimer();
  const pending = env.recordingState.pendingHandoff;
  assert.ok(pending, `Pending handoff should exist: ${JSON.stringify([...harness.timers])}`);
  assert.equal(outgoing.loop, true, "Outgoing loop is preserved throughout an authorized pending handoff");
  if (action === "fail") decode.reject(new Error("Decode failed"));
  else {
    env.stopAutomatedMix();
    decode.resolve({ duration: 100 });
  }
  await settle();
  assert.equal(outgoing.loop, false, `${action} releases the outgoing loop`);
  assert.equal(outgoing.stopped, undefined, `${action} leaves the outgoing source live`);
  assert.equal(env.recordingState.pendingHandoff, null);
  assert.equal(env.deckState.B.playing, false);
  assert.equal(sources.length, 1, `${action} cannot create late incoming sources`);
  if (action === "fail") assert.match(env.elements.recordingStatus.textContent, /could not enter safely/);
}

// A hard cut confirms a muted scheduled source, opens the route, then stops outgoing.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  await env.startDeckAudio("A");
  const outgoing = env.audioEngine.decks.A.source;
  env.prepareAutomatedDeck = async () => false;
  env.scheduleAutomatedTransition({});
  await harness.nextTimer();
  await harness.nextTimer();
  assert.equal(outgoing.loop, true);
  assert.equal(outgoing.stopped, undefined);
  assert.equal(Number(env.elements.crossfader.value), 0, "Hard cut prepares the incoming deck muted");
  for (let index = 0; env.recordingState.pendingHandoff && index < 12; index += 1) await harness.nextTimer();
  assert.equal(env.recordingState.pendingHandoff, null, "Hard cut confirmation does not deadlock behind the muted route");
  assert.equal(Number(env.elements.crossfader.value), 100);
  assert.ok(outgoing.stopped > 0, "Outgoing stops only after actual incoming confirmation");
  assert.equal(env.recordingState.activeDeck, "B");
}

// Silent incoming playback never authorizes retirement, even when a buffer is ready.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  await env.startDeckAudio("A");
  const outgoing = env.audioEngine.decks.A.source;
  env.deckState.B.audioBuffer.signal = 0;
  env.scheduleAutomatedTransition({});
  await harness.nextTimer();
  await harness.nextTimer();
  for (let index = 0; env.recordingState.pendingHandoff && index < 100; index += 1) await harness.nextTimer();
  assert.equal(env.recordingState.pendingHandoff, null);
  assert.equal(outgoing.loop, false, "Failed signal confirmation resolves the loop lock");
  assert.equal(outgoing.stopped, undefined, "A ready but silent buffer cannot stop outgoing");
  assert.equal(Number(env.elements.crossfader.value), 0);
  assert.equal(env.deckState.B.playing, false);
}

// Auxiliary percussion can light the deck meter but cannot confirm the recording itself.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  await env.startDeckAudio("A");
  const outgoing = env.audioEngine.decks.A.source;
  env.deckState.B.audioBuffer.signal = 0;
  env.scheduleAutomatedTransition({});
  await harness.nextTimer();
  await harness.nextTimer();
  harness.advance(300);
  env.triggerTone("B", env.audioEngine.context.currentTime, 880, "triangle", .4, 6);
  const auxiliaryEnvelope = [...env.audioEngine.decks.B.auxiliarySources.values()][0];
  auxiliaryEnvelope.gain.value = .4;
  env.setAutomatedCrossfader(100);
  const sharedSamples = new Float32Array(512);
  env.audioEngine.decks.B.analyser.getFloatTimeDomainData(sharedSamples);
  assert.ok(sharedSamples[0] > .005, "Generated percussion is present in the shared deck analyser");
  assert.equal(env.deckHandoffConfirmed("B", false), false, "Muted-preparation readiness requires recording-only signal");
  assert.equal(env.deckHandoffConfirmed("B"), false, "Audible auxiliary signal cannot authorize recording retirement");
  for (let index = 0; env.recordingState.pendingHandoff && index < 100; index += 1) await harness.nextTimer();
  assert.equal(outgoing.stopped, undefined, "Silent incoming recording with auxiliary percussion cannot retire outgoing");
  assert.equal(env.deckState.B.playing, false);
  assert.equal(env.audioEngine.decks.B.recordingTap, null, "Failed incoming source tap is fully disposed");
}

// Recording-only stem taps still honor current stem gain routing.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  delete env.deckState.B.audioBuffer;
  env.deckState.B.stemAssets = {
    vocals: { buffer: { duration: 100, signal: .2 } },
    drums: { buffer: { duration: 100, signal: 0 } }
  };
  env.audioEngine.decks.B.stems.vocals = false;
  await env.startDeckAudio("B");
  harness.advance(100);
  env.setAutomatedCrossfader(100);
  assert.equal(env.deckHandoffConfirmed("B"), false, "Muted source stems cannot confirm a handoff");
  env.setStemState("B", "vocals", true, true);
  assert.equal(env.deckHandoffConfirmed("B"), true, "An audible owned recording stem confirms the handoff");
}

// Replacement during an in-flight fade invalidates both its continuation and late RAF.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  await env.startDeckAudio("A");
  const outgoing = env.audioEngine.decks.A.source;
  const makePlan = env.createTransitionPlan;
  env.createTransitionPlan = () => ({ ...makePlan(), hardCut: false, transition: 1000 });
  env.scheduleAutomatedTransition({});
  await harness.nextTimer();
  await harness.nextTimer();
  for (let index = 0; !env.recordingState.cancelFade && index < 12; index += 1) await harness.nextTimer();
  assert.equal(typeof env.recordingState.cancelFade, "function");
  const oldFrame = env.recordingState.autoMixFrame;
  env.tracks.push({ id: "new-b", title: "Replacement", bpm: 128, audioBuffer: { duration: 100 } });
  env.loadTrack("B", "new-b");
  await settle();
  env.elements.crossfader.value = "23";
  await harness.runTimer(oldFrame, true);
  assert.equal(env.deckState.B.id, "new-b");
  assert.equal(env.deckState.B.playing, false);
  assert.equal(Number(env.elements.crossfader.value), 23, "Stale animation cannot overwrite the operator fader");
  assert.equal(env.recordingState.activeDeck, "A", "Stale continuation cannot claim an active handoff");
  assert.equal(outgoing.stopped, undefined);
  assert.equal(outgoing.loop, false);
}

// Terminal shutdown reconciles the guard before any source stop and owns every cleanup.
{
  const harness = await createDeckHarness();
  const { env, sources, timers } = harness;
  await env.startDeckAudio("A");
  env.startDeckContinuityFiller();
  const fillerInstance = env.continuityState.fillerInstance;
  const resume = deferred();
  env.audioEngine.context.state = "suspended";
  env.audioEngine.context.resume = () => resume.promise;
  const pendingStart = env.startDeckAudio("B");
  let guardOfflineBeforeStop = false;
  const outgoing = env.audioEngine.decks.A.source;
  const sourceStop = outgoing.stop.bind(outgoing);
  outgoing.stop = when => {
    guardOfflineBeforeStop = env.audioEngine.shutdown && env.continuityState.guard === null;
    sourceStop(when);
  };
  env.stopTakeoverDecks();
  assert.equal(guardOfflineBeforeStop, true, "Guard is disabled before deck sources stop");
  const count = sources.length;
  resume.resolve();
  await assert.rejects(pendingStart, { name: "AbortError" });
  assert.equal(sources.length, count, "Late context resume cannot resurrect playback");
  assert.equal(env.continuityState.fillerInstances.size, 0);
  assert.equal(fillerInstance.gain.gain.value, 0, "Terminal filler stop is exact zero");
  assert.equal(env.continuityState.fillerInstance, null);
  for (const [id] of [...timers]) await harness.runTimer(id, true);
  env.startDeckContinuityFiller();
  assert.equal(sources.length, count, "Stale timers and filler callbacks cannot resurrect terminal audio");
  assert.equal(env.deckState.A.playing, false);
  assert.equal(env.deckState.B.playing, false);
}

// Late animation cleanup and smooth-stop cleanup never take ownership of new work.
{
  const harness = await createDeckHarness();
  const { env } = harness;
  const firstFade = env.animateAutomatedCrossfader(100, 1000);
  const firstFrame = env.recordingState.autoMixFrame;
  const secondFade = env.animateAutomatedCrossfader(50, 1000);
  const secondFrame = env.recordingState.autoMixFrame;
  const secondCancel = env.recordingState.cancelFade;
  assert.equal(await firstFade, false);
  await harness.runTimer(firstFrame, true);
  assert.equal(env.recordingState.autoMixFrame, secondFrame);
  assert.equal(env.recordingState.cancelFade, secondCancel);
  env.stopAutomatedMix();
  assert.equal(await secondFade, false);

  await env.startDeckAudio("A");
  const retired = env.audioEngine.decks.A.source;
  env.stopDeckAudio("A");
  assert.ok(env.audioEngine.decks.A.retiringSources.has(retired));
  env.stopTakeoverDecks();
  assert.equal(retired.stopped, env.audioEngine.context.currentTime, "Terminal stop also owns sources still fading out");
  assert.equal(retired.disconnected, true);
  assert.equal(env.audioEngine.decks.A.retiringSources.size, 0);
}

// Reopening explicitly cannot revive an older lifecycle's awaited continuation.
{
  const { env, sources } = await createDeckHarness();
  const resume = deferred();
  env.audioEngine.context.state = "suspended";
  env.audioEngine.context.resume = () => resume.promise;
  const old = env.startDeckAudio("B");
  env.stopTakeoverDecks();
  env.audioEngine.shutdown = false;
  env.audioEngine.lifecycleGeneration += 1;
  env.audioEngine.context.state = "running";
  assert.equal(await env.startDeckAudio("B"), true);
  const current = env.audioEngine.decks.B.source;
  resume.resolve();
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(sources.length, 1);
  assert.equal(env.audioEngine.decks.B.source, current);
}

// A real failure delivered after newer manual playback must not clean up that generation.
for (const caller of ["manual", "transition"]) {
  const harness = await createDeckHarness();
  const { env } = harness;
  if (caller === "transition") await env.startDeckAudio("A");
  env.deckState.B = {
    id: "same-card", title: "Same card", bpm: 120,
    audioAsset: { file: { arrayBuffer: async () => { throw new Error("Old decode failure"); } } }
  };
  const originalStart = env.startDeckAudio;
  let lateError;
  env.startDeckAudio = async (deckId, offset, owner) => {
    try { return await originalStart(deckId, offset, owner); }
    catch (error) {
      lateError = error;
      assert.equal(env.deckPlaybackFailureCurrent(error, deckId), true, "The failure initially owns its cleaned-up generation");
      env.deckState[deckId].audioBuffer = { duration: 100, signal: .2 };
      await originalStart(deckId);
      env.setAutomatedCrossfader(42);
      throw error;
    }
  };
  if (caller === "manual") {
    const button = { closest: () => ({ dataset: { deck: "B" } }), addEventListener(type, callback) { this.click = callback; } };
    env.document.querySelectorAll = () => [button];
    const start = deckPage.indexOf('document.querySelectorAll(".play-button").forEach');
    const end = deckPage.indexOf('document.querySelectorAll(".pitch-slider").forEach', start);
    vm.runInContext(deckPage.slice(start, end), env);
    await button.click();
  } else {
    env.scheduleAutomatedTransition({});
    await harness.nextTimer();
    await harness.nextTimer();
    await settle();
  }
  assert.ok(lateError?.playbackOwner);
  assert.equal(env.deckPlaybackFailureCurrent(lateError, "B"), false, "State identity alone cannot authorize a stale failure");
  assert.equal(env.deckState.B.playing, true, `${caller} error handler preserves newer manual playback`);
  assert.equal(env.audioEngine.decks.B.source.stopped, undefined);
  assert.equal(Number(env.elements.crossfader.value), 42, `${caller} failure cannot restore a stale fader`);
}

// Retiring source cleanup is captured, bounded, and cannot touch the replacement.
{
  const { env } = await createDeckHarness();
  await env.startDeckAudio("A");
  const retired = env.audioEngine.decks.A.source;
  const retiredTap = env.audioEngine.decks.A.recordingTap;
  env.stopDeckAudio("A");
  assert.equal(retiredTap.analyser.disconnected, true);
  assert.equal(retiredTap.sink.disconnected, true);
  await env.startDeckAudio("A");
  const current = env.audioEngine.decks.A.source;
  const currentTap = env.audioEngine.decks.A.recordingTap;
  retired.handlers.forEach(callback => callback());
  assert.equal(env.audioEngine.decks.A.retiringSources.size, 0);
  assert.equal(env.audioEngine.decks.A.source, current);
  assert.equal(env.audioEngine.decks.A.recordingTap, currentTap);
  assert.notEqual(currentTap.analyser.disconnected, true, "Retiring source cleanup cannot disconnect the replacement recording tap");
  assert.equal(current.stopped, undefined);
  current.handlers.forEach(callback => callback());
  env.stopDeckAudio("A");
  assert.equal(env.audioEngine.decks.A.retiringSources.size, 0, "Already-ended sources are disconnected immediately, never retained awaiting an event that already fired");
}

// Pagehide reconciles playback/cue/recording UI for a later bfcache restore.
{
  const { env, timers } = await createDeckHarness();
  await env.startDeckAudio("A");
  const restore = env.audioEngine.halo.restoreTimer;
  env.stopAutomatedMix();
  assert.equal(timers.get(restore).cleared, true, "Stopping automation clears the obsolete Live Intelligence restore");
  assert.equal(env.audioEngine.halo.restoreTimer, null);
  env.setCueMonitor("A", true);
  env.recordingState.recorder = { state: "recording", stop() { this.state = "inactive"; } };
  env.recordingState.elapsedTimer = 999;
  env.elements.recordingStart.disabled = true;
  env.shutdownDeckPage();
  assert.equal(env.deckState.A.playing, false);
  assert.equal(env.deckState.B.playing, false);
  assert.equal(env.audioEngine.decks.A.cueActive, false);
  assert.equal(env.audioEngine.decks.A.cueGain.gain.value, 0);
  assert.equal(env.recordingState.elapsedTimer, null);
  assert.equal(env.recordingState.recorder.state, "inactive");
  assert.equal(env.elements.recordingStart.disabled, false);
  assert.match(env.elements.recordingStatus.textContent, /Preparing the master recording/);
}

// Cancelled initial playback closes only the recorder captured by that startup.
for (const action of ["eject", "replace", "post-start-replacement", "newer-session"]) {
  const { env } = await createDeckHarness();
  const decode = deferred();
  env.audioEngine.context.decodeAudioData = () => decode.promise;
  env.deckState.A = {
    id: "startup", title: "Startup", bpm: 120,
    audioAsset: { file: { arrayBuffer: async () => new ArrayBuffer(4) } }
  };
  const recorders = [];
  class StartupRecorder {
    constructor() { this.state = "inactive"; this.events = new Map(); this.stopCalls = 0; this.mimeType = "audio/webm"; }
    addEventListener(name, callback) {
      if (!this.events.has(name)) this.events.set(name, []);
      this.events.get(name).push(callback);
    }
    start() { this.state = "recording"; }
    stop() {
      this.stopCalls += 1;
      this.state = "inactive";
      for (const callback of this.events.get("stop") || []) callback();
    }
  }
  env.window.MediaRecorder = StartupRecorder;
  env.createCompatibleRecorder = () => {
    const recorder = new StartupRecorder();
    recorders.push(recorder);
    return recorder;
  };
  env.buildTakeoverPlan = async () => true;
  env.trackHasPlayableAudio = state => Boolean(state.audioBuffer || state.audioAsset?.file || state.stemAssets);
  env.syncDecks = () => {};
  env.startAutomatedMix = () => { throw new Error("Cancelled startup must not start automation"); };
  env.recordingState.recorder = null;
  env.recordingState.elapsedTimer = null;
  const originalStart = env.startDeckAudio;
  if (action === "post-start-replacement") {
    env.startDeckAudio = async (deckId, offset) => {
      const started = await originalStart(deckId, offset);
      await originalStart(deckId);
      return started;
    };
  }
  const startup = env.startTakeoverRecording();
  await settle();
  const captured = recorders[0];
  assert.ok(captured);
  assert.equal(captured.state, "recording", "The recorder has started before pending initial decode");
  assert.equal(env.recordingState.elapsedTimer, null);
  assert.equal(env.elements.recordingStart.disabled, true);
  let newerRecorder;
  let replacementSource;
  if (action === "eject") env.ejectDeck("A");
  if (action === "replace") {
    env.tracks.push({ id: "replacement", title: "Replacement", bpm: 128, audioBuffer: { duration: 100, signal: .2 } });
    env.loadTrack("A", "replacement");
    await originalStart("A");
    replacementSource = env.audioEngine.decks.A.source;
  }
  if (action === "newer-session") {
    env.audioEngine.lifecycleGeneration += 1;
    newerRecorder = new StartupRecorder();
    newerRecorder.start();
    env.recordingState.recorder = newerRecorder;
    env.recordingState.chunks = ["newer-session-chunk"];
    env.recordingState.elapsedTimer = 881;
    env.elements.recordingRig.className = "newer-recording";
    env.elements.recordingStatus.textContent = "Newer session live";
    env.deckState.A.audioBuffer = { duration: 100, signal: .2 };
    await originalStart("A");
    replacementSource = env.audioEngine.decks.A.source;
  }
  decode.resolve({ duration: 100, signal: .2 });
  await startup;
  assert.equal(captured.state, "inactive", `${action} stops the captured recorder`);
  assert.equal(captured.stopCalls, 1);
  assert.equal(captured.takeoverCancelled, true);
  if (action === "post-start-replacement") replacementSource = env.audioEngine.decks.A.source;
  if (replacementSource) {
    assert.equal(env.audioEngine.decks.A.source, replacementSource);
    assert.equal(replacementSource.stopped, undefined, `${action} preserves valid replacement playback`);
    assert.equal(env.deckState.A.playing, true);
  }
  for (const callback of captured.events.get("dataavailable")) callback({ data: { size: 1 } });
  for (const callback of captured.events.get("error")) callback({ error: new Error("Stale recorder error") });
  for (const callback of captured.events.get("stop")) callback();
  if (newerRecorder) {
    // Isolate recorder identity protection from the cancellation flag as well.
    captured.takeoverCancelled = false;
    for (const callback of captured.events.get("dataavailable")) callback({ data: { size: 1 } });
    for (const callback of captured.events.get("error")) callback({ error: new Error("Retired recorder error") });
    for (const callback of captured.events.get("stop")) callback();
    captured.takeoverCancelled = true;
    assert.equal(newerRecorder.state, "recording", "Older cancelled startup cannot stop a newer recorder");
    assert.equal(newerRecorder.stopCalls, 0);
    assert.equal(env.recordingState.recorder, newerRecorder);
    assert.deepEqual(env.recordingState.chunks, ["newer-session-chunk"]);
    assert.equal(env.recordingState.elapsedTimer, 881);
    assert.equal(env.elements.recordingRig.className, "newer-recording");
    assert.equal(env.elements.recordingStatus.textContent, "Newer session live");
    assert.equal(env.elements.recordingStart.disabled, true, "Older cleanup cannot re-enable a newer session's controls");
  } else {
    assert.equal(env.recordingState.recorder, null);
    assert.equal(env.recordingState.chunks.length, 0);
    assert.equal(env.recordingState.elapsedTimer, null);
    assert.equal(env.elements.recordingStart.disabled, false);
    assert.match(env.elements.recordingStatus.textContent, /startup cancelled/);
  }
  if (replacementSource) {
    assert.equal(env.audioEngine.decks.A.source, replacementSource, "Queued recorder events cannot stop replacement playback");
    assert.equal(replacementSource.stopped, undefined);
    assert.equal(env.deckState.A.playing, true);
  }
}

function localAudioFile(name = "Imported.wav") {
  return { name, type: "audio/wav", arrayBuffer: async () => ({ duration: 100, signal: .2 }) };
}

// Artwork preparation can keep library entries, never take back a newer deck generation.
for (const action of ["stop", "eject", "replace", "same-state-play", "reopen", "before-picker"]) {
  const { env } = await createDeckHarness();
  const artwork = deferred();
  env.embeddedArtworkUrl = () => artwork.promise;
  env.requestTrackAudio("A");
  if (action === "before-picker") await env.startDeckAudio("A");
  const input = { files: [localAudioFile()], value: "old-selection" };
  const importing = env.handleDriveUpload({ target: input });
  await settle();
  if (action === "stop") env.stopDeckAudio("A");
  if (action === "eject") env.ejectDeck("A");
  if (action === "replace") {
    env.tracks.push({ id: "manual-new", title: "Manual new", bpm: 125, audioBuffer: { duration: 100, signal: .2 } });
    env.loadTrack("A", "manual-new");
    await env.startDeckAudio("A");
  }
  if (action === "same-state-play") await env.startDeckAudio("A");
  if (action === "reopen") {
    env.stopTakeoverDecks();
    env.audioEngine.shutdown = false;
    env.audioEngine.lifecycleGeneration += 1;
    await env.startDeckAudio("A");
  }
  const currentState = env.deckState.A;
  const currentGeneration = env.audioEngine.decks.A.playbackGeneration;
  const currentSource = env.audioEngine.decks.A.source;
  env.elements.importStatus.textContent = "Newer manual status";
  env.elements.search.value = "newer filter";
  artwork.resolve("data:image/png;base64,owned");
  await importing;
  assert.ok(env.tracks.some(track => track.title === "Imported"), `${action} retains library additions`);
  assert.equal(env.deckState.A, currentState, `${action} prevents stale artwork from replacing deck state`);
  assert.equal(env.audioEngine.decks.A.playbackGeneration, currentGeneration);
  assert.equal(env.audioEngine.decks.A.source, currentSource);
  if (currentSource) assert.equal(currentSource.stopped, undefined);
  assert.equal(env.elements.importStatus.textContent, "Newer manual status", `${action} preserves newer import UI`);
  assert.equal(env.elements.search.value, "newer filter");
}

// Play's file picker is tied to its original deck, not later mutable picker selection.
{
  const { env } = await createDeckHarness();
  const artwork = deferred();
  env.embeddedArtworkUrl = () => artwork.promise;
  const originalB = env.deckState.B;
  env.requestTrackAudio("A");
  env.selectedImportDeck = "B";
  const importing = env.handleDriveUpload({ target: { files: [localAudioFile("For-A.wav")], value: "picked" } });
  await settle();
  env.selectedImportDeck = "B";
  env.pendingPlaybackDeck = "B";
  artwork.resolve("");
  await importing;
  assert.equal(env.deckState.A.title, "For-A");
  assert.equal(env.deckState.A.playing, true, "Autoplay intent is captured in the request");
  assert.equal(env.deckState.B, originalB, "Picker selection drift cannot redirect loading to B");
}

// Old upload completion/error/finally cannot clear a newer picker request or UI.
for (const outcome of ["complete", "error"]) {
  const { env } = await createDeckHarness();
  const artwork = deferred();
  env.embeddedArtworkUrl = () => artwork.promise;
  env.requestTrackAudio("A");
  const importing = env.handleDriveUpload({ target: { files: [localAudioFile()], value: "old" } });
  await settle();
  env.requestTrackAudio("B");
  const newerRequest = env.pendingAudioRequest;
  const status = env.elements.importStatus.textContent;
  if (outcome === "complete") artwork.resolve("");
  else artwork.reject(new Error("Old artwork error"));
  await importing;
  assert.equal(env.pendingAudioRequest, newerRequest);
  assert.equal(env.pendingPlaybackDeck, "B");
  assert.equal(env.elements.importStatus.textContent, status);
  assert.equal(env.deckState.A.id, "a");
  assert.equal(env.deckState.B.id, "b");
}

// Overlapping uploads keep both library additions; only the latest owns loading and UI.
{
  const { env } = await createDeckHarness();
  const firstArtwork = deferred();
  const secondArtwork = deferred();
  env.embeddedArtworkUrl = file => file.name === "First.wav" ? firstArtwork.promise : secondArtwork.promise;
  env.selectedImportDeck = "A";
  env.selectDeckAudioFiles(env.elements.driveUpload);
  const first = env.handleDriveUpload({ target: { files: [localAudioFile("First.wav")], value: "first" } });
  await settle();
  env.selectedImportDeck = "B";
  env.selectDeckAudioFiles(env.elements.folderUpload);
  const second = env.handleDriveUpload({ target: { files: [localAudioFile("Second.wav")], value: "second" } });
  secondArtwork.resolve("");
  await second;
  const currentB = env.deckState.B;
  const status = env.elements.importStatus.textContent;
  firstArtwork.resolve("");
  await first;
  assert.equal(env.deckState.A.id, "a");
  assert.equal(env.deckState.B, currentB);
  assert.equal(env.deckState.B.title, "Second");
  assert.equal(env.elements.importStatus.textContent, status);
  assert.equal(env.elements.driveButton.disabled, false);
  const imported = env.tracks.filter(track => track.platform === "Private Drive Upload");
  assert.equal(imported.length, 2);
  assert.equal(new Set(imported.map(track => track.id)).size, 2);
}

// Stale preparation errors cannot stop a newer manual playback or rewrite its status.
{
  const { env } = await createDeckHarness();
  const artwork = deferred();
  env.embeddedArtworkUrl = () => artwork.promise;
  env.requestTrackAudio("A");
  const importing = env.handleDriveUpload({ target: { files: [localAudioFile()], value: "old" } });
  await settle();
  await env.startDeckAudio("A");
  const current = env.audioEngine.decks.A.source;
  env.elements.importStatus.textContent = "New manual playback";
  artwork.reject(new Error("Late artwork failure"));
  await importing;
  assert.equal(env.audioEngine.decks.A.source, current);
  assert.equal(current.stopped, undefined);
  assert.equal(env.deckState.A.playing, true);
  assert.equal(env.elements.importStatus.textContent, "New manual playback");
}

// The adjacent async URL import uses the same captured deck ownership boundary.
for (const action of ["replace", "selection-drift"]) {
  const { env } = await createDeckHarness();
  const response = deferred();
  env.fetch = () => response.promise;
  env.elements.musicUrl.value = "https://example.com/owned-track";
  const importing = env.importTrack({ preventDefault() {} });
  await settle();
  let manual;
  if (action === "replace") {
    await env.startDeckAudio("A");
    manual = env.audioEngine.decks.A.source;
    env.elements.importStatus.textContent = "New manual URL-import status";
  } else env.selectedImportDeck = "B";
  response.resolve({ ok: true, json: async () => ({ title: "Resolved track", artist: "Owned artist", platform: "Owned catalog" }) });
  await importing;
  assert.ok(env.tracks.some(track => track.title === "Resolved track"));
  if (manual) {
    assert.equal(env.audioEngine.decks.A.source, manual);
    assert.equal(manual.stopped, undefined);
    assert.equal(env.elements.importStatus.textContent, "New manual URL-import status");
  } else {
    assert.equal(env.deckState.A.title, "Resolved track");
    assert.equal(env.deckState.B.id, "b");
  }
}

// Pre-handoff effects belong to both decks before openTransitionPlan queues any work.
for (const effect of ["percussion", "drum-drop"]) {
  for (const replacedDeck of ["A", "B"]) {
    const harness = await createDeckHarness();
    const { env, sources } = harness;
    await env.startDeckAudio("A");
    const makePlan = env.createTransitionPlan;
    env.createTransitionPlan = () => ({
      ...makePlan(), loopLock: false, hardCut: false, effectWindow: 500, transition: 2000, beatSeconds: .5,
      percussion: effect === "percussion", drumDrop: effect === "drum-drop"
    });
    env.scheduleAutomatedTransition({});
    const owner = env.recordingState.pendingHandoff;
    assert.ok(owner, "Transition owner exists before pre-handoff effects are opened");
    await harness.nextTimer();
    const earlyEffects = env.recordingState.effectTimers.slice();
    const lateStart = env.recordingState.autoMixTimer;
    assert.ok(earlyEffects.length > 0);
    const automationGeneration = env.recordingState.automationGeneration;
    env.tracks.push({ id: "effect-replacement", title: "Replacement", bpm: 125, audioBuffer: { duration: 100, signal: .2 } });
    env.loadTrack(replacedDeck, "effect-replacement");
    await env.startDeckAudio(replacedDeck);
    if (replacedDeck === "A") await env.startDeckAudio("B");
    env.setStemState("B", "hats", false, true);
    const replacement = env.audioEngine.decks[replacedDeck].source;
    const count = sources.length;
    assert.equal(owner.cancelled, true);
    assert.equal(env.recordingState.pendingHandoff, null);
    assert.equal(env.recordingState.automationGeneration, automationGeneration, "The regression does not rely on stopping all automation");
    for (const timer of earlyEffects) await harness.runTimer(timer, true);
    await harness.runTimer(lateStart, true);
    assert.equal(sources.length, count, `Stale pre-handoff ${effect} cannot generate audio after Deck ${replacedDeck} replacement`);
    assert.equal(env.audioEngine.decks.B.stems.hats, false, `Stale pre-handoff ${effect} cannot restore drums on replacement playback`);
    assert.equal(env.audioEngine.decks.B.filters.highShelf.gain.value, -26);
    assert.equal(env.audioEngine.decks[replacedDeck].source, replacement);
    assert.equal(replacement.stopped, undefined);
  }
}

// Authorized incoming startup advances the same owner without dropping its queued effects.
{
  const harness = await createDeckHarness();
  const { env, sources, timers } = harness;
  await env.startDeckAudio("A");
  const makePlan = env.createTransitionPlan;
  env.createTransitionPlan = () => ({
    ...makePlan(), loopLock: false, hardCut: false, percussion: true, effectWindow: 1, transition: 1000, beatSeconds: .5
  });
  env.scheduleAutomatedTransition({});
  const owner = env.recordingState.pendingHandoff;
  const preparedGeneration = owner.incomingGeneration;
  await harness.nextTimer();
  const percussion = env.recordingState.effectTimers.find(timer => timers.get(timer).delay === 250);
  assert.ok(percussion);
  await harness.runTimer(env.recordingState.autoMixTimer);
  assert.equal(env.recordingState.pendingHandoff, owner);
  assert.equal(owner.cancelled, false);
  assert.ok(owner.incomingGeneration > preparedGeneration);
  assert.equal(owner.incomingGeneration, env.audioEngine.decks.B.playbackGeneration);
  const count = sources.length;
  await harness.runTimer(percussion);
  assert.ok(sources.length > count, "Owned percussion remains authorized across normal incoming startup");
  env.stopAutomatedMix();
  await settle();
}

// Replacing outgoing during pending incoming decode cancels that decode as well.
{
  const harness = await createDeckHarness();
  const { env, sources } = harness;
  await env.startDeckAudio("A");
  const decode = deferred();
  env.audioEngine.context.decodeAudioData = () => decode.promise;
  env.deckState.B = { id: "pending-incoming", title: "Pending", bpm: 120, audioAsset: { file: { arrayBuffer: async () => new ArrayBuffer(4) } } };
  env.scheduleAutomatedTransition({});
  await harness.nextTimer();
  await harness.nextTimer();
  const owner = env.recordingState.pendingHandoff;
  assert.equal(owner.outgoingSource.loop, true);
  env.tracks.push({ id: "outgoing-replacement", title: "Manual A", bpm: 125, audioBuffer: { duration: 100, signal: .2 } });
  env.loadTrack("A", "outgoing-replacement");
  await env.startDeckAudio("A");
  const current = env.audioEngine.decks.A.source;
  decode.resolve({ duration: 100, signal: .2 });
  await settle();
  assert.equal(env.recordingState.pendingHandoff, null);
  assert.equal(env.deckState.B.playing, false);
  assert.equal(env.audioEngine.decks.B.source, null);
  assert.equal(sources.length, 2, "Incoming decode cannot create late audio after outgoing ownership was replaced");
  assert.equal(env.audioEngine.decks.A.source, current);
  assert.equal(current.stopped, undefined);
  assert.equal(owner.outgoingSource.loop, false);
}

// Post-handoff matching owns the incoming playback, not the retired transition.
for (const action of ["match", "replace", "stop", "cancel", "recorder-stop"]) {
  const harness = await createDeckHarness();
  const { env, timers } = harness;
  await env.startDeckAudio("A");
  env.audioEngine.decks.A.level = .24;
  env.audioEngine.decks.B.level = .2;
  let matches = 0;
  const realMatch = env.matchDeckLevels;
  env.matchDeckLevels = (...args) => { matches += 1; return realMatch(...args); };
  env.prepareAutomatedDeck = async deckId => {
    env.tracks.push({ id: "prepared-next", title: "Next record", bpm: 125, audioBuffer: { duration: 100, signal: .2 } });
    env.loadTrack(deckId, "prepared-next");
    env.audioEngine.decks[deckId].level = 0;
    return false;
  };
  env.scheduleAutomatedTransition({});
  await harness.nextTimer();
  await harness.nextTimer();
  for (let index = 0; env.recordingState.pendingHandoff && index < 12; index += 1) await harness.nextTimer();
  assert.equal(env.recordingState.pendingHandoff, null);
  assert.equal(env.recordingState.activeDeck, "B");
  assert.equal(env.deckState.A.id, "prepared-next", "The outgoing deck has already been reused");
  const matchingTimers = env.recordingState.effectTimers.filter(timer => [400, 1400].includes(timers.get(timer).delay));
  assert.equal(matchingTimers.length, 2);
  if (action === "replace") {
    env.tracks.push({ id: "manual-new-b", title: "Manual B", bpm: 124, audioBuffer: { duration: 100, signal: .2 } });
    env.loadTrack("B", "manual-new-b");
    await env.startDeckAudio("B");
  }
  if (action === "stop") env.stopDeckAudio("B");
  if (action === "cancel") env.stopAutomatedMix();
  if (action === "recorder-stop") env.recordingState.recorder.state = "inactive";
  const source = env.audioEngine.decks.B.source;
  for (const timer of matchingTimers) await harness.runTimer(timer, true);
  if (action === "match") {
    assert.equal(matches, 2, "Both 400ms and 1400ms matching callbacks execute after successful handoff");
    const targets = env.audioEngine.decks.B.trim.gain.events.filter(event => event[0] === "target");
    assert.equal(targets.length, 2);
    assert.ok(targets.every(event => Math.abs(event[1] - 1.2) < 1e-9), "Matching uses captured outgoing level, not the reused deck's zero level");
  } else {
    assert.equal(matches, 0, `${action} rejects stale post-handoff matching`);
    assert.equal(env.audioEngine.decks.B.trim.gain.value, 1);
    assert.equal(env.audioEngine.decks.B.source, source);
    if (source) assert.equal(source.stopped, undefined, `${action} matching cleanup cannot stop current playback`);
  }
}

console.log("DJ continuity lifecycle regressions: program-only recovery, generation ownership, captured cleanup, source-only handoffs, startup recorder cancellation, import ownership, and terminal shutdown passed.");

console.log("HALO continuity guard contracts: predictive pre-roll, silence watchdog, filler bridge, and monitoring hooks behave as expected.");
