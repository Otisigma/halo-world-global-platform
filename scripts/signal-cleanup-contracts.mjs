import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { inspectSignalFrame, SignalCleanupPipeline } from "../services/SignalCleanupPipeline.js";

function frame(sampleRate = 48000, fftSize = 32768) {
  return { samples: new Float32Array(fftSize), spectrum: new Float32Array(fftSize / 2).fill(-110), sampleRate };
}
for (const sampleRate of [44100, 48000, 96000]) {
  for (const fftSize of [8192, 32768]) {
    // The existing recorder tap has 8192 samples; at 96 kHz its resolution must fail closed.
    if (sampleRate / fftSize > 10) {
      assert.throws(() => inspectSignalFrame(frame(sampleRate, fftSize)), /resolution/);
      continue;
    }
    for (const frequency of [50, 60]) {
      for (const harmonic of [1, 2, 3, 4]) {
        const input = frame(sampleRate, fftSize);
        input.samples.fill(.0001);
        input.spectrum[Math.round(frequency * harmonic * fftSize / sampleRate)] = -65;
        const result = inspectSignalFrame(input);
        assert.equal(result.humDetected, true, `${frequency} Hz harmonic ${harmonic} detected at ${sampleRate} Hz`);
        assert.equal(result.humFrequency, frequency);
        assert.equal(result.humLevelDbfs, -65);
      }
    }
  }
}
const silence = frame();
silence.spectrum.fill(-Infinity);
assert.equal(inspectSignalFrame(silence).humDetected, false);
assert.equal(inspectSignalFrame(silence).noiseFloorDbfs, -120, "Silent metrics remain JSON-safe");
const music = frame();
music.samples.fill(.1);
music.spectrum[Math.round(60 * music.samples.length / music.sampleRate)] = -20;
assert.equal(inspectSignalFrame(music).humDetected, false, "Loud musical bass is not hum");
const hiss = frame();
hiss.spectrum.fill(-65);
assert.equal(inspectSignalFrame(hiss).humDetected, false, "Broadband hiss is not a mains spike");
assert.ok(Math.abs(inspectSignalFrame(hiss).noiseFloorDbfs + 65) < 1e-9);
for (const invalid of [NaN, Infinity, -Infinity]) {
  const input = frame();
  input.samples[1] = invalid;
  assert.throws(() => inspectSignalFrame(input), /Invalid/);
}
for (const invalid of [NaN, Infinity]) {
  const input = frame();
  input.spectrum[1] = invalid;
  assert.throws(() => inspectSignalFrame(input), /Invalid/);
}

