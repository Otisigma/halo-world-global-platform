import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const companion = await readFile(new URL("../halo-companion.js", import.meta.url), "utf8");
const companionFunction = await readFile(new URL("../netlify/functions/halo-companion.mjs", import.meta.url), "utf8");

assert.match(companion, /Voice \+ guidance options/);
assert.match(companion, /halo-companion-settings\.v1/);
assert.match(companion, /halo-artist-journey-state\.v1/);
assert.match(companion, /voiceEnabled: false/);
assert.match(companion, /<option value="concise">Concise<\/option><option value="detailed">Detailed<\/option>/);
assert.match(companion, /<option value="proactive">Proactive<\/option><option value="manual">Manual<\/option>/);
assert.match(companion, /<option value="full-site">Full-site<\/option><option value="deck-only">Deck-only<\/option>/);
assert.match(companion, /speechSynthesis/);
assert.match(companion, /SpeechSynthesisUtterance/);
assert.match(companion, /halo:artist-journey-update/);
assert.match(companion, /Replay latest guidance|Speak guidance/);

assert.match(companionFunction, /companionOptions/);
assert.match(companionFunction, /guidanceDetail/);
assert.match(companionFunction, /promptMode/);
assert.match(companionFunction, /guidanceScope/);
assert.match(companionFunction, /voiceStyle/);
assert.match(companionFunction, /keep the reply to one or two short sentences/);

