import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { normalizeHttpsList } from "../music-upload/link-validation.js";
import { runStageMonitor } from "./upload-experience-stage-monitor.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, client, styles, uploadHelper, world, routes, unifiedUpload, audioFn, artworkFn, config] = await Promise.all([
  read("music-upload/index.html"),
  read("music-upload/music-upload.js"),
  read("music-upload/music-upload.css"),
  read("upload-progress.js"),
  read("halo.html"),
  read("lib/route-registry.js"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
  read("netlify.toml"),
]);

const sources = { page, client, styles, uploadHelper, world, routes, unifiedUpload, audioFn, artworkFn, config };

const checks = [
  {
    stage: "auth hydration / access control",
    source: "page",
    description: "music-upload bootstrap includes identity runtime and sign-in guidance",
    signals: [
      "/identity.js",
      "Sign in, add source material",
      'id="formMessage"',
    ],
    diagnose: "Auth stage failed: /music-upload/ is missing identity bootstrap or sign-in guidance signal.",
  },
  {
    stage: "page bootstrap / runtime load",
    source: "page",
    description: "page loads required runtime scripts for telemetry, monitor, helper, and client",
    signals: [
      "/stats.js",
      "/site-monitor.js",
      "/upload-progress.js",
      "/music-upload/music-upload.js",
    ],
    diagnose: "Bootstrap stage failed: /music-upload/ is missing required runtime script wiring.",
  },
  {
    stage: "page bootstrap / runtime load",
    source: "client",
    description: "client can self-heal stale/missing upload runtime bundle",
    signals: [
      "let uploadHelper = window.HaloUploadProgress",
      "function loadUploadHelperScript()",
      "RUNTIME_LOAD_TIMEOUT_MS",
      "RUNTIME_LOAD_ATTEMPTS",
      "function injectUploadRuntimeScript",
      "function ensureUploadRuntime()",
      "HALO upload runtime did not load",
    ],
    diagnose: "Bootstrap stage failed: music-upload runtime cannot recover from stale/missing upload-progress bundle.",
  },
  {
    stage: "file selection / upload start",
    source: "client",
    description: "client wires file selection into queue rendering and package jobs",
    signals: [
      "function gatherAudioFiles()",
      "function renderQueue()",
      "elements.musicFiles.addEventListener(\"change\", renderQueue)",
      "elements.musicFolder.addEventListener(\"change\", renderQueue)",
      "const jobs = audioFiles.length ?",
    ],
    diagnose: "Upload start stage failed: file selection events/jobs are not fully wired in music-upload.js.",
  },
  {
    stage: "progress visibility / movement",
    source: "client",
    description: "audio/artwork upload flow validates concrete UI nodes and emits start, progress, success, and fail states",
    signals: [
      'resolveUploadUiElements("#audioUploadTrack", "#audioUploadProgress")',
      'track?.closest(".upload-panel")',
      'validateUploadUiElements("audio", audioElements)',
      "HALO upload progress UI failed to initialize",
      "audioUploadUi.start",
      "audioUploadUi.progress",
      "audioUploadUi.success",
      "audioUploadUi.fail",
      "artworkUploadUi.start",
      "artworkUploadUi.progress",
      "artworkUploadUi.success",
      "artworkUploadUi.fail",
      "uploadHelper.uploadChunkedFile",
    ],
    diagnose: "Progress stage failed: upload indicator transitions are missing for audio/artwork pipelines.",
  },
  {
    stage: "progress visibility / movement",
    source: "uploadHelper",
    description: "shared helper unhides tracks accessibly and renders visible in-flight progress immediately",
    signals: [
      'ui.track.hidden=!state.showTrack',
      'ui.track.setAttribute("aria-hidden",state.showTrack?"false":"true")',
      "state.uploading&&progress===0?3:progress",
    ],
    diagnose: "Progress stage failed: shared upload helper no longer exposes visible active progress tracks.",
  },
  {
    stage: "backend success response",
    source: "client",
    description: "intake and staged backend API actions are present",
    signals: [
      "/api/unified-upload",
      "action: \"create_project\"",
      "action: \"advance_pipeline\"",
      "/api/song-catalog",
      "action: \"save_song\"",
      "/api/song-catalog/audio",
      "/api/song-catalog/artwork",
      "action: \"finalize_upload\"",
    ],
    diagnose: "Backend stage failed: create/advance/save/finalize API calls are incomplete in music-upload flow.",
  },
  {
    stage: "persistence confirmation",
    source: "client",
    description: "client confirms persisted bytes before reporting locked-in success",
    signals: [
      "async function confirmPersistedAsset",
      "fetchWithTimeout(",
      "AbortController",
      "PERSISTENCE_CHECK_TIMEOUT_MS",
      'method: "HEAD"',
      'Range: "bytes=0-0"',
      "!finalized.persisted || !finalized.lockedIn",
      "HALO could not confirm persisted",
    ],
    diagnose: "Persistence stage failed: client can report success before confirming persisted asset bytes.",
  },
  {
    stage: "persistence confirmation",
    source: "audioFn",
    description: "audio finalize response preserves persisted + lockedIn contract",
    signals: [
      "hasCompleteChunkSet",
      "persisted: true",
      "lockedIn: true",
    ],
    diagnose: "Persistence stage failed: audio finalize no longer proves complete persisted lock-in.",
  },
  {
    stage: "persistence confirmation",
    source: "artworkFn",
    description: "artwork finalize response preserves persisted + lockedIn contract",
    signals: [
      "hasCompleteChunkSet",
      "persisted: true",
      "lockedIn: true",
    ],
    diagnose: "Persistence stage failed: artwork finalize no longer proves complete persisted lock-in.",
  },
  {
    stage: "post-upload guidance / pipeline insights",
    source: "client",
    description: "client outputs stage diagnostics, needs-attention, and next-step guidance",
    signals: [
      "stageChip(result.pipelineStatus)",
      "Needs attention:",
      "result-next-step",
      "Upload complete:",
      "locked into HALO storage",
      "should be removed only if needed",
    ],
    diagnose: "Guidance stage failed: post-upload diagnostic copy/next-step guidance is missing.",
  },
  {
    stage: "post-upload guidance / pipeline insights",
    source: "styles",
    description: "styles preserve progress tracks and stage guidance markers",
    signals: [
      ".upload-progress-track",
      ".upload-progress-fill",
      ".stage-dreamweaver_in_progress",
      ".result-next-step",
    ],
    diagnose: "Guidance stage failed: style markers for progress and next-step guidance are missing.",
  },
  {
    stage: "deployment/runtime cache freshness",
    source: "config",
    description: "Netlify serves canonical route and cache-busting headers for music upload runtime",
    signals: [
      'from = "/music-upload/"',
      'to = "/music-upload/index.html"',
      'for = "/music-upload/*"',
      'for = "/upload-progress.js"',
      'Cache-Control = "no-cache, no-store, must-revalidate"',
    ],
    diagnose: "Deploy stage failed: canonical route or no-cache runtime headers are missing for /music-upload/.",
  },
  {
    stage: "deployment/runtime cache freshness",
    source: "routes",
    description: "route registry publishes HALO Music Upload directory route",
    signals: [
      /directoryRoute\(\s*"Halo Music Upload"\s*,\s*"\/music-upload\/"\s*,\s*"music-upload\/index\.html"/,
      /menuLabel:\s*"HALO MUSIC UPLOAD"/,
    ],
    diagnose: "Deploy stage failed: route registry no longer exposes /music-upload/ consistently.",
  },
  {
    stage: "deployment/runtime cache freshness",
    source: "world",
    description: "home surface links users to monitored music upload route",
    signals: [
      'href="/music-upload/"',
      "Halo Music Upload",
      "open_halo_music_upload",
    ],
    diagnose: "Deploy stage failed: homepage discovery signals to /music-upload/ are missing.",
  },
  {
    stage: "backend success response",
    source: "unifiedUpload",
    description: "unified upload supports music_upload surface and version provisioning",
    signals: [
      '"music_upload"',
      "versionIds",
      "sale_master",
    ],
    diagnose: "Backend stage failed: unified upload no longer provisions music-upload packages correctly.",
  },
];

runStageMonitor({
  monitorName: "Music upload watchdog",
  checks,
  sources,
});

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
assert.equal(track.hidden, true, "shared upload helper should hide the progress track again when upload returns to idle");
assert.equal(track.attrs["aria-hidden"], "true", "shared upload helper should restore aria-hidden when upload returns to idle");
