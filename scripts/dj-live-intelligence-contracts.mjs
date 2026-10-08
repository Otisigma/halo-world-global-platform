import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, deck] = await Promise.all([
  readFile(new URL("../dj-live-intelligence.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);
let yields = 0;
const sandbox = { setTimeout(resolve) { yields += 1; resolve(); } };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { HaloTrackMemoryManager, HaloLiveIntelligenceSystem, HaloIndexUploadBatch } = sandbox;
const memory = new HaloTrackMemoryManager();

assert.equal(memory.list(), null, "Existing library recommendations remain available before uploads");
assert.equal(memory.isAuthorized("library"), true);
memory.lockUploadBatch([{ id: "old" }, { id: "old" }, {}]);
assert.equal(memory.list().length, 1, "Batch ids are deduplicated");
memory.lockUploadBatch([{ id: "new" }]);
assert.equal(memory.isAuthorized("old"), false, "A new batch replaces authorization for the old batch");
assert.equal(memory.isAuthorized("new"), true);
memory.release("new");
assert.equal(memory.isAuthorized("new"), false, "Deleted tracks leave the batch");

let indexing = 0;
let maxIndexing = 0;
const indexed = await HaloIndexUploadBatch(Array.from({ length: 25 }, (_, id) => id), async id => {
  indexing += 1;
  maxIndexing = Math.max(maxIndexing, indexing);
  await Promise.resolve();
  indexing -= 1;
  return { id };
});
assert.equal(maxIndexing, 1, "Artwork/file indexing never fans out across the batch");
assert.equal(yields, 3, "Long batches yield to the event loop every eight files");
assert.equal(indexed.length, 25);
assert.deepEqual(Array.from(indexed, track => track.id), Array.from({ length: 25 }, (_, id) => id));

const makeAsset = () => ({ file: { async arrayBuffer() { return new ArrayBuffer(4); } }, buffer: null, promise: null });
const first = makeAsset();
const second = makeAsset();
let finishDecode;
let decoding = 0;
let maxDecoding = 0;
let decodeCount = 0;
const context = {
  async decodeAudioData() {
    decodeCount += 1;
    decoding += 1;
    maxDecoding = Math.max(maxDecoding, decoding);
    await new Promise(resolve => { finishDecode = resolve; });
    decoding -= 1;
    return { duration: 60 };
  }
};
memory.pinAssets([first, second]);
const firstDecode = memory.decode(first, context);
assert.equal(memory.decode(first, context), firstDecode, "Pre-roll and playback share the same pending decode");
const secondDecode = memory.decode(second, context);
await new Promise(resolve => setImmediate(resolve));
assert.equal(decodeCount, 1, "Only one file is read/decoded at a time");
finishDecode();
const firstBuffer = await firstDecode;
await new Promise(resolve => setImmediate(resolve));
finishDecode();
await secondDecode;
assert.equal(maxDecoding, 1);
assert.equal(first.buffer, firstBuffer);
assert.equal(first.promise, null);
assert.equal(await memory.decodeQueue, null, "The serialization tail never retains a completed AudioBuffer");
memory.pinAssets([second]);
assert.equal(first.buffer, null, "Replacing/ejecting a deck releases its library buffer");
assert.ok(second.buffer, "The other deck's decoded buffer survives");
assert.equal(await memory.decode(first, context), null, "Unloaded library files are never decoded");

const stale = makeAsset();
memory.pinAssets([second, stale]);
const staleDecode = memory.decode(stale, context);
await new Promise(resolve => setImmediate(resolve));
memory.pinAssets([second]);
finishDecode();
assert.equal(await staleDecode, null, "In-flight stale completions cannot restore released buffers");
assert.equal(stale.buffer, null);

const failing = makeAsset();
memory.pinAssets([failing]);
await assert.rejects(memory.decode(failing, { async decodeAudioData() { throw new Error("bad audio"); } }), /bad audio/);
assert.equal(failing.promise, null, "A failed decode can be retried");
const recovered = await memory.decode(failing, { async decodeAudioData() { return { duration: 12 }; } });
assert.equal(recovered.duration, 12, "A failed decode does not poison the serialized queue");

const rapid = Array.from({ length: 40 }, makeAsset);
const rapidTasks = [];
let rapidDecodes = 0;
for (const asset of rapid) {
  memory.pinAssets([asset, failing]);
  rapidTasks.push(memory.decode(asset, { async decodeAudioData() { rapidDecodes += 1; return { duration: 1 }; } }));
}
await Promise.all(rapidTasks);
assert.equal(rapidDecodes, 1, "Superseded queued loads skip file reads and decoding");
assert.equal(rapid.filter(asset => asset.buffer).length, 1, "Rapid deck changes do not accumulate decoded audio");
assert.ok(failing.buffer, "The live deck stays pinned throughout rapid loads");
memory.pinAssets([]);
assert.equal(await memory.decodeQueue, null, "Ejecting both decks leaves no buffer in the decode queue");
assert.equal(failing.buffer, null);

memory.lockUploadBatch([{ id: "allowed" }]);
const calls = [];
let busy = false;
const controller = {
  canLoad(deckId) { return deckId === "B" && !busy; },
  loadTrackSilently(deckId, id) { calls.push([deckId, id]); return true; }
};
const intelligence = new HaloLiveIntelligenceSystem(controller, memory);
assert.equal(intelligence.silentSearchAndLoad("old", { deckId: "B" }).reason, "unauthorized");
busy = true;
assert.equal(intelligence.silentSearchAndLoad("allowed", { deckId: "B" }).reason, "deck-busy");
busy = false;
assert.equal(intelligence.silentSearchAndLoad("allowed", { deckId: "invalid" }).reason, "deck-busy");
assert.equal(calls.length, 0, "Unauthorized/busy loads never touch deck playback");
assert.equal(intelligence.silentSearchAndLoad("allowed", { deckId: "B" }).ok, true);
assert.deepEqual(calls, [["B", "allowed"]]);
controller.loadTrackSilently = () => { throw new Error("load failed"); };
assert.equal(intelligence.silentSearchAndLoad("allowed", { deckId: "B" }).reason, "load-failed", "Failures stay non-blocking");

// Exercise the real load path rather than only asserting source patterns.
const loadStart = deck.indexOf("    function loadTrack(");
const loadEnd = deck.indexOf("    function ejectDeck(", loadStart);
let toasts = 0;
let suppressions = 0;
let stops = 0;
const slider = { value: 4 };
const wiring = {
  tracks: [{ id: "allowed", bpm: 124, title: "Uploaded track", audioAsset: makeAsset() }],
  audioEngine: { halo: { suppressLiveIntelligence() { suppressions += 1; } } },
  deckState: { A: { playing: true }, B: {} },
  document: { querySelector() { return slider; } },
  window: {},
  stopDeckAudio() { stops += 1; },
  syncTrackMemoryPins() {},
  updateRangeFill() {},
  updateDeck() {},
  showToast() { toasts += 1; },
  prepareDeckContinuityPreroll() {}
};
vm.createContext(wiring);
vm.runInContext(deck.slice(loadStart, loadEnd), wiring);
assert.equal(wiring.loadTrack("B", "allowed", { silent: true }), true);
assert.equal(toasts, 0, "Silent loading emits no notifications/guide speech");
assert.equal(suppressions, 0, "Silent loading leaves live room analysis alone");
assert.equal(wiring.deckState.A.playing, true, "The active deck is untouched");
assert.equal(wiring.deckState.B.playing, false, "Preparation never starts playback");
assert.equal(stops, 1);
wiring.loadTrack("B", "allowed");
assert.equal(toasts, 1, "Manual loads preserve their normal notifications");
assert.equal(suppressions, 1, "Manual loads preserve anti-click input suppression");

wiring.trackMemory = memory;
wiring.window.HaloLiveIntelligenceSystem = HaloLiveIntelligenceSystem;
wiring.currentRecommendation = { trackId: "allowed", transitionBars: 16 };
wiring.activeDeckId = () => "A";
wiring.elements = { aiBrief: {}, mixIntent: { value: "hold" }, search: { value: "" } };
wiring.trackQueue = ["allowed"];
wiring.renderTracks = () => {};
wiring.renderQueue = () => {};
wiring.recordTransitionObservation = () => {};
wiring.deckState.A.bpm = 120;
const controllerStart = deck.indexOf("    const liveIntelligence =");
const controllerEnd = deck.indexOf("    function syncTrackMemoryPins(", controllerStart);
const prepareStart = deck.indexOf("    function prepareRecommendedTransition(");
const prepareEnd = deck.indexOf("    async function importTrack(", prepareStart);
vm.runInContext(deck.slice(controllerStart, controllerEnd) + deck.slice(prepareStart, prepareEnd), wiring);
wiring.deckState.B.playing = true;
const busyDeck = wiring.deckState.B;
wiring.prepareRecommendedTransition();
assert.equal(wiring.deckState.B, busyDeck, "The real preparation handler refuses a playing destination deck");
assert.match(wiring.elements.aiBrief.textContent, /Both decks are live/);
wiring.deckState.B.playing = false;
wiring.prepareRecommendedTransition();
assert.equal(wiring.deckState.B.bpm, 120, "Idle-deck preparation still matches the master tempo");
assert.equal(wiring.deckState.B.playing, false);
assert.equal(toasts, 1, "The entire preparation handler remains notification-free");
wiring.currentRecommendation = { trackId: "old" };
const preparedDeck = wiring.deckState.B;
wiring.prepareRecommendedTransition();
assert.equal(wiring.deckState.B, preparedDeck, "An old-batch recommendation cannot replace the prepared track");

const artworkStart = deck.indexOf("    async function embeddedArtworkUrl(");
const artworkEnd = deck.indexOf("    async function handleDriveUpload(", artworkStart);
let artworkReads = 0;
const artworkSandbox = {
  Uint8Array,
  synchsafeInteger: () => 3 * 1024 * 1024,
  parseEmbeddedArtwork() { throw new Error("Oversized tags must not be parsed"); }
};
vm.createContext(artworkSandbox);
vm.runInContext(deck.slice(artworkStart, artworkEnd), artworkSandbox);
const oversizedArtwork = {
  name: "huge-cover.mp3",
  type: "audio/mpeg",
  slice() {
    artworkReads += 1;
    return { async arrayBuffer() { return new Uint8Array([73, 68, 51, 0, 0, 0, 0, 0, 0, 0]).buffer; } };
  }
};
assert.equal(await artworkSandbox.embeddedArtworkUrl(oversizedArtwork), "");
assert.equal(artworkReads, 1, "Oversized cover tags fall back before allocating their contents");

const moduleScript = '<script src="/dj-live-intelligence.js"></script>';
assert.ok(deck.indexOf(moduleScript) < deck.indexOf("    const trackMemory ="), "The module loads synchronously before deck initialization");
assert.ok(deck.includes(moduleScript));
assert.match(deck, /trackMemory\.pinAssets\(\[deckState\.A\.audioAsset, deckState\.B\.audioAsset\]\)/);
assert.match(deck, /deckState\[deckId\] !== state \|\| !buffer/);
assert.match(deck, /trackMemory\.lockUploadBatch\(additions\)/);
assert.match(deck, /artworkBudget = 16 \* 1024 \* 1024/);
assert.match(deck, /liveIntelligence\.silentSearchAndLoad\(recommendation\.trackId/);
for (const script of deck.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (script[1].trim()) new vm.Script(script[1]);
}
console.log("DJ Live Intelligence contracts passed: bounded indexing, serialized/pinned decoding, batch authorization, and silent idle-deck loading.");
