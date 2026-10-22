import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const [page, client, styles, catalogApi, chartApi] = await Promise.all([
  readFile(resolve(root, "music/index.html"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8"),
  readFile(resolve(root, "music/music.css"), "utf8"),
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/chart.mjs"), "utf8")
]);

assert.match(chartApi, /export const config\s*=\s*\{\s*path:\s*\["\/api\/catalog\/chart",\s*"\/api\/catalog\/vote"\]\s*\}/, "chart routes must be literal strings so Netlify can statically parse both endpoints");

assert.match(page, /The living chart/, "music catalog must identify the live chart");
assert.match(page, /Hip-Hop \/ Rap/, "chart must include a hip-hop room");
assert.match(page, /R&amp;B \/ Soul/, "chart must include an R&B and soul room");
assert.match(page, /House \/ Dance/, "chart must include a house and dance room");
assert.match(page, /Gospel \/ Inspirational/, "chart must include a gospel room");
assert.match(page, /Afrobeats \/ Global/, "chart must include a global room");
assert.match(page, /transparent HALO activity chart—not an industry sales chart/, "chart must explain what its rankings represent");
assert.match(catalogApi, /recent_listens/, "catalog API must expose rolling recent listening activity");
assert.match(catalogApi, /previous_listens/, "catalog API must expose the comparison window");
assert.match(client, /rankedReleases/, "client must calculate interactive room rankings");
{
  const source = client.match(/function isChartRelease\(release\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "chart must define a publication-aware eligibility filter");
  const isChartRelease = new Function(`${source}\nreturn isChartRelease;`)();
  assert.equal(isChartRelease({ inChart: true }), true);
  assert.equal(isChartRelease({ releaseStatus: "PUBLISHED" }), true);
  assert.equal(isChartRelease({ isChartEligible: true, status: "passed" }), true, "legacy eligible releases stay on the chart");
  assert.equal(isChartRelease({ isLiveVisible: false, inChart: true, releaseStatus: "PUBLISHED" }), false);
  assert.equal(isChartRelease({ isChartEligible: false, releaseStatus: "PUBLISHED" }), false, "explicitly non-chart published tracks stay excluded");
  assert.equal(isChartRelease({ isChartEligible: false, inChart: true }), false, "explicit chart exclusion overrides stale listing flags");
  assert.equal(isChartRelease({ releaseStatus: "READY" }), false);
  assert.equal(isChartRelease({}), false);
}
assert.match(client, /youtube-nocookie\.com/, "chart video must use privacy-enhanced YouTube playback");
assert.match(client, /data-play-chart-video/, "chart stage must support in-place video playback");
assert.match(client, /storefrontState\(release\)/, "public release cards must normalize storefront status before rendering");
assert.match(client, /Release status", value: statusLabel/, "public release cards must render sanitized READY\/PENDING\/STANDBY states instead of raw upstream status strings");
assert.match(client, /satellite"\) === "music-video-fallback"/, "chart must keep fallback behavior behind a satellite query-flag path");
assert.match(client, /isFallbackVisual/, "chart must generate a per-release fallback visual when no playable video exists in satellite mode");
assert.match(client, /stage-art release-artwork-frame[\s\S]*release\.title[\s\S]*stage-artist/, "chart stage must keep release artwork paired with the active song and artist");
assert.match(client, /chart-art release-artwork-frame[\s\S]*chart-track[\s\S]*release\.title[\s\S]*release\.artist/, "chart rows must keep artwork paired with each song entry");
assert.match(client, /card-art release-artwork-frame[\s\S]*card-copy[\s\S]*release\.title[\s\S]*release\.artist/, "release cards must keep artwork paired with each release card");
assert.match(client, /APPROVED_RELEASE_STATUSES = new Set\(\["passed", "published"\]\)/, "shop must only treat passed or published releases as approved");
assert.match(client, /state\.releases = \(Array\.isArray\(data\.releases\) \? data\.releases : \[\]\)\.filter\(isApprovedRelease\)/, "shop must drop unapproved releases before rendering the grid, chart, featured slot, and release count");
{
  const source = client.match(/const APPROVED_RELEASE_STATUSES[\s\S]*?function isApprovedRelease\(release\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "shop must define isApprovedRelease");
  const isApprovedRelease = new Function(`${source}\nreturn isApprovedRelease;`)();
  const visible = [
    { id: "satellite-01", status: "passed" },
    { id: "blessed", status: "published" },
    { id: "pending-track", status: "pending" },
    { id: "draft-track", status: "draft" },
    { id: "unverified-track" }
  ].filter(isApprovedRelease).map(release => release.id);
  assert.deepEqual(visible, ["satellite-01", "blessed"], "shop filter must hide pending, draft, and status-less tracks");
}
assert.match(styles, /\.chart-console/, "chart console must have a dedicated responsive layout");
{
  const source = client.match(/function isChartRelease\(release\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "shop must define its chart publication filter");
  const isChartRelease = new Function(`${source}\nreturn isChartRelease;`)();
  for (const release of [
    { inChart: true },
    { releaseStatus: "PUBLISHED" },
    { isChartEligible: true },
    { releaseStatus: "PUBLISHED", isChartEligible: true },
  ]) assert.equal(isChartRelease(release), true, "published and explicitly chart-eligible tracks must qualify");
  for (const release of [
    {},
    { releaseStatus: "DRAFT" },
    { releaseStatus: "PUBLISHED", isLiveVisible: false },
    { inChart: true, isLiveVisible: false },
    { releaseStatus: "PUBLISHED", isChartEligible: false },
    { inChart: true, isChartEligible: false },
  ]) assert.equal(isChartRelease(release), false, "hidden and explicitly non-chart tracks must stay excluded");
  assert.match(client, /if \(!isChartRelease\(release\)\)/, "ranking must use the publication filter");
  assert.match(catalogApi, /releaseStatus: normalizedCatalogStatus\(row\.status\)\.toUpperCase\(\)/, "public API must expose normalized publication status");
  assert.match(catalogApi, /inChart: row\.is_chart_eligible === true/, "public API must expose the canonical chart flag");
}
assert.match(styles, /\.chart-row\.is-active/, "chart rows must expose a selected state");
assert.match(styles, /\.stage-video-fallback-visual/, "chart styles must support fallback visual playback without remote media");
assert.match(client, /function formatAudioStreamUrl\(rawUrl\)[\s\S]*drive\.google\.com\/uc\?export=download&id=/, "shop player must convert Google Drive share links into direct stream URLs");
assert.match(client, /class HaloGlobalPlayer[\s\S]*this\.audio = new Audio\(\)/, "shop player must own a single global Audio instance");
assert.match(client, /window\.HaloPlayer = new HaloGlobalPlayer\(/, "shop player must be exposed as the window.HaloPlayer singleton");
assert.equal((client.match(/new Audio\(/g) || []).length, 1, "shop page must not create ad hoc Audio instances");
assert.match(client, /haloGlobalPlayerBar/, "shop player must mount the floating global player bar");
for (const id of ["haloPlayerCover", "haloPlayerTitle", "haloPlayerArtist", "haloPlayerToggle"]) {
  assert.match(client, new RegExp(`id="${id}"`), `floating player bar must render #${id}`);
}
assert.match(client, /querySelectorAll\("\[data-play-track-id\]"\)/, "shop player must sync play state across every rendered play button");
assert.match(client, /closest\('\[data-action="play-track"\], \[data-play-track-id\]'\)/, "shop play buttons must use delegated click handling");
assert.match(client, /document\.addEventListener\("click", handlePlayTrackClick\)/, "play clicks must be delegated from the document so dynamically rendered cards work");
assert.match(client, /function showToast\(message\) \{\s*if \(!elements\.toast\) \{\s*window\.alert\(message\)/, "player errors must fall back to alert when the toast is unavailable");
assert.match(client, /data-action="play-track" data-play-track-id=[\s\S]*data-track-id=[\s\S]*data-title=[\s\S]*data-artist=[\s\S]*data-audio-url=[\s\S]*data-cover=/, "play buttons must expose track metadata for the delegated player");
assert.match(client, /No preview audio is available for this release yet\./, "shop player must handle missing audio URLs gracefully");
assert.match(client, /addEventListener\("error"[\s\S]*This preview could not be streamed right now\./, "shop player must handle failing audio URLs gracefully");
assert.doesNotMatch(client, /<audio controls/, "featured preview must route through the global player instead of a separate audio element");
assert.match(styles, /\.halo-player-bar \{ position: fixed;/, "floating player bar must stay fixed at the bottom of the shop");
for (const selector of ["player-track-info", "player-cover-art", "player-meta", "player-controls", "player-toggle-btn"]) {
  assert.match(styles, new RegExp(`\\.${selector} \\{`), `floating player bar must style .${selector}`);
}
assert.match(styles, /\.chart-play/, "chart rows must style their delegated play control");

// Catalog metadata and feedback must come from supplied data, never demo values.
{
  const context = vm.createContext({
    URL,
    window: { location: { origin: "https://halo.test" } },
    APPROVED_RELEASE_STATUSES: new Set(["passed", "published"]),
    state: { releases: [], query: "", genre: "all", sort: "newest", chartSort: "signal" },
    releaseMatchesRoom: () => true,
    logMusicIssue() {}
  });
  for (const name of ["escapeHtml", "safeUrl", "isApprovedRelease", "catalogState", "catalogMetadataMarkup", "hasChartActivity", "catalogFeedbackMarkup", "chartSignal", "isChartRelease", "rankedReleases", "filteredReleases"]) {
    const source = client.match(new RegExp(`  function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}`))?.[0];
    assert.ok(source, `${name} must be available for behavioral checks`);
    vm.runInContext(source, context);
  }
  const metadata = context.catalogMetadataMarkup({
    albumTitle: '<img src=x onerror="alert(1)">',
    genres: ["R&B", "Soul"], duration: "3:42", bpm: 96, musicalKey: "F minor"
  });
  assert.match(metadata, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(metadata, /<img/);
  for (const value of ["Collection", "Label", "R&amp;B · Soul", "3:42", "96 BPM", "F minor"]) assert.ok(metadata.includes(value));
  const unknown = context.catalogMetadataMarkup({ bpm: null });
  assert.equal((unknown.match(/Not supplied/g) || []).length, 6);
  assert.doesNotMatch(context.catalogMetadataMarkup({ bpm: -10 }), /-10 BPM/);
  assert.match(context.catalogMetadataMarkup({ catalog: { albumTitle: "Catalog collection", genre: "Jazz" } }), /Catalog collection[\s\S]*Jazz/);
  for (const activity of [undefined, {}, { recentListens: 1 }, { recentListens: "5", recentOpens: 0, previousListens: 0, previousOpens: 0 }, { recentListens: -1, recentOpens: 0, previousListens: 0, previousOpens: 0 }, { recentListens: 0, recentOpens: 0, previousListens: 0, previousOpens: 0 }]) {
    assert.equal(context.hasChartActivity({ chartActivity: activity }), false);
    assert.match(context.catalogFeedbackMarkup({ chartActivity: activity }), /No recorded chart activity available/);
  }
  const chartActivity = { recentListens: 5, recentOpens: 2, previousListens: 0, previousOpens: 0 };
  assert.match(context.catalogFeedbackMarkup({ chartActivity }), /5 listen exits · 2 release-room opens/);
  for (const value of ["", "  ", undefined, null, "javascript:alert(1)", "https://user@halo.test/track.mp3"]) assert.equal(context.safeUrl(value), "");
  assert.equal(context.safeUrl("/audio/song.mp3"), "https://halo.test/audio/song.mp3");
  assert.equal(context.isApprovedRelease({ status: "published", isLiveVisible: false }), false);
  assert.equal(context.isApprovedRelease({ status: "draft" }), false);
  const release = { id: "recorded", title: "Recorded", artist: "Artist", status: "published", isChartEligible: true, genres: [], albumTitle: "Collection name", chartActivity };
  context.state.releases = [release, { ...release, id: "unmeasured", chartActivity: undefined }];
  assert.deepEqual(Array.from(context.rankedReleases(), item => item.id), ["recorded"], "unmeasured releases must not be ranked by freshness");
  context.state.query = "collection name";
  assert.equal(context.filteredReleases().length, 2, "collection metadata must be searchable");
  context.state.genre = "jazz";
  assert.equal(context.filteredReleases().length, 0, "search must respect the genre filter");

  const node = () => ({ innerHTML: "", textContent: "", hidden: false });
  Object.assign(context, {
    elements: { grid: node(), results: node(), reset: node(), count: node() },
    document: { querySelector: () => null },
    player: { syncButtons() {} },
    wireArtwork() {},
    releaseArtwork: () => ({ src: "/assets/releases/halo-premium-placeholder.svg", fallback: "/assets/releases/halo-premium-placeholder.svg" }),
    availabilitySummary: () => ({ badge: "STANDBY" }),
    releaseDossier: () => [],
    formatReleaseDate: () => "",
    trackStreamUrl: () => "",
    artworkAttributes: () => "",
    releaseMeta: () => "",
    releaseStoryline: () => "",
    dossierItemMarkup: () => "",
    releaseActions: () => "",
    resetCatalogFilters() {}
  });
  vm.runInContext(client.match(/  function renderGrid\(\) \{[\s\S]*?\n  \}/)[0], context);
  context.renderGrid();
  assert.match(context.elements.grid.innerHTML, /No matching releases/);
  assert.equal(context.elements.results.textContent, "Showing 0 of 2 releases");
  assert.equal(context.elements.reset.hidden, false);
  context.state.releases = [];
  context.renderGrid();
  assert.match(context.elements.grid.innerHTML, /No published releases available yet/);
  assert.doesNotMatch(context.elements.grid.innerHTML, /Clear filters/);
  context.state.releases = [{ ...release, title: "<script>unsafe</script>", artist: 'Artist "name"' }];
  context.state.query = "";
  context.state.genre = "all";
  context.renderGrid();
  assert.match(context.elements.grid.innerHTML, /<h3>&lt;script&gt;unsafe&lt;\/script&gt;<\/h3>/);
  assert.match(context.elements.grid.innerHTML, /Collection name/);
  assert.match(context.elements.grid.innerHTML, /In-page preview unavailable/);
  assert.doesNotMatch(context.elements.grid.innerHTML, /<script>|src=""|Editorial pick|card-number/);
  assert.equal(context.elements.results.textContent, "Showing 1 of 1 releases");
  assert.equal(context.elements.reset.hidden, true);
}
assert.match(page, /catalog-skip-link[\s\S]*href="#allReleasesTitle"/);
assert.match(page, /id="catalogResults" role="status"/);
assert.match(page, /Label, ratings, votes, and subscriber feedback are not supplied/);
assert.match(client, /elements\.reset\?\.addEventListener\("click", resetCatalogFilters\)/);
assert.doesNotMatch(client, /Editorial pick|class="card-number"/, "ordinary releases must not imply editorial endorsement or chart rank");
assert.match(styles, /prefers-reduced-motion: reduce/);

console.log("Music chart contracts passed.");
