import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [
  migration,
  ledgerLib,
  ledgerFn,
  unifiedUploadFn,
  maintenanceLib,
  ledgerHtml,
  ledgerCss,
  ledgerJs,
] = await Promise.all([
  read("netlify/database/migrations/20260829020000_create_halo_ledger.sql"),
  read("netlify/lib/halo-ledger.mjs"),
  read("netlify/functions/halo-ledger.mjs"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/lib/maintenance.mjs"),
  read("halo-ledger/index.html"),
  read("halo-ledger/halo-ledger.css"),
  read("halo-ledger/halo-ledger.js"),
]);

const checks = [
  // Migration
  [migration.includes("CREATE TABLE IF NOT EXISTS halo_ledger"), "migration creates halo_ledger table"],
  [migration.includes("event_category") && migration.includes("actor_id") && migration.includes("summary"), "migration includes required ledger columns"],
  [migration.includes("ref_song_id") && migration.includes("ref_issue_id") && migration.includes("ref_release_id") && migration.includes("ref_agent_id"), "migration includes ref columns for linking to source records"],
  [migration.includes("details") && migration.includes("JSONB"), "migration includes JSONB details column"],
  [migration.includes("pipeline_stage") && migration.includes("outcome"), "migration includes pipeline_stage and outcome columns"],
  [migration.includes("CREATE INDEX IF NOT EXISTS halo_ledger_created_idx"), "migration creates created_at index for time-ordered access"],
  [migration.includes("CREATE INDEX IF NOT EXISTS halo_ledger_category_idx"), "migration creates category index for filtered queries"],
  [migration.includes("CREATE INDEX IF NOT EXISTS halo_ledger_song_idx"), "migration creates partial song ref index"],
  [migration.includes("CREATE INDEX IF NOT EXISTS halo_ledger_issue_idx"), "migration creates partial issue ref index"],

  // Ledger lib
  [ledgerLib.includes("export const LEDGER_CATEGORIES") && ledgerLib.includes("upload_event") && ledgerLib.includes("issue_report"), "ledger lib exports LEDGER_CATEGORIES set including upload_event and issue_report"],
  [ledgerLib.includes("fix_record") && ledgerLib.includes("department_action") && ledgerLib.includes("approval_event"), "ledger lib includes fix_record, department_action, approval_event categories"],
  [ledgerLib.includes("agent_activity") && ledgerLib.includes("feature_request") && ledgerLib.includes("system_event"), "ledger lib includes agent_activity, feature_request, system_event categories"],
  [ledgerLib.includes("export async function appendLedgerEntry"), "ledger lib exports appendLedgerEntry function"],
  [ledgerLib.includes("INSERT INTO halo_ledger") && ledgerLib.includes("randomUUID"), "appendLedgerEntry inserts into halo_ledger with a random UUID"],

  // Ledger API function
  [ledgerFn.includes('path: "/api/halo-ledger"'), "halo-ledger function registers at /api/halo-ledger"],
  [ledgerFn.includes("handleGet") && ledgerFn.includes("handlePost"), "halo-ledger function handles both GET and POST"],
  [ledgerFn.includes("verifyRequestOrigin") && ledgerFn.includes("ensureMembership"), "halo-ledger function protects mutations with origin and membership checks"],
  [ledgerFn.includes("LEDGER_CATEGORIES") && ledgerFn.includes("serializeEntry"), "halo-ledger function validates categories and serializes entries"],
  [ledgerFn.includes("nextBefore") && ledgerFn.includes("ORDER BY created_at DESC"), "halo-ledger function supports cursor-based pagination"],
  [ledgerFn.includes("ILIKE") && ledgerFn.includes("summary ILIKE"), "halo-ledger function supports full-text search across summary and body"],
  [ledgerFn.includes("ref_song_id") && ledgerFn.includes("refSongId"), "halo-ledger function supports filtering by song reference"],

  // Upload pipeline integration
  [unifiedUploadFn.includes("appendLedgerEntry") && unifiedUploadFn.includes("../lib/halo-ledger.mjs"), "unified-upload imports and calls appendLedgerEntry"],
  [unifiedUploadFn.includes("upload_event") && unifiedUploadFn.includes("Master project created:"), "unified-upload logs upload_event when a master project is created"],
  [unifiedUploadFn.includes("Pipeline advanced to") && unifiedUploadFn.includes("fromStage"), "unified-upload logs pipeline stage transitions with fromStage detail"],

  // Issues/fix integration
  [maintenanceLib.includes("appendLedgerEntry") && maintenanceLib.includes("./halo-ledger.mjs"), "maintenance lib imports appendLedgerEntry from halo-ledger"],
  [maintenanceLib.includes("issue_report") && maintenanceLib.includes("Issue reported:"), "maintenance lib logs issue_report events to the ledger"],

  // UI
  [ledgerHtml.includes("/api/halo-ledger") || ledgerJs.includes("/api/halo-ledger"), "ledger UI calls /api/halo-ledger endpoint"],
  [ledgerHtml.includes("data-category") && ledgerHtml.includes("upload_event"), "ledger HTML includes category filter chips"],
  [ledgerHtml.includes("ledgerQuery") && ledgerHtml.includes("ledgerSearchBtn"), "ledger HTML has search input and button"],
  [ledgerHtml.includes("ledgerDetail") && ledgerHtml.includes("ledgerDetailClose"), "ledger HTML has detail panel with close button"],
  [ledgerCss.includes("ledger-entry") && ledgerCss.includes("ledger-category-badge"), "ledger CSS styles entry cards and category badges"],
  [ledgerCss.includes('[data-category="upload_event"]') && ledgerCss.includes('[data-category="issue_report"]'), "ledger CSS has distinct colour rules for upload_event and issue_report"],
  [ledgerCss.includes('[data-outcome="success"]') && ledgerCss.includes('[data-outcome="failure"]'), "ledger CSS colours outcome indicators"],
  [ledgerJs.includes("fetchEntries") && ledgerJs.includes("renderEntries"), "ledger JS fetches and renders entries"],
  [ledgerJs.includes("nextBefore") && ledgerJs.includes("Load more"), "ledger JS supports paginated load-more"],
  [ledgerJs.includes("showDetail") && ledgerJs.includes("detailPanel"), "ledger JS opens a detail panel for individual entries"],
  [ledgerJs.includes("escHtml") && ledgerJs.includes("replace"), "ledger JS escapes HTML to prevent XSS in rendered entries"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nHalo Ledger contracts: ${checks.length}/${checks.length} checks passed.`);
}
