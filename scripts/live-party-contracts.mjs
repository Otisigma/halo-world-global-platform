import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, script, styles, campaignsApi, redirects, docs] = await Promise.all([
  read("live-party/index.html"),
  read("live-party/live-party.js"),
  read("live-party/live-party.css"),
  read("netlify/functions/fan-campaigns.mjs"),
  read("netlify.toml"),
  read("BROADCAST_SETUP.md")
]);

const checks = [
  [page.includes("Live Party Hub") && page.includes("/live-party/live-party.js"), "ships a dedicated live party hub page"],
  [script.includes("Dreamweave Live Party Venue") && script.includes("Ask the DJ. Keep the party moving."), "renders unified Dreamweave party and fan conversation copy"],
  [script.includes("/api/community") && script.includes('action: "message"') && script.includes('action: "report"') && script.includes('action: "reaction"'), "uses existing moderated community actions for live room interactions"],
  [script.includes("/api/fan-campaigns") && script.includes("Current mix board"), "surfaces campaign mix state for DJ booth view"],
  [script.includes("/api/broadcast-control") && script.includes("Internal room remains primary"), "keeps internal venue primary while exposing optional distribution hooks"],
  [styles.includes("data-party-atmosphere") && styles.includes("data-party-season"), "supports atmosphere and seasonal presentation hooks"],
  [campaignsApi.includes("/live-party/?campaign="), "launch packs now point to the live party venue"],
  [/from = "\/live-party\/"[\s\S]*to = "\/live-party\/index\.html"/.test(redirects), "serves canonical /live-party/ route"],
  [docs.includes("/live-party/") && docs.includes("optional"), "documents internal-first venue and optional external relay"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Live party contracts: ${checks.length}/${checks.length} checks passed.`);
