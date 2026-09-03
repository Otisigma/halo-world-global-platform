import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveReleaseArtworkFields, DEFAULT_RELEASE_ARTWORK } from "../netlify/lib/release-artwork.mjs";

const root = resolve(import.meta.dirname, "..");
const [catalogApi, releasePackApi, artistPagesApi, musicPage, musicClient, kitPage, haloPage, browserHelper, sharedStyles, migration] = await Promise.all([
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/release-pack.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/artist-pages.mjs"), "utf8"),
  readFile(resolve(root, "music/index.html"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8"),
  readFile(resolve(root, "release-kit.html"), "utf8"),
  readFile(resolve(root, "halo.html"), "utf8"),
  readFile(resolve(root, "release-artwork.js"), "utf8"),
  readFile(resolve(root, "release-artwork.css"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260828042000_add_release_artwork_overrides.sql"), "utf8")
]);

const manual = resolveReleaseArtworkFields({
  artworkUrl: "/assets/releases/original.jpg",
  importedArtworkUrl: "https://distrokid.imgix.net/imported.jpg",
  artworkOverrideUrl: "/assets/releases/manual.jpg"
});
assert.equal(manual.artwork, "/assets/releases/manual.jpg");
assert.equal(manual.artworkSource, "manual");
assert.equal(manual.importedArtwork, "https://distrokid.imgix.net/imported.jpg");

const imported = resolveReleaseArtworkFields({
  importedArtworkUrl: "https://distrokid.imgix.net/imported.jpg"
});
assert.equal(imported.artwork, "https://distrokid.imgix.net/imported.jpg");
assert.equal(imported.artworkSource, "imported");

const fallback = resolveReleaseArtworkFields({});
assert.equal(fallback.artwork, DEFAULT_RELEASE_ARTWORK);
assert.equal(fallback.artworkSource, "fallback");

assert.match(releasePackApi, /imported_artwork_url/);
assert.match(releasePackApi, /artwork_override_url/);
assert.match(releasePackApi, /imported_artwork_url = COALESCE\(NULLIF\(EXCLUDED\.imported_artwork_url, ''\), halo_release_campaigns\.imported_artwork_url\)/);
assert.match(releasePackApi, /artwork_override_url = COALESCE\(NULLIF\(EXCLUDED\.artwork_override_url, ''\), halo_release_campaigns\.artwork_override_url\)/);
assert.match(catalogApi, /artworkOverride/);
assert.match(artistPagesApi, /imported_artwork_url = COALESCE/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS imported_artwork_url TEXT NOT NULL DEFAULT ''/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS artwork_override_url TEXT NOT NULL DEFAULT ''/);
assert.match(musicPage, /release-artwork\.css/);
assert.match(musicPage, /release-artwork\.js/);
assert.match(musicClient, /HaloReleaseArtwork/);
assert.match(kitPage, /data-release-artwork/);
assert.match(haloPage, /Imported DistroKid artwork/);
assert.match(browserHelper, /window\.HaloReleaseArtwork/);
assert.match(sharedStyles, /\.release-artwork-frame/);

console.log("Release artwork contracts passed.");
