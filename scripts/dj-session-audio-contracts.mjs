import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [managerSource, engineSource, deckPage] = await Promise.all([
  readFile(new URL("../services/deckSessionManager.js", import.meta.url), "utf8"),
  readFile(new URL("../services/haloAudioEngine.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);

class MockParam {
  constructor(value = 1) { this.value = value; this.events = []; }
  cancelScheduledValues(time) { this.events.push(["cancel", time]); }
  setValueAtTime(value, time) { this.events.push(["set", value, time]); this.value = value; }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0, "Exponential ramps never target zero");
    this.events.push(["exp", value, time]);
    this.value = value;
  }
  setTargetAtTime(value, time, constant) { this.events.push(["target", value, time, constant]); this.value = value; }
}
class MockNode {
  constructor() { this.connections = []; }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
}
class MockGain extends MockNode { constructor() { super(); this.gain = new MockParam(1); } }
class MockSource extends MockNode {
  start(when, offset) { this.started = [when, offset]; }
  stop(when) { this.stopped = when; }
  addEventListener(type, handler) { this.ended = handler; }
}
class MockContext {
  constructor(options) { this.options = options; this.currentTime = 10; this.destination = new MockNode(); }
  createGain() { return new MockGain(); }
  createAnalyser() { return new MockNode(); }
  createMediaStreamSource() { return new MockNode(); }
}

const timers = [];
const storageData = new Map([["halo.dj.session.v1", "{}"], ["halo.dj.booth-screen.v1", "wave"]]);
const sandbox = {
  console,
  URLSearchParams,
  globalThis: null,
  webkitAudioContext: MockContext,
  localStorage: {
    getItem: key => storageData.has(key) ? storageData.get(key) : null,
    removeItem: key => storageData.delete(key)
  },
  setTimeout(handler, delay) { timers.push({ handler, delay }); return timers.length; },
  clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(managerSource, sandbox);
vm.runInContext(engineSource, sandbox);

const { HaloDeckSessionManager: manager, HaloAudioEngine } = sandbox;

// Session purge & fresh takeover initialization.
assert.equal(manager.shouldStartFreshTakeover("?takeover=60&dj=halo"), true, "Takeover URL starts a clean deck session");
assert.equal(manager.shouldStartFreshTakeover("?takeover=60&dj=halo&restore=1"), false, "restore=1 explicitly keeps the saved session");
assert.equal(manager.shouldStartFreshTakeover(""), false, "Normal deck loads keep their saved session");
assert.equal(manager.shouldStartFreshTakeover("?takeover=abc"), false, "Invalid takeover flags are ignored");
const container = { cleared: 0, replaceChildren() { this.cleared += 1; } };
const fresh = manager.initializeFreshTakeover({ playlistContainers: [container, null] });
assert.deepEqual(Array.from(fresh.clearedKeys), ["halo.dj.session.v1"], "Deck session snapshot is purged");
assert.equal(storageData.has("halo.dj.session.v1"), false);
assert.equal(storageData.get("halo.dj.booth-screen.v1"), "wave", "UI preferences survive the purge");
assert.equal(container.cleared, 1, "Queued playlist container is emptied");
assert.equal(fresh.decks.A, null);
assert.equal(fresh.decks.B, null);
assert.equal(fresh.queue.length, 0);

// Engine construction falls back to webkitAudioContext and owns a single graph.
const engine = new HaloAudioEngine();
assert.ok(engine.context instanceof MockContext, "WebKit AudioContext fallback is supported");
assert.equal(engine.context.options, undefined, "No forced sample rate unless configured");
assert.ok(engine.deckAGain.connections.includes(engine.masterGain));
assert.ok(engine.masterGain.connections.includes(engine.context.destination));

// Constant-power crossfade.
for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
  const { gainA, gainB } = HaloAudioEngine.constantPowerGains(mix);
  assert.ok(Math.abs(gainA ** 2 + gainB ** 2 - 1) < 1e-9, `Crossfade at ${mix} keeps constant power`);
}
const centre = engine.crossfade(0.5);
assert.ok(Math.abs(centre.gainA - Math.SQRT1_2) < 1e-9);
assert.equal(engine.deckAGain.gain.events.at(-1)[0], "target", "Crossfader glides with setTargetAtTime");
assert.deepEqual(Array.from(Object.values(HaloAudioEngine.constantPowerGains(4))), [Math.cos(Math.PI / 2), 1], "Mix ratio is clamped");

// Smooth gain ramps.
const ramp = new MockGain();
engine.applySmoothGainRamp(ramp, 0);
const rampKinds = ramp.gain.events.map(event => event[0]);
assert.deepEqual(rampKinds, ["cancel", "set", "exp", "set"], "Mute ramps exponentially then lands on hard zero");
assert.ok(Math.abs(ramp.gain.events[2][2] - 10.05) < 1e-9, "Default ramp is 50ms");

// Live Intelligence input suppression during load/trigger, restored after stabilisation.
engine.attachLiveIntelligenceInput({});
assert.equal(engine.isAnalyzing, true);
const source = new MockSource();
const started = await engine.loadAndPlayTrack("B", source);
assert.equal(engine.isAnalyzing, false, "Room input is muted while the track starts");
assert.equal(engine.micGainNode.gain.value, HaloAudioEngine.SILENCE, "Mic is attenuated to near-zero");
assert.ok(source.connections.includes(started.envelope));
assert.ok(started.envelope.connections.includes(engine.deckBGain));
assert.deepEqual(started.envelope.gain.events.map(event => event[0]), ["set", "set", "exp"], "Track starts from silence with an exponential fade-in");
const restore = timers.at(-1);
assert.ok(restore.delay >= 150 + 80 && restore.delay <= 200 + 80, "Mic restore waits 150-200ms after the fade-in stabilises");
restore.handler();
assert.equal(engine.isAnalyzing, true, "Room input returns after stabilisation");
assert.equal(engine.micGainNode.gain.value, 1);

engine.suppressLiveIntelligence(1);
const pending = timers.at(-1);
engine.suppressLiveIntelligence(0);
assert.equal(pending.cleared, true, "A new trigger cancels an earlier pending restore");

// Anti-thump stop.
engine.stopSourceSmoothly(source, started.envelope);
assert.equal(started.envelope.gain.events.at(-1)[0], "exp");
assert.ok(source.stopped > engine.context.currentTime, "Source stops after the fade-out instead of cutting abruptly");

// Deck wiring.
assert.match(deckPage, /<script src="\/services\/deckSessionManager\.js"><\/script>/);
assert.match(deckPage, /<script src="\/services\/haloAudioEngine\.js"><\/script>/);
assert.match(deckPage, /shouldStartFreshTakeover\(window\.location\.search\)/, "Deck detects takeover launches");
assert.match(deckPage, /if \(freshTakeoverRequested\) return null;/, "Fresh takeovers skip local session restore");
assert.match(deckPage, /!sessionCloudEnabled \|\| freshTakeoverRequested/, "Fresh takeovers skip cloud session restore");
assert.match(deckPage, /if \(freshTakeoverRequested\) startFreshTakeoverSession\(\);/);
assert.match(deckPage, /new window\.HaloAudioEngine\(\{ context, masterGain, deckAGain: audioEngine\.decks\.A\.gain, deckBGain: audioEngine\.decks\.B\.gain, routingGuard: audioEngine\.routing \}\)/, "Deck adopts its existing graph");
assert.match(deckPage, /audioEngine\.halo\.crossfade\(mix\)/);
assert.match(deckPage, /audioEngine\.halo\.startSourceWithFadeIn\(/);
assert.match(deckPage, /audioEngine\.halo\.stopSourceSmoothly\(/);
assert.match(deckPage, /halo\?\.scheduleLiveIntelligenceRestore\(/);
assert.match(deckPage, /audioEngine\.halo\?\.suppressLiveIntelligence\(\);\n\s+stopDeckAudio\(deckId\);/, "Loading a track suppresses the room input");

function deckFunction(name, nextName) {
  const start = deckPage.indexOf(`function ${name}(`);
  const end = deckPage.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `Find ${name} in the deck`);
  return deckPage.slice(start, end).replace(/\s*async\s*$/, "");
}
const metadata = {
  tracks: [], deckState: {}, trackQueue: [], sessionRestoring: false,
  elements: {
    crossfader: {}, mixIntent: {}, energyCurve: {}, setPhase: {},
    driveButton: {}, folderButton: {}, search: {},
    importButton: {}, musicUrl: { value: "https://example.com/song" },
    importStatus: { classList: { remove() {}, add() {} } }
  },
  document: { querySelector: () => ({}) },
  modeProfiles: { listening: {} }, energyCurves: {},
  selectedImportDeck: "A", pendingPlaybackDeck: null,
  setDjMode() {}, setDeskOnlyMode() {}, updateRangeFill() {},
  renderTracks() {}, renderQueue() {}, updateDeck() {}, recommendLocally() {},
  embeddedArtworkUrl: async () => "",
  loadTrack(deckId, id) { metadata.loaded = { deckId, id }; },
  showToast() {}, window: {}
};
vm.createContext(metadata);
vm.runInContext([
  deckPage.match(/const TRACK_DNA_DEFAULTS = .*?;/)[0],
  deckFunction("trackText", "normalizeTrackMetadata"),
  deckFunction("normalizeTrackMetadata", "sessionTrack"),
  deckFunction("applySessionSnapshot", "restoreLocalSession"),
  `async ${deckPage.slice(deckPage.indexOf("function handleDriveUpload("), deckPage.indexOf("\n    syncMaintenanceDockLabel();"))}`,
  `async ${deckFunction("importTrack", "syncDecks")}`
].join("\n"), metadata);

const audioAsset = { file: { name: "song.wav" } };
const audioBuffer = { decoded: true };
const stemAssets = { vocals: { url: "/private/vocals" } };
const original = {
  id: "preserved", title: "Supplied title", artist: "Supplied artist",
  sonicWeather: "Warm and patient", audioAsset, audioBuffer, stemAssets,
  stemPermission: true, vaultPackId: "private-pack"
};
const normalized = metadata.normalizeTrackMetadata(original);
for (const key of Object.keys(original)) assert.equal(normalized[key], original[key], `${key} survives normalization`);
assert.notEqual(normalized, original, "Normalization does not mutate its input");
for (const sonicWeather of [undefined, null, "", "   ", 42]) {
  const track = metadata.normalizeTrackMetadata({ id: "legacy", title: null, artist: undefined, key: null, genre: null, platform: null, energyRole: null, signatureMoment: null, sonicWeather });
  assert.equal(track.title, "Untitled");
  assert.equal(track.artist, "Unknown artist");
  assert.equal(track.key, "--");
  assert.equal(track.genre, "");
  assert.equal(track.platform, "HALO Library");
  assert.equal(track.energyRole, "builder");
  assert.equal(track.sonicWeather, sonicWeather === 42 ? "42" : "Balanced, groove-led and open enough for a patient blend.");
  assert.ok(track.signatureMoment.length > 0);
}

const savedDeck = { ...original, sonicWeather: null, bpm: 124, pitch: 2 };
assert.equal(metadata.applySessionSnapshot({
  version: 1,
  library: [{ id: "legacy", sonicWeather: null, bpm: 120 }, original],
  decks: { A: savedDeck, B: { id: "empty", empty: true, title: "No track loaded" } },
  queue: ["legacy", "unknown", "preserved"]
}), true);
assert.deepEqual(Array.from(metadata.tracks, track => track.id), ["legacy", "preserved"], "Restore preserves library order");
assert.deepEqual(Array.from(metadata.trackQueue), ["legacy", "preserved"]);
assert.equal(metadata.tracks[0].title, "Untitled");
assert.equal(typeof metadata.deckState.A.sonicWeather, "string");
assert.equal(metadata.deckState.A.audioAsset, audioAsset);
assert.equal(metadata.deckState.A.audioBuffer, audioBuffer);
assert.equal(metadata.deckState.A.stemAssets, stemAssets);
assert.equal(metadata.deckState.A.stemPermission, true);
assert.equal(metadata.deckState.A.playing, false, "Restoration never resumes saved playback");
assert.equal(metadata.deckState.B.empty, true, "An empty restored deck stays empty");
assert.equal(metadata.sessionRestoring, false);

const upload = { name: "Folder Song.wav", type: "audio/wav", webkitRelativePath: "Album/Folder Song.wav" };
await metadata.handleDriveUpload({ target: { files: [upload], value: "selected" } });
const driveTrack = metadata.tracks[0];
assert.equal(driveTrack.title, "Folder Song");
assert.equal(driveTrack.artist, "Album");
assert.equal(driveTrack.audioAsset.file, upload, "Ingestion keeps the original File reference");
assert.equal(driveTrack.platform, "Private Drive Upload");
assert.ok(driveTrack.sonicWeather.length > 0);
assert.equal(metadata.loaded.id, driveTrack.id);

metadata.fetch = async () => ({ ok: true, json: async () => ({ title: null, artist: null, platform: null }) });
await metadata.importTrack({ preventDefault() {} });
const imported = metadata.tracks[0];
assert.equal(imported.title, "Imported track");
assert.equal(imported.artist, "Unknown artist");
assert.equal(imported.platform, "Music service");
assert.equal(imported.sourceUrl, "https://example.com/song");
assert.ok(imported.sonicWeather.length > 0);

console.log("DJ session + audio engine contracts passed");
