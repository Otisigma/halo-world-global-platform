import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [page, client, api, mixesApi, audioApi, migration, comparisonMigration] = await Promise.all([
  readFile(resolve(root, "mixes/index.html"), "utf8"),
  readFile(resolve(root, "mixes/mixes.js"), "utf8"),
  readFile(resolve(root, "netlify/functions/mix-reviews.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/mixes.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/mix-audio.mjs"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260818170000_create-mix-quality-reviews.sql"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260818220000_add-mix-original-comparisons.sql"), "utf8")
]);

assert.match(page, /A pass is not a bad score/);
assert.match(page, /Creative intent for reviewers/);
assert.match(page, /Moments to understand before changing/);
assert.match(page, /Break-by-break observation/);
assert.match(client, /passes excluded/);
assert.match(client, /Creator context — read before scoring/);
assert.match(api, /const reviewAreas = new Set/);
assert.match(api, /outcome === "abstain"/);
assert.match(api, /confidenceWeights/);
assert.match(api, /Only the HALO review team can submit quality decisions/);
assert.doesNotMatch(api, /finalDecisions = new Set\([^\n]*reject/);
assert.match(migration, /halo_mix_break_observations/);
assert.match(migration, /'abstain', 'blocker'/);
assert.match(migration, /review_intent/);
assert.match(mixesApi, /INSERT INTO halo_mix_review_cycles/);
assert.match(audioApi, /isOwner\(user\)/);
assert.match(page, /Original version for A\/B comparison/);
assert.match(client, /switchMixVersion/);
assert.match(client, /same timestamp for a direct A\/B check/);
assert.match(mixesApi, /originalAudioUrl/);
assert.match(audioApi, /version === "original"/);
assert.match(comparisonMigration, /original_blob_key/);

console.log("Mix quality review contracts: 22/22 checks passed.");
