import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { loadDreamweaverUploadShow, pendingDreamweaverUploadShow } from "../lib/dreamweaver-upload.js";
import { buildDreamweaverStorefrontPath, cleanDreamweaverSongId } from "../lib/dreamweaver-storefront.js";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [musicPage, musicClient, musicStyles, uploadPage, uploadClient, home, routes, catalogApi, config] = await Promise.all([
  read("music/index.html"),
  read("music/music.js"),
  read("music/music.css"),
  read("music-upload/index.html"),
  read("music-upload/music-upload.js"),
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
assert.doesNotMatch(musicPage, /catalogWorkspaceDetails|sharedCatalogFrame|embed=shop/, "public shop must not embed artist management");
assert.match(musicPage, /Artist\? Sign in to your private workspace/, "artists retain a dedicated sign-in path");
for (const page of [musicPage, uploadPage]) {
  assert.doesNotMatch(page, /catalogWorkspaceDetails|sharedCatalogFrame|embed=shop|localVault/, "both public storefronts exclude local inventory and artist controls");
  assert.match(page, /Votes do not publish music or approve radio rotation/);
}

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
assert.doesNotMatch(musicClient, /catalogWorkspaceDetails|sharedCatalogFrame/, "public client must not load artist management");
assert.doesNotMatch(musicClient, /halo-song-catalog-height/, "public client no longer accepts artist-workspace messages");

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
assert.match(uploadClient, /satellite\?\.experienceUrl/, "upload controller must prefer the Dreamweaver satellite experience URL");
assert.match(uploadClient, /isDreamweaverExperienceUrl/, "upload controller must guard against non-Dreamweaver navigation targets such as raw audio asset URLs");

assert.match(catalogApi, /masterCopy: \{[\s\S]*versionType: "sale_master"/, "release catalog API must identify the sale master as the canonical master copy");
assert.match(catalogApi, /catalog_master_uploaded/, "release catalog API must report whether the master copy has been uploaded");
assert.match(uploadClient, /created\.masterVersionId \|\| created\.versionIds\?\.sale_master/, "upload controller must route source audio into the canonical master copy version");

console.log("Music upload storefront contracts passed.");

const songId = randomUUID();
const mixId = randomUUID();
const masterVersionId = randomUUID();
const song = { id: songId, pipelineStatus: "published", rightsStatus: "cleared" };
const publicRelease = {
  id: mixId, status: "published", isLiveVisible: true,
  catalog: { songId, masterCopy: { uploaded: true, versionId: masterVersionId } },
  dreamweaverHubUrl: buildDreamweaverStorefrontPath(songId, { mixId }),
};
const publicBinding = {
  songId, masterVersionId, status: "ready",
  audioSource: `/api/song-catalog/audio?versionId=${masterVersionId}&dreamweaver=1&songId=${songId}`,
  visualActs: Array.from({ length: 4 }, () => ({ uri: "/assets/cover.jpg" })),
};
function publicApi({ releases = [publicRelease], binding = publicBinding, unavailable = false } = {}) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, options) => {
      requests.push(url);
      assert.equal(options.credentials, "omit", "owner cookies must not authorize public readiness");
      assert.equal(options.cache, "no-store", "publication refresh must not reuse stale responses");
      return { ok: !unavailable, json: async () => url.startsWith("/api/release-catalog?") ? { releases } : { binding } };
    },
  };
}
for (const pipelineStatus of ["uploaded", "needs_assets", "dreamweaver_in_progress", "approved"]) {
  const api = publicApi();
  const show = await loadDreamweaverUploadShow({ ...song, pipelineStatus }, api);
  assert.equal(show.ready, false);
  assert.equal(show.route, "");
  assert.match(show.message, /Processing.*rights and review/);
  assert.equal(api.requests.length, 0, "build-active and approved are not publication");
}
for (const [record, api] of [
  [{ ...song, id: "invalid" }, publicApi()],
  [{ ...song, rightsStatus: "needs_review" }, publicApi()],
  [song, publicApi({ releases: [] })],
  [song, publicApi({ releases: [{ ...publicRelease, catalog: { ...publicRelease.catalog, songId: randomUUID() } }] })],
  [song, publicApi({ releases: [{ ...publicRelease, isLiveVisible: false }] })],
  [song, publicApi({ releases: [{ ...publicRelease, status: "draft" }] })],
  [song, publicApi({ releases: [{ ...publicRelease, catalog: { songId, masterCopy: { uploaded: false } } }] })],
  [song, publicApi({ binding: { ...publicBinding, songId: randomUUID() } })],
  [song, publicApi({ binding: { ...publicBinding, masterVersionId: randomUUID() } })],
  [song, publicApi({ binding: { ...publicBinding, status: "pending" } })],
  [song, publicApi({ binding: { ...publicBinding, audioSource: "" } })],
  [song, publicApi({ unavailable: true })],
  [song, { fetchImpl: async () => { throw new Error("Network unavailable"); } }],
]) {
  const show = await loadDreamweaverUploadShow(record, api);
  assert.equal(show.ready, false);
  assert.equal(show.route, "", "never offer a default or unrelated show when public readiness fails");
}
const readyApi = publicApi();
const readyShow = await loadDreamweaverUploadShow(song, readyApi);
assert.equal(new URL(readyApi.requests[0], "https://halo.test").searchParams.get("songId"), songId,
  "public readiness must look up the exact song outside the limited newest-release feed");
