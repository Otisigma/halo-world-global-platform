import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, uploadHelper, routes, world, config, songCatalogFn, audioFn, artworkFn] = await Promise.all([
  read("music-upload/index.html"),
  read("upload-progress.js"),
  read("lib/route-registry.js"),
  read("halo.html"),
  read("netlify.toml"),
  read("netlify/functions/song-catalog.ts"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
]);
const clientScriptMatch = page.match(/<script type="module" src="([^"]*song-catalog\/song-catalog\.js[^"]*)"><\/script>/);
assert.ok(clientScriptMatch, "music-upload page must mount the shared song-catalog module client");
const catalogClientPath = clientScriptMatch[1].split("?")[0].replace(/^\//, "");
await read(catalogClientPath);
const headerBlocks = config.split("[[headers]]").slice(1);
const hasNoCacheHeader = routePath =>
  headerBlocks.some(
    block =>
      block.includes(`for = "${routePath}"`) &&
      block.includes('Cache-Control = "no-cache, no-store, must-revalidate"')
  );

const checks = [
  [page.includes('id="catalogShell"') && page.includes('id="workspace"') && page.includes('id="songWorkspace"') && page.includes('id="songForm"') && page.includes('id="versionForm"'), "exposes the shared catalog upload structure and edit forms on /music-upload/"],
  [page.includes('/song-catalog/song-catalog.css') && page.includes('/song-catalog/song-catalog.js'), "reuses the proven song catalog UI and client implementation"],
  [page.includes('/stats.js') && page.includes('/site-monitor.js') && page.includes('/accessibility.js'), "keeps site-level monitoring and accessibility bootstraps on /music-upload/"],
  [page.includes('/identity.js') && page.includes('/upload-progress.js?v=music-upload-runtime') && page.includes('/song-catalog/song-catalog.js?v=music-upload-runtime'), "keeps identity, cache-busted runtime, and client wiring"],
  [catalogClientPath === "song-catalog/song-catalog.js", "music-upload mounts the expected shared catalog client asset"],
  [!page.includes('/music-upload/music-upload.js') && page.includes('id="addSongButton"') && page.includes('id="importButton"'), "entry surface now boots from the shared catalog module instead of the retired music-upload client"],
  [page.includes('id="audioFile"') && page.includes('id="uploadAudioButton"') && page.includes('id="audioUploadTrack"'), "keeps working version-audio upload controls on /music-upload/"],
  [page.includes('id="artworkFile"') && page.includes('id="uploadArtworkButton"') && page.includes('id="artworkUploadTrack"') && page.includes('id="versionArtworkTrack"'), "keeps working song and version artwork uploads on /music-upload/"],
  [songCatalogFn.includes('payload.action === "save_version"') && songCatalogFn.includes("/api/song-catalog") && audioFn.includes("/api/song-catalog/audio") && artworkFn.includes("/api/song-catalog/artwork"), "music upload surface is backed by the existing catalog/version/audio/artwork API routes"],
  [page.includes('id="audioUploadTrack"') && page.includes('id="artworkUploadTrack"') && /createUploadUi/.test(uploadHelper) && /uploadChunkedFile/.test(uploadHelper), "uses shared chunked upload behavior with visible progress states"],
  [/hasCompleteChunkSet/.test(audioFn) && /persisted:\s*true/.test(audioFn) && /lockedIn:\s*true/.test(audioFn) && /hasCompleteChunkSet/.test(artworkFn) && /persisted:\s*true/.test(artworkFn) && /lockedIn:\s*true/.test(artworkFn), "audio/artwork finalization keeps persisted lock-in signals"],
  [/\[\[redirects\]\]\s+from = "\/music-upload\/"\s+to = "\/music-upload\/index\.html"\s+status = 200\s+force = true/.test(config), "serves canonical /music-upload/ route"],
  [hasNoCacheHeader("/music-upload/*") && hasNoCacheHeader("/upload-progress.js"), "keeps no-cache headers for music-upload runtime freshness"],
  [/directoryRoute\(\s*"Halo Music Upload"\s*,\s*"\/music-upload\/"\s*,\s*"music-upload\/index\.html"/.test(routes), "route registry exposes /music-upload/ as Halo Music Upload"],
  [world.includes('href="/music-upload/"') && world.includes("open_halo_music_upload"), "homepage discovery links continue pointing to /music-upload/"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(
  failures.length,
  0,
  `Music upload contract failures: ${failures.map(([, description]) => description).join("; ")}`
);
{
  const helperContext = {
    window: {},
    console,
    XMLHttpRequest: class {},
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(uploadHelper, helperContext, { filename: "upload-progress.js" });
  assert.equal(typeof helperContext.window.HaloUploadProgress?.createUploadUi, "function", "shared upload helper should expose createUploadUi");
  const track = {
    hidden: true,
    attrs: { "aria-hidden": "true" },
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
  };
  const fill = { style: { width: "0%" } };
  const status = { textContent: "" };
  const panel = {
    dataset: {},
    classList: { toggle() {} },
    setAttribute(name, value) {
      this[name] = value;
    }
  };
  const uploadUi = helperContext.window.HaloUploadProgress.createUploadUi({
    panel,
    status,
    track,
    fill,
    idleMessage: "Idle",
  });
  uploadUi.start("Preparing upload…");
  assert.equal(track.hidden, false, "shared upload helper should reveal the progress track when upload starts");
  assert.equal(track.attrs["aria-hidden"], "false", "shared upload helper should clear aria-hidden when upload starts");
  assert.equal(fill.style.width, "3%", "shared upload helper should show visible in-flight progress before the first chunk advances");
  uploadUi.idle("Idle");
  assert.equal(track.hidden, true, "shared upload helper should hide progress track when upload returns to idle");
  assert.equal(track.attrs["aria-hidden"], "true", "shared upload helper should restore aria-hidden when upload returns to idle");
}
console.log(`Music upload contracts: ${checks.length}/${checks.length} checks passed.`);
