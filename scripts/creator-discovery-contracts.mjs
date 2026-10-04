import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initCreatorDiscovery, readDemoFollows, saveDemoFollows, filterDemoCreators, profileListings
} from "../creator-network/discovery.js";
import { CREATOR_SEEDS, LISTING_SEEDS, ORBIT_TIERS } from "../lib/creator-marketplace.js";
import { HaloAIService } from "../lib/halo-ai-service.js";
import { PUBLIC_ROUTE_REGISTRY } from "../lib/route-registry.js";

const [html, css, client] = await Promise.all([
  readFile(new URL("../creator-network/index.html", import.meta.url), "utf8"),
  readFile(new URL("../creator-network/network.css", import.meta.url), "utf8"),
  readFile(new URL("../creator-network/discovery.js", import.meta.url), "utf8")
]);
assert.ok(html.indexOf('id="demoDiscovery"') < html.indexOf('id="locked"'), "Samples appear before login");
assert.ok(html.indexOf('id="demoDiscovery"') < html.indexOf('id="publicDirectory"'), "Sample discovery is separate from real profiles");
assert.match(html, /illustrative sample profiles, not actual verified people/);
assert.match(html, /HALO Orbits \/ SERENA Mesh foundation/);
assert.match(html, /<dialog[^>]+aria-labelledby="demoProfileTitle"[^>]+aria-describedby="demoProfileDisclosure"/);
assert.match(html, /id="demoProfileClose"[^>]+autofocus/);
assert.match(html, /type="module" src="\/creator-network\/discovery.js"/);
const pageIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
assert.equal(new Set(pageIds).size, pageIds.length, "Live and demo creator sections have unique IDs");
for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
  assert.ok(pageIds.includes(target), `Creator navigation target exists: ${target}`);
}
for (const script of ["network", "discovery"]) {
  assert.equal((html.match(new RegExp(`type="module" src="/creator-network/${script}\\.js"`, "g")) || []).length, 1, `Load ${script} once as a module`);
}
assert.ok(pageIds.includes("createTitle") && pageIds.includes("collaboration"), "Both studio collaboration handoffs remain valid");
for (const id of ["publicDirectory", "publicCreators", "publicFilters", "locked", "login", "workspace", "collaboration", "studioTrack", "studioPlayer"]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `Keep existing ${id} intact`);
}
assert.doesNotMatch(client, /innerHTML|outerHTML|insertAdjacentHTML|fetch\s*\(/, "Demo does not inject HTML or call private/payment APIs");
assert.match(client, /safeAssetUrl\(listing.assetPreviewUrl\)/);
assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /\.demo-profile-dialog::backdrop/);
assert.equal(ORBIT_TIERS.length, 4);
assert.ok(ORBIT_TIERS.some(tier => !CREATOR_SEEDS.some(creator => creator.tier === tier.id)), "Include an empty sample orbit");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
const storage = memoryStorage();
assert.equal(saveDemoFollows(storage, new Set([CREATOR_SEEDS[0].id, "unknown"])), true);
assert.deepEqual([...readDemoFollows(storage).ids], [CREATOR_SEEDS[0].id], "Ignore stale/non-seed follows");
const brokenStorage = { getItem() { throw new Error("Blocked"); }, setItem() { throw new Error("Quota"); } };
assert.equal(readDemoFollows(brokenStorage).available, false);
assert.equal(saveDemoFollows(brokenStorage, new Set()), false);
assert.equal(saveDemoFollows(null, new Set()), false);
assert.deepEqual([...readDemoFollows(memoryStorage({ "halo.creator-demo.follows.v1": "{bad" })).ids], []);
assert.deepEqual([...readDemoFollows(memoryStorage({ "halo.creator-demo.follows.v1": "{}" })).ids], []);
assert.deepEqual(filterDemoCreators(CREATOR_SEEDS, "  DJ HALO "), [CREATOR_SEEDS[0]]);
assert.equal(filterDemoCreators(CREATOR_SEEDS, "not-a-creator").length, 0);
assert.deepEqual(filterDemoCreators(CREATOR_SEEDS, "", "Soul"), [CREATOR_SEEDS[2]]);
assert.equal(filterDemoCreators(CREATOR_SEEDS, "Halo", "Soul").length, 0);
assert.ok(profileListings(CREATOR_SEEDS[0]).every(listing => listing.creatorId === CREATOR_SEEDS[0].id));
const foreignListing = { ...LISTING_SEEDS[0], creatorId: CREATOR_SEEDS[1].id };
assert.equal(profileListings(CREATOR_SEEDS[0], [foreignListing]).length, 0, "A creator cannot feature another creator's listing");

