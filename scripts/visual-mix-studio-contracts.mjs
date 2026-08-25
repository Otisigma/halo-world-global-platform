import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, api, migration, packageMigration] = await Promise.all([
  read("mixes/index.html"),
  read("mixes/mixes.js"),
  read("mixes/mixes.css"),
  read("netlify/functions/visual-mixes.mjs"),
  read("netlify/database/migrations/20260818210000_create-visual-mix-studio.sql"),
  read("netlify/database/migrations/20260818230000_add-complete-venue-package.sql")
]);

const checks = [
  [page.includes('id="visual-studio"') && page.includes("Dreamweaver Visual Mix Studio"), "adds the visual studio to the Mixes experience"],
  [page.includes("Complete venue package") && page.includes("Logo edition") && page.includes("Hybrid edition") && page.includes("Full visual edition"), "offers a complete venue package alongside the focused audiovisual tiers"],
  [page.includes('id="complete-package"') && page.includes("Phone") && page.includes("DJ booth") && page.includes("Venue screens"), "explains the complete workflow across the full device chain"],
  [page.includes('id="visualScreen"') && page.includes('id="visualTimeline"'), "provides a screen preview and synchronized timeline"],
  [script.includes('/api/visual-mixes') && script.includes("buildVisualMix"), "connects the visual studio to its protected API"],
  [script.includes("sourceVideoIds") && script.includes("Dreamweaver is mapping the complete recording"), "combines owned source videos with generated coverage"],
  [page.includes("DJ mix test video preload") && script.includes('value="${escapeHtml(video.id)}" checked'), "preloads every eligible library video into the DJ mix test"],
  [script.includes("downloadVisualBrief") && script.includes("render-brief.json"), "exports a production-ready scene brief"],
  [styles.includes(".visual-screen-orbit") && styles.includes('.visual-scene[data-source="dreamweaver"]'), "distinguishes generated, branded, and supplied visual material"],
  [styles.includes("prefers-reduced-motion") && styles.includes(".visual-studio-shell"), "keeps the studio responsive and motion-aware"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership"), "protects visual projects with Netlify Identity and origin checks"],
  [api.includes("owner_member_id = ${membership.member_id}") && api.includes("member_id = ${membership.member_id}"), "limits mixes and source videos to their owner"],
  [api.includes("buildScenes") && api.includes("durationSeconds") && api.includes("source_video"), "maps complete mix duration into bounded visual movements"],
  [api.includes('new Set(["complete", "logo", "hybrid", "full_visual"])') && api.includes('input.packageType === "complete"'), "combines supplied video, branded motion and Dreamweaver scenes in the complete package"],
  [api.includes("slice(0, 60)"), "accepts the complete bounded video library from the studio"],
  [migration.includes("halo_visual_mix_projects") && migration.includes("halo_visual_mix_scenes"), "persists projects and timed scenes in Netlify Database"],
  [migration.includes("REFERENCES halo_videos") && migration.includes("REFERENCES halo_mixes"), "connects each visual treatment to existing mix and video records"],
  [packageMigration.includes("'complete', 'logo', 'hybrid', 'full_visual'"), "rolls the complete venue package forward without changing an applied migration"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Visual Mix Studio contracts: ${checks.length}/${checks.length} checks passed.`);
