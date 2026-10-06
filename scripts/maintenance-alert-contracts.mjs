import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [storeSource, panelSource, monitorSource, deckSource] = await Promise.all([
  readFile(new URL("../halo-alert-store.js", import.meta.url), "utf8"),
  readFile(new URL("../maintenance-panel.js", import.meta.url), "utf8"),
  readFile(new URL("../site-monitor.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);

const listeners = new Map();
const dispatched = [];
const sandbox = {
  console,
  Map,
  Set,
  Date,
  String,
  Object,
  Array,
  CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
  addEventListener(type, callback) {
    const callbacks = listeners.get(type) || [];
    callbacks.push(callback);
    listeners.set(type, callbacks);
  },
  dispatchEvent(event) {
    dispatched.push(event);
    (listeners.get(event.type) || []).forEach(callback => callback(event));
  }
};
sandbox.window = sandbox;

const countNode = { textContent: "" };
const triggerHandlers = {};
const trigger = {
  attributes: {},
  querySelector(selector) { return selector === "#maintenanceDockCount" ? countNode : null; },
  setAttribute(name, value) { this.attributes[name] = value; },
  focus() { this.focused = true; },
  addEventListener(type, callback) { triggerHandlers[type] = callback; }
};
const summaryNode = { textContent: "" };
const listNode = { innerHTML: "" };
const panelHandlers = {};
const panel = {
  hidden: false,
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  addEventListener(type, callback) { panelHandlers[type] = callback; },
  querySelector(selector) {
    if (selector === "[data-alert-summary]") return summaryNode;
    if (selector === ".maintenance-panel__list") return listNode;
    return null;
  }
};
sandbox.document = {
  readyState: "complete",
  body: { append() {} },
  querySelector(selector) {
    if (selector === "#maintenanceDock") return trigger;
    return null;
  },
  createElement() { return panel; }
};

vm.createContext(sandbox);
const browserWindow = vm.runInContext("window", sandbox);
vm.runInContext(storeSource, sandbox);
const store = sandbox.HaloAlertStore;
assert.ok(store, "The shared alert store is exposed to browser code.");
vm.runInContext(panelSource, sandbox);
triggerHandlers.click();
assert.equal(panel.hidden, false, "The dock opens the live alert panel.");
assert.equal(trigger.attributes["aria-expanded"], "true");

store.upsert({ id: "diagnostic:Audio Scout", title: "Audio Scout", message: "Deck output stopped.", category: "audio", severity: "critical", retryable: true, fingerprint: "dj-deck|audio" });
assert.equal(countNode.textContent, "1 alert", "Dock count reflects live alerts.");
assert.equal(summaryNode.textContent, "1 active alert");
assert.match(listNode.innerHTML, /Audio Scout/);
assert.match(listNode.innerHTML, /data-alert-retry="diagnostic:Audio Scout"/);

const retryButton = {
  dataset: { alertRetry: "diagnostic:Audio Scout" },
  matches(selector) { return selector === "[data-alert-retry]"; }
};
panelHandlers.click({ target: { closest: () => retryButton } });
assert.equal(dispatched.at(-1).type, "halo:maintenance-retry");
assert.equal(dispatched.at(-1).detail.id, "diagnostic:Audio Scout", "Retry dispatches the selected diagnostic for a fresh monitor pass.");

const clearButton = { matches: selector => selector === "[data-clear-alerts]" };
panelHandlers.click({ target: { closest: () => clearButton } });
assert.equal(store.list().length, 0, "Clear all removes active alerts.");
assert.equal(countNode.textContent, "0 alerts", "Dock count updates after clearing.");
panelHandlers.click({ target: { closest: () => ({ matches: selector => selector === "[data-panel-close]" }) } });
assert.equal(panel.hidden, true, "Close control dismisses the panel.");
assert.equal(trigger.focused, true, "Closing returns focus to the dock.");

const runtimeError = { target: browserWindow, message: "TypeError: runtime fault" };
(listeners.get("error") || []).forEach(callback => callback(runtimeError));
assert.equal(store.list()[0].category, "runtime", "Runtime errors become visible alerts.");
const rejection = { reason: new Error("rejected request") };
(listeners.get("unhandledrejection") || []).forEach(callback => callback(rejection));
assert.ok(store.list().some(alert => alert.title === "Unhandled promise rejection"));
(listeners.get("offline") || []).forEach(callback => callback({}));
assert.ok(store.list().some(alert => alert.id === "network:offline"), "Offline state is surfaced as a retryable network alert.");
(listeners.get("online") || []).forEach(callback => callback({}));
assert.ok(!store.list().some(alert => alert.id === "network:offline"), "The offline alert clears on reconnection.");

assert.match(monitorSource, /function syncMaintenanceAlerts\(checks\)/);
assert.match(monitorSource, /window\.HaloAlertStore\?\.upsert/);
assert.match(monitorSource, /window\.HaloAlertStore\?\.remove/);
assert.match(monitorSource, /window\.addEventListener\("halo:maintenance-retry"/);
assert.match(monitorSource, /submittedFindings\.delete\(pending\[index\]\.fingerprint\)/, "Failed network reports can be retried.");
assert.match(monitorSource, /id: "network:issue-report"/, "Failed issue API requests appear as network alerts.");
assert.match(monitorSource, /activeRender\.finally\(\(\) => render\(\)\)/, "Retry waits for an in-flight monitor pass before rerunning.");
assert.match(deckSource, /id="maintenanceDockCount">0 alerts<\/strong>/);
assert.doesNotMatch(deckSource, /10 alerts/);

console.log("Maintenance alert contracts: live counts, runtime/network alerts, retry dispatch, and clear behavior passed.");
