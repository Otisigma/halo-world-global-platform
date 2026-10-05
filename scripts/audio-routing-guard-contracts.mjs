import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [guardSource, engineSource, deckPage] = await Promise.all([
  readFile(new URL("../audio-routing-guard.js", import.meta.url), "utf8"),
  readFile(new URL("../services/haloAudioEngine.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);

class MockParam {
  constructor(value = 1) { this.value = value; }
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}
class MockNode {
  constructor(context, label = "node") { this.context = context; this.label = label; this.connections = []; }
  connect(target) {
    if (target && target.context && target.context !== this.context) throw new Error("InvalidAccessError: cross-context connection");
    this.connections.push(target);
    return target;
  }
  disconnect(target) { this.connections = target ? this.connections.filter(node => node !== target) : []; }
}
class MockGain extends MockNode { constructor(context, label = "gain") { super(context, label); this.gain = new MockParam(1); } }
class MockSource extends MockNode {
  start(when, offset) { this.started = [when, offset]; }
  stop(when) { this.stopped = when; }
  addEventListener() {}
}
class MockContext {
  constructor() { this.currentTime = 1; this.destination = new MockNode(this, "destination"); }
  createGain() { return new MockGain(this); }
  createAnalyser() { return new MockNode(this, "analyser"); }
  createBiquadFilter() { return new MockNode(this, "filter"); }
  createMediaStreamSource() { return new MockNode(this, "mic"); }
  createMediaStreamDestination() { return new MockNode(this, "recorder"); }
  createDynamicsCompressor() { return new MockNode(this, "limiter"); }
  createBufferSource() { return new MockSource(this, "buffer-source"); }
}
class MockOfflineContext extends MockContext {
  constructor(numberOfChannels, length, sampleRate) {
    super();
    this.args = [numberOfChannels, length, sampleRate];
  }
  async startRendering() { return { rendered: true, args: this.args }; }
}

function loadSandbox(extra = {}) {
  const warnings = [];
  const sandbox = {
    console: { ...console, warn: message => warnings.push(message) },
    setTimeout: () => 1,
    clearTimeout: () => {},
    globalThis: null,
    AudioContext: MockContext,
    ...extra
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(guardSource, sandbox);
  vm.runInContext(engineSource, sandbox);
  return { sandbox, warnings };
}

// Walks the real (mock) connection graph, ignoring guard bookkeeping.
function reaches(node, target, seen = new Set()) {
  if (node === target) return true;
  if (!node || seen.has(node) || !Array.isArray(node.connections)) return false;
  seen.add(node);
  return node.connections.some(next => reaches(next, target, seen));
}

function buildLiveGraph(context) {
  const masterGain = new MockGain(context, "master");
  const limiter = context.createDynamicsCompressor();
  const recorder = context.createMediaStreamDestination();
  const deckGain = new MockGain(context, "deck");
  masterGain.connect(limiter);
  limiter.connect(context.destination);
  limiter.connect(recorder);
  deckGain.connect(masterGain);
  return { masterGain, limiter, recorder, deckGain };
}

const { sandbox, warnings } = loadSandbox({ OfflineAudioContext: MockOfflineContext });
const { HaloAudioRoutingGuard, HaloAudioEngine } = sandbox;
const { AudioRoutingLeakError } = HaloAudioRoutingGuard;
assert.equal(typeof HaloAudioRoutingGuard.create, "function", "Guard exposes a factory");
assert.ok(Object.isFrozen(HaloAudioRoutingGuard), "Guard API cannot be swapped at runtime");

const context = new MockContext();
const live = buildLiveGraph(context);
const guard = HaloAudioRoutingGuard.create(context, { liveBus: live.masterGain, protectedNodes: [live.limiter, live.recorder, live.deckGain] });
const outputs = [context.destination, live.masterGain, live.limiter, live.recorder, live.deckGain];
const isLeakError = error => error instanceof AudioRoutingLeakError && error.name === "AudioRoutingLeakError";

// The utility bus is muted and terminal.
assert.equal(guard.liveBus, live.masterGain, "The deck master gain is adopted as the live bus");
assert.equal(guard.utilityBus.gain.value, 0, "Utility bus is muted");
assert.equal(guard.utilityBus.connections.length, 0, "Utility bus has no outputs");
for (const target of outputs) {
  assert.throws(() => guard.utilityBus.connect(target), isLeakError, "Utility bus can never be patched to an output");
}
assert.equal(guard.utilityBus.connections.length, 0);

// Utility processing nodes stay on the utility bus.
const stemAnalyser = context.createAnalyser();
guard.connectUtility(stemAnalyser);
assert.ok(stemAnalyser.connections.includes(guard.utilityBus), "Background analysis feeds the utility bus");
assert.equal(guard.isUtility(stemAnalyser), true);
for (const target of [...outputs, live.masterGain.gain, new MockGain(context, "untagged")]) {
  assert.throws(() => stemAnalyser.connect(target), isLeakError, "Utility nodes cannot connect to live nodes, AudioParams, or unguarded nodes");
}
for (const target of outputs) assert.equal(reaches(stemAnalyser, target), false, "Utility audio never reaches the master mix or recorder");

const kitBuilder = new MockGain(context, "transition-kit");
guard.connectUtility(kitBuilder, stemAnalyser);
assert.ok(kitBuilder.connections.includes(stemAnalyser), "Utility nodes may chain into other utility nodes");
assert.throws(() => guard.connectUtility(new MockGain(context), live.masterGain), isLeakError, "connectUtility refuses a live target");
assert.throws(() => guard.connectUtility(live.masterGain), isLeakError, "The live bus cannot be demoted to background processing");
assert.throws(() => guard.connectUtility(live.recorder), isLeakError, "The recorder cannot join background processing");

// Live playback still routes normally.
const deckEnvelope = new MockGain(context, "envelope");
guard.connectLive(deckEnvelope, live.deckGain);
assert.ok(deckEnvelope.connections.includes(live.deckGain));
assert.equal(reaches(deckEnvelope, context.destination), true, "Live playback reaches the speakers");
assert.equal(reaches(deckEnvelope, live.recorder), true, "Live playback reaches the recorder");
const fillerGain = new MockGain(context, "filler");
guard.connectLive(fillerGain);
assert.ok(fillerGain.connections.includes(live.masterGain), "connectLive defaults to the live bus");
assert.throws(() => guard.connectLive(stemAnalyser), isLeakError, "Utility nodes cannot join the live mix");
assert.throws(() => guard.connectLive(new MockGain(context), guard.utilityBus), isLeakError, "Live audio is not silently dropped on the utility bus");
assert.throws(() => guard.connectUtility(deckEnvelope), isLeakError, "Live nodes cannot be re-tagged as utility");

// Read-only taps let live audio feed meters without a return path.
const meter = context.createAnalyser();
guard.tap(live.masterGain, meter);
assert.ok(live.masterGain.connections.includes(meter), "Master feeds the meter");
assert.deepEqual(meter.connections, [guard.utilityBus], "Meter only outputs to the utility bus");
assert.throws(() => meter.connect(live.masterGain), isLeakError, "Meters cannot feed back into the master");

// Runtime assertions.
assert.equal(guard.assertNoUtilityLeak().ok, true, "A clean graph passes the routing assertion");
guard.utilityBus.gain.value = 0.5;
assert.throws(() => guard.assertNoUtilityLeak(), isLeakError, "An unmuted utility bus is detected");
assert.equal(guard.utilityBus.gain.value, 0, "The utility bus is re-muted after detection");
const bypassed = new MockGain(context, "bypassed");
guard.connectUtility(bypassed);
bypassed.connect = MockNode.prototype.connect;
assert.throws(() => guard.assertNoUtilityLeak(), error => isLeakError(error) && error.details.leaks.some(leak => leak.type === "guard-bypassed"), "Removing the guard from a utility node is detected");
guard.release(bypassed);
assert.equal(guard.isUtility(bypassed), false, "Released nodes leave the utility set");
assert.equal(guard.assertNoUtilityLeak().ok, true);

// Exhaustive leak sweep: no utility node can reach any protected output.
const utilityPool = [guard.utilityBus, stemAnalyser, kitBuilder, meter];
const targetPool = [...outputs, deckEnvelope, fillerGain, live.masterGain.gain, new MockGain(context), ...utilityPool];
for (const node of utilityPool) {
  for (const target of targetPool) {
    try { node.connect(target); } catch (error) { assert.ok(isLeakError(error)); }
  }
}
for (const node of utilityPool) {
  for (const target of outputs) assert.equal(reaches(node, target), false, "Utility audio can never reach the master mix or recording path");
}
assert.equal(guard.utilityBus.connections.length, 0, "Utility bus stays terminal");
assert.equal(guard.assertNoUtilityLeak().ok, true);

// Production (non-strict) mode blocks and reports instead of throwing.
const reported = [];
const prodContext = new MockContext();
const prodLive = buildLiveGraph(prodContext);
const prodGuard = HaloAudioRoutingGuard.create(prodContext, { liveBus: prodLive.masterGain, protectedNodes: [prodLive.recorder], strict: false, onViolation: violation => reported.push(violation) });
const prodAnalyser = prodContext.createAnalyser();
prodGuard.connectUtility(prodAnalyser);
assert.doesNotThrow(() => prodAnalyser.connect(prodLive.recorder));
assert.equal(reaches(prodAnalyser, prodLive.recorder), false, "Blocked connections are never made");
assert.equal(reported.at(-1).type, "utility-leak");
assert.equal(reported.at(-1).target, "master/recording path");
prodGuard.utilityBus.gain.value = 1;
const prodReport = prodGuard.assertNoUtilityLeak();
assert.equal(prodReport.ok, false, "Non-strict assertions return a failing report");
assert.equal(prodGuard.utilityBus.gain.value, 0);

// A guard without an explicit live bus creates one on the speaker output.
const ownContext = new MockContext();
const ownGuard = HaloAudioRoutingGuard.create(ownContext);
assert.ok(ownGuard.liveBus.connections.includes(ownContext.destination));
assert.ok(warnings.some(message => /Blocked background audio/.test(message)), "Violations are logged for developers");

// Offline rendering for background jobs.
const offline = HaloAudioRoutingGuard.createOfflineProcessingContext({ numberOfChannels: 2, length: 4410, sampleRate: 44100 });
assert.ok(offline instanceof MockOfflineContext);
assert.deepEqual(offline.args, [2, 4410, 44100]);
assert.throws(() => HaloAudioRoutingGuard.createOfflineProcessingContext({ length: 0 }), { name: "RangeError" });
const sourceBuffer = { numberOfChannels: 2, length: 88200, sampleRate: 48000 };
let offlineChain;
const rendered = await HaloAudioRoutingGuard.renderOffline(sourceBuffer, (ctx, source) => {
  const stemFilter = ctx.createBiquadFilter();
  offlineChain = { ctx, source, stemFilter };
  source.connect(stemFilter);
  return stemFilter;
});
assert.equal(rendered.rendered, true, "Offline jobs render in memory");
assert.deepEqual(rendered.args, [2, 88200, 48000], "Offline render matches the source buffer");
assert.ok(offlineChain.stemFilter.connections.includes(offlineChain.ctx.destination), "Offline chain ends on the offline destination");
assert.notEqual(offlineChain.ctx, context, "Offline jobs never share the live context");
assert.deepEqual(offlineChain.source.started, [0, undefined]);
await assert.rejects(HaloAudioRoutingGuard.renderOffline(sourceBuffer, () => live.masterGain), isLeakError, "Offline jobs cannot hand back a live-context node");
await assert.rejects(HaloAudioRoutingGuard.renderOffline(null), { name: "TypeError" });
const { sandbox: noOffline } = loadSandbox();
assert.throws(() => noOffline.HaloAudioRoutingGuard.createOfflineProcessingContext({ length: 10 }), /does not support offline audio processing/);

// Engine integration: room analysis stays on the utility bus unless monitoring is requested.
const engineContext = new MockContext();
const engineLive = buildLiveGraph(engineContext);
const engineGuard = HaloAudioRoutingGuard.create(engineContext, { liveBus: engineLive.masterGain, protectedNodes: [engineLive.limiter, engineLive.recorder] });
const engine = new HaloAudioEngine({ context: engineContext, masterGain: engineLive.masterGain, routingGuard: engineGuard });
engine.attachLiveIntelligenceInput({});
assert.equal(engineGuard.isUtility(engine.analyzerNode), true, "Room analyser is a utility node");
assert.equal(engineGuard.isUtility(engine.micGainNode), true, "Analysis-only mic gain is a utility node");
for (const target of [engineContext.destination, engineLive.masterGain, engineLive.recorder]) {
  assert.equal(reaches(engine.micStreamNode, target), false, "Room input never reaches the master or recorder");
}
assert.throws(() => engine.micGainNode.connect(engineLive.masterGain), isLeakError);
const analysisNodes = [engine.micGainNode, engine.analyzerNode];
engine.detachLiveIntelligenceInput();
assert.ok(analysisNodes.every(node => !engineGuard.isUtility(node)), "Detaching releases room-analysis nodes from the guard");
engine.attachLiveIntelligenceInput({}, { monitor: true });
assert.equal(reaches(engine.micStreamNode, engineLive.masterGain), true, "Explicit monitoring is a live route");
assert.deepEqual(engine.analyzerNode.connections, [engineGuard.utilityBus], "Monitored room analyser still outputs only to the utility bus");
const deckSource = new MockSource(engineContext);
const started = await engine.loadAndPlayTrack("A", deckSource);
assert.ok(started.envelope.connections.includes(engine.deckAGain), "Approved deck playback stays on the live path");
assert.equal(engineGuard.isLive(started.envelope), true);
assert.equal(engineGuard.assertNoUtilityLeak().ok, true);

// DJ deck wiring.
assert.match(deckPage, /<script src="\/audio-routing-guard\.js"><\/script>\n\s+<script src="\/services\/haloAudioEngine\.js"><\/script>/, "Guard loads before the audio engine");
assert.match(deckPage, /HaloAudioRoutingGuard\.create\(context, \{\s+liveBus: masterGain,\s+protectedNodes: \[limiter, audioEngine\.recordingDestination/, "Master, limiter and recorder are protected");
assert.match(deckPage, /routingGuard: audioEngine\.routing \}\)/, "Engine receives the guard");
assert.match(deckPage, /audioEngine\.routing\.tap\(audioEngine\.masterGain, continuityState\.analyser\)/, "Continuity meter is a read-only tap");
assert.match(deckPage, /continuityState\.fillerGain\.connect\(audioEngine\.monitorBus\)/, "Continuity filler is monitor-only");
assert.match(deckPage, /try \{ routingIsolated = Boolean\(audioEngine\.routing\?\.assertNoUtilityLeak\(\)\.ok && audioEngine\.recorderIsolation\?\.assertGraph\(\)\); \} catch \{ routingIsolated = false; \}\n\s+if \(!routingIsolated\) throw new Error\("Background audio routing failed the isolation check/, "Recording fails closed when either isolation guard is absent or fails");

console.log("Audio routing guard contracts: utility bus isolation, live routing, offline rendering, runtime assertions, and deck wiring behave as expected.");
