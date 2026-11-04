import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalogVersionPlaybackSource, initializeCatalogPlayback } from "../song-catalog/catalog-playback.js";

const versionId = "11111111-1111-4111-8111-111111111111";
const audioUrl = `/api/song-catalog/audio?versionId=${versionId}`;
const song = { id: "song-1", title: "Catalog song", artistName: "Catalog artist" };
const master = { id: versionId, label: "Sale Master", isCanonicalMaster: true, playableAudio: true, persistedAudio: false, playbackUrl: audioUrl };

assert.equal(catalogVersionPlaybackSource(master), audioUrl, "verified stored catalog audio uses its owner-authorized canonical route");
for (const invalid of [
  { ...master, playableAudio: false },
  { ...master, playbackUrl: "" },
  { ...master, playbackUrl: "https://drive.google.com/uc?id=raw-master" },
  { ...master, playbackUrl: "https://attacker.example/audio.mp3" },
  { ...master, playbackUrl: `/api/song-catalog/audio?versionId=${"22222222-2222-4222-8222-222222222222"}` },
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

const nextMaster = { ...master, id: "22222222-2222-4222-8222-222222222222", playbackUrl: "/api/song-catalog/audio?versionId=22222222-2222-4222-8222-222222222222" };
audio.rejectPlay = true;
await player.select({ ...song, title: "Next song" }, nextMaster);
assert.equal(audio.src, nextMaster.playbackUrl, "each catalog selection replaces the active media source");
assert.equal(audio.loads, 2);
assert.equal(status.dataset.state, "blocked");
assert.equal(win.HALO_STREAM_READY, false);
await player.select(song, { ...master, playableAudio: false });
assert.equal(audio.src, "");
assert.equal(audio.paused, true);
assert.equal(status.dataset.state, "unavailable");
assert.equal(win.HALO_STREAM_READY, false, "a song without verified stored audio never leaves stale playback ready");
player.dispose();

function recoveryFixture({ resolveLocalAudio, eligible = true, playError = "NotSupportedError" } = {}) {
  const media = new FakeAudio();
  const indicator = { dataset: {}, textContent: "" };
  const timers = new Map(), revoked = [];
  let nextTimer = 0, calls = 0;
  const file = new File(["saved wave"], "saved.wav", { type: "audio/wav" });
  const version = { ...master, audioFilename: file.name, audioByteSize: file.size };
  const record = { ...song, id: versionId, sourceUploadSurface: eligible ? "dreamweaver_lab" : "song_catalog" };
  media.play = () => {
    media.plays++;
    if (media.src.startsWith("/api/")) return Promise.reject(Object.assign(new Error("Stream failed"), { name: playError }));
    media.paused = false;
    return Promise.resolve();
  };
  const controller = initializeCatalogPlayback({
    audio: media, status: indicator, title: {}, artist: {}, window: {},
    resolveLocalAudio: async id => { calls++; assert.equal(id, versionId); return resolveLocalAudio ? resolveLocalAudio(id) : file; },
    urlApi: { createObjectURL: () => "blob:matching-project", revokeObjectURL: url => revoked.push(url) },
    setTimer: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimer: id => timers.delete(id),
  });
  return { media, indicator, timers, revoked, controller, record, version, get calls() { return calls; } };
}
{
  const test = recoveryFixture();
  await test.controller.select(test.record, test.version);
  assert.equal(test.calls, 1);
  assert.equal(test.media.src, "blob:matching-project");
  assert.notEqual(test.indicator.dataset.state, "playing", "a resolved play promise never fabricates playing state");
  test.media.readyState = 3;
  test.media.dispatchEvent(new Event("playing"));
  assert.equal(test.indicator.dataset.state, "playing");
  assert.match(test.indicator.textContent, /LOCAL PREVIEW/);
  assert.match(test.indicator.textContent, /catalog master unchanged/);
  test.media.dispatchEvent(new Event("error"));
  assert.equal(test.calls, 1, "local recovery cannot loop after another media failure");
  test.controller.dispose();
  assert.deepEqual(test.revoked, ["blob:matching-project"]);
  assert.equal(test.timers.size, 0);
}
for (const options of [{ eligible: false }, { playError: "NotAllowedError" }, { playError: "AbortError" }]) {
  const test = recoveryFixture(options);
  await test.controller.select(test.record, test.version);
  assert.equal(test.calls, 0, "unrelated uploads, browser restrictions and interrupted selections cannot trigger local substitution");
  test.controller.dispose();
}
for (const resolveLocalAudio of [
  async () => { throw new Error("Sign in to restore audio"); },
  async () => new File(["different bytes"], "wrong.wav", { type: "audio/wav" }),
]) {
  const test = recoveryFixture({ resolveLocalAudio });
  await test.controller.select(test.record, test.version);
  assert.equal(test.indicator.dataset.state, "fault");
  assert.match(test.indicator.textContent, /Local recovery failed/);
  assert.equal(test.media.src, audioUrl, "failed recovery never binds another song");
  test.controller.dispose();
}
{
  let resolve;
  const test = recoveryFixture({ resolveLocalAudio: () => new Promise(done => { resolve = done; }) });
  const pending = test.controller.select(test.record, test.version);
  await new Promise(done => setImmediate(done));
  await test.controller.select(song, { ...master, playableAudio: false });
  resolve(new File(["saved wave"], "saved.wav", { type: "audio/wav" }));
  await pending;
  assert.equal(test.media.src, "", "late local recovery cannot replace a newer selection");
  test.controller.dispose();
}
{
  const test = recoveryFixture();
  test.media.play = () => Promise.resolve();
  await test.controller.select(test.record, test.version);
  test.media.readyState = 3;
  test.media.dispatchEvent(new Event("canplay"));
  assert.equal(test.calls, 0, "healthy remote playback never reads private local audio");
  assert.equal(test.timers.size, 0, "observed readiness cancels the fallback deadline");
  test.controller.dispose();
}
{
  const test = recoveryFixture();
  test.media.play = () => new Promise(() => {});
  void test.controller.select(test.record, test.version);
  assert.equal(test.calls, 0, "normal loading first attempts the authenticated catalog route");
  const timeout = [...test.timers.values()][0];
  timeout();
  await new Promise(done => setImmediate(done));
  assert.equal(test.calls, 1, "an unresponsive remote play attempt gets one bounded local recovery");
  assert.equal(test.media.src, "blob:matching-project");
  test.controller.dispose();
}

const source = await readFile(new URL("../song-catalog/song-catalog.js", import.meta.url), "utf8");
const html = await readFile(new URL("../song-catalog/index.html", import.meta.url), "utf8");
const dreamweaver = await readFile(new URL("../dreamweaver/dreamweaver.js", import.meta.url), "utf8");
const playerSource = await readFile(new URL("../song-catalog/catalog-playback.js", import.meta.url), "utf8");
assert.match(html, /<audio id="showAudio" controls preload="none"/, "main catalog exposes the shared active Dreamweaver player surface");
assert.match(source, /data-play-version-id/, "each stored version offers direct playback in the catalog player");
assert.match(source, /isCanonicalMaster&&version\.playableAudio===true/, "song selection loads an owned stored master independently of publication readiness");
assert.match(playerSource, /playableAudio === true/, "owner playback is gated on verified stored bytes, not publication approval");
assert.doesNotMatch(playerSource, /persistedAudio/, "radio/publication readiness does not block the player");
assert.doesNotMatch(source, /HALO_STREAM_READY\s*=\s*true/, "catalog source selection never spoofs readiness");
assert.match(dreamweaver, /loadTrackIntoDreamweaver\(track/, "curator setlist selections continue through the direct shared Dreamweaver binder");

console.log("Song Catalog playback contracts passed: direct verified sources, owner-route enforcement, immediate load/play, media-driven readiness, errors and curator parity.");
