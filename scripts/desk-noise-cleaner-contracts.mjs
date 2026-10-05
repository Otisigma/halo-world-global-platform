import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [cleanerSource, guardSource, deckPage] = await Promise.all([
  readFile(new URL("../desk-noise-cleaner.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-recorder-guard.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);

class MockParam {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
}
class MockNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    for (const name of ["gain", "frequency", "Q", "threshold", "knee", "ratio", "attack", "release"]) {
      this[name] = new MockParam();
    }
  }
  connect(target, ...ports) { this.connections.push({ target, ports }); return target; }
  disconnect() { this.connections = []; }
}
class MockContext {
  constructor() {
    this.currentTime = 0;
    this.nodes = [];
    this.destination = this.node("speakers");
  }
  node(kind) { const node = new MockNode(this, kind); this.nodes.push(node); return node; }
  createGain() { return this.node("gain"); }
  createBiquadFilter() { return this.node("filter"); }
  createDynamicsCompressor() { return this.node("limiter"); }
  createMediaStreamDestination() { return this.node("recorder"); }
  createChannelSplitter() { return this.node("splitter"); }
  createAnalyser() { return this.node("analyser"); }
  createBufferSource() { const source = this.node("music"); source.buffer = {}; return source; }
  createOscillator() { return this.node("oscillator"); }
}

const cleanupCall = "window.HaloDeskNoiseCleaner.connect(context, audioEngine.monitorBus, audioEngine.recorderIsolation);";
assert.equal(deckPage.split(cleanupCall).length - 1, 1, "Cleanup is installed once, only on the monitor bus");
assert.match(deckPage, /<script src="\/desk-noise-cleaner\.js" defer><\/script>/);
assert.doesNotMatch(deckPage, /monitorBus\.connect\(context\.destination\)/, "No unfiltered monitor bypass remains");

// Execute the actual desk initialization through the unchanged recorder/analyser tap.
const start = deckPage.indexOf("async function ensureAudio() {");
const end = deckPage.indexOf('        ["A", "B"].forEach(deckId => {', start);
assert.ok(start >= 0 && end > start);
const initialization = `${deckPage.slice(start, end)} } }\nensureAudio();`;
async function build(cleaned = true) {
  const sandbox = { console, AudioContext: MockContext, audioEngine: {} };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(guardSource, sandbox);
  vm.runInContext(cleanerSource, sandbox);
  sandbox.HaloAudioRoutingGuard = {};
  await vm.runInContext(cleaned ? initialization : initialization.replace(cleanupCall, "audioEngine.monitorBus.connect(context.destination);"), sandbox);
  const engine = sandbox.audioEngine;
  const music = engine.context.createBufferSource();
  engine.recorderIsolation.allowMusicSource(music);
  music.connect(engine.masterGain);
  const monitorSource = engine.context.createOscillator();
  engine.recorderIsolation.monitorOnly(monitorSource);
  monitorSource.connect(engine.monitorBus);
  return { engine, music, monitorSource };
}
function reaches(node, target, seen = new Set()) {
  if (node === target) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.connections.some(edge => reaches(edge.target, target, seen));
}
function recordingGraph(engine) {
  const context = engine.context;
  const ancestors = node => ({
    kind: node.kind,
    params: Object.fromEntries(["gain", "threshold", "knee", "ratio", "attack", "release"].map(key => [key, node[key].value])),
    inputs: context.nodes.filter(input => input.connections.some(edge => edge.target === node)).map(ancestors)
  });
  return [engine.recordingDestination, ...engine.recorderAnalysers].map(ancestors);
}

const baseline = await build(false);
const { engine, music, monitorSource } = await build();
const context = engine.context;
const filters = context.nodes.filter(node => node.kind === "filter");
assert.equal(filters.length, 3);
assert.deepEqual(filters.map(node => [node.type, node.frequency.value, node.Q.value]), [
  ["highpass", 30, -3], ["notch", 50, 30], ["notch", 60, 30]
]);
for (const [index, node] of [engine.monitorBus, ...filters].entries()) {
  assert.deepEqual(node.connections.map(edge => edge.target), [filters[index] || context.destination], "Monitor cleanup is a serial, speaker-only chain");
  assert.equal(reaches(node, engine.recordingDestination), false);
  assert.equal(reaches(music, node), false, "Master music never passes through monitor DSP");
}
assert.equal(reaches(monitorSource, context.destination), true, "Monitor audio stays audible without a gate");
assert.equal(reaches(monitorSource, engine.recordingDestination), false);
assert.equal(reaches(music, engine.recordingDestination), true, "Approved music still reaches the recorder");
assert.equal(reaches(music, context.destination), true, "Master speaker output is unchanged");
assert.deepEqual(recordingGraph(engine), recordingGraph(baseline.engine), "Recorder and preflight analyser graphs/parameters match the pre-cleanup desk exactly");
assert.deepEqual(engine.limiter.connections.map(edge => edge.target.kind), ["speakers", "recorder", "splitter"]);
assert.equal(engine.recorderIsolation.assertGraph(), true);

// The existing isolation guard must reject every cleanup filter as a recorder input.
for (let index = 0; index < filters.length; index += 1) {
  for (const targetName of ["recordingDestination", "masterGain", "limiter"]) {
    const { engine: fresh } = await build();
    const filter = fresh.context.nodes.filter(node => node.kind === "filter")[index];
    assert.throws(() => filter.connect(fresh[targetName]), /unapproved source reaches the recorder/i);
    assert.equal(reaches(filter, fresh.recordingDestination), false, "Rejected monitor-to-recorder connections are never applied");
  }
}

console.log("Desk noise cleaner contracts passed: monitor-only DSP, unchanged master/recorder/preflight taps, and isolation enforcement.");
