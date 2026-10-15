import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { runConfirmedUploadJobs } from "../netlify/lib/confirmed-upload-jobs.mjs";
import { sanitizeDreamweaverAssignedRoute } from "../lib/dreamweaver-storefront.js";
import { buildDreamweaverSatellite } from "../lib/route-registry.js";
import { pickCanonicalMaster, serializeMasterCopy } from "../netlify/lib/master-copy.mjs";
import { attachPublicationHealthToSongs } from "../netlify/lib/song-publication-health.mjs";
import { MASTER_UPLOAD_MAX_BYTES, MASTER_UPLOAD_URL_TTL_SECONDS, buildMasterObjectKey, directUploadConfig, isOwnedMasterObjectKey, presignObjectUrl, validateMasterUpload } from "../netlify/lib/direct-upload-storage.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, client, styles, api, unifiedUploadApi, releaseCatalogApi, publicationHealth, audioApi, artworkApi, producerApi, producerLib, satelliteHelper, schema, migration, audioMigration, artworkMigration, versionArtworkMigration, producerMigration, versionVideoMigration, config, home, packageText, uploadHelper, dreamweaverManager, singleMasterMigration, masterCopyLib, masterUploadApi, directStorageLib, storageKeyMigration] = await Promise.all([
  read("song-catalog/index.html"),
  read("song-catalog/song-catalog.js"),
  read("song-catalog/song-catalog.css"),
  read("netlify/functions/song-catalog.ts"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/release-catalog.mjs"),
  read("netlify/lib/song-publication-health.mjs"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
  read("netlify/functions/song-catalog-producer.mjs"),
  read("netlify/lib/catalog-producer.mjs"),
  read("netlify/lib/dreamweaver-satellite.mjs"),
  read("db/schema.ts"),
  read("netlify/database/migrations/20260821035511_complete_pestilence/migration.sql"),
  read("netlify/database/migrations/20260821040411_add_song_version_audio_uploads/migration.sql"),
  read("netlify/database/migrations/20260826210000_add_song_artwork/migration.sql"),
  read("netlify/database/migrations/20260826220000_add_version_artwork/migration.sql"),
  read("netlify/database/migrations/20260821183000_create_catalog_producer/migration.sql"),
  read("netlify/database/migrations/20260928194000_add_song_version_video_fields.sql"),
  read("netlify.toml"),
  read("halo.html"),
  read("package.json"),
  read("upload-progress.js"),
  read("netlify/lib/dreamweaver-page-manager.mjs"),
  read("netlify/database/migrations/20260929040000_enforce_single_active_sale_master.sql"),
  read("netlify/lib/master-copy.mjs"),
  read("netlify/functions/song-catalog-master-upload.ts"),
  read("netlify/lib/direct-upload-storage.mjs"),
  read("netlify/database/migrations/20260929060000_add_song_version_audio_storage_key.sql")
]);
const packageJson = JSON.parse(packageText);

// Exercise actual backend functions without storage credentials or ingesting a second file.
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
{
  const drain = deferred();
  const invoked = [];
  let finished = false;
  const result = runConfirmedUploadJobs([
    { name: "required", run: () => { invoked.push("required"); throw new Error("review unavailable"); } },
    { name: "cleanup", required: false, run: async () => { invoked.push("cleanup"); await drain.promise; throw new Error("cleanup unavailable"); } },
  ]).catch(error => { finished = true; return error; });
  await tick();
  assert.deepEqual(invoked, ["required", "cleanup"], "a synchronous failure does not prevent other lazy jobs starting exactly once");
  assert.equal(finished, false, "required failure waits for optional work to drain");
  drain.resolve();
  const error = await result;
  assert(error instanceof AggregateError);
  assert.equal(error.errors.length, 1, "only required failures reject confirmed work");
  assert.match(error.message, /required/);
  await assert.rejects(runConfirmedUploadJobs([
    { name: "duplicate", run: () => assert.fail("invalid job batch must not start") },
    { name: "duplicate", run: () => assert.fail("invalid job batch must not start") },
  ]), /unique names/);
}

const backendFunction = (source, start, end, name, context) => runInNewContext(
  `${stripTypeScriptTypes(source.slice(source.indexOf(start), source.indexOf(end)))}\n${name}`,
  { runConfirmedUploadJobs, ...context },
);
const backendPayload = { songId: "song", versionId: "version", uploadId: "upload", chunkCount: 1,
  byteSize: 4, filename: "song.wav", contentType: "audio/wav", fileKey: "new-master",
  originalName: "song.wav", fileType: "audio/wav", fileSize: 4 };
