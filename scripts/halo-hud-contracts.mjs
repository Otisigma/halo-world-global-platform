import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [engine, styles, shopClient, featuredClient, musicPage, uploadPage, catalogPage] = await Promise.all([
  read("halo-hud.js"),
  read("halo-hud.css"),
  read("music/music.js"),
  read("music/featuredPlayer.js"),
  read("music/index.html"),
  read("music-upload/index.html"),
  read("song-catalog/index.html")
]);

// --- Static wiring ---------------------------------------------------------------
for (const [name, page] of [["music", musicPage], ["music-upload", uploadPage], ["song-catalog", catalogPage]]) {
  assert.ok(page.includes('<link rel="stylesheet" href="/halo-hud.css">'), `${name} loads HUD styles`);
  assert.ok(page.includes('<script src="/halo-hud.js" defer></script>'), `${name} loads the HUD engine`);
  assert.match(page, /data-halo-guide="/, `${name} declares at least one proactive guide`);
}
assert.match(shopClient, /guideAction: "copy-isrc", isrc: release\.isrc/, "shop ISRC facts offer copy-isrc");
assert.match(shopClient, /data-halo-guide-action="quick-listen"/, "chart and cards offer quick-listen");
assert.match(shopClient, /class="chart-entry[^`]*data-halo-guide-scope/, "chart entries scope quick-listen to their play button");
assert.match(shopClient, /class="shop-licensing"[^>]*data-halo-guide=/, "licensing tiers carry guidance");
assert.match(featuredClient, /data-featured-vote="[^"]*"[^>]*data-halo-guide=/, "vote button carries guidance");
assert.ok(!/onclick\s*=/i.test(engine), "HUD never uses inline onclick strings");
assert.ok(!/stopPropagation|stopImmediatePropagation/.test(engine), "HUD never swallows page clicks");
assert.ok(!/\.innerHTML\s*=/.test(engine), "HUD builds DOM nodes instead of injecting HTML");
assert.match(styles, /\.halo-hud-card\s*\{[^}]*z-index:\s*10005;/, "HUD stacks above the player bar but below nav/accessibility dialogs");
assert.match(styles, /\.halo-hud-card\s*\{[^}]*pointer-events:\s*none;/, "hidden HUD never blocks interaction");
assert.match(styles, /backdrop-filter:\s*blur/, "HUD uses the glassmorphic treatment");
assert.match(styles, /#f2ff62/i, "HUD uses the HALO gold/acid accent");
assert.match(styles, /94, 234, 255|#5eeaff/i, "HUD uses the cyan accent line");

// --- Minimal DOM for behavioural checks -----------------------------------------
class ClassList {
  constructor(node) { this.node = node; }
  get values() { return new Set(String(this.node.className || "").split(/\s+/).filter(Boolean)); }
  write(set) { this.node.className = [...set].join(" "); }
  add(...names) { const set = this.values; names.forEach(name => set.add(name)); this.write(set); }
  remove(...names) { const set = this.values; names.forEach(name => set.delete(name)); this.write(set); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    on ? this.add(name) : this.remove(name);
    return on;
  }
}

function matchesSimple(node, selector) {
  selector = selector.trim();
  const attrMatch = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) return node.hasAttribute(attrMatch[1]) && (attrMatch[2] === undefined || node.getAttribute(attrMatch[1]) === attrMatch[2]);
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

class Node {
  constructor(document, tagName) {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.style = {};
    this.className = "";
    this.classList = new ClassList(this);
    this._text = "";
    this.disabled = false;
  }
  get id() { return this.getAttribute("id") || ""; }
  set id(value) { this.setAttribute("id", value); }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(value) { value ? this.setAttribute("hidden", "") : this.removeAttribute("hidden"); }
  get textContent() { return this._text + this.childNodes.map(child => child.textContent).join(""); }
  set textContent(value) { this.childNodes.forEach(child => { child.parentNode = null; }); this.childNodes = []; this._text = String(value); }
  get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node === this.ownerDocument.documentElement; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { children.forEach(child => { child.parentNode?.removeChild(child); child.parentNode = this; this.childNodes.push(child); }); this.ownerDocument.mutated(); }
  removeChild(child) { this.childNodes = this.childNodes.filter(item => item !== child); child.parentNode = null; this.ownerDocument.mutated(); }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...children) { this.childNodes.forEach(child => { child.parentNode = null; }); this.childNodes = []; this._text = ""; this.append(...children); }
  contains(node) { while (node) { if (node === this) return true; node = node.parentNode; } return false; }
  matches(selector) { return selector.split(",").some(part => matchesSimple(this, part)); }
  closest(selector) { let node = this; while (node && node.tagName) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const out = []; const walk = node => node.childNodes.forEach(child => { if (child.matches(selector)) out.push(child); walk(child); }); walk(this); return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatchEvent(event) {
    event.target ||= this;
    event.defaultPrevented ||= false;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    let node = this;
    while (node) { (node.listeners[event.type] || []).forEach(handler => handler(event)); node = node.parentNode; }
    (this.ownerDocument.listeners[event.type] || []).forEach(handler => handler(event));
    return !event.defaultPrevented;
  }
  click() { this.dispatchEvent({ type: "click" }); }
  focus() { const previous = this.ownerDocument.activeElement; this.ownerDocument.activeElement = this; if (previous !== this) this.dispatchEvent({ type: "focusin" }); }
  getBoundingClientRect() { return { top: 100, bottom: 140, left: 40, right: 240, width: 200, height: 40 }; }
}

function createDocument() {
  const timers = new Map();
  let timerId = 0;
  const document = {
    listeners: {},
    observers: [],
    mutated() { document.observers.forEach(callback => callback([])); },
    createElement: tag => new Node(document, tag),
    addEventListener(type, handler) { (document.listeners[type] ||= []).push(handler); },
    execCommand: () => false
  };
  document.documentElement = new Node(document, "html");
  document.body = new Node(document, "body");
  document.documentElement.append(document.body);
  document.activeElement = document.body;
  const clipboard = [];
  const played = [];
  const window = {
    document,
    innerWidth: 1280,
    innerHeight: 800,
    location: { pathname: "/music/" },
    listeners: {},
    addEventListener(type, handler) { (window.listeners[type] ||= []).push(handler); },
    setTimeout(fn, ms) { timerId += 1; timers.set(timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    HaloPlayer: { play: track => played.push(track) }
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { document.observers.push(this.callback); }
  }
  const context = {
    window,
    document,
    navigator: { clipboard: { writeText: async text => { clipboard.push(text); } } },
    MutationObserver,
    console
  };
  vm.createContext(context);
  vm.runInContext(engine, context);
  const flush = () => { const pending = [...timers.entries()]; timers.clear(); pending.forEach(([, { fn }]) => fn()); };
  return { document, window, clipboard, played, timers, flush, hud: window.HaloHud };
}

function guide(document, attrs, parent = document.body, tag = "span") {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  parent.append(node);
  return node;
}

const hover = (target, related = null) => target.dispatchEvent({ type: "mouseover", relatedTarget: related });
const key = (document, keyName, target = document.activeElement) => {
  const event = { type: "keydown", key: keyName };
  target.dispatchEvent(event);
  return event;
};

// 1. Activation via data-halo-guide after hesitation
{
  const { document, flush, timers, hud } = createDocument();
  assert.equal(typeof hud?.show, "function", "engine exposes window.HaloHud");
  const target = guide(document, { "data-halo-guide": "Commercial licensing is approval-gated." });
  hover(target);
  assert.equal(timers.size, 1, "hover starts a hesitation timer");
  assert.equal([...timers.values()][0].ms, hud.hesitationDelay, "uses the configured hesitation delay");
  assert.equal(hud.isOpen(), false, "HUD waits for hesitation before appearing");
  flush();
  assert.equal(hud.isOpen(), true, "HUD appears after hesitation");
  assert.equal(hud.mode, "guide");
  const card = document.body.querySelector("#haloHud");
  assert.ok(card?.classList.contains("is-visible"), "HUD card is visible");
  assert.equal(card.getAttribute("aria-hidden"), "false");
  assert.equal(document.body.querySelector("#haloHudText").textContent, "Commercial licensing is approval-gated.");
  assert.match(target.getAttribute("aria-describedby"), /haloHudText/, "target is described by the HUD for assistive tech");
  assert.equal(card.style.top, "150px", "HUD is positioned just below the target");

  // Moving away before the delay cancels the guide.
  const other = guide(document, { "data-halo-guide": "Other" });
  hud.hide();
  hover(other);
  other.dispatchEvent({ type: "mouseout", relatedTarget: document.body });
  assert.equal(timers.size, 0, "leaving the element cancels hesitation");
  // Clicking a guided element is action, not hesitation.
  hover(other);
  other.click();
  assert.equal(timers.size, 0, "clicking the guided element cancels the pending guide");

  // Keyboard focus hesitation also triggers guidance.
  other.focus();
  flush();
  assert.equal(hud.target, other, "focus hesitation opens the guide for keyboard users");
}

// 2. Inline actions for guide-action variants
{
  const { document, flush, clipboard, played, hud } = createDocument();
  const isrc = guide(document, { "data-halo-guide": "Copy the ISRC.", "data-halo-guide-action": "copy-isrc", "data-isrc": "uk-aaa-26-00001" });
  hover(isrc);
  flush();
  const copy = document.body.querySelector("#haloHud").querySelector(".halo-hud-btn");
  assert.ok(copy, "copy-isrc renders an inline button");
  assert.match(copy.textContent, /Copy ISRC UK-AAA-26-00001/);
  copy.click();
  await new Promise(resolveTick => setImmediate(resolveTick));
  assert.deepEqual(clipboard, ["UK-AAA-26-00001"], "copy-isrc writes the normalized ISRC to the clipboard");
  assert.match(document.body.querySelector(".halo-hud-status").textContent, /copied/);
  assert.equal(hud.isOpen(), true, "clicking inside the HUD keeps it open");

  const pending = guide(document, { "data-halo-guide": "No ISRC yet.", "data-halo-guide-action": "copy-isrc" });
  hud.show(pending);
  assert.equal(document.body.querySelector("#haloHud").querySelector(".halo-hud-btn"), null, "missing ISRC renders no copy button");
  assert.match(document.body.querySelector(".halo-hud-note").textContent, /pending/i);

  const scope = guide(document, { "data-halo-guide-scope": "" }, document.body, "div");
  const row = guide(document, { "data-halo-guide": "Quick listen.", "data-halo-guide-action": "quick-listen" }, scope, "button");
  const playButton = guide(document, { "data-action": "play-track", "data-title": "Emotional Healing", "data-audio-url": "/a.mp3" }, scope, "button");
  let playClicks = 0;
  playButton.addEventListener("click", () => { playClicks += 1; });
  hover(row);
  flush();
  const listen = document.body.querySelector("#haloHud").querySelector(".halo-hud-btn");
  assert.match(listen.textContent, /Quick listen · Emotional Healing/, "quick-listen renders a preview button");
  listen.click();
  assert.equal(playClicks, 1, "quick-listen reuses the page's play-track button (shared HaloPlayer path)");
  assert.equal(played.length, 0, "quick-listen never drives the player singleton directly");

  const silent = guide(document, { "data-halo-guide": "No preview.", "data-halo-guide-action": "quick-listen" });
  hud.show(silent);
  assert.equal(document.body.querySelector("#haloHud").querySelector(".halo-hud-btn"), null, "quick-listen without audio renders no button");
}

// 3. "?" shortcut behaviour
{
  const { document, hud } = createDocument();
  const event = key(document, "?", document.body);
  assert.equal(event.defaultPrevented, true, "? is handled");
  assert.equal(hud.mode, "palette", "? opens the global quick guide");
  const card = document.body.querySelector("#haloHud");
  assert.ok(card.classList.contains("is-palette"));
  assert.ok(card.querySelectorAll(".halo-hud-list-item").length >= 4, "quick guide lists site shortcuts");
  assert.equal(document.activeElement, card.querySelector(".halo-hud-close"), "focus moves into the quick guide");
  key(document, "?");
  assert.equal(hud.isOpen(), false, "? toggles the quick guide closed");

  const input = guide(document, {}, document.body, "input");
  input.focus();
  const typed = key(document, "?", input);
  assert.equal(typed.defaultPrevented, false, "? is left alone while typing");
  assert.equal(hud.isOpen(), false);

  const focused = guide(document, { "data-halo-guide": "Focused guide.", "data-halo-guide-action": "copy-isrc", "data-isrc": "USAAA2600001" }, document.body, "button");
  focused.focus();
  key(document, "?", focused);
  assert.equal(hud.target, focused, "? on a focused guide opens that guide immediately");
  assert.equal(document.activeElement.className, "halo-hud-btn", "? moves keyboard focus to the guide's first action");
}

// 4. Dismissal behaviour
{
  const { document, hud } = createDocument();
  const target = guide(document, { "data-halo-guide": "Dismiss me." }, document.body, "button");
  target.focus();
  hud.show(target);
  document.body.querySelector(".halo-hud-close").focus();
  key(document, "Escape");
  assert.equal(hud.isOpen(), false, "Escape closes the HUD");
  assert.equal(document.activeElement, target, "Escape returns focus to the guided element");
  assert.equal(target.getAttribute("aria-describedby"), null, "aria-describedby is restored on close");
  assert.equal(document.body.querySelector("#haloHud").getAttribute("aria-hidden"), "true");

  hud.show(target);
  const outside = guide(document, {}, document.body, "div");
  outside.click();
  assert.equal(hud.isOpen(), false, "outside click closes the HUD");

  hud.show(target);
  document.body.querySelector(".halo-hud-close").click();
  assert.equal(hud.isOpen(), false, "close button dismisses the HUD");

  hud.openGuide();
  outside.click();
  assert.equal(hud.isOpen(), false, "outside click closes the quick guide too");
}

// 5. Dynamic DOM updates / re-renders
{
  const { document, flush, hud } = createDocument();
  const board = guide(document, {}, document.body, "div");
  const late = guide(document, { "data-halo-guide": "Late-loaded chart row." }, board, "button");
  const inner = guide(document, {}, late, "span");
  hover(inner);
  flush();
  assert.equal(hud.target, late, "delegation covers late-loaded content and nested children");

  board.replaceChildren();
  assert.equal(hud.isOpen(), false, "HUD closes when a re-render detaches its target");

  const rerendered = guide(document, { "data-halo-guide": "Re-rendered row." }, board, "button");
  hover(rerendered);
  board.replaceChildren(guide(document, { "data-halo-guide": "Newest row." }, document.body, "button"));
  flush();
  assert.equal(hud.isOpen(), false, "pending guides for detached nodes never open");
  hover(board.querySelector("[data-halo-guide]"));
  flush();
  assert.equal(document.body.querySelector("#haloHudText").textContent, "Newest row.", "re-rendered rows are guided without re-binding");
  assert.equal(document.body.querySelectorAll("#haloHud").length, 1, "HUD stays a single shared element");
}

// Engine is idempotent when loaded twice.
{
  const { window, hud } = createDocument();
  const context = vm.createContext({ window, document: window.document, navigator: {}, console });
  vm.runInContext(engine, context);
  assert.equal(window.HaloHud, hud, "loading the engine twice keeps the first instance");
}

console.log("HALO HUD contracts passed.");