class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.value = "";
    this.hidden = false;
    this.open = false;
    this._text = "";
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  async emit(type) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    await Promise.all((this.listeners.get(type) || []).map(callback => callback(event)));
    return event;
  }
  querySelector(tag) { return descendants(this).find(child => child.tagName === tag.toUpperCase()) || null; }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { assert.equal(this.open, false); this.open = true; }
  close() { this.open = false; void this.emit("close"); }
}
function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}
function fixture({ localStorage = memoryStorage(), aiService = HaloAIService, creators = CREATOR_SEEDS, listings = LISTING_SEEDS } = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    createElement: tag => new Element(tag, document),
    getElementById: id => elements.get(id) || [...elements.values()].flatMap(descendants).find(element => element.id === id) || null
  };
  for (const id of ["demoCreators", "demoProfileDialog", "demoProfileContent", "demoProfileClose", "demoProfileStatus",
    "demoDiscoveryStatus", "demoResultCount", "demoSearch", "demoGenre", "demoOrbitTiers", "demoFilters", "workspace"]) {
    const element = document.createElement(id === "demoProfileDialog" ? "dialog" : "div");
    element.id = id;
    elements.set(id, element);
  }
  elements.get("workspace").hidden = true;
  elements.get("demoProfileDialog").append(elements.get("demoProfileContent"), elements.get("demoProfileStatus"), elements.get("demoProfileClose"));
  const app = initCreatorDiscovery({ document, storage: localStorage, creators, listings, aiService });
  return { document, elements, app, get: id => document.getElementById(id) };
}
const findButton = (root, text) => descendants(root).find(element => element.tagName === "BUTTON" && element.textContent.includes(text));

const f = fixture();
assert.equal(f.get("demoCreators").children.length, CREATOR_SEEDS.length);
assert.match(f.get("demoCreators").textContent, /Verified · sample only/);
assert.match(f.get("demoCreators").textContent, /sample followers/);
assert.equal(f.get("demoOrbitTiers").children.length, 4);
assert.match(f.get("demoOrbitTiers").textContent, /Open orbit — no sample creators/);
assert.equal(descendants(f.get("demoOrbitTiers")).filter(element => element.tagName === "BUTTON").length, CREATOR_SEEDS.length);
const opener = findButton(f.get("demoCreators"), "Explore profile");
await opener.emit("click");
assert.equal(f.get("demoProfileDialog").open, true);
assert.equal(f.document.activeElement, f.get("demoProfileClose"));
assert.equal(f.get("demoProfileTitle").textContent, CREATOR_SEEDS[0].displayName);
assert.match(f.get("demoProfileContent").textContent, /illustrative orbit placement/);
assert.match(f.get("demoProfileContent").textContent, /no actual audio analysis or AI provider/);
assert.match(f.get("demoProfileContent").textContent, /not legal verification/);
assert.match(f.get("demoProfileContent").textContent, /No message is sent, invitation created/);
const links = descendants(f.get("demoProfileContent")).filter(element => element.tagName === "A");
assert.equal(links.length, 4, "Seed profiles do not invent preview URLs");
for (const link of links) {
  assert.ok(PUBLIC_ROUTE_REGISTRY.some(route => route.route === link.href.split("#")[0]), `Existing destination: ${link.href}`);
  assert.equal(link.getAttribute("aria-describedby"), "demoHandoffExplanation");
}
assert.equal(links[0].href, "/signal-network/#command-center", "Message opens the existing private messaging command center");
assert.equal(links[1].href, "/creator-network/#locked", "Guest collaboration enters login");
await links[0].emit("click");
assert.equal(f.get("demoProfileDialog").open, false, "Message handoff closes the profile without sending a message");
await opener.emit("click");
const cardFollow = findButton(f.get("demoCreators"), "Follow · demo");
const profileFollow = findButton(f.get("demoProfileContent"), "Follow · demo");
const beforeMetrics = descendants(f.get("demoProfileContent")).find(element => element.className === "demo-metrics").textContent;
await profileFollow.emit("click");
assert.equal(cardFollow.getAttribute("aria-pressed"), "true");
assert.equal(profileFollow.getAttribute("aria-pressed"), "true");
assert.equal(descendants(f.get("demoProfileContent")).find(element => element.className === "demo-metrics").textContent, beforeMetrics, "Never inflate sample follower counts");
await findButton(f.get("demoProfileContent"), "Request listing").emit("click");
assert.match(f.get("demoProfileStatus").textContent, /Demo unavailable/);
assert.match(f.get("demoProfileStatus").textContent, /No request, payment, license or download/);
await findButton(f.get("demoProfileContent"), "Review sample release").emit("click");
assert.match(f.get("demoProfileContent").textContent, /local-rules/);
assert.match(f.get("demoProfileContent").textContent, /Missing: Vocals/);
assert.match(f.get("demoProfileContent").textContent, /Rights remain unconfirmed/);
assert.match(f.get("demoProfileContent").textContent, /Illustrative price suggestion/);
await f.get("demoProfileClose").emit("click");
assert.equal(f.get("demoProfileDialog").open, false);
assert.equal(f.document.activeElement, opener, "Closing returns focus to the opening button");
f.get("demoSearch").value = "not-a-creator";
await f.get("demoSearch").emit("input");
assert.match(f.get("demoCreators").textContent, /No sample creators match/);
assert.match(f.get("demoResultCount").textContent, /^0 of/);
await f.get("demoFilters").emit("reset");
assert.equal(f.get("demoCreators").children.length, CREATOR_SEEDS.length);
f.get("demoGenre").value = "Soul";
await f.get("demoGenre").emit("change");
assert.equal(f.get("demoCreators").children.length, 1);
assert.match(f.get("demoCreators").textContent, /DJ Romy/);
await f.get("demoFilters").emit("reset");
f.get("workspace").hidden = false;
await findButton(f.get("demoCreators"), "Explore profile").emit("click");
const signedInLinks = descendants(f.get("demoProfileContent")).filter(element => element.tagName === "A");
assert.equal(signedInLinks[0].href, "/signal-network/#command-center");
assert.equal(signedInLinks[1].href, "/creator-network/#collaboration");
await signedInLinks[1].emit("click");
assert.equal(f.get("demoProfileDialog").open, false, "Same-page handoff closes the modal");

