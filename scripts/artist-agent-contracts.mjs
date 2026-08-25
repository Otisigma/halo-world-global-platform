import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIST_AGENT_MODEL,
  ARTIST_AGENT_ROLES,
  ARTIST_SYNTHESIS_AGENT,
  PLAN_TIER_DEFAULTS,
  groundRecommendation,
  momentumScore,
  normalizeAgentKeys
} from "../netlify/lib/artist-agents.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The team roster is the product. Each seat has to exist, and the critic has to be separate from the
// agents it reviews, or the "team" collapses back into a single opinionated prompt.
assert.deepEqual(Object.keys(ARTIST_AGENT_ROLES).sort(), ["amplifier", "circle", "manager", "scout"]);
assert.equal(ARTIST_SYNTHESIS_AGENT.key, "compass");
assert.ok(!Object.hasOwn(ARTIST_AGENT_ROLES, "compass"), "the critic must not review its own specialist finding");
for (const [key, role] of Object.entries(ARTIST_AGENT_ROLES)) {
  assert.ok(role.name && role.title && role.mission, `${key} needs a name, title, and mission`);
  assert.ok(role.categories.length, `${key} needs at least one category`);
}

const knownKeys = new Set(["followers.total", "plays.last30d", "activity.published30d"]);

// The grounding gate. A recommendation that cannot cite one of this artist's own recorded signals is
// generic advice, and generic advice is what makes an artist cancel in month two.
assert.equal(groundRecommendation({
  title: "Post more consistently",
  rationale: "Consistency builds an audience.",
  category: "content",
  priority: "high",
  expectedMetric: "More posts",
  signalKeys: [],
  dueDate: null
}, "amplifier", knownKeys), null, "an uncited recommendation must be dropped");

assert.equal(groundRecommendation({
  title: "Invented signal",
  rationale: "Cites a key that does not exist for this artist.",
  category: "audience",
  priority: "high",
  expectedMetric: "Nothing real",
  signalKeys: ["spotify.monthlyListeners"],
  dueDate: null
}, "circle", knownKeys), null, "a hallucinated signal key must be dropped");

const grounded = groundRecommendation({
  title: "Give the 40 existing followers a reason to return",
  rationale: "Follower count is recorded and retention has not been tested.",
  category: "audience",
  priority: "high",
  expectedMetric: "Returning followers over 30 days",
  signalKeys: ["followers.total", "spotify.monthlyListeners"],
  dueDate: "2026-09-01"
}, "circle", knownKeys);
assert.ok(grounded, "a cited recommendation must survive");
assert.deepEqual(grounded.signalKeys, ["followers.total"], "unknown keys are stripped, known keys are kept");
assert.equal(grounded.needsApproval, true, "every proposal stays behind approval");
assert.equal(grounded.dueDate, "2026-09-01");

assert.equal(groundRecommendation({
  title: "",
  rationale: "Missing a title.",
  category: "audience",
  priority: "low",
  expectedMetric: "",
  signalKeys: ["followers.total"],
  dueDate: null
}, "circle", knownKeys), null, "an empty title must be dropped");

// Momentum is deterministic so an artist can be told exactly what moved it.
const quietRoom = {
  followers: { total: 0, new7d: 0, new30d: 0, radioOptIn: 0 },
  plays: { last7d: 0, last30d: 0, rooms30d: 0, topTrack: null },
  activity: { published: 0, published30d: 0, daysSinceLast: null },
  releases: { published: 0, latestDate: null, daysSinceLatest: null },
  shows: { published: 0, subscribers: 0 },
  room: { views7d: 0, views30d: 0, visitors30d: 0 },
  page: { status: "draft", hasRelease: false, hasVideo: false }
};
const busyRoom = {
  followers: { total: 40, new7d: 6, new30d: 18, radioOptIn: 35 },
  plays: { last7d: 5, last30d: 22, rooms30d: 3, topTrack: { title: "Quicksand", plays: 9 } },
  activity: { published: 14, published30d: 5, daysSinceLast: 3 },
  releases: { published: 2, latestDate: "2026-07-03", daysSinceLatest: 39 },
  shows: { published: 1, subscribers: 12 },
  room: { views7d: 90, views30d: 320, visitors30d: 140 },
  page: { status: "published", hasRelease: true, hasVideo: true }
};
assert.equal(momentumScore(quietRoom), 0);
assert.equal(momentumScore(quietRoom), momentumScore(quietRoom), "the same signals must always produce the same score");
assert.ok(momentumScore(busyRoom) > momentumScore(quietRoom), "a room with real activity must score higher");
assert.ok(momentumScore(busyRoom) <= 100, "the score stays inside its bounds");

