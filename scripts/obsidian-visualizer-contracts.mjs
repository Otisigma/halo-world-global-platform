import assert from "node:assert/strict";
import { createLivingVisualizer } from "../obsidian/living-visualizer.js";

class Target {
  constructor() { this.events = {}; this.attributes = {}; this.style = { values: {}, setProperty: (key, value) => { this.style.values[key] = value; } }; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  fire(type) { for (const fn of this.events[type] || []) fn(); }
}
const button = new Target(), field = new Target(), status = new Target(), audio = new Target(), document = new Target(), motion = new Target(), window = new Target();
audio.paused = true;
audio.currentSrc = "https://halo.test/audio.mp3";
let stops = 0, closed = 0, disconnected = 0, frequency = 0, connected = null;
const track = { stop() { stops++; } };
audio.captureStream = () => ({ getAudioTracks: () => [track], getTracks: () => [track] });
class AudioContext {
  constructor() { this.state = "suspended"; this.sampleRate = 48000; }
  createMediaStreamSource() { return { connect(node) { connected = node; }, disconnect() { disconnected++; } }; }
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 512, getByteFrequencyData(data) { data.fill(frequency); }, disconnect() { disconnected++; } }; }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; closed++; }
}
let next = 0, callbacks = new Map();
window.AudioContext = AudioContext;
window.matchMedia = () => motion;
window.requestAnimationFrame = fn => { callbacks.set(++next, fn); return next; };
window.cancelAnimationFrame = id => callbacks.delete(id);
function frame(time) { const [id, fn] = callbacks.entries().next().value; callbacks.delete(id); fn(time); }
const instance = createLivingVisualizer({ audio, button, status, field, window, document });
button.fire("click");
assert.match(status.textContent, /Start a playable release first/);
audio.paused = false;
motion.matches = true;
button.fire("click");
assert.match(status.textContent, /reduced motion/);
motion.matches = false;
button.fire("click");
await new Promise(resolve => setImmediate(resolve));
assert.equal(button.attributes["aria-pressed"], "true");
assert.ok(connected && connected.getByteFrequencyData, "analysis is connected only to the analyser, never the output");
frame(100);
frame(3200);
assert.match(status.textContent, /silent or its source may restrict/);
frequency = 128;
frame(3300);
assert.equal(field.style.values["--bass"], "0.502");
assert.equal(field.style.values["--treble"], "0.502");
assert.match(status.textContent, /responding to audio frequencies/);
audio.paused = true;
audio.fire("pause");
assert.equal(callbacks.size, 0);
assert.equal(field.style.values["--bass"], "0");
audio.paused = false;
audio.fire("playing");
assert.equal(callbacks.size, 1);
document.hidden = true;
document.fire("visibilitychange");
assert.equal(callbacks.size, 0);
document.hidden = false;
document.fire("visibilitychange");
assert.equal(callbacks.size, 1);
instance.reset();
assert.equal(callbacks.size, 0);
assert.equal(stops, 1);
assert.equal(closed, 1);
assert.equal(disconnected, 2);
assert.equal(button.attributes["aria-pressed"], "false");
assert.match(status.textContent, /Release changed/);
delete audio.captureStream;
button.fire("click");
assert.match(status.textContent, /not supported/);
audio.captureStream = () => ({ getAudioTracks: () => [track], getTracks: () => [track] });
button.fire("click");
await new Promise(resolve => setImmediate(resolve));
motion.matches = true;
motion.fire("change");
assert.equal(button.attributes["aria-pressed"], "false");
assert.match(status.textContent, /reduced motion/);
assert.equal(stops, 2);
motion.matches = false;
button.fire("click");
await new Promise(resolve => setImmediate(resolve));
audio.fire("ended");
assert.equal(button.attributes["aria-pressed"], "false");
assert.equal(stops, 3);
let resumeResolve;
class DelayedContext extends AudioContext {
  resume() { return new Promise(resolve => { resumeResolve = () => { this.state = "running"; resolve(); }; }); }
}
window.AudioContext = DelayedContext;
button.fire("click");
instance.reset();
resumeResolve();
await new Promise(resolve => setImmediate(resolve));
assert.equal(button.attributes["aria-pressed"], "false", "late resume cannot restart a changed release");
assert.equal(callbacks.size, 0);
assert.equal(stops, 4);
window.AudioContext = AudioContext;
const originalError = console.error;
console.error = () => {};
try {
  audio.captureStream = () => { throw new Error("capture failed"); };
  button.fire("click");
  await new Promise(resolve => setImmediate(resolve));
  assert.match(status.textContent, /could not start/);
  assert.equal(button.attributes["aria-pressed"], "false");
} finally {
  console.error = originalError;
}
console.log("Obsidian visualizer contracts passed: real frequency data, unsupported/silent sources, motion, lifecycle and isolated playback.");
