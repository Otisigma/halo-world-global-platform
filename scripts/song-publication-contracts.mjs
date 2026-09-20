import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveDreamweaverPageFlow } from "../netlify/lib/dreamweaver-page-manager.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [helper, manager, migration, reconcileFunction, scheduledReconcileFunction, unifiedUpload, uploadPipeline, dreamweaver, releaseCatalog, releaseLink] = await Promise.all([
  read("netlify/lib/song-publication.mjs"),
  read("netlify/lib/dreamweaver-page-manager.mjs"),
  read("netlify/database/migrations/20260919130000_create_song_publication_sync.sql"),
  read("netlify/functions/song-publication-reconcile.mjs"),
  read("netlify/functions/song-publication-reconcile-scheduled.mjs"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("dreamweaver/dreamweaver.js"),
  read("netlify/functions/release-catalog.mjs"),
  read("netlify/functions/release-link.mjs"),
]);
const sampleSongId = "11111111-1111-4111-8111-111111111111";
const managedDreamweaverFlow = resolveDreamweaverPageFlow(sampleSongId, {
  mixId: "sample-release",
  publicUrl: "/music/?song=sample-release",
  streamUrl: "https://cdn.halo.world/audio/sample-track.mp3",
  relatedUrls: ["/api/release-link?slug=sample-release&audience=fan"],
  promoUrls: ["/release-kit.html?slug=sample-release&audience=fan"],
});
const hyperfollowDreamweaverFlow = resolveDreamweaverPageFlow(sampleSongId, {
  publicUrl: "/music/?song=sample-release",
  officialUrl: "https://distrokid.com/hyperfollow/owenanthony/sample-track",
});

assert.match(helper, /halo_release_campaigns/, "publication helper must upsert public release campaigns");
assert.match(helper, /halo_release_audio_versions/, "publication helper must sync release audio versions from song versions");
assert.match(helper, /halo_radio_tracks/, "publication helper must reconcile radio track fan-out");
assert.match(helper, /halo_song_publication_sync/, "publication helper must persist durable publication sync state");
assert.match(helper, /appendLedgerEntry/, "publication helper must write ledger entries for reconciliation results");
assert.match(helper, /resolveDreamweaverPageFlow/, "publication helper must delegate Dreamweaver page decisions to the dedicated manager");
assert.match(helper, /radio_master_missing_or_not_uploaded/, "publication helper must keep a deterministic radio fallback reason");
assert.match(helper, /\/music\/\?song=/, "publication helper must derive canonical public song URLs");
assert.match(helper, /launchUrl/, "publication helper must persist the resolved Dreamweaver launch destination");
assert.ok(helper.includes("official_url = CASE") && helper.includes("official_url ~* '^/api/song-catalog/audio\\\\?(?:[^#]*&)?versionId="), "publication helper must replace legacy song-catalog audio navigation URLs during release upserts");