const backendDefaults = {
  cleanId: value => value || "", cleanUploadId: value => value || "", cleanText: value => value || "",
  normalizeAudioContentType: value => value, normalizeImageContentType: value => value,
  MAX_CHUNKS: 100, MAX_UPLOAD_BYTES: 1000, MASTER_UPLOAD_MAX_BYTES: 1000,
  json: (body, status = 200) => ({ body, status }),
};
for (const storage of ["audio", "direct"]) {
  const events = [];
  const review = deferred(), cleanup = deferred();
  const version = { audio_blob_prefix: "old-audio", audio_storage_key: "old-master" };
  let writes = 0, inspections = 0, rejectReview = false, rejectCleanup = false;
  const dbMock = { sql: async () => {
    events.push("confirmed");
    writes++;
    version.audio_blob_prefix = storage === "audio" ? "new-audio" : "";
    version.audio_storage_key = storage === "direct" ? "new-master" : "";
  } };
  // Return a snapshot just like the database SDK, not a live reference to the mock row.
  const context = {
    ...backendDefaults,
    ownedVersion: async () => ({ ...version }), ownedMasterVersion: async () => ({ ...version }),
    audioUploadPrefix: () => "new-audio",
    inspectAudioUpload: async () => { inspections++; return { complete: true }; },
    discardAudioChunks: () => assert.fail("confirmed upload must not discard parts"),
    directUploadConfig: () => ({}), isOwnedMasterObjectKey: () => true,
    validateMasterUpload: () => ({ ok: true, byteSize: 4, contentType: "audio/wav", filename: "song.wav" }),
    headStoredObject: async () => 4,
    runDreamweaverReview: async () => {
      assert(writes > 0, "review starts after persistence");
      events.push("review");
      await review.promise;
      if (rejectReview) throw new Error("review unavailable");
    },
    removeUpload: async prefix => { if (!prefix) return; events.push("cleanup_audio"); await cleanup.promise; },
    removeStoredMaster: async key => { if (!key) return; events.push("cleanup_master"); await cleanup.promise; if (rejectCleanup) throw new Error("object unavailable"); },
    deleteStoredObject: async () => { events.push("cleanup_master"); await cleanup.promise; if (rejectCleanup) throw new Error("object unavailable"); },
    audioStore: {
      list: async () => { events.push("cleanup_audio"); return { blobs: [{ key: "old-audio/000" }, { key: "old-audio/001" }] }; },
      delete: async () => { await cleanup.promise; },
    },
  };
  const finish = storage === "audio"
    ? backendFunction(audioApi, "async function finalizeUpload(", "async function readAudioRange(", "finalizeUpload", context)
    : backendFunction(masterUploadApi, "async function registerMasterUpload(", "export default async function", "registerMasterUpload", context);
  let returned = false;
  rejectCleanup = true;
  const pending = finish(backendPayload, dbMock, "owner").then(value => { returned = true; return value; });
  await tick();
  assert.deepEqual(events.slice(0, 2), ["confirmed", "review"]);
  assert(events.includes("cleanup_audio") && events.includes("cleanup_master"), `${storage} starts independent review and cleanup concurrently`);
  assert.equal(returned, false);
  review.resolve();
  await tick();
  assert.equal(returned, false, `${storage} must await cleanup even after review finishes`);
  cleanup.resolve();
  assert.equal((await pending).body.persisted, true, `${storage} optional cleanup failure cannot fail a persisted upload`);
  const cleanupCalls = events.filter(event => event.startsWith("cleanup")).length;
  rejectReview = true;
  await assert.rejects(finish(backendPayload, dbMock, "owner"), /review/, `${storage} still surfaces required review failures on replay`);
  rejectReview = false;
  assert.equal((await finish(backendPayload, dbMock, "owner")).body.persisted, true);
  assert.equal(writes, 1, `${storage} retries do not finalize the same upload twice`);
  assert.equal(inspections, storage === "audio" ? 1 : 0, "audio replay does not inspect or ingest parts again");
  assert.equal(events.filter(event => event.startsWith("cleanup")).length, cleanupCalls, "replay never removes live uploaded media");
  version.audio_blob_prefix = "older-audio";
  version.audio_storage_key = "older-master";
  const beforeFailure = events.length;
  await assert.rejects(finish(backendPayload, { sql: async () => { throw new Error("confirmation unavailable"); } }, "owner"),
    /confirmation unavailable/);
  assert.equal(events.length, beforeFailure, "a failed confirmation starts no downstream jobs");
}
for (const versionArtwork of [false, true]) {
  const cleanup = deferred();
  const events = [];
  const record = { artwork_blob_prefix: "old" };
  const finishArtwork = backendFunction(artworkApi, "async function finalizeUpload(", "async function readArtworkRange(", "finalizeUpload", {
    ...backendDefaults,
    ownedSong: async () => ({ ...record }),
    ownedVersion: async () => ({ ...record }),
    artworkStore: { list: async () => ({ blobs: [] }) }, hasCompleteChunkSet: () => true,
    removeArtwork: async () => { events.push("cleanup"); await cleanup.promise; throw new Error("optional cleanup unavailable"); },
  });
  let returned = false;
  const dbMock = { sql: async () => {
    events.push("confirmed");
    record.artwork_blob_prefix = versionArtwork ? "owner/song/version/upload/parts/" : "owner/song/upload/parts/";
  } };
  const pending = finishArtwork({ ...backendPayload, versionId: versionArtwork ? "version" : "" },
    dbMock, "owner").then(value => { returned = true; return value; });
  await tick();
  assert.deepEqual(events, ["confirmed", "cleanup"], "song/version artwork cleanup starts only after confirmation");
  assert.equal(returned, false);
  cleanup.resolve();
  assert.equal((await pending).body.persisted, true, "artwork confirmation survives optional cleanup failure");
  assert.equal((await finishArtwork({ ...backendPayload, versionId: versionArtwork ? "version" : "" }, dbMock, "owner")).body.alreadyFinalized, true);
  assert.deepEqual(events, ["confirmed", "cleanup"], "artwork replay does not rewrite confirmation or repeat cleanup");
  const uploadArtworkChunk = backendFunction(artworkApi, "async function uploadChunk(", "async function finalizeUpload(", "uploadChunk", {
    ...backendDefaults, Blob, MAX_CHUNK_BYTES: 1000,
    ownedSong: async () => ({ ...record }), ownedVersion: async () => ({ ...record }),
    artworkStore: { set: () => assert.fail("late chunk retries must never overwrite live artwork") },
  });
  const fields = { ...backendPayload, versionId: versionArtwork ? "version" : "", chunkIndex: "0",
    chunk: new Blob(["art"], { type: "image/png" }) };
  assert.equal((await uploadArtworkChunk({ formData: async () => ({ get: key => fields[key] }) }, dbMock, "owner")).status, 409);
}
for (const [source, name, end, storeName] of [
  [audioApi, "removeUpload", "async function removeStoredMaster(", "audioStore"],
  [artworkApi, "removeArtwork", "async function uploadChunk(", "artworkStore"],
]) {
  const drain = deferred();
  let returned = false, deletes = 0;
  const remove = backendFunction(source, `async function ${name}(`, end, name, {
    [storeName]: {
      list: async () => ({ blobs: [{ key: "old/000" }, { key: "old/001" }] }),
      delete: async key => {
        deletes++;
        if (key.endsWith("000")) throw new Error("first deletion failed");
        await drain.promise;
      },
    },
  });
  const pending = remove("old/").catch(error => { returned = true; return error; });
  await tick();
  assert.equal(deletes, 2);
  assert.equal(returned, false, `${name} drains all blob deletions even if one rejects immediately`);
  drain.resolve();
  assert((await pending) instanceof AggregateError);
}
// Drive registration archives a reference only; metadata saves must finish their dependent writes
// before review. Neither path has independent cleanup to parallelize or needs another ingest.
const driveRegistration = await read("netlify/functions/catalog-tracks.mjs");
assert(driveRegistration.indexOf("verifyDriveMasterFile(file") < driveRegistration.indexOf("UPDATE halo_song_versions"));
assert(!driveRegistration.includes("deleteStoredObject") && !driveRegistration.includes("runDreamweaverReview"),
  "Drive archive registration must not delete archives or start audio publication");
assert(api.indexOf("driveUrl: googleDriveUrl") < api.indexOf("await runDreamweaverReview(id, ownerMemberId);", api.indexOf("async function saveSong(")),
  "metadata review observes the confirmed Drive link as well as song metadata");