const monitor = await readFile(new URL("../site-monitor.js", import.meta.url), "utf8");
const homepage = await readFile(new URL("../halo.html", import.meta.url), "utf8");
assert.match(monitor, /companion\.src = "\/halo-companion\.js"/, "the shared monitor mounts the guide");
assert.match(homepage, /src="\/site-monitor\.js"/, "the homepage uses the global mount");
assert.match(companion, /✦ ASK HALO/);
assert.match(companion, /HALO GUIDE · 4 SPECIALISTS/);
assert.match(companion, /halo-companion-status" aria-hidden="true"/);
assert.match(companion, /backdrop-filter:blur\(18px\)/);
assert.match(companion, /pointer-events:none;animation:halo-companion-aura/);
assert.match(companion, /prefers-reduced-motion:reduce[^`]*\*::before/);
assert.match(companion, /if \(!event.defaultPrevented\) toggle\(\)/, "a drag must not open the conversation");

const dragHint = { textContent: "Drag to reposition, or use arrow keys while this button is focused." };
const liveStatus = { textContent: "" };
const unreadState = { open: false, unread: 0 };
const unreadContext = vm.createContext({
  state: unreadState,
  updateUnread() {},
  root: {
    querySelector(selector) {
      return selector === '.halo-companion-sr[role="status"]' ? liveStatus : dragHint;
    }
  }
});
const unreadStart = companion.indexOf("  function noteUnread(agent)");
const unreadEnd = companion.indexOf("  function addMessage(", unreadStart);
vm.runInContext(`${companion.slice(unreadStart, unreadEnd)}noteUnread({ name: "Nova" });`, unreadContext);
assert.equal(liveStatus.textContent, "New HALO Guide reply from Nova.", "unread replies still reach the live status region");
assert.match(dragHint.textContent, /arrow keys/, "reply announcements preserve drag instructions");
assert.equal(unreadState.unread, 1);

// Exercise the drag initializer with measured geometry and captured pointer events.
const listeners = () => ({
  events: new Map(),
  addEventListener(type, callback) {
    const callbacks = this.events.get(type) || [];
    callbacks.push(callback);
    this.events.set(type, callbacks);
  },
  emit(type, values = {}) {
    const event = {
      button: 0, isPrimary: true, pointerId: 1, detail: 1,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...values
    };
    for (const callback of this.events.get(type) || []) callback(event);
    return event;
  }
});
const window = Object.assign(listeners(), { innerWidth: 1000, innerHeight: 800 });
const style = {};
const panel = { hidden: true, offsetWidth: 430, offsetHeight: 690, style: {} };
let capture = null;
let width = 220;
let height = 60;
const launcher = Object.assign(listeners(), {
  dataset: {},
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  setPointerCapture(id) { capture = id; },
  hasPointerCapture(id) { return capture === id; },
  releasePointerCapture() { capture = null; this.emit("lostpointercapture"); },
  getBoundingClientRect() {
    const left = style.left ? parseFloat(style.left) : 18;
    const top = style.top ? parseFloat(style.top) : window.innerHeight - 78;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
});
const root = {
  style,
  querySelector(selector) { return selector === ".halo-companion-launcher" ? launcher : panel; }
};
let observer;
const context = vm.createContext({
  window,
  ResizeObserver: class {
    constructor(callback) { observer = this; this.callback = callback; this.targets = []; }
    observe(target) { this.targets.push(target); }
  }
});
const dragStart = companion.indexOf("  function setupGuideDrag(root)");
const dragEnd = companion.indexOf("  function setAgent(", dragStart);
assert.ok(dragStart > 0 && dragEnd > dragStart);
vm.runInContext(`${companion.slice(dragStart, dragEnd)}this.setup = setupGuideDrag;`, context);
const placePanel = context.setup(root);
const position = () => [parseFloat(style.left), parseFloat(style.top)];
assert.deepEqual(position(), [18, 722]);
assert.match(launcher.attributes["aria-describedby"], /haloCompanionDragHint/);
assert.deepEqual(observer.targets, [launcher, panel]);

launcher.emit("pointerdown", { clientX: 38, clientY: 742 });
assert.equal(capture, 1, "drag retains events outside the button");
launcher.emit("pointermove", { clientX: 40, clientY: 743 });
assert.deepEqual(position(), [18, 722], "small click jitter does not move the guide");
launcher.emit("pointermove", { clientX: 238, clientY: 442, pointerId: 2 });
assert.deepEqual(position(), [18, 722], "another pointer cannot move the guide");
launcher.emit("pointermove", { clientX: 238, clientY: 442 });
assert.deepEqual(position(), [218, 422], "the measured grab offset is preserved");
launcher.emit("pointerup");
assert.equal(capture, null);
assert.equal(launcher.dataset.dragging, "false");
assert.equal(launcher.emit("click").defaultPrevented, true, "drag release cannot activate the guide");
assert.equal(launcher.emit("click", { detail: 0 }).defaultPrevented, false, "keyboard activation remains available");
launcher.emit("pointermove", { clientX: 500, clientY: 500 });
assert.deepEqual(position(), [218, 422], "movement stops after release");

launcher.emit("pointerdown", { clientX: 238, clientY: 442, button: 2 });
assert.equal(capture, null, "right-click does not start dragging");
launcher.emit("pointerdown", { clientX: 238, clientY: 442, isPrimary: false });
assert.equal(capture, null, "secondary touch does not start dragging");
launcher.emit("pointerdown", { clientX: 238, clientY: 442, pointerType: "touch" });
launcher.emit("pointermove", { clientX: -500, clientY: -500, pointerType: "touch" });
assert.deepEqual(position(), [10, 10], "touch dragging clamps the top and left edges");
launcher.emit("pointermove", { clientX: 5000, clientY: 5000, pointerType: "touch" });
assert.deepEqual(position(), [770, 730], "dragging clamps the bottom and right edges");
launcher.emit("pointercancel", { pointerId: 2 });
assert.equal(capture, 1, "an unrelated cancellation leaves the active drag alone");
launcher.emit("pointercancel");
assert.equal(capture, null);
launcher.emit("pointermove", { clientX: 200, clientY: 200 });
assert.deepEqual(position(), [770, 730], "touch cancellation stops movement");
launcher.emit("pointerdown", { clientX: 790, clientY: 750 });
launcher.emit("pointerup");
assert.equal(launcher.emit("click").defaultPrevented, false, "a fresh tap still opens the guide");

window.innerWidth = 320;
window.innerHeight = 240;
window.emit("resize");
assert.deepEqual(position(), [90, 170], "viewport shrink reclamps stored position");
launcher.emit("keydown", { key: "ArrowLeft" });
launcher.emit("keydown", { key: "ArrowUp", shiftKey: true });
assert.deepEqual(position(), [80, 130], "arrow keys offer an alternative to dragging");
assert.equal(launcher.emit("keydown", { key: "Enter" }).defaultPrevented, false);
launcher.emit("pointerdown", { clientX: 100, clientY: 150 });
window.emit("blur");
assert.equal(capture, null, "leaving the window releases the active pointer");

width = 300;
height = 80;
observer.callback();
assert.deepEqual(position(), [10, 130], "layout changes use actual launcher dimensions");
window.innerWidth = 300;
window.innerHeight = 80;
window.emit("resize");
assert.deepEqual(position(), [0, 0], "an exact-fit viewport never produces negative bounds");

window.innerWidth = 1000;
window.innerHeight = 800;
width = 220;
height = 60;
panel.hidden = false;
placePanel();
assert.equal(panel.style.left, "10px");
assert.equal(panel.style.top, "74px", "a top-edge launcher opens its panel below");
assert.equal(panel.style.bottom, "auto");
launcher.emit("pointerdown", { clientX: 20, clientY: 20 });
launcher.emit("pointermove", { clientX: 5000, clientY: 5000 });
launcher.emit("lostpointercapture");
assert.equal(launcher.dataset.dragging, "false");
assert.equal(panel.style.left, "560px", "a right-edge panel stays on screen");
assert.equal(panel.style.top, "26px", "a bottom-edge panel opens above the launcher");

// Dismiss leaves only the "Call HALO" trigger; the trigger restores the guide.
assert.match(companion, /typeof window === "undefined" \|\| typeof document === "undefined"/, "the guide is inert without a DOM");
assert.match(companion, /class="halo-companion-dismiss" type="button" aria-label="Minimize HALO Guide"/);
assert.match(companion, /Call HALO/);
assert.match(companion, /\.halo-companion-panel\{[^}]*backdrop-filter:blur\(22px\)/, "the expanded panel is frosted glass");
assert.match(companion, /@supports not \(\(backdrop-filter/, "glass has an opaque fallback");
assert.match(companion, /prefers-reduced-transparency:reduce/);
assert.match(companion, /if \(root\.hidden\) return;/, "a dismissed guide is never measured");

const dismissStart = companion.indexOf("  function setupDismissRecall(");
const dismissEnd = companion.indexOf("  function toggle(", dismissStart);
assert.ok(dismissStart > 0 && dismissEnd > dismissStart);
const focusable = (extra = {}) => Object.assign(listeners(), { focused: 0, focus() { this.focused += 1; } }, extra);
const runDismiss = storedValue => {
  const storage = new Map(storedValue ? [["halo-companion-dismissed.v1", storedValue]] : []);
  const guideLauncher = focusable();
  const dismissButton = focusable();
  const guideRoot = {
    hidden: false,
    querySelector(selector) { return selector === ".halo-companion-dismiss" ? dismissButton : guideLauncher; }
  };
  const recall = focusable({ hidden: true });
  let closed = 0;
  const dismissContext = vm.createContext({
    DISMISSED_KEY: "halo-companion-dismissed.v1",
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    }
  });
  vm.runInContext(`${companion.slice(dismissStart, dismissEnd)}this.setup = setupDismissRecall;`, dismissContext);
  dismissContext.setup(guideRoot, recall, () => { closed += 1; });
  return { storage, guideLauncher, dismissButton, guideRoot, recall, closed: () => closed };
};

const fresh = runDismiss();
assert.equal(fresh.guideRoot.hidden, false, "the guide starts visible");
assert.equal(fresh.recall.hidden, true, "the recall trigger is hidden while the guide is shown");
assert.equal(fresh.recall.focused, 0, "mounting never steals focus");
fresh.dismissButton.emit("click");
assert.equal(fresh.closed(), 1, "dismissing closes the expanded panel");
assert.equal(fresh.guideRoot.hidden, true, "dismiss hides the full widget");
assert.equal(fresh.recall.hidden, false, "only the Call HALO trigger remains");
assert.equal(fresh.recall.focused, 1, "focus follows the recall trigger");
assert.equal(fresh.storage.get("halo-companion-dismissed.v1"), "1", "dismissal persists across pages");
fresh.recall.emit("click");
assert.equal(fresh.guideRoot.hidden, false, "Call HALO restores the widget");
assert.equal(fresh.recall.hidden, true);
assert.equal(fresh.guideLauncher.focused, 1, "focus returns to the Ask HALO pill");
assert.equal(fresh.storage.has("halo-companion-dismissed.v1"), false);

const remembered = runDismiss("1");
assert.equal(remembered.guideRoot.hidden, true, "a remembered dismissal shows only the trigger");
assert.equal(remembered.recall.hidden, false);
assert.equal(remembered.recall.focused, 0, "restoring dismissed state on load never steals focus");
remembered.recall.emit("click");
assert.equal(remembered.guideRoot.hidden, false);

console.log("HALO companion contracts: voice, global guide mounting, mouse/touch dragging, bounds, keyboard access, panel placement, glass styling, and dismiss/recall are wired.");
