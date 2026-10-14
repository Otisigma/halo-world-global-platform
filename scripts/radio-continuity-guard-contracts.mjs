import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [guardSource, radioPage, radioClient, deckPage, telemetryApi] = await Promise.all([
  readFile(new URL("../dj-continuity-guard.js", import.meta.url), "utf8"),
  readFile(new URL("../radio/index.html", import.meta.url), "utf8"),
  readFile(new URL("../radio/radio.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/telemetry.mjs", import.meta.url), "utf8")
]);

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
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
assert.doesNotMatch(deckPage, /dj-continuity-guard\.js|HaloContinuityGuard|continuityState|audioHealth\.continuity/, "DJ deck no longer runs the synthetic continuity failover");
assert.doesNotMatch(deckPage, /DeckContinuity|CONTINUITY BRIDGE ACTIVE|data-continuity-state/, "Rolled-back bridge callbacks and status hooks are absent");
assert.match(telemetryApi, /telemetry\.continuity/, "Telemetry API accepts continuity state");

const timers = new Map();
let timerId = 0;
const sources = [];
const stopped = [];
function channel() {
  return { input: {}, trim: { gain: { setValueAtTime() {} } }, stemSources: {}, stemGains: {}, sourceEnvelopes: new Map() };
}
const deckSandbox = {
  console,
  Date,
  Map,
  Float32Array,
  recorderGuardState: { guard: null, analyser: null, analyserData: null },
  audioEngine: {
    context: {
      currentTime: 10,
      createOscillator() { assert.fail("Stalls and shutdown must never create synthetic filler"); },
      createBufferSource() {
        const source = {
          playbackRate: { value: 1 },
          connect() {},
          start(when) { this.startedAt = when; },
          stop() { this.stopped = true; },
          disconnect() {}
        };
        sources.push(source);
        return source;
      },
      createAnalyser() {
        return { frequencyBinCount: 256, getFloatTimeDomainData(data) { data.fill(.9); } };
      }
    },
    masterGain: { connect(node) { deckSandbox.masterAnalyser = node; } },
    decks: { A: channel(), B: channel() }
  },
  recordingState: {
    recorder: { state: "recording", stop() { this.state = "inactive"; } },
    activeDeck: "A", transitionHistory: [], effectTimers: [], playedTrackIds: new Set(), transitionCount: 0
  },
  takeoverSession: { name: "Test DJ", dj: "halo" },
  modeProfiles: { club: { policy: "Clean playback" } },
  djMode: "club",
  deckState: {
    A: { id: "a", title: "Alpha", artist: "Artist A", bpm: 124, playing: true, empty: false, audioBuffer: { duration: 180 } },
    B: { id: "b", title: "Beta", artist: "Artist B", bpm: 125, playing: false, empty: false, audioBuffer: { duration: 180 } }
  },
  elements: {
    importStatus: { classList: { remove() {} } },
    recordingStatus: {}, recordingNote: {}, performancePolicyCopy: {},
    mixIntent: { value: "peak" },
    qcContinuity: {}, qcContinuityValue: {},
    masterBpm: { textContent: "" },
    masterTrack: { textContent: "" },
    masterStatus: { dataset: {}, textContent: "" }
  },
  document: { querySelector() { return {}; } },
  window: {
    HaloRecorderGuard: { renderIndicator() {} },
    useRecorderGuard(options) { deckSandbox.recorderInputs = options.readInputs; return {}; },
    haloStats: { track() {} }
  },
  setTimeout(handler, delay) { timers.set(++timerId, { handler, delay }); return timerId; },
  clearTimeout(id) { timers.delete(id); },
  clearInterval(id) { stopped.push(id); },
  cancelAnimationFrame() {},
  createTransitionPlan() {
    return { style: "drop-swap", hardCut: true, cleanPlay: 100, effectWindow: 50, breathPlan: {}, name: "Test transition", effectMove: "cut" };
  },
  updateTakeoverQualityControl() {},
  formatRecordingTime(seconds) { return String(seconds); },
  setQcCheck() {},
  renderBreathPlan() {}, setPerformancePhase() {}, openTransitionPlan() {}, setActiveBreathStage() {},
  showToast() {}, scheduleBreathStages() {}, setStemState() {}, updateDeck() {},
  queuePerformanceMove() {}, restoreDeckStems() {}, resetDeckEffects() {}, recordTransitionObservation() {},
  async prepareAutomatedDeck() { return false; },
  setAutomatedCrossfader(value) {
    assert.ok(sources.at(-1).startedAt >= 10, "Incoming audio starts before the crossfader moves");
    deckSandbox.crossfader = value;
  },
  reportAudioHealth() {},
  async startDeckAudio(deckId, offset = 0) {
    return deckSandbox.startDeckAudioSources(deckSandbox.audioEngine.context, deckId, offset);
  }
};
vm.createContext(deckSandbox);
vm.runInContext([
  "stopDeckAudio", "startDeckSource", "prepareDeckAudio", "startDeckAudioSources", "scheduleAutomatedTransition",
  "stopAutomatedMix", "stopTakeoverDecks", "finishTakeoverRecording", "updateMasterReadout",
  "recorderGuardMasterLevel", "recorderGuardInputs", "attachRecorderGuardToDeck"
].map(name => {
  const source = extractFunctionSource(deckPage, name);
  return ["prepareDeckAudio", "startDeckAudioSources"].includes(name) ? `async ${source}` : source;
}).join("\n\n"), deckSandbox);

