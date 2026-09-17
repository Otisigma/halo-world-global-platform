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
      createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0 }; }
    },
    masterGain: { connect() {} }
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

console.log("HALO continuity guard contracts: predictive pre-roll, silence watchdog, filler bridge, and monitoring hooks behave as expected.");
