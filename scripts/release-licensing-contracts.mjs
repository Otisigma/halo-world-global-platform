import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LICENSE_TIER_CATALOG,
  LICENSING_REVIEW_NOTE,
  normalizeLicensingTiers,
  normalizeLicensingVersions,
  resolveReleaseLicensing
} from "../netlify/lib/release-licensing.mjs";

const root = resolve(import.meta.dirname, "..");
const [catalogApi, musicClient, musicStyles, migration] = await Promise.all([
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8"),
  readFile(resolve(root, "music/music.css"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260929070000_add_release_licensing_tiers.sql"), "utf8")
]);

for (const tier of ["personal", "sync_standard", "sync_broadcast", "exclusive"]) {
  assert.ok(LICENSE_TIER_CATALOG[tier]?.label, `${tier} must be a known licence tier`);
}

const tiers = normalizeLicensingTiers(
  JSON.stringify([
    { id: "Personal Use", priceCents: "1299" },
    { id: "personal-use" },
    { id: "sync_standard", label: "Sync standard\n", summary: "Online sync", priceCents: -5 },
    { id: "", label: "" },
    { id: "exclusive", requiresRightsReview: false, currency: "gbp", audioUrl: "https://private.example/master.wav" }
  ])
);
assert.equal(tiers.length, 3, "licensing tiers must be de-duplicated and drop unusable entries");
assert.deepEqual(tiers.map(tier => tier.id), ["personal-use", "sync-standard", "exclusive"]);
assert.equal(tiers[0].priceCents, 1299, "tier prices must be normalized to integer cents");
assert.equal(tiers[1].priceCents, null, "negative tier prices must be rejected");
assert.equal(tiers[1].label, "Sync standard", "tier labels must be trimmed of control characters");
assert.equal(tiers[0].requiresRightsReview, true, "tiers must require rights review unless explicitly cleared");
assert.equal(tiers[2].currency, "GBP", "tier currency must be normalized to an ISO code");
assert.deepEqual(
  Object.keys(tiers[2]).sort(),
  ["currency", "id", "label", "priceCents", "requiresRightsReview", "summary"],
  "licensing tiers must only serialize selection metadata, never storage or audio fields"
);

const versions = normalizeLicensingVersions(["Sale master", "Sale master", "", { label: "Radio edit" }, null]);
assert.deepEqual(versions, [
  { id: "sale-master", label: "Sale master" },
  { id: "radio-edit", label: "Radio edit" }
], "versions must be de-duplicated and safely serialized");

const licensing = resolveReleaseLicensing({
  licensingTiers: [{ id: "personal" }],
  availableVersions: ["Sale master"],
  salePriceCents: 999,
  currency: "usd",
  purchaseUrl: "https://distrokid.com/hyperfollow/owenanthony/blessed"
});
assert.equal(licensing.enabled, true, "a release with tiers must enable licensing in the shop");
assert.equal(licensing.tiers[0].priceCents, 999, "tiers must fall back to the catalog sale price");
assert.equal(licensing.checkoutMode, "external_purchase_link", "checkout must stay abstract and link-driven");
assert.equal(licensing.reviewNote, LICENSING_REVIEW_NOTE);
assert.match(LICENSING_REVIEW_NOTE, /approval-gated/, "licensing language must match the artist-economy approval model");

const withoutTiers = resolveReleaseLicensing({ availableVersions: ["Sale master"] });
assert.equal(withoutTiers.enabled, false, "releases without licensing metadata must keep normal buy/support behavior");
assert.deepEqual(withoutTiers.tiers, []);
assert.equal(withoutTiers.checkoutMode, "artist_request");

assert.match(migration, /ALTER TABLE halo_release_campaigns/, "licensing metadata must extend the existing release campaign record");
assert.match(migration, /ADD COLUMN IF NOT EXISTS licensing_tiers JSONB/, "the licensing migration must be idempotent");

assert.match(catalogApi, /resolveReleaseLicensing/, "the release catalog API must serialize licensing metadata");
assert.match(catalogApi, /release\.licensing_tiers/, "the release catalog API must read licensing tiers from the release record");
assert.match(catalogApi, /version\.version_type = 'sale_master'/, "the canonical master copy lookup must stay intact");

assert.match(musicClient, /licensingMarkup\(release\)/, "the shop panel must render licensing choices");
assert.match(musicClient, /data-licensing-version/, "the shop must offer a track version selector");
assert.match(musicClient, /data-licensing-tier/, "the shop must offer a licence tier selector");
assert.match(musicClient, /applyLicensingSelection/, "licence selection must update the shop buy/support action");
assert.match(musicClient, /searchParams\.set\("license"/, "the selected licence must travel with the artist-approved purchase link");
assert.match(musicClient, /if \(!licensing\.enabled\) return "";/, "releases without licensing metadata must render the existing shop panel unchanged");
assert.match(musicClient, /Rights review and artist approval stay required/, "licence copy must stay rights-aware");
assert.match(musicStyles, /\.shop-licensing/, "licensing selection must have shop styling");
assert.match(musicStyles, /\.licensing-selects/, "licensing selects must be laid out for the shop panel");

console.log("Release licensing contracts passed.");