console.log("PASS: confirmed backend fan-out starts after persistence, drains all jobs, isolates cleanup, and replays without duplicate ingest");
const sampleDreamweaverSatellite = buildDreamweaverSatellite("11111111-1111-4111-8111-111111111111", { includeAgentLoop: true });
const sampleDreamweaverRoute = sanitizeDreamweaverAssignedRoute(sampleDreamweaverSatellite?.experienceUrl);
const sampleSongs = attachPublicationHealthToSongs([
  {
    id: "published-song",
    title: "Published song",
    artistName: "HALO",
    pipelineStatus: "published",
    rightsStatus: "cleared",
    metadataIssues: [],
    versions: [
      { versionType: "sale_master", audioUrl: "https://example.com/sale.mp3", masteringStatus: "approved" },
      { versionType: "radio_edit", audioUrl: "https://example.com/radio.mp3", masteringStatus: "approved" }
    ]
  },
  {
    id: "hyperfollow-song",
    title: "HyperFollow song",
    artistName: "HALO",
    pipelineStatus: "published",
    rightsStatus: "cleared",
    metadataIssues: [],
    versions: [
      { versionType: "sale_master", audioUrl: "https://example.com/sale.mp3", masteringStatus: "approved" },
      { versionType: "radio_edit", audioUrl: "https://example.com/radio.mp3", masteringStatus: "approved" }
    ]
  },
  {
    id: "draft-song",
    title: "Draft song",
    artistName: "HALO",
    pipelineStatus: "uploaded",
    rightsStatus: "cleared",
    metadataIssues: [],
    versions: []
  }
], [
  {
    song_id: "published-song",
    release_id: "halo-release",
    radio_track_id: "radio-track",
    canonical_url: "/music/?song=halo-release",
    release_status: "published",
    radio_status: "rotation",
    dreamweaver_status: "ready",
    details: {},
    last_error: "",
    last_reconciled_at: "2026-09-19T16:00:00.000Z"
  },
  {
    song_id: "hyperfollow-song",
    release_id: "halo-hyperfollow-release",
    radio_track_id: "radio-track-hyperfollow",
    canonical_url: "/music/?song=halo-hyperfollow-release",
    release_status: "published",
    radio_status: "rotation",
    dreamweaver_status: "managed_externally",
    details: {},
    last_error: "",
    last_reconciled_at: "2026-09-19T16:00:00.000Z"
  }
]);
assert.equal(sampleSongs[0].publicationHealth?.state, "published_and_fully_distributed", "published songs should receive computed publication health");
assert.equal(sampleSongs[1].publicationHealth?.state, "published_and_fully_distributed", "HyperFollow-managed Dreamweaver sharing should count as share-ready publication health");
assert.equal(sampleSongs[2].publicationHealth, null, "non-published songs should expose publicationHealth as null");

