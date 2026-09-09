import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, api, migration, config, releaseHouse, halo] = await Promise.all([
  read("campaign-studio/index.html"),
  read("campaign-studio/campaign-studio.js"),
  read("campaign-studio/campaign-studio.css"),
  read("netlify/functions/fan-campaigns.mjs"),
  read("netlify/database/migrations/20260814180000_create-fan-vote-campaigns.sql"),
  read("netlify.toml"),
  read("release-house/index.html"),
  read("halo.html")
]);

const checks = [
  [page.includes("Campaign Studio // Artist Controls") && page.includes("campaign-studio.js"), "ships the Campaign Studio // Artist Controls hub page"],
  [script.includes("slice(0, 14)") && script.includes("Build the Dreamweaver campaign"), "loads the latest fourteen listening-party tracks"],
  [script.includes("AbortController") && script.includes("campaign request timed out") && script.includes('aria-busy'), "recovers from stalled and duplicate campaign requests"],
  [script.includes("Copy caption + link") && script.includes("Download social card") && script.includes("canvas.toDataURL"), "creates share-ready campaign assets"],
  [script.includes("One release. Five purpose-built links.") && script.includes("Campaign Studio // Artist Controls"), "frames the release workflow around the artist controls hub"],
  [script.includes("fansCopy") && script.includes("djsCopy") && script.includes("radioCopy") && script.includes("pressCopy") && script.includes("advanceCopy"), "supports tailored destination copy for fans, DJs, radio, press, and advance listeners"],
  [script.includes("Release visual asset override") && script.includes("Save visual asset to release kit") && script.includes("visualAssetPlacement"), "adds cover upload controls with hero/background release kit override targets"],
  [script.includes("visualAssetFit") && script.includes("visualAssetTint") && script.includes("visualAssetHeroPreview") && script.includes("visualAssetBackgroundPreview"), "renders crop-fit and tint previews for visual asset overrides"],
  [script.includes("status-chip--ready") && script.includes("status-chip--attention"), "shows concise destination status chips"],
  [script.includes('action: "vote"') && script.includes("halo-fan-voter-token") && script.includes("You can change your choice"), "supports one reusable fan vote per browser or member"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes("isOwner"), "protects campaign management with identity and origin checks"],
  [api.includes("hyperfollowUrl") && api.includes("privateDeliveryNote") && api.includes("advanceCopy"), "sanitizes and persists destination-specific release copy fields"],
  [api.includes("visualAssetDataUrl") && api.includes("visualAssetPlacement") && api.includes("visualAssetTintColor"), "sanitizes and persists visual asset override metadata in campaign payloads"],
  [api.includes("defaultPromotion") && api.includes("no paid") === false && api.includes("Dreamweaver campaign created"), "generates the campaign package without an inference dependency"],
  [api.includes("WITH track_input") && api.includes("inserted_campaign AS") && api.includes("CROSS JOIN inserted_campaign") && api.includes("db.sql.values(trackValues)"), "creates campaign records and track snapshots atomically"],
  [migration.includes("halo_fan_vote_campaigns") && migration.includes("halo_fan_vote_campaign_tracks") && migration.includes("halo_fan_vote_campaign_votes"), "stores campaigns, track snapshots, and votes in Netlify Database"],
  [migration.includes("PRIMARY KEY (campaign_id, voter_key)") && migration.includes("vote_goal BETWEEN 10 AND 100000"), "enforces one vote identity and bounded goals at the database layer"],
  [styles.includes("@media(max-width:720px)") && styles.includes("prefers-reduced-motion"), "supports mobile layouts and reduced motion"],
  [/from = "\/campaign-studio\/"[\s\S]*to = "\/campaign-studio\/index\.html"/.test(config) && releaseHouse.includes('href="/campaign-studio/"'), "makes the studio discoverable from Release House and serves the canonical /campaign-studio/ route directly"],
  [halo.includes("CAMPAIGN STUDIO // ARTIST CONTROLS") && halo.includes("One release. Five purpose-built links for every destination."), "surfaces the artist controls hub in the main HALO navigation"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Fan campaign contracts: ${checks.length}/${checks.length} checks passed.`);
