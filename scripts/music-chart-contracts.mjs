import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import "./catalog-distribution-contracts.mjs";
import { chartSignalScore } from "../lib/chart-signal.js";

const root = resolve(import.meta.dirname, "..");
const [page, uploadPage, client, styles, catalogApi, chartApi, genreRoomSource, discoveryPage, discoveryClient, routeRegistry, netlifyConfig] = await Promise.all([
  readFile(resolve(root, "music/index.html"), "utf8"),
  readFile(resolve(root, "music-upload/index.html"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8"),
  readFile(resolve(root, "music/music.css"), "utf8"),
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/chart.mjs"), "utf8"),
  readFile(resolve(root, "music/genre-rooms.js"), "utf8"),
  readFile(resolve(root, "discover/index.html"), "utf8"),
  readFile(resolve(root, "discover/discover.js"), "utf8"),
  readFile(resolve(root, "lib/route-registry.js"), "utf8"),
  readFile(resolve(root, "netlify.toml"), "utf8")
]);

assert.match(chartApi, /export const config\s*=\s*\{\s*path:\s*\["\/api\/catalog\/chart",\s*"\/api\/catalog\/vote"\]\s*\}/, "chart routes must be literal strings so Netlify can statically parse both endpoints");

assert.match(page, /The living chart/, "music catalog must identify the live chart");
assert.match(page, /<details class="catalog-genre-disclosure" id="catalogGenreDisclosure">/, "the public catalog genre list must be collapsible");
assert.match(page, /id="allReleasesFilter"/, "All releases remains available as a quick filter");
assert.match(styles, /\.catalog-genre-disclosure > summary::after/, "the collapsed genre filter needs a visible disclosure affordance");
assert.match(page, /Electronic &amp; Deep House/, "chart must expose the electronic and deep-house gateway");
assert.match(page, /Afrobeats &amp; Global Sounds/, "chart must name the global gateway without making it a catch-all");
assert.match(page, /Ambient &amp; Experimental/, "chart must expose the ambient gateway");
assert.match(page, /Rock &amp; Alternative/, "chart must expose the rock gateway");
assert.match(page, /Hip-Hop \/ Rap/, "chart must keep specialist hip-hop room");
assert.match(page, /R&amp;B \/ Soul/, "chart must keep specialist R&B and soul room");
assert.match(page, /Gospel \/ Inspirational/, "chart must keep specialist gospel room");
assert.match(page, /This room features Afrobeats and global sounds, ranked by recent 7-day listener activity/, "global-room tooltip describes the audience and ranking window");
const genreWindow = {};
vm.runInNewContext(genreRoomSource, { window: genreWindow });
assert.deepEqual(Array.from(genreWindow.HaloGenreRooms.gateways, room => room.label), [
  "Electronic & Deep House", "Afrobeats & Global Sounds", "Ambient & Experimental", "Rock & Alternative"
], "four genre gateways receive equal primary placement");
assert.equal(genreWindow.HaloGenreRooms.matches({ genres: ["Atmospheric Deep House", "Afro House"], bpm: 122 }, "dance"), true);
assert.equal(genreWindow.HaloGenreRooms.matches({ genres: ["Afrobeats", "Amapiano", "Global Sounds"] }, "global"), true);
assert.equal(genreWindow.HaloGenreRooms.matches({ catalog: { genre: "Cinematic Ambient, Experimental" } }, "ambient"), true);
assert.equal(genreWindow.HaloGenreRooms.matches({ genres: ["Alternative Rock", "Indie Rock"] }, "rock-alternative"), true);
assert.equal(genreWindow.HaloGenreRooms.matches({ genres: ["Afrobeats"] }, "dance"), false, "global rhythms are not swept into electronic");
assert.equal(genreWindow.HaloGenreRooms.matches({ genres: ["Deep House"] }, "global"), false, "electronic releases keep their own gateway");
for (const [markup, name] of [[uploadPage, "music-upload"], [page, "music"]]) {
  for (const label of ["Electronic &amp; Deep House", "Afrobeats &amp; Global Sounds", "Ambient &amp; Experimental", "Rock &amp; Alternative"]) {
    assert.ok(markup.includes(label), `${name} shows the equal ${label} gateway`);
  }
  assert.match(markup, /More genre rooms/, `${name} retains specialist genre tabs`);
  assert.match(markup, /src="\/music\/genre-rooms\.js"[\s\S]*src="\/music\/music\.js"/, `${name} loads shared room metadata before the chart client`);
}
assert.match(discoveryPage, /id="genreGateways"/);
assert.match(discoveryPage, /id="specialistRooms"/);
assert.match(discoveryPage, /id="audio" controls preload="none"/, "discovery playback is explicit and user initiated");
assert.match(discoveryClient, /filter\(approved\)/, "discovery only shows approved public releases");
assert.match(discoveryClient, /resolveAudio\(release, \{ preferPreview: true, requirePlayable: true \}\)/);
assert.match(discoveryClient, /new URLSearchParams\(\{ song: release\.id, add: release\.id \}\)/, "Add to Mix returns to the existing playlist picker");
assert.doesNotMatch(discoveryClient, /innerHTML/, "artist-supplied text is never interpolated into markup");
assert.match(client, /function openRequestedAdd\(\)/, "music catalog opens the existing private playlist picker");
assert.match(client, /requestedRoom/, "catalog follows discovery gateway links");
assert.match(routeRegistry, /directoryRoute\("Artist Discovery", "\/discover\/", "discover\/index\.html"/);
assert.match(netlifyConfig, /from = "\/discover\/"[\s\S]*to = "\/discover\/index\.html"/);
assert.match(page, /HALO interactions, not verified streams, sales or worldwide listener rankings/, "chart must explain what its rankings represent");
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
assert.match(client, /stage-heading[\s\S]*release\.title[\s\S]*stage-artist[\s\S]*release\.artist[\s\S]*stage-art release-artwork-frame/, "chart stage must keep release artwork paired with the active song and artist");
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
  const names = ["escapeHtml", "hasChartActivity", "chartSignal", "chartOrbitMarkup"];
  const sources = names.map(name => {
    const source = client.match(new RegExp(`  function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}`))?.[0];
    assert.ok(source, `${name} must exist`);
    return source;
  });
  const orbit = new Function("scoreChartSignal", `${sources.join("\n")}\nreturn chartOrbitMarkup;`)(chartSignalScore);
  const markup = orbit({
    title: '<Signal & song>',
    chartActivity: { recentListens: 2, recentOpens: 1, previousListens: 2, previousOpens: 0 }
  });
  assert.match(markup, /Signal orbit for &lt;Signal &amp; song&gt;/);
  assert.match(markup, /stroke-dasharray="100\.00 100"/);
  assert.match(markup, /stroke-dasharray="84\.21 100"/, "rings compare real weighted period totals");
  assert.match(markup, /<strong>19<\/strong><small>2 listen exits · 1 room opens/);
  assert.match(markup, /<strong>16<\/strong><small>2 listen exits · 0 room opens/);
  assert.match(markup, /Not a timeline or listener count/);
  assert.match(orbit({ title: "Unknown" }), /Waiting for a signal/);
  assert.doesNotMatch(orbit({ title: "Unknown" }), /stroke-dasharray=/);
  assert.match(orbit({ title: "Empty", chartActivity: { recentListens: 0, recentOpens: 0, previousListens: 0, previousOpens: 0 } }), /Waiting for a signal/);
  assert.match(client, /\$\{chartOrbitMarkup\(release\)\}/, "the selected release displays its own orbit");
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.orbit-guide, \.orbit-satellite/, "only decorative elements animate when motion is allowed");
}
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
  assert.match(client, /!discovery && !isChartRelease\(release\)/, "ranking must use the publication filter while public discovery stays inclusive");
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

// Living Chart coverage must stay visible and must not depend on Drive or placeholder songs.
for (const page of ["music/index.html", "music-upload/index.html"]) {
  const html = await readFile(resolve(root, page), "utf8");
  assert.match(html, /id="chartCoverage" role="status"/, `${page} must show Living Chart coverage`);
  assert.match(html, /data-chart-sort="discovery"/, `${page} must expose deeper catalog discovery`);
  assert.match(html, /up to 20/, `${page} must explain the chart capacity`);
  assert.match(html, /<details class="catalog-genre-disclosure" id="catalogGenreDisclosure">/, `${page} must provide the shared catalog's collapsible genre panel`);
  const requiredElements = ["allReleasesFilter", "catalogGenreSummary", "genreFilter"];
  for (const id of requiredElements) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${page} must provide exactly one #${id} for music.js`);
  }
}
assert.match(client, /renderChartCoverage\(chartCoverageText\(coverage\)\)/, "chart render must publish coverage");
assert.match(client, /href="#allReleasesTitle"/, "chart coverage must link to the full catalog");
assert.match(client, /No placeholder songs are shown/, "catalog failure must pause the chart without placeholder songs");
for (const name of ["isChartRelease", "hasChartActivity", "chartCoverage", "rankedReleases"]) {
  const source = client.match(new RegExp(`  function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}`))?.[0] || "";
  assert.ok(source, `${name} must exist`);
  assert.doesNotMatch(source, /drive|GOOGLE_/i, `${name} must not depend on Drive configuration`);
}
assert.doesNotMatch(client, /GOOGLE_DRIVE_MASTERS_FOLDER_ID/, "the public chart must not read Drive master configuration");