const checks = [
  [page.match(/id="publicationHealthPanel"/g)?.length === 1 && page.match(/id="publicationHealthTitle"/g)?.length === 1 && page.includes('id="recheckPublicationButton"'), "keeps a single accessible publication panel with a manual recheck control"],
  [page.includes('id="distributedCount"') && page.includes('id="actionCount"') && client.includes("renderPublicationTotals()"), "summarizes fully distributed and action-needed published songs"],
  [client.includes('api({action:"recheck_publication",songId:song.id})') && client.includes("button.disabled=true") && client.includes("await loadCatalog(song.id)"), "rechecks through the same-origin catalog API and refreshes artist guidance even on errors"],
  [page.includes("One song · every useful version") && page.includes("Radio mastering queue"), "ships a unified catalog and dedicated broadcast queue"],
  [page.includes("Sale master") || client.includes("sale_master"), "keeps the customer sale master separate from other versions"],
  [client.includes('"radio_edit","clean"') && client.includes("masteringStatus!==\"approved\""), "shows unfinished radio and clean versions in the mastering queue"],
  [client.includes("const money=(cents,currency=\"USD\")") && client.includes("money(song.salePriceCents,song.currency)"), "formats song sale prices from each song's stored currency instead of a hardcoded display currency"],
  [api.includes("VERSION_ROUTES") && api.includes("instrumental") && api.includes("stems") && api.includes("extended"), "creates every requested version route for each song"],
  [api.includes("runDreamweaverReview") && api.includes("radio_master") && api.includes("rightsStatus"), "runs Dream Weaver metadata, rights, sale, and radio checks"],
  [api.includes("reconcilePublishedSong") && api.includes('payload.action === "set_pipeline_stage"') && api.includes('stage === "published"'), "reconciles published songs into public release and radio fan-out from catalog stage transitions"],
  [api.includes("dreamweaverSatellite") && api.includes("../../lib/route-registry.js") && satelliteHelper.includes("resolveDreamweaverPageFlow") && satelliteHelper.includes("buildDreamweaverSatelliteContract"), "exposes deterministic Dreamweaver storefront metadata in song catalog responses while keeping canonical Dreamweaver routing shared"],
  [sampleDreamweaverSatellite?.route === "/dreamweaver/satellite/" && sampleDreamweaverSatellite.songId === "11111111-1111-4111-8111-111111111111" && sampleDreamweaverSatellite.canonicalUrl === "/dreamweaver/" && sampleDreamweaverSatellite.canonicalDreamweaverUrl === "/dreamweaver/?song=11111111-1111-4111-8111-111111111111" && sampleDreamweaverSatellite.fallbackUrl === "/dreamweaver/?satellite=dreamweaver&song=11111111-1111-4111-8111-111111111111" && sampleDreamweaverSatellite.experienceUrl === "/dreamweaver/satellite/?song=11111111-1111-4111-8111-111111111111&satellite=dreamweaver" && sampleDreamweaverSatellite.launchUrl === "/dreamweaver/satellite/11111111-1111-4111-8111-111111111111/" && sampleDreamweaverSatellite.agentLoop?.id === "dreamweaver-satellite-11111111-1111-4111-8111-111111111111", "shared route registry helper returns deterministic Dreamweaver satellite metadata with canonical storefront fallback"],
  [sampleDreamweaverRoute === sampleDreamweaverSatellite?.experienceUrl && sanitizeDreamweaverAssignedRoute("https://example.com/dreamweaver/satellite/11111111-1111-4111-8111-111111111111/") === "", "Dreamweaver route sanitizer keeps same-origin canonical routes and blocks off-origin assignments"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes('path: "/api/song-catalog"'), "protects catalog records with membership and origin checks"],
  [api.includes("halo_release_campaigns") && api.includes("halo_artist_pages") && api.includes("import_existing"), "loads reusable existing songs from release data with ownership checks"],
  [api.includes("dreamweaverSatellite: buildDreamweaverSatellite(song.id)") && satelliteHelper.includes("buildDreamweaverSatelliteContract") && satelliteHelper.includes("...metadataContract"), "song-catalog API returns Dreamweaver satellite navigation metadata alongside playback URLs"],
  [page.includes('id="songSatelliteLink"') && client.includes("resolveDreamweaverExperienceUrl") && client.includes("sanitizeDreamweaverAssignedRoute"), "song-catalog UI exposes an Open satellite entry point and keeps navigation pinned to sanitized Dreamweaver routes"],
  [page.includes('id="audioFile"') && client.includes("AUDIO_CHUNK_BYTES") && client.includes("finalize_upload"), "uploads full song-version audio in browser-safe chunks"],
  [api.includes("cleanAudioUrl") && api.includes("/api/song-catalog/audio?versionId="), "keeps uploaded catalog audio URLs valid when saving version metadata"],
  [page.includes('id="audioUrl" type="text"'), "avoids URL-field validation conflicts for internal uploaded-audio URLs"],
  [page.includes('id="audioUploadTrack"') && page.includes('id="artworkUploadTrack"') && page.includes('id="versionArtworkTrack"') && (client.includes("setUploadTrack") || client.includes("uploadUi.")), "shows live upload progress tracks for audio and artwork uploads"],
  [audioApi.includes('getStore({ name: "halo-song-catalog-audio"') && audioApi.includes("verifyRequestOrigin") && audioApi.includes("ownedVersion"), "stores private audio in Netlify Blobs with ownership and origin checks"],
  [audioApi.includes("requestedByteRange") && audioApi.includes('"Access-Control-Allow-Origin"') && audioApi.includes('"Access-Control-Expose-Headers"') && audioApi.includes('path: "/api/song-catalog/audio"'), "serves uploaded audio with private range playback and browser-friendly CORS headers"],
  [page.includes('id="deleteVersionAudioButton"') && client.includes("deleteVersionAudio") && audioApi.includes('request.method === "DELETE"') && audioApi.includes("deleteUpload"), "lets owners delete uploaded version audio while keeping ownership checks server-side"],
  [schema.includes("halo_song_catalog") && schema.includes("halo_song_versions") && schema.includes("halo_dreamweaver_song_reviews"), "defines the persistent catalog with Drizzle ORM"],
  [migration.includes("halo_song_catalog_owner_source_unique") && migration.includes("ON DELETE CASCADE"), "migrates version and review records with duplicate-import protection"],
  [schema.includes("audioBlobPrefix") && schema.includes("audioChunkCount") && audioMigration.includes('ADD COLUMN "audio_blob_prefix"'), "tracks uploaded audio storage and playback details in the database"],
  [page.includes("Dreamweaver production team") && client.includes("queue_catalog_producer") && client.includes("projectedMonthlyNetCents"), "adds an artist-approved album, mix, and vault packaging room"],
  [page.includes('id="publicationBoard"') && page.includes('id="publicationHealthPanel"') && page.includes("Publication health"), "renders a site-visible publication health board and detail panel for published songs"],
  [client.includes("renderPublicationBoard") && client.includes("renderPublicationHealth") && client.includes("Ask Dreamweaver AI"), "renders deterministic publication states, fixes, and AI-assisted next steps in the catalog client"],
  [api.includes("attachPublicationHealth") && api.includes("publicationHealth"), "includes publication health data in song catalog API responses"],
  [publicationHealth.includes("recommendedFixes") && publicationHealth.includes("agentTeam") && publicationHealth.includes("awaiting_radio_ready_assets"), "keeps publication guidance and state classification in a shared domain helper"],
  [producerApi.includes("background: true") && producerApi.includes("runCatalogProducer"), "runs catalog packaging without blocking the browser"],
  [producerLib.includes("halo_release_campaign_events") && producerLib.includes("engagement_then_readiness") && producerLib.includes("Complete Catalog Vault"), "uses audience signals and catalog readiness to create product proposals"],
  [client.includes("money(item.priceCents,item.currency)") && client.includes("money(item.projectedMonthlyNetCents,item.currency)"), "formats producer package pricing and net projections from package currency metadata"],
  [schema.includes("halo_catalog_packages") && schema.includes("halo_catalog_package_tracks") && producerMigration.includes("halo_catalog_producer_jobs"), "persists producer jobs, packages, pricing, and track lists in Netlify Database"],
  [client.includes("halo-song-catalog-height") && client.includes("parentOrigin") && client.includes("ResizeObserver"), "supports embedded shop/workspace height messaging for shared song catalog panels"],
  [packageJson.peerDependencies?.["@netlify/database"] && !packageJson.dependencies?.["@netlify/database"], "keeps the database SDK installed without repeating preview branch provisioning"],
  [styles.includes("@media(max-width:720px)") && styles.includes("prefers-reduced-motion:reduce") && styles.includes(".publication-board") && styles.includes(".publication-health-panel"), "provides a responsive catalog layout with reduced-motion support including publication health surfaces"],
  [/from = "\/song-catalog\/"[\s\S]*to = "\/song-catalog\/index\.html"/.test(config) && /Access-Control-Allow-Origin = "\*"/.test(config) && /Access-Control-Expose-Headers = "Accept-Ranges, Content-Length, Content-Range, Content-Type"/.test(config) && home.includes('href="/song-catalog/"'), "makes the catalog discoverable, serves the canonical /song-catalog/ route directly, and keeps API media preload CORS headers in Netlify config"],
  [artworkApi.includes('getStore({ name: "halo-song-catalog-artwork"') && artworkApi.includes("verifyRequestOrigin") && artworkApi.includes("ownedSong") && artworkApi.includes("halo_release_campaigns") && artworkApi.includes("DEFAULT_PUBLIC_ARTWORK"), "stores artwork in Netlify Blobs with ownership checks and published-release storefront fallback support"],
  [artworkApi.includes("requestedByteRange") && artworkApi.includes('path: "/api/song-catalog/artwork"') && artworkApi.includes("Location") && artworkApi.includes("public, max-age=3600"), "serves uploaded artwork with range support and redirects safely to fallback artwork when needed"],
  [artworkApi.includes("ALLOWED_TYPES") && artworkApi.includes("image/jpeg") && artworkApi.includes("image/png") && artworkApi.includes("image/webp"), "validates artwork file type allowing only JPEG, PNG, and WebP"],
  [artworkMigration.includes('"artwork_url"') && artworkMigration.includes('"artwork_uploaded_at"') && artworkMigration.includes("IF NOT EXISTS"), "migrates artwork columns idempotently with IF NOT EXISTS checks"],
  [schema.includes("artworkUrl") && schema.includes("artworkUploadedAt"), "adds artwork fields to the Drizzle ORM schema"],
  [api.includes("artworkUrl") && api.includes("artworkUploadedAt"), "includes artwork metadata in catalog API responses"],
  [page.includes("artworkHeading") && page.includes("artworkPreview") && page.includes("artworkFile"), "adds artwork upload zone with preview and file input to the song editor"],
  [client.includes("uploadArtwork") && client.includes("deleteArtwork") && client.includes("renderArtwork"), "implements artwork upload, delete, and preview rendering in the catalog client"],
  [client.includes("ARTWORK_CHUNK_BYTES") && client.includes("artworkApi"), "uploads artwork in browser-safe chunks using the artwork API"],
  [artworkApi.includes("ownedVersion") && artworkApi.includes("versionId") && artworkApi.includes("halo_song_versions"), "supports version-specific artwork with ownership checks on the version record"],
  [versionArtworkMigration.includes('"artwork_url"') && versionArtworkMigration.includes("halo_song_versions") && versionArtworkMigration.includes("IF NOT EXISTS"), "migrates version artwork columns idempotently with IF NOT EXISTS checks"],
  [schema.includes("halo_song_versions") && schema.includes("artworkUrl") && schema.includes("artworkBlobPrefix"), "adds artwork fields to the songVersions Drizzle ORM schema"],
  [api.includes("resolvedArtworkUrl") && api.includes("customArtworkUrl") && api.includes("inheritsArtwork") && api.includes("version.artworkUrl || songArtworkUrl"), "includes explicit per-version artwork inheritance and fallback metadata"],
  [page.includes("versionArtworkFile") && page.includes("versionArtworkPreview") && page.includes("versionArtworkHeading"), "adds version artwork upload zone with preview to the version editor dialog"],
  [client.includes("uploadVersionArtwork") && client.includes("deleteVersionArtwork") && client.includes("renderVersionArtwork"), "implements version artwork upload, delete, and preview rendering"],
  [client.includes("resolvedArtwork") && client.includes("versionUsesCustomArtwork") && client.includes("version-row-artwork"), "resolves version artwork consistently with explicit inherit/custom state"],
  [page.includes('id="versionVideoFile"') && page.includes('id="versionVideoUrl"') && page.includes('id="promoVideoUrl"') && page.includes('id="openVideoStudioButton"'), "adds version video upload and Dreamweaver promo-film routing controls"],
  [client.includes("uploadVersionVideo") && client.includes("renderVersionVideo") && client.includes("openVideoStudioButton"), "implements version video upload flow and promo-film status messaging in the catalog client"],
  [api.includes("cleanVideoUrl") && api.includes("videoUrl") && api.includes("promoVideoUrl"), "persists version video and promo-video links through validated catalog actions"],
  [schema.includes("videoUrl") && schema.includes("promoVideoUrl") && versionVideoMigration.includes("promo_video_url"), "adds version video and promo video fields to schema and migration coverage"],
  [client.includes("queue-song") && client.includes("renderRadioQueue") && client.includes("resolvedArtwork(song,version)"), "uses resolved version artwork in radio queue entries"],
  [client.includes("track.artworkUrl") && client.includes("producer-track-index"), "shows artwork in producer package track rows"],
  [page.includes('id="audioUploadTrack"') && page.includes('id="deleteVersionAudioButton"') && page.includes('id="artworkUploadTrack"') && page.includes('id="versionArtworkTrack"'), "renders visible upload progress tracks and audio delete controls for catalog uploads"],
  [client.includes("window.HaloUploadProgress") && client.includes("deleteVersionAudio") && client.includes("uploadHelper.uploadChunkedFile"), "uses the shared upload helper for live progress and version-audio deletion"],
  [audioApi.includes('request.method === "DELETE"') && audioApi.includes("Version audio removed") && audioApi.includes("runDreamweaverReview"), "lets owners delete uploaded version audio and re-run Dream Weaver checks"],
  [uploadHelper.includes("uploadChunkedFile") && uploadHelper.includes("createUploadUi"), "shares upload progress state and byte-level progress handling across upload views"],
  [page.includes('id="newMasterFile"') && page.includes('name="masterCopy"') && page.includes('id="newMasterProgress"') && page.includes('id="newMasterTrack"') && page.includes("Sale master"), "lets uploaders attach a master copy when creating a song record"],
  [client.includes('$("#newMasterFile")') && client.includes("data.masterVersionId||data.versionIds?.sale_master") && client.includes("uploadMasterToVersion({file:masterFile,songId:data.songId,versionId:masterVersionId"), "uploads the chosen master copy into the new song's sale master version"],
  [client.includes("masterFileProblem(masterFile)") && client.includes('document.querySelector(".master-copy-panel")') && !page.includes('class="audio-upload-panel master') , "validates master copy files and tracks their upload progress without hijacking the version audio panel"],
  [api.includes('const MASTER_VERSION_TYPE: VersionType = "sale_master"') && api.includes("masterVersionId: versionIds[MASTER_VERSION_TYPE]") && api.includes("versionIds,"), "returns the canonical master version id when a song is created"],
  [api.includes("masterCopy: serializeMasterCopy(versions)") && api.includes("isCanonicalMaster: version.id === canonicalMaster?.id") && masterCopyLib.includes("audioFilename: master?.audioFilename"), "retains master copy metadata in persisted song catalog records"],
  [api.includes('import { pickCanonicalMaster, serializeMasterCopy } from "../lib/master-copy.mjs"') && masterCopyLib.includes("export function pickCanonicalMaster(") && !api.includes('versions.find(version => version.versionType === MASTER_VERSION_TYPE)'), "resolves exactly one canonical master copy instead of the most recently updated sale master"],
  [api.includes("async function demoteOtherMasters(") && api.includes("await demoteOtherMasters(transaction, songId, versionId)") && api.includes('ne(songVersions.id, keepVersionId)'), "demotes any prior active sale master when another version is promoted to the canonical master"],
  [singleMasterMigration.includes("CREATE UNIQUE INDEX IF NOT EXISTS halo_song_versions_single_active_master_idx") && singleMasterMigration.includes("version_type = 'sale_master' AND status = 'active'") && singleMasterMigration.includes("master_rank > 1") && schema.includes("halo_song_versions_single_active_master_idx"), "guards the database against more than one active sale master per song"],
  [!unifiedUploadApi.includes("ORDER BY updated_at DESC\n      LIMIT 1") && unifiedUploadApi.includes("ORDER BY (COALESCE(audio_url, '') <> '') DESC, created_at ASC, id ASC") && releaseCatalogApi.includes("ORDER BY (COALESCE(version.audio_url, '') <> '') DESC, version.created_at ASC, version.id ASC"), "selects the canonical master deterministically instead of by recency in the catalog APIs"],
  [client.includes("canonical-master-badge") && client.includes("version.isCanonicalMaster") && page.includes('id="versionMasterNote"') && styles.includes(".canonical-master-note"), "labels the canonical master copy clearly in the song catalog UI"],
  [page.includes("Promoting another version to Sale master later demotes this one") && client.includes("only that single canonical master is published"), "explains what happens when a master copy is selected during upload"],
  [unifiedUploadApi.includes('const MASTER_VERSION_TYPE = "sale_master"') && unifiedUploadApi.includes("masterVersionId: versionIds[MASTER_VERSION_TYPE]") && unifiedUploadApi.includes("masterCopy: serializeMasterCopy(row)") && unifiedUploadApi.includes("version_type = ${MASTER_VERSION_TYPE}"), "exposes the canonical master copy through the unified upload pipeline"],
  [releaseCatalogApi.includes("masterCopy: {") && releaseCatalogApi.includes("version.version_type = 'sale_master'") && releaseCatalogApi.includes("catalog_master_uploaded") && !/masterCopy: \{[^}]*audioUrl/.test(releaseCatalogApi), "surfaces public-safe master copy metadata in the release catalog without leaking private audio URLs"],
  [masterUploadApi.includes('path: "/api/song-catalog/master-upload"') && masterUploadApi.includes('payload.action === "presign"') && masterUploadApi.includes('payload.action === "register"') && masterUploadApi.includes("verifyRequestOrigin") && masterUploadApi.includes("ensureMembership"), "adds a membership- and origin-protected presigned master upload endpoint"],
  [masterUploadApi.includes("version.version_type = ${MASTER_VERSION_TYPE}") && masterUploadApi.includes("validateMasterUpload(") && masterUploadApi.includes("MASTER_UPLOAD_URL_TTL_SECONDS") && !masterUploadApi.includes("request.formData()") && !masterUploadApi.includes("arrayBuffer()"), "issues short-lived upload URLs only for the owner's canonical sale master without receiving audio bytes"],
  [masterUploadApi.includes("isOwnedMasterObjectKey(fileKey") && masterUploadApi.includes("headStoredObject(storage, fileKey)") && masterUploadApi.includes("audio_storage_key = ${fileKey}") && masterUploadApi.includes("audio_url = ${audioUrl}") && masterUploadApi.includes("runDreamweaverReview(songId, ownerMemberId)"), "registers the verified storage key on the sale master and keeps the private playback route authoritative"],
  [schema.includes('audioStorageKey: text("audio_storage_key")') && storageKeyMigration.includes("ADD COLUMN IF NOT EXISTS audio_storage_key"), "persists direct-storage master object keys idempotently"],
  [audioApi.includes("version.audio_storage_key") && audioApi.includes("presignObjectUrl({ config: storage") && audioApi.includes('"Cache-Control": "private, no-store"') && audioApi.includes("removeStoredMaster(version.audio_storage_key)"), "serves, replaces, and deletes direct-storage masters through owner-only short-lived URLs"],
  [api.includes("WHEN audio_blob_prefix <> '' OR audio_storage_key <> '' THEN audio_url"), "keeps direct-storage master playback URLs when version metadata is saved"],
  [client.includes("uploadMasterToVersion") && client.includes('fetch("/api/song-catalog/master-upload"') && client.includes('method:"PUT"') && client.includes('credentials:"omit"') && client.includes('action:"register"') && client.includes("Uploading master directly to storage"), "uploads master copies straight from the browser to storage with live progress, then registers them"],
  [client.includes("presign.data?.directUpload===false") && client.includes("return uploadAudioToVersion({file,songId,versionId,ui})") && client.includes("uploadHelper.uploadChunkedFile"), "falls back to the existing chunked upload path when direct storage is not configured"],
  [directStorageLib.includes("AWS4-HMAC-SHA256") && directStorageLib.includes("HALO_MASTER_STORAGE_BUCKET") && !directStorageLib.includes("@aws-sdk"), "signs S3-compatible direct uploads without adding a storage SDK dependency"],
  [!releaseCatalogApi.includes("audio_storage_key") && !unifiedUploadApi.includes("audio_storage_key") && !api.includes("audioStorageKey:"), "never exposes private master storage keys through catalog APIs"],
];

