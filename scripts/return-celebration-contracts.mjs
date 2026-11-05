import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../music/return-celebration.js", import.meta.url), "utf8");
const track = { id: "real-track", rank: 1, status: "published", title: "<b>Real title</b>", artist: "Artist" };
function harness({ values = new Map(), blocked = false, privacy = false, reduced = false } = {}) {
  const events = new Map();
  const document = {
    hidden: false, activeElement: null,
    documentElement: { classList: { contains: () => false } },
    addEventListener: (key, fn) => events.set(key, fn),
    removeEventListener: key => events.delete(key),
    createElement(tag) {
      return { tag, children: [], style: { setProperty() {} }, events: new Map(),
        append(...nodes) { this.children.push(...nodes); },
        setAttribute(key, value) { this[key] = value; },
        addEventListener(key, fn) { this.events.set(key, fn); },
        contains(node) { return this.children.includes(node); },
        remove() { document.body.children = document.body.children.filter(node => node !== this); }
      };
    }
  };
  document.body = document.createElement("body");
  const timers = new Map();
  const motion = { matches: reduced, addEventListener() {}, removeEventListener() {} };
  const window = {
    navigator: { globalPrivacyControl: privacy },
    matchMedia: () => motion,
    setTimeout(fn, delay) { timers.set(delay, fn); return delay; },
    clearTimeout: id => timers.delete(id),
    localStorage: {
      getItem: key => { if (blocked) throw Error("blocked"); return values.get(key); },
      setItem: (key, value) => { if (blocked) throw Error("blocked"); values.set(key, value); }
    }
  };
  vm.runInNewContext(source, { window, document, console: { warn() {} } });
  return { show: window.HaloReturnCelebration.show, document, values, timers, events };
}
for (const candidate of [undefined, {}, { ...track, rank: 2 }, { ...track, status: "draft" },
  { ...track, id: "../private" }, { ...track, artist: "" }]) {
  const h = harness(); h.show(candidate); assert.equal(h.document.body.children.length, 0);
}
const h = harness();
h.show(track);
assert.equal(h.document.body.children.length, 1);
const panel = h.document.body.children[0];
assert.equal(panel["aria-modal"], "false");
assert.equal(panel.children[3].textContent, track.title);
assert.equal(panel.children.at(-1).href, "/music/?song=real-track");
assert.equal(panel.children.some(node => /Claim Gift/.test(node.textContent)), false);
h.show(track); assert.equal(h.document.body.children.length, 1);
h.events.get("keydown")({ key: "Escape", preventDefault() {} });
assert.equal(h.document.body.children.length, 0);
assert.equal(h.timers.size, 0);
assert.equal(h.events.size, 0);
const returned = harness({ values: h.values }); returned.show(track);
assert.equal(returned.document.body.children.length, 0);
const next = harness({ values: h.values }); next.show({ ...track, id: "next-track" });
assert.equal(next.document.body.children.length, 1);
const newCycle = harness({ values: h.values }); newCycle.show(track);
assert.equal(newCycle.document.body.children.length, 1);
for (const config of [{ blocked: true }, { privacy: true }]) {
  const disabled = harness(config); disabled.show(track);
  assert.equal(disabled.document.body.children.length, 0);
}
const reduced = harness({ reduced: true }); reduced.show(track);
assert.equal(reduced.document.body.children[0].children[0].hidden, true);
const css = await readFile(new URL("../music/music.css", import.meta.url), "utf8");
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /halo-safe-space-mode \.return-celebration-burst/);
const client = await readFile(new URL("../music/featuredPlayer.js", import.meta.url), "utf8");
assert.match(client, /HaloReturnCelebration\?\.show\(state\.releases\[0\]\)/);
console.log("Return celebration contracts passed: real leader, deduplication, cycles, privacy, safe text, motion and dismissal.");
