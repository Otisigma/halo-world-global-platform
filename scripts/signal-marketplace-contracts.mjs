import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CREATOR_SEEDS, LISTING_SEEDS, LISTING_TYPES } from "../lib/creator-marketplace.js";
import { MAX_STATE_BYTES, STORAGE_KEY, createLocalDraft, createLocalStore, filterListings, initMarketplace, publicPreviewUrl, sanitizeLocalState } from "../signal-network/marketplace.js";

let passed = 0;
async function check(label, test) {
  await test();
  passed++;
  console.log(`PASS: ${label}`);
}
const root = new URL("../", import.meta.url);
const [page, source, css] = await Promise.all([
  readFile(new URL("signal-network/index.html", root), "utf8"),
  readFile(new URL("signal-network/marketplace.js", root), "utf8"),
  readFile(new URL("signal-network/signal-network.css", root), "utf8")
]);
const input = {
  kind: "listing", title: "Local concept", description: "An illustrative collaboration.",
  listingType: "full_track", price: "10.50", currency: "USD",
  licenseType: "Proposed terms only", format: "WAV", assetPreviewUrl: ""
};
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};
let byteBoundaryState;

await check("public feed is separate from the unchanged member command center", () => {
  assert(page.indexOf('id="signal-feed"') < page.indexOf('id="command-center"'));
  assert(page.includes('id="networkGate"') && page.includes('id="signalWorkspace"'));
  assert(page.includes('src="/signal-network/marketplace.js"') && page.includes('src="/signal-network/signal-network.js"'));
  assert(page.includes("not live inventory") && page.includes("not ownership or rights claims"));
});
await check("persistent community and local marketplace coexist with unique IDs and module scripts", () => {
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(page, /<section[^>]+id="feed"[^>]*>[\s\S]*?id="feedPosts"[\s\S]*?<\/section>\s*<section[^>]+id="signal-feed"/);
  for (const script of ["signal-network", "signal-feed", "marketplace"]) {
    assert.equal((page.match(new RegExp(`type="module" src="/signal-network/${script}\\.js"`, "g")) || []).length, 1, `Load ${script} once as a module`);
  }
  for (const [, target] of page.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(target), `Signal navigation target exists: ${target}`);
  }
  let depth = 0;
  for (const brace of css.match(/[{}]/g) || []) {
    depth += brace === "{" ? 1 : -1;
    assert.ok(depth >= 0, "CSS blocks must not close before opening");
  }
  assert.equal(depth, 0, "Both feed styles close their own CSS blocks");
  assert.match(css, /\.signal-feed__reply \{ margin-left: \.3rem; \}\s*\}\s*\.signal-market/);
});
await check("all six shared types filter illustrative inventory", () => {
  assert.equal(LISTING_TYPES.length, 6);
  for (const type of LISTING_TYPES) {
    const filtered = filterListings(LISTING_SEEDS, type.id);
    assert(filtered.length > 0);
    assert(filtered.every(item => item.listingType === type.id));
  }
  assert.equal(filterListings(LISTING_SEEDS, "all").length, LISTING_SEEDS.length);
  assert(LISTING_SEEDS.every(item => item.isForSale === false));
  assert(CREATOR_SEEDS.length > 0);
});
await check("draft validation covers all six types and never asserts sale or ownership", () => {
  for (const type of LISTING_TYPES) {
    const draft = createLocalDraft({ ...input, listingType: type.id, creatorId: "dj-halo", isForSale: true });
    assert.equal(draft.listing.listingType, type.id);
    assert.equal(draft.listing.price, 10.5);
    assert.equal(draft.listing.isForSale, false);
    assert.equal(draft.listing.creatorId, "local-draft");
  }
  for (const price of ["", " ", -1, 1000001, "Infinity", "x", 0.001, "0x10", "1e2", "+12", "1.001"]) assert.throws(() => createLocalDraft({ ...input, price }));
  for (const patch of [{ title: " " }, { description: "" }, { title: "x".repeat(121) }, { listingType: "bad" }, { currency: "XXX" }, { licenseType: "" }, { format: "" }, { kind: "bad" }]) {
    assert.throws(() => createLocalDraft({ ...input, ...patch }));
  }
  for (const kind of ["text", "collaboration"]) {
    const draft = createLocalDraft({ kind, title: "<img src=x onerror=alert(1)>", description: "Text only" });
    assert.equal(draft.listing, undefined);
    assert.equal(draft.title, "<img src=x onerror=alert(1)>");
  }
});
await check("private, credentialed, executable and tokenized preview URLs are rejected", () => {
  const credentialed = new URL("https://example.com/a.mp3");
  credentialed.username = "demo";
  for (const url of ["javascript:alert(1)", "data:audio/wav;base64,abc", "//example.com/a.mp3", "/api/private", "http://example.com/a.mp3", credentialed.href, "https://example.com/a.mp3?token=secret", "https://example.com/a.mp3#secret", "https://localhost/audio", "https://127.0.0.1/audio", "https://192.168.1.1/audio", "https://[::1]/audio", "https://studio.local/audio"]) {
    assert.equal(publicPreviewUrl(url), "", url);
    assert.throws(() => createLocalDraft({ ...input, assetPreviewUrl: url }));
  }
  assert.equal(publicPreviewUrl("https://example.com/public.mp3"), "https://example.com/public.mp3");
});
await check("local storage is bounded, revalidated, persistent and independently clearable", () => {
  const storage = memory();
  storage.setItem("unrelated-member-state", "keep");
  const store = createLocalStore(storage);
  const draft = createLocalDraft(input, "draft-test-1");
  store.save({ saved: [LISTING_SEEDS[0].id, "unknown"], liked: [LISTING_SEEDS[1].id], drafts: [draft] });
  const restored = createLocalStore(storage);
  assert.deepEqual(restored.state, store.state);
  assert.equal(restored.state.saved.length, 1);
  assert.equal(sanitizeLocalState({ drafts: Array.from({ length: 35 }, (_, i) => createLocalDraft(input, `draft-test-${i}`)) }).drafts.length, 20);
  assert.equal(sanitizeLocalState({ drafts: [{ ...draft, listing: { ...draft.listing, assetPreviewUrl: "javascript:alert(1)" } }] }).drafts.length, 0);
  restored.clear();
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated-member-state"), "keep");
});
await check("blocked, corrupted and oversized storage cannot break the local feed", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  for (const storage of [blocked, undefined]) {
    const store = createLocalStore(storage);
    store.save({ saved: [LISTING_SEEDS[0].id], drafts: [], liked: [] });
    assert.equal(store.state.saved.length, 1);
    assert.equal(store.available, false);
    store.clear();
    assert.equal(store.state.saved.length, 0);
  }
  assert.equal(createLocalStore({ getItem: () => "{broken" }).state.drafts.length, 0);
  assert.equal(createLocalStore({ getItem: () => "x".repeat(100001) }).state.drafts.length, 0);
});
await check("save and reload enforce the same byte limit without losing existing drafts", () => {
  const storage = memory();
  const store = createLocalStore(storage);
  const initial = { saved: [], liked: [], drafts: [createLocalDraft(input, "draft-initial")] };
  store.save(initial);
  const large = {
    saved: [], liked: [],
    drafts: Array.from({ length: 20 }, (_, i) => createLocalDraft({
      ...input, title: "x".repeat(120), description: "x".repeat(2000),
      licenseType: "x".repeat(120), format: "x".repeat(80),
      assetPreviewUrl: `https://example.com/${"a".repeat(450)}`
    }, `draft-large-${i}`))
  };
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  assert(bytes(large) > MAX_STATE_BYTES);
  assert.throws(() => store.save(large), /storage limit reached.*not saved/);
  assert.deepEqual(store.state, initial);
  assert.deepEqual(createLocalStore(storage).state, initial);
  let excess = bytes(large) - MAX_STATE_BYTES;
  for (const draft of large.drafts) {
    const remove = Math.min(450, excess);
    if (remove) draft.listing.assetPreviewUrl = draft.listing.assetPreviewUrl.slice(0, -remove);
    excess -= remove;
  }
  assert.equal(excess, 0);
  assert.equal(bytes(large), MAX_STATE_BYTES);
  store.save(large);
  byteBoundaryState = large;
  assert.deepEqual(createLocalStore(storage).state, large);
  const prior = storage.getItem(STORAGE_KEY);
  assert.throws(() => store.save({ ...large, liked: [LISTING_SEEDS[0].id] }), /storage limit reached/);
  assert.equal(storage.getItem(STORAGE_KEY), prior);
  const unicode = { ...large, drafts: large.drafts.map(draft => ({ ...draft, title: draft.title.replace("x", "é") })) };
  assert.throws(() => store.save(unicode), /storage limit reached/);
  storage.setItem(STORAGE_KEY, JSON.stringify(unicode));
  assert.equal(createLocalStore(storage).state.drafts.length, 0);
});

