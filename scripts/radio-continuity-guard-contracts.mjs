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
  prepareDeckContinuityPreroll() {},
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
    deckState: {
      A: { id: "a", title: "A", bpm: 120, originalBpm: 120, duration: 100, playing: false, audioBuffer: { duration: 100, signal: .2 } },
      B: { id: "b", title: "B", bpm: 120, originalBpm: 120, duration: 100, playing: false, audioBuffer: { duration: 100, signal: .2 } }
    },
    audioHealth: { status: "ready", message: "", continuity: {} },
    elements: {
      crossfader: { value: "0" }, importStatus: { classList: { remove() {} }, textContent: "" },
      recordingStatus: { textContent: "" }, performancePolicyCopy: { textContent: "" }
    },
    document: { querySelector: () => ({ value: 0, style: {}, textContent: "", classList: { toggle() {} }, setAttribute() {} }) },
    window: { AudioContext: Context, haloStats: { track() {} } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, at: clock + delay, cleared: false }); return id; },
    clearTimeout(id) { if (timers.has(id)) timers.get(id).cleared = true; },
    setInterval() { return ++timerId; }, clearInterval() {},
    requestAnimationFrame(callback) { return env.setTimeout(() => callback(clock), 16); },
    cancelAnimationFrame(id) { env.clearTimeout(id); },
    reportAudioHealth() {}, updateTakeoverQualityControl() {}, updateMasterReadout() {}, updateDeck() {}, updateBoothDisplay() {},
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
    "waitForDeckHandoff", "deckHandoffCurrent", "decodeDeckAsset", "prepareDeckContinuityPreroll",
    "deckContinuityBoundaryState", "attachContinuityGuardToDeck", "recorderGuardMasterLevel",
    "ensureAudio", "updateAudioCrossfader", "stopDeckAudio", "startDeckAudio", "startDeckSource",
    "startDeckAudioSources", "restoreDeckStems", "setStemState", "resetDeckEffects", "loadTrack",
    "ejectDeck", "setAutomatedCrossfader", "animateAutomatedCrossfader", "queuePerformanceMove",
    "loopOutgoingTail", "openTransitionPlan", "moveTransitionPlan", "scheduleAutomatedTransition",
    "stopAutomatedMix", "stopTakeoverDecks"
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
  assert.equal(await playing, false);
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
  assert.equal(await playing, false);
  assert.equal(sources.length, 0, `Stopping at the stem ${stage} await prevents late sources`);
  assert.equal(asset.buffer, undefined);
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
  assert.equal(await stale, false);
  assert.equal(sources.length, 1);
  assert.equal(env.audioEngine.decks.B.source, currentSource);
  assert.equal(env.deckState.B.duration, 70);
  const resume = deferred();
  env.audioEngine.context.state = "suspended";
  env.audioEngine.context.resume = () => resume.promise;
  const resuming = env.startDeckAudio("A");
  env.ejectDeck("A");
  resume.reject(new Error("Old resume failed"));
  assert.equal(await resuming, false, "Stale resume errors cannot reach callers that overwrite replacement state");
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
  assert.equal(await pendingStart, false);
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
  assert.equal(await old, false);
  assert.equal(sources.length, 1);
  assert.equal(env.audioEngine.decks.B.source, current);
}

console.log("DJ continuity lifecycle regressions: program-only recovery, generation ownership, captured filler cleanup, confirmed/cancelled handoffs, and terminal shutdown passed.");

console.log("HALO continuity guard contracts: predictive pre-roll, silence watchdog, filler bridge, and monitoring hooks behave as expected.");