assert.match(manager, /manage_dreamweaver_song_page/, "Dreamweaver page manager must have a single page-management purpose");
assert.match(manager, /dreamweaverHubPath/, "Dreamweaver page manager must define a dedicated canonical hub resolver");
assert.equal(managedDreamweaverFlow.managed, true, "songs without HyperFollow must get a managed Dreamweaver page");
assert.equal(managedDreamweaverFlow.hubUrl, "/dreamweaver/?mix=sample-release", "Dreamweaver manager must emit a canonical mix-aware hub URL");
assert.equal(managedDreamweaverFlow.launchUrl, "/dreamweaver/?mix=sample-release", "songs without HyperFollow must launch into the Dreamweaver hub flow");
assert.equal(managedDreamweaverFlow.page?.route, `/dreamweaver/satellite/${sampleSongId}/`, "Dreamweaver manager must preserve deterministic satellite routes");
assert.equal(managedDreamweaverFlow.page?.hubUrl, "/dreamweaver/?mix=sample-release", "Dreamweaver page metadata must expose canonical hub URL");
assert.ok(
  managedDreamweaverFlow.loop?.linkedPages?.includes("/music/?song=sample-release")
    && managedDreamweaverFlow.loop?.linkedPages?.includes("/api/release-link?slug=sample-release&audience=fan")
    && managedDreamweaverFlow.loop?.linkedPages?.includes("/release-kit.html?slug=sample-release&audience=fan"),
  "Dreamweaver loop metadata must link hub, sales/release pages, and related promo pages"
);
assert.equal(managedDreamweaverFlow.manager?.id, `dreamweaver-page-manager-${sampleSongId}`, "Dreamweaver page manager IDs must be deterministic per song");
assert.equal(hyperfollowDreamweaverFlow.hasHyperfollow, true, "HyperFollow releases must be detected");
assert.equal(hyperfollowDreamweaverFlow.managed, false, "HyperFollow releases must not be replaced by managed Dreamweaver pages");
assert.equal(hyperfollowDreamweaverFlow.launchUrl, "https://distrokid.com/hyperfollow/owenanthony/sample-track", "HyperFollow releases must keep their existing HyperFollow destination");
assert.ok(
  hyperfollowDreamweaverFlow.loop?.linkedPages?.includes("https://distrokid.com/hyperfollow/owenanthony/sample-track"),
  "HyperFollow loop metadata must retain the HyperFollow destination"
);
assert.ok(
  !hyperfollowDreamweaverFlow.loop?.linkedPages?.some(page => page.startsWith("/dreamweaver/?mix=")),
  "HyperFollow loop metadata must not advertise managed Dreamweaver hub routing"
);

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_song_publication_sync/, "migration must create durable publication sync storage");
assert.match(migration, /release_status/, "migration must track public release reconciliation state");
assert.match(migration, /radio_status/, "migration must track radio reconciliation state");
assert.match(migration, /dreamweaver_status/, "migration must track Dreamweaver sharing readiness");

assert.match(reconcileFunction, /reconcilePublishedSongs/, "manual reconciler must invoke published-song repair");
assert.match(reconcileFunction, /path: "\/api\/song-publication-reconcile"/, "reconciler must expose a manual repair endpoint");
assert.doesNotMatch(reconcileFunction, /schedule:/, "manual reconciler must not also be configured as a scheduled function");
assert.match(scheduledReconcileFunction, /runReconcile/, "scheduled reconciler must invoke published-song repair");
assert.match(scheduledReconcileFunction, /schedule: "\*\/15 \* \* \* \*"/, "scheduled reconciler must run on an automated cadence");
assert.doesNotMatch(scheduledReconcileFunction, /path:/, "scheduled reconciler must not specify a custom path");

assert.match(unifiedUpload, /reconcilePublishedSong/, "unified upload pipeline must trigger publication fan-out on publish");
assert.match(uploadPipeline, /reconcilePublishedSong/, "upload pipeline must trigger publication fan-out on publish");
assert.match(dreamweaver, /new URL\("\/music\/", location\.origin\)/, "Dreamweaver share flow must target the canonical published-song URL");
assert.match(dreamweaver, /dreamweaverPage\?\.manager/, "Dreamweaver page must use the dedicated page manager metadata when available");
assert.match(releaseCatalog, /dreamweaverPage/, "release catalog must expose Dreamweaver page metadata for song-linked releases");
assert.match(releaseCatalog, /resolveDreamweaverPageFlow/, "release catalog must derive Dreamweaver page state through the shared manager");
assert.match(releaseCatalog, /dreamweaverHubUrl/, "release catalog must serialize canonical Dreamweaver hub metadata");
assert.match(releaseCatalog, /dreamweaverLoop/, "release catalog must serialize linked Dreamweaver loop metadata");
assert.match(releaseLink, /remapLegacyAudioDestination/, "release-link handler must guard against legacy song-catalog audio entry URLs");
assert.match(releaseLink, /resolveDreamweaverPageFlow/, "release-link handler must reroute legacy audio entries into managed Dreamweaver pages");
assert.match(releaseLink, /flow\.launchUrl/, "release-link legacy remapping must route through the hub-aware Dreamweaver launch flow");

console.log("Song publication contracts passed.");
