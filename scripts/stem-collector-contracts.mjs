import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, api, deck] = await Promise.all([
  read("netlify/database/migrations/20260816160000_create-dj-stem-collectors.sql"),
  read("netlify/functions/stem-collector.mjs"),
  read("dj-deck.html")
]);

assert.match(api, /never overlap two lead vocals/i);
assert.match(api, /Never overlap both lead vocals/);
assert.match(api, /Only one bassline stays full at a time/);
assert.match(api, /beatSource/);

const checks = [
  [migration.includes("halo_dj_stem_collector_kits") && migration.includes("blueprint JSONB"), "stores private collector blueprints in Netlify Database"],
  [migration.includes("REFERENCES halo_memberships") && migration.includes("status IN ('ready', 'archived')"), "keeps collector kits member-owned and archivable"],
  [api.includes('model: "gpt-5.2"') && api.includes("new OpenAI()"), "uses a supported Netlify AI Gateway model"],
  [api.includes("ownedPacks") && api.includes("pack.member_id = ${memberId}"), "collects only the signed-in member's private stem packs"],
  [api.includes("deterministicBlueprint") && api.includes("refineBlueprint"), "keeps a deterministic safe fallback around AI refinement"],
  [deck.includes("Stem Collector") && deck.includes("Build transition kit"), "adds the collector workflow to the live DJ deck"],
  [deck.includes("One lead vocal at a time") && deck.includes("collector-vocal-rule"), "makes the vocal-separation rule visible in the booth"],
  [deck.includes("Arm this recipe") && deck.includes("armCollectorKit"), "lets the DJ arm a saved transition map"],
  [deck.includes("Room-sound bridge") && deck.includes("warehouse-tail"), "supports optional owned room textures for difficult handoffs"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Stem Collector contracts: ${checks.length}/${checks.length} checks passed.`);
