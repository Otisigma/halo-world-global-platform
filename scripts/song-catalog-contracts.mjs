import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, client, styles, api, audioApi, artworkApi, producerApi, producerLib, schema, migration, audioMigration, artworkMigration, versionArtworkMigration, producerMigration, config, home, packageText, uploadHelper] = await Promise.all([
  read("song-catalog/index.html"),
  read("song-catalog/song-catalog.js"),
  read("song-catalog/song-catalog.css"),
  read("netlify/functions/song-catalog.ts"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
  read("netlify/functions/song-catalog-producer.mjs"),
  read("netlify/lib/catalog-producer.mjs"),
  read("db/schema.ts"),
  read("netlify/database/migrations/20260821035511_complete_pestilence/migration.sql"),
  read("netlify/database/migrations/20260821040411_add_song_version_audio_uploads/migration.sql"),
  read("netlify/database/migrations/20260826210000_add_song_artwork/migration.sql"),
  read("netlify/database/migrations/20260826220000_add_version_artwork/migration.sql"),
  read("netlify/database/migrations/20260821183000_create_catalog_producer/migration.sql"),
  read("netlify.toml"),
  read("halo.html"),
  read("package.json"),
  read("upload-progress.js")
]);
const packageJson = JSON.parse(packageText);

const checks = [
  [page.includes("One song · every useful version") && page.includes("Radio mastering queue"), "ships a unified catalog and dedicated broadcast queue"],
  [page.includes("Sale master") || client.includes("sale_master"), "keeps the customer sale master separate from other versions"],
  [client.includes('"radio_edit","clean"') && client.includes("masteringStatus!==\"approved\""), "shows unfinished radio and clean versions in the mastering queue"],
  [api.includes("VERSION_ROUTES") && api.includes("instrumental") && api.includes("stems") && api.includes("extended"), "creates every requested version route for each song"],
  [api.includes("runDreamweaverReview") && api.includes("radio_master") && api.includes("rightsStatus"), "runs Dream Weaver metadata, rights, sale, and radio checks"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes('path: "/api/song-catalog"'), "protects catalog records with membership and origin checks"],
  [api.includes("halo_release_campaigns") && api.includes("import_existing"), "loads songs already present in the HALO release catalog"],
  [page.includes('id="audioFile"') && client.includes("AUDIO_CHUNK_BYTES") && client.includes("finalize_upload"), "uploads full song-version audio in browser-safe chunks"],
  [audioApi.includes('getStore({ name: "halo-song-catalog-audio"') && audioApi.includes("verifyRequestOrigin") && audioApi.includes("ownedVersion"), "stores private audio in Netlify Blobs with ownership and origin checks"],
  [audioApi.includes("requestedByteRange") && audioApi.includes('path: "/api/song-catalog/audio"'), "serves uploaded audio with private range playback"],
  [schema.includes("halo_song_catalog") && schema.includes("halo_song_versions") && schema.includes("halo_dreamweaver_song_reviews"), "defines the persistent catalog with Drizzle ORM"],
  [migration.includes("halo_song_catalog_owner_source_unique") && migration.includes("ON DELETE CASCADE"), "migrates version and review records with duplicate-import protection"],
  [schema.includes("audioBlobPrefix") && schema.includes("audioChunkCount") && audioMigration.includes('ADD COLUMN "audio_blob_prefix"'), "tracks uploaded audio storage and playback details in the database"],
  [page.includes("Dreamweaver production team") && client.includes("queue_catalog_producer") && client.includes("projectedMonthlyNetCents"), "adds an artist-approved album, mix, and vault packaging room"],
  [producerApi.includes("background: true") && producerApi.includes("runCatalogProducer"), "runs catalog packaging without blocking the browser"],
  [producerLib.includes("halo_release_campaign_events") && producerLib.includes("engagement_then_readiness") && producerLib.includes("Complete Catalog Vault"), "uses audience signals and catalog readiness to create product proposals"],
  [schema.includes("halo_catalog_packages") && schema.includes("halo_catalog_package_tracks") && producerMigration.includes("halo_catalog_producer_jobs"), "persists producer jobs, packages, pricing, and track lists in Netlify Database"],
  [packageJson.peerDependencies?.["@netlify/database"] && !packageJson.dependencies?.["@netlify/database"], "keeps the database SDK installed without repeating preview branch provisioning"],
  [styles.includes("@media(max-width:720px)") && styles.includes("prefers-reduced-motion:reduce"), "provides a responsive catalog layout with reduced-motion support"],
  [config.includes('from = "/song-catalog"') && home.includes('href="/song-catalog/"'), "makes the catalog discoverable and normalizes its route"],
  [artworkApi.includes('getStore({ name: "halo-song-catalog-artwork"') && artworkApi.includes("verifyRequestOrigin") && artworkApi.includes("ownedSong"), "stores private artwork in Netlify Blobs with ownership and origin checks"],
  [artworkApi.includes("requestedByteRange") && artworkApi.includes('path: "/api/song-catalog/artwork"'), "serves uploaded artwork with private range support"],
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
  [api.includes("version.artworkUrl") && api.includes("version.artworkUploadedAt"), "includes per-version artwork metadata in catalog API responses"],
  [page.includes("versionArtworkFile") && page.includes("versionArtworkPreview") && page.includes("versionArtworkHeading"), "adds version artwork upload zone with preview to the version editor dialog"],
  [client.includes("uploadVersionArtwork") && client.includes("deleteVersionArtwork") && client.includes("renderVersionArtwork"), "implements version artwork upload, delete, and preview rendering"],
  [client.includes("version-row-artwork") && client.includes("version.artworkUrl"), "shows artwork thumbnail in version rows, falling back to the song cover"],
  [page.includes('id="audioUploadTrack"') && page.includes('id="deleteVersionAudioButton"') && page.includes('id="artworkUploadTrack"') && page.includes('id="versionArtworkTrack"'), "renders visible upload progress tracks and audio delete controls for catalog uploads"],
  [client.includes("window.HaloUploadProgress") && client.includes("deleteVersionAudio") && client.includes("uploadHelper.uploadChunkedFile"), "uses the shared upload helper for live progress and version-audio deletion"],
  [audioApi.includes('request.method === "DELETE"') && audioApi.includes("Version audio removed") && audioApi.includes("runDreamweaverReview"), "lets owners delete uploaded version audio and re-run Dream Weaver checks"],
  [uploadHelper.includes("uploadChunkedFile") && uploadHelper.includes("createUploadUi"), "shares upload progress state and byte-level progress handling across upload views"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Song catalog contracts: ${checks.length}/${checks.length} checks passed.`);
