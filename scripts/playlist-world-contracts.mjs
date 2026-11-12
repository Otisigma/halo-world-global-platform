import assert from "node:assert/strict";
import { test } from "node:test";
import { playlistWorld, buildPlaylistJourney, contentAllowed, playlistCover, playlistExport } from "../lib/playlist-world.js";
import { createPlaylistMixer, tempoRate, equalPowerCurve, reductionGain } from "../music/playlist-mixer.js";
import { createPlaylistClient } from "../music/playlist-cloud.js";

const releases = [
  { id: "warm", status: "published", title: "Warm", artist: "A", genres: ["deep house", "warm"], bpm: 120, contentRating: "clean" },
  { id: "lift", status: "published", title: "Lift", artist: "B", genres: ["house", "euphoric"], bpm: 122, contentRating: "explicit" },
  { id: "unknown", status: "published", title: "Unknown", artist: "C", genres: [] },
  { id: "private", status: "published", isLiveVisible: false, title: "Hidden", genres: ["deep house"] }
];

test("journey proposals are explainable, deterministic and respect explicit-content choices", () => {
  const preferences = playlistWorld({ preferences: { content: "clean-only", discovery: 0 } }).preferences;
  const result = buildPlaylistJourney({ releases, preferences, prompt: "warm opening, deep house build", seed: "test" });
  assert.deepEqual(result.tracks.map(item => item.release.id), ["warm"]);
  assert.match(result.tracks[0].explanation, /Catalog tags match/);
  assert.match(result.notes.join(" "), /not audio analysis/);
  assert.deepEqual(buildPlaylistJourney({ releases, preferences, prompt: "warm opening, deep house build", seed: "test" }), result);
  assert.equal(contentAllowed(releases[2], "clean-only"), false);
  assert.equal(contentAllowed(releases[2], "exclude-explicit"), true, "unknown ratings are disclosed, not falsely called clean");
  assert.equal(contentAllowed(releases[1], "exclude-explicit"), false);
  const unsupported = buildPlaylistJourney({ releases, prompt: "copy a famous artist with a saxophone solo", seed: "test" });
  assert.ok(unsupported.notes.some(note => /ignored|understood/.test(note)));
  assert.throws(() => playlistWorld({ preferences: { fadeSeconds: 100 } }));
  assert.throws(() => playlistWorld({ preferences: [] }));
  assert.throws(() => playlistWorld({ version: 2 }));
});

test("visual worlds and listening exports escape text and never include recording URLs", () => {
  const playlist = { name: "<script>alert(1)</script>", releaseIds: ["warm"],
    world: { dedication: "<img onerror=alert(1)>", chapters: [{ releaseId: "warm", label: "<Start>", energy: 1 }] } };
  const svg = playlistCover(playlist);
  assert.doesNotMatch(svg, /<script>/i);
  assert.match(svg, /&lt;script&gt;/);
  const html = playlistExport(playlist, [{ ...releases[0], audioUrl: "https://private.test/token.mp3" }], "html", "https://halo.test");
  assert.match(html, /&lt;img/);
  assert.match(html, /song=warm/);
  assert.doesNotMatch(html, /https:\/\/private|<img/);
  const json = JSON.parse(playlistExport(playlist, releases.slice(0, 1), "json", "https://halo.test"));
  assert.deepEqual(Object.keys(json.tracks[0]), ["id", "title", "artist"]);
});

class Parameter {
  constructor() { this.value = 1; this.curves = []; }
  cancelScheduledValues() {}
  setValueCurveAtTime(curve, at, seconds) { this.curves.push({ curve, at, seconds }); }
  setTargetAtTime(value) { this.value = value; }
}
function audioFixture() {
  const audios = [], gains = [], timers = [], contexts = [];
  class Audio {
    constructor() { this.events = {}; this.paused = true; this.duration = 30; this.currentTime = 0; this.playbackRate = 1; audios.push(this); }
    addEventListener(name, fn) { this.events[name] = fn; }
    getAttribute(name) { return this[name]; }
    removeAttribute(name) { this[name] = ""; }
    load() {}
    async play() { this.paused = false; }
    pause() { this.paused = true; }
  }
  class Context {
    constructor() { this.currentTime = 0; contexts.push(this); }
    async resume() { this.resumed = true; }
    async suspend() { this.resumed = false; }
    createMediaElementSource() { return { connect() {} }; }
    createAnalyser() { return { connect() {}, getFloatTimeDomainData(samples) { samples.fill(.5); } }; }
    createGain() { const node = { gain: new Parameter(), connect() {} }; gains.push(node); return node; }
  }
  const events = {};
  const window = {
    Audio, AudioContext: Context, CustomEvent, location: { origin: "https://halo.test" },
    addEventListener(name, fn) { events[name] = fn; }, dispatchEvent(event) { events[event.type]?.(event); },
    setTimeout(fn) { timers.push(fn); }
  };
  let closed = 0;
  const messages = [], selected = [];
  const mixer = createPlaylistMixer({ window, player: { close() { closed++; } },
    report: text => messages.push(text), onTrack: track => selected.push(track.id) });
  return { mixer, window, audios, gains, timers, contexts, messages, selected, get closed() { return closed; } };
}

