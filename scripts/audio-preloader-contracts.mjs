import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [preloader, dreamweaver, page, player] = await Promise.all([
  read("audio-preloader.js"), read("dreamweaver/dreamweaver.js"),
  read("dreamweaver/index.html"), read("music-player.js")
]);

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.src = "";
    this.readyState = 0;
    this.preload = "none";
    this.loads = 0;
    this.plays = 0;
    this.paused = true;
    this.error = null;
  }
  getAttribute() { return this.src || null; }
  removeAttribute() { this.src = ""; }
  load() { this.loads++; }
  pause() { this.paused = true; }
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
}

function fixture({ connection, readyState = "complete", brokenAudio = false } = {}) {
  const audios = [];
  const timers = new Map();
  let nextTimer = 0;
  const window = new EventTarget();
  window.location = { origin: "https://halo.test" };
  window.navigator = { connection };
  window.setTimeout = (callback, delay) => {
    timers.set(++nextTimer, { callback, delay });
    return nextTimer;
  };
  window.clearTimeout = timer => timers.delete(timer);
  const document = { readyState };
  class Audio extends FakeAudio {
    constructor() {
      super();
      if (brokenAudio) throw new Error("Audio unavailable");
      audios.push(this);
    }
  }
  vm.runInNewContext(preloader, { window, document, Audio, URL });
  return {
    cache: window.HaloAudioPreloader, window, document, audios, timers,
    run(delay) {
      const timer = [...timers].find(([, value]) => value.delay === delay);
      assert.ok(timer, `expected ${delay}ms timer`);
      timers.delete(timer[0]);
      timer[1].callback();
    }
  };
}

const urls = Array.from({ length: 12 }, (_, index) => `https://halo.test/track-${index}.mp3`);
{
  const f = fixture({ readyState: "interactive" });
  const primary = new FakeAudio();
  f.cache.warmPlaylist(urls, { primaryAudio: primary });
  assert.equal(primary.preload, "auto");
  assert.equal(primary.src, urls[0]);
  assert.equal(primary.loads, 1, "primary must load immediately without constructing a second player");
  assert.equal(f.audios.length, 0);
  primary.dispatchEvent(new Event("canplay"));
  assert.equal(f.timers.size, 0, "background must wait for page load");
  f.document.readyState = "complete";
  f.window.dispatchEvent(new Event("load"));
  f.run(250);
  assert.equal(f.audios.length, 1);
  assert.equal(f.audios[0].preload, "metadata", "secondary files must never all get auto buffering");
  assert.equal(f.audios[0].src, urls[1]);
  assert.equal([...f.timers.values()].some(timer => timer.delay === 250), false, "only one metadata load may be in flight");
  for (let index = 0; index < 5; index++) {
    f.audios[index].dispatchEvent(new Event("loadedmetadata"));
    if (index < 4) f.run(250);
  }
  assert.equal(f.audios.length, 5, "cache must bound playlist memory/data to five nearby tracks plus primary");
  assert.equal(f.timers.size, 0);
  const cached = f.cache.take(urls[1]);
  assert.equal(cached, f.audios[0], "playback must receive the actual warmed element");
  cached.play();
  f.cache.clear();
  assert.equal(cached.paused, false, "cleanup must not interrupt a transferred player");
  assert.equal(primary.src, urls[0], "cleanup must not unload Dreamweaver's borrowed element");
  assert.equal(f.audios[1].src, "");
}
{
  const f = fixture();
  f.cache.warmPlaylist(urls);
  assert.equal(f.audios[0].preload, "auto");
  assert.equal(f.timers.size, 0, "background must not compete with a stalled or browser-blocked primary");
  f.audios[0].dispatchEvent(new Event("error"));
  f.run(250);
  f.audios[1].error = { code: 2 };
  f.audios[1].dispatchEvent(new Event("error"));
  assert.equal(f.cache.take(urls[1]), null, "failed preload must fall back to standard playback");
  assert.equal(f.audios[1].src, "");
  f.run(250);
  f.run(5000);
  assert.equal(f.audios[2].src, "", "hung metadata requests must abort before advancing");
  f.run(250);
  const inFlight = f.cache.take(urls[3]);
  assert.equal(inFlight, f.audios[3], "user playback must not wait for metadata completion");
  f.run(250);
  f.window.dispatchEvent(new Event("pagehide"));
  assert.equal(f.timers.size, 0);
  assert.equal(f.audios[4].src, "");
  assert.equal(inFlight.src, urls[3]);
}
for (const connection of [{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "3g" }]) {
  const f = fixture({ connection });
  f.cache.warmPlaylist(urls);
  f.audios[0].dispatchEvent(new Event("canplay"));
  assert.equal(f.audios.length, 1, "data saver/slow connections must only load the selected track");
  assert.equal(f.timers.size, 0);
}
{
  const f = fixture();
  const audio = new FakeAudio();
  audio.src = urls[0];
  assert.equal(f.cache.prepare(audio, "/track-0.mp3"), true);
  assert.equal(audio.loads, 0, "healthy same-source playback must preserve its existing buffer");
  audio.error = { code: 2 };
  assert.equal(f.cache.prepare(audio, urls[0]), true);
  assert.equal(audio.loads, 1, "failed cached sources must support a normal retry");
  for (const unsafe of ["javascript:alert(1)", "data:audio/mp3;base64,AA", "https://user@cdn.test/song.mp3"]) {
    assert.equal(f.cache.prepare(audio, unsafe), false);
  }
  f.cache.warmPlaylist([urls[0], urls[0], urls[1]]);
  f.audios[0].dispatchEvent(new Event("canplay"));
  f.run(250);
  f.audios[1].dispatchEvent(new Event("loadedmetadata"));
  assert.equal(f.timers.size, 0, "duplicate sources must not cause duplicate requests");
  f.cache.warmPlaylist([urls[2]]);
  assert.equal(f.audios[0].src, "", "playlist replacement must release old cache objects");
  f.cache.dispose();
  f.cache.warmPlaylist(urls);
  assert.equal(f.timers.size, 0, "disposed caches must not restart");
}
{
  const f = fixture({ brokenAudio: true });
  assert.doesNotThrow(() => f.cache.warmPlaylist(urls));
  assert.equal(f.cache.take(urls[0]), null);
}

