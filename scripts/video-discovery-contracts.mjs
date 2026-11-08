import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { DISCOVERY_THEMES, publishedDiscoveryReleases, releasesForTheme, nativeDiscoveryVideo,
  discoveryDreamweaverPath, discoveryPlaylistPath } from "../lib/video-discovery.js";
import { allowedEvents, cleanMetadata } from "../netlify/lib/stats.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const release = { id, title: "The signal", artist: "HALO", status: "published", genres: ["Electronic", "Cinematic"],
  audioUrl: "/song.mp3", promoVideoUrl: "https://youtube.com/watch?v=abcdefghijk", videoUrl: "/footage.mp4" };
const releases = [release, { ...release, id: "draft", status: "draft" }, { ...release, id: "hidden", isLiveVisible: false },
  { ...release, id: "soul", genres: ["Soul"] }];
assert.equal(publishedDiscoveryReleases(releases).length, 2);
assert.deepEqual(releasesForTheme(releases, "cinematic").map(item => item.id), [id]);
assert.deepEqual(releasesForTheme(releases, "soul").map(item => item.id), ["soul"]);
assert.equal(releasesForTheme(releases, "uplifting").length, 0);
assert.equal(nativeDiscoveryVideo(release, "https://halo.test"), "https://halo.test/footage.mp4",
  "a watch-page URL cannot displace native footage");
for (const source of ["javascript:alert(1)", "https://user:secret@halo.test/v.mp4", "https://youtube.com/watch?v=abcdefghijk", ""]) {
  assert.equal(nativeDiscoveryVideo({ videoUrl: source }, "https://halo.test"), "");
}
assert.equal(new URL(discoveryDreamweaverPath(release), "https://halo.test").searchParams.get("song"), id);
assert.equal(new URL(discoveryDreamweaverPath({ id: "legacy-song", catalog: { songId: id } }), "https://halo.test").searchParams.get("song"), id);
assert.equal(discoveryDreamweaverPath({ id: "legacy-song" }), "/dreamweaver/?mix=legacy-song");
assert.equal(new URL(discoveryPlaylistPath("cinematic", id), "https://halo.test").searchParams.get("playlist"), "cinematic");
assert.equal(new URL(discoveryPlaylistPath("not-a-theme"), "https://halo.test").searchParams.has("playlist"), false);

const client = await readFile(new URL("../video-discovery.js", import.meta.url), "utf8");
let Widget;
class Element {}
const context = {
  HTMLElement: Element, customElements: { define(_name, value) { Widget = value; } },
  DISCOVERY_THEMES, publishedDiscoveryReleases, releasesForTheme, nativeDiscoveryVideo,
  discoveryDreamweaverPath, discoveryPlaylistPath, DEFAULT_CINEMA_LOOP: { url: "/loop.mp4" },
  URL, URLSearchParams, location: { origin: "https://halo.test" },
  clearTimeout, setTimeout, console,
  navigator: {}, CustomEvent: class { constructor(type) { this.type = type; } },
  window: { dispatchEvent() {}, haloStats: { track() {} } },
};
vm.runInNewContext(client.replace(/^import[\s\S]*?from ".+?";\n/gm, ""), context);
const widget = new Widget();
const callbacks = new Map();
const plays = [];
const status = { textContent: "" };
context.window.HaloPlayer = {
  audio: { addEventListener(type, fn) { callbacks.set(type, fn); } },
  play(track) { this.track = track; plays.push(track.id); },
};
widget.queue = [release, { ...release, id: "second" }];
widget.querySelector = () => status;
widget.stopPreview = () => {};
widget.playTrack(0, false);
assert.equal(plays.length, 1);
callbacks.get("ended")();
assert.equal(plays.join(","), `${id},second`, "one shared player advances the playlist");
callbacks.get("ended")();
assert.equal(widget.queueActive, false, "the queue stops rather than looping forever");
widget.playTrack(0, false);
widget.stopQueue();
callbacks.get("ended")();
assert.equal(plays.length, 3, "stopping continuation prevents the next song");
widget.playTrack(0, false);
context.window.HaloPlayer.track = { id: "outside-track" };
callbacks.get("ended")();
assert.equal(widget.queueActive, false, "a song selected elsewhere cancels the queue");

for (const surface of ["halo.html", "dreamweaver/index.html", "music/index.html"]) {
  const html = await readFile(new URL(`../${surface}`, import.meta.url), "utf8");
  assert.match(html, /halo-video-discovery/);
  assert.match(html, /\/video-discovery\.js/);
  assert.match(html, /\/video-discovery\.css/);
}
const chart = await readFile(new URL("../music/featuredPlayer.js", import.meta.url), "utf8");
const music = await readFile(new URL("../music/music.js", import.meta.url), "utf8");
assert.match(music, /HaloCatalogPlaybackSources = Object\.freeze\(\{ trackStreamUrl \}\)/);
assert.match(client, /HaloCatalogPlaybackSources\?\.trackStreamUrl\(item\)/,
  "public release streamUrl and canonical master sources reuse the actual catalog resolver");
assert.match(chart, /halo:discovery-queue-start/);
assert.match(chart, /halo:chart-queue-start/);
assert.match(client, /preload="none" muted playsinline/);
assert.match(client, /setTimeout\(\(\) => this\.stopPreview\(\), 8000\)/);
assert.match(client, /prefers-reduced-motion/);
assert.match(client, /globalPrivacyControl/);
assert.doesNotMatch(client, /new Audio|createElement\(["']audio/);
for (const event of ["preview", "navigation", "playlist_start", "continuation"]) {
  assert.ok(allowedEvents.has(`video_discovery_${event}`));
}
assert.deepEqual(cleanMetadata({ destination: "dreamweaver", track: id, variant: "cinematic", source_type: "hub", secret: "x" }),
  { destination: "dreamweaver", track: id, variant: "cinematic", source_type: "hub" });
console.log("Video discovery contracts passed: native footage, public gates, routes, themes, shared queue, and telemetry.");
