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

console.log("HALO continuity guard contracts: predictive pre-roll, silence watchdog, filler bridge, and monitoring hooks behave as expected.");