assert.equal(readyShow.ready, true);
assert.equal(readyShow.route, buildDreamweaverStorefrontPath(songId, { mixId, includeSatelliteFlag: true }));
const intendedMix = randomUUID();
const assignedSong = { ...song, dreamweaverSatellite: { route: buildDreamweaverStorefrontPath(songId, { mixId: intendedMix }) } };
assert.equal((await loadDreamweaverUploadShow(assignedSong, publicApi())).route,
  buildDreamweaverStorefrontPath(songId, { mixId: intendedMix }));

let lookupSql = "";
let lookupValues = [];
const releaseHandlerFixture = {
  URL, cleanDreamweaverSongId, console,
  json: (body, status = 200) => Response.json(body, { status }),
  serializeRelease: row => row,
  getDatabase: () => ({
    sql: async (strings, ...values) => {
      lookupSql = strings.join("?");
      lookupValues = values;
      // Simulate a song older than the default feed's latest 200 records.
      return values.includes(songId) ? [publicRelease] : Array.from({ length: 200 }, () => ({ id: randomUUID() }));
    },
  }),
};
vm.createContext(releaseHandlerFixture);
vm.runInContext(catalogApi.slice(catalogApi.indexOf("export default async function releaseCatalogHandler("),
  catalogApi.indexOf("export const config")).replace("export default ", ""), releaseHandlerFixture);
const exactResponse = await releaseHandlerFixture.releaseCatalogHandler(
  new Request(`https://halo.test/api/release-catalog?${new URLSearchParams({ songId })}`));
assert.deepEqual((await exactResponse.json()).releases, [publicRelease]);
assert.ok(lookupValues.includes(songId));
assert.match(lookupSql, /WHERE release\.status = 'published'\s+AND \(\? = '' OR catalog\.catalog_song_id = \?\)[\s\S]*LIMIT 200/,
  "exact-song filtering must precede the feed limit and retain publication gating");
assert.equal((await releaseHandlerFixture.releaseCatalogHandler(
  new Request("https://halo.test/api/release-catalog?songId=invalid"))).status, 400);

