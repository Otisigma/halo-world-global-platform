import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sanitizeDreamweaverAssignedRoute } from "../lib/dreamweaver-storefront.js";
import { buildDreamweaverSatellite } from "../lib/route-registry.js";
import { pickCanonicalMaster, serializeMasterCopy } from "../netlify/lib/master-copy.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, client, styles, api, unifiedUploadApi, releaseCatalogApi, audioApi, artworkApi, producerApi, producerLib, satelliteHelper, schema, migration, audioMigration, artworkMigration, versionArtworkMigration, producerMigration, versionVideoMigration, config, home, packageText, uploadHelper, dreamweaverManager, singleMasterMigration, masterCopyLib] = await Promise.all([
  read("song-catalog/index.html"),
  read("song-catalog/song-catalog.js"),
  read("song-catalog/song-catalog.css"),
  read("netlify/functions/song-catalog.ts"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/release-catalog.mjs"),
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
  read("netlify/lib/master-copy.mjs")
]);
const packageJson = JSON.parse(packageText);
const sampleDreamweaverSatellite = buildDreamweaverSatellite("11111111-1111-4111-8111-111111111111", { includeAgentLoop: true });
const sampleDreamweaverRoute = sanitizeDreamweaverAssignedRoute(sampleDreamweaverSatellite?.experienceUrl);

