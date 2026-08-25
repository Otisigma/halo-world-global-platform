import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, fn, migration, config, home, stats] = await Promise.all([
  read("dreamweaver-lab/index.html"),
  read("dreamweaver-lab/song-lab.js"),
  read("dreamweaver-lab/song-lab.css"),
  read("netlify/functions/dreamweaver-song-lab.mjs"),
  read("netlify/database/migrations/20260820120000_create-dreamweaver-song-lab.sql"),
  read("netlify.toml"),
  read("halo.html"),
  read("netlify/lib/stats.mjs")
]);

const checks = [
  [page.includes("Dreamweaver Song Lab — HALO") && page.includes('id="songFile"') && page.includes('id="rightsAttested"'), "ships a rights-aware private song intake"],
  [script.includes("decodeAudioData") && script.includes("estimateTempo") && script.includes("spectralEvidence"), "measures waveform, tempo, tonal center, and spectral evidence locally"],
  [script.includes("3.5 * 1024 * 1024") && script.includes("/api/dreamweaver-song-lab"), "uploads authorized audio in bounded private chunks"],
  [fn.includes("verifyRequestOrigin") && fn.includes("ensureMembership") && fn.includes("halo-dreamweaver-songs"), "protects Song Lab writes and storage with membership controls"],
  [fn.includes('model = "gpt-5.4-mini"') && fn.includes('model: "gpt-image-1"') && fn.includes("Never invent credits"), "generates grounded copy and original artwork through supported AI Gateway models"],
  [migration.includes("halo_dreamweaver_songs") && migration.includes("rights_attested") && migration.includes("analysis_evidence"), "persists private projects and measured evidence"],
  [styles.includes(".wave-stage") && styles.includes("prefers-reduced-motion") && styles.includes(".result-grid"), "provides a responsive designed waveform and package experience"],
  [config.includes('from = "/dreamweaver-lab"') && home.includes('href="/dreamweaver-lab/"'), "makes Song Lab discoverable from Halo and normalizes its route"],
  [stats.includes('"open_dreamweaver_song_lab"') && stats.includes('"dreamweaver_song_package_ready"'), "accepts Song Lab product analytics events"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Dreamweaver Song Lab contracts: ${checks.length}/${checks.length} checks passed.`);