const persistentStorage = memoryStorage();
const firstVisit = fixture({ localStorage: persistentStorage });
await findButton(firstVisit.get("demoCreators"), "Follow · demo").emit("click");
const secondVisit = fixture({ localStorage: persistentStorage });
assert.equal(findButton(secondVisit.get("demoCreators"), "Following · demo").getAttribute("aria-pressed"), "true");
await findButton(secondVisit.get("demoCreators"), "Following · demo").emit("click");
assert.equal(readDemoFollows(persistentStorage).ids.size, 0);
const denied = fixture({ localStorage: brokenStorage });
assert.match(denied.get("demoDiscoveryStatus").textContent, /storage is unavailable/);
await findButton(denied.get("demoCreators"), "Follow · demo").emit("click");
assert.match(denied.get("demoDiscoveryStatus").textContent, /this page visit/);
assert.equal(denied.app.followed.size, 1, "Blocked storage does not block interaction");

const hostileName = '<img src=x onerror="alert(1)">';
for (const unsafeUrl of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]) {
  const hostile = fixture({
    creators: [{ ...CREATOR_SEEDS[0], displayName: hostileName, bio: "<script>unsafe</script>" }],
    listings: LISTING_SEEDS.map(listing => ({ ...listing, assetPreviewUrl: unsafeUrl }))
  });
  await findButton(hostile.get("demoCreators"), "Explore profile").emit("click");
  assert.equal(hostile.get("demoProfileTitle").textContent, hostileName);
  assert.equal(descendants(hostile.get("demoProfileContent")).some(element => ["IMG", "SCRIPT"].includes(element.tagName)), false);
  assert.deepEqual(descendants(hostile.get("demoProfileContent")).filter(element => element.tagName === "A").map(element => element.href), [
    "/signal-network/#command-center", "/creator-network/#locked", "/signal-network/", "/release-house/"
  ], `Unsafe preview ${unsafeUrl} creates no link; only known workspace destinations remain`);
}

const failure = fixture({ aiService: { reviewProject() { throw new Error("Unavailable"); } } });
await findButton(failure.get("demoCreators"), "Explore profile").emit("click");
const failureReview = findButton(failure.get("demoProfileContent"), "Review sample release");
await failureReview.emit("click");
assert.equal(failureReview.disabled, false);
assert.match(failure.get("demoProfileContent").textContent, /local demo advisory is unavailable/);

let resolveReview;
const pending = fixture({ aiService: { reviewProject: () => new Promise(resolve => { resolveReview = resolve; }) } });
await findButton(pending.get("demoCreators"), "Explore profile").emit("click");
const reviewPromise = findButton(pending.get("demoProfileContent"), "Review sample release").emit("click");
pending.get("demoProfileDialog").close();
await descendants(pending.get("demoOrbitTiers")).filter(element => element.tagName === "BUTTON")[1].emit("click");
resolveReview(HaloAIService.reviewProject({}));
await reviewPromise;
assert.equal(pending.get("demoProfileTitle").textContent, CREATOR_SEEDS[1].displayName);
assert.doesNotMatch(pending.get("demoProfileContent").textContent, /0\/100/, "A stale review cannot populate another profile");

console.log("Creator discovery contracts passed: disclosure, isolation, filters, dialog focus, local follows, Orbits, listings and advisory safety.");