async function runNextTimer() {
  const [id, timer] = timers.entries().next().value;
  timers.delete(id);
  await timer.handler();
}

// The recorder observes its isolated capture stream without the bridge watchdog.
const audioContext = deckSandbox.audioEngine.context;
deckSandbox.audioEngine.context = null;
deckSandbox.attachRecorderGuardToDeck();
assert.equal(deckSandbox.recorderGuardState.analyser, null, "Initial page load does not require an AudioContext");
assert.equal(deckSandbox.recorderInputs().masterBusLevel, 0);
deckSandbox.audioEngine.context = audioContext;
const captureAnalyser = { fftSize: 2048, getFloatTimeDomainData(data) { data.fill(.9); } };
deckSandbox.audioEngine.recordingFeed = { analyser: captureAnalyser };
deckSandbox.attachRecorderGuardToDeck();
const analyser = deckSandbox.recorderGuardState.analyser;
deckSandbox.attachRecorderGuardToDeck();
assert.equal(deckSandbox.recorderGuardState.analyser, analyser, "Repeated playback does not allocate another analyser");
assert.equal(captureAnalyser, deckSandbox.recorderGuardState.analyser, "Recorder reuses its capture-stream analyser");
assert.equal(deckSandbox.masterAnalyser, undefined, "Recorder isolation never adds a master-bus tap");
assert.match(extractFunctionSource(deckPage, "ensureAudio"), /attachRecorderGuardToDeck\(\)/, "Audio initialization attaches the lazy recorder analyser");
deckSandbox.audioEngine.decks.A.cueActive = true;
assert.ok(Math.abs(deckSandbox.recorderInputs().masterBusLevel - .9) < 1e-6, "Recorder guard samples the isolated capture stream");

// A successful hard-cut starts the incoming track before stopping the outgoing.
await deckSandbox.startDeckAudio("A");
const outgoing = sources.at(-1);
deckSandbox.scheduleAutomatedTransition({});
await runNextTimer();
await runNextTimer();
assert.equal(deckSandbox.recordingState.activeDeck, "B");
assert.equal(outgoing.stopped, true);
assert.equal(sources.at(-1).stopped, undefined, "Incoming audio stays live");
assert.equal(deckSandbox.crossfader, 100);
assert.equal(deckSandbox.recordingState.transitionCount, 1);
assert.equal(timers.size, 1, "No next track schedules only the final clean shutdown, not a bridge");
await runNextTimer();
assert.equal(deckSandbox.recordingState.recorder.state, "inactive");
assert.ok(sources.every(source => source.stopped), "Final shutdown stops every track source");