// Exercise the existing listening-room helper both with and without a cached object.
const mountAudio = player.slice(player.indexOf("  function mountAudio("), player.indexOf("  function openRoom("));
for (const useCache of [true, false]) {
  const cached = new FakeAudio();
  cached.src = urls[1];
  cached.preload = "metadata";
  cached.loads = 1;
  let created = 0;
  const context = {
    window: { HaloAudioPreloader: useCache ? { take: () => cached } : undefined },
    document: { createElement() { created++; return new FakeAudio(); } },
    stage: { append(audio) { this.audio = audio; } },
    active: {}, source: {}, startedPlayback() {}, completedPlayback() {}, console
  };
  vm.runInNewContext(`${mountAudio}\nmountAudio({ url: ${JSON.stringify(urls[1])} });`, context);
  assert.equal(context.active.audio, context.stage.audio);
  assert.equal(context.active.audio.plays, 1, "cached playback must explicitly play rather than rely on autoplay");
  assert.equal(created, useCache ? 0 : 1);
  if (useCache) assert.equal(context.active.audio, cached);
}
for (const closeBeforeReject of [true, false]) {
  let rejectPlay;
  const audio = new FakeAudio();
  audio.play = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  const context = {
    window: {}, document: { createElement: () => audio },
    stage: { append() {} }, active: {}, source: { textContent: "original" },
    startedPlayback() {}, completedPlayback() {}, console
  };
  vm.runInNewContext(`${mountAudio}\nmountAudio({ url: ${JSON.stringify(urls[0])} });`, context);
  if (closeBeforeReject) context.active = null;
  rejectPlay({ name: "NotAllowedError" });
  await Promise.resolve();
  assert.equal(context.source.textContent, closeBeforeReject ? "original" : "Press play in the audio controls to start listening.");
  assert.equal(audio.controls, true, "blocked playback must retain working native controls");
}

const bootstrap = dreamweaver.slice(dreamweaver.indexOf("  async function bootstrapPrimaryPlayback("), dreamweaver.indexOf("  async function hydrateDreamweaverLoopContent("));
{
  const artwork = dreamweaver.slice(dreamweaver.indexOf("  function releaseArtwork("), dreamweaver.indexOf("  function releaseStateLabel("));
  const context = {
    window: { HaloReleaseArtwork: { resolve: entry => ({ src: entry.artwork || "/fallback.svg" }) } },
    safeMediaUrl: value => value, DREAMWEAVER_RELEASE_FALLBACK_ARTWORK: "/fallback.svg"
  };
  vm.runInNewContext(artwork, context);
  assert.equal(context.releaseArtwork(null).src, "/fallback.svg", "unhydrated artwork must not prevent audio initialization");
}
for (const withCache of [true, false]) {
  const f = fixture();
  const audio = new FakeAudio();
  const state = { audioSourceMode: "empty" };
  const context = {
    window: { HaloAudioPreloader: withCache ? f.cache : undefined },
    elements: { audio }, state, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    resolvePrimaryAudio: () => ({ src: urls[0] }),
    setLoadingProgress() {}, revokeLocalAudioUrl() {}, clearRemoteAudioWatchdog() {},
    setReleasePlaybackState(value) { state.releasePlaybackState = value; },
    showToast() {}, queueAudioFeedbackIncident() {},
    awaitPrimaryPlaybackReadiness: async () => ({ ok: false, state: "timeout" })
  };
  vm.runInNewContext(bootstrap, context);
  await context.bootstrapPrimaryPlayback({ id: "primary" });
  assert.equal(state.audioSourceMode, "remote", "blocked preload must keep manual playback available");
  assert.equal(audio.src, urls[0]);
  assert.equal(audio.preload, "auto", "cache absence must still prioritize current playback");
  assert.equal(state.releasePlaybackState, "loading", "bound audio must refresh the player labels immediately");
  assert.equal(audio.plays, 0, "preloading must not bypass browser playback policy");
}

assert.match(page, /audio-preloader\.js[\s\S]*dreamweaver\/dreamweaver\.js/);
assert.match(page, /<audio id="showAudio" preload="auto">/);
assert.match(dreamweaver, /warmPlaylist\([\s\S]*mixLibrary\.filter\(isPlayablePrimaryMix\)/);
console.log("Audio preloader contracts passed.");
