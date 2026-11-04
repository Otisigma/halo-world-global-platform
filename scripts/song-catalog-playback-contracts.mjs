import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalogVersionPlaybackSource, initializeCatalogPlayback } from "../song-catalog/catalog-playback.js";

const versionId = "11111111-1111-4111-8111-111111111111";
const audioUrl = `/api/song-catalog/audio?versionId=${versionId}`;
const song = { id: "song-1", title: "Catalog song", artistName: "Catalog artist" };
const master = { id: versionId, label: "Sale Master", isCanonicalMaster: true, persistedAudio: true, audioUrl };

assert.equal(catalogVersionPlaybackSource(master), audioUrl, "verified stored catalog audio uses its owner-authorized canonical route");
for (const invalid of [
  { ...master, persistedAudio: false },
  { ...master, audioUrl: "https://drive.google.com/uc?id=raw-master" },
  { ...master, audioUrl: "https://attacker.example/audio.mp3" },
  { ...master, audioUrl: `/api/song-catalog/audio?versionId=${"22222222-2222-4222-8222-222222222222"}` },
  { ...master, id: "not-an-id" },
]) assert.equal(catalogVersionPlaybackSource(invalid), "", "unverified, external, mismatched and malformed media routes are rejected");

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.attributes = new Map();
    this.src = "";
    this.currentSrc = "";
    this.readyState = 0;
    this.paused = true;
    this.preload = "none";
    this.error = null;
    this.loads = 0;
    this.plays = 0;
    this.rejectPlay = false;
  }
  getAttribute(name) { return name === "src" ? this.attributes.get(name) || null : null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); this.src = ""; this.currentSrc = ""; }
  pause() { this.paused = true; }
  load() {
    this.loads += 1;
    this.readyState = 0;
    this.error = null;
    queueMicrotask(() => this.dispatchEvent(new Event("loadstart")));
  }
  set src(value) {
    this._src = value;
    this.setAttribute("src", value);
    this.currentSrc = new URL(value, "https://halo.test").href;
  }
  get src() { return this._src || ""; }
  play() {
    this.plays += 1;
    if (this.rejectPlay) return Promise.reject(Object.assign(new Error("Blocked"), { name: "NotAllowedError" }));
    this.paused = false;
    return Promise.resolve();
  }
}

const audio = new FakeAudio();
const status = { dataset: {}, textContent: "" };
const title = { textContent: "" }, artist = { textContent: "" };
const win = {};
const player = initializeCatalogPlayback({ audio, status, title, artist, window: win });
assert.equal(win.HALO_STREAM_READY, false, "standby is never reported ready");
const selection = player.select(song, master);
assert.equal(audio.src, audioUrl);
assert.equal(audio.loads, 1, "selection immediately loads the canonical URL");
assert.equal(audio.plays, 1, "the selection gesture starts playback without an extra upload or navigation");
assert.equal(title.textContent, "Sale Master");
assert.equal(artist.textContent, "Catalog song · Catalog artist");
assert.equal(win.HALO_STREAM_READY, false, "a URL and resolved play promise are not media readiness");
await selection;
await new Promise(resolve => setImmediate(resolve));
assert.equal(status.dataset.state, "loading", "loadstart is tied to the selected source");
audio.readyState = 3;
audio.dispatchEvent(new Event("canplay"));
assert.equal(status.dataset.state, "ready");
assert.equal(win.HALO_STREAM_READY, true, "canplay with HAVE_FUTURE_DATA is observed before readiness");
assert.equal(win.HaloDreamweaverReadiness.versionId, versionId);
audio.dispatchEvent(new Event("waiting"));
assert.equal(win.HALO_STREAM_READY, false, "buffering withdraws readiness");
audio.error = { code: 2 };
audio.dispatchEvent(new Event("error"));
assert.equal(status.dataset.state, "fault");
assert.equal(win.HALO_STREAM_READY, false);

const nextMaster = { ...master, id: "22222222-2222-4222-8222-222222222222", audioUrl: "/api/song-catalog/audio?versionId=22222222-2222-4222-8222-222222222222" };
audio.rejectPlay = true;
await player.select({ ...song, title: "Next song" }, nextMaster);
assert.equal(audio.src, nextMaster.audioUrl, "each catalog selection replaces the active media source");
assert.equal(audio.loads, 2);
assert.equal(status.dataset.state, "blocked");
assert.equal(win.HALO_STREAM_READY, false);
await player.select(song, { ...master, persistedAudio: false });
assert.equal(audio.src, "");
assert.equal(audio.paused, true);
assert.equal(status.dataset.state, "unavailable");
assert.equal(win.HALO_STREAM_READY, false, "a song without verified stored audio never leaves stale playback ready");
player.dispose();

const source = await readFile(new URL("../song-catalog/song-catalog.js", import.meta.url), "utf8");
const html = await readFile(new URL("../song-catalog/index.html", import.meta.url), "utf8");
const dreamweaver = await readFile(new URL("../dreamweaver/dreamweaver.js", import.meta.url), "utf8");
assert.match(html, /<audio id="showAudio" controls preload="none"/, "main catalog exposes the shared active Dreamweaver player surface");
assert.match(source, /isCanonicalMaster&&version\.persistedAudio===true/, "selecting a catalog song loads only its verified Sale master");
assert.match(source, /data-play-version-id/, "each stored version offers direct playback in the catalog player");
assert.doesNotMatch(source, /HALO_STREAM_READY\s*=\s*true/, "catalog source selection never spoofs readiness");
assert.match(dreamweaver, /loadTrackIntoDreamweaver\(track/, "curator setlist selections continue through the direct shared Dreamweaver binder");

console.log("Song Catalog playback contracts passed: direct verified sources, owner-route enforcement, immediate load/play, media-driven readiness, errors and curator parity.");