const duplicateMasters = [
  { id: "version-b", versionType: "sale_master", audioUrl: "", createdAt: new Date("2026-02-01T00:00:00Z") },
  { id: "version-a", versionType: "sale_master", audioUrl: "/api/song-catalog/audio?versionId=version-a", createdAt: new Date("2026-01-01T00:00:00Z"), audioFilename: "master.wav" },
  { id: "version-c", versionType: "radio_edit", audioUrl: "", createdAt: new Date("2026-03-01T00:00:00Z") },
];
assert.equal(pickCanonicalMaster(duplicateMasters)?.id, "version-a", "exactly one canonical master must be returned for a song");
assert.equal(duplicateMasters.filter(version => version.id === pickCanonicalMaster(duplicateMasters)?.id).length, 1, "canonical master resolution must never return more than one version");
assert.equal(serializeMasterCopy(duplicateMasters).versionId, "version-a", "masterCopy must serialize the canonical active master");
assert.equal(serializeMasterCopy(duplicateMasters).uploaded, true, "masterCopy must report the canonical master upload state");
assert.equal(serializeMasterCopy([]).versionId, "", "masterCopy must stay empty when no sale master exists");
assert.ok(!/masterCopy: \{[^}]*audio(Url|BlobPrefix|Filename|StorageKey)/.test(releaseCatalogApi), "public release catalog masterCopy must expose only safe metadata");

