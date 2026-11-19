import assert from "node:assert/strict";
import { buildShopBlueprint } from "../netlify/lib/shop-blueprint.mjs";

const db = { async sql(strings) {
  const q = strings.join("?");
  assert.doesNotMatch(q, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
  if (q.includes("halo_stem_packs")) throw new Error("missing");
  if (q.includes("sale_enabled)::int AS sale_enabled")) return [{ sale_enabled: 4, alt_mixes: 1, sale_masters: 2, songs_on_sale: 3 }];
  if (q.includes("FROM halo_stripe_purchase_events")) return [{ live: 2, test: 5 }];
  if (q.includes("AS reached,")) return [{ reached: 1, reached_month: 1, votes_week: 12 }];
  if (q.includes("AS gallery_videos")) return [{ gallery_videos: 2, promo_cuts: 0, track_videos: 0, songs: 6, snippets: 0 }];
  if (q.includes("AS observed_versions")) return [{ observed_versions: 3, verified: 2, published: 0, failed: 1, on_sale: 3 }];
  if (q.includes("AS open_queries")) return [{ open_queries: 1, open_issues: 0, past_due: 0 }];
  return [{}];
}};

const b = await buildShopBlueprint(db, { now: new Date("2026-11-19T10:00:00Z") });
assert.equal(b.workstreams.length, 8);
assert.deepEqual(b.workstreams.map(w => w.id), ["direct-shop", "milestone-merch", "video-tech", "smart-discovery", "provenance-badges", "stripe-runner-alerts", "fast-onboarding", "unified-roster"]);
assert.equal(b.coverage.total, 12);
assert.equal(b.coverage.available, 11);
const shop = b.workstreams[0];
assert.equal(shop.stage, "live");
assert.equal(shop.signals.find(s => s.label.startsWith("Stem packs")).value, null, "unreadable source must not read as zero");
assert.equal(b.workstreams[1].stage, "foundation");
assert.equal(b.workstreams[2].stage, "foundation");
assert.equal(b.workstreams[4].stage, "foundation");
assert.ok(b.workstreams[4].signals.find(s => s.label === "Failed snapshots").flag);
assert.equal(b.workstreams[5].stage, "partial");
for (const w of b.workstreams) {
  assert.ok(w.tasks.length >= 3 && w.checkIns.length >= 2 && w.surfaces.length >= 1, w.id);
  for (const s of w.surfaces) assert.match(s.href, /^\/[a-z]/);
}
assert.equal(b.nextUp.length, 3);
assert.ok(b.nextUp.every(n => b.workstreams.find(w => w.id === n.id).stage !== "live"));
assert.equal(b.nextUp[0].id, "stripe-runner-alerts", "closest-to-live items come first");

// A failing source makes the dependent stage unknown rather than guessed.
const broken = await buildShopBlueprint({ async sql() { throw new Error("down"); } });
assert.equal(broken.coverage.available, 0);
assert.ok(broken.workstreams.every(w => w.stage === "unknown"));
assert.equal(broken.nextUp.length, 0);
console.log("shop blueprint contracts passed");
