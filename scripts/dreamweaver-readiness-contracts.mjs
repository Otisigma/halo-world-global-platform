import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bufferedPercent, createReadinessTelemetry } from "../dreamweaver/readiness-telemetry.js";

class Ranges {
  constructor(ranges = []) { this.ranges = ranges; }
  get length() { return this.ranges.length; }
  start(index) { return this.ranges[index][0]; }
  end(index) { return this.ranges[index][1]; }
}
class Media extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { source: "", currentSrc: "", duration: NaN, currentTime: 0, readyState: 0,
      networkState: 0, preload: "auto", paused: true, error: null, buffered: new Ranges(), plays: 0 });
  }
  getAttribute(name) { return name === "src" ? this.source : null; }
  play() { this.plays++; }
}
const node = () => ({ textContent: "", style: {}, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
function fixture(setup = () => {}) {
  const audio = new Media();
  setup(audio);
  const els = { bar: node(), track: node(), status: node(), percent: node(), root: node() };
  const window = {};
  const telemetry = createReadinessTelemetry({ audio, ...els, window });
  const emit = name => audio.dispatchEvent(new Event(name));
  return { audio, ...els, window, telemetry, emit };
}
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

await check("no source is standby and never claims readiness", () => {
  const f = fixture();
  assert.equal(f.root.dataset.state, "standby");
  assert.equal(f.status.textContent, "● AI TELEMETRY: STANDBY");
  assert.equal(f.percent.textContent, "0%");
  assert.equal(f.window.HALO_STREAM_READY, false);
  f.emit("error");
  assert.equal(f.root.dataset.state, "standby", "an empty element error is not a stream fault");
});

await check("deferred preload is honest standby, not a stall", () => {
  const f = fixture(audio => { audio.source = "/api/song-catalog/audio?versionId=v"; audio.preload = "none"; });
  assert.equal(f.root.dataset.state, "deferred");
  assert.match(f.status.textContent, /LOADS ON PLAY/);
  assert.equal(f.window.HALO_STREAM_READY, false);
  f.emit("loadstart");
  f.emit("suspend");
  assert.equal(f.root.dataset.state, "deferred", "a suspended fetch with no data is not perpetual loading");
});

await check("buffer progress drives bar, percent, aria and flag", () => {
  const f = fixture(audio => { audio.source = "/audio/master.wav"; });
  f.emit("loadstart");
  assert.equal(f.root.dataset.state, "loading");
  f.audio.duration = 200;
  f.audio.buffered = new Ranges([[0, 50]]);
  f.emit("progress");
  assert.equal(f.root.dataset.state, "buffering");
  assert.equal(f.bar.style.width, "25%");
  assert.equal(f.percent.textContent, "25%");
  assert.equal(f.status.textContent, "● AI TELEMETRY: BUFFERING (25%)");
  assert.equal(f.track.attrs["aria-valuenow"], "25");
  assert.equal(f.window.HALO_STREAM_READY, false);
  f.audio.readyState = 4;
  f.emit("canplaythrough");
  assert.equal(f.root.dataset.state, "ready");
  assert.equal(f.percent.textContent, "25%", "can-play is not misreported as 100% downloaded");
  assert.equal(f.window.HALO_STREAM_READY, true);
  assert.equal(f.window.HaloDreamweaverReadiness.label, "READY & BUFFERED");
  f.audio.buffered = new Ranges([[0, 200]]);
  f.emit("progress");
  assert.equal(f.root.dataset.state, "loaded");
  assert.equal(f.status.textContent, "● AI TELEMETRY: FULLY LOADED");
  assert.equal(f.audio.plays, 0, "telemetry never starts playback");
});

await check("stalls, playback, pause and faults are reported from media events", () => {
  const f = fixture(audio => { audio.source = "/audio/master.wav"; audio.duration = 100; });
  f.emit("waiting");
  assert.equal(f.root.dataset.state, "stalled");
  assert.equal(f.window.HALO_STREAM_READY, false);
  f.audio.buffered = new Ranges([[0, 40]]);
  f.emit("playing");
  assert.equal(f.root.dataset.state, "playing");
  assert.equal(f.window.HALO_STREAM_READY, true);
  f.audio.paused = false;
  f.emit("canplaythrough");
  assert.equal(f.root.dataset.state, "playing", "a late can-play event cannot downgrade active playback");
  f.audio.paused = true;
  f.audio.readyState = 4;
  f.emit("pause");
  assert.equal(f.root.dataset.state, "ready");
  f.emit("waiting");
  f.audio.readyState = 2;
  f.emit("pause");
  assert.equal(f.root.dataset.state, "buffering", "pausing a stall is not readiness evidence");
  assert.equal(f.window.HALO_STREAM_READY, false);
  f.audio.error = { code: 4 };
  f.emit("error");
  assert.equal(f.root.dataset.state, "fault");
  assert.equal(f.percent.textContent, "ERR");
  assert.equal(f.status.textContent, "● AI TELEMETRY: STREAM FAULT / OFFLINE");
  assert.equal(f.window.HALO_STREAM_READY, false);
  f.emit("progress");
  assert.equal(f.root.dataset.state, "fault", "late progress cannot hide a fault");
  f.audio.error = null;
  f.emit("loadstart");
  assert.equal(f.root.dataset.state, "loading", "a new source clears the fault");
  const release = detail => f.audio.dispatchEvent(Object.assign(new Event("halo:release-state"), { detail }));
  release({ state: "unavailable", mode: "error" });
  assert.equal(f.root.dataset.state, "fault", "a player verdict without a media event still surfaces the fault");
  release({ state: "loading", mode: "remote" });
  assert.equal(f.root.dataset.state, "loading", "a fresh remote attempt clears the verdict");
  f.audio.source = "";
  f.emit("emptied");
  assert.equal(f.root.dataset.state, "standby");
});

await check("buffer math uses the playhead range and tolerates broken media APIs", () => {
  assert.equal(bufferedPercent({ duration: NaN }), null);
  assert.equal(bufferedPercent({ duration: 100, currentTime: 0, buffered: new Ranges([[0, 10], [80, 100]]) }), 10);
  assert.equal(bufferedPercent({ duration: 100, currentTime: 85, buffered: new Ranges([[0, 10], [80, 100]]) }), 100);
  assert.equal(bufferedPercent({ duration: 100, get buffered() { throw new Error("detached"); } }), null);
});

await check("already-loaded media and local previews initialize correctly; dispose detaches", () => {
  const f = fixture(audio => {
    audio.source = "blob:https://halo.test/x"; audio.currentSrc = audio.source;
    audio.duration = 10; audio.readyState = 4; audio.buffered = new Ranges([[0, 10]]);
  });
  assert.equal(f.root.dataset.state, "loaded");
  assert.equal(f.window.HaloDreamweaverReadiness.local, true);
  f.telemetry.dispose();
  f.emit("waiting");
  assert.equal(f.root.dataset.state, "loaded");
});

await check("markup is CSP-safe, accessible and wired once", async () => {
  const html = await readFile(new URL("../dreamweaver/index.html", import.meta.url), "utf8");
  const block = html.slice(html.indexOf('id="aiReadiness"') - 40, html.indexOf('id="aiReadinessBar"') + 80);
  assert.ok(html.includes('id="aiReadiness"') && html.includes('id="showAudio"'));
  assert.ok(!/style=/.test(block), "no inline style attributes under style-src 'self'");
  assert.match(block, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"/);
  assert.match(block, /id="aiReadinessStatus" role="status" aria-live="polite"/);
  assert.equal(html.match(/readiness-telemetry\.js/g).length, 1);
  assert.ok(html.indexOf('id="aiReadiness"') < html.indexOf('id="songLobbyPlayerTitle"'), "bar sits in the song lobby player");
  const css = await readFile(new URL("../dreamweaver/dreamweaver.css", import.meta.url), "utf8");
  for (const state of ["buffering", "stalled", "ready", "loaded", "playing", "fault"]) {
    assert.ok(css.includes(`.dw-readiness[data-state="${state}"]`), `${state} styling`);
  }
});

console.log(`Dreamweaver readiness telemetry contracts: ${checks}/7 passed.`);
