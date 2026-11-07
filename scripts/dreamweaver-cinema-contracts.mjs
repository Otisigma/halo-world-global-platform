import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDreamweaverCinema, DEFAULT_CINEMA_LOOP } from "../lib/dreamweaver-cinema.js";

class Target {
  listeners = new Map();
  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
  }
  removeEventListener(event, handler) { this.listeners.get(event)?.delete(handler); }
  emit(event) { this.listeners.get(event)?.forEach(handler => handler()); }
}
function fixture() {
  const classes = new Set();
  const audio = Object.assign(new Target(), { paused: true, ended: false });
  const video = Object.assign(new Target(), {
    paused: true, hidden: false, src: "/approved.mp4", plays: 0, pauses: 0,
    getAttribute() { return this.src; },
    play() { this.plays++; this.paused = false; return Promise.resolve(); },
    pause() { this.pauses++; this.paused = true; }
  });
  const toggle = Object.assign(new Target(), { setAttribute(key, value) { this[key] = value; } });
  const status = {};
  const motion = Object.assign(new Target(), { matches: false });
  const document = Object.assign(new Target(), { hidden: false,
    documentElement: { classList: { contains: key => classes.has(key) } } });
  const container = { classList: { add: key => classes.add(key), remove: key => classes.delete(key) } };
  let mutation, disconnected = false;
  const window = { matchMedia: () => motion, MutationObserver: class {
    constructor(callback) { mutation = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } };
  const controller = createDreamweaverCinema({ audio, video, container, toggle, status, document, window });
  return { audio, video, toggle, status, motion, document, classes, controller,
    mutate: () => mutation(), disconnected: () => disconnected };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
assert.equal(DEFAULT_CINEMA_LOOP.url, "/music-home/loops/obsidian-gold-dust.mp4");
assert.equal(DEFAULT_CINEMA_LOOP.requiredStems, 0, "shared fallback never uses earned-only assets");
assert.equal(DEFAULT_CINEMA_LOOP.requiredSplits, 0);
const f = fixture();
assert.equal(f.video.plays, 0, "video never starts on arrival");
f.audio.paused = false; f.audio.emit("playing"); await tick();
assert.equal(f.video.plays, 1);
assert.equal(f.video.muted, true);
assert.equal(f.video.loop, true);
assert.equal(f.classes.has("is-cinema-playing"), true);
f.audio.paused = true; f.audio.emit("pause");
assert.equal(f.video.paused, true);
assert.equal(f.classes.has("is-cinema-playing"), false);
f.audio.paused = false; f.audio.emit("playing"); await tick();
f.toggle.emit("click");
assert.equal(f.video.paused, true);
assert.equal(f.toggle["aria-pressed"], "false");
f.toggle.emit("click"); await tick();
assert.equal(f.video.paused, false);
f.motion.matches = true; f.motion.emit("change");
assert.equal(f.video.paused, true);
f.motion.matches = false; f.motion.emit("change"); await tick();
f.classes.add("halo-safe-space-mode"); f.mutate();
assert.equal(f.video.paused, true);
f.classes.delete("halo-safe-space-mode"); f.mutate(); await tick();
f.document.hidden = true; f.document.emit("visibilitychange");
assert.equal(f.video.paused, true);
f.document.hidden = false; f.document.emit("visibilitychange"); await tick();
f.audio.emit("waiting");
assert.equal(f.classes.has("is-cinema-playing"), false);
f.audio.emit("playing"); await tick();
f.video.emit("error");
assert.equal(f.audio.paused, false, "video errors never stop audio");
assert.match(f.status.textContent, /artwork remain available/);
const attempts = f.video.plays;
f.audio.emit("playing"); await tick();
assert.equal(f.video.plays, attempts, "failed video never enters a retry loop");
f.video.emit("emptied"); f.video.emit("loadeddata"); await tick();
assert.equal(f.video.paused, false, "new video source resets failure");
f.audio.ended = true; f.audio.emit("ended");
assert.equal(f.video.paused, true);
f.controller.destroy();
assert.equal(f.disconnected(), true);
assert.equal([...f.audio.listeners.values()].every(set => set.size === 0), true);

const rejected = fixture();
rejected.video.play = () => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
rejected.audio.paused = false; rejected.audio.emit("playing"); await tick();
assert.equal(rejected.audio.paused, false);
assert.equal(rejected.classes.has("is-cinema-playing"), false);
rejected.controller.destroy();
const late = fixture();
let finish;
late.video.play = () => new Promise(resolve => { finish = resolve; });
late.audio.paused = false; late.audio.emit("playing");
late.audio.paused = true; late.audio.emit("pause");
finish(); await tick();
assert.equal(late.classes.has("is-cinema-playing"), false, "late play promise cannot restore paused visuals");
late.controller.destroy();
const missing = fixture();
missing.video.src = "";
missing.audio.paused = false; missing.audio.emit("playing");
assert.equal(missing.video.plays, 0);
missing.controller.destroy();
const page = await readFile(new URL("../dreamweaver/index.html", import.meta.url), "utf8");
assert.doesNotMatch(page.match(/<video id="heroReelVideo"[^>]+>/)[0], /\bautoplay\b/);
assert.match(page, /id="cinemaToggle"/);
console.log("Dreamweaver cinema contracts passed: audio-led video, motion controls, fallback, lifecycle and races.");