// Failed incoming playback preserves the outgoing song and ends silently.
deckSandbox.recordingState.recorder.state = "recording";
deckSandbox.recordingState.activeDeck = "A";
deckSandbox.deckState.A.playing = true;
deckSandbox.deckState.B.audioBuffer = null;
deckSandbox.deckState.B.audioAsset = { file: { arrayBuffer: async () => { throw new Error("Decode failed"); } } };
await deckSandbox.startDeckAudio("A");
const held = sources.at(-1);
const sourceCount = sources.length;
deckSandbox.scheduleAutomatedTransition({});
await runNextTimer();
await runNextTimer();
assert.equal(sources.length, sourceCount, "Failed replacement produces no audio source");
assert.equal(held.stopped, undefined, "Outgoing track is not cut on a failed handoff");
assert.equal(deckSandbox.deckState.B.playing, false);
assert.equal(deckSandbox.deckState.B.audioAsset.promise, null, "Failed decode can be retried");
assert.equal(timers.size, 1);
assert.equal(timers.values().next().value.delay, 90000, "Pre-bridge safe-stop hold is preserved");
await runNextTimer();
assert.equal(held.stopped, true, "Safe stop silences the held source");
assert.equal(deckSandbox.deckState.A.playing, false);
assert.equal(deckSandbox.deckState.B.playing, false);
assert.equal(timers.size, 0, "Shutdown leaves no recovery or effect timer running");
deckSandbox.finishTakeoverRecording("stopped");
assert.equal(timers.size, 0, "Repeated shutdown is harmless");
deckSandbox.updateMasterReadout();
assert.doesNotMatch(deckSandbox.elements.masterStatus.textContent, /CONTINUITY|BRIDGE/, "Status shows only real deck playback");

// Manual stop also clears the deck scheduler.
deckSandbox.audioEngine.decks.A.timer = 42;
deckSandbox.stopTakeoverDecks();
assert.ok(stopped.includes(42));
assert.equal(deckSandbox.audioEngine.decks.A.timer, null);

// Readiness yields must not let overlapping transport starts orphan a source.
const beforeConcurrent = sources.length;
await Promise.all([deckSandbox.startDeckAudio("A"), deckSandbox.startDeckAudio("A")]);
assert.equal(sources.length, beforeConcurrent + 1, "Only the latest overlapping start creates a track source");
deckSandbox.stopTakeoverDecks();
assert.ok(sources.every(source => source.stopped), "Shutdown stops all sources after concurrent starts");

const beforeCancelled = sources.length;
const pendingStart = deckSandbox.startDeckAudio("A");
deckSandbox.stopTakeoverDecks();
await pendingStart;
assert.equal(sources.length, beforeCancelled, "Stopping during readiness cancels the pending source start");

let rejectOldLoad;
deckSandbox.deckState.A = {
  ...deckSandbox.deckState.A,
  audioBuffer: null,
  audioAsset: { file: { arrayBuffer: () => new Promise((resolve, reject) => { rejectOldLoad = reject; }) } }
};
const supersededStart = deckSandbox.startDeckAudio("A");
deckSandbox.deckState.A = { ...deckSandbox.deckState.A, audioBuffer: { duration: 180 } };
await deckSandbox.startDeckAudio("A");
const replacement = sources.at(-1);
rejectOldLoad(new Error("Old track failed to decode"));
await supersededStart;
assert.equal(replacement.stopped, undefined, "Superseded decode errors cannot stop the replacement via caller error handling");
deckSandbox.stopTakeoverDecks();
assert.ok(sources.every(source => source.stopped));

console.log("HALO continuity contracts: radio guard preserved; DJ rollback transitions, failed replacement, recorder monitoring, and silent shutdown passed.");
