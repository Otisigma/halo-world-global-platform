import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
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
assert.equal(DEFAULT_RELEASE_ARTWORK, "/assets/releases/halo-premium-placeholder.svg");
await access(resolve(root, DEFAULT_RELEASE_ARTWORK.slice(1)));
await access(resolve(root, "assets/releases/halo-premium-placeholder.png"));

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
assert.match(kitPage, /halo-premium-placeholder\.svg/);
assert.match(haloPage, /Imported DistroKid artwork/);
assert.match(haloPage, /const FALLBACK_ARTWORK = '\/assets\/releases\/halo-premium-placeholder\.svg'/);
assert.match(haloPage, /fallbackReleaseArtwork = window\.HaloReleaseArtwork\?\.DEFAULT_RELEASE_ARTWORK \|\| '\/assets\/releases\/halo-premium-placeholder\.svg'/);
assert.match(browserHelper, /window\.HaloReleaseArtwork/);
assert.match(browserHelper, /release-artwork-badge/);
assert.match(browserHelper, /HALO placeholder cover/);
assert.match(browserHelper, /resolveAudio/);
assert.match(browserHelper, /resolvePreviewAudio/);
assert.match(browserHelper, /isLikelyAudioUrl/);
assert.match(sharedStyles, /\.release-artwork-frame/);
assert.match(sharedStyles, /\.release-artwork-badge/);
assert.match(musicClient, /data-artwork-source/);
assert.match(musicPage, /halo-premium-placeholder\.png/);

const musicWorld = await readFile(resolve(root, "music-world.html"), "utf8");
assert.match(musicWorld, /\.shop-stage-art span:not\(\[hidden\]\)\{position:absolute;inset:0;display:grid;/,
  "shop overlay layout must only apply to visible fallback spans");
assert.doesNotMatch(musicWorld, /\.shop-stage-art span\s*\{/,
  "shop styles must not override hidden initials or shared placeholder badges");
assert.match(musicWorld, /<img id="shopFeatureArtwork" alt="" loading="lazy" data-release-artwork hidden>/);
assert.match(musicWorld, /window\.HaloReleaseArtwork\?\.wire\(\$\('#shop'\),fallbackArtwork\)/);
assert.doesNotMatch(musicWorld, /\.release-artwork-badge[^}]*display:\s*none/,
  "shop must not disable shared missing-art badges");

const nodes = new Map();
const node = selector => {
  if (!nodes.has(selector)) nodes.set(selector, {
    dataset: {}, hidden: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return name === "src" ? this.src : name === "alt" ? this.alt : this.attributes[name]; },
    removeAttribute(name) { delete this[name]; },
    addEventListener(name, callback) { this[name] = callback; }
  });
  return nodes.get(selector);
};
const badge = node("badge");
const frame = node("#shopFeatureFigure");
frame.classList = { toggle() {}, add() {}, remove() {} };
frame.querySelector = () => badge;
const image = node("#shopFeatureArtwork");
image.closest = () => frame;
const context = vm.createContext({
  URL, console: { warn() {} }, CustomEvent: class {},
  window: { location: { origin: "https://halo.example", pathname: "/music-world.html" }, dispatchEvent() {} },
  $: node, esc: String, cardStatus: () => "READY", featureDreamweaverLink: null,
  fallbackArtwork: DEFAULT_RELEASE_ARTWORK, fallbackArtworkBadge: "HALO placeholder cover"
});
vm.runInContext(browserHelper, context);
vm.runInContext(musicWorld.match(/const clearArtworkDataset=.*?;\n/)[0], context);
const spotlightRender = musicWorld.slice(musicWorld.indexOf("if(spotlight){"), musicWorld.indexOf("$('#shopProducts').innerHTML"));
const wire = () => context.window.HaloReleaseArtwork.wire({ querySelectorAll: () => [image] });
context.spotlight = { title: "Uploaded cover", artwork: "/uploads/original-cover.jpg", artworkSource: "manual" };
vm.runInContext(spotlightRender, context);
wire();
assert.equal(image.src, "/uploads/original-cover.jpg", "uploaded artwork URL must remain unchanged");
assert.equal(image.alt, "Uploaded cover artwork", "uploaded artwork alt text must remain intact");
assert.equal(image.hidden, false);
assert.equal(node("#shopFeatureArtworkFallback").hidden, true);
assert.equal(badge.hidden, true, "shared helper must hide its badge for real artwork");
assert.equal(frame.dataset.artworkState, "live");
image.error();
assert.equal(image.src, new URL(DEFAULT_RELEASE_ARTWORK, context.window.location.origin).href,
  "failed uploaded artwork must still recover to the shared fallback");
assert.equal(badge.hidden, false, "shared missing-art badge must remain available");
assert.equal(frame.dataset.artworkState, "fallback");
image.error();
assert.equal(frame.dataset.artworkState, "missing");
context.spotlight = { title: "No cover" };
vm.runInContext(spotlightRender, context);
assert.equal(image.hidden, true);
assert.equal(node("#shopFeatureArtworkFallback").hidden, false);
assert.equal(node("#shopFeatureArtworkFallback").textContent, "NO");
context.spotlight = null;
vm.runInContext(spotlightRender, context);
assert.equal(node("#shopFeatureArtworkFallback").textContent, "HW");

console.log("Release artwork contracts passed.");
