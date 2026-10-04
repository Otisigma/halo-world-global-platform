import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CREATOR_SEEDS, LISTING_SEEDS, LISTING_TYPES, ORBIT_TIERS, normalizeListing, safeAssetUrl, formatListingPrice } from "../lib/creator-marketplace.js";
import { HaloAIService } from "../lib/halo-ai-service.js";

assert.deepEqual(CREATOR_SEEDS.map(creator => creator.displayName), ["DJ Halo", "DJ Butterfly", "DJ Romy"]);
assert.equal(new Set(LISTING_TYPES.map(type => type.id)).size, 6);
assert.equal(ORBIT_TIERS.length, 4);
assert.deepEqual(new Set(LISTING_SEEDS.map(listing => listing.listingType)), new Set(LISTING_TYPES.map(type => type.id)));
for (const creator of CREATOR_SEEDS) {
  assert.ok(ORBIT_TIERS.some(tier => tier.id === creator.tier));
  assert.ok(creator.featuredListings.every(id => LISTING_SEEDS.some(listing => listing.id === id && listing.creatorId === creator.id)));
}
for (const listing of LISTING_SEEDS) {
  assert.equal(listing.isForSale, false, "Sample inventory must never authorize checkout");
  assert.equal(listing.assetPreviewUrl, "", "No invented media URLs");
  assert.ok(CREATOR_SEEDS.some(creator => creator.id === listing.creatorId));
}
const listing = { title: "Test", listingType: "full_track", price: 12, currency: "USD" };
assert.equal(normalizeListing({ ...listing, isForSale: true }).isForSale, false);
assert.equal(normalizeListing({ ...listing, price: "12.50" }).price, 12.5);
for (const price of ["", " ", null, true, NaN, Infinity, -1, 1.001, "0x10", "1e2", 1000001]) {
  assert.throws(() => normalizeListing({ ...listing, price }));
}
for (const patch of [{ title: "" }, { listingType: "unknown" }, { currency: "ZZZ" }, { description: {} }, { assetPreviewUrl: "javascript:alert(1)" }]) {
  assert.throws(() => normalizeListing({ ...listing, ...patch }));
}
for (const url of ["javascript:alert(1)", "data:audio/wav;base64,abc", "//evil.test/x", "http://halo.test/x", "/\\evil.test/x", "******halo.test/x", "/api/private", "/.netlify/identity/token", "/music/\nfile.mp3"]) {
  assert.equal(safeAssetUrl(url), "", url);
}
assert.equal(safeAssetUrl("/media/preview.mp3"), "/media/preview.mp3");
assert.equal(safeAssetUrl("https://example.test/preview.mp3"), "https://example.test/preview.mp3");
assert.equal(formatListingPrice({ price: NaN }), "Price on request");
assert.ok(formatListingPrice(listing).includes("12"));

const ready = {
  completion: 100, stems: [{ name: "Drums", format: "WAV", validated: true }], requiredStems: ["Drums"],
  splits: [{ name: "A", share: 50, confirmed: true }, { name: "B", share: 50, confirmed: true }],
  rightsConfirmed: true
};
assert.equal(HaloAIService.reviewProject(ready).score, 100);
assert.equal(HaloAIService.reviewProject(ready).status, "ready-for-human-review");
assert.equal(HaloAIService.reviewProject({}).score, 0);
assert.equal(HaloAIService.reviewProject(null).source, "local-rules");
assert.equal(HaloAIService.reviewProject({ completion: "100", rightsConfirmed: "true" }).score, 0);
assert.equal(HaloAIService.reviewProject({ ...ready, completion: Infinity }).score, 60);
assert.equal(HaloAIService.reviewProject({ ...ready, rightsConfirmed: false }).status, "needs-work");
assert.equal(HaloAIService.validateStems([], []).valid, false);
assert.equal(HaloAIService.validateStems(null, []).valid, false);
assert.equal(HaloAIService.validateStems(ready.stems, ["Bass"]).missing[0], "Bass");
assert.equal(HaloAIService.validateStems([...ready.stems, ...ready.stems], []).valid, false);
assert.equal(HaloAIService.validateStems([{ name: "Bass", format: "MP3", validated: true }]).valid, false);
assert.equal(HaloAIService.validateStems([{ name: "Bass", format: "FLAC", validated: false }]).valid, false);
assert.equal(HaloAIService.verifyFiftyFiftySplit(ready.splits).valid, true);
for (const splits of [[], null, [{ name: "A", share: 100 }], [{ name: "A", share: 50, confirmed: true }, { name: "a", share: 50, confirmed: true }],
  [{ name: "A", share: 60, confirmed: true }, { name: "B", share: 40, confirmed: true }],
  [{ name: "A", share: "50", confirmed: true }, { name: "B", share: 50, confirmed: true }]]) {
  assert.equal(HaloAIService.verifyFiftyFiftySplit(splits).valid, false);
}
assert.equal(HaloAIService.suggestListing({ stems: [{}, {}] }).suggestedListingType, "stem_pack");
assert.equal(HaloAIService.suggestListing(null).suggestedListingType, "full_track");
assert.equal(HaloAIService.suggestListing({ listingType: "exclusive_license" }).suggestedPrice, 500);
assert.equal(HaloAIService.councilReview(ready).recommendations.length, 3);
assert.ok(HaloAIService.reviewProject(ready).nextSteps.some(step => step.includes("human")));

const creatorPage = await readFile(new URL("../creator-network/index.html", import.meta.url), "utf8");
const signalPage = await readFile(new URL("../signal-network/index.html", import.meta.url), "utf8");
for (const page of [creatorPage, signalPage]) {
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Demo and connected surfaces must not share DOM IDs");
}
assert.match(creatorPage, /id="haloOrbits"[^>]*aria-labelledby="demoOrbitsTitle"/);
assert.match(creatorPage, /id="orbits"[^>]*aria-labelledby="orbitsTitle"/);
for (const id of ["publicDirectory", "locked", "workspace", "guardianForm", "demoDiscovery", "demoProfileDialog"]) {
  assert.ok(creatorPage.includes(`id="${id}"`), `Preserve creator surface ${id}`);
}
for (const module of ["network", "discovery"]) {
  assert.ok(creatorPage.includes(`type="module" src="/creator-network/${module}.js"`));
}
for (const id of ["feed", "feedPublishForm", "feedNotifications", "feedBlocked", "command-center", "signal-feed", "marketComposer"]) {
  assert.ok(signalPage.includes(`id="${id}"`), `Preserve Signal surface ${id}`);
}
for (const module of ["signal-network", "signal-feed", "marketplace"]) {
  assert.ok(signalPage.includes(`type="module" src="/signal-network/${module}.js"`));
}
assert.match(signalPage, /href="\/signal-network\/#feed">Public feed/);
assert.match(signalPage, /href="#signal-feed">Demo marketplace/);
assert.match(signalPage, /Demo only: no purchases, licenses, messages, or server-side publishing/);
console.log("Creator marketplace and Studio Guardian contracts passed.");
