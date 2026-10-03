import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { allowedEvents } from "../netlify/lib/stats.mjs";

const root = resolve(import.meta.dirname, "..");
const [client, styles, stats, summary, statsLib, statsEvent, haloHome, releaseCatalogApi, musicWorld, dreamweaver] = await Promise.all([
  readFile(resolve(root, "music-player.js"), "utf8"),
  readFile(resolve(root, "music-player.css"), "utf8"),
  readFile(resolve(root, "stats.js"), "utf8"),
  readFile(resolve(root, "netlify/functions/stats-summary.mjs"), "utf8"),
  readFile(resolve(root, "netlify/lib/stats.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/stats-event.mjs"), "utf8"),
  readFile(resolve(root, "halo.html"), "utf8"),
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8"),
  readFile(resolve(root, "music-world.html"), "utf8"),
  readFile(resolve(root, "dreamweaver/dreamweaver.js"), "utf8")
]);

for (const eventName of [
  "music_player_open",
  "music_playback_start",
  "music_preview_reached",
  "music_preview_continue",
  "music_playback_milestone",
  "music_playback_complete",
  "music_player_close",
  "music_external_open"
]) {
  assert.equal(allowedEvents.has(eventName), true, `${eventName} must be accepted by analytics`);
  assert.equal(client.includes(`"${eventName}"`), true, `${eventName} must be emitted by the player`);
}

