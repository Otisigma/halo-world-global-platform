import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, catalogClient, uploadHelper, routes, world, config, audioFn, artworkFn] = await Promise.all([
  read("music-upload/index.html"),
  read("song-catalog/song-catalog.js"),
  read("upload-progress.js"),
  read("lib/route-registry.js"),
  read("halo.html"),
  read("netlify.toml"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
]);

const checks = [
  [page.includes("Catalog upload surface") && page.includes("Upload every master, keep one catalog truth."), "positions /music-upload/ as the upload-facing catalog surface"],
  [page.includes('/song-catalog/song-catalog.css') && page.includes('/song-catalog/song-catalog.js'), "reuses the proven song catalog UI and client implementation"],
  [page.includes('/identity.js') && page.includes('/upload-progress.js'), "keeps identity and shared upload runtime wiring"],
  [page.includes('id="audioFile"') && page.includes('id="uploadAudioButton"') && page.includes('id="audioUploadTrack"'), "keeps working version-audio upload controls on /music-upload/"],
  [page.includes('id="artworkFile"') && page.includes('id="uploadArtworkButton"') && page.includes('id="artworkUploadTrack"') && page.includes('id="versionArtworkTrack"'), "keeps working song and version artwork uploads on /music-upload/"],
  [catalogClient.includes('fetch("/api/song-catalog"') && catalogClient.includes('fetch("/api/song-catalog/audio"') && catalogClient.includes('fetch("/api/song-catalog/artwork"'), "music upload surface is backed by existing catalog upload APIs"],
  [catalogClient.includes("uploadHelper.uploadChunkedFile") && uploadHelper.includes("createUploadUi") && uploadHelper.includes("uploadChunkedFile"), "uses shared chunked upload behavior with visible progress states"],
  [audioFn.includes("persisted: true") && audioFn.includes("lockedIn: true") && artworkFn.includes("persisted: true") && artworkFn.includes("lockedIn: true"), "audio/artwork finalization keeps persisted lock-in signals"],
  [/from = "\/music-upload\/"[\s\S]*to = "\/music-upload\/index\.html"/.test(config), "serves canonical /music-upload/ route"],
  [config.includes('for = "/music-upload/*"') && config.includes('for = "/upload-progress.js"') && config.includes('Cache-Control = "no-cache, no-store, must-revalidate"'), "keeps no-cache headers for music-upload runtime freshness"],
  [/directoryRoute\(\s*"Halo Music Upload"\s*,\s*"\/music-upload\/"\s*,\s*"music-upload\/index\.html"/.test(routes), "route registry exposes /music-upload/ as Halo Music Upload"],
  [world.includes('href="/music-upload/"') && world.includes("open_halo_music_upload"), "homepage discovery links continue pointing to /music-upload/"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Music upload contracts: ${checks.length}/${checks.length} checks passed.`);
