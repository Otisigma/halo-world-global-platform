import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [helper, healthHelper, migration, reconcileFunction, unifiedUpload, uploadPipeline, catalogApi, dreamweaver] = await Promise.all([
  read("netlify/lib/song-publication.mjs"),
  read("netlify/lib/song-publication-health.mjs"),
  read("netlify/database/migrations/20260919130000_create_song_publication_sync.sql"),
  read("netlify/functions/song-publication-reconcile.mjs"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("dreamweaver/dreamweaver.js"),
]);

assert.match(helper, /halo_release_campaigns/, "publication helper must upsert public release campaigns");
assert.match(helper, /halo_release_audio_versions/, "publication helper must sync release audio versions from song versions");
assert.match(helper, /halo_radio_tracks/, "publication helper must reconcile radio track fan-out");
assert.match(helper, /halo_song_publication_sync/, "publication helper must persist durable publication sync state");
assert.match(helper, /appendLedgerEntry/, "publication helper must write ledger entries for reconciliation results");
assert.match(helper, /buildPublicationHealth/, "publication helper must derive artist-facing health snapshots during reconciliation");
assert.match(helper, /errorStreak/, "publication helper must track deterministic retry escalation state");
assert.match(helper, /radio_master_missing_or_not_uploaded/, "publication helper must keep a deterministic radio fallback reason");
assert.match(helper, /\/music\/\?song=/, "publication helper must derive canonical public song URLs");
assert.match(helper, /COALESCE\(sync\.details->>'escalatedAt', ''\) = ''/, "publication batch reconcile must stop auto-retrying escalated rows until the song changes again");

assert.match(healthHelper, /published_and_fully_distributed/, "publication health helper must classify fully distributed songs");
assert.match(healthHelper, /awaiting_release_propagation/, "publication health helper must classify release propagation waits");
assert.match(healthHelper, /awaiting_radio_ready_assets/, "publication health helper must classify radio asset waits");
assert.match(healthHelper, /awaiting_dreamweaver_share_readiness/, "publication health helper must classify Dreamweaver share waits");
assert.match(healthHelper, /waiting_on_artist_action/, "publication health helper must classify artist-owned blockers");
assert.match(healthHelper, /waiting_on_internal_repair/, "publication health helper must classify internal repair states");
assert.match(healthHelper, /escalated/, "publication health helper must classify escalated publication issues");
assert.match(healthHelper, /recommendedFixes/, "publication health helper must return deterministic artist guidance");
assert.match(healthHelper, /agentTeam/, "publication health helper must expose the distributor agent team state");

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_song_publication_sync/, "migration must create durable publication sync storage");
assert.match(migration, /release_status/, "migration must track public release reconciliation state");
assert.match(migration, /radio_status/, "migration must track radio reconciliation state");
assert.match(migration, /dreamweaver_status/, "migration must track Dreamweaver sharing readiness");

assert.match(reconcileFunction, /reconcilePublishedSongs/, "scheduled reconciler must invoke published-song repair");
assert.match(reconcileFunction, /schedule: "\*\/15 \* \* \* \*"/, "scheduled reconciler must run on an automated cadence");
assert.match(reconcileFunction, /path: "\/api\/song-publication-reconcile"/, "scheduled reconciler must expose a manual repair endpoint");

assert.match(unifiedUpload, /reconcilePublishedSong/, "unified upload pipeline must trigger publication fan-out on publish");
assert.match(uploadPipeline, /reconcilePublishedSong/, "upload pipeline must trigger publication fan-out on publish");
assert.match(catalogApi, /attachPublicationHealth/, "song catalog API must attach publication health to artist songs");
assert.match(catalogApi, /buildPublicationHealth/, "song catalog API must reuse the deterministic publication health helper");
assert.match(dreamweaver, /new URL\("\/music\/", location\.origin\)/, "Dreamweaver share flow must target the canonical published-song URL");

console.log("Song publication contracts passed.");
