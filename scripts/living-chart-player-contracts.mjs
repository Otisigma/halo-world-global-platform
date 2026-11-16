import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chartSignalScore } from "../lib/chart-signal.js";
import { serializeChartRelease } from "../netlify/lib/catalog-chart.mjs";
import vm from "node:vm";

const source = await readFile(new URL("../music/living-chart-player.js", import.meta.url), "utf8");
const createChartPlayer = new Function("createLivingVisualizer",
  `${source.replace(/^import .+\n/, "").replace("export function", "function")}\nreturn createChartPlayer;`
)(() => ({ reset() {} }));

class Node extends EventTarget {
  constructor(document) {
    super();
    this.document = document;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.disabled = false;
    this.value = "0";
    this.textContent = "";
    this.classList = { toggle() {} };
  }
  append(node) { this.children.push(node); }
  replaceChildren() { this.children = []; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.document.activeElement = this; }
  closest(selector) { return selector === "[data-chart-command]" && this.dataset.chartCommand ? this : null; }
}

function fixture() {
  const document = new EventTarget();
  document.createElement = () => new Node(document);
  const window = new EventTarget();
  window.CustomEvent = CustomEvent;
  window.location = { origin: "https://halo.test" };
  const copies = [], notices = [], requests = [];
  window.navigator = { clipboard: { writeText: async value => { copies.push(value); } } };
  window.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ success: true, votes: 1 });
  };
  const root = new Node(document), elements = new Map();
  root.querySelector = selector => {
    if (!elements.has(selector)) {
      const element = new Node(document);
      element.dataset.chartCommand = selector.match(/data-chart-command="([^"]+)"/)?.[1];
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  const audio = new EventTarget();
  Object.assign(audio, { duration: 100, currentTime: 0 });
  const releases = ["alpha", "beta", "gamma", "no-audio"].map(id => ({
    id, title: id, artist: "HALO", status: "published", isChartEligible: true,
    src: id === "no-audio" ? "" : `/audio/${id}.wav`
  }));
  let visible = releases, selected = releases[0];
  const played = [];
  const player = {
    audio, track: null, status: "idle",
    resume() {
      this.status = "playing";
      audio.dispatchEvent(new Event("playing"));
    },
    play(track) {
      const changed = this.track?.id !== track.id;
      this.track = track;
      this.status = !changed && this.status === "playing" ? "paused" : "playing";
      played.push(track.id);
      if (changed) window.dispatchEvent(new CustomEvent("halo:trackchange", { detail: { id: track.id } }));
      audio.dispatchEvent(new Event(this.status === "playing" ? "playing" : "pause"));
    }
  };
  const controller = createChartPlayer({
    document, window, player, root, getReleases: () => releases, getVisible: () => visible,
    getSelected: () => selected, trackFor: release => ({ ...release }),
    select: id => { selected = releases.find(release => release.id === id); },
    notify: message => notices.push(message)
  });
  const get = selector => root.querySelector(selector);
  const command = name => get(`[data-chart-command="${name}"]`);
  const click = name => {
    const event = new Event("click");
    Object.defineProperty(event, "target", { value: command(name) });
    root.dispatchEvent(event);
  };
  const end = () => audio.dispatchEvent(new Event("ended"));
  return { audio, player, root, document, window, releases, controller, played, get, command, click, end, copies, notices, requests,
    filter: entries => { visible = entries; }, select: release => { selected = release; controller.sync(); } };
}