const checks = [
  [page.includes("One song · every useful version") && page.includes("Radio mastering queue"), "ships a unified catalog and dedicated broadcast queue"],
  [page.includes("Sale master") || client.includes("sale_master"), "keeps the customer sale master separate from other versions"],
  [client.includes('"radio_edit","clean"') && client.includes("masteringStatus!==\"approved\""), "shows unfinished radio and clean versions in the mastering queue"],
  [client.includes("const money=(cents,currency=\"USD\")") && client.includes("money(song.salePriceCents,song.currency)"), "formats song sale prices from each song's stored currency instead of a hardcoded display currency"],
  [api.includes("VERSION_ROUTES") && api.includes("instrumental") && api.includes("stems") && api.includes("extended"), "creates every requested version route for each song"],
  [api.includes("runDreamweaverReview") && api.includes("radio_master") && api.includes("rightsStatus"), "runs Dream Weaver metadata, rights, sale, and radio checks"],
  [api.includes("reconcilePublishedSong") && api.includes('payload.action === "set_pipeline_stage"') && api.includes('stage === "published"'), "reconciles published songs into public release and radio fan-out from catalog stage transitions"],
  [api.includes("dreamweaverSatellite") && api.includes("../../lib/route-registry.js") && satelliteHelper.includes("resolveDreamweaverPageFlow") && satelliteHelper.includes("buildDreamweaverSatelliteContract"), "exposes deterministic Dreamweaver storefront metadata in song catalog responses while keeping canonical Dreamweaver routing shared"],
  [Boolean(sampleDreamweaverSatellite?.route) && sampleDreamweaverSatellite.route === "/dreamweaver/satellite/11111111-1111-4111-8111-111111111111/" && sampleDreamweaverSatellite.canonicalUrl === "/dreamweaver/" && sampleDreamweaverSatellite.fallbackUrl === "/dreamweaver/?satellite=dreamweaver&song=11111111-1111-4111-8111-111111111111" && sampleDreamweaverSatellite.experienceUrl === sampleDreamweaverSatellite.route && sampleDreamweaverSatellite.launchUrl === sampleDreamweaverSatellite.route && sampleDreamweaverSatellite.agentLoop?.id === "dreamweaver-satellite-11111111-1111-4111-8111-111111111111", "shared route registry helper returns deterministic Dreamweaver satellite metadata with canonical storefront fallback"],
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
  [producerApi.includes("background: true") && producerApi.includes("runCatalogProducer"), "runs catalog packaging without blocking the browser"],
  [producerLib.includes("halo_release_campaign_events") && producerLib.includes("engagement_then_readiness") && producerLib.includes("Complete Catalog Vault"), "uses audience signals and catalog readiness to create product proposals"],
  [client.includes("money(item.priceCents,item.currency)") && client.includes("money(item.projectedMonthlyNetCents,item.currency)"), "formats producer package pricing and net projections from package currency metadata"],
  [schema.includes("halo_catalog_packages") && schema.includes("halo_catalog_package_tracks") && producerMigration.includes("halo_catalog_producer_jobs"), "persists producer jobs, packages, pricing, and track lists in Netlify Database"],
  [client.includes("halo-song-catalog-height") && client.includes("parentOrigin") && client.includes("ResizeObserver"), "supports embedded shop/workspace height messaging for shared song catalog panels"],
  [packageJson.peerDependencies?.["@netlify/database"] && !packageJson.dependencies?.["@netlify/database"], "keeps the database SDK installed without repeating preview branch provisioning"],
  [styles.includes("@media(max-width:720px)") && styles.includes("prefers-reduced-motion:reduce"), "provides a responsive catalog layout with reduced-motion support"],
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
  [client.includes('$("#newMasterFile")') && client.includes("data.masterVersionId||data.versionIds?.sale_master") && client.includes("uploadAudioToVersion({file:masterFile,songId:data.songId,versionId:masterVersionId"), "uploads the chosen master copy into the new song's sale master version"],
  [client.includes("audioFileProblem(masterFile)") && client.includes('document.querySelector(".master-copy-panel")') && !page.includes('class="audio-upload-panel master') , "validates master copy files and tracks their upload progress without hijacking the version audio panel"],
  [api.includes('const MASTER_VERSION_TYPE: VersionType = "sale_master"') && api.includes("masterVersionId: versionIds[MASTER_VERSION_TYPE]") && api.includes("versionIds,"), "returns the canonical master version id when a song is created"],
  [api.includes("masterCopy: serializeMasterCopy(versions)") && api.includes("isCanonicalMaster: version.id === canonicalMaster?.id") && masterCopyLib.includes("audioFilename: master?.audioFilename"), "retains master copy metadata in persisted song catalog records"],
  [api.includes('import { pickCanonicalMaster, serializeMasterCopy } from "../lib/master-copy.mjs"') && masterCopyLib.includes("export function pickCanonicalMaster(") && !api.includes('versions.find(version => version.versionType === MASTER_VERSION_TYPE)'), "resolves exactly one canonical master copy instead of the most recently updated sale master"],
  [api.includes("async function demoteOtherMasters(") && api.includes("await demoteOtherMasters(transaction, songId, versionId)") && api.includes('ne(songVersions.id, keepVersionId)'), "demotes any prior active sale master when another version is promoted to the canonical master"],
  [singleMasterMigration.includes("CREATE UNIQUE INDEX IF NOT EXISTS halo_song_versions_single_active_master_idx") && singleMasterMigration.includes("version_type = 'sale_master' AND status = 'active'") && singleMasterMigration.includes("master_rank > 1") && schema.includes("halo_song_versions_single_active_master_idx"), "guards the database against more than one active sale master per song"],
  [!unifiedUploadApi.includes("ORDER BY updated_at DESC\n      LIMIT 1") && unifiedUploadApi.includes("ORDER BY (COALESCE(audio_url, '') <> '') DESC, created_at ASC, id ASC") && releaseCatalogApi.includes("ORDER BY (COALESCE(version.audio_url, '') <> '') DESC, version.created_at ASC, version.id ASC"), "selects the canonical master deterministically instead of by recency in the catalog APIs"],
  [client.includes("canonical-master-badge") && client.includes("version.isCanonicalMaster") && page.includes('id="versionMasterNote"') && styles.includes(".canonical-master-note"), "labels the canonical master copy clearly in the song catalog UI"],
  [page.includes("Promoting another version to Sale master later demotes this one") && client.includes("only that single canonical master is published"), "explains what happens when a master copy is selected during upload"],
  [unifiedUploadApi.includes('const MASTER_VERSION_TYPE = "sale_master"') && unifiedUploadApi.includes("masterVersionId: versionIds[MASTER_VERSION_TYPE]") && unifiedUploadApi.includes("masterCopy: serializeMasterCopy(row)") && unifiedUploadApi.includes("version_type = ${MASTER_VERSION_TYPE}"), "exposes the canonical master copy through the unified upload pipeline"],
  [releaseCatalogApi.includes("masterCopy: {") && releaseCatalogApi.includes("version.version_type = 'sale_master'") && releaseCatalogApi.includes("catalog_master_uploaded") && !/masterCopy: \{[^}]*audioUrl/.test(releaseCatalogApi), "surfaces public-safe master copy metadata in the release catalog without leaking private audio URLs"]
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
assert.ok(!/masterCopy: \{[^}]*audio(Url|BlobPrefix|Filename)/.test(releaseCatalogApi), "public release catalog masterCopy must expose only safe metadata");

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(buildDreamweaverSatellite("not/a-song-id"), null, "shared Dreamweaver satellite helper must reject invalid song IDs");
if (failures.length) process.exitCode = 1;
else console.log(`Song catalog contracts: ${checks.length}/${checks.length} checks passed.`);
