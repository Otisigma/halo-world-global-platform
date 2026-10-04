import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [moduleSource, deckPage, packageJson] = await Promise.all([
  readFile(new URL("../dj-live-intelligence.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

const logs = { info: [], warn: [], error: [] };
const logger = {
  info: (...args) => logs.info.push(args.join(" ")),
  warn: (...args) => logs.warn.push(args.join(" ")),
  error: (...args) => logs.error.push(args.map(String).join(" "))
};
const sandbox = { console: logger, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(moduleSource, sandbox);

const { HaloTrackMemoryManager: TrackMemoryManager, HaloLiveIntelligenceSystem: LiveIntelligenceSystem } = sandbox;
assert.equal(typeof TrackMemoryManager, "function", "Track memory manager is exported");
assert.equal(typeof LiveIntelligenceSystem, "function", "Live Intelligence system is exported");

// TrackMemoryManager: only the freshly uploaded batch is authorized.
let clock = 1000;
const memory = new TrackMemoryManager({ logger, now: () => clock });
assert.equal(memory.size, 0, "Memory starts empty");
assert.equal(memory.getAuthorizedTrack("drive-1"), null, "Empty memory authorizes nothing");

const firstBatch = [{ id: "drive-1", title: "Old One" }, { id: "drive-2", title: "Old Two" }, { id: "drive-2", title: "Duplicate" }, { title: "No id" }, null];
const firstSnapshot = memory.lockUploadBatch(firstBatch);
assert.equal(firstSnapshot.size, 2, "Batch keeps unique tracks with ids only");
assert.equal(firstSnapshot.batchId, "upload-batch-1000");
assert.equal(memory.getAuthorizedTrack("drive-2").title, "Old Two", "First occurrence wins for duplicate ids");

clock = 2000;
const freshTrack = { id: "drive-3", title: "Fresh Cut", artist: "Batch Artist" };
const secondSnapshot = memory.lockUploadBatch([freshTrack, { id: "drive-4", title: "Fresh Dub", artist: "Other" }]);
assert.deepEqual([...secondSnapshot.trackIds], ["drive-3", "drive-4"], "Locking a new batch replaces the previous batch");
assert.ok(logs.info.some(line => /Past booth memory cleared \(2 tracks\)/.test(line)), "Clearing previous memory is logged");
assert.equal(memory.getAuthorizedTrack("drive-1"), null, "Tracks from a previous batch are rejected");
assert.ok(logs.warn.some(line => /Blocked: attempted to load a track outside the current upload batch/.test(line)), "Rejected loads are logged");
assert.equal(memory.getAuthorizedTrack("drive-3"), freshTrack, "Batch tracks are returned by reference for the deck");
assert.equal(memory.isAuthorized("drive-4"), true);
assert.equal(memory.release("drive-4"), true, "Deleted library tracks can be released from the batch");
assert.equal(memory.isAuthorized("drive-4"), false);
memory.lockUploadBatch([]);
assert.equal(memory.size, 0, "An empty batch still clears previous memory");
assert.equal(memory.batchId, null);
memory.lockUploadBatch([freshTrack, { id: "drive-4", title: "Fresh Dub", artist: "Other" }]);

// LiveIntelligenceSystem: requires a real controller and memory manager.
assert.throws(() => new LiveIntelligenceSystem({}, memory), /audio controller/);
assert.throws(() => new LiveIntelligenceSystem({ setSystemUIVolume() {}, loadTrackSilently() {} }, {}), /TrackMemoryManager/);

function createController(overrides = {}) {
  const calls = [];
  const controller = {
    calls,
    volume: 0.7,
    setSystemUIVolume(level) { calls.push(["volume", level]); controller.volume = level; },
    async loadTrackSilently(track, options) {
      calls.push(["load", track.id, options.deckId, controller.volume]);
    },
    ...overrides
  };
  return controller;
}

const controller = createController();
const live = new LiveIntelligenceSystem(controller, memory, { logger });

const found = live.silentSearch("fresh dub");
assert.equal(found.length, 1, "Silent search only searches the active batch");
assert.equal(found[0].id, "drive-4");
assert.equal(live.silentSearch().length, 2, "Empty search returns the whole active batch");
assert.equal(live.silentSearch("Old One").length, 0, "Previous batches are not searchable");
assert.ok(controller.calls.length >= 2 && controller.calls.every(([type, level]) => type === "volume" && level === 0), "Search holds the system UI bus at volume 0");

controller.calls.length = 0;
controller.volume = 0.7;
const loaded = await live.silentSearchAndLoad("drive-3", { deckId: "B" });
assert.equal(loaded.ok, true, "Authorized tracks load");
assert.equal(loaded.track, freshTrack);
assert.deepEqual(controller.calls[0], ["volume", 0], "System UI bus is muted before the load starts");
assert.deepEqual(controller.calls[1], ["load", "drive-3", "B", 0], "Track loads to the requested deck while UI audio is muted");
assert.deepEqual(controller.calls.at(-1), ["volume", 0], "System UI bus stays muted after the load");

controller.calls.length = 0;
const refused = await live.silentSearchAndLoad("drive-1", { deckId: "A" });
assert.equal(refused.ok, false, "Tracks outside the batch fail closed");
assert.equal(refused.reason, "unauthorized");
assert.equal(refused.message, LiveIntelligenceSystem.UNAUTHORIZED_MESSAGE);
assert.ok(!controller.calls.some(([type]) => type === "load"), "Unauthorized tracks never reach the audio controller");
assert.deepEqual(controller.calls.at(-1), ["volume", 0], "UI bus stays muted after a refusal");
assert.ok(logs.error.some(line => /Silent load refused: Track not found in the current upload batch/.test(line)), "Refusals are logged clearly");

const failing = createController({ async loadTrackSilently() { throw new Error("decode failed"); } });
const failingLive = new LiveIntelligenceSystem(failing, memory, { logger });
const failed = await failingLive.silentSearchAndLoad("drive-3", { deckId: "A" });
assert.equal(failed.ok, false, "Controller errors are reported, not thrown");
assert.equal(failed.reason, "load-failed");
assert.equal(failed.message, "decode failed");
assert.deepEqual(failing.calls.at(-1), ["volume", 0], "UI bus stays muted after an error");

let muteAttempts = 0;
let loadAttempts = 0;
const unmutable = { setSystemUIVolume() { muteAttempts += 1; throw new Error("bus missing"); }, async loadTrackSilently() { loadAttempts += 1; } };
const unmutableResult = await new LiveIntelligenceSystem(unmutable, memory, { logger }).silentSearchAndLoad("drive-3", { deckId: "A" });
assert.equal(unmutableResult.ok, false, "Load fails closed when the UI bus cannot be muted");
assert.equal(unmutableResult.reason, "mute-failed");
assert.equal(loadAttempts, 0, "No load is attempted without a muted UI bus");
assert.ok(muteAttempts >= 2, "Mute is retried after the aborted operation");

for (const line of [...logs.info, ...logs.warn, ...logs.error, LiveIntelligenceSystem.UNAUTHORIZED_MESSAGE]) {
  assert.doesNotMatch(line, /absolute silence|guarantee|100% silent/i, "Logs never promise absolute silence");
}

// Deck wiring.
const intelligenceScript = deckPage.indexOf('<script src="/dj-live-intelligence.js"></script>');
const inlineScript = deckPage.indexOf("<script>", deckPage.indexOf('<script src="/upload-progress.js"></script>'));
assert.ok(intelligenceScript > -1 && intelligenceScript < inlineScript, "DJ deck loads the Live Intelligence module before the deck script");
assert.match(deckPage, /const trackMemory = window\.HaloTrackMemoryManager \? new window\.HaloTrackMemoryManager\(\) : null;/, "Deck creates a session-scoped track memory");
assert.match(deckPage, /new window\.HaloLiveIntelligenceSystem\(liveIntelligenceAudioController, trackMemory\)/, "Deck wires Live Intelligence to its audio controller and memory");
assert.match(deckPage, /trackMemory\?\.lockUploadBatch\(additions\);\n\s*tracks\.unshift\(\.\.\.additions\);/, "Drive and folder uploads lock the fresh batch");
assert.match(deckPage, /trackMemory\?\.release\(trackId\);/, "Deleting a library track releases it from the batch");
assert.match(deckPage, /systemUiGain\.connect\(context\.destination\)/, "System UI bus feeds the local output");
assert.doesNotMatch(deckPage, /systemUiGain\.connect\((?:masterGain|limiter|audioEngine\.(?:masterGain|limiter|recordingDestination))\)/, "System UI bus never reaches the master or recorder");
assert.match(deckPage, /systemUiVolume: 0,/, "System UI bus starts muted");
assert.match(deckPage, /window\.HaloGuideVoice\?\.cancel\?\.\(\)/, "Muting also cancels in-flight guide speech");
const prepareStart = deckPage.indexOf("async function prepareRecommendedTransition()");
const prepareEnd = deckPage.indexOf("async function importTrack(", prepareStart);
assert.ok(prepareStart > -1 && prepareEnd > prepareStart, "Prepare next deck runs through an async silent loader");
const prepareBody = deckPage.slice(prepareStart, prepareEnd);
assert.match(prepareBody, /await liveIntelligence\.silentSearchAndLoad\(recommendation\.trackId, \{ deckId: targetDeck \}\)/, "Prepare next deck loads through the silent loader");
assert.doesNotMatch(prepareBody, /loadTrack\(targetDeck/, "Prepare next deck never bypasses the batch guard");
assert.match(prepareBody, /if \(!liveIntelligence\)[\s\S]*?return;/, "Prepare next deck fails closed without the loader");
assert.match(prepareBody, /if \(!loadResult\.ok\)[\s\S]*?return;/, "Prepare next deck stops on refused loads");
assert.match(deckPage, /const batchTracks = trackMemory\?\.size \? trackMemory\.list\(\) : \[\];/, "Recommendations draw from the active batch once one is locked");
assert.match(deckPage, /cloudOutsideBatch/, "Cloud picks outside the batch fall back to the local batch pick");

assert.match(packageJson, /node scripts\/dj-live-intelligence-contracts\.mjs/, "npm test runs the Live Intelligence contracts");

console.log("DJ Live Intelligence contracts: upload-batch memory guard, silent search/load, fail-closed refusals, and deck wiring behave as expected.");