// Exercise the upload orchestration with IDs actually returned by its API fixture.
const calls = [];
const uploadFixture = {
  pendingDreamweaverUploadShow, loadDreamweaverUploadShow,
  setControllerPhase() {}, buildNotes: () => "", setMessage() {},
  apiJson: async (url, payload) => {
    calls.push({ url, payload });
    if (payload.action === "create_project") return { songId, masterVersionId };
    return { pipelineStatus: "dreamweaver_in_progress", departments: {} };
  },
  uploadAudio: async (id, versionId) => { assert.equal(id, songId); assert.equal(versionId, masterVersionId); },
  uploadArtwork: async id => assert.equal(id, songId),
  loadCatalogSong: async () => ({ ...song, pipelineStatus: "dreamweaver_in_progress" }),
};
vm.createContext(uploadFixture);
vm.runInContext(uploadClient.slice(uploadClient.indexOf("async function processPackage("), uploadClient.indexOf("async function handleRuntimeRetry(")), uploadFixture);
const result = await uploadFixture.processPackage({
  artistName: "Contract artist", title: "Returned upload", file: { name: "master.wav" },
  artworkFile: { name: "cover.jpg" }, position: 1, total: 1,
});
assert.equal(result.songId, songId);
assert.equal(result.dreamweaverShow.ready, false);
assert.equal(calls.at(-1).payload.toStage, "dreamweaver_in_progress");
assert.ok(!calls.some(call => call.payload.toStage === "published"), "upload must not auto-publish");
const resultNodes = { resultsList: { innerHTML: "" } };
const renderFixture = {
  state: { results: [result] }, elements: resultNodes,
  pendingDreamweaverUploadShow,
  escapeHtml: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;"),
  stageChip: () => "",
};
vm.createContext(renderFixture);
vm.runInContext(uploadClient.slice(uploadClient.indexOf("function renderResults("), uploadClient.indexOf("function isDreamweaverExperienceUrl(")), renderFixture);
renderFixture.renderResults();
assert.match(resultNodes.resultsList.innerHTML, /disabled>Open this song in Dreamweaver — not ready/);
assert.doesNotMatch(resultNodes.resultsList.innerHTML, /href="\/dreamweaver/);
result.dreamweaverShow = readyShow;
renderFixture.renderResults();
assert.match(resultNodes.resultsList.innerHTML, /Open this song in Dreamweaver ↗/);
const renderedRoute = resultNodes.resultsList.innerHTML.match(/href="([^"]+)"[^>]*>Open this song/)[1].replaceAll("&amp;", "&");
assert.equal(renderedRoute, buildDreamweaverStorefrontPath(songId, { mixId }));
assert.deepEqual(Object.fromEntries(new URL(renderedRoute, "https://halo.test").searchParams),
  { mix: mixId, song: songId, satellite: "dreamweaver" });
const catalogClient = await read("song-catalog/song-catalog.js");
const catalogPage = await read("song-catalog/index.html");
assert.match(catalogClient, /loadDreamweaverUploadShow\(song\)/, "active upload workspace must use the same public readiness check");
assert.match(catalogClient, /revision !== dreamweaverShowRevision/, "stale checks must not enable another song's action");
assert.match(catalogPage, /id="songShowStatus" role="status"/);
assert.match(catalogPage, /id="checkSongShow"/);
const showNodes = new Map();
const getShowNode = selector => {
  if (!showNodes.has(selector)) showNodes.set(selector, {
    hidden: false, textContent: "", href: "",
    removeAttribute(name) { if (name === "href") this.href = ""; },
  });
  return showNodes.get(selector);
};
let selected = song;
let resolveOldCheck;
const workspaceFixture = {
  $: getShowNode, pendingDreamweaverUploadShow, selectedSong: () => selected,
  postEmbeddedHeight() {},
  loadDreamweaverUploadShow: () => new Promise(resolve => { resolveOldCheck = resolve; }),
};
vm.createContext(workspaceFixture);
vm.runInContext(catalogClient.slice(catalogClient.indexOf("let dreamweaverShowRevision"), catalogClient.indexOf("async function requestSignIn(")), workspaceFixture);
const oldCheck = workspaceFixture.renderDreamweaverShow(song);
assert.equal(getShowNode("#songSatelliteLink").hidden, true);
selected = { ...song, id: randomUUID(), pipelineStatus: "dreamweaver_in_progress" };
workspaceFixture.loadDreamweaverUploadShow = async record => pendingDreamweaverUploadShow(record);
await workspaceFixture.renderDreamweaverShow(selected);
resolveOldCheck(readyShow);
await oldCheck;
assert.equal(getShowNode("#songSatelliteLink").hidden, true, "a stale successful check must not enable a different selected song");
assert.equal(getShowNode("#songSatelliteLink").href, "");
selected = song;
workspaceFixture.loadDreamweaverUploadShow = async () => readyShow;
await workspaceFixture.renderDreamweaverShow(song);
assert.equal(getShowNode("#songSatelliteLink").hidden, false);
assert.equal(getShowNode("#songSatelliteLink").href, readyShow.route);
assert.equal(getShowNode("#songShowNotReady").hidden, true);
console.log("Upload-to-Dreamweaver lifecycle, anonymous readiness, returned-ID CTA and canonical route contracts passed (mocked APIs).");
