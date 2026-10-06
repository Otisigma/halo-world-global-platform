import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { mountCampaignUpdates, safeUpdateDestination } from "../campaign-updates.js";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const [relations, signal, dreamweaver, widget, desk] = await Promise.all([
  read("halo-relations.html"), read("signal-network/index.html"),
  read("dreamweaver/index.html"), read("campaign-updates.js"), read("master-campaign-workspace.js")
]);
assert.match(relations, /id="masterCampaignWorkspace"/);
assert.match(relations, /src="\/master-campaign-workspace.js"/);
assert.match(relations, /name="rightsConfirmed"[^>]*required/);
for (const page of [signal, dreamweaver]) {
  assert.match(page, /data-campaign-updates/);
  assert.match(page, /src="\/campaign-updates.js"/);
  assert.match(page, /src="\/identity.js"/);
}
assert.doesNotMatch(widget, /innerHTML|insertAdjacentHTML/);
assert.doesNotMatch(desk, /innerHTML|insertAdjacentHTML/);
assert.match(desk, /publicConsent: true/);
assert.match(desk, /channels: \[channel\]/);
const origin = "https://halo.example";
assert.equal(safeUpdateDestination("/dreamweaver/?song=123#story", origin), "/dreamweaver/?song=123#story");
assert.equal(safeUpdateDestination(`${origin}/dreamweaver/?song=123`, origin), "/dreamweaver/?song=123");
for (const value of ["javascript:alert(1)", "https://evil.example", "https://account@halo.example", "//evil.example", "/\\evil.example", null]) {
  assert.equal(safeUpdateDestination(value, origin), "");
}

class Element {
  constructor(tag, document) {
    this.tagName = tag;
    this.ownerDocument = document;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.checked = false;
    this.disabled = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, listener) { this.listeners[event] = listener; }
}
const document = {
  hidden: false,
  createElement(tag) { return new Element(tag, this); },
  createTextNode(text) { return { textContent: text }; }
};
const descendants = (element, predicate) => [
  ...(predicate(element) ? [element] : []),
  ...(element.children || []).flatMap(child => descendants(child, predicate))
];
const turn = () => new Promise(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch;
let authChange, calls = [], preferences = { release_notes: false, halo_updates: false }, pending;
globalThis.fetch = async (_url, options) => {
  const payload = options.body ? JSON.parse(options.body) : null;
  calls.push(payload);
  if (pending && !payload) return pending;
  if (payload?.purpose) preferences[payload.purpose] = payload.action === "subscribe";
  return { ok: true, json: async () => ({ preferences: Object.entries(preferences).map(([purpose, subscribed]) => ({ purpose, subscribed })), inbox: [
    { id: "notice", output: { title: "<script>not HTML</script>", body: "Approved release", destinationUrl: "/halo" }, readAt: null }
  ] }) };
};
const element = new Element("section", document);
const dispose = mountCampaignUpdates(element, {
  getUser: async () => ({ id: "member" }),
  onAuthChange(callback) { authChange = callback; return () => {}; }
});
try {
  await turn();
  const inputs = descendants(element, node => node.tagName === "input");
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every(input => !input.checked && !input.disabled), "subscriptions default off");
  inputs[0].checked = true;
  descendants(element, node => node.tagName === "form")[0].listeners.submit({ preventDefault() {} });
  await turn();
  assert.ok(calls.some(call => call?.action === "subscribe" && call.purpose === "release_notes"));
  assert.equal(preferences.halo_updates, false, "release opt-in must not enable platform updates");
  let resolveResponse;
  pending = new Promise(resolve => { resolveResponse = resolve; });
  descendants(element, node => node.tagName === "button" && node.textContent === "Refresh updates")[0].listeners.click();
  authChange("logout", null);
  resolveResponse({ ok: true, json: async () => ({ preferences: [{ purpose: "release_notes", subscribed: true }], inbox: [{ output: { title: "Stale private data" } }] }) });
  await turn();
  assert.ok(inputs.every(input => !input.checked && input.disabled));
  assert.equal(descendants(element, node => node.tagName === "article").length, 0, "logout clears inbox and rejects stale responses");
} finally {
  dispose();
  globalThis.fetch = originalFetch;
}
const elements = new Map();
const values = {
  sourceType: "halo_update", sourceKind: "release", sourceId: "",
  title: "HALO release", brief: "Verified announcement", objective: "Inform",
  audience: "HALO members", destinationUrl: "/halo", theme: "winter",
  locale: "en", region: "Global", activeFrom: "2026-12-01", activeUntil: "2027-02-28",
  rightsConfirmed: "on"
};
const deskContext = {
  document: {
    getElementById(id) {
      if (!elements.has(id)) {
        const element = new Element("div", document);
        element.querySelectorAll = () => [{ value: "signal" }, { value: "inbox" }];
        element.elements = { sourceType: new Element("select", document), sourceKind: {}, sourceId: {} };
        elements.set(id, element);
      }
      return elements.get(id);
    }
  },
  window: { addEventListener() {}, confirm: () => false },
  AbortController,
  FormData: class { get(name) { return values[name] ?? null; } }
};
runInNewContext(`${desk.replace(/^import .*;\n/m, "")}\nglobalThis.campaignTest = { readBrief, approvedChannel, confirmDiscardEdits, state };`, deskContext);
const brief = JSON.parse(JSON.stringify(deskContext.campaignTest.readBrief()));
assert.equal(brief.type, "halo_update");
assert.equal(brief.source, null, "platform updates must not require a fabricated mix");
assert.equal(brief.summary, "Verified announcement");
assert.equal(brief.themeId, "winter");
assert.deepEqual(brief.channels, ["signal", "inbox"]);
const campaign = { status: "approved", version: 2, outputs: { signal: {}, inbox: {} }, approval: { version: 2, channels: ["signal"] } };
assert.equal(deskContext.campaignTest.approvedChannel(campaign, "signal"), true);
assert.equal(deskContext.campaignTest.approvedChannel(campaign, "inbox"), false, "one channel's approval must not approve another");
campaign.version = 3;
assert.equal(deskContext.campaignTest.approvedChannel(campaign, "signal"), false, "revision invalidates approval");
const controls = elements.get("masterCampaignForm").elements;
assert.equal(typeof controls.sourceType.listeners.change, "function", "source selection works before the first submission");
controls.sourceType.value = "mix";
controls.sourceType.listeners.change();
assert.equal(controls.sourceKind.value, "mix");
assert.equal(controls.sourceId.required, true);
controls.sourceType.value = "halo_update";
controls.sourceType.listeners.change();
assert.equal(controls.sourceId.required, false);
assert.equal(deskContext.campaignTest.confirmDiscardEdits(), true);
deskContext.campaignTest.state.editors.set("signal", () => true);
assert.equal(deskContext.campaignTest.confirmDiscardEdits(), false, "discarding unsaved copy requires confirmation");
deskContext.window.confirm = () => true;
assert.equal(deskContext.campaignTest.confirmDiscardEdits(), true);
console.log("Master campaign UI contracts passed.");