// Plans decide which seats an artist actually bought.
assert.deepEqual(normalizeAgentKeys(["scout", "nonsense"]), ["scout"]);
assert.deepEqual(normalizeAgentKeys([]).sort(), ["amplifier", "circle", "manager", "scout"]);
assert.deepEqual(normalizeAgentKeys(["scout", "scout"]), ["scout"], "duplicate seats collapse");
for (const [tier, defaults] of Object.entries(PLAN_TIER_DEFAULTS)) {
  assert.ok(defaults.monthlyRunAllowance > 0, `${tier} needs a run allowance`);
  assert.deepEqual(normalizeAgentKeys(defaults.agents), defaults.agents, `${tier} lists real agents`);
}
assert.ok(
  PLAN_TIER_DEFAULTS.starter.monthlyRunAllowance < PLAN_TIER_DEFAULTS.solo.monthlyRunAllowance
    && PLAN_TIER_DEFAULTS.solo.monthlyRunAllowance < PLAN_TIER_DEFAULTS.pro.monthlyRunAllowance
    && PLAN_TIER_DEFAULTS.pro.monthlyRunAllowance < PLAN_TIER_DEFAULTS.label.monthlyRunAllowance,
  "paid tiers must buy strictly more capacity than the tier below"
);

const libSource = await readFile(resolve(root, "netlify/lib/artist-agents.mjs"), "utf8");
const functionSource = await readFile(resolve(root, "netlify/functions/artist-agents.mjs"), "utf8");
const migrationSource = await readFile(resolve(root, "netlify/database/migrations/20260812160000_create-artist-agent-teams.sql"), "utf8");
const pageSource = await readFile(resolve(root, "artist-team.html"), "utf8");
const scheduledSource = await readFile(resolve(root, "netlify/functions/artist-agent-weekly.mjs"), "utf8");

// Only models the AI Gateway actually serves.
assert.equal(ARTIST_AGENT_MODEL, "gpt-5.4-mini");

// Authority boundary: the team proposes, a human disposes.
assert.match(libSource, /You produce proposals and drafts only\./);
assert.match(libSource, /never publish, post, send, spend, sign, contract, or contact anyone/);
assert.ok(libSource.includes("needsApproval: true"), "recommendations are created needing approval");
assert.match(migrationSource, /CHECK \(status NOT IN \('approved', 'published'\) OR approved_by_member_id IS NOT NULL\)/);
assert.match(migrationSource, /external_publishing_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
assert.match(pageSource, /It does not post to any outside platform on your behalf/);
assert.match(pageSource, /BACKSTAGE OPERATING DECK/);
assert.match(pageSource, /Private artist room/);
for (const seat of ["Scout", "Steer", "Echo", "Circle", "Compass"]) {
  assert.match(pageSource, new RegExp(`>${seat}<`), `${seat} must appear in the operating deck`);
}

// Fan-facing words carry a disclosure by default.
assert.match(migrationSource, /disclosure TEXT NOT NULL DEFAULT 'Drafted by this artist''s HALO agent team and approved by a human before publishing\.'/);

// Tenancy: every scoped table keys on the artist and every write path filters by it.
for (const table of ["runs", "findings", "actions", "drafts", "memory"]) {
  assert.match(migrationSource, new RegExp(`halo_artist_agent_${table}`), `halo_artist_agent_${table} must exist`);
}
assert.match(migrationSource, /artist_slug TEXT NOT NULL REFERENCES halo_artist_pages\(slug\) ON DELETE CASCADE/);
assert.ok(libSource.includes("WHERE id = ${id} AND artist_slug = ${slug}"), "action and draft updates must be scoped to the artist");
assert.match(functionSource, /This agent team belongs to another artist room/);
assert.ok(functionSource.includes("verifyRequestOrigin"), "mutations verify request origin");

// Metering: a plan cannot be priced against a cost nobody records.
assert.match(migrationSource, /input_tokens INTEGER NOT NULL DEFAULT 0/);
assert.match(migrationSource, /output_tokens INTEGER NOT NULL DEFAULT 0/);
assert.ok(libSource.includes("prompt_tokens") && libSource.includes("completion_tokens"), "token usage is captured from the model response");
assert.ok(libSource.includes("reserveArtistRun"), "runs are reserved against the plan allowance");
assert.ok(functionSource.includes("reserveArtistRun"), "the manual run path reserves quota before spending inference");
assert.ok(scheduledSource.includes("reserveArtistRun"), "the scheduled path reserves quota before spending inference");
assert.match(functionSource, /This plan has used its runs for the current period/);

// Migrations that were already applied stay untouched; this one is additive.
assert.ok(!/DROP TABLE|DROP COLUMN|ALTER TABLE .* DROP/i.test(migrationSource), "the migration must be additive");

console.log("Artist agent team contracts passed");
