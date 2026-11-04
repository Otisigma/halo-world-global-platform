import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { resolveDreamweaverPageFlow } from "../netlify/lib/dreamweaver-page-manager.mjs";
import { forcePushTrack, planRadioShowProposal, reconcilePublishedSong, reconcilePublishedSongs, releaseVersionType, verifiedVersion } from "../netlify/lib/song-publication.mjs";
import { attachPublicationHealthToSongs, buildPublicationHealth, isShopBlockingIssue } from "../netlify/lib/song-publication-health.mjs";
import { buildMasterObjectKey } from "../netlify/lib/direct-upload-storage.mjs";
import { createPublicationReconcileHandler } from "../netlify/functions/song-publication-reconcile.mjs";
import { createForcePushTrackHandler } from "../netlify/functions/catalog-force-push-track.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [helper, manager, healthHelper, migration, reconcileFunction, scheduledReconcileFunction, unifiedUpload, uploadPipeline, catalogApi, dreamweaver, releaseCatalog, releaseLink] = await Promise.all([
  read("netlify/lib/song-publication.mjs"),
  read("netlify/lib/dreamweaver-page-manager.mjs"),
  read("netlify/lib/song-publication-health.mjs"),
  read("netlify/database/migrations/20260919130000_create_song_publication_sync.sql"),
  read("netlify/functions/song-publication-reconcile.mjs"),
  read("netlify/functions/song-publication-reconcile-scheduled.mjs"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("dreamweaver/dreamweaver.js"),
  read("netlify/functions/release-catalog.mjs"),
  read("netlify/functions/release-link.mjs"),
]);
const sampleSongId = "11111111-1111-4111-8111-111111111111";
const releaseAudioMigration = await read("netlify/database/migrations/20260812234500_link-release-audio-versions.sql");
const releaseAudioTypes = new Set([...releaseAudioMigration.match(/CHECK \(version_type IN \(([^)]+)\)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
for (const type of ["sale_master", "radio_edit", "clean", "instrumental", "stems", "extended", "demo", "alternate"]) {
  assert.ok(releaseAudioTypes.has(releaseVersionType(type)), `${type} must map to a real release-audio CHECK enum value`);
}
assert.equal(releaseVersionType("sale_master"), "master");
assert.equal(releaseVersionType("radio_edit"), "radio_edit");
assert.equal(releaseVersionType("clean"), "clean");

function approveTrack(track) {
  Object.assign(track, { status: "rotation", reviewed_at: "2026-10-25T12:00:00.000Z", reviewed_by_member_id: "operator-member" });
}

function publicationDatabase() {
  const song = {
    id: sampleSongId, owner_member_id: "owner", owner_actor_id: "actor",
    source_release_id: "release", title: "Current title", artist_name: "Artist", genre: "house",
    status: "active", pipeline_status: "published", rights_status: "cleared", broadcast_requested: true,
    publication_revision: "2026-10-25T12:00:00.000789Z",
  };
  const makeVersion = (id, type) => ({
    id, song_id: song.id, version_type: type, status: "active", mastering_status: "approved",
    updated_at: new Date("2026-10-25T12:00:00.000123Z"),
    publication_revision: "2026-10-25T12:00:00.000123Z",
    audio_blob_prefix: `owner/${id}/upload/parts/`, audio_chunk_count: 1,
    audio_content_type: "audio/mpeg", audio_byte_size: 1000, duration_seconds: 180,
    audio_url: "https://private.example/audio?X-Amz-Signature=do-not-copy",
  });
  const versions = [makeVersion("22222222-2222-4222-8222-222222222222", "sale_master"),
    makeVersion("33333333-3333-4333-8333-333333333333", "radio_edit")];
  const state = { song, versions, blobs: new Map(), tracks: [], releases: new Map(), sync: null, token: "", queries: [], hideBlobConflict: false,
    shows: [{ id: "club-show", room: "club", status: "published",
      day_of_week: (new Date().getUTCDay() + 1) % 7, start_time_utc: "18:00:00" }] };
  const currentRadioEligible = (sourceId, audioId, expectedRevision) => {
    const source = state.versions.find(version => version.id === sourceId);
    const persisted = [...state.blobs.values()].find(blob => blob.id === audioId);
    const campaign = persisted && state.releases.get(persisted.release_id);
    return song.status === "active" && song.pipeline_status === "published" && song.broadcast_requested === true
      && song.rights_status === "cleared" && !(song.metadata_issues || []).some(isShopBlockingIssue)
      && source?.status === "active" && source.mastering_status === "approved" && source.song_id === song.id
      && ["radio_edit", "clean"].includes(source.version_type)
      && source.publication_revision === expectedRevision
      && (!song.explicit_lyrics || source.clean_lyrics === true)
      && persisted?.status === "active" && persisted.rights_confirmed === true
      && persisted.owner_member_id === song.owner_member_id && persisted.version_type === source.version_type
      && persisted.blob_key === source.audio_blob_prefix && persisted.byte_size === source.audio_byte_size
      && persisted.chunk_count === source.audio_chunk_count && persisted.duration_seconds === source.duration_seconds
      && persisted.content_type === source.audio_content_type
      && campaign?.owner_member_id === song.owner_member_id && campaign.status === "published" && campaign.visibility === "public";
  };
  state.db = { async sql(strings, ...values) {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    state.queries.push({ query, values });
    if (query.startsWith("INSERT INTO halo_song_publication_leases")) {
      if (state.token || values[1] !== song.id || values[2] !== song.owner_member_id) return [];
      state.token = values[0]; return [{ song_id: song.id }];
    }
    if (query.startsWith("DELETE FROM halo_song_publication_leases")) {
      if (state.token === values[1]) state.token = "";
      return [];
    }
    if (query.includes("FROM halo_song_catalog song")) return [{ ...song }];
    if (query.startsWith("SELECT") && query.includes("FROM halo_song_versions")) return versions.map(version => ({ ...version }));
    if (query.startsWith("UPDATE halo_song_catalog SET source_release_id")) {
      assert.equal(values[1], song.id);
      assert.equal(values[2], song.owner_member_id);
      assert.equal(values[3], song.publication_revision, "linking the release must not bless an intervening catalog edit");
      song.source_release_id = values[0];
      song.publication_revision = "2026-10-25T12:00:00.001001Z";
      return [{ publication_revision: song.publication_revision }];
    }
    if (query.includes("FROM halo_song_publication_sync")) return state.sync ? [state.sync] : [];
    if (query.includes("FROM halo_radio_shows")) {
      assert.match(query, /WHERE room = \? AND status = 'published'/);
      return state.shows.filter(show => show.room === values[0] && show.status === "published");
    }
    if (query.startsWith("SELECT id, owner_member_id FROM halo_release_campaigns")) return state.releases.has(values[0]) ? [state.releases.get(values[0])] : [];
    if (query.startsWith("SELECT artwork_url, official_url")) {
      const release = state.releases.get(values[0]);
      return release?.owner_member_id === values[1] ? [release] : [];
    }
    if (query.startsWith("SELECT owner_member_id, release_id, version_type, status")) {
      return !state.hideBlobConflict && state.blobs.has(values[0]) ? [state.blobs.get(values[0])] : [];
    }
    if (query.startsWith("INSERT INTO halo_release_campaigns")) {
      assert.match(query, /WHERE halo_release_campaigns.owner_member_id = EXCLUDED.owner_member_id/);
      const existing = state.releases.get(values[0]);
      if (existing && existing.owner_member_id !== values[1]) return [];
      const release = { id: values[0], owner_member_id: values[1], title: values[3], artwork_url: values[6], official_url: values[7], stream_url: values.at(-1), status: "draft" };
      state.releases.set(release.id, release); return [release];
    }
    if (query.startsWith("UPDATE halo_release_campaigns release")) {
      state.beforeMasterPublication?.();
      assert.match(query, /master.mastering_status = 'approved'/);
      assert.match(query, /release.owner_member_id = \?/);
      assert.match(query, /COALESCE\(master.audio_blob_prefix, ''\)/);
      assert.match(query, /COALESCE\(master.audio_storage_key, ''\)/);
      assert.match(query, /jsonb_array_elements/);
      assert.match(query, /NOT IN \('radio_edit', 'radio_audio', 'radio_master'\)/);
      const release = state.releases.get(values[0]);
      const master = state.versions.find(version => version.id === values[4]);
      if (!release || release.owner_member_id !== values[1] || song.rights_status !== "cleared"
        || song.status !== "active" || song.pipeline_status !== "published"
        || (song.metadata_issues || []).some(isShopBlockingIssue)
        || master?.status !== "active" || master.mastering_status !== "approved" || master.song_id !== song.id
        || (master.audio_blob_prefix || "") !== values[5] || (master.audio_storage_key || "") !== values[6]
        || master.publication_revision !== values[7] || song.publication_revision !== values[12]
        || Number(master.audio_chunk_count || 0) !== values[8] || master.duration_seconds !== values[9]
        || master.audio_byte_size !== values[10] || master.audio_content_type !== values[11]) return [];
      release.status = "published"; release.visibility = "public"; return [{ id: release.id }];
    }
    if (query.startsWith("INSERT INTO halo_release_audio_versions")) {
      assert.ok(releaseAudioTypes.has(values[3]), "real SQL release-audio type constraints must be enforced by the mock");
      assert.ok(values[4].length >= 1 && values[4].length <= 80, "handoff labels must satisfy the unchanged SQL CHECK");
      assert.match(query, /halo_release_audio_versions.owner_member_id = EXCLUDED.owner_member_id/);
      assert.match(query, /halo_release_audio_versions.release_id = EXCLUDED.release_id/);
      assert.match(query, /halo_release_audio_versions.version_type = EXCLUDED.version_type/);
      assert.match(query, /halo_release_audio_versions.status = 'active'/);
      const existing = state.blobs.get(values[5]);
      if (existing && (existing.owner_member_id !== values[2] || existing.release_id !== values[1]
        || existing.version_type !== values[3] || existing.status !== "active")) return [];
      const blob = { id: existing?.id || values[0], release_id: values[1], owner_member_id: values[2],
        version_type: values[3], blob_key: values[5], chunk_count: values[6], content_type: values[7],
        byte_size: values[8], duration_seconds: values[9], rights_confirmed: true, status: "active" };
      state.blobs.set(blob.blob_key, blob); return [blob];
    }
    if (query.includes("SELECT id, status, member_id")) {
      assert.match(query, /status IN \('preview', 'rotation', 'held', 'rejected'\)/);
      if (state.expireLease) state.token = "new-lease-holder";
      return state.tracks.map(track => ({ ...track }));
    }
    if (query.startsWith("SELECT track.id, track.status")) {
      state.beforeRadioVerify?.();
      assert.match(query, /catalog.broadcast_requested = TRUE/);
      assert.match(query, /source.mastering_status = 'approved'/);
      assert.match(query, /source.updated_at = \?::timestamptz/);
      const track = state.tracks.find(track => track.id === values[0]);
      const persisted = [...state.blobs.values()].find(blob => blob.id === values[11]);
      const source = state.versions.find(version => version.id === values[3]);
      if (!track || !persisted || !currentRadioEligible(values[3], values[11], values[5])
        || song.publication_revision !== values[14]
        || source.version_type !== values[4] || source.audio_blob_prefix !== values[6] || source.audio_byte_size !== values[7]
        || source.audio_chunk_count !== values[8] || source.duration_seconds !== values[9] || source.audio_content_type !== values[10]
        || track.member_id !== song.owner_member_id || track.release_id !== values[12] || track.audio_version_id !== persisted.id
        || track.blob_key !== persisted.blob_key || track.byte_size !== persisted.byte_size
        || track.chunk_count !== persisted.chunk_count || track.duration_seconds !== persisted.duration_seconds
        || track.content_type !== persisted.content_type || track.room !== values[13] || !track.rights_confirmed
        || !["preview", "rotation", "held"].includes(track.status)) return [];
      return [{ id: track.id, status: track.status, reviewed_at: track.reviewed_at, reviewed_by_member_id: track.reviewed_by_member_id }];
    }
    if (query.startsWith("WITH lease AS")) {
      state.beforeRadioWrite?.();
      assert.match(query, /token = \?/);
      assert.match(query, /WHERE NOT EXISTS/);
      assert.match(query, /status IN \('preview', 'rotation', 'held', 'rejected'\)/);
      assert.match(query, /catalog.broadcast_requested = TRUE/);
      assert.match(query, /source.mastering_status = 'approved'/);
      assert.match(query, /FOR UPDATE OF catalog, source, persisted, campaign/);
      const source = state.versions.find(version => version.id === values[27]);
      if (values[1] !== state.token || state.tracks.length || !currentRadioEligible(values[27], values[24], values[29])
        || song.publication_revision !== values[36]
        || source.version_type !== values[28] || source.audio_blob_prefix !== values[30] || source.audio_byte_size !== values[31]
        || source.audio_chunk_count !== values[32] || source.duration_seconds !== values[33] || source.audio_content_type !== values[34]) return [];
      const track = { id: values[2], member_id: values[3], release_id: values[6], audio_version_id: values[8],
        room: values[9], blob_key: values[14], chunk_count: values[15], content_type: values[16],
        byte_size: values[17], duration_seconds: values[18], rights_confirmed: true, status: "preview" };
      state.tracks.push(track); return [{ id: track.id }];
    }
    if (query.startsWith("INSERT INTO halo_song_publication_sync")) {
      state.sync = { song_id: values[0], release_id: values[2], radio_track_id: values[3], canonical_url: values[4],
        release_status: values[5], radio_status: values[6], dreamweaver_status: values[7],
        details: JSON.parse(values[8]), last_error: values[9] };
      return [];
    }
    if (query.startsWith("INSERT INTO halo_ledger")) return [];
    throw new Error(`Unexpected safety contract SQL: ${query}`);
  }};
  state.reconcile = (options = {}) => reconcilePublishedSong(state.db, { songId: song.id, ownerMemberId: song.owner_member_id, recordLedger: false, ...options });
  return state;
}

{
  const fixture = publicationDatabase();
  const first = await fixture.reconcile();
  assert.equal(first.radioStatus, "preview", "only an operator may promote a prepared track");
  assert.equal(first.publicationHealth.radioReady, false);
  assert.equal(first.publicationHealth.dreamweaverReady, false, "a calculated share route is not confirmation");
  assert.equal(first.publicationHealth.releaseReady, true);
  assert.match(first.publicationHealth.failureReasons.join(" "), /audition preview only.*not in broadcast rotation/i);
  assert.match(first.publicationHealth.failureReasons.join(" "), /Operator-only proposal: club-show.*Club room.*not booked or approved/);
  assert.equal(fixture.sync.details.radio.proposedShowId, "club-show");
  assert.equal(fixture.sync.details.radio.proposedRoom, "club");
  assert.equal(fixture.sync.details.radio.approvalRequired, true);
  const proposedStartsAt = fixture.sync.details.radio.proposedStartsAt;
  fixture.song.title = "Edited canonical title";
  fixture.versions[0].audio_url = "https://private.example/replacement?signature=secret";
  const second = await fixture.reconcile();
  assert.equal(second.radioStatus, "preview", "reconciliation must preserve preview approval");
  assert.equal(fixture.tracks.length, 1, "repeated reconciliation must reuse the same track");
  assert.equal(fixture.sync.details.radio.proposedStartsAt, proposedStartsAt, "future draft proposals must remain stable across retries");
  assert.equal(fixture.releases.get("release").title, "Edited canonical title");
  assert.match(fixture.releases.get("release").stream_url, /^\/api\/song-catalog\/audio\?versionId=.*&dreamweaver=1&songId=/);
  assert.ok(!JSON.stringify([...fixture.releases.values(), fixture.sync]).includes("private.example"));
  fixture.tracks[0].status = "held";
  const held = await fixture.reconcile();
  assert.equal(held.radioStatus, "held", "held tracks require operator approval");
  assert.match(held.publicationHealth.failureReasons.join(" "), /held for operator review.*not in broadcast rotation/i);
  approveTrack(fixture.tracks[0]);
  assert.equal((await fixture.reconcile()).publicationHealth.radioReady, true);
  const healthSong = {
    id: fixture.song.id, rightsStatus: "cleared", broadcastRequested: true,
    versions: fixture.versions.map(version => ({
      id: version.id, versionType: version.version_type, status: version.status,
      masteringStatus: version.mastering_status, persistedAudio: true,
      durationSeconds: version.duration_seconds, updatedAt: version.updated_at,
    })),
  };
  const healthSync = {
    releaseId: "release", canonicalUrl: "/music/?song=release", releaseStatus: "published",
    radioTrackId: fixture.tracks[0].id, radioStatus: "rotation", dreamweaverStatus: "ready",
    details: fixture.sync.details,
  };
  assert.equal(buildPublicationHealth(healthSong, healthSync).radioReady, true);
  for (const radioStatus of ["draft", "preview", "held"]) {
    assert.equal(buildPublicationHealth(healthSong, { ...healthSync, radioStatus }).radioReady, false);
  }
  assert.equal(buildPublicationHealth({ ...healthSong, broadcastRequested: false }, healthSync).radioReady, false);
  assert.equal(buildPublicationHealth(healthSong, {
    ...healthSync, details: { ...healthSync.details, radio: { ...healthSync.details.radio, operatorReviewed: false } },
  }).radioReady, false, "status-only legacy rotation must not count as reached without persisted operator review");
  healthSong.versions[1].updatedAt = "2026-10-25T13:00:00Z";
  assert.equal(buildPublicationHealth(healthSong, healthSync).radioReady, false, "changed radio version inputs invalidate old confirmation");
  healthSong.versions[0].updatedAt = "2026-10-25T13:00:00Z";
  assert.equal(buildPublicationHealth(healthSong, healthSync).releaseReady, false, "changed sale-master inputs invalidate old confirmation");
  fixture.tracks[0].member_id = "other-owner";
  assert.equal((await fixture.reconcile()).publicationHealth.radioReady, false, "foreign tracks cannot be confirmed");
  assert.equal(fixture.tracks[0].member_id, "other-owner", "existing user tracks must not be overwritten");
}
for (const type of ["radio_edit", "clean", "instrumental", "stems", "extended", "demo", "alternate"]) {
  const fixture = publicationDatabase();
  fixture.versions[1].version_type = type;
  await fixture.reconcile();
  assert.equal(fixture.blobs.get(fixture.versions[0].audio_blob_prefix).version_type, "master");
  assert.equal(fixture.blobs.get(fixture.versions[1].audio_blob_prefix).version_type, releaseVersionType(type),
    "every supported catalog version must satisfy the unchanged release-audio SQL enum");
}
{
  const fixture = publicationDatabase();
  fixture.versions[0].label = "Reviewed catalog label ".repeat(5).slice(0, 100);
  const originalLabel = fixture.versions[0].label;
  await fixture.reconcile();
  const handoff = fixture.queries.find(({ query }) => query.startsWith("INSERT INTO halo_release_audio_versions"));
  assert.equal(handoff.values[4].length, 80, "release handoff labels must be bounded independently of catalog labels");
  assert.equal(fixture.versions[0].label, originalLabel, "distribution must not mutate the original reviewed catalog label");
}
for (const broadcastRequested of [false, true]) {
  const fixture = publicationDatabase();
  fixture.song.broadcast_requested = broadcastRequested;
  fixture.versions.splice(1);
  fixture.song.metadata_issues = ["radio_edit", "radio_audio", "radio_master"]
    .map(field => ({ field, level: "required", message: "Prepare radio audio." }));
  const result = await fixture.reconcile();
  assert.equal(result.ok, true);
  assert.equal(result.publicationHealth.releaseReady, true, "radio-only review blockers must not block an approved shop master");
  assert.equal(result.radioStatus, "queued");
  assert.equal(fixture.releases.get("release").status, "published");
}
{
  const fixture = publicationDatabase();
  fixture.song.source_release_id = "";
  const result = await fixture.reconcile();
  assert.equal(result.ok, true);
  assert.equal(fixture.song.publication_revision, "2026-10-25T12:00:00.001001Z");
  assert.ok(fixture.queries.some(({ query, values }) => query.startsWith("UPDATE halo_release_campaigns release")
    && values[7] === "2026-10-25T12:00:00.000123Z" && values[12] === fixture.song.publication_revision),
  "master and song timestamp guards must use lossless six-digit database revisions, including the source-release handoff update");
  assert.ok(fixture.queries.some(({ query }) => query.includes('TO_CHAR(updated_at AT TIME ZONE')
    && query.includes('SS.US"Z"')), "database microseconds must be selected as text before adapters truncate Dates");
}
for (const mutate of [
  state => { state.song.rights_status = "pending"; },
  state => { state.versions[0].mastering_status = "queued"; },
  state => { state.versions[0].duration_seconds = 0; },
  state => { state.versions[0].status = "archived"; },
  state => { state.versions[0].audio_blob_prefix = ""; },
  state => { state.versions[0].song_id = "another-song"; },
  state => { state.versions[0].audio_blob_prefix = "another-owner/master/parts/"; },
  state => { state.versions[0].audio_storage_key = "another-owner/private-master.wav"; },
  state => { state.versions[0].audio_storage_key = buildMasterObjectKey({
    ownerMemberId: "owner", songId: state.song.id, versionId: state.versions[0].id,
    uploadId: "ambiguous-upload", filename: "master.wav",
  }); },
]) {
  const fixture = publicationDatabase(); mutate(fixture);
  await assert.rejects(fixture.reconcile(), /approved, active, uploaded sale master/);
  assert.equal(fixture.releases.size, 0, "unsafe masters cannot be handed off to public release pages");
  assert.equal(fixture.token, "", "failure must release the durable lease");
}
for (const patch of [{ owner_member_id: "foreign" }, { release_id: "different-release" }, { version_type: "clean" }, { status: "archived" }]) {
  for (const racing of [false, true]) {
    const fixture = publicationDatabase();
    const blob = { owner_member_id: "owner", release_id: "release", version_type: "master", status: "active", ...patch };
    fixture.blobs.set(fixture.versions[0].audio_blob_prefix, blob);
    fixture.hideBlobConflict = racing;
    await assert.rejects(fixture.reconcile(), /ownership or archived blob conflict/);
    assert.deepEqual(fixture.blobs.get(fixture.versions[0].audio_blob_prefix), blob, "blob upserts cannot steal or reactivate existing audio");
    assert.ok(![...fixture.releases.values()].some(release => release.status === "published"),
      "new releases must remain private until persisted audio upserts are verified");
  }
}
for (const mutate of [
  state => { state.song.broadcast_requested = false; },
  state => { state.song.genre = "unmapped-genre"; },
  state => { state.versions[1].mastering_status = "queued"; },
  state => { state.versions[1].duration_seconds = 0; },
  state => { state.song.explicit_lyrics = true; },
]) {
  const fixture = publicationDatabase(); mutate(fixture);
  const result = await fixture.reconcile();
  assert.equal(result.radioStatus, "queued"); assert.equal(fixture.tracks.length, 0);
}
for (const [mutate, message] of [
  [state => { state.song.broadcast_requested = false; }, /Radio was not requested.*Enable broadcast intent/i],
  [state => { state.song.genre = "unmapped-genre"; }, /no supported radio room.*radio operator/i],
]) {
  const fixture = publicationDatabase(); mutate(fixture);
  assert.match((await fixture.reconcile()).publicationHealth.failureReasons.join(" "), message,
    "catalog health must expose actionable radio blockers rather than hide them in raw sync JSON");
}
for (const type of ["radio_edit", "clean"]) {
  const fixture = publicationDatabase();
  fixture.song.explicit_lyrics = true;
  fixture.versions[1].version_type = type;
  fixture.versions[1].clean_lyrics = true;
  assert.equal((await fixture.reconcile()).radioStatus, "preview", "explicit songs require an explicitly confirmed clean broadcast version");
}
{
  const fixture = publicationDatabase();
  fixture.releases.set("release", { id: "release", owner_member_id: "owner",
    artwork_url: "https://cdn.halo.world/artwork/reviewed-cover.webp",
    official_url: "https://distrokid.com/hyperfollow/artist/reviewed-song?ref=release-pack",
    stream_url: "https://private.example/audio?signature=secret" });
  await fixture.reconcile({ preserveReleaseMetadata: true });
  assert.equal(fixture.releases.get("release").artwork_url, "https://cdn.halo.world/artwork/reviewed-cover.webp");
  assert.equal(fixture.releases.get("release").official_url, "https://distrokid.com/hyperfollow/artist/reviewed-song");
  assert.match(fixture.releases.get("release").stream_url, /^\/api\/song-catalog\/audio\?/,
    "preserving reviewed artwork/navigation must never preserve private audio references");
  fixture.releases.get("release").artwork_url = `/api/song-catalog/artwork?songId=${fixture.song.id}`;
  await fixture.reconcile({ preserveReleaseMetadata: true });
  assert.equal(fixture.releases.get("release").artwork_url, `/api/song-catalog/artwork?songId=${fixture.song.id}`,
    "bound canonical public artwork proxies must survive reviewed metadata preservation");
  fixture.releases.get("release").artwork_url = "/api/song-catalog/artwork?songId=another-song";
  await fixture.reconcile({ preserveReleaseMetadata: true });
  assert.equal(fixture.releases.get("release").artwork_url, "", "reviewed artwork proxies cannot silently change song ownership/binding");
  fixture.releases.get("release").artwork_url = "https://cdn.halo.world/private/master.jpg?signature=secret";
  fixture.releases.get("release").official_url = "https://distrokid.com/hyperfollow/artist/reviewed-song?signature=secret";
  await fixture.reconcile({ preserveReleaseMetadata: true });
  assert.equal(fixture.releases.get("release").artwork_url, "");
  assert.equal(new URL(fixture.releases.get("release").official_url, "https://halo.world").hostname, "halo.world",
    "signed navigation must fall back to the canonical internal destination");
}
{
  const artworkApi = await read("netlify/functions/song-catalog-artwork.ts");
  const serveSource = stripTypeScriptTypes(artworkApi.slice(artworkApi.indexOf("async function serveArtwork("), artworkApi.indexOf("async function deleteArtwork(")));
  const completeSource = stripTypeScriptTypes(artworkApi.slice(artworkApi.indexOf("function hasCompleteChunkSet("), artworkApi.indexOf("async function ownedSong(")));
  const fixture = publicationDatabase();
  const master = fixture.versions[0];
  master.artwork_blob_prefix = `owner/${fixture.song.id}/${master.id}/artwork/parts/`;
  master.artwork_content_type = "image/webp";
  await fixture.reconcile();
  const artworkUrl = fixture.releases.get("release").artwork_url;
  const params = new URL(artworkUrl, "https://halo.world").searchParams;
  assert.equal(params.get("songId"), fixture.song.id);
  assert.equal(params.get("versionId"), master.id, "version artwork must include both endpoint binding ids");
  const bytes = new Uint8Array([1, 2, 3]);
  const calls = [];
  const record = {
    artwork_blob_prefix: master.artwork_blob_prefix, artwork_chunk_count: 1,
    artwork_byte_size: bytes.byteLength, artwork_content_type: "image/webp",
  };
  const serve = new Function(
    "cleanId", "ownedVersion", "publicVersion", "ownedSong", "publicSong", "cleanPublicArtworkUrl",
    "DEFAULT_PUBLIC_ARTWORK", "json", "redirectToArtwork", "requestedByteRange", "artworkStore", "readArtworkRange",
    `${completeSource}\n${serveSource}\nreturn serveArtwork;`,
  )(
    value => /^[0-9a-f-]{36}$/.test(value || "") ? value : "",
    () => assert.fail("public artwork must not require owner access"),
    async (_db, songId, versionId) => { calls.push({ songId, versionId }); return songId === fixture.song.id && versionId === master.id ? record : null; },
    () => assert.fail("public artwork must not require owner access"),
    async (_db, songId) => { calls.push({ songId }); return songId === fixture.song.id ? record : null; },
    () => "", "/assets/fallback.webp", (body, status) => Response.json(body, { status }),
    () => assert.fail("valid generated artwork must not fall back"), () => null,
    { list: async ({ prefix }) => ({ blobs: [{ key: `${prefix}000` }] }), get: async () => bytes.buffer },
    () => assert.fail("no range requested"),
  );
  assert.equal((await serve(new Request(`https://halo.world${artworkUrl}`, { method: "HEAD" }), {})).status, 200,
    "generated version artwork must resolve through the real artwork serving function");
  const response = await serve(new Request(`https://halo.world${artworkUrl}`), {});
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal((await serve(new Request(`https://halo.world/api/song-catalog/artwork?versionId=${master.id}`), {})).status, 404,
    "the former version-only route must be recognized as nonfunctional");
  master.artwork_blob_prefix = "";
  fixture.song.artwork_url = `/api/song-catalog/artwork?songId=${fixture.song.id}`;
  await fixture.reconcile();
  const inheritedUrl = fixture.releases.get("release").artwork_url;
  assert.equal(inheritedUrl, fixture.song.artwork_url, "sale masters must inherit the canonical song-level uploaded artwork route");
  assert.equal((await serve(new Request(`https://halo.world${inheritedUrl}`, { method: "HEAD" }), {})).status, 200);
  assert.deepEqual(calls.at(-1), { songId: fixture.song.id });
}
{
  const fixture = publicationDatabase();
  const concurrent = await Promise.all([fixture.reconcile(), fixture.reconcile()]);
  assert.equal(concurrent.filter(result => result.ok).length, 1, "durable lease must serialize concurrent publication");
  assert.equal(fixture.tracks.length, 1);
  fixture.sync.details.errorStreak = 4;
  fixture.sync.details.escalatedAt = "2026-10-01T00:00:00Z";
  const previousProposal = fixture.sync.details.radio.proposedStartsAt;
  fixture.song.rights_status = "pending";
  await assert.rejects(fixture.reconcile());
  assert.equal(fixture.sync.details.errorStreak, 5, "a failed escalation recovery must not reset the failure history");
  assert.equal(fixture.sync.details.escalatedAt, "2026-10-01T00:00:00Z");
  assert.equal(fixture.sync.details.radio.proposedStartsAt, previousProposal, "transient repair failures must preserve the durable operator proposal");
  fixture.song.rights_status = "cleared";
  await fixture.reconcile();
  assert.equal(fixture.sync.details.errorStreak, 0, "only successful authorized recovery clears the failure history");
  const selection = [];
  await reconcilePublishedSongs({ sql: async strings => { selection.push(strings.join("?")); return []; } });
  assert.match(selection[0], /version.updated_at > sync.updated_at/, "version-only changes must reopen escalated recovery");
  assert.match(selection[0], /INTERVAL '1 day'/, "escalated rows need bounded daily recovery");
}
{
  const fixture = publicationDatabase();
  fixture.expireLease = true;
  await assert.rejects(fixture.reconcile(), /Publication lease expired/);
  assert.equal(fixture.tracks.length, 0, "expired lease holders cannot insert radio tracks");
  assert.equal(fixture.token, "new-lease-holder", "stale cleanup must not delete another worker's lease");
}
for (const revoke of [
  state => { state.song.broadcast_requested = false; },
  state => { state.song.rights_status = "disputed"; },
  state => { state.versions[1].mastering_status = "queued"; },
  state => { state.versions[1].status = "archived"; },
  state => { state.versions[1].id = "replacement-version"; },
  state => { state.versions[1].audio_blob_prefix = "owner/replaced/parts/"; },
  state => { state.versions[1].audio_byte_size++; },
  state => { state.versions[1].audio_chunk_count++; },
  state => { state.versions[1].duration_seconds++; },
  state => { state.versions[1].audio_content_type = "audio/wav"; },
  state => { state.song.explicit_lyrics = true; state.versions[1].clean_lyrics = false; },
  state => { state.versions[1].publication_revision = "2026-10-25T12:00:00.000124Z"; },
  state => { state.song.publication_revision = "2026-10-25T12:00:00.000790Z"; },
  state => { state.song.metadata_issues = [{ level: "required", field: "rights" }]; },
]) {
  const inserting = publicationDatabase();
  inserting.beforeRadioWrite = () => revoke(inserting);
  await assert.rejects(inserting.reconcile(), /radio eligibility changed/);
  assert.equal(inserting.tracks.length, 0, "cached radio approval cannot authorize a preview after current eligibility changes");
  const existing = publicationDatabase();
  await existing.reconcile();
  approveTrack(existing.tracks[0]);
  existing.beforeRadioVerify = () => revoke(existing);
  const result = await existing.reconcile();
  assert.equal(result.radioStatus, "queued", "current canonical joins must reject revoked eligibility for existing rotation");
  assert.equal(result.publicationHealth.radioReady, false);
  assert.equal(existing.tracks[0].status, "rotation", "verification must never overwrite an operator's track status");
}
{
  const fixture = publicationDatabase();
  await fixture.reconcile();
  approveTrack(fixture.tracks[0]);
  fixture.beforeRadioVerify = () => { fixture.tracks[0].status = "held"; };
  assert.equal((await fixture.reconcile()).radioStatus, "held", "current held status must win over an earlier rotation snapshot");
}
for (const review of [{}, { reviewed_at: "2026-10-25T12:00:00.000Z" }, { reviewed_by_member_id: "operator-member" }]) {
  const fixture = publicationDatabase();
  await fixture.reconcile();
  Object.assign(fixture.tracks[0], { status: "rotation", ...review });
  const result = await fixture.reconcile();
  assert.equal(result.radioStatus, "queued", "legacy auto-rotated tracks require persisted operator approval evidence");
  assert.equal(result.publicationHealth.radioReady, false);
  assert.equal(fixture.sync.details.radio.reason, "operator_review_required");
  assert.match(result.publicationHealth.failureReasons.join(" "), /requires recorded operator review and approval/i);
  assert.equal(fixture.tracks[0].status, "rotation", "reconciliation must preserve the legacy row/status for operator review");
}
{
  const fixture = publicationDatabase();
  await fixture.reconcile();
  const track = fixture.tracks[0];
  Object.assign(track, { status: "rejected", reviewed_at: "2026-10-25T12:00:00Z",
    reviewed_by_member_id: "operator-member", review_note: "Preserve operator feedback." });
  const original = { ...track };
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await fixture.reconcile();
    assert.equal(result.radioStatus, "queued", "rejected rows must map to a supported non-rotation sync state");
    assert.equal(result.radioTrackId, track.id);
    assert.equal(fixture.sync.details.radio.reason, "radio_submission_rejected");
    assert.equal(result.publicationHealth.radioReady, false);
    assert.match(result.publicationHealth.failureReasons.join(" "), /operator rejected.*will not resubmit/i);
    assert.deepEqual(fixture.tracks, [original], "scheduled reconciliation must preserve rejected work without creating a duplicate retry queue");
  }
  assert.equal(fixture.queries.filter(({ query }) => query.startsWith("WITH lease AS")).length, 1);
}
{
  const fixture = publicationDatabase();
  await fixture.reconcile();
  approveTrack(fixture.tracks[0]);
  fixture.beforeRadioVerify = () => { fixture.tracks[0].reviewed_by_member_id = null; };
  assert.equal((await fixture.reconcile()).radioStatus, "queued", "current review proof must win over a stale reviewed snapshot");
  assert.equal(fixture.sync.details.radio.reason, "operator_review_required");
}
for (const revoke of [
  state => { state.versions[0].mastering_status = "queued"; },
  state => { state.versions[0].publication_revision = "2026-10-25T12:00:00.000124Z"; },
  state => { state.song.publication_revision = "2026-10-25T12:00:00.000790Z"; },
  state => { state.song.metadata_issues = [{ level: "required", field: "ownership" }]; },
]) {
  const fixture = publicationDatabase();
  fixture.beforeMasterPublication = () => revoke(fixture);
  await assert.rejects(fixture.reconcile(), /master approval changed/);
  assert.equal(fixture.releases.get("release").status, "draft", "current master/metadata blockers must stop final public handoff");
}
{
  const fixture = publicationDatabase();
  const master = fixture.versions[0];
  master.audio_blob_prefix = null;
  master.audio_chunk_count = null;
  master.audio_storage_key = buildMasterObjectKey({
    ownerMemberId: "owner", songId: fixture.song.id, versionId: master.id,
    uploadId: "upload-id", filename: "master.wav",
  });
  assert.equal((await fixture.reconcile()).publicationHealth.releaseReady, true,
    "owned direct-storage masters must use the same canonical proxy without copying signed URLs");
}
{
  const serializerSource = stripTypeScriptTypes(catalogApi.slice(catalogApi.indexOf("function serializeSong("), catalogApi.indexOf("async function loadCatalog(")));
  const serialize = new Function("pickCanonicalMaster", "serializeMasterCopy", "buildDreamweaverSatellite", "verifiedVersion",
    `${serializerSource}; return serializeSong;`)(versions => versions[0], () => ({}), () => null, verifiedVersion);
  const fixture = publicationDatabase();
  await fixture.reconcile();
  approveTrack(fixture.tracks[0]);
  await fixture.reconcile();
  const song = {
    id: fixture.song.id, ownerMemberId: "owner", rightsStatus: "cleared", broadcastRequested: true,
    explicitLyrics: false, pipelineStatus: "published", metadataIssues: [],
    updatedAt: new Date("2026-10-25T12:00:00.000Z"),
  };
  const versions = fixture.versions.map(version => ({
    id: version.id, songId: version.song_id, status: version.status, versionType: version.version_type,
    masteringStatus: version.mastering_status, durationSeconds: version.duration_seconds,
    audioBlobPrefix: version.audio_blob_prefix, audioStorageKey: version.audio_storage_key || "",
    audioChunkCount: version.audio_chunk_count, audioContentType: version.audio_content_type,
    audioByteSize: version.audio_byte_size, updatedAt: new Date(version.updated_at),
    audioUrl: `/api/song-catalog/audio?versionId=${version.id}`,
  }));
  const serialized = serialize(song, versions);
  assert.equal(serialized.versions[0].status, "active");
  assert.equal(serialized.versions[0].updatedAt, fixture.sync.details.masterUpdatedAt);
  assert.equal(serialized.versions[0].persistedAudio, true);
  const health = attachPublicationHealthToSongs([serialized], [fixture.sync])[0].publicationHealth;
  assert.equal(health.releaseReady, true, "real catalog serialization must retain the verified sale-master revision handoff");
  assert.equal(health.radioReady, true, "real catalog serialization must confirm an approved persisted version already in rotation");
  assert.equal(health.dreamweaverReady, false, "serialization cannot invent share confirmation");
  assert.ok(!JSON.stringify(serialized).includes("/upload/parts/"), "catalog serialization must not expose private blob prefixes");
  versions[0].audioStorageKey = buildMasterObjectKey({
    ownerMemberId: "owner", songId: song.id, versionId: versions[0].id,
    uploadId: "direct-upload", filename: "master.wav",
  });
  versions[0].audioBlobPrefix = "";
  assert.equal(serialize(song, versions).versions[0].persistedAudio, true, "owned direct-storage assets must pass the identical artifact checker");
  assert.ok(!JSON.stringify(serialize(song, versions)).includes(versions[0].audioStorageKey), "private direct-storage keys must never be serialized");
  versions[0].audioStorageKey = "other-owner/private/master.wav";
  const rejected = serialize(song, versions);
  assert.equal(rejected.versions[0].persistedAudio, false);
  assert.equal(attachPublicationHealthToSongs([rejected], [fixture.sync])[0].publicationHealth.releaseReady, false,
    "a foreign artifact reference must invalidate real API health without exposing its key");
}
{
  const fixture = publicationDatabase();
  let user = null;
  let originAllowed = true;
  let databaseCalls = 0;
  const handler = createPublicationReconcileHandler({
    currentUser: async () => user,
    verifyOrigin: async () => originAllowed,
    membershipFor: async () => ({ member_id: "owner", actor_id: "owner-actor" }),
    database: async () => {
      databaseCalls++;
      return { sql: async (strings, ...values) => {
        const query = strings.join("?").replace(/\s+/g, " ").trim();
        if (query.startsWith("SELECT id, owner_member_id FROM halo_song_catalog")) {
          assert.equal(values[1], "owner", "manual recovery must use the authenticated member, never a supplied owner id");
          assert.equal(values[2], "owner");
          return values[0] === fixture.song.id ? [{ id: fixture.song.id, owner_member_id: "owner" }] : [];
        }
        return fixture.db.sql(strings, ...values);
      }};
    },
  });
  const request = (body = JSON.stringify({ songId: sampleSongId }), method = "POST", headers = {}) => new Request(
    "https://halo.world/api/song-publication-reconcile?limit=200", {
      method, headers: { "Content-Type": "application/json", ...headers },
      ...(method === "POST" ? { body } : {}),
    });
  assert.equal((await handler(request("", "GET"))).status, 405);
  assert.equal((await handler(request())).status, 401);
  user = { id: "signed-in-owner" };
  originAllowed = false;
  assert.equal((await handler(request())).status, 403);
  originAllowed = true;
  for (const body of ["{", "null", "[]", "{}", '{"songId":"bad"}']) {
    assert.equal((await handler(request(body))).status, 400, "manual recovery cannot trigger an unscoped batch");
  }
  assert.equal((await handler(request(" ".repeat(4097)))).status, 413);
  assert.equal((await handler(request("{}", "POST", { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(databaseCalls, 0, "rejected requests cannot touch publication state");
  assert.equal((await handler(request(JSON.stringify({ songId: "44444444-4444-4444-8444-444444444444" })))).status, 404);
  assert.equal(fixture.releases.size, 0, "foreign or missing songs cannot be repaired through another member's session");
  const response = await handler(request(JSON.stringify({ songId: sampleSongId, ownerMemberId: "attacker", limit: 200 })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).scanned, 1);
  assert.equal(fixture.tracks.length, 1);
}
{
  const fixture = publicationDatabase();
  const now = new Date("2026-10-25T15:00:00Z");
  fixture.shows = [
    { id: "later-club", room: "club", status: "published", day_of_week: 1, start_time_utc: "10:00:00" },
    { id: "earliest-club", room: "club", status: "published", day_of_week: 0, start_time_utc: "18:00:00" },
    { id: "wrong-room", room: "chill", status: "published", day_of_week: 0, start_time_utc: "16:00:00" },
    { id: "paused-show", room: "club", status: "paused", day_of_week: 0, start_time_utc: "15:30:00" },
    { id: "draft-show", room: "club", status: "draft", day_of_week: 0, start_time_utc: "15:20:00" },
  ];
  const first = await planRadioShowProposal(fixture.db, "club", {}, now);
  assert.equal(first.proposedShowId, "earliest-club");
  assert.equal(first.proposedStartsAt, "2026-10-25T18:00:00.000Z", "proposals must use the earliest future UTC slot in the supported room");
  assert.equal(first.approvalRequired, true);
  const retained = await planRadioShowProposal(fixture.db, "club", {
    proposedRoom: "club", proposedShowId: "later-club", proposedStartsAt: "2026-10-26T10:00:00.000Z",
  }, now);
  assert.equal(retained.proposedShowId, "later-club", "a valid future proposal must not move just because another slot is earlier");
  fixture.shows.find(show => show.id === "later-club").start_time_utc = "11:00:00";
  assert.equal((await planRadioShowProposal(fixture.db, "club", retained, now)).proposedShowId, "earliest-club",
    "a changed show clock invalidates its old proposal");
  assert.equal((await planRadioShowProposal(fixture.db, "club", first, new Date("2026-10-25T19:00:00Z"))).proposedShowId, "later-club",
    "expired proposals must be replaced by an actual future UTC slot");
  fixture.shows.find(show => show.id === "later-club").status = "paused";
  assert.equal((await planRadioShowProposal(fixture.db, "club", retained, now)).proposedShowId, "earliest-club");
  fixture.shows = fixture.shows.filter(show => show.id !== "earliest-club");
  const missing = await planRadioShowProposal(fixture.db, "club", first, now);
  assert.equal(missing.proposalReason, "no_compatible_show");
  assert.equal(missing.proposedShowId, "");
  assert.match(missing.nextAction, /operator.*publish or resume/);
  assert.ok(fixture.queries.every(({ query }) => !/UPDATE halo_radio_shows|INSERT INTO halo_radio_shows/.test(query)),
    "slot proposals must never change published programming or approvals");
  fixture.shows = [];
  const noShow = await fixture.reconcile();
  assert.equal(fixture.sync.details.radio.reason, "no_compatible_show", "missing programming must have a durable actionable reason");
  assert.match(noShow.publicationHealth.failureReasons.join(" "), /No published HALO Radio show.*Club room.*publish or resume/i);
  assert.equal(fixture.sync.details.radio.approvalRequired, true);
  assert.equal(fixture.tracks[0].status, "preview", "missing shows must never imply rotation approval");
}
const forcePushApi = await read("netlify/functions/catalog-force-push-track.mjs");
assert.match(forcePushApi, /path: "\/api\/catalog\/force-push-track"/);
assert.match(forcePushApi, /currentUser = getUser/);
assert.match(forcePushApi, /verifyOrigin\(request\)/);
assert.match(forcePushApi, /new TextEncoder\(\)\.encode\(text\)\.byteLength/, "size checks must not rely only on content-length");

{
  const membership = { member_id: "owner", actor_id: "actor" };
  const song = {
    id: sampleSongId, owner_member_id: "owner", title: "Keep my title", artist_name: "Artist",
    pipeline_status: "uploaded", sale_price_cents: null, currency: "USD",
    artwork_url: "https://cdn.halo.world/cover.jpg", notes: "Keep my notes",
    source_release_id: "existing-release", rights_status: "cleared",
    publication_revision: "2026-10-25T12:00:00.000789Z",
  };
  const releases = new Map();
  const statements = [];
  let missing = false;
  let ambiguous = false;
  let failRelease = false;
  const master = {
    id: "22222222-2222-4222-8222-222222222222", song_id: song.id,
    version_type: "sale_master", status: "active", mastering_status: "approved",
    audio_blob_prefix: "owner/22222222-2222-4222-8222-222222222222/upload/parts/",
    audio_chunk_count: 1, audio_content_type: "audio/mpeg", audio_byte_size: 1000, duration_seconds: 180,
    audio_url: "https://private.example/master?signature=SECRET",
    updated_at: new Date("2026-10-25T12:00:00.000123Z"),
    publication_revision: "2026-10-25T12:00:00.000123Z",
  };
  const db = { sql: async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    statements.push({ query, values });
    if (query.startsWith("SELECT id, rights_status FROM halo_song_catalog")) {
      assert.equal(values[1], "owner", "lookups must be owner scoped");
      if (missing) return [];
      return ambiguous ? [{ id: song.id }, { id: "other" }] : [{ id: song.id }];
    }
    if (query.startsWith("UPDATE halo_song_catalog SET pipeline_status")) {
      assert.equal(values[1], "owner", "writes must be owner scoped");
      song.pipeline_status = "published";
      if (!(song.sale_price_cents > 0)) { song.sale_price_cents = 129; song.currency = "USD"; }
      song.pipeline_updated_at = "2026-10-02T12:00:00.000Z";
      return [{ ...song }];
    }
    if (query.includes("FROM halo_song_catalog song")) return [{ ...song }];
    if (query.startsWith("INSERT INTO halo_song_publication_leases")) return [{ song_id: song.id }];
    if (query.startsWith("DELETE FROM halo_song_publication_leases")) return [];
    if (query.startsWith("SELECT") && query.includes("FROM halo_song_versions")) return [{ ...master }];
    if (query.startsWith("SELECT owner_member_id, release_id, version_type, status")) return [];
    if (query.startsWith("INSERT INTO halo_release_audio_versions")) return [{ id: "audio-master", version_type: "master" }];
    if (query.includes("FROM halo_song_publication_sync")) return [];
    if (query.startsWith("SELECT id, owner_member_id FROM halo_release_campaigns")) {
      return [{ id: song.source_release_id, owner_member_id: song.owner_member_id }];
    }
    if (query.startsWith("SELECT artwork_url, official_url")) return [];
    if (query.startsWith("UPDATE halo_release_campaigns")) {
      if (failRelease) throw new Error("Storage unavailable");
      assert.equal(values[1], song.owner_member_id, "release updates must preserve owner scoping");
      return releases.has(values[0]) ? [releases.get(values[0])] : [];
    }
    if (query.startsWith("INSERT INTO halo_release_campaigns")) {
      if (failRelease) throw new Error("Storage unavailable");
      assert.match(query, /ON CONFLICT \(id\) DO UPDATE/, "release publication must be idempotent");
      const release = { id: values[0], official_url: values[7], stream_url: values.at(-1) };
      releases.set(release.id, release);
      return [release];
    }
    if (query.startsWith("INSERT INTO halo_song_publication_sync") || query.startsWith("INSERT INTO halo_ledger")) return [];
    if (query.startsWith("INSERT INTO halo_track_drop_events")) return [];
    throw new Error(`Unexpected publication query: ${query}`);
  }};
  const result = await forcePushTrack(db, {
    id: song.id, title: "Do not overwrite", notes: "", owner_member_id: "attacker",
    price: "US$0.01", releaseStatus: "READY",
  }, membership);
  assert.equal(result.success, true);
  assert.equal(result.track.price, "US$1.29");
  assert.equal(result.track.pushedToLiveAt, song.pipeline_updated_at);
  assert.equal(result.track.releaseStatus, "PUBLISHED");
  assert.equal(result.track.status, "PUBLISHED");
  assert.equal(result.track.inChart, true);
  assert.equal(result.track.isLiveVisible, true);
  assert.equal(song.title, "Keep my title");
  assert.equal(song.notes, "Keep my notes");
  assert.equal(song.artwork_url, "https://cdn.halo.world/cover.jpg");
  assert.equal(song.owner_member_id, "owner");
  song.sale_price_cents = 249;
  song.currency = "EUR";
  assert.equal((await forcePushTrack(db, { title: song.title }, membership)).track.price, "EUR 2.49");
  assert.equal(releases.size, 1, "repeated pushes must reuse the existing release");
  for (const invalid of [null, [], {}, { id: "bad-id" }, { title: " " }]) {
    const count = statements.length;
    await assert.rejects(forcePushTrack(db, invalid, membership), { status: 400 });
    assert.equal(statements.length, count, "invalid payloads must not write anything");
  }
  missing = true;
  await assert.rejects(forcePushTrack(db, { id: song.id }, membership), { status: 404 });
  missing = false;
  ambiguous = true;
  await assert.rejects(forcePushTrack(db, { title: song.title }, membership), { status: 409 });
  ambiguous = false;
  failRelease = true;
  await assert.rejects(forcePushTrack(db, { id: song.id }, membership), /Storage unavailable/, "failed sync must not report success");
  assert.ok(statements.every(({ query }) => !/\bTRUNCATE\b|DELETE FROM (?!halo_song_publication_leases)/.test(query)), "force pushes must never delete catalog data");
  assert.ok(statements.filter(({ query }) => query.startsWith("INSERT INTO halo_release_campaigns"))
    .every(({ values }) => !values.includes(master.audio_url)), "private audio URLs must never enter releases");
  const writeCount = statements.filter(({ query }) => query.startsWith("UPDATE halo_song_catalog")).length;
  master.mastering_status = "queued";
  await assert.rejects(forcePushTrack(db, { id: song.id }, membership), { status: 409 });
  assert.equal(statements.filter(({ query }) => query.startsWith("UPDATE halo_song_catalog")).length, writeCount,
    "force-push cannot mutate publication state before master approval is verified");
}

{
  let user = null;
  let rejectOrigin = false;
  let calls = 0;
  const handler = createForcePushTrackHandler({
    database: () => ({ sql: async strings => strings.join("").includes("UPDATE")
      ? [{ id: sampleSongId, title: "Track", sale_price_cents: 129, currency: "USD", pipeline_updated_at: new Date() }]
      : [{ id: sampleSongId }] }),
    currentUser: async () => user,
    verifyOrigin: () => { if (rejectOrigin) throw new Error("origin"); },
    membershipFor: async () => ({ member_id: "owner" }),
    reconcile: async () => { calls++; return { ok: true, releaseId: "release" }; },
  });
  const request = (body = "{}", method = "POST") => new Request("https://halo.world/api/catalog/force-push-track", {
    method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body } : {}),
  });
  assert.equal((await handler(request("", "GET"))).status, 405);
  assert.equal((await handler(request())).status, 401);
  user = { id: "signed-in" };
  rejectOrigin = true;
  assert.equal((await handler(request())).status, 403);
  rejectOrigin = false;
  assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request(" ".repeat(80_001)))).status, 413);
  assert.equal(calls, 0, "rejected requests must never publish");
  const response = await handler(request(JSON.stringify({ id: sampleSongId })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).success, true);
}

{
  const editor = await read("song-catalog/song-catalog.js");
  const page = await read("song-catalog/index.html");
  assert.match(page, /id="pushToShopButton" type="button">Push to Shop &amp; Charts/);
  assert.match(page, /id="pushToShopStatus" role="status" aria-live="polite"/);
  const source = editor.match(/async function pushToShop\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, "editor must wire the force-push action");
  const status = { textContent: "" };
  const attributes = {};
  const button = { disabled: false, setAttribute(name, value) { attributes[name] = value; }, removeAttribute(name) { delete attributes[name]; } };
  let click;
  let track = { id: sampleSongId, title: "Test track", salePriceCents: null, currency: "USD" };
  let fail = false;
  let refreshed = "";
  click = new Function("$", "selectedSong", "fetch", "loadCatalog", "state", "message", "money", "window", `${source};return pushToShop;`)(
    selector => selector === "#pushToShopStatus" ? status : button,
    () => track,
    async (url, options) => {
      assert.equal(button.disabled, true, "push must be disabled while the request is running");
      assert.equal(attributes["aria-busy"], "true");
      assert.equal(status.textContent, "Pushing to Shop & Charts…");
      assert.equal(url, "/api/catalog/force-push-track");
      assert.equal(options.credentials, "same-origin");
      const payload = JSON.parse(options.body);
      assert.equal(payload.releaseStatus, "PUBLISHED");
      assert.equal(payload.status, "PUBLISHED");
      assert.equal(payload.inChart, true);
      assert.equal(payload.isLiveVisible, true);
      assert.equal(payload.price, "US$1.29");
      assert.equal(payload.title, track.title, "push must use the selected saved song data");
      assert.equal(payload.currency, track.currency);
      if (fail) throw new Error("Backend unavailable");
      return { ok: true, json: async () => ({ success: true, message: "Live on Shop & Charts" }) };
    },
    async id => { refreshed = id; }, { authenticated: true }, () => {}, () => "", { confirm: () => true }
  );
  await click({ currentTarget: button });
  assert.equal(refreshed, sampleSongId);
  assert.equal(status.textContent, "Live on Shop & Charts");
  assert.equal(button.disabled, false);
  assert.equal(attributes["aria-busy"], undefined);
  for (const invalidPrice of [0, -1, "placeholder", Infinity]) {
    track = { ...track, salePriceCents: invalidPrice, currency: "EUR" };
    await click({ currentTarget: button });
    assert.equal(button.disabled, false);
    assert.equal(attributes["aria-busy"], undefined);
  }
  fail = true;
  refreshed = "";
  await click({ currentTarget: button });
  assert.equal(status.textContent, "Backend unavailable", "offline publication must fail visibly");
  assert.equal(refreshed, "", "offline publication must not report a local save as live");
  assert.equal(button.disabled, false);
  assert.equal(attributes["aria-busy"], undefined);
  track = null;
  await click({ currentTarget: button });
  assert.equal(status.textContent, "Select and save a track first.");
}
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
assert.match(helper, /destinationUrl/, "publication helper must persist the resolved Dreamweaver destination");
assert.match(helper, /dreamweaverStorefrontPath/, "publication helper must set Dreamweaver storefront pages as release entry routes");
assert.match(helper, /official_url = EXCLUDED\.official_url/, "publication must replace stale or unsafe navigation URLs");
assert.match(helper, /stream_url = EXCLUDED\.stream_url/, "publication must promptly reconcile canonical stream references");

assert.match(manager, /isHyperFollowUrl/, "Dreamweaver page manager must detect HyperFollow URLs");
assert.match(manager, /manage_dreamweaver_song_page/, "Dreamweaver page manager must have a single page-management purpose");
assert.match(manager, /buildDreamweaverSongPage/, "Dreamweaver page manager must expose a shared generated-page builder");
assert.match(manager, /dreamweaverHubPath/, "Dreamweaver page manager must define a dedicated canonical hub resolver");
assert.equal(managedDreamweaverFlow.managed, true, "songs without HyperFollow must get a managed Dreamweaver page");
assert.equal(managedDreamweaverFlow.routeMode, "dreamweaver_page", "non-HyperFollow songs must resolve to Dreamweaver page route mode");
assert.equal(managedDreamweaverFlow.hubUrl, "/dreamweaver/?mix=sample-release", "Dreamweaver manager must emit a canonical mix-aware hub URL");
assert.equal(managedDreamweaverFlow.launchUrl, "/dreamweaver/?mix=sample-release", "songs without HyperFollow must launch into the Dreamweaver hub flow");
assert.equal(managedDreamweaverFlow.page?.route, `/dreamweaver/satellite/${sampleSongId}/`, "Dreamweaver manager must preserve deterministic satellite routes");
assert.equal(managedDreamweaverFlow.destinationUrl, managedDreamweaverFlow.page?.experienceUrl, "managed releases must expose the generated Dreamweaver page as the public doorway");
assert.equal(managedDreamweaverFlow.page?.hubUrl, "/dreamweaver/?mix=sample-release", "Dreamweaver page metadata must expose canonical hub URL");
assert.ok(
  managedDreamweaverFlow.loop?.linkedPages?.includes("/music/?song=sample-release")
    && managedDreamweaverFlow.loop?.linkedPages?.includes("/api/release-link?slug=sample-release&audience=fan")
    && managedDreamweaverFlow.loop?.linkedPages?.includes("/release-kit.html?slug=sample-release&audience=fan"),
  "Dreamweaver loop metadata must link hub, sales/release pages, and related promo pages"
);
assert.equal(managedDreamweaverFlow.manager?.id, `dreamweaver-page-manager-${sampleSongId}`, "Dreamweaver page manager IDs must be deterministic per song");
assert.equal(managedDreamweaverFlow.page?.pageAgent?.id, `dreamweaver-page-manager-${sampleSongId}`, "generated Dreamweaver pages must expose the dedicated page manager identity");
assert.equal(hyperfollowDreamweaverFlow.hasHyperfollow, true, "HyperFollow releases must be detected");
assert.equal(hyperfollowDreamweaverFlow.managed, false, "HyperFollow releases must not be replaced by managed Dreamweaver pages");
assert.equal(hyperfollowDreamweaverFlow.routeMode, "hyperfollow", "HyperFollow releases must report the HyperFollow route mode");
assert.equal(hyperfollowDreamweaverFlow.destinationUrl, "https://distrokid.com/hyperfollow/owenanthony/sample-track", "HyperFollow releases must preserve the HyperFollow doorway");
assert.equal(hyperfollowDreamweaverFlow.launchUrl, "https://distrokid.com/hyperfollow/owenanthony/sample-track", "HyperFollow releases must keep their existing HyperFollow destination");
assert.ok(
  hyperfollowDreamweaverFlow.loop?.linkedPages?.includes("https://distrokid.com/hyperfollow/owenanthony/sample-track"),
  "HyperFollow loop metadata must retain the HyperFollow destination"
);
assert.ok(
  !hyperfollowDreamweaverFlow.loop?.linkedPages?.some(page => page.startsWith("/dreamweaver/?mix=")),
  "HyperFollow loop metadata must not advertise managed Dreamweaver hub routing"
);
assert.match(helper, /buildPublicationHealth/, "publication helper must derive artist-facing health snapshots during reconciliation");
assert.match(helper, /errorStreak/, "publication helper must track deterministic retry escalation state");
assert.match(helper, /COALESCE\(sync\.details->>'escalatedAt', ''\) = ''/, "publication batch reconcile must stop auto-retrying escalated rows until the song changes again");
assert.match(helper, /sync\.last_reconciled_at < NOW\(\) - INTERVAL '15 minutes'/, "healthy published songs must be checked on the monitor cadence");
assert.match(helper, /ORDER BY sync\.last_reconciled_at ASC NULLS FIRST, song\.updated_at DESC/, "limited monitor batches must check never-reconciled and oldest songs first");
assert.match(helper, /fallbackCanonicalUrl = fallbackReleaseId \? publicationPath/, "failures must derive canonical routes, never retain arbitrary URLs");
assert.match(helper, /publicationHealth: health/, "manual reconciliation must return the shared health snapshot");
assert.match(helper, /dreamweaverStatus = "pending"/, "route calculation alone must not confirm Dreamweaver delivery");
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

assert.match(reconcileFunction, /reconcilePublishedSongs/, "manual reconciler must invoke published-song repair");
assert.match(reconcileFunction, /path: "\/api\/song-publication-reconcile"/, "reconciler must expose a manual repair endpoint");
assert.doesNotMatch(reconcileFunction, /schedule:/, "manual reconciler must not also be configured as a scheduled function");
assert.match(scheduledReconcileFunction, /runReconcile/, "scheduled reconciler must invoke published-song repair");
assert.match(scheduledReconcileFunction, /schedule: "\*\/15 \* \* \* \*"/, "scheduled reconciler must run on an automated cadence");
assert.doesNotMatch(scheduledReconcileFunction, /path:/, "scheduled reconciler must not specify a custom path");

assert.match(unifiedUpload, /reconcilePublishedSong/, "unified upload pipeline must trigger publication fan-out on publish");
assert.match(uploadPipeline, /reconcilePublishedSong/, "upload pipeline must trigger publication fan-out on publish");
assert.match(catalogApi, /attachPublicationHealth/, "song catalog API must attach publication health to artist songs");
assert.match(catalogApi, /attachPublicationHealthToSongs/, "song catalog API must reuse the deterministic publication health helper");
assert.match(catalogApi, /payload\.action === "recheck_publication"/, "song catalog must offer manual health rechecks");
assert.match(catalogApi, /eq\(songs\.ownerMemberId, membership\.member_id\)[\s\S]*?eq\(songs\.pipelineStatus, "published"\)/, "manual rechecks must require ownership and published state");
assert.match(dreamweaver, /new URL\("\/music\/", location\.origin\)/, "Dreamweaver share flow must target the canonical published-song URL");
assert.match(dreamweaver, /dreamweaverPage\?\.manager/, "Dreamweaver page must use the dedicated page manager metadata when available");
assert.match(dreamweaver, /preferredReleaseDoorway/, "Dreamweaver page must prefer resolved release doorway metadata");
assert.match(releaseCatalog, /dreamweaverPage/, "release catalog must expose Dreamweaver page metadata for song-linked releases");
assert.match(releaseCatalog, /resolveDreamweaverPageFlow/, "release catalog must derive Dreamweaver page state through the shared manager");
assert.match(releaseCatalog, /dreamweaverHubUrl/, "release catalog must serialize canonical Dreamweaver hub metadata");
assert.match(releaseCatalog, /dreamweaverLoop/, "release catalog must serialize linked Dreamweaver loop metadata");
assert.match(releaseCatalog, /entryExperience/, "release catalog must expose the resolved entry mode");
assert.match(releaseCatalog, /entryUrl/, "release catalog must expose the resolved entry URL");
assert.match(releaseLink, /remapLegacyAudioDestination/, "release-link handler must guard against legacy song-catalog audio entry URLs");
assert.match(releaseLink, /dreamweaverStorefrontPath/, "release-link handler must reroute legacy audio entries into the Dreamweaver storefront page");
assert.match(releaseLink, /searchParams\.set\("audience"/, "release-link legacy remapping must preserve audience context on storefront redirects");

console.log("Song publication contracts passed.");