// Minimal DOM harness exercises the real event handlers without new dependencies.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {}; this.value = ""; this.disabled = false; this.hidden = false; this.open = false; this._text = ""; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(" "); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async fire(type) { for (const listener of this.listeners[type] || []) await listener({ preventDefault() {} }); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return all;
    if (selector === "audio") return all.filter(item => item.tagName === "audio");
    const match = selector.match(/data-market-reaction="([^"]+)"/);
    return match ? all.filter(item => item.dataset.marketReaction === match[1]) : [];
  }
  showModal() { this.open = true; }
  close() { this.open = false; void this.fire("close"); }
  reset() {}
}
function documentHarness() {
  const elements = new Map([...page.matchAll(/id="(market[^"]*|signal-feed)"/g)].map(([, id]) => [id, new Element("div")]));
  const defaults = { marketTypeFilter: "all", marketDraftKind: "text", marketListingType: "full_track", marketPrice: "0", marketCurrency: "USD" };
  for (const [id, value] of Object.entries(defaults)) elements.get(id).value = value;
  elements.get("signal-feed").append(...[...elements.entries()].filter(([id]) => id !== "signal-feed").map(([, element]) => element));
  return { getElementById: id => elements.get(id), createElement: tag => new Element(tag) };
}
const doc = documentHarness();
const get = id => doc.getElementById(id);
globalThis.localStorage = memory();
const app = initMarketplace(doc);
const buttons = element => element.querySelectorAll("*").filter(child => child.tagName === "button");
await check("rendered cards include prices, featured badges and honest disabled missing previews", () => {
  assert.equal(get("marketFeed").children.length, LISTING_SEEDS.length);
  assert.equal(get("marketFeatured").children.length, LISTING_SEEDS.filter(item => item.isFeatured).length);
  assert(get("marketFeatured").textContent.includes("Featured demo"));
  assert(get("marketFeed").textContent.includes("Verified (demo)"));
  assert(get("marketFeed").textContent.includes("Format:"));
  assert(get("marketFeed").textContent.includes("Illustrative license:"));
  const profileLinks = get("marketFeed").querySelectorAll("*").filter(item => item.tagName === "a");
  assert.equal(profileLinks.length, LISTING_SEEDS.length);
  assert(profileLinks.every(link => link.href === "/creator-network/"));
  assert(buttons(get("marketFeed")).filter(item => item.disabled).length === LISTING_SEEDS.length);
  assert.equal(get("marketListingType").children.length, 6);
  assert(get("marketFeed").textContent.includes("$"));
});
await check("real filter, save and like handlers update local state and accessible pressed buttons", async () => {
  const save = buttons(get("marketFeed")).find(item => item.textContent === "Save locally");
  await save.fire("click");
  assert.equal(save.attributes["aria-pressed"], "true");
  assert.equal(createLocalStore(globalThis.localStorage).state.saved.length, 1);
  await save.fire("click");
  assert.equal(save.attributes["aria-pressed"], "false");
  const like = buttons(get("marketFeed")).find(item => item.textContent === "Like locally");
  await like.fire("click");
  assert.equal(like.attributes["aria-pressed"], "true");
  get("marketTypeFilter").value = "stem_pack";
  await get("marketTypeFilter").fire("change");
  assert.equal(get("marketFeed").children.length, filterListings(LISTING_SEEDS, "stem_pack").length);
});
await check("native detail dialog requests and buys never report successful operations", async () => {
  await buttons(get("marketFeed")).find(item => item.textContent === "View listing details").fire("click");
  assert.equal(get("marketDetail").open, true);
  assert(get("marketDetailBody").textContent.includes("No rights verified or granted"));
  await get("marketRequest").fire("click");
  assert(get("marketDetailStatus").textContent.includes("No request was sent"));
  await get("marketBuy").fire("click");
  assert(get("marketDetailStatus").textContent.includes("No purchase, payment, or license"));
  await get("marketDetailClose").fire("click");
  assert.equal(get("marketDetail").open, false);
});
await check("composer saves text safely, toggles optional sale fields and validates before drafting", async () => {
  await get("marketCompose").fire("click");
  assert.equal(get("marketComposer").open, true);
  get("marketTitle").value = "<img src=x onerror=alert(1)>";
  get("marketDescription").value = "Local text concept";
  await get("marketComposerForm").fire("submit");
  assert.equal(app.store.state.drafts.length, 1);
  assert(get("marketDrafts").textContent.includes("<img src=x onerror=alert(1)>"));
  assert.equal(get("marketDrafts").querySelectorAll("*").filter(item => item.tagName === "img").length, 0);
  get("marketDraftKind").value = "listing";
  await get("marketDraftKind").fire("change");
  assert.equal(get("marketSaleFields").disabled, false);
  assert.equal(get("marketSaleFields").hidden, false);
  await get("marketComposerForm").fire("submit");
  assert.equal(app.store.state.drafts.length, 1);
  assert(get("marketComposerStatus").textContent.includes("license"));
  get("marketLicense").value = "Proposed terms";
  get("marketFormat").value = "WAV";
  await get("marketComposerForm").fire("submit");
  assert.equal(app.store.state.drafts.length, 2);
  assert(app.store.state.drafts.every(item => !item.listing?.isForSale));
  await buttons(get("marketDrafts")).find(item => item.textContent === "Delete local draft").fire("click");
  assert.equal(app.store.state.drafts.length, 1);
});
await check("HALO Guide is explicitly local advisory and does not publish or alter drafts", async () => {
  const before = JSON.stringify(app.store.state);
  await get("marketGuide").fire("click");
  assert(get("marketGuideResult").textContent.includes("local-rules advisory"));
  assert(get("marketGuideResult").textContent.includes("Not actual AI or audio analysis"));
  assert(get("marketGuideResult").textContent.includes("Not a valuation"));
  assert.equal(JSON.stringify(app.store.state), before);
  await get("marketComposerForm").fire("input");
  assert.equal(get("marketGuideResult").textContent, "");
});
await check("clear action resets only marketplace local data", async () => {
  globalThis.localStorage.setItem("member", "untouched");
  await get("marketClear").fire("click");
  assert.deepEqual(app.store.state, { saved: [], liked: [], drafts: [] });
  assert.equal(globalThis.localStorage.getItem("member"), "untouched");
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEY), null);
});
await check("byte-limit errors are announced without falsely changing card reaction state", async () => {
  globalThis.localStorage = memory();
  const limitDoc = documentHarness();
  const limitApp = initMarketplace(limitDoc);
  limitApp.store.save(byteBoundaryState);
  limitApp.render();
  const before = JSON.stringify(limitApp.store.state);
  const save = buttons(limitDoc.getElementById("marketFeed")).find(item => item.textContent === "Save locally");
  await save.fire("click");
  assert(limitDoc.getElementById("marketStatus").textContent.includes("this change was not saved"));
  assert.equal(save.attributes["aria-pressed"], "false");
  assert.equal(JSON.stringify(limitApp.store.state), before);
  assert.deepEqual(createLocalStore(globalThis.localStorage).state, limitApp.store.state);
});
await check("denied storage getters do not block initialization or local reactions", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
  const privateDoc = documentHarness();
  initMarketplace(privateDoc);
  assert(privateDoc.getElementById("marketStatus").textContent.includes("page session"));
  await buttons(privateDoc.getElementById("marketFeed")).find(item => item.textContent === "Save locally").fire("click");
  assert(privateDoc.getElementById("marketStatus").textContent.includes("page session"));
  delete globalThis.localStorage;
});
await check("marketplace rendering has no HTML sinks, API calls or member identity coupling", () => {
  assert(!/\binnerHTML\b|\binsertAdjacentHTML\b|\beval\s*\(|\bfetch\s*\(|haloIdentity|\/api\//.test(source));
  assert(source.includes("textContent"));
  assert(page.includes('id="marketDetail" aria-labelledby="marketDetailTitle"'));
  assert(page.includes('id="marketComposer" aria-labelledby="marketComposerTitle"'));
  assert(css.includes(".signal-market__dialog::backdrop") && css.includes("prefers-reduced-motion") && css.includes("@media (max-width: 760px)"));
});
console.log(`Signal Marketplace contracts: ${passed}/${passed} checks passed.`);
