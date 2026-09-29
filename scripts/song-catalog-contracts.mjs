import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  [/from = "\/song-catalog\/"[\s\S]*to = "\/song-catalog\/index\.html"/.test(config) && /Access-Control-Allow-Origin = "\*"/.test(config) && /Access-Control-Expose-Headers = "Content-Length, Content-Range"/.test(config) && home.includes('href="/song-catalog/"'), "makes the catalog discoverable, serves the canonical /song-catalog/ route directly, and keeps API media preload CORS headers in Netlify config"],
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

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(buildDreamweaverSatellite("not/a-song-id"), null, "shared Dreamweaver satellite helper must reject invalid song IDs");
if (failures.length) process.exitCode = 1;
else console.log(`Song catalog contracts: ${checks.length}/${checks.length} checks passed.`);
