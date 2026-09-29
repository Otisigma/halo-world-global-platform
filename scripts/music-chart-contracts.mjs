import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [page, client, styles, catalogApi] = await Promise.all([
  readFile(resolve(root, "music/index.html"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8"),
  readFile(resolve(root, "music/music.css"), "utf8"),
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8")
]);

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
assert.match(client, /youtube-nocookie\.com/, "chart video must use privacy-enhanced YouTube playback");
assert.match(client, /data-play-chart-video/, "chart stage must support in-place video playback");
assert.match(client, /storefrontState\(release\)/, "public release cards must normalize storefront status before rendering");
assert.match(client, /Release status", value: statusLabel/, "public release cards must render sanitized READY\/PENDING\/STANDBY states instead of raw upstream status strings");
assert.match(client, /satellite"\) === "music-video-fallback"/, "chart must keep fallback behavior behind a satellite query-flag path");
assert.match(client, /isFallbackVisual/, "chart must generate a per-release fallback visual when no playable video exists in satellite mode");
assert.match(client, /stage-art release-artwork-frame[\s\S]*release\.title[\s\S]*stage-artist/, "chart stage must keep release artwork paired with the active song and artist");
assert.match(client, /chart-art release-artwork-frame[\s\S]*chart-track[\s\S]*release\.title[\s\S]*release\.artist/, "chart rows must keep artwork paired with each song entry");
assert.match(client, /card-art release-artwork-frame[\s\S]*card-copy[\s\S]*release\.title[\s\S]*release\.artist/, "release cards must keep artwork paired with each release card");
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