test("mixer schedules real equal-power fades and bounded pitch-preserving tempo adjustment", async () => {
  const fixture = audioFixture(), { mixer, audios, gains, selected } = fixture;
  assert.equal(audios.length, 0, "Web Audio and extra streams are created only after explicit mixed playback");
  const tracks = releases.slice(0, 2).map(track => ({ ...track, src: `/assets/${track.id}.mp3` }));
  assert.equal(await mixer.start(tracks, { transitions: "tempo", normalize: true, fadeSeconds: 6, repeat: false }), true);
  assert.equal(fixture.closed, 1, "mixed decks take ownership from the original player");
  assert.deepEqual(selected, ["warm"]);
  audios[0].currentTime = 24;
  audios[0].events.timeupdate();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(selected, ["warm", "lift"]);
  assert.equal(audios[1].preservesPitch, true);
  assert.equal(audios[1].playbackRate, 120 / 122);
  assert.equal(gains[2].gain.curves[0].seconds, 6);
  assert.equal(gains[4].gain.curves[0].seconds, 6);
  assert.ok(Math.abs(gains[2].gain.curves[0].curve[32] ** 2 + gains[4].gain.curves[0].curve[32] ** 2 - 1) < .001);
  assert.ok(gains[1].gain.value < 1, "live loudness matching reduces gain rather than amplifying");
  mixer.setVolume(.6, true);
  assert.equal(gains[0].gain.value, 0, "user muting is honored by both decks");
  await mixer.toggle();
  assert.equal(audios.every(audio => audio.paused), true);
  fixture.timers.shift()();
  assert.equal(fixture.timers.length, 1, "a paused fade waits for the suspended audio clock");
  await mixer.toggle();
  assert.equal(audios.every(audio => !audio.paused), true, "both overlapping decks resume");
  mixer.setVolume(.6, false);
  assert.equal(gains[0].gain.value, .6);
  fixture.contexts[0].currentTime = 7;
  fixture.timers.shift()();
  assert.equal(audios[0].paused, true);
  assert.equal(audios[1].paused, false, "fade completion retires only the outgoing deck");
  await mixer.skip(-1);
  assert.equal(selected.at(-1), "warm", "manual previous restarts the chosen queue position");
  mixer.stopContinuation();
  audios[0].events.ended();
  assert.equal(mixer.running, false, "stop continuation lets the current track finish without starting another");
  mixer.stop();
  assert.equal(audios.every(audio => audio.paused && !audio.src), true);
  assert.equal(mixer.running, false);
  assert.equal(tempoRate({ bpm: 120 }, { bpm: 90 }), 1, "large tempo mismatches are not falsely matched");
  assert.equal(tempoRate({}, { bpm: 120 }), 1);
  assert.equal(reductionGain(Float32Array.from([0, 0])), 1, "silence is never amplified");
  assert.equal(equalPowerCurve(true)[0], 0);
});

test("a failed mixed resume silences both decks instead of leaving partial playback", async () => {
  const { mixer, audios } = audioFixture();
  await mixer.start([{ id: "warm", src: "/assets/warm.mp3" }], { transitions: "smooth", fadeSeconds: 6 });
  await mixer.toggle();
  audios[0].play = async () => { throw new DOMException("Playback needs a new gesture", "NotAllowedError"); };
  await assert.rejects(mixer.toggle(), { name: "NotAllowedError" });
  assert.equal(mixer.running, false);
  assert.ok(audios.every(audio => audio.paused && !audio.src));
});

test("external audio and unsupported devices get an explicit original-mode fallback without Web Audio fetches", async () => {
  const fixture = audioFixture();
  const result = await fixture.mixer.start([{ id: "external", src: "https://cdn.test/song.mp3" }], { transitions: "smooth" });
  assert.equal(result, false);
  assert.equal(fixture.mixer.fallbackAllowed, true);
  assert.equal(fixture.audios.length, 0);
  assert.equal(fixture.closed, 0);
  assert.match(fixture.messages[0], /external audio is not fetched/);
});

test("account changes invalidate in-flight responses, including interrupted committed writes", async () => {
  let resolve;
  const client = createPlaylistClient(() => new Promise(done => { resolve = done; }));
  const pending = client.request("", { action: "delete", id: "id" });
  client.reset();
  resolve(Response.json({ result: "deleted" }));
  await assert.rejects(pending, /Account changed.*may have completed/);
});
