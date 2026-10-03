import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [script, styles, creatorPage, signalPage, feedScript, feedStyles, home, pkg] = await Promise.all([
  read("halo-welcome.js"), read("halo-welcome.css"), read("creator-network/index.html"), read("signal-network/index.html"),
  read("signal-network/signal-feed.js"), read("signal-network/signal-network.css"), read("halo.html"), read("package.json")
]);
let passed = 0;
function check(name, test) { test(); passed++; console.log(`PASS: ${name}`); }

check("both creator surfaces mount the optional Welcome Studio", () => {
  for (const [page, surface] of [[creatorPage, "creator"], [signalPage, "signal"]]) {
    assert.match(page, /<link rel="stylesheet" href="\/halo-welcome.css">/);
    assert.match(page, /<script src="\/halo-welcome.js" defer><\/script>/);
    assert.match(page, new RegExp(`id="welcome" class="halo-welcome" data-halo-welcome="${surface}"`));
    assert.match(page, /halo-welcome__noscript/);
  }
  assert.match(home, /just-for-fun avatar, earn playful badges/);
  assert.match(JSON.parse(pkg).scripts["test:network"], /halo-welcome-contracts\.mjs/);
});

check("existing Creator Network and Signal workflows are preserved", () => {
  for (const id of ["publicDirectory", "orbits", "locked", "workspace", "guardianForm", "studioPlayer"]) assert.match(creatorPage, new RegExp(`id="${id}"`));
  for (const id of ["feed", "feedPublishForm", "feedKind", "feedRelease", "feedPublish", "command-center"]) assert.match(signalPage, new RegExp(`id="${id}"`));
  assert.match(signalPage, /name="body" maxlength="1000"/);
  assert.match(signalPage, /name="publishPublic" type="checkbox" required/);
});

check("Welcome Studio is local-only, safe DOM, and never touches access", () => {
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|FormData/, "Avatar, photo and video must never be uploaded");
  assert.doesNotMatch(script, /haloIdentity|\/api\//, "Gamification must not read or change membership or permissions");
  assert.match(script, /Nothing is uploaded or shared/);
  assert.match(script, /none of it changes access or permissions/);
  assert.match(script, /URL\.revokeObjectURL/);
  assert.match(script, /MAX_VIDEO_SECONDS = 60/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

check("Signal composer is a social composer without losing consent or limits", () => {
  for (const id of ["feedKindText", "feedKindAudio", "feedKindVideo", "feedKindBrief", "feedCharCount"]) assert.match(signalPage, new RegExp(`id="${id}"`));
  assert.match(signalPage, /class="signal-composer__avatar" data-halo-avatar/);
  assert.match(feedScript, /function updateCharCount/);
  assert.match(feedScript, /function relativeDate/);
  assert.match(feedScript, /signal-feed__avatar--/);
  assert.match(feedScript, /halo:signal-published/);
  assert.doesNotMatch(feedScript, /localStorage/);
  assert.match(feedStyles, /\.signal-composer__count\[data-level="limit"\]/);
});

/* ── Behavioural run against a minimal DOM ── */
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.handlers = {};
    this.dataset = {}; this.style = { setProperty() {} }; this.hidden = false; this.value = ""; this.textContent = "";
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach(n => classes.add(n)), remove: n => classes.delete(n), toggle: (n, on) => on ? classes.add(n) : classes.delete(n), contains: n => classes.has(n) };
  }
  set className(value) { value.split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name)); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "hidden") this.hidden = true; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  toggleAttribute(name, on) { if (on) this.attributes[name] = ""; else delete this.attributes[name]; }
  addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get firstChild() { return this.children[0]; }
  focus() {}
  querySelector() { return null; }
  *walk() { for (const child of this.children) if (child instanceof Element) { yield child; yield* child.walk(); } }
}
function runWelcome({ surface, stored }) {
  const root = new Element("section");
  root.dataset.haloWelcome = surface;
  const composerAvatar = new Element("div");
  composerAvatar.setAttribute("data-halo-avatar", "");
  const storage = new Map(stored ? [["halo.welcomeStudio.v1", JSON.stringify(stored)]] : []);
  const windowHandlers = {};
  const document = {
    querySelector: selector => selector === "[data-halo-welcome]" ? root : null,
    querySelectorAll: selector => selector === "[data-halo-avatar]"
      ? [...root.walk(), composerAvatar].filter(element => "data-halo-avatar" in element.attributes) : [],
    getElementById: () => null,
    createElement: tag => new Element(tag)
  };
  const window = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    addEventListener: (name, handler) => { (windowHandlers[name] ||= []).push(handler); },
    confirm: () => true
  };
  vm.runInNewContext(script, { window, document, URL, Image: class {}, setTimeout: () => 0, clearTimeout() {} });
  return {
    root, composerAvatar, saved: () => JSON.parse(storage.get("halo.welcomeStudio.v1")),
    emit: name => (windowHandlers[name] || []).forEach(handler => handler({}))
  };
}
const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

check("stored state is sanitised before it reaches the page", () => {
  const run = runWelcome({ surface: "creator", stored: {
    name: "x".repeat(90), aura: "url(javascript:alert(1))", ring: "<script>", photo: "javascript:alert(1)",
    vibes: ["Hook hunter", "<img onerror>", "Crate digger", "Live wire", "Studio rat"], badges: { "studio-spark": "2026-01-01", admin: "yes" },
    visits: { last: "not-a-date", streak: -4, best: "9" }
  }});
  const saved = run.saved();
  assert.equal(saved.name.length, 40); assert.equal(saved.aura, "gold"); assert.equal(saved.ring, "orbit"); assert.equal(saved.photo, "");
  assert.deepEqual(saved.vibes, ["Hook hunter", "Crate digger", "Live wire"]);
  assert.deepEqual(Object.keys(saved.badges), ["studio-spark"]);
  assert.equal(saved.visits.streak, 1); assert.equal(saved.visits.last, day(0));
  assert.ok(run.composerAvatar.classList.contains("halo-avatar"), "Avatar slots outside the panel are painted");
});

check("streaks, crossover and first-signal badges unlock locally", () => {
  const run = runWelcome({ surface: "signal", stored: { surfaces: { creator: true }, visits: { last: day(-1), streak: 2, best: 2 } } });
  let saved = run.saved();
  assert.equal(saved.visits.streak, 3); assert.equal(saved.visits.best, 3);
  for (const badge of ["tuned-in", "crossover", "three-day-glow"]) assert.ok(saved.badges[badge], `${badge} unlocked`);
  assert.equal(saved.badges["first-signal"], undefined);
  run.emit("halo:signal-published");
  saved = run.saved();
  assert.ok(saved.badges["first-signal"]);
  const gap = runWelcome({ surface: "creator", stored: { visits: { last: day(-3), streak: 5, best: 5 } } }).saved();
  assert.equal(gap.visits.streak, 1); assert.equal(gap.visits.best, 5);
  assert.equal(gap.badges["tuned-in"], undefined, "Creator surface does not award Signal badges");
});

console.log(`HALO Welcome Studio contracts: ${passed}/${passed} checks passed.`);
