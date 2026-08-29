import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [
  migration,
  schema,
  unifiedUploadFn,
  songCatalogFn,
  songCatalogJs,
  songCatalogHtml,
  songCatalogCss,
  artistsJs,
  radioJs,
  uploadHelper,
] = await Promise.all([
  read("netlify/database/migrations/20260829000000_unified_upload_pipeline.sql"),
  read("db/schema.ts"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("song-catalog/song-catalog.js"),
  read("song-catalog/index.html"),
  read("song-catalog/song-catalog.css"),
  read("artists/artists.js"),
  read("radio/radio.js"),
  read("upload-progress.js"),
]);

const checks = [
  // Migration
  [migration.includes("pipeline_status") && migration.includes("ADD COLUMN IF NOT EXISTS"), "migration adds pipeline_status idempotently"],
  [migration.includes("'uploaded', 'processing', 'needs_assets', 'dreamweaver_in_progress'") && migration.includes("'ready_for_radio', 'ready_for_sale', 'approved', 'published'"), "migration defines all eight pipeline stages"],
  [migration.includes("source_upload_surface") && migration.includes("artist_room") && migration.includes("radio_room"), "migration adds source_upload_surface with known surfaces"],
  [migration.includes("dreamweaver_in_progress") && migration.includes("UPDATE halo_song_catalog"), "migration backfills existing songs to correct pipeline stage"],
  // Schema
  [schema.includes("pipelineStatus") && schema.includes('"pipeline_status"'), "schema includes pipelineStatus column in songs table"],
  [schema.includes("sourceUploadSurface") && schema.includes('"source_upload_surface"'), "schema includes sourceUploadSurface column in songs table"],
  // Unified upload function
  [unifiedUploadFn.includes('path: "/api/unified-upload"'), "unified-upload function registers at /api/unified-upload"],
  [unifiedUploadFn.includes("create_project") && unifiedUploadFn.includes("advance_pipeline"), "unified-upload supports create_project and advance_pipeline actions"],
  [unifiedUploadFn.includes("PIPELINE_STAGES") && unifiedUploadFn.includes("uploaded") && unifiedUploadFn.includes("published"), "unified-upload defines the full ordered pipeline stages array"],
  [unifiedUploadFn.includes("buildDepartmentViews") && unifiedUploadFn.includes("artistRoom") && unifiedUploadFn.includes("radioRoom") && unifiedUploadFn.includes("dreamWeaver") && unifiedUploadFn.includes("salesPublishing"), "unified-upload returns department views for all four departments"],
  [unifiedUploadFn.includes("verifyRequestOrigin") && unifiedUploadFn.includes("ensureMembership"), "unified-upload protects mutations with origin and membership checks"],
  [unifiedUploadFn.includes("Cannot move backward") && unifiedUploadFn.includes("stageIndex"), "unified-upload rejects backward pipeline regressions"],
  [unifiedUploadFn.includes("isExisting") && unifiedUploadFn.includes("Existing master project returned"), "unified-upload returns existing project instead of creating a duplicate"],
  // Song catalog serializer
  [songCatalogFn.includes("pipelineStatus") && songCatalogFn.includes("sourceUploadSurface"), "song-catalog API serializes pipelineStatus and sourceUploadSurface"],
  // Song catalog UI
  [songCatalogJs.includes("pipeline-badge") && songCatalogJs.includes("pipelineStatus"), "song-catalog client renders pipeline badge using pipelineStatus"],
  [songCatalogJs.includes("songPipelineStatus") && songCatalogJs.includes("dataset.stage"), "song-catalog client updates the pipeline stamp element in the workspace"],
  [songCatalogHtml.includes("songPipelineStatus") && songCatalogHtml.includes("pipeline-stamp"), "song-catalog HTML includes the pipeline stamp element"],
  [songCatalogCss.includes("pipeline-badge") && songCatalogCss.includes("pipeline-stamp"), "song-catalog CSS styles the pipeline badge and stamp"],
  [songCatalogCss.includes('[data-stage="published"]') && songCatalogCss.includes('[data-stage="ready_for_radio"]'), "song-catalog CSS has distinct colour rules for terminal pipeline stages"],
  // Artist room integration
  [artistsJs.includes("/api/unified-upload") && artistsJs.includes("create_project") && artistsJs.includes("artist_room"), "artist room calls unified-upload after radio upload success with artist_room surface"],
  // Radio room integration
  [radioJs.includes("/api/unified-upload") && radioJs.includes("create_project") && radioJs.includes("radio_room"), "radio room calls unified-upload after track submission success with radio_room surface"],
  // Upload helper preserved
  [uploadHelper.includes("uploadChunkedFile") && uploadHelper.includes("createUploadUi"), "shared upload-progress helper is unchanged"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nUnified upload pipeline contracts: ${checks.length}/${checks.length} checks passed.`);
}