class Node {
  constructor(context) {
    this.context = context;
    this.edges = [];
    for (const key of ["gain", "frequency", "Q"]) this[key] = {
      value: 1,
      setTargetAtTime(value) { this.value = value; },
      setValueAtTime(value) { this.value = value; },
      cancelScheduledValues() {}
    };
    this.fftSize = 8192;
    this.samplesValue = 0;
    this.tone = null;
    this.invalid = false;
  }
  get frequencyBinCount() { return this.fftSize / 2; }
  connect(node, ...ports) { this.edges.push({ node, ports }); return node; }
  disconnect(node) { this.edges = node ? this.edges.filter(edge => edge.node !== node) : []; }
  getFloatTimeDomainData(data) { data.fill(this.invalid ? NaN : this.samplesValue); }
  getFloatFrequencyData(data) {
    data.fill(-Infinity);
    if (this.tone) data[Math.round(this.tone * this.fftSize / this.context.sampleRate)] = -65;
  }
}
const sandbox = { globalThis: null, console, AudioNode: Node };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const path of ["../dj-recorder-guard.js", "../audio-routing-guard.js"]) {
  vm.runInContext(await readFile(new URL(path, import.meta.url), "utf8"), sandbox);
}
function setup() {
  const context = {
    sampleRate: 48000, currentTime: 0, state: "running", destination: {},
    createGain() { return new Node(this); },
    createBiquadFilter() { return new Node(this); },
    createWaveShaper() { return new Node(this); },
    createChannelSplitter() { return new Node(this); },
    createAnalyser() { return new Node(this); },
    createOscillator() { return new Node(this); },
    createBufferSource() { const node = new Node(this); node.buffer = null; return node; },
    createMediaStreamDestination() { const node = new Node(this); node.stream = {}; return node; }
  };
  const isolation = sandbox.HaloRecorderGuard.createIsolation(context);
  const master = context.createGain();
  const limiter = context.createGain();
  const destination = context.createMediaStreamDestination();
  isolation.setDestination(destination);
  limiter.connect(destination);
  const recorderAnalysers = [context.createAnalyser(), context.createAnalyser()];
  const splitter = context.createChannelSplitter(2);
  limiter.connect(splitter);
  recorderAnalysers.forEach((node, channel) => splitter.connect(node, channel));
  const routing = sandbox.HaloAudioRoutingGuard.create(context, { liveBus: master, protectedNodes: [destination, limiter], onViolation() {} });
  const pipeline = new SignalCleanupPipeline(context, { routingGuard: routing, assertIsolation: () => isolation.assertGraph(), recorderAnalysers });
  pipeline.connectSignalChain(master, limiter);
  return { context, isolation, master, limiter, destination, routing, pipeline, recorderAnalysers };
}
const graph = setup();
try {
  const { pipeline, context, recorderAnalysers, isolation, routing } = graph;
  assert.equal(pipeline.getStatus().clean, false, "No audit means not clean");
  assert.equal(pipeline.highPass.type, "highpass");
  assert.equal(pipeline.highPass.frequency.value, 35);
  assert.deepEqual(pipeline.notches.map(node => node.frequency.value), [50, 100, 150, 200, 60, 120, 180, 240]);
  assert.equal(graph.master.edges.find(edge => edge.node === pipeline.highPass)?.node, pipeline.highPass);
  assert.equal(pipeline.peakProtector.edges[0].node, graph.limiter, "Cleanup cannot bypass the existing limiter");
  assert.ok(pipeline.peakProtector.curve.every(value => Math.abs(value) <= Math.pow(10, -1 / 20) + 1e-7), "Sample-wise peak ceiling");
  assert.equal(pipeline.peakProtector.curve[32768], 0, "Peak protector does not introduce DC into silence");
  assert.equal(isolation.assertGraph(), true);
  assert.equal(routing.assertNoUtilityLeak().ok, true);
  assert.throws(() => pipeline.ingressAnalysers[0].connect(graph.limiter), /background/i, "Sentinel tap cannot reach recorder");
  context.currentTime += .1;
  assert.equal(pipeline.auditSignal().clean, true, "Valid stereo silence is clean");
  assert.ok(pipeline.expander.gain.value < .01, "Idle-channel noise is expanded downward");
  pipeline.prepareForMusic(context.currentTime + .2);
  assert.equal(pipeline.expander.gain.value, 1, "Scheduled music restores gain before the opening transient");
  context.currentTime += .1;
  pipeline.auditSignal();
  assert.equal(pipeline.expander.gain.value, 1, "A silent audit before scheduled playback cannot re-close the gate");
  context.currentTime += .5;
  pipeline.ingressAnalysers[1].tone = 60;
  pipeline.ingressAnalysers[1].samplesValue = .0001;
  context.currentTime += .1;
  assert.equal(pipeline.auditSignal().clean, true, "Ingress hum may be cleaned; egress decides cleanliness");
  assert.equal(pipeline.notches[4].Q.value, 20, "Detected 60 Hz notch is activated");
  assert.equal(pipeline.notches[0].Q.value, 1000, "Undetected 50 Hz notch stays narrow");
  recorderAnalysers[1].tone = 60;
  recorderAnalysers[1].samplesValue = .0001;
  context.currentTime += .1;
  assert.equal(pipeline.auditSignal().humFrequency, 60, "Egress audits the right channel independently");
  assert.equal(pipeline.getStatus().clean, false);
  recorderAnalysers[1].tone = null;
  recorderAnalysers[1].samplesValue = 1;
  context.currentTime += .1;
  assert.equal(pipeline.auditSignal().clean, false, "Clipped output fails audit");
  recorderAnalysers[1].samplesValue = 0;
  pipeline.ingressAnalysers[0].samplesValue = .1;
  context.currentTime += .1;
  pipeline.auditSignal();
  assert.equal(pipeline.expander.gain.value, 1, "Music restores full gain");
  assert.equal(pipeline.auditSignal().reliable, false, "Stalled clock fails closed");
  assert.equal(pipeline.expander.gain.value, 1, "Analysis faults do not mute live playback");
  context.currentTime += .1;
  recorderAnalysers[0].invalid = true;
  assert.equal(pipeline.auditSignal().reliable, false, "Invalid recorder samples fail closed");
  recorderAnalysers[0].invalid = false;
  context.currentTime += .1;
  pipeline.auditSignal();
  pipeline.status = { ...pipeline.status, auditedAt: Date.now() - 1000 };
  const gainBeforeStatus = pipeline.expander.gain.value;
  assert.equal(pipeline.getStatus().reliable, false, "Stale telemetry cannot clear the guard");
  assert.equal(pipeline.expander.gain.value, gainBeforeStatus, "Reading stale status does not change audio gain");
  context.state = "suspended";
  assert.equal(pipeline.getStatus().clean, false, "Suspended context is not clean");
  context.state = "running";
  const cue = context.createOscillator();
  assert.throws(() => cue.connect(pipeline.highPass), /unapproved/, "CUE sources cannot enter cleanup or recorder");
  context.currentTime += .1;
  assert.equal(pipeline.auditSignal().isolationSecure, false, "Routing violations invalidate audit");
} finally {
  graph.pipeline.destroy();
}
assert.equal(graph.pipeline.getStatus().clean, false, "Destroyed pipeline is not clean");
assert.equal(graph.master.edges.length, 0, "Destroy removes only owned master edges");

