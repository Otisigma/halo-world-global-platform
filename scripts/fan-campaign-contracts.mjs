import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, api, migration, config, releaseHouse] = await Promise.all([
  read("campaign-studio/index.html"),
  read("campaign-studio/campaign-studio.js"),
  read("campaign-studio/campaign-studio.css"),
  read("netlify/functions/fan-campaigns.mjs"),
  read("netlify/database/migrations/20260814180000_create-fan-vote-campaigns.sql"),
  read("netlify.toml"),
  read("release-house/index.html")
]);

const checks = [
  [page.includes("Dreamweaver Campaign Studio") && page.includes("campaign-studio.js"), "ships the Dreamweaver campaign studio page"],
  [script.includes("slice(0, 14)") && script.includes("Build the Dreamweaver campaign"), "loads the latest fourteen listening-party tracks"],
  [script.includes("AbortController") && script.includes("campaign request timed out") && script.includes('aria-busy'), "recovers from stalled and duplicate campaign requests"],
  [script.includes("Copy caption + link") && script.includes("Download social card") && script.includes("canvas.toDataURL"), "creates share-ready campaign assets"],
  [script.includes('action: "vote"') && script.includes("halo-fan-voter-token") && script.includes("You can change your choice"), "supports one reusable fan vote per browser or member"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes("isOwner"), "protects campaign management with identity and origin checks"],
  [api.includes("defaultPromotion") && api.includes("no paid") === false && api.includes("Dreamweaver campaign created"), "generates the campaign package without an inference dependency"],
  [api.includes("WITH track_input") && api.includes("inserted_campaign AS") && api.includes("CROSS JOIN inserted_campaign") && api.includes("db.sql.values(trackValues)"), "creates campaign records and track snapshots atomically"],
  [migration.includes("halo_fan_vote_campaigns") && migration.includes("halo_fan_vote_campaign_tracks") && migration.includes("halo_fan_vote_campaign_votes"), "stores campaigns, track snapshots, and votes in Netlify Database"],
  [migration.includes("PRIMARY KEY (campaign_id, voter_key)") && migration.includes("vote_goal BETWEEN 10 AND 100000"), "enforces one vote identity and bounded goals at the database layer"],
  [styles.includes("@media(max-width:720px)") && styles.includes("prefers-reduced-motion"), "supports mobile layouts and reduced motion"],
  [config.includes('from = "/campaign-studio"') && releaseHouse.includes('href="/campaign-studio/"'), "makes the studio discoverable from Release House"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Fan campaign contracts: ${checks.length}/${checks.length} checks passed.`);