// Catalog metadata and feedback must come from supplied data, never demo values.
{
  const context = vm.createContext({
    URL,
    window: { location: { origin: "https://halo.test" } },
    APPROVED_RELEASE_STATUSES: new Set(["passed", "published"]),
    state: { releases: [], query: "", genre: "all", sort: "newest", chartSort: "signal" },
    releaseMatchesRoom: () => true,
    logMusicIssue() {},
    scoreChartSignal: chartSignalScore
  });
  for (const name of ["escapeHtml", "safeUrl", "isApprovedRelease", "catalogState", "catalogMetadataMarkup", "hasChartActivity", "catalogFeedbackMarkup", "chartSignal", "isChartRelease", "rankedReleases", "filteredReleases", "catalogGenreEntries", "chartCoverage", "chartCoverageText"]) {
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
  assert.deepEqual(Array.from(context.catalogGenreEntries([
    { genres: ["AFRO BEATS", "AfroBeats", "Afrobeats House,", "Afrobeats House,DJ MIX"] },
    { genres: ["Afrobeat", "Deep House"] },
    { genres: [], catalog: { genre: "Deep House, Afro House" } },
    { genres: ["R&B / Soul"] },
    { genres: ["deep house"] },
    { genres: [] }
  ]), ([key, item]) => [key, item.label, item.count]), [
    ["deep house", "Deep House", 3],
    ["afrobeats", "Afrobeats", 2],
    ["afro house", "Afro House", 1],
    ["afrobeats house", "Afrobeats House", 1],
    ["dj mix", "DJ Mix", 1],
    ["r&b soul", "R&B / Soul", 1]
  ], "genre aliases, multi-tags, catalog fallback, distinct release counts, and sorting must be consistent");
  context.state.releases = [
    { id: "afro-one", status: "published", genres: ["Afro beats", "Afrobeats House, DJ MIX"] },
    { id: "afro-two", status: "published", genres: ["Afrobeat"] },
    { id: "house", status: "published", genres: ["Deep House"] },
    { id: "uncategorized", status: "published", genres: [] }
  ];
  context.state.genre = "__uncategorized__";
  assert.deepEqual(Array.from(context.filteredReleases(), item => item.id), ["uncategorized"], "uncategorized filter keeps public releases with no genre");
  context.state.genre = "afrobeats";
  assert.deepEqual(Array.from(context.filteredReleases(), item => item.id), ["afro-one", "afro-two"], "genre filters match canonical aliases");
  context.state.genre = "all";
  context.state.releases = [release, { ...release, id: "unmeasured", chartActivity: undefined }];
  assert.deepEqual(Array.from(context.rankedReleases(), item => item.id), ["recorded"], "unmeasured releases must not be ranked by freshness");
  const coverage = context.chartCoverage();
  assert.deepEqual({ ...coverage }, { total: 2, eligible: 2, active: 1, shown: 1, waiting: 1 }, "chart coverage must count eligible releases hidden for lack of activity");
  assert.match(context.chartCoverageText(coverage), /Showing 1 of 2 chart-eligible releases in this room\. 1 has no cumulative votes and no listening clicks or release-room opens/);
  assert.match(context.chartCoverageText({ total: 0, eligible: 0, active: 0, shown: 0, waiting: 0 }), /No published releases/);
  assert.match(context.chartCoverageText({ total: 5, eligible: 0, active: 0, shown: 0, waiting: 0 }), /None of the 5 published releases are chart-eligible/);
  assert.match(context.chartCoverageText({ total: 3, eligible: 3, active: 3, shown: 3, waiting: 0 }), /Every eligible release has recorded clicks or opens/);
  context.state.query = "collection name";
  assert.equal(context.filteredReleases().length, 2, "collection metadata must be searchable");
  context.state.genre = "jazz";
  assert.equal(context.filteredReleases().length, 0, "search must respect the genre filter");
  {
    const savedReleases = context.state.releases;
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      ...release, id: `chart-${index}`, releaseDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
      chartActivity: { recentListens: index + 1, recentOpens: 0, previousListens: 0, previousOpens: 0 }
    }));
    context.state.releases = candidates;
    for (const sort of ["signal", "listens", "opens", "newest"]) {
      context.state.chartSort = sort;
      assert.equal(context.rankedReleases().length, 20, `${sort} must show up to 20 releases, not 10`);
      assert.equal(context.chartCoverage().shown, 20);
    }
    context.state.chartSort = "signal";
    assert.equal(context.rankedReleases()[0].id, "chart-24", "ranking still orders by real activity");
    const inactive = { ...release, id: "inactive", releaseDate: "2026-11-11", chartActivity: undefined };
    context.state.releases = [candidates[0], inactive,
      { ...inactive, id: "excluded", isChartEligible: false },
      { ...inactive, id: "hidden", isLiveVisible: false }];
    assert.deepEqual(Array.from(context.rankedReleases(), item => item.id), ["chart-0"], "activity charts must not invent scores to pad a Top 20");
    context.state.chartSort = "discovery";
    assert.deepEqual(Array.from(context.rankedReleases(), item => item.id), ["chart-0", "excluded", "inactive"], "discovery includes all public songs, even unmeasured and listening-only, but never hidden releases");
    assert.equal(context.chartCoverage().shown, 3);
    assert.match(context.chartCoverageText(context.chartCoverage()), /Discovery order is not a chart rank/);
    context.releaseMatchesRoom = candidate => candidate.id === "inactive";
    assert.deepEqual(Array.from(context.rankedReleases(), item => item.id), ["inactive"], "discovery still respects the selected genre room");
    assert.equal(context.chartCoverage().shown, 1);
    context.releaseMatchesRoom = () => true;
    context.state.releases = candidates.map(candidate => ({ ...candidate, chartActivity: undefined }));
    assert.equal(context.rankedReleases().length, 25, "public discovery must not have a Top 20 cap");
    assert.equal(context.chartCoverage().shown, 25);
    context.state.releases = Array.from({ length: 83 }, (_, index) => ({ ...release, id: `public-${index}`, title: `Song ${index}`, chartActivity: undefined }));
    context.state.releases.push({ ...release, id: "private", isLiveVisible: false }, { ...release, id: "draft", status: "draft" });
    assert.equal(context.rankedReleases().length, 83, "the entire 66+ catalog remains discoverable with private/draft exclusions");
    context.state.chartQuery = "Song 82";
    assert.deepEqual(Array.from(context.rankedReleases(), item => item.id), ["public-82"], "chart search finds a release beyond the ranking cap");
    context.state.chartQuery = "";
    context.state.chartSort = "arrivals";
    assert.equal(context.rankedReleases().length, 83, "new arrivals are a discovery view, not an activity ranking");
    assert.match(context.chartCoverageText(context.chartCoverage()), /newest first/);
    context.state.chartSort = "signal";
    context.state.releases = [
      { ...release, id: "vote-only", chartActivity: undefined, votes: 10 },
      { ...release, id: "recent", votes: 0, chartActivity: { ...chartActivity, recentListens: 6, recentOpens: 0 } },
      { ...release, id: "previous", votes: 0, chartActivity: { ...chartActivity, recentListens: 0, recentOpens: 0, previousListens: 100 } }
    ];
    assert.deepEqual(Array.from(context.rankedReleases(), item => item.id), ["vote-only", "recent", "previous"], "cumulative votes count and previous-window activity provides eligibility, not extra current score");
    assert.equal(context.chartSignal(context.state.releases[0]).score, chartSignalScore({ votes: 10 }));
    context.state.releases = savedReleases;
    context.state.chartSort = "signal";
  }

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
    playTrackButton: () => "",
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
  assert.doesNotMatch(context.elements.grid.innerHTML, /<script>|src=""|Editorial pick|card-number/i);
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
