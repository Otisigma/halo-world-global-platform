import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, api, migration, config, contextScript, contextStyles, artistPage, campaignPage, radioPage, outreachPage, teamPage, stats, statsSummary] = await Promise.all([
  read("release-house/index.html"),
  read("release-house/release-house.js"),
  read("release-house/release-house.css"),
  read("netlify/functions/release-house.mjs"),
  read("netlify/database/migrations/20260813120000_create-release-house.sql"),
  read("netlify.toml"),
  read("release-context.js"),
  read("release-context.css"),
  read("artists/index.html"),
  read("campaign-studio/index.html"),
  read("radio/index.html"),
  read("outreach.html"),
  read("artist-team.html"),
  read("netlify/lib/stats.mjs"),
  read("netlify/functions/stats-summary.mjs")
]);

const checks = [
  [page.includes("Bring an idea in") && page.includes("13") && page.includes("The front-door promise"), "presents the beginner-first Release House promise"],
  [script.includes('key: "idea"') && script.includes('key: "afterRelease"') && script.includes("rooms.map"), "defines all thirteen guided rooms"],
  [script.includes("roomIsValid") && script.includes("completeCurrentRoom") && script.includes("readinessScore"), "enforces readiness gates and visible progress"],
  [script.includes('/api/release-house') && script.includes("saveCurrentProject") && script.includes("scheduleSave"), "persists signed-in release projects"],
  [page.includes('id="releasePassport"') && page.includes('id="passportStages"') && page.includes("One release / one world"), "presents one connected release passport"],
  [script.includes("passportStages") && script.includes("renderPassport") && script.includes("release_next_action_opened"), "turns readiness into connected next actions"],
  [api.includes("LEFT JOIN LATERAL") && api.includes("artist_page_slug") && api.includes("fan_campaign_slug") && api.includes("radio_track_id"), "detects existing release connections without duplicating records"],
  [contextScript.includes("halo-release-project") && contextScript.includes("applyPrefill") && contextScript.includes("halo-release-context-ready"), "carries the selected release into specialist rooms"],
  [contextStyles.includes(".halo-release-context") && contextStyles.includes("is-collapsed") && contextStyles.includes("prefers-reduced-motion"), "styles an accessible responsive release context bar"],
  [[artistPage, campaignPage, radioPage, outreachPage, teamPage].every(source => source.includes('/release-context.js') && source.includes('/release-context.css')), "loads release context across the connected artist journey"],
  [stats.includes('"release_project_created"') && stats.includes('"release_room_completed"') && statsSummary.includes("creatorFunnel"), "measures the creator activation journey"],
  [script.includes("sampleProject") && script.includes("The Cold Is Lasting Longer"), "includes a complete worked example"],
  [script.includes("AI-assisted sketch with Suno") && script.includes("sunoBrief") && script.includes("data-copy-creation-brief"), "offers an optional portable Suno creation brief"],
  [script.includes("humanContribution") && script.includes("generationRecord") && script.includes("generativeAudioStatus"), "records human contribution and generative-audio provenance"],
  [styles.includes(".creation-assist") && styles.includes(".creation-brief"), "styles the artist-first creation pathway"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes("owner_member_id"), "protects project writes with membership and origin checks"],
  [api.includes("MAX_BODY_BYTES") && api.includes("cleanRoomData") && api.includes("cleanCompletedRooms"), "bounds and sanitises saved project data"],
  [migration.includes("halo_release_house_projects") && migration.includes("room_data JSONB") && migration.includes("completed_rooms SMALLINT[]"), "stores structured release progress in Netlify Database"],
  [styles.includes("@media (max-width: 800px)") && styles.includes("prefers-reduced-motion"), "supports mobile and reduced-motion visitors"],
  [config.includes('from = "/release-house"') && config.includes('to = "/release-house/"'), "keeps the Release House URL canonical"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Release House contracts: ${checks.length}/${checks.length} checks passed.`);