// One immutable listening order per explicit Play this view; filtering never steals it.
{
  const f = fixture();
  f.click("queue");
  assert.deepEqual(f.played, ["alpha"]);
  assert.equal(f.get("[data-chart-queue-count]").textContent, "3", "nonstreamable releases remain discoverable but never enter the audio queue");
  f.filter([f.releases[2]]);
  f.click("toggle");
  assert.equal(f.player.status, "paused");
  assert.equal(f.command("stop").disabled, false, "pausing the selection must preserve continuation");
  f.click("toggle");
  assert.equal(f.player.status, "playing");
  f.end();
  assert.equal(f.player.track.id, "beta");
  f.click("next");
  assert.equal(f.player.track.id, "gamma");
  f.click("previous");
  assert.equal(f.player.track.id, "beta");
  f.end();
  f.end();
  assert.equal(f.command("stop").disabled, true, "the finite queue stops, never loops unexpectedly");
  assert.match(f.get("[data-chart-player-status]").textContent, /Queue complete/);
}
{
  const f = fixture();
  f.click("queue");
  f.audio.currentTime = 50;
  f.click("queue");
  assert.equal(f.player.status, "playing", "restarting a view must not accidentally toggle the current release into pause");
  assert.equal(f.audio.currentTime, 0);
  f.click("toggle");
  f.click("queue");
  assert.equal(f.player.status, "playing", "Play this view resumes even if the first entry was paused");
}
for (const event of ["halo:chart-queue-start", "halo:personal-queue-start"]) {
  const f = fixture();
  f.click("queue");
  f.window.dispatchEvent(new Event(event));
  f.end();
  assert.deepEqual(f.played, ["alpha"], `${event} must take exclusive continuation ownership`);
}
{
  const f = fixture();
  f.click("queue");
  f.audio.dispatchEvent(new Event("error"));
  f.end();
  assert.deepEqual(f.played, ["alpha"], "failed audio must stop, rather than silently skip through the catalog");
  assert.match(f.get("[data-chart-player-status]").textContent, /Audio could not play/);
}
{
  const f = fixture();
  f.click("queue");
  const event = new Event("click");
  Object.defineProperty(event, "target", { value: { closest: () => ({}) } });
  f.document.dispatchEvent(event);
  f.end();
  assert.deepEqual(f.played, ["alpha"], "manual release play controls stop discovery continuation");
}
{
  const f = fixture();
  f.click("queue");
  f.player.play({ ...f.releases[2] });
  f.end();
  assert.deepEqual(f.played, ["alpha", "gamma"], "external track changes cannot be hijacked by an older queue");
  const seek = f.get("[data-chart-seek]");
  assert.equal(seek.disabled, false);
  seek.value = "750";
  seek.dispatchEvent(new Event("input"));
  assert.equal(f.audio.currentTime, 75);
  assert.match(seek.attributes["aria-valuetext"], /1:15 of 1:40/);
  f.click("moment");
  await Promise.resolve();
  assert.equal(f.copies[0], "https://halo.test/obsidian/?song=gamma&t=75");
  f.audio.duration = Infinity;
  f.controller.sync();
  assert.equal(seek.disabled, true, "seeking requires a real finite duration");
}
{
  const f = fixture();
  f.select(f.releases[3]);
  assert.equal(f.command("toggle").disabled, true);
  f.select({ ...f.releases[0], isChartEligible: false });
  assert.equal(f.command("vote").disabled, true, "listening-only songs never receive chart votes");
  f.select(f.releases[0]);
  f.click("vote");
  assert.equal(f.command("vote").disabled, true, "prevent concurrent duplicate requests");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/catalog/vote");
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { releaseId: "alpha" });
  assert.equal(f.releases[0].votes, 1);
  assert.match(f.get("[data-chart-vote-status]").textContent, /vote counted/);
  assert.equal(f.command("vote").disabled, true);
}
{
  const f = fixture();
  f.window.fetch = async () => Response.json({ message: "Vote service unavailable" }, { status: 503 });
  const originalError = console.error;
  console.error = () => {};
  try {
    f.click("vote");
    await new Promise(resolve => setImmediate(resolve));
    assert.match(f.get("[data-chart-vote-status]").textContent, /Vote service unavailable/);
    assert.equal(f.command("vote").disabled, false, "failed votes must be retryable, never shown as counted");
    f.window.fetch = async () => Response.json({ success: true, votes: "100" });
    f.click("vote");
    await new Promise(resolve => setImmediate(resolve));
    assert.match(f.get("[data-chart-vote-status]").textContent, /invalid response/);
    assert.equal(f.releases[0].votes, undefined);
  } finally { console.error = originalError; }
}
for (const values of [
  { votes: 3, recentListens: 10, recentOpens: 2 },
  { votes: 0, recentListens: 0, recentOpens: 0 },
  { votes: 100, recentListens: 1, recentOpens: 5 }
]) {
  assert.equal(chartSignalScore(values), serializeChartRelease({
    id: "shared-score", status: "published", votes: values.votes,
    recent_listens: values.recentListens, recent_opens: values.recentOpens
  }).signalScore, "API and listening chart must use exactly the same scoring function");
}
for (const value of [-1, NaN, Infinity, "7", null]) assert.equal(chartSignalScore({ votes: value }), 0, "malformed counts cannot create a score");
assert.doesNotMatch(source, /new Audio|createMediaElementSource|getUserMedia/, "reuse the existing audio stream, never microphone capture or another audible player");
{
  const music = await readFile(new URL("../music/music.js", import.meta.url), "utf8");
  const videoFunction = music.match(/  function playChartVideo\(videoId\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(videoFunction);
  let paused = false, queueStopped = false, replacement;
  const context = vm.createContext({
    satelliteVideoFallbackEnabled: false,
    state: { videos: [{ id: "approved-video", title: "HALO video", sourceType: "direct", sourceUrl: "/video.webm" }], releases: [], activeReleaseId: "alpha" },
    elements: { chartStage: { querySelector: () => ({ replaceWith: frame => { replacement = frame; } }) } },
    document: { createElement: () => ({}) }, fallbackVideoForRelease: () => null,
    chartExperience: { stop: () => { queueStopped = true; } },
    player: { audio: { pause: () => { paused = true; } }, setStatus: status => assert.equal(status, "paused") },
    window: { CustomEvent, dispatchEvent() {} }, URL,
    safeUrl: value => value || "", escapeHtml: String, privacyEnhancedEmbedUrl: () => ""
  });
  vm.runInContext(videoFunction, context);
  context.playChartVideo("approved-video");
  assert.equal(paused, true, "opening real video must pause shared audio before starting another media surface");
  assert.equal(queueStopped, true, "a video must not race a queued track continuation");
  assert.match(replacement.innerHTML, /<video src="\/video.webm"/);
  assert.match(music, /player\.audio\.addEventListener\("play",[\s\S]*querySelector\("iframe, video"\)[\s\S]*renderChartStage/, "returning to audio must restore the video poster, not leave competing embedded playback");
}
for (const page of ["music/index.html", "music-upload/index.html"]) {
  const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
  for (const id of ["living-chart", "chartSearch", "chartRefresh", "chartUpdated", "chartTransport"]) assert.equal(html.split(`id="${id}"`).length - 1, 1);
  assert.match(html, /href="#personalPlaylistHub"/);
  assert.match(html, /Discovery order is never a chart rank/);
}
console.log("Living Chart player contracts passed.");
