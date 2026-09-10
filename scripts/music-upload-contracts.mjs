import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeHttpsList } from "../music-upload/link-validation.js";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, client, styles, world, routes, unifiedUpload, audioFn, artworkFn, config] = await Promise.all([
  read("music-upload/index.html"),
  read("music-upload/music-upload.js"),
  read("music-upload/music-upload.css"),
  read("halo.html"),
  read("lib/route-registry.js"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
  read("netlify.toml"),
]);

const checks = [
  [page.includes("Halo Music Upload") && page.includes('id="musicUploadForm"'), "page introduces the Halo Music Upload intake hub form"],
  [page.includes('id="musicFiles"') && page.includes("webkitdirectory") && page.includes('id="artworkFile"'), "page supports single/multi/folder music intake plus cover art upload"],
  [page.includes('id="officialLink"') && page.includes('id="videoLinks"') && page.includes('name="routeTargets"'), "page captures official links, video links, and downstream routing targets"],
  [page.includes("/upload-progress.js") && page.includes("/identity.js") && page.includes("/site-monitor.js") && page.includes("/stats.js"), "page loads shared HALO runtime helpers"],
  [client.includes("window.HaloUploadProgress") && client.includes("/api/unified-upload") && client.includes("/api/song-catalog"), "client reuses shared upload progress and the unified catalog pipeline"],
  [client.includes("/api/song-catalog/audio") && client.includes("/api/song-catalog/artwork") && client.includes('surface: "music_upload"'), "client uploads audio and artwork, then records the music_upload source surface"],
  [client.includes("confirmPersistedAsset") && client.includes('method: "HEAD"') && client.includes("HALO could not confirm persisted"), "client verifies persisted asset URLs before marking uploads as locked-in success"],
  [client.includes("locked into HALO storage") && client.includes("should be removed only if needed") && client.includes("Next:"), "client shows explicit locked-in confirmation and post-upload next-step guidance"],
  [client.includes("advance_pipeline") && client.includes("dreamweaver_in_progress") && client.includes("needs_assets"), "client advances pipeline stages to expose build and attention feedback"],
  [client.includes("nextStep") && client.includes("result-next-step"), "result cards include a dedicated next-step message for owner clarity"],
  [styles.includes(".stage-dreamweaver_in_progress") && styles.includes(".route-pill") && styles.includes(".upload-progress-track"), "page styles expose route feedback cards and upload progress tracks"],
  [styles.includes(".result-next-step"), "page styles include dedicated next-step emphasis for persisted upload outcomes"],
  [world.includes('href="/music-upload/"') && world.includes("Halo Music Upload") && world.includes("open_halo_music_upload"), "System Controller links to the standalone Halo Music Upload hub"],
  [routes.includes('directoryRoute("Halo Music Upload", "/music-upload/", "music-upload/index.html", { menuLabel: "HALO MUSIC UPLOAD" })'), "route registry includes the Halo Music Upload satellite route"],
  [unifiedUpload.includes('"music_upload"') && unifiedUpload.includes("versionIds") && unifiedUpload.includes("sale_master"), "unified upload accepts the music upload surface and provisions reusable version ids"],
  [audioFn.includes("hasCompleteChunkSet") && audioFn.includes("persisted: true") && audioFn.includes("lockedIn: true"), "audio finalize confirms complete chunks and returns persisted/locked state"],
  [artworkFn.includes("hasCompleteChunkSet") && artworkFn.includes("persisted: true") && artworkFn.includes("lockedIn: true"), "artwork finalize confirms complete chunks and returns persisted/locked state"],
  [config.includes('from = "/music-upload/"') && config.includes('to = "/music-upload/index.html"'), "netlify serves the canonical /music-upload/ route"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) {
  console.log(`\n${failures.length} music upload contract(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nMusic upload contracts: ${checks.length}/${checks.length} checks passed.`);
}

assert.deepEqual(
  normalizeHttpsList("https://halo.world/release\nhttps://www.youtube.com/watch?v=halo"),
  ["https://halo.world/release", "https://www.youtube.com/watch?v=halo"],
  "link validation must preserve valid https official and video links"
);
assert.throws(
  () => normalizeHttpsList("http://halo.world/release"),
  /https:\/\//,
  "link validation must reject non-https sources"
);
assert.throws(
  () => normalizeHttpsList("https://user@halo.world/release"),
  /https:\/\//,
  "link validation must reject credential-bearing URLs"
);