// Direct-to-storage presigned master uploads.
const awsVectorConfig = { bucket: "examplebucket", region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", endpoint: "https://s3.amazonaws.com", forcePathStyle: false };
assert.ok(presignObjectUrl({ config: awsVectorConfig, method: "GET", key: "test.txt", expiresIn: 86400, now: new Date("2013-05-24T00:00:00Z") }).endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"), "presigned URLs must match the published AWS SigV4 query-signing test vector");
const storageConfig = directUploadConfig({ HALO_MASTER_STORAGE_BUCKET: "halo-masters", HALO_MASTER_STORAGE_REGION: "auto", HALO_MASTER_STORAGE_ACCESS_KEY_ID: "test-access-key", HALO_MASTER_STORAGE_SECRET_ACCESS_KEY: "test-secret-key", HALO_MASTER_STORAGE_ENDPOINT: "https://storage.example.com" });
assert.equal(directUploadConfig({}), null, "direct uploads must stay disabled until storage credentials are configured");
assert.equal(directUploadConfig({ HALO_MASTER_STORAGE_BUCKET: "b", HALO_MASTER_STORAGE_ACCESS_KEY_ID: "a", HALO_MASTER_STORAGE_SECRET_ACCESS_KEY: "s", HALO_MASTER_STORAGE_ENDPOINT: "http://insecure.example.com" }), null, "direct storage endpoints must use https");
const masterScope = { ownerMemberId: "11111111-1111-4111-8111-111111111111", songId: "22222222-2222-4222-8222-222222222222", versionId: "33333333-3333-4333-8333-333333333333" };
const masterKey = buildMasterObjectKey({ ...masterScope, uploadId: "44444444-4444-4444-8444-444444444444", filename: "Final Master (24-bit).wav" });
assert.ok(masterKey.startsWith(`masters/${masterScope.ownerMemberId}/${masterScope.songId}/${masterScope.versionId}/`) && masterKey.endsWith(".wav") && !/[()\s]/.test(masterKey), "master object keys must be scoped to the owner, song, and sale master version");
const putUrl = new URL(presignObjectUrl({ config: storageConfig, method: "PUT", key: masterKey, contentType: "audio/wav", expiresIn: MASTER_UPLOAD_URL_TTL_SECONDS }));
assert.equal(putUrl.origin, "https://storage.example.com", "presigned uploads go directly to object storage, not a Netlify function");
assert.equal(putUrl.pathname, `/halo-masters/${masterKey}`, "custom S3-compatible endpoints use path-style object URLs");
assert.equal(putUrl.searchParams.get("X-Amz-SignedHeaders"), "content-type;host", "presigned PUT URLs must lock the validated content type");
assert.ok(Number(putUrl.searchParams.get("X-Amz-Expires")) <= 900, "presigned upload URLs must be short-lived");
assert.ok(/^[0-9a-f]{64}$/.test(putUrl.searchParams.get("X-Amz-Signature") || ""), "presigned upload URLs must carry a SigV4 signature");
assert.ok(!putUrl.href.includes("test-secret-key"), "presigned URLs must never leak the storage secret");
assert.ok(isOwnedMasterObjectKey(masterKey, masterScope), "registration accepts keys issued for the same sale master");
assert.ok(!isOwnedMasterObjectKey(masterKey, { ...masterScope, ownerMemberId: "55555555-5555-4555-8555-555555555555" }), "registration rejects keys issued to another member");
assert.ok(!isOwnedMasterObjectKey(`${masterKey.split("/").slice(0, 4).join("/")}/../../other/master.wav`, masterScope), "registration rejects path traversal in storage keys");
const largeWav = validateMasterUpload({ filename: "master.wav", contentType: "audio/x-wav", fileSize: 150 * 1024 * 1024 });
assert.ok(largeWav.ok && largeWav.contentType === "audio/wav", "150 MB WAV masters are accepted for direct upload");
assert.equal(validateMasterUpload({ filename: "master.m4a", contentType: "audio/x-m4a", fileSize: 60 * 1024 * 1024 }).contentType, "audio/mp4", "M4A masters normalize to audio/mp4");
assert.equal(validateMasterUpload({ filename: "master.wav", contentType: "audio/wav", fileSize: MASTER_UPLOAD_MAX_BYTES + 1 }).status, 413, "masters above the size limit are rejected before a URL is issued");
assert.equal(validateMasterUpload({ filename: "master.wav", contentType: "audio/wav", fileSize: 0 }).status, 400, "empty master uploads are rejected");
assert.equal(validateMasterUpload({ filename: "cover.png", contentType: "image/png", fileSize: 1024 }).status, 415, "non-audio master uploads are rejected");

assert.match(page, /id="versionTable"><\/div>\s*<form[^>]*id="alternateUploadForm"/, "inline upload lives directly below the unchanged version list");
assert.match(page, /id="alternateSongId" name="songId" type="hidden"/, "inline uploads carry the current parent song");
assert.match(page, /for="alternateVersionTitle"/, "version title has a visible label");
assert.match(page, /for="alternateAudioFile"/, "audio picker has a visible label");
assert.ok(client.includes('document.querySelector("#versionForm .audio-upload-panel")'), "dialog audio progress stays scoped to its own card");

const inlineElements = Object.fromEntries(["alternateUploadForm", "alternateSongId", "alternateVersionTitle", "alternateAudioFile", "alternateUploadContext", "uploadAlternateButton"].map(id => [id, { value: "", dataset: {}, disabled: false, addEventListener() {} }]));
const inlineForm = inlineElements.alternateUploadForm;
const inlineControls = [inlineElements.alternateVersionTitle, inlineElements.alternateAudioFile, inlineElements.uploadAlternateButton];
inlineForm.querySelectorAll = () => inlineControls;
inlineForm.reset = () => {
  inlineElements.alternateSongId.value = "";
  inlineElements.alternateVersionTitle.value = "";
  inlineElements.alternateAudioFile.files = [];
};
const inlineSongs = [{ id: "song-a", title: "<Original>", artistName: "Artist" }, { id: "song-b", title: "Other track", artistName: "Other artist" }];
const inlineState = { songs: inlineSongs, selectedId: "song-a", authenticated: true };
const inlineRequests = [];
const inlineUploads = [];
const inlineReloads = [];
const inlineUi = { idle() {}, start() {}, success(text) { this.message = text; }, fail(text) { this.message = text; } };
let failInlineUpload = false;
let failInlineCreation = false;
let duringInlineUpload = () => {};
let generatedVersionIds = 0;
const inline = runInNewContext(`${client.slice(client.indexOf("const alternateUploadUi="), client.indexOf("function message("))}
({renderAlternateUpload,uploadAlternateVersion})`, {
  $: selector => inlineElements[selector.slice(1)] || {},
  uploadHelper: { createUploadUi: () => inlineUi },
  state: inlineState,
  crypto: { randomUUID: () => `new-version-${++generatedVersionIds}` },
  setValue: (selector, value) => { inlineElements[selector.slice(1)].value = value; },
  audioFileProblem: runInNewContext(`(${client.match(/^function audioFileProblem.*$/m)[0]})`, {
    MAX_AUDIO_BYTES: 128 * 1024 * 1024,
    audioContentType: runInNewContext(`(${client.match(/^function audioContentType.*$/m)[0]})`)
  }),
  api: async payload => { inlineRequests.push(payload); if (failInlineCreation) throw new Error("Creation unavailable"); return payload; },
  uploadAudioToVersion: async payload => { inlineUploads.push(payload); await duringInlineUpload(); if (failInlineUpload) throw new Error("Connection stopped"); },
  loadCatalog: async songId => { inlineReloads.push(songId); }
});
const inlineEvent = { preventDefault() {}, currentTarget: inlineForm };
const chooseInlineUpload = (file = { name: "club.wav", type: "audio/wav", size: 1024 }) => {
  inlineElements.alternateVersionTitle.value = "Club mix";
  inlineElements.alternateAudioFile.files = [file];
};
inline.renderAlternateUpload(inlineSongs[0]);
assert.equal(inlineElements.alternateSongId.value, "song-a");
assert.ok(inlineElements.alternateUploadContext.textContent.includes("<Original>"), "parent title is rendered as text, not HTML");
for (const file of [undefined, { name: "empty.wav", type: "audio/wav", size: 0 }, { name: "large.wav", type: "audio/wav", size: 128 * 1024 * 1024 + 1 }, { name: "cover.png", type: "image/png", size: 1024 }]) {
  chooseInlineUpload(file);
  if (!file) inlineElements.alternateAudioFile.files = [];
  await inline.uploadAlternateVersion(inlineEvent);
}
chooseInlineUpload();
inlineElements.alternateVersionTitle.value = "   ";
await inline.uploadAlternateVersion(inlineEvent);
assert.equal(inlineRequests.length, 0, "invalid files and blank titles create no version");
chooseInlineUpload();
inlineState.authenticated = false;
await inline.uploadAlternateVersion(inlineEvent);
assert.equal(inlineRequests.length, 0, "signed-out users cannot create a version");
inlineState.authenticated = true;
failInlineCreation = true;
await inline.uploadAlternateVersion(inlineEvent);
assert.equal(inlineUploads.length, 0, "audio is not uploaded when creation fails");
failInlineCreation = false;
failInlineUpload = true;
await inline.uploadAlternateVersion(inlineEvent);
assert.ok(inlineUi.message.includes("Retry here"));
assert.ok(inlineElements.alternateVersionTitle.readOnly, "the created version title stays fixed for retries");
assert.ok(inlineControls.every(control => !control.disabled), "failed uploads restore usable controls");
failInlineUpload = false;
duringInlineUpload = async () => {
  assert.ok(inlineControls.every(control => control.disabled), "controls are disabled while uploading");
  await inline.uploadAlternateVersion(inlineEvent);
};
await inline.uploadAlternateVersion(inlineEvent);
assert.equal(inlineRequests.length, 3, "double submission during upload is ignored");
assert.equal(new Set(inlineRequests.map(request => request.versionId)).size, 1, "creation and audio retries reuse the version ID");
assert.ok(inlineUploads.every(upload => upload.songId === "song-a" && upload.versionId === inlineRequests[0].versionId), "uploads target the original parent and new version");
assert.equal(inlineForm.dataset.versionId, undefined, "successful upload resets the next creation ID");
assert.equal(inlineElements.alternateVersionTitle.value, "", "successful upload clears the form");
chooseInlineUpload();
duringInlineUpload = () => {
  inlineState.selectedId = "song-b";
  inline.renderAlternateUpload(inlineSongs[1]);
};
await inline.uploadAlternateVersion(inlineEvent);
assert.equal(inlineUploads.at(-1).songId, "song-a", "switching tracks never retargets an in-flight upload");
assert.equal(inlineElements.alternateSongId.value, "song-b", "the form follows the newly selected song");
assert.equal(inlineReloads.at(-1), "song-b", "refresh preserves the user's current selection");
assert.ok(inlineUi.message.includes("<Original>"), "completion names the original parent even after switching");

const createAlternateSource = api.slice(api.indexOf("async function createAlternateVersion("), api.indexOf("async function saveVersion("))
  .replace("ownerMemberId: string, payload: Record<string, unknown>", "ownerMemberId, payload");
const versionRows = [];
const ownedSongRows = [{ id: "song-a", ownerMemberId: "owner", status: "active" }];
const testSongsTable = { id: "id", ownerMemberId: "ownerMemberId", status: "status" };
const testVersionsTable = { id: "id", songId: "songId", versionType: "versionType", status: "status" };
const createAlternate = runInNewContext(`${createAlternateSource}; createAlternateVersion`, {
  cleanId: value => value === "invalid" ? "" : value,
  cleanText: (value, limit) => String(value || "").trim().slice(0, limit),
  json: (body, status = 200) => ({ body, status }),
  songs: testSongsTable, songVersions: testVersionsTable,
  eq: (column, value) => row => row[column] === value,
  and: (...conditions) => row => conditions.every(condition => condition(row)),
  VERSION_ROUTES: { alternate: { destination: "storefront", targetLufs: -14, saleEnabled: true } },
  db: {
    select: () => ({ from: table => ({ where: predicate => ({ limit: async () => (table === testSongsTable ? ownedSongRows : versionRows).filter(predicate) }) }) }),
    insert: () => ({ values: row => ({ onConflictDoNothing: () => ({ returning: async () => {
      if (versionRows.some(existing => existing.id === row.id)) return [];
      versionRows.push({ ...row, status: "active" });
      return [{ id: row.id }];
    } }) }) })
  }
});
const alternatePayload = { songId: "song-a", versionId: "version-a", label: "Club mix" };
assert.equal((await createAlternate("other-owner", alternatePayload)).status, 404, "non-owners cannot create alternate versions");
assert.equal((await createAlternate("owner", { ...alternatePayload, label: " " })).status, 400, "server rejects blank titles");
assert.equal((await createAlternate("owner", { ...alternatePayload, songId: "invalid" })).status, 400, "server rejects invalid parent identifiers");
assert.equal((await createAlternate("owner", alternatePayload)).status, 201);
assert.equal((await createAlternate("owner", alternatePayload)).status, 200, "server creation is idempotent on retry");
assert.equal(versionRows.length, 1);
assert.equal(versionRows[0].versionType, "alternate", "creation never replaces or promotes the canonical master");
assert.equal((await createAlternate("owner", { ...alternatePayload, versionId: "version-b" })).status, 201, "another upload creates another version");
ownedSongRows.push({ id: "song-b", ownerMemberId: "owner", status: "active" });
assert.equal((await createAlternate("owner", { ...alternatePayload, songId: "song-b" })).status, 409, "a reused ID cannot cross parent tracks");
ownedSongRows[0].status = "archived";
assert.equal((await createAlternate("owner", { ...alternatePayload, versionId: "version-c" })).status, 404, "archived songs cannot receive uploads");
console.log("PASS: inline alternate upload placement, validation, ownership, context, progress, retry, and creation behavior");

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(buildDreamweaverSatellite("not/a-song-id"), null, "shared Dreamweaver satellite helper must reject invalid song IDs");
if (failures.length) process.exitCode = 1;
else console.log(`Song catalog contracts: ${checks.length}/${checks.length} checks passed.`);
