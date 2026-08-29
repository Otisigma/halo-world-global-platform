import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, client, styles, api, catalogApi, catalogClient, schema, migration, netlifyConfig] = await Promise.all([
  read("upload-pipeline/index.html"),
  read("upload-pipeline/upload-pipeline.js"),
  read("upload-pipeline/upload-pipeline.css"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("song-catalog/song-catalog.js"),
  read("db/schema.ts"),
  read("netlify/database/migrations/20260829010000_add_unified_upload_pipeline.sql"),
  read("netlify.toml"),
]);

const checks = [
  // HTML structure
  [page.includes("upload-pipeline.css") && page.includes("upload-pipeline.js"), "page loads its own CSS and JS"],
  [page.includes("dept-tab") && page.includes('data-dept="all"') && page.includes('data-dept="dreamweaver"') && page.includes('data-dept="radio"') && page.includes('data-dept="sales"'), "page provides department filter tabs for all, Dream Weaver, radio, and sales"],
  [page.includes("pipelineBoard") && page.includes("stageDialog") && page.includes("stageSelect"), "page includes the pipeline board and stage dialog elements"],
  [page.includes("/song-catalog/") && page.includes("Open Song Catalog"), "page links back to the song catalog for one-upload entry"],
  [page.includes("pipeline-legend") && page.includes("Needs Assets") && page.includes("Dream Weaver") && page.includes("Ready for Radio"), "page shows the pipeline stage legend"],

  // JS client
  [client.includes("STAGE_LABEL") && client.includes("dreamweaver_in_progress") && client.includes("ready_for_radio") && client.includes("ready_for_sale") && client.includes("published"), "client defines all pipeline stage labels"],
  [client.includes("dept-tab") && client.includes("loadPipeline"), "client reloads pipeline when a department tab is clicked"],
  [client.includes("set_stage") && client.includes("stageSubmitButton"), "client submits stage transitions to the API"],
  [client.includes("radioTracks") && client.includes("radio-linked"), "client shows radio track link status on each pipeline item"],
  [client.includes("identity:login") && client.includes("identity:logout"), "client responds to authentication events"],

  // CSS
  [styles.includes("stage-uploaded") && styles.includes("stage-published") && styles.includes("stage-dreamweaver_in_progress"), "CSS defines visual chips for all pipeline stages"],
  [styles.includes("dept-tab.is-active") && styles.includes("pipeline-item"), "CSS styles the department tabs and pipeline item cards"],

  // API function
  [api.includes("PIPELINE_STAGES") && api.includes('"uploaded"') && api.includes('"dreamweaver_in_progress"') && api.includes('"ready_for_radio"') && api.includes('"published"'), "API defines the full set of valid pipeline stages"],
  [api.includes("loadPipeline") && api.includes("master_song_id") && api.includes("radio_room"), "API loads songs with linked radio tracks in a single query"],
  [api.includes("set_stage") && api.includes("pipeline_status") && api.includes("pipeline_updated_at"), "API persists stage transitions with a timestamp"],
  [api.includes("link_radio_track") && api.includes("master_song_id"), "API supports linking a radio track to its master song catalog entry"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes('path: "/api/upload-pipeline"'), "API protects pipeline actions with membership and origin checks"],
  [api.includes("department") && api.includes("ready_for_radio") && api.includes("ready_for_sale") && api.includes("dreamweaver"), "API filters items by department when a department query param is given"],

  // Song catalog integration
  [catalogApi.includes("PIPELINE_STAGES") && catalogApi.includes("set_pipeline_stage"), "song catalog API exposes a set_pipeline_stage action"],
  [catalogApi.includes("pipelineStatus") && catalogApi.includes("pipelineUpdatedAt"), "song catalog serializes pipelineStage and pipelineUpdatedAt for each song"],

  // Song catalog client
  [catalogClient.includes("songPipelineStatus"), "song catalog client populates the pipeline stage display element in the workspace"],

  // Drizzle schema
  [schema.includes("pipelineStatus") && schema.includes('"pipeline_status"'), "Drizzle schema includes the pipelineStatus column on the songs table"],
  [schema.includes("pipelineUpdatedAt") && schema.includes('"pipeline_updated_at"'), "Drizzle schema includes the pipelineUpdatedAt column on the songs table"],
  [schema.includes("halo_song_catalog_pipeline_stage_idx"), "Drizzle schema defines an index on pipeline_status for efficient department queries"],

  // Migration
  [migration.includes("pipeline_updated_at") && migration.includes("master_song_id"), "migration adds pipeline_updated_at and master_song_id columns"],
  [migration.includes("pipeline_updated_at"), "migration adds pipeline_updated_at timestamp column"],
  [migration.includes("master_song_id") && migration.includes("halo_radio_tracks"), "migration adds master_song_id to halo_radio_tracks to link radio entries to the master song"],
  [migration.includes("halo_radio_tracks_master_song_idx"), "migration indexes master_song_id for efficient lookups"],

  // Netlify config
  [netlifyConfig.includes("/upload-pipeline") && netlifyConfig.includes("/upload-pipeline/"), "netlify.toml redirects /upload-pipeline to the directory index"],
];

let passed = 0;
let failed = 0;
for (const [condition, label] of checks) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
