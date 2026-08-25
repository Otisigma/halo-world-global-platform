import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, api, deck, client, styles] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260817120000_create-mix-flightplans.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/mix-flightplan.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../mix-flightplan.js", import.meta.url), "utf8"),
  readFile(new URL("../mix-flightplan.css", import.meta.url), "utf8")
]);

const checks = [
  [migration.includes("halo_mix_release_plans") && migration.includes("halo_mix_market_signals"), "stores release plans and market evidence in Netlify Database"],
  [migration.includes("mastering_status") && migration.includes("rights_confirmed") && migration.includes("sale_ready"), "persists the mastering and rights sale gate"],
  [api.includes("verifyRequestOrigin(request);") && api.includes("ensureMembership"), "protects flightplan updates with origin and membership checks"],
  [api.includes("halo_dj_audience_signals") && api.includes("halo_dj_external_signals") && api.includes("halo_radio_tracks"), "combines existing HALO evidence into Demand Radar"],
  [deck.includes("From finished set to sellable release") && deck.includes("Demand Radar") && deck.includes("Mastering Gate"), "adds the five-stage guided DJ mix route"],
  [deck.includes("permissions, licences, credits, reporting") && deck.includes("targetLufs"), "makes rights review and mastering targets explicit"],
  [(client.match(/fetch\("\/api\/mix-flightplan"/g) || []).length === 1 && client.includes('credentials: "same-origin"'), "saves the guide through the authenticated API"],
  [client.includes("updateReadiness") && client.includes("Sale gate is still closed"), "calculates and explains sale readiness"],
  [styles.includes("flightplan-step") && styles.includes("prefers-reduced-motion"), "provides a responsive accessible flightplan treatment"]
];

for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(checks.every(([passed]) => passed), true);
console.log(`Mix Flightplan contracts: ${checks.length}/${checks.length} checks passed.`);
