import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSignalRooms } from "../signal-network/signal-rooms.js";

const page = await readFile(new URL("../signal-network/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../signal-network/signal-rooms.css", import.meta.url), "utf8");
const roomIds = ["sovereign-vault", "pearl-hall", "dreamweaver", "ritual-engine", "release-desk", "signal-network-module"];

class Element {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.id = attributes.id;
    this.hidden = false;
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name)
    };
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) {
    if (this.listeners.get(type) === handler) this.listeners.delete(type);
  }
  dispatch(type, event = {}) { this.listeners.get(type)?.(event); }
  contains(element) { return element === this || element?.parent === this; }
  focus() { this.owner.activeElement = this; }
}

function fixture({ hash = "", loading = false, selected = 0, missingPanel = -1 } = {}) {
  const tabs = roomIds.map((id, index) => new Element({
    id: `tab-${id}`, "aria-controls": id, "aria-selected": String(index === selected)
  }));
  const panels = roomIds.map(id => new Element({ id })).filter((_, index) => index !== missingPanel);
  const tablist = new Element();
  tablist.hidden = true;
  tablist.querySelectorAll = () => tabs;
  const root = new Element();
  root.querySelector = () => tablist;
  root.querySelectorAll = () => panels;
  const document = new Element();
  document.readyState = loading ? "loading" : "complete";
  document.querySelector = () => root;
  const child = { id: "room-child", parent: panels[2] };
  document.getElementById = id => panels.find(panel => panel.id === id) || (id === child.id ? child : null);
  for (const element of [...tabs, ...panels]) element.owner = document;
  const window = new Element();
  window.location = { hash };
  const controller = createSignalRooms({ document, window });
  return { tabs, panels, tablist, root, document, window, controller, child };
}

function assertActive(view, id) {
  assert.equal(view.controller.getActiveRoom(), id);
  assert.equal(view.panels.filter(panel => !panel.hidden).length, 1);
  for (const panel of view.panels) {
    const tab = view.tabs.find(item => item.getAttribute("aria-controls") === panel.id);
    const active = panel.id === id;
    assert.equal(panel.hidden, !active);
    assert.equal(panel.classes.has("active"), active);
    assert.equal(tab.classes.has("active"), active);
    assert.equal(tab.getAttribute("aria-selected"), String(active));
    assert.equal(tab.tabIndex, active ? 0 : -1);
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
    assert.equal(panel.tabIndex, 0);
    assert.equal(tab.getAttribute("role"), "tab");
  }
}

const view = fixture();
assertActive(view, roomIds[0]);
assert.equal(view.window.location.hash, "", "default does not rewrite unrelated page navigation");
assert.equal(view.tablist.hidden, false);
assert.equal(view.tablist.getAttribute("role"), "tablist");
assert.equal(view.root.classes.has("signal-rooms--ready"), true);
for (const [index, tab] of view.tabs.entries()) {
  tab.dispatch("click");
  assertActive(view, roomIds[index]);
  assert.equal(view.window.location.hash, roomIds[index]);
}

function key(tab, value) {
  let prevented = false;
  tab.dispatch("keydown", { key: value, preventDefault() { prevented = true; } });
  return prevented;
}
assert.equal(key(view.tabs[5], "ArrowRight"), true);
assertActive(view, roomIds[0]);
assert.equal(view.document.activeElement, view.tabs[0]);
assert.equal(key(view.tabs[0], "ArrowLeft"), true);
assertActive(view, roomIds[5]);
key(view.tabs[5], "Home");
assertActive(view, roomIds[0]);
key(view.tabs[0], "End");
assertActive(view, roomIds[5]);
assert.equal(key(view.tabs[5], "Tab"), false);
assertActive(view, roomIds[5]);

for (const id of roomIds) assertActive(fixture({ hash: `#${id}` }), id);
assertActive(fixture({ hash: "#%64reamweaver" }), "dreamweaver");
assertActive(fixture({ hash: "#room-child" }), "dreamweaver");
for (const hash of ["#unknown", "#signal-feed", "#feed", "#%broken"]) {
  assertActive(fixture({ hash }), roomIds[0]);
}
assertActive(fixture({ selected: -1 }), roomIds[0]);
assertActive(fixture({ selected: 3 }), roomIds[3]);
view.window.location.hash = "#dreamweaver";
view.window.dispatch("hashchange");
assertActive(view, "dreamweaver");
view.document.activeElement = view.child;
view.window.location.hash = "#pearl-hall";
view.window.dispatch("hashchange");
assertActive(view, "pearl-hall");
assert.equal(view.document.activeElement, view.tabs[1], "hash navigation does not leave focus in a hidden room");
view.window.location.hash = "#feed";
view.window.dispatch("hashchange");
assertActive(view, "pearl-hall");
assert.equal(view.controller.select("not-a-room"), false);
assertActive(view, "pearl-hall");