const page = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");
assert.match(page, /type="module" src="\/services\/SignalCleanupPipeline\.js"/);
assert.match(page, /signalCleanup\.connectSignalChain\(masterGain, limiter\)/);
const fallback = page.slice(page.indexOf("// Playback may continue without cleanup"), page.indexOf("audioEngine.halo = window.HaloAudioEngine"));
assert.match(fallback, /limiter\.disconnect\(audioEngine\.recordingDestination\);[\s\S]*masterGain\.connect\(limiter\)/, "Unclean live-only fallback disconnects capture before bypassing cleanup");
const liveOnly = setup();
liveOnly.pipeline.destroy();
const fallbackBody = fallback.slice(0, fallback.lastIndexOf("}"));
vm.runInNewContext(fallbackBody, {
  audioEngine: { recordingDestination: liveOnly.destination },
  limiter: liveOnly.limiter,
  masterGain: liveOnly.master
});
assert.ok(liveOnly.master.edges.some(edge => edge.node === liveOnly.limiter), "Unavailable cleanup preserves live playback");
assert.ok(!liveOnly.limiter.edges.some(edge => edge.node === liveOnly.destination), "Unavailable cleanup physically disconnects capture");
assert.equal(liveOnly.isolation.assertGraph(), true, "Live-only fallback keeps isolation guards intact");
assert.equal(page.split("masterGain.connect(limiter)").length - 1, 1, "Only the recorder-disconnected fallback bypasses cleanup");
assert.match(page, /allowMusicSource\(source\);[\s\S]*?signalCleanup\?\.prepareForMusic\(startAt\);[\s\S]*?source\.start\(startAt/, "Music attack is prepared before the approved source starts");
assert.match(page, /signalAudit: audioEngine\.signalCleanup\?\.getStatus\(\)/);
assert.match(page, /assertSignalClean: \(\) =>/);
assert.match(page, /cleanup: recordingState\.signalCleanupAudit/);
assert.match(page, /clean: previous\?\.clean === true && audit\?\.clean === true/, "Council cannot forget an earlier failed audit");
console.log("Signal cleanup contracts: hum bins, DSP chain, stereo audits, fail-closed status, isolation, and downstream wiring passed.");
