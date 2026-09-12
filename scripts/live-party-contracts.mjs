import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, script, styles, campaignsApi, redirects, docs, partyCharter, operatingModel] = await Promise.all([
  read("live-party/index.html"),
  read("live-party/live-party.js"),
  read("live-party/live-party.css"),
  read("netlify/functions/fan-campaigns.mjs"),
  read("netlify.toml"),
  read("BROADCAST_SETUP.md"),
  read("HALO_PARTY_TEAM_CHARTER.md"),
  read("HALO_SITE_AI_OPERATING_MODEL.md")
]);

const checks = [
  [page.includes("Live Party Hub") && page.includes("/live-party/live-party.js"), "ships a dedicated live party hub page"],
  [script.includes("Dreamweave Live Party Venue") && script.includes("Ask the DJ. Keep the party moving."), "renders unified Dreamweave party and fan conversation copy"],
  [script.includes("/api/community") && script.includes('action: "message"') && script.includes('action: "report"') && script.includes('action: "reaction"'), "uses existing moderated community actions for live room interactions"],
  [script.includes("/api/fan-campaigns") && script.includes("Current mix board"), "surfaces campaign mix state for DJ booth view"],
  [script.includes("/api/broadcast-control") && script.includes("Internal room remains primary"), "keeps internal venue primary while exposing optional distribution hooks"],
  [script.includes("Free discovery with premium room upgrades") && script.includes("Free Discovery") && script.includes("Supporter") && script.includes("VIP"), "shows clear free/supporter/vip access tiers in live party UI"],
  [script.includes('data-action="premium"') && script.includes("unlocks this room option") && script.includes("Premium hook is not configured yet"), "includes premium lock messaging and monetization hook placeholders"],
  [styles.includes("data-party-atmosphere") && styles.includes("data-party-season"), "supports atmosphere and seasonal presentation hooks"],
  [styles.includes(".access-tier-list") && styles.includes(".premium-list"), "styles access-tier and premium lock surfaces"],
  [campaignsApi.includes("/live-party/?campaign="), "launch packs now point to the live party venue"],
  [/from = "\/live-party\/"[\s\S]*to = "\/live-party\/index\.html"/.test(redirects), "serves canonical /live-party/ route"],
  [docs.includes("Live Party access model") && docs.includes("partyTheme.monetizationHooks") && docs.includes("Recommended rollout"), "documents free-to-premium access model and rollout guidance"],
  [docs.includes("HALO_PARTY_TEAM_CHARTER.md"), "broadcast setup references party-team operating charter"],
  [partyCharter.includes("Free music base is permanent") && partyCharter.includes("Premium must be explicit") && partyCharter.includes("Internal-first venue"), "party-team charter codifies free-core, premium clarity, and internal-first standards"],
  [partyCharter.includes("Pre-launch (go/no-go)") && partyCharter.includes("During event (live operations)") && partyCharter.includes("Post-event (quality loop)"), "party-team charter includes practical event operations checklist"],
  [operatingModel.includes("### Halo Party Team") && operatingModel.includes("Live-party free-vs-premium, perk fairness, or launch-readiness dispute"), "ai operating model includes halo party team ownership and escalation path"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Live party contracts: ${checks.length}/${checks.length} checks passed.`);