const historyView = fixture();
const historyState = { existing: "navigation state" };
let historyArguments;
historyView.window.history = {
  state: historyState,
  pushState(...args) {
    historyArguments = args;
    historyView.window.location.hash = args[2];
  }
};
historyView.controller.select("dreamweaver", { focus: true });
assert.deepEqual(historyArguments, [historyState, "", "#dreamweaver"]);
assert.equal(historyView.document.activeElement, historyView.tabs[2]);
assertActive(historyView, "dreamweaver");
historyView.window.history.pushState = () => { throw new Error("History blocked"); };
assert.equal(historyView.controller.select("release-desk"), true);
assert.equal(historyView.window.location.hash, "release-desk");
assertActive(historyView, "release-desk");
historyView.window.location.hash = "";
historyView.window.dispatch("hashchange");
assertActive(historyView, "sovereign-vault");

const early = fixture({ loading: true, hash: "#release-desk" });
assert.equal(early.controller.getActiveRoom(), null);
assert.equal(early.tablist.hidden, true);
early.document.dispatch("DOMContentLoaded");
assertActive(early, "release-desk");
const cancelled = fixture({ loading: true });
cancelled.controller.destroy();
cancelled.document.dispatch("DOMContentLoaded");
assert.equal(cancelled.controller.getActiveRoom(), null);
const partial = fixture({ missingPanel: 0 });
assertActive(partial, "pearl-hall");
assert.equal(partial.tabs[0].disabled, true);
assert.equal(partial.tabs[0].tabIndex, -1);
view.controller.destroy();
view.tabs[0].dispatch("click");
view.window.location.hash = "#dreamweaver";
view.window.dispatch("hashchange");
assertActive(view, "pearl-hall");
assert.equal(createSignalRooms({ document: null, window: null }).select("dreamweaver"), false);
assert.equal(createSignalRooms({ document: {} }).getActiveRoom(), null);
assert.equal(createSignalRooms({ document: { querySelector: () => ({ querySelector: () => null }) } }).getActiveRoom(), null);

const tabMarkup = [...page.matchAll(/<button\b[^>]*\bdata-room-tab\b[^>]*>/g)].map(match => match[0]);
assert.equal(tabMarkup.length, 6);
for (const [index, id] of roomIds.entries()) {
  assert.match(tabMarkup[index], new RegExp(`aria-controls="${id}"`));
  const tabId = tabMarkup[index].match(/\bid="([^"]+)"/)[1];
  assert.equal(page.split(`id="${tabId}"`).length - 1, 1);
  assert.match(page, new RegExp(`<article[^>]*id="${id}"[^>]*data-room-panel`));
  assert.equal(page.split(`id="${id}"`).length - 1, 1);
}
assert.match(page, /data-room-tabs[^>]*hidden/);
assert.match(page, /<noscript>/);
assert.match(page, /src="\/signal-network\/signal-rooms.js"/);
assert.match(page, /href="\/signal-network\/signal-rooms.css"/);
assert.match(page, /data-halo-logo-link/);
assert.match(page, /src="\/halo-brand-router.js"/);
assert.match(page, /data-open-dreamweaver-campaign aria-controls="dreamweaverFanoutDialog"/);
assert.match(page, /id="dreamweaverFanoutDialog"/);
assert.match(page, /src="\/campaign-studio\/dreamweaver-fanout-modal.js"/);
for (const attribute of ["data-campaign-form", "data-channel-previews", "data-publish-approval", "data-publish-signal", "data-fanout-status", "data-campaign-theme"]) {
  assert.match(page, new RegExp(attribute));
}
for (const anchor of ["feed", "signal-feed", "command-center", "ritual"]) {
  assert.match(page, new RegExp(`id="${anchor}"`));
}
assert.match(styles, /\[data-room-panel\]\[hidden\]/);
assert.match(styles, /:focus-visible/);
console.log("Signal rooms contracts passed.");
