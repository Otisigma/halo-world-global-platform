import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, uploadHelper, routes, world, config, unifiedUploadFn, songCatalogFn, audioFn, artworkFn] = await Promise.all([
  read("music-upload/index.html"),
  read("upload-progress.js"),
  read("lib/route-registry.js"),
  read("halo.html"),
  read("netlify.toml"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
]);
const clientScriptMatch = page.match(/<script type="module" src="([^"]*song-catalog\/song-catalog\.js[^"]*)"><\/script>/);
assert.ok(clientScriptMatch, "music-upload page must mount the shared song-catalog module client");
const catalogClientPath = clientScriptMatch[1].split("?")[0].replace(/^\//, "");
await read(catalogClientPath);
function parseNetlifyToml(text) {
  const stripInlineComment = input => {
    let quote = "";
    let escaped = false;
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (!quote && (char === '"' || char === "'")) {
        quote = char;
        continue;
      }
      if (quote && char === quote) {
        quote = "";
        continue;
      }
      if (!quote && char === "#") return input.slice(0, index);
    }
    return input;
  };
  const parseTomlValue = rawValue => {
    const value = stripInlineComment(rawValue).trim();
    if (!value) return "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const inner = value.slice(1, -1);
      return value.startsWith('"') ? inner.replace(/\\"/g, '"') : inner.replace(/\\'/g, "'");
    }
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    if (/^[+-]?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
  };
  const headers = [];
  const redirects = [];
  let section = null;
  let current = null;
  let nestedTable = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[headers]]") {
      section = "headers";
      current = {};
      headers.push(current);
      nestedTable = "";
      continue;
    }
    if (line === "[[redirects]]") {
      section = "redirects";
      current = {};
      redirects.push(current);
      nestedTable = "";
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      const tableName = line.slice(1, -1);
      if (section === "headers" && tableName === "headers.values") {
        nestedTable = tableName;
        continue;
      }
      nestedTable = "__ignore__";
      continue;
    }
    if (!section || !current) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = parseTomlValue(rawValue);
    if (nestedTable === "__ignore__") continue;
    if (nestedTable === "headers.values") {
      current.values ||= {};
      current.values[key] = value;
    } else {
      current[key] = value;
    }
  }
  return { headers, redirects };
}
const netlifyConfig = parseNetlifyToml(config);
const hasNoCacheHeader = routePath =>
  netlifyConfig.headers.some(
    item =>
      item.for === routePath &&
      (item.values?.["Cache-Control"] === "no-cache, no-store, must-revalidate" ||
        item["Cache-Control"] === "no-cache, no-store, must-revalidate")
  );
const hasCanonicalRedirect = (from, to) =>
  netlifyConfig.redirects.some(
    item =>
      item.from === from &&
      item.to === to &&
      Number(item.status) === 200 &&
      item.force === true
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
  [unifiedUploadFn.includes('"music_upload"') && unifiedUploadFn.includes('payload.action === "create_project"') && unifiedUploadFn.includes('payload.action === "advance_pipeline"') && unifiedUploadFn.includes("versionIds"), "keeps unified upload pipeline contract for music_upload project provisioning"],
  [songCatalogFn.includes('payload.action === "save_song"') && songCatalogFn.includes('payload.action === "save_version"') && songCatalogFn.includes("/api/song-catalog") && audioFn.includes("/api/song-catalog/audio") && artworkFn.includes("/api/song-catalog/artwork"), "music upload surface is backed by the existing catalog/song-save/version/audio/artwork API routes"],
  [page.includes('id="audioUploadTrack"') && page.includes('id="artworkUploadTrack"') && /createUploadUi/.test(uploadHelper) && /uploadChunkedFile/.test(uploadHelper), "uses shared chunked upload behavior with visible progress states"],
  [/hasCompleteChunkSet/.test(audioFn) && /persisted:\s*true/.test(audioFn) && /lockedIn:\s*true/.test(audioFn) && /hasCompleteChunkSet/.test(artworkFn) && /persisted:\s*true/.test(artworkFn) && /lockedIn:\s*true/.test(artworkFn), "audio/artwork finalization keeps persisted lock-in signals"],
  [hasCanonicalRedirect("/music-upload/", "/music-upload/index.html"), "serves canonical /music-upload/ route"],
  [hasNoCacheHeader("/music-upload/*") && hasNoCacheHeader("/upload-progress.js"), "keeps no-cache headers for music-upload runtime freshness"],
  [/directoryRoute\(\s*"Halo Music Upload"\s*,\s*"\/music-upload\/"\s*,\s*"music-upload\/index\.html"/.test(routes), "route registry exposes /music-upload/ as Halo Music Upload"],
  [world.includes('href="/music-upload/"') && world.includes("open_halo_music_upload"), "homepage discovery links continue pointing to /music-upload/"],
];

const failures = checks.filter(([passed]) => !passed);
const passedCount = checks.length - failures.length;
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
console.log(`Music upload contracts: ${passedCount}/${checks.length} checks passed.`);
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
