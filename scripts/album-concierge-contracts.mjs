import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, script, styles, fn, migration, config, home, stats] = await Promise.all([
  read("album-concierge/index.html"),
  read("album-concierge/album-concierge.js"),
  read("album-concierge/album-concierge.css"),
  read("netlify/functions/album-concierge.mjs"),
  read("netlify/database/migrations/20260830010000_create_album_concierge.sql"),
  read("netlify.toml"),
  read("halo.html"),
  read("netlify/lib/stats.mjs")
]);

const checks = [
  [page.includes("Album Concierge — HALO World") && page.includes('id="step-1"') && page.includes('id="step-4"') && page.includes('id="acResults"'), "ships a guided multi-step concierge flow with purpose, emotion, sound, story, and results"],
  [script.includes("state.purpose") && script.includes("state.emotions") && script.includes("state.soundDirection") && script.includes("state.storyInput"), "tracks flow state across all four guided steps"],
  [script.includes("/api/album-concierge") && script.includes("action=generate") && script.includes("action=save"), "calls create, generate, and save API actions"],
  [script.includes("renderResults") && script.includes("generatedTitles") && script.includes("generatedTracks") && script.includes("generatedDedication"), "renders album titles, tracklist, and dedication in the results view"],
  [script.includes("showLoading") && script.includes("showStep") && script.includes("showResults") && script.includes("showNotice"), "provides loading, step navigation, result, and error notice states"],
  [fn.includes("verifyRequestOrigin") && fn.includes("ensureMembership") && fn.includes("VALID_PURPOSES"), "protects API with origin verification and membership controls"],
  [fn.includes("handleGenerate") && fn.includes("gpt-5.4-mini") && fn.includes("Never invent credits"), "generates grounded album concepts through supported AI Gateway model"],
  [fn.includes("handleCreate") && fn.includes("handleSave") && fn.includes("handleGet"), "supports create, generate, save, and get API actions"],
  [migration.includes("halo_album_concierge_sessions") && migration.includes("generated_tracks") && migration.includes("generated_dedication"), "persists concierge sessions with generated outputs"],
  [styles.includes(".ac-flow") && styles.includes(".ac-choice") && styles.includes(".ac-results") && styles.includes("prefers-reduced-motion"), "ships flow, choice, and results styles with reduced-motion support"],
  [styles.includes(".ac-premium-card") && styles.includes(".btn-premium") && page.includes("Collector Edition"), "ships collector-edition premium upsell styles"],
  [config.includes('from = "/album-concierge"') && home.includes('href="/album-concierge/"'), "makes Album Concierge discoverable from HALO and normalizes its route"],
  [home.includes("open_album_concierge") && home.includes("ALBUM CONCIERGE"), "adds Album Concierge to the HALO Build lane navigation"],
  [home.includes("Turn your story") && home.includes("worth keeping"), "ships the Album Concierge homepage marketing section"],
  [stats.includes('"open_album_concierge"') && stats.includes('"album_concierge_result_ready"'), "registers Album Concierge product analytics events"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Album Concierge contracts: ${checks.length}/${checks.length} checks passed.`);
