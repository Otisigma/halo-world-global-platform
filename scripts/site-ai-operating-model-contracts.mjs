import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { allowedEvents, cleanIdentifier, cleanMetadata, cleanPagePath } from "../netlify/lib/stats.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [
  handbook,
  paymentLink,
  mixReviews,
  fanCampaigns,
  fanCampaignMigration,
  releasePack,
  dreamweaverLib,
  dreamweaverCampaigns,
  dreamweaverMonitor,
  dreamweaverJobsMigration,
  haloRelations,
  haloRelationsMigration,
  maintenanceSweep,
  healthScout,
  siteMonitor,
  statsLib,
  statsEvents,
  statsSummary,
  ciWorkflow,
] = await Promise.all([
  read("HALO_SITE_AI_OPERATING_MODEL.md"),
  read("netlify/functions/payment-link.mjs"),
  read("netlify/functions/mix-reviews.mjs"),
  read("netlify/functions/fan-campaigns.mjs"),
  read("netlify/database/migrations/20260814180000_create-fan-vote-campaigns.sql"),
  read("netlify/functions/release-pack.mjs"),
  read("netlify/lib/dreamweaver-campaigns.mjs"),
  read("netlify/functions/dreamweaver-campaigns.mjs"),
  read("netlify/functions/dreamweaver-campaign-monitor.mjs"),
  read("netlify/database/migrations/20260816210000_add-dreamweaver-background-jobs.sql"),
  read("netlify/functions/halo-relations.mjs"),
  read("netlify/database/migrations/20260807190000_create-halo-relations.sql"),
  read("netlify/lib/maintenance-sweep.mjs"),
  read("netlify/functions/health-scout.mjs"),
  read("site-monitor.js"),
  read("netlify/lib/stats.mjs"),
  read("netlify/functions/stats-event.mjs"),
  read("netlify/functions/stats-summary.mjs"),
  read(".github/workflows/ci.yml"),
]);

// Handbook implementation sections exist.
assert.match(handbook, /## Implementation map \(code \+ contract anchors\)/, "handbook must define implementation anchors");
assert.match(handbook, /## Domain teams with explicit "cannot-do" guardrails/, "handbook must define domain cannot-do guardrails");
assert.match(handbook, /## Shared evidence and learning loop/, "handbook must define shared evidence loop");

// Payments and rights readiness gates remain server-enforced.
assert.match(paymentLink, /master_approved/, "checkout readiness must require master approval");
assert.match(paymentLink, /product_info_complete/, "checkout readiness must require product info");
assert.match(paymentLink, /rights_clearance_status/, "checkout readiness must require rights clearance");
assert.match(paymentLink, /verifyRequestOrigin/, "checkout mutation must verify request origin");
assert.match(mixReviews, /rights_credits/, "paid mix approval must include rights review area");
assert.match(mixReviews, /release_readiness/, "paid mix approval must include release readiness area");

// Supporter reward and voting integrity constraints remain in place.
assert.match(fanCampaignMigration, /PRIMARY KEY \(campaign_id, voter_key\)/, "fan campaigns must enforce one vote identity key");
assert.match(fanCampaigns, /starts_at <= NOW\(\) AND ends_at > NOW\(\)/, "fan campaigns must enforce voting window");
assert.match(fanCampaigns, /owner_member_id/, "fan campaign updates must remain owner-scoped");
assert.match(releasePack, /allowedStatuses\s*=\s*new\s+Set/, "release pack must declare bounded selector response statuses");
for (const status of ["interested", "downloaded", "played", "declined"]) {
  assert.match(releasePack, new RegExp(`\"${status}\"|\'${status}\'`), `release pack must include ${status} selector status`);
}

// Dreamweaver must stay grounded and fallback-safe.
assert.match(dreamweaverLib, /Never invent external platform results\./, "Dreamweaver review must forbid fabricated external metrics");
assert.match(dreamweaverLib, /usedFallback/, "Dreamweaver generation must preserve fallback signaling");
assert.match(dreamweaverCampaigns, /halo_dreamweaver_campaign_jobs/, "Dreamweaver generation must persist background jobs");
assert.match(dreamweaverMonitor, /reviewCampaignEvidence/, "Dreamweaver monitor must run evidence review");
assert.match(dreamweaverJobsMigration, /status IN \('queued', 'working', 'ready', 'failed'\)/, "Dreamweaver jobs must keep bounded lifecycle statuses");

// CRN/relationship integrity safeguards remain enforced.
assert.match(haloRelations, /contactConsent/, "relationship drafting must require explicit contact consent");
assert.match(haloRelations, /verifyRequestOrigin/, "relationship mutations must verify request origin");
assert.match(haloRelations, /isOwner\(user\)/, "relationship workspace must remain owner-only");
assert.match(haloRelationsMigration, /assistant_role IN \('welcome', 'relationship', 'community', 'creator', 'support'\)/, "relationship drafts must keep bounded assistant roles");

// Monitoring and incident reconciliation remains automatic.
assert.match(maintenanceSweep, /reconcileIssue/, "maintenance sweeps must reconcile recurring issues");
assert.match(maintenanceSweep, /reportIssue/, "maintenance sweeps must report failed checks");
assert.match(maintenanceSweep, /resolveIssue/, "maintenance sweeps must resolve recovered checks");
assert.match(healthScout, /schedule:\s*["']\*\/15\s+\*\s+\*\s+\*\s+\*["']/, "health scout must run every 15 minutes");
assert.match(siteMonitor, /\/api\/issues/, "browser scout must report issues to intake API");

// Shared evidence loop stays bounded, allowlisted, and protected.
assert.match(statsLib, /allowedEvents = new Set/, "stats library must keep event allowlist");
assert.match(statsLib, /allowedMetadataKeys = new Set/, "stats library must keep metadata allowlist");
assert.match(statsEvents, /Cross-origin events are not accepted/, "stats ingestion must reject cross-origin events");
assert.match(statsSummary, /STATS_ADMIN_TOKEN/, "stats summary must remain admin-token protected");

// CI must keep contract and deploy feedback checks active.
assert.match(ciWorkflow, /npm run deploy:feedback/, "CI must execute deploy feedback contracts");
assert.match(ciWorkflow, /docker build -t halo-world:ci \./, "CI must keep docker smoke coverage for deployability");

// Behavior-focused telemetry guardrail checks.
assert.ok(allowedEvents.has("payment_checkout_started"), "telemetry must accept checkout-start event");
assert.equal(cleanIdentifier("abc12345_XY"), "abc12345_XY", "identifier sanitization must preserve valid IDs");
assert.equal(cleanIdentifier("bad id"), "", "identifier sanitization must reject invalid IDs");
assert.equal(cleanPagePath("/music/?x=1#hash"), "/music/", "page-path sanitization must strip query and hash");
assert.deepEqual(cleanMetadata({
  seconds: 999999,
  position: -42,
  target: "hero",
  unknown: "drop-me"
}), {
  seconds: 86400,
  position: 0,
  target: "hero"
}, "metadata sanitization must clamp numeric values and drop unknown keys");

console.log("Site AI operating model contracts passed.");
