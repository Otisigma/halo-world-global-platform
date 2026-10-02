import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  const source = client.match(/function isChartListed\(release\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "chart must define a publication-aware eligibility filter");
  const isChartRelease = new Function(`${source}\nreturn isChartListed;`)();
  assert.equal(isChartRelease({ inChart: true }), true);
  assert.equal(isChartRelease({ releaseStatus: "PUBLISHED" }), true);
  assert.equal(isChartRelease({ isChartEligible: true, status: "passed" }), true, "legacy eligible releases stay on the chart");
  assert.equal(isChartRelease({ isLiveVisible: false, inChart: true, releaseStatus: "PUBLISHED" }), false);
  assert.equal(isChartRelease({ isChartEligible: false, releaseStatus: "PUBLISHED" }), true, "published tracks remain included without the legacy chart flag");
  assert.equal(isChartRelease({ isChartEligible: false, inChart: true }), true, "explicit chart inclusion overrides the legacy chart flag");
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

console.log("Music chart contracts passed.");
