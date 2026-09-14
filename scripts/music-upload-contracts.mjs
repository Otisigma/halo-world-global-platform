import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [musicPage, musicClient, musicStyles, uploadPage, home, routes, catalogApi, config] = await Promise.all([
  read("music/index.html"),
  read("music/music.js"),
  read("music/music.css"),
  read("music-upload/index.html"),
  read("halo.html"),
  read("lib/route-registry.js"),
  read("netlify/functions/release-catalog.mjs"),
  read("netlify.toml"),
]);

assert.match(config, /from = "\/music-upload\/"[\s\S]*to = "\/music-upload\/index\.html"/, "music-upload route must resolve to the HALO shop entry file");
assert.match(routes, /directoryRoute\("HALO Shop", "\/music-upload\/", "music-upload\/index\.html", \{ menuLabel: "HALO SHOP" \}\)/, "route registry must publish /music-upload/ as the HALO Shop route");
assert.match(uploadPage, /data-shop-path="\/music-upload\/"/, "music-upload entry page must preserve its public shop path for deep links");
assert.match(uploadPage, /HALO Shop — Listen, Buy, and Share/, "music-upload entry page must serve the HALO shop storefront copy");
assert.match(uploadPage, /music\/music\.js/, "music-upload entry page must reuse the shared shop runtime");
assert.doesNotMatch(uploadPage, /Halo Music Upload|sharedSongCatalog|musicUploadForm/, "legacy bridge shell markup must not remain in the music-upload entry file");

assert.match(musicPage, /public HALO shop front/i, "shop page must describe the public storefront role");
assert.match(musicPage, /Listen\. Buy\.[\s\S]*Share\./, "shop page must headline listening, buying, and sharing");
assert.match(musicPage, /artist-controlled songs from the shared catalog/i, "shop page must keep the shared catalog as the public source-of-truth copy");
assert.match(musicPage, /<details class="catalog-workspace-details" id="catalogWorkspaceDetails">/, "shop page must expose the shared song catalog inside a native collapsible details panel");
assert.match(musicPage, /data-src="\/song-catalog\/\?embed=shop"/, "shop page must keep the shared song catalog workspace embeddable beneath the storefront");
assert.match(musicPage, /sandbox="allow-same-origin allow-scripts allow-forms allow-modals"/, "shop page must sandbox the embedded shared song catalog workspace explicitly");

assert.match(musicClient, /\/api\/release-catalog/, "shop client must load the shared release catalog API");
assert.match(musicClient, /release\.catalog/, "shop client must read shared song-catalog metadata from the release API");
assert.match(musicClient, /navigator\.share/, "shop client must support native sharing when available");
assert.match(musicClient, /clipboard\.writeText/, "shop client must support copy-link sharing");
assert.match(musicClient, /dataset\.shopPath/, "shop client must read the page-level public route signal");
assert.match(musicClient, /new URL\(shopPath\(\), window\.location\.origin\)/, "shop client must build canonical route URLs from the public shop path");
assert.match(musicClient, /searchParams\.set\("song", release\.id\)/, "shop client must create per-song share URLs");
assert.match(musicClient, /history\.replaceState/, "shop client must keep spotlighted songs deep-linkable");
assert.match(musicClient, /relatedReleases/, "shop client must expose related songs from the shared catalog feed");
assert.match(musicClient, /availabilitySummary/, "shop client must render public-safe rights and availability messaging");
assert.match(musicClient, /data-featured-heading/, "shop client must move focus to the updated spotlight heading for accessibility");
assert.match(musicClient, /catalogWorkspaceDetails/, "shop client must wire the shared song catalog panel");
assert.match(musicClient, /halo-song-catalog-height/, "shop client must resize the embedded song catalog when the shared workspace reports its height");

assert.match(musicStyles, /\.shop-panel/, "shop styles must include the storefront detail layout");
assert.match(musicStyles, /\.availability-note/, "shop styles must expose rights-aware availability messaging");
assert.match(musicStyles, /\.action\.tertiary/, "shop styles must support share and spotlight controls");
assert.match(musicStyles, /\.related-release/, "shop styles must support related-song navigation");
assert.match(musicStyles, /\.catalog-workspace-details/, "shop styles must support the collapsible shared song catalog panel");
assert.match(musicStyles, /\.shared-catalog-frame/, "shop styles must size the embedded song catalog workspace");

assert.match(catalogApi, /halo_song_catalog/, "release catalog API must reuse the shared song catalog data source");
assert.match(catalogApi, /halo_song_versions/, "release catalog API must reuse shared version data for storefront context");
assert.match(catalogApi, /catalog_song_id/, "release catalog API must expose shared catalog linkage");
assert.match(catalogApi, /catalog_rights_status/, "release catalog API must expose rights-aware catalog status");
assert.match(catalogApi, /catalog_sale_price_cents/, "release catalog API must expose catalog-driven support pricing");
assert.match(catalogApi, /catalog_sale_enabled_count/, "release catalog API must expose sale-enabled shared-version counts for storefront messaging");
assert.match(catalogApi, /source: row\.catalog_song_id \? "song-catalog" : "release-catalog"/, "release catalog API must identify when storefront data came from the shared song catalog");

assert.match(home, /href="\/music-upload\/"[\s\S]*HALO SHOP/, "HALO navigation must advertise the storefront instead of the old upload bridge");
assert.match(home, /Public song shop for listening, buying, sharing, and artist-controlled release context/, "HALO navigation copy must describe the public shop role");

console.log("Music upload storefront contracts passed.");
