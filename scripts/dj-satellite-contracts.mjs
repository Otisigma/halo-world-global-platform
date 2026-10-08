import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../dj-recorder-guard.js";
import { SatelliteAudio, measure } from "../dj-satellite/audio.js";

const page = await readFile(new URL("../dj-satellite.html", import.meta.url), "utf8");
assert.match(page, /src="\/dj-recorder-guard.js"/);
assert.match(page, /type="module" src="\/dj-satellite\/player.js"/);
assert.doesNotMatch(page, /dj-deck-hud|mix-quality-review|speechSynthesis|site-monitor/);

class Param {
  constructor() { this.value = 1; this.calls = []; }
  setTargetAtTime(...args) { this.calls.push(args); this.value = args[0]; }
  setValueAtTime(...args) { this.calls.push(args); }
  linearRampToValueAtTime(...args) { this.calls.push(args); }
  cancelScheduledValues() {}
}
class Node {
  constructor() { this.connections = []; this.gain = new Param(); }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
}
const reaches = (node, target, seen = new Set()) => {
  if (node === target) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.connections.some(next => reaches(next, target, seen));
};
const track = { readyState: "live", enabled: true, muted: false, stop() { this.readyState = "ended"; } };
const context = {
  state: "running", currentTime: 0, sampleRate: 48000, destination: new Node(), level: 0,
  createGain: () => new Node(),
  createDynamicsCompressor: () => Object.assign(new Node(), {
    threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param(), reduction: 0
  }),
  createAnalyser() {
    return Object.assign(new Node(), { fftSize: 2048, getFloatTimeDomainData: data => data.fill(context.level) });
  },
  createMediaStreamDestination: () => Object.assign(new Node(), { stream: { getAudioTracks: () => [track], getTracks: () => [track] } }),
  createMediaStreamSource: () => new Node(),
  createBufferSource: () => Object.assign(new Node(), {
    start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; }
  }),
  addEventListener() {}, removeEventListener() {}, close: async () => {}
};
let starts = 0;
class Recorder {
  static isTypeSupported(mime) { return mime.startsWith("audio/ogg"); }
  constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = "inactive"; }
  start() { this.state = "recording"; starts++; }
  stop() {
    this.state = "inactive";
    this.ondataavailable({ data: new Blob(["music"], { type: this.mimeType }) });
    this.onstop();
  }
}
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = handler => { context.currentTime += 0.05; handler(); };
let result;
const audio = new SatelliteAudio(context, { Recorder, onRecording: blob => { result = blob; } });
try {
  assert.deepEqual(audio.limiter.connections, [audio.output, audio.feed.destination], "Only the limiter supplies music to the recorder");
  assert.equal(reaches(audio.cueBus, audio.feed.destination), false, "CUE cannot reach the recorder");
  assert.equal(reaches(audio.output, audio.feed.destination), false, "Monitor volume cannot affect recording");
  assert.equal(reaches(audio.feed.probe, context.destination), false, "Recorder probe has no feedback path");
  assert.equal(reaches(audio.decks.a.gain, audio.feed.destination), true);
  const buffer = { duration: 10, numberOfChannels: 2 };
  context.decodeAudioData = async () => buffer;
  const file = { size: 8, arrayBuffer: async () => new ArrayBuffer(8) };
  await audio.load("a", file);
  await assert.rejects(audio.record(true), /two decoded/, "Takeover requires two playable songs");
  assert.equal(starts, 0);
  await audio.load("b", file);
  assert.equal(audio.musicSources.size, 0, "Loading never starts music");

  audio.cue("a", true);
  assert.equal(reaches(audio.decks.a.cue.source, audio.feed.destination), false);
  await audio.quietCheck();
  audio.play("a");
  await assert.rejects(audio.record(), /preflight failed/, "Live music blocks recording without interrupting it");
  assert.equal(audio.musicSources.size, 1);
  assert.equal(starts, 0);
  const endMusic = () => {
    for (const handle of Array.from(audio.musicSources)) handle.source.onended();
  };
  audio.stop("a");
  assert.equal(audio.musicSources.size, 1, "Stopped source tails still block quiet-feed preflight");
  endMusic();

  for (const level of [0.01, Number.NaN]) {
    context.level = level;
    await assert.rejects(audio.record(), /preflight failed/, "Noise and invalid samples fail closed");
  }
  context.level = 0;
  context.state = "suspended";
  await assert.rejects(audio.record(), /preflight failed/);
  context.state = "running";
  track.readyState = "ended";
  await assert.rejects(audio.record(), /preflight failed/);
  track.readyState = "live";

  audio.setCrossfader(1);
  await Promise.all([audio.record(true), assert.rejects(audio.record(true), /operation/, "Concurrent recording starts are blocked")]);
  assert.equal(starts, 1);
  assert.equal(audio.recorder.stream, audio.feed.destination.stream);
  assert.equal(audio.decks.b.music.source.startTime, audio.decks.a.music.source.startTime + buffer.duration, "Takeover uses the audio clock, not browser timer handoffs");
  assert.throws(() => audio.play("a"), /cancel takeover/);
  assert.throws(() => audio.setCrossfader(0), /locked/);
  await assert.rejects(audio.load("a", file), /Finish/);
  const endAt = audio.takeoverEnd;
  endMusic();
  assert.equal(audio.recorder.state, "recording", "Recorder retains the limiter's release tail");
  context.currentTime = endAt;
  audio.tick();
  assert.ok(result instanceof Blob && result.size > 0);
  assert.equal(audio.takeover, false);
  assert.equal(audio.recorder, null);
  assert.equal(audio.crossfader, 1, "Takeover restores the operator's crossfader position");
  assert.ok(audio.decks.a.gain.gain.value < 0.0001);
  assert.equal(audio.decks.b.gain.gain.value, 1);

  await audio.record();
  audio.finish();
  assert.equal(audio.crossfader, 1, "Finishing manual recording preserves the mix position");
  await audio.record();
  audio.play("b");
  audio.cue("b", true);
  assert.equal(audio.recorder.state, "recording", "CUE remains available during manual recording");
  track.enabled = false;
  audio.tick();
  assert.equal(result, null, "Unavailable feeds discard the recording");
  track.enabled = true;
  audio.stopAll();
  endMusic();
  await audio.record();
  context.level = Number.NaN;
  audio.tick();
  assert.equal(result, null, "Invalid recorder samples discard the recording");
  context.level = 0;

  const preflight = audio.guard.preflight;
  audio.guard.preflight = async () => { audio.stopAll(); };
  await assert.rejects(audio.record(), /cancelled/, "Cancel during an asynchronous preflight cannot start recording");
  audio.guard.preflight = preflight;

  context.decodeAudioData = async () => { throw new Error("Bad audio"); };
  await assert.rejects(audio.load("a", file), /Bad audio/);
  assert.equal(audio.decks.a.buffer, null, "Failed replacement clears stale playable state");
  await assert.rejects(audio.record(true), /two decoded/);
  await assert.rejects(audio.load("a", { size: 51 * 1024 * 1024 }), /50 MiB/);
  context.decodeAudioData = async () => ({ duration: 601, numberOfChannels: 2 });
  await assert.rejects(audio.load("a", file), /10 minutes/);
  context.decodeAudioData = async () => ({ duration: 10, numberOfChannels: 6 });
  await assert.rejects(audio.load("a", file), /mono\/stereo/);

  context.level = 0.25;
  const measured = measure(audio.musicMeter);
  assert.equal(measured.peak, 0.25);
  assert.equal(measured.rms, 0.25);
  assert.equal(measured.dc, 0.25);
  assert.equal(measured.clipped, 0);
  context.level = Number.NaN;
  assert.equal(measure(audio.feed.analyser).valid, false);
  context.level = 0;
  for (let i = 0; i < 650; i++) { audio.event("test"); audio.tick(); }
  assert.equal(audio.events.length, 150, "Diagnostic events are bounded");
  assert.equal(audio.samples.length, 120, "Diagnostic sample history is bounded");
} finally {
  globalThis.setTimeout = nativeTimeout;
  await audio.destroy();
}
const elements = new Map([...page.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
  value: id === "crossfader" || id === "monitor" ? "0.5" : "0.15",
  checked: false, disabled: false, files: [], listeners: {},
  addEventListener(type, handler) { this.listeners[type] = handler; }
}]));
let playerEngine, completeLoad;
let signalLoad;
const loadStarted = new Promise(resolve => { signalLoad = resolve; });
class PlayerEngine {
  constructor(ctx, options) {
    playerEngine = this;
    this.context = ctx;
    this.options = options;
    this.decks = { a: { buffer: bufferForUI(), cue: null }, b: { buffer: bufferForUI(), cue: null } };
    this.events = [];
    this.output = { gain: new Param() };
    this.cueBus = { gain: new Param() };
  }
  setCrossfader(value) { this.crossfader = Number(value); }
  cue(id, enabled) { this.decks[id].cue = enabled ? { stopped: false } : null; }
  load() { return new Promise(resolve => { completeLoad = () => resolve(bufferForUI()); signalLoad(); }); }
  finish() { this.recorder = null; this.options.onRecording(null); }
}
function bufferForUI() { return { duration: 10 }; }
const ui = vm.createContext({
  SatelliteAudio: PlayerEngine, console, Blob, URL,
  window: { AudioContext: class { state = "running"; resume = async () => {}; }, addEventListener() {} },
  document: { getElementById: id => elements.get(id), querySelectorAll: () => [] },
  setInterval: () => 1, clearInterval() {}, setTimeout
});
const playerSource = await readFile(new URL("../dj-satellite/player.js", import.meta.url), "utf8");
vm.runInContext(playerSource.replace(/^import[^\n]+\n/, ""), ui);
await elements.get("enable").listeners.click();
elements.get("crossfader").value = "1";
elements.get("crossfader").listeners.input();
playerEngine.recorder = { state: "recording" };
elements.get("finish").listeners.click();
assert.equal(elements.get("crossfader").value, "1", "Recording completion cannot desynchronize the displayed crossfader");
assert.equal(playerEngine.crossfader, 1);
elements.get("cue-a").checked = true;
await elements.get("cue-a").listeners.change();
assert.ok(playerEngine.decks.a.cue);
elements.get("file-b").files = [{ name: "test.wav" }];
const pendingLoad = elements.get("file-b").listeners.change();
await loadStarted;
assert.equal(elements.get("cue-a").disabled, false, "Active CUE can be stopped during another deck's decode");
elements.get("cue-a").checked = false;
await elements.get("cue-a").listeners.change();
assert.equal(playerEngine.decks.a.cue, null, "CUE stop is not dropped by the load operation lock");
completeLoad();
await pendingLoad;
console.log("DJ satellite contracts passed: isolated graph, quiet-feed failures, recording lifecycle, CUE, audio-clock takeover, and UI regressions.");
