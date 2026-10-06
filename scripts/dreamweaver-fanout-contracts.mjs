import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHaloBrandRouter } from "../halo-brand-router.js";
import { DreamweaverCampaignEngine } from "../services/dreamweaver-campaign-engine.js";
import { CampaignFanOutService, SIGNAL_FEED_PUBLISH_ENDPOINT } from "../services/campaign-fan-out.js";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

class Element {
  constructor(attributes = {}, textContent = "") {
    this.attributes = new Map(Object.entries(attributes));
    this.dataset = {};
    this.textContent = textContent;
    this.listeners = new Map();
    this.children = [];
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
}

const links = [
  new Element({ href: "/halo", "data-halo-logo-link": "" }),
  new Element({ href: "/halo", "data-halo-teaser-link": "" })
];
const teaser = new Element({ "data-halo-teaser-text": "" }, "Discover HALO →");
const elements = [...links, teaser];
const clicks = [];
const storage = new Map();
const document = {
  addEventListener(type, handler) { this.handler = handler; },
  removeEventListener() {},
  querySelectorAll(selector) {
    return elements.filter(element => selector === "[data-halo-logo-link]" && element.hasAttribute("data-halo-logo-link")
      || selector === "[data-halo-teaser-link]" && element.hasAttribute("data-halo-teaser-link")
      || selector === "[data-halo-teaser-text]" && element.hasAttribute("data-halo-teaser-text"));
  }
};
const window = {
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value)
  },
  haloStats: { track: (...args) => clicks.push(args) }
};

const router = createHaloBrandRouter({ document, window, random: () => 0.25 });
assert.equal(router.getVariant(), "Variant_A_Shop");
assert.equal(links[0].getAttribute("href"), "/signal-network/#signal-feed");
assert.equal(links[1].getAttribute("href"), "/signal-network/#signal-feed");
assert.match(teaser.textContent, /Signal Marketplace/);
assert.equal(createHaloBrandRouter({ document, window, random: () => 0.99 }).getVariant(), "Variant_A_Shop");
let prevented = false;
document.handler({ target: { closest: () => links[0] }, preventDefault() { prevented = true; } });
assert.equal(prevented, false);
assert.deepEqual(clicks[0][0], "halo_logo_router_click");
assert.equal(clicks[0][1].variant, "Variant_A_Shop");
router.destroy();
assert.equal(createHaloBrandRouter().getVariant(), null);

const blockedStorageWindow = {};
Object.defineProperty(blockedStorageWindow, "localStorage", { get() { throw new Error("blocked"); } });
assert.equal(createHaloBrandRouter({ document, window: blockedStorageWindow, random: () => 0.75 }).getVariant(), "Variant_B_Dreamweaver");

const engine = new DreamweaverCampaignEngine();
const campaign = engine.generate({ title: "After Hours", artist: "HALO", theme: "electric", hook: "Meet us in the room.", callToAction: "Listen now" });
assert.equal(campaign.channels.length, 7);
assert.deepEqual(campaign.channels.map(channel => channel.id), ["signal", "instagram", "threads", "x", "discord", "telegram", "email"]);
assert.equal(campaign.theme.label, "Electric Room");
assert.ok(campaign.channels.every(channel => channel.content.includes("After Hours")));
assert.ok(campaign.channels.find(channel => channel.id === "x").content.length <= 280);
assert.equal(engine.generate({ title: "Test", destination: "javascript:alert(1)" }).channels[0].content.includes("javascript:"), false);

let request;
const fanOut = new CampaignFanOutService({
  fetchImpl: async (...args) => {
    request = args;
    return { ok: true, json: async () => ({ id: "published" }) };
  }
});
assert.equal((await fanOut.publishSignalFeed(campaign.channels[0].content)).id, "published");
assert.equal(request[0], SIGNAL_FEED_PUBLISH_ENDPOINT);
assert.equal(request[1].credentials, "same-origin");
assert.equal(JSON.parse(request[1].body).action, "publish");
await assert.rejects(() => fanOut.publishSignalFeed("  "), /Generate and review/);
let copied = "";
assert.equal(await new CampaignFanOutService({ navigatorImpl: { clipboard: { writeText: async value => { copied = value; } } } }).copy("channel draft"), true);
assert.equal(copied, "channel draft");

const [homepage, studio, modal, routerSource, policy] = await Promise.all([
  read("halo.html"),
  read("campaign-studio/index.html"),
  read("campaign-studio/dreamweaver-fanout-modal.js"),
  read("halo-brand-router.js"),
  read("campaign-studio/index.html")
]);
assert.match(homepage, /data-halo-logo-link/);
assert.match(homepage, /data-halo-teaser-link/);
assert.match(studio, /data-open-dreamweaver-campaign/);
assert.match(studio, /data-channel-previews/);
assert.match(modal, /showModal/);
assert.match(modal, /data-publish-approval/);
assert.match(modal, /textContent = channel\.content/);
assert.match(routerSource, /textContent = text/);
assert.match(policy, /HALO logo, wordmark, emblem geometry/);
assert.match(policy, /uploader unless a separate written agreement/);

console.log("Dreamweaver fan-out contracts passed.");
