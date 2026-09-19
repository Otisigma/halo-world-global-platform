import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [helper, publicationHealthHelper, migration, reconcileFunction, unifiedUpload, uploadPipeline, dreamweaver, songCatalog] = await Promise.all([
  read("netlify/lib/song-publication.mjs"),
  read("netlify/lib/publication-health.mjs"),
  read("netlify/database/migrations/20260919130000_create_song_publication_sync.sql"),
  read("netlify/functions/song-publication-reconcile.mjs"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("dreamweaver/dreamweaver.js"),
  read("netlify/functions/song-catalog.ts"),
]);

assert.match(helper, /halo_release_campaigns/, "publication helper must upsert public release campaigns");
assert.match(helper, /halo_release_audio_versions/, "publication helper must sync release audio versions from song versions");
assert.match(helper, /halo_radio_tracks/, "publication helper must reconcile radio track fan-out");
assert.match(helper, /halo_song_publication_sync/, "publication helper must persist durable publication sync state");
assert.match(helper, /appendLedgerEntry/, "publication helper must write ledger entries for reconciliation results");
assert.match(helper, /radio_master_missing_or_not_uploaded/, "publication helper must keep a deterministic radio fallback reason");
assert.match(helper, /\/music\/\?song=/, "publication helper must derive canonical public song URLs");
assert.match(helper, /buildPublicationHealth/, "publication helper must derive deterministic publication health summaries");
assert.match(helper, /PUBLICATION_MONITOR_WINDOW_MINUTES/, "publication helper must use a shared publication monitor window");

assert.match(publicationHealthHelper, /IN_HOUSE_DISTRIBUTOR_TEAM/, "publication health helper must define the in-house distributor team");
assert.match(publicationHealthHelper, /deliveryState/, "publication health helper must classify songs into delivery states");
assert.match(publicationHealthHelper, /checklist/, "publication health helper must generate artist-facing next-step checklists");
assert.match(publicationHealthHelper, /Dreamweaver share/, "publication health helper must surface Dreamweaver share readiness");

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_song_publication_sync/, "migration must create durable publication sync storage");
assert.match(migration, /release_status/, "migration must track public release reconciliation state");
assert.match(migration, /radio_status/, "migration must track radio reconciliation state");
assert.match(migration, /dreamweaver_status/, "migration must track Dreamweaver sharing readiness");

assert.match(reconcileFunction, /reconcilePublishedSongs/, "scheduled reconciler must invoke published-song repair");
assert.match(reconcileFunction, /schedule: "\*\/15 \* \* \* \*"/, "scheduled reconciler must run on an automated cadence");
assert.match(reconcileFunction, /path: "\/api\/song-publication-reconcile"/, "scheduled reconciler must expose a manual repair endpoint");

assert.match(unifiedUpload, /reconcilePublishedSong/, "unified upload pipeline must trigger publication fan-out on publish");
assert.match(uploadPipeline, /reconcilePublishedSong/, "upload pipeline must trigger publication fan-out on publish");
assert.match(dreamweaver, /new URL\("\/music\/", location\.origin\)/, "Dreamweaver share flow must target the canonical published-song URL");
assert.match(songCatalog, /recheck_publication/, "song catalog API must expose a manual publication recheck action");

console.log("Song publication contracts passed.");