assert.match(client, /youtube-nocookie\.com/, "YouTube playback must use the privacy-enhanced embed host");
assert.match(client, /quick_15: 15, sample_30: 30, full_listen: 0/, "preview duration variants must remain measurable");
assert.match(client, /MutationObserver/, "dynamically rendered music links must be discovered");
assert.match(client, /dataset\.haloPlayer === "off"/, "links must support an explicit player opt-out");
assert.match(client, /dataset\.haloPlayerArtist/, "the player should read artist metadata from link dataset fields");
assert.match(client, /halo-listening-room__facts/, "the player should render rich now-playing metadata rows");
assert.match(styles, /halo-listening-room__meta/, "the listening room styles must support the metadata panel");
assert.match(styles, /PLAY HERE/, "eligible links must advertise on-site playback");
assert.match(stats, /music-player\.js/, "the shared analytics client must load the player");
assert.match(haloHome, /resolveDreamweaverPreviewUrl/, "the homepage Dreamweaver player must validate preview audio sources before playback");
assert.match(haloHome, /dreamweaverPreviewCandidates/, "the homepage Dreamweaver player must keep alternate preview candidates available");
assert.match(haloHome, /preload="metadata"/, "the homepage Dreamweaver player must preload metadata for reliable click-to-play behavior");
assert.match(haloHome, /Preview loading/, "the homepage Dreamweaver player must expose a loading state");
assert.match(haloHome, /Preview ready/, "the homepage Dreamweaver player must expose a ready state");
assert.match(haloHome, /Preview playing/, "the homepage Dreamweaver player must expose a playing state");
assert.match(haloHome, /Preview unavailable/, "the homepage Dreamweaver player must expose a failed state");
assert.match(haloHome, /playDreamweaverPreviewCandidates/, "the homepage Dreamweaver player must use fallback-aware playback attempts");
assert.match(haloHome, /This preview source failed\. Loading the next Dreamweaver signal\./, "the homepage Dreamweaver player must explain automatic source fallback");
assert.match(haloHome, /dreamweaverPreviewRetryAllowedRef\.current[\s\S]*!dreamweaverPreviewRetryActiveRef\.current[\s\S]*nextCandidates\.length/, "the homepage Dreamweaver player must only retry to the next candidate after a guarded play attempt");
assert.match(releaseCatalogApi, /catalog_album_title/, "release catalog must include song-catalog album metadata for player hydration");
assert.match(releaseCatalogApi, /catalog_genre/, "release catalog must include song-catalog genre metadata for player hydration");
assert.match(releaseCatalogApi, /catalog_artwork_url/, "release catalog must include song-catalog artwork metadata for player hydration");
assert.match(releaseCatalogApi, /catalog_video_url/, "release catalog must include song-catalog release video metadata");
assert.match(releaseCatalogApi, /catalog_promo_video_url/, "release catalog must include song-catalog promo video metadata");
assert.match(releaseCatalogApi, /const storefront = storefrontStateFor\(row\);[\s\S]*storefront,/, "release catalog must expose sanitized storefront status metadata");
assert.match(releaseCatalogApi, /Access-Control-Allow-Origin/, "release catalog must emit browser-friendly CORS headers");
assert.match(musicWorld, /<script src="\/release-artwork\.js"><\/script>/, "music world must load the shared artwork resolver");
assert.match(musicWorld, /album\s*:\s*release\.albumTitle\s*\|\|\s*release\.collectionTitle\s*\|\|\s*details\.albumTitle\s*\|\|\s*''/, "music world player mapping must hydrate album metadata from catalog fallbacks");
assert.match(musicWorld, /genre\s*:\s*genres\[0\]\s*\|\|\s*details\.genre\s*\|\|\s*''/, "music world player mapping must hydrate genre metadata from catalog fallbacks");
assert.match(musicWorld, /resolveTrackArtwork=release=>\{[\s\S]*window\.HaloReleaseArtwork\?\.resolve/, "music world storefront cards must use the shared artwork resolver");
assert.match(musicWorld, /resolveTrackAudio=release=>\{[\s\S]*window\.HaloReleaseArtwork\?\.resolveAudio/, "music world storefront cards must normalize audio with the shared resolver");
assert.match(musicWorld, /videoUrl=safeHref\(release\.promoVideoUrl\|\|release\.videoUrl\|\|details\.promoVideoUrl\|\|details\.videoUrl\)/, "music world track mapping must surface release and promo video URLs from catalog fallbacks");
assert.match(musicWorld, /Watch release video/, "music world product cards must expose release video links when available");
assert.match(musicWorld, /sanitizeDreamweaverExperienceUrl=value=>\{[\s\S]*url\.origin!==location\.origin[\s\S]*\/\^\\\/dreamweaver\\\/\?\$\/i\.test\(url\.pathname\)/, "music world Dreamweaver menu entry must sanitize route assignments to same-origin Dreamweaver paths");
assert.match(musicWorld, /id="shopFeatureDreamweaverLink"[\s\S]*Open Dreamweaver song lobby[\s\S]*const dreamweaverEntry=track\.dreamweaverUrl/, "music world storefront must expose a visible Dreamweaver song lobby menu-box entry for featured and card releases");
assert.match(haloHome, /href="\/music-world\.html"[\s\S]*data-stat-target="homepage_hero_shop"[\s\S]*See the shop in Music World/, "the homepage hero must expose a direct shop entry into Music World");
assert.match(haloHome, /href="\/dreamweaver\/"[\s\S]*data-stat-target="mobile_nav"[\s\S]*DREAMWEAVER SONG LOBBY/, "the mobile navigation must surface a same-origin Dreamweaver Song Lobby entry");
assert.match(haloHome, /aria-label="HALO footer destinations"[\s\S]*href="\/music-world\.html"[\s\S]*data-stat-target="footer"[\s\S]*MUSIC WORLD SHOP[\s\S]*href="\/dreamweaver\/"[\s\S]*data-stat-target="footer"[\s\S]*DREAMWEAVER SONG LOBBY/, "the footer must surface both Music World shop and same-origin Dreamweaver Song Lobby entries");
assert.match(musicWorld, /data-halo-player="audio"/, "music world storefront previews must keep direct audio previews player-safe");
assert.match(musicWorld, /<label class="btn upload-label" for="mixFileInput"[^>]*>Upload local mix<\/label><input id="mixFileInput" type="file" accept="audio\/\*/, "music world player must expose a visible local mix upload control");
assert.match(musicWorld, /<audio id="musicWorldAudio" preload="metadata"/, "music world PLAY STREAM must drive a real HTML5 audio element");
assert.doesNotMatch(musicWorld, /createBufferSource|WEB AUDIO SYNTH LOCKED/, "music world must not fake playback with a synthesized carrier");
assert.match(musicWorld, /const REMOTE_AUDIO_WATCHDOG_MS=5000;[\s\S]*function armRemoteAudioWatchdog\(\)\{[\s\S]*readyState<HTMLMediaElement\.HAVE_CURRENT_DATA\)handleStreamUnavailable\(\)/, "music world must guard remote streams with a readiness watchdog");
assert.match(musicWorld, /el\.addEventListener\('error',[\s\S]*handleStreamUnavailable\(\)/, "music world must turn audio element errors into a friendly standby state");
assert.match(musicWorld, /audioSourceMode==='unavailable'\|\|!track\?\.previewUrl\)\)\{[\s\S]*openMixFilePicker\(\);return\}/, "music world PLAY STREAM must open the file picker when the stream is unavailable");
assert.match(musicWorld, /safeBlobMediaUrl\(URL\.createObjectURL\(file\)\)[\s\S]*audioSourceMode='local';el\.src=localAudioUrl;el\.load\(\)/, "music world must bind uploaded local mixes to the player through a blob URL");
assert.match(musicWorld, /'LOCAL ACTIVE'/, "music world must surface LOCAL ACTIVE while a local mix is loaded");
assert.match(musicWorld, /if\(document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',bindPlayerControls,\{once:true\}\);else bindPlayerControls\(\);/, "music world player controls must bind once after DOMContentLoaded");
assert.match(musicWorld, /const storefrontStatus=\(value,\{hasStream=false,hasDestination=false\}=\{\}\)=>/, "music world storefront status must depend on stream and destination usability");
assert.match(musicWorld, /RADIO \$\{esc\(sanitizeRadioStatus\(t\.radioStatus\)\)\}/, "music world radio badges must never render raw radio states");
assert.doesNotMatch(musicWorld, /'ERROR'|STATUS: ERROR/, "music world must never render raw ERROR states to public storefront users");
assert.match(releaseCatalogApi, /"Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type"/, "release catalog must expose media headers to browsers");
assert.match(dreamweaver, /dataset\.haloPlayerAlbum\s*=\s*cleanText\(state\.release\?\.albumTitle\s*\|\|\s*state\.release\?\.collectionTitle\s*\|\|\s*state\.release\?\.catalog\?\.albumTitle\s*\|\|\s*""\)/, "dreamweaver source link must hydrate album metadata from catalog fallbacks");
assert.match(dreamweaver, /dataset\.haloPlayerGenre\s*=\s*Array\.isArray\(state\.release\?\.genres\)\s*&&\s*state\.release\.genres\.length[\s\S]*state\.release\?\.catalog\?\.genre/, "dreamweaver source link must hydrate genre metadata from catalog fallbacks");
assert.match(dreamweaver, /dataset\.haloPlayerArtwork\s*=\s*releaseArtwork\(state\.release\)\.src/, "dreamweaver source link must hydrate artwork metadata from the shared artwork resolver");
assert.match(summary, /averageListenSeconds/, "admin reporting must expose listening duration");
assert.match(summary, /listeningVariants/, "admin reporting must compare preview variants");
assert.match(summary, /commercialIntent/, "preview reporting must connect listening with commercial intent");
assert.match(statsLib, /export async function getStatsDatabase\(\)/, "stats database access must stay asynchronous");
assert.match(statsLib, /await import\("@netlify\/database"\)/, "stats database access must use lazy dynamic import");
assert.match(summary, /await getStatsDatabase\(\)/, "stats summary must await database initialization");
assert.match(statsEvent, /await getStatsDatabase\(\)/, "stats event ingestion must await database initialization");

const section = (source, start, end) => {
  assert.ok(source.includes(start) && source.includes(end), `missing test section ${start}`);
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
};
const statusContext = vm.createContext({ URL });
vm.runInContext(section(releaseCatalogApi, "function cleanPublicUrl(", "function serializeRelease("), statusContext);
for (const [row, expected] of [
  [{ publication_release_status: "error" }, "STANDBY"],
  [{ publication_release_status: "published", purchase_url: "https://shop.example/release" }, "STANDBY"],
  [{ stream_url: "/assets/test.wav", publication_release_status: "error" }, "READY"],
  [{ stream_url: "/api/mixes/audio?id=test" }, "READY"],
  [{ stream_url: "https://cdn.example/test.mp3", catalog_metadata_status: "processing" }, "PENDING"],
  [{ stream_url: "javascript:alert(1)" }, "STANDBY"],
  [{ stream_url: "https://user@cdn.example/test.mp3" }, "STANDBY"],
  [{ stream_url: "//cdn.example/test.mp3" }, "STANDBY"],
  [{ stream_url: "/\\cdn.example/test.mp3" }, "STANDBY"]
]) {
  assert.equal(statusContext.storefrontStateFor(row).statusLabel, expected);
}

function control() {
  return {
    handlers: {}, disabled: true, clicks: 0,
    addEventListener(name, callback) { this.handlers[name] = callback; },
    click() { this.clicks++; }
  };
}
const audio = {
  ...control(), src: "", paused: true, readyState: 0, loads: 0,
  getAttribute(name) { return name === "src" ? this.src : null; },
  removeAttribute() { this.src = ""; },
  load() { this.loads++; },
  async play() { this.paused = false; },
  pause() { this.paused = true; }
};
const input = control(), playButton = control(), uploadLabel = control();
const track = { id: "test", title: "Test", previewUrl: "https://cdn.example/test.mp3", statusLabel: "READY" };
const nodes = { "#musicWorldAudio": audio, "#mixFileInput": input, "#playButton": playButton, ".upload-label": uploadLabel };
let timeoutCallback, timeoutDelay;
const revoked = [];
class MediaURL extends URL {
  static createObjectURL() { return "blob:https://halo.test/local"; }
  static revokeObjectURL(value) { revoked.push(value); }
}
const playerContext = vm.createContext({
  $: selector => nodes[selector], catalog: [track], playerTrack: track, audioSourceMode: "empty",
  remoteAudioWatchdog: 0, REMOTE_AUDIO_WATCHDOG_MS: 5000, playerControlsBound: false,
  localAudioUrl: "", localAudioName: "", playing: false, URL: MediaURL,
  location: { origin: "https://halo.test", href: "https://halo.test/music-world.html" },
  HTMLMediaElement: { HAVE_CURRENT_DATA: 2 }, toast() {}, setDeck() {}, updateCardStatuses() {},
  setTimeout(callback, delay) { timeoutCallback = callback; timeoutDelay = delay; return 1; },
  clearTimeout() { timeoutCallback = null; }
});
vm.runInContext(section(musicWorld, "function playerAudio()", "if(document.readyState==="), playerContext);
playerContext.bindPlayerControls();
playerContext.bindPlayerControls();
assert.equal(input.disabled, false);
assert.equal(playButton.disabled, false);
await playerContext.togglePlayback();
assert.equal(timeoutDelay, 5000);
timeoutCallback();
assert.equal(playerContext.audioSourceMode, "unavailable", "remote audio without current data must fall back");
await playerContext.togglePlayback();
assert.equal(input.clicks, 1, "standby play must synchronously open the picker");
uploadLabel.handlers.keydown({ key: "Enter", preventDefault() {} });
assert.equal(input.clicks, 2, "upload label must support the keyboard");
await playerContext.activateLocalMixFile({ name: "mix.wav", type: "audio/wav" });
assert.equal(audio.src, "blob:https://halo.test/local");
assert.equal(audio.loads, 2, "both remote and local sources must be loaded");
assert.equal(playerContext.audioSourceMode, "local");
assert.equal(audio.paused, false);
playerContext.handleStreamUnavailable();
assert.equal(playerContext.audioSourceMode, "local", "late remote failures must not replace a local upload");
await playerContext.activateLocalMixFile({ name: "mix.mp3", type: "" });
assert.equal(revoked.length, 1, "replaced local blob URLs must be revoked");
audio.handlers.error();
assert.equal(playerContext.audioSourceMode, "unavailable", "bad local audio must permit another upload");
playerContext.audioSourceMode = "remote";
audio.src = track.previewUrl;
audio.handlers.error();
assert.equal(playerContext.audioSourceMode, "unavailable", "media errors must expose fallback controls");
playerContext.audioSourceMode = "remote";
audio.readyState = 2;
playerContext.armRemoteAudioWatchdog();
timeoutCallback();
assert.equal(playerContext.audioSourceMode, "remote", "ready audio must not trigger fallback");

assert.doesNotMatch(musicWorld, /<input id="mixFileInput"[^>]*\bhidden\b/);
const dreamweaverPage = await readFile(resolve(root, "dreamweaver/index.html"), "utf8");
assert.doesNotMatch(dreamweaverPage, /<input id="mixFileInput"[^>]*\bhidden\b/);
assert.match(dreamweaverPage, /for="mixFileInput" tabindex="0" role="button"/);
assert.doesNotMatch(dreamweaver, /setTimeout\(\(\) => openMixFilePicker/);
assert.match(dreamweaver, /addEventListener\("playing", \(\) => \{\s*clearRemoteAudioWatchdog/);
assert.doesNotMatch(dreamweaver, /addEventListener\("play", \(\) => \{\s*clearRemoteAudioWatchdog/);
assert.match(dreamweaver, /addEventListener\("waiting", armRemoteAudioWatchdog\)/);
assert.ok(dreamweaver.indexOf('document.addEventListener("DOMContentLoaded", bindPlayerControls') < dreamweaver.indexOf("if (resumeUploadVerification()) return"));
vm.runInContext(section(musicWorld, "const sanitizeStatusLabel=", "const sanitizeRadioStatus="), playerContext);
vm.runInContext(section(musicWorld, "const cardStatus=", "const resolveTrackArtwork="), playerContext);
track.streamUnavailable = false;
assert.equal(vm.runInContext("cardStatus(playerTrack)", playerContext), "READY");
playerContext.audioSourceMode = "local";
assert.equal(vm.runInContext("cardStatus(playerTrack)", playerContext), "LOCAL ACTIVE");
playerContext.audioSourceMode = "unavailable";
track.streamUnavailable = true;
assert.equal(vm.runInContext("cardStatus(playerTrack)", playerContext), "STANDBY");
assert.equal(vm.runInContext("storefrontStatus('ERROR')", playerContext), "STANDBY");

const dreamState = { audioSourceMode: "remote", mix: {}, remoteAudioWatchdog: 0, playerControlsBound: false };
const dreamInput = control(), dreamPlay = control(), dreamUpload = control();
const dreamAudio = { ...audio, handlers: {}, readyState: 0, src: track.previewUrl, currentSrc: "", paused: true };
const dreamContext = vm.createContext({
  state: dreamState,
  elements: { audio: dreamAudio, playButton: dreamPlay, songLobbyHeroPlayButton: control(), mixFileInput: dreamInput, uploadLabel: dreamUpload },
  window: { setTimeout: playerContext.setTimeout, clearTimeout: playerContext.clearTimeout },
  URL: MediaURL, location: playerContext.location, HTMLMediaElement: playerContext.HTMLMediaElement,
  REMOTE_AUDIO_WATCHDOG_MS: 5000, cleanText: value => String(value || "").trim(),
  showToast() {}, setReleasePlaybackState() {}
});
vm.runInContext(
  section(dreamweaver, "function clearRemoteAudioWatchdog()", "function publicReleaseStatus(")
  + section(dreamweaver, "function shouldPromptLocalUpload()", "async function awaitPrimaryPlaybackReadiness()")
  + section(dreamweaver, "async function togglePlayback()", "function updateHeroPlayButton("),
  dreamContext
);
dreamContext.bindPlayerControls();
await dreamContext.togglePlayback();
assert.equal(dreamInput.clicks, 0, "an assigned remote source must be tried even before currentSrc is populated");
assert.equal(timeoutDelay, 5000);
timeoutCallback();
assert.equal(dreamState.audioSourceMode, "error", "Dreamweaver must retain its watchdog until current data is available");
assert.equal(dreamAudio.paused, true);
await dreamContext.togglePlayback();
assert.equal(dreamInput.clicks, 1);
dreamUpload.handlers.keydown({ key: " ", preventDefault() {} });
assert.equal(dreamInput.clicks, 2);
await dreamContext.activateLocalMixFile({ name: "local.wav", type: "audio/wav" });
assert.equal(dreamState.audioSourceMode, "local");
assert.equal(dreamContext.shouldPromptLocalUpload(), false, "local source must stay usable before currentSrc is populated");
dreamContext.handleRemoteAudioUnavailable();
assert.equal(dreamState.audioSourceMode, "local");
dreamState.audioSourceMode = "remote";
dreamAudio.pause();
dreamAudio.play = async () => { throw { name: "NotAllowedError" }; };
await dreamContext.togglePlayback();
assert.equal(dreamState.audioSourceMode, "remote", "autoplay policy rejection must not discard a valid remote stream");

for (const [file, handler] of [
  ["netlify/functions/mix-audio.mjs", "mixAudioHandler"],
  ["netlify/functions/stem-vault-audio.mjs", "stemVaultAudioHandler"]
]) {
  const source = await readFile(resolve(root, file), "utf8");
  const bytes = new Uint8Array([10, 20, 30, 40, 50]);
  const context = vm.createContext({
    URL, Response, ReadableStream, console,
    getStore: () => ({ get: async () => bytes.buffer }),
    getDatabase: () => ({ sql: async () => [{ blob_key: "test", chunk_count: 1, byte_size: 5, content_type: "audio/wav", visibility: "room", original_filename: "mix.wav" }] }),
    getUser: async () => ({ id: "test" }), isOwner: () => false,
    ensureMembership: async () => ({ member_id: "test" }), cleanText: value => String(value || "")
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, "").replace(/export default /g, "").replace(/export const /g, "const "), context);
  const endpoint = "https://halo.test/api/audio?id=test&pack=test&stem=full";
  const preflight = await context[handler](new Request(endpoint, { method: "OPTIONS" }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  for (const method of ["GET", "HEAD"]) {
    const response = await context[handler](new Request(endpoint, { method, headers: { Range: "bytes=1-3" } }));
    assert.equal(response.status, 206, `${handler} ${method} must honor byte ranges`);
    assert.equal(response.headers.get("Content-Range"), "bytes 1-3/5");
    assert.equal(response.headers.get("Content-Length"), "3");
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], method === "GET" ? [20, 30, 40] : []);
  }
  const invalidRange = await context[handler](new Request(endpoint, { headers: { Range: "bytes=10-" } }));
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get("Access-Control-Allow-Origin"), "*");
  if (handler === "stemVaultAudioHandler") {
    context.getUser = async () => null;
    const unauthorized = await context[handler](new Request(endpoint));
    assert.equal(unauthorized.status, 401, "CORS must not weaken private stem authorization");
    assert.equal(unauthorized.headers.get("Access-Control-Allow-Origin"), "*");
  }
}

console.log("Music player contracts passed.");
