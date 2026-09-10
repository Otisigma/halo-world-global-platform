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

const sources = { page, client, styles, world, routes, unifiedUpload, audioFn, artworkFn, config };

const checks = [
  {
    id: "ui.surface",
    area: "UI",
    source: "page",
    description: "music-upload page keeps core upload surface controls mounted",
    signals: [
      'id="musicUploadForm"',
      'id="musicFiles"',
      'id="musicFolder"',
      'id="artworkFile"',
      'id="audioUploadTrack"',
      'id="audioUploadProgress"',
      'id="artworkUploadTrack"',
      'id="artworkUploadProgress"',
      'id="formMessage"',
      'id="resultsList"',
    ],
    diagnose: "UI stage is broken: required upload controls/status regions are missing from /music-upload/index.html.",
  },
  {
    id: "bundle.runtime",
    area: "Script bundle",
    source: "page",
    description: "page loads required runtime scripts for identity, monitoring, telemetry, progress, and client module",
    signals: [
      '/stats.js',
      '/site-monitor.js',
      '/identity.js',
      '/upload-progress.js',
      '/music-upload/music-upload.js',
    ],
    diagnose: "Bundle stage is broken: /music-upload/ is likely missing a required script include.",
  },
  {
    id: "bundle.helper-bootstrap",
    area: "Script bundle",
    source: "client",
    description: "music-upload client bootstraps upload helper when global script is stale or missing",
    signals: [
      "let uploadHelper = window.HaloUploadProgress",
      'await import("/upload-progress.js?v=music-upload-runtime")',
      "HALO upload runtime did not load",
    ],
    diagnose: "Bundle stage is broken: music-upload.js is not resilient to missing/stale upload-progress runtime wiring.",
  },
  {
    id: "flow.file-selection",
    area: "UI",
    source: "client",
    description: "client tracks file selection and queue rendering",
    signals: [
      "function gatherAudioFiles()",
      "function renderQueue()",
      "elements.musicFiles.addEventListener(\"change\", renderQueue)",
      "elements.musicFolder.addEventListener(\"change\", renderQueue)",
    ],
    diagnose: "UI stage is broken: file-pick events are not fully wired into queue rendering.",
  },
  {
    id: "flow.upload-progress",
    area: "UI",
    source: "client",
    description: "upload flow emits start/progress/success/fail states for audio and artwork",
    signals: [
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
    diagnose: "Progress stage is broken: upload indicator state transitions are missing in music-upload.js.",
  },
  {
    id: "network.intake",
    area: "Network",
    source: "client",
    description: "intake and pipeline requests are present",
    signals: [
      "/api/unified-upload",
      "action: \"create_project\"",
      "action: \"advance_pipeline\"",
      "/api/song-catalog",
      "action: \"save_song\"",
    ],
    diagnose: "Network stage is broken: intake/pipeline calls are missing, so package creation or stage advancement will fail.",
  },
  {
    id: "network.asset-upload",
    area: "Network",
    source: "client",
    description: "audio/artwork upload + finalize calls are present",
    signals: [
      "/api/song-catalog/audio",
      "/api/song-catalog/artwork",
      "action: \"finalize_upload\"",
      "uploadId",
      "chunkCount",
    ],
    diagnose: "Network stage is broken: chunked upload/finalization calls are incomplete.",
  },
  {
    id: "persist.confirmation",
    area: "Persistence confirmation",
    source: "client",
    description: "client confirms persisted assets before reporting lock-in success",
    signals: [
      "async function confirmPersistedAsset",
      'method: "HEAD"',
      'Range: "bytes=0-0"',
      "!finalized.persisted || !finalized.lockedIn",
      "HALO could not confirm persisted",
    ],
    diagnose: "Persistence stage is broken: the client may report success without confirming stored asset bytes.",
  },
  {
    id: "message.success-next-step",
    area: "Post-upload messaging",
    source: "client",
    description: "client emits explicit lock-in and next-step copy",
    signals: [
      "locked into HALO storage",
      "nextStep",
      "result-next-step",
      "Upload complete:",
      "should be removed only if needed",
    ],
    diagnose: "Post-upload stage is broken: lock-in confirmation or next-step instructions are missing.",
  },
  {
    id: "pipeline.status-mapping",
    area: "Pipeline state",
    source: "client",
    description: "pipeline stages map to visible statuses and attention states",
    signals: [
      "needs_assets",
      "dreamweaver_in_progress",
      "ready_for_radio",
      "stageChip(result.pipelineStatus)",
      "Needs attention:",
    ],
    diagnose: "Pipeline stage is broken: upload outcomes cannot be diagnosed by stage.",
  },
  {
    id: "backend.locked-response",
    area: "Backend response",
    source: "audioFn",
    description: "audio finalize enforces complete chunks and lock-in response",
    signals: [
      "hasCompleteChunkSet",
      "persisted: true",
      "lockedIn: true",
    ],
    diagnose: "Backend response stage is broken: audio finalize no longer proves complete persisted lock-in.",
  },
  {
    id: "backend.locked-response-artwork",
    area: "Backend response",
    source: "artworkFn",
    description: "artwork finalize enforces complete chunks and lock-in response",
    signals: [
      "hasCompleteChunkSet",
      "persisted: true",
      "lockedIn: true",
    ],
    diagnose: "Backend response stage is broken: artwork finalize no longer proves complete persisted lock-in.",
  },
  {
    id: "deploy.route",
    area: "Deployment mismatch",
    source: "config",
    description: "Netlify serves canonical /music-upload/ route",
    signals: [
      'from = "/music-upload/"',
      'to = "/music-upload/index.html"',
    ],
    diagnose: "Deployment stage is broken: canonical /music-upload/ routing is missing or changed.",
  },
  {
    id: "deploy.cache-control",
    area: "Deployment mismatch",
    source: "config",
    description: "deploy config prevents stale music-upload HTML/JS bundles from masking UI updates",
    signals: [
      'for = "/music-upload/*"',
      'for = "/upload-progress.js"',
      'Cache-Control = "no-cache, no-store, must-revalidate"',
    ],
    diagnose: "Deployment stage is broken: music-upload cache headers are missing, so stale bundles can hide upload indicators on live.",
  },
  {
    id: "discoverability.route-registry",
    area: "Deployment mismatch",
    source: "routes",
    description: "route registry publishes the dedicated music upload route",
    signals: [
      /directoryRoute\(\s*"Halo Music Upload"\s*,\s*"\/music-upload\/"\s*,\s*"music-upload\/index\.html"/,
      /menuLabel:\s*"HALO MUSIC UPLOAD"/,
    ],
    diagnose: "Deployment stage is broken: route registry no longer exposes /music-upload/ consistently.",
  },
  {
    id: "discoverability.home-link",
    area: "Deployment mismatch",
    source: "world",
    description: "home surface links users to /music-upload/",
    signals: [
      'href="/music-upload/"',
      "Halo Music Upload",
      "open_halo_music_upload",
    ],
    diagnose: "Discovery stage is broken: users may be stuck on stale entry points instead of the monitored route.",
  },
  {
    id: "backend.unified-surface",
    area: "Backend response",
    source: "unifiedUpload",
    description: "unified upload function accepts music_upload surface and version ids",
    signals: [
      '"music_upload"',
      "versionIds",
      "sale_master",
    ],
    diagnose: "Backend response stage is broken: unified upload may not be provisioning music upload packages correctly.",
  },
  {
    id: "styles.feedback-signals",
    area: "UI",
    source: "styles",
    description: "styles keep progress tracks and status chips visible",
    signals: [
      ".upload-progress-track",
      ".upload-progress-fill",
      ".stage-dreamweaver_in_progress",
      ".result-next-step",
    ],
    diagnose: "UI stage is broken: CSS feedback markers used by upload diagnostics are missing.",
  },
];

const hasSignal = (text, signal) => {
  if (typeof text !== "string") return false;
  if (signal instanceof RegExp) {
    const stateless = new RegExp(signal.source, signal.flags.replace(/[gy]/g, ""));
    return stateless.test(text);
  }
  return text.includes(signal);
};
const signalLabel = signal => signal instanceof RegExp ? signal.toString() : signal;
const missingSignals = (text, signals) => signals.filter(signal => !hasSignal(text, signal));
const failures = [];

for (const check of checks) {
  const text = sources[check.source];
  if (typeof text !== "string") {
    failures.push({
      ...check,
      missing: [`[missing source: ${check.source}]`],
      diagnose: `${check.diagnose} Source key "${check.source}" is not available in the watchdog inputs.`,
    });
    console.log(`FAIL [${check.id}] ${check.description}`);
    console.log(`  area: ${check.area}`);
    console.log(`  file: ${check.source}`);
    console.log(`  missing signals: [missing source: ${check.source}]`);
    console.log(`  diagnosis: ${check.diagnose} Source key "${check.source}" is not available in the watchdog inputs.`);
    continue;
  }
  const missing = missingSignals(text, check.signals);
  if (missing.length === 0) {
    console.log(`PASS [${check.id}] ${check.description}`);
    continue;
  }

  failures.push({ ...check, missing });
  console.log(`FAIL [${check.id}] ${check.description}`);
  console.log(`  area: ${check.area}`);
  console.log(`  file: ${check.source}`);
  console.log(`  missing signals: ${missing.map(signalLabel).join(" | ")}`);
  console.log(`  diagnosis: ${check.diagnose}`);
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

if (failures.length === 0) {
  console.log(`\nMusic upload watchdog: ${checks.length}/${checks.length} checks passed.`);
} else {
  console.log(`\nMusic upload watchdog: ${checks.length - failures.length}/${checks.length} checks passed.`);
  console.log("\nFailing stages:");
  for (const failure of failures) {
    console.log(`- ${failure.id} (${failure.area}) -> ${failure.diagnose}`);
  }
  process.exitCode = 1;
}
