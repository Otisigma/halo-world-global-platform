import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, styles, script, handler, migration, config, campaign] = await Promise.all([
  read("youtube-studio/index.html"),
  read("youtube-studio/youtube-studio.css"),
  read("youtube-studio/youtube-studio.js"),
  read("netlify/functions/youtube-source-studio.mjs"),
  read("netlify/database/migrations/20260816220000_create-youtube-source-studio.sql"),
  read("netlify.toml"),
  read("campaign-studio/index.html")
]);

const checks = [
  [page.includes("YouTube Source Box — HALO") && page.includes("/youtube-studio/youtube-studio.js"), "ships the private YouTube source workspace"],
  [script.includes("Label | URL") && script.includes("data-source-choice") && script.includes('action: "add_sources"'), "loads and selects labeled channel, playlist, Short, and video links"],
  [script.includes('action: "generate_brief"') && script.includes("shortConcepts") && script.includes("channelUrl"), "creates source-grounded Shorts campaign packages with a channel destination"],
  [handler.includes('model = "gpt-5.2"') || handler.includes('MODEL = "gpt-5.2"'), "uses a Netlify AI Gateway supported campaign model"],
  [handler.includes("Never claim you watched or transcribed a source") && handler.includes("youtubeUrl"), "keeps generation grounded and restricts saved links to YouTube"],
  [handler.includes("getUser") && handler.includes("verifyRequestOrigin") && handler.includes("ensureMembership"), "protects the workspace with membership and same-origin checks"],
  [migration.includes("halo_youtube_sources") && migration.includes("halo_youtube_campaign_briefs") && migration.includes("halo_memberships(member_id)"), "persists private sources and generated briefs in Netlify Database"],
  [config.includes('from = "/youtube-studio"') && config.includes('for = "/youtube-studio*"'), "normalizes and protects the private route"],
  [campaign.includes('href="/youtube-studio/"'), "links the source box from Campaign Studio"],
  [styles.includes("prefers-reduced-motion") && styles.includes("@media(max-width:680px)"), "supports reduced motion and mobile layouts"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`YouTube source contracts: ${checks.length}/${checks.length} checks passed.`);
