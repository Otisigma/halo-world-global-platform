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

console.log("DJ session + audio engine contracts passed");
