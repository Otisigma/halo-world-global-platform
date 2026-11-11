import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createGateway, eligibleReleases, safeDestination } from "../obsidian/obsidian.js";

class Element {
  constructor() { this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ""; this.classList = { toggle: (key, value) => { this[key] = value; } }; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return name === "src" ? this.src : this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src" || name === "href") this[name] = ""; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  pause() { this.paused = true; }
  play() { this.played = (this.played || 0) + 1; return Promise.resolve(); }
  load() {}
}
const ids = ["audio", "status", "tracks", "previous", "next", "retry", "share", "loop", "destination", "releaseLink", "artwork", "pulse", "selectedTitle", "artist", "position", "count", "lyrics", "lyricsStatus", "lyricsLines", "loadNote", "continueNext", "shareMoment"];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
nodes.audio.hidden = true;
const document = { getElementById: id => nodes[id], createElement: () => new Element() };
nodes.continueNext.checked = true;
const location = { origin: "https://halo.test", href: "https://halo.test/obsidian/?song=beta" };
let resets = 0, selection;
const window = {
  location,
  navigator: { clipboard: { async writeText(value) { assert.equal(value, location.href); } } },
  history: { replaceState(_state, _title, url) { location.href = new URL(url, location.origin).href; } },
  HaloListeningTelemetry: { bindAudio(_audio, fn) { selection = fn; return { reset() { resets++; } }; } },
  HaloReleaseArtwork: {
    resolvePreviewAudio: release => ({ src: release.streamUrl || "", isPlayable: Boolean(release.streamUrl) }),
    resolve: () => ({ src: "/fallback.svg", source: "fallback" })
  }
};
const releases = [
  { id: "alpha", status: "published", title: "<img onerror=alert(1)>", artist: "A", streamUrl: "/audio.mp3", distributionUrl: "https://distrokid.com/hyperfollow/artist/release", dreamweaverPayload: { lyricsText: "[00:01] First line\n[00:04] <img onerror=alert(1)>" } },
  { id: "beta", status: "passed", title: "Beta", artist: "B", purchaseUrl: "javascript:alert(1)", dreamweaverPayload: { lyricsText: "Untimed line" } },
  { id: "private", status: "published", isLiveVisible: false, title: "Private" },
  { id: "draft", status: "draft", title: "Draft" }
];
let reply = async () => Response.json({ releases });
const gateway = createGateway({ document, window, fetcher: () => reply() });
await gateway.load();
assert.equal(gateway.state.releases.length, 2);
assert.equal(nodes.selectedTitle.textContent, "Beta");
assert.equal(nodes.destination.hidden, true, "unsafe destination must not be linked");
assert.equal(nodes.audio.hidden, true);
assert.equal(nodes.loop.disabled, true);
assert.match(nodes.status.textContent, /unavailable/);
assert.match(nodes.lyricsStatus.textContent, /not timestamped/);
assert.equal(selection(), "beta");
nodes.next.events.click();
assert.equal(nodes.selectedTitle.textContent, "<img onerror=alert(1)>", "title rendered as literal text");
assert.equal(nodes.audio.src, "/audio.mp3");
assert.equal(nodes.lyricsLines.children[1].textContent, "<img onerror=alert(1)>", "lyrics remain literal text");
nodes.audio.currentTime = 1.1;
nodes.audio.events.timeupdate();
assert.equal(nodes.lyricsLines.children[0]["is-current"], true);
nodes.audio.currentTime = 4;
nodes.audio.events.seeked();
assert.equal(nodes.lyricsLines.children[0]["is-current"], false);
assert.equal(nodes.lyricsLines.children[1]["is-current"], true);
assert.equal(nodes.loop.disabled, false);
nodes.loop.checked = true;
nodes.loop.events.change();
assert.equal(nodes.audio.loop, true, "loop is explicit and applies to selected audio");
assert.equal(nodes.destination.href, releases[0].distributionUrl);
assert.match(nodes.releaseLink.href, /song=alpha/);
await nodes.share.events.click();
assert.equal(nodes.status.textContent, "Release link copied.");
assert.equal(nodes.audio.paused, true, "selection must not autoplay");
nodes.audio.events.playing();
assert.equal(nodes.pulse.playing, true);
nodes.audio.events.waiting();
assert.equal(nodes.pulse.playing, false);
nodes.audio.events.error();
assert.match(nodes.status.textContent, /could not be played/);
nodes.previous.events.click();
assert.equal(gateway.state.index, 1, "previous wraps around");
nodes.audio.loop = true;
nodes.audio.events.ended();
assert.equal(gateway.state.index, 1, "explicit loop wins over continuation");
nodes.audio.loop = false;
nodes.audio.events.ended();
assert.equal(gateway.state.index, 0, "ended continues to the next playable release");
assert.equal(nodes.audio.played, 1, "continuation starts playback after the listener already started the session");
nodes.audio.events.ended();
assert.equal(gateway.state.index, 0, "unplayable releases are skipped and never block the queue");
nodes.continueNext.checked = false;
gateway.select(1);
nodes.audio.events.ended();
assert.equal(gateway.state.index, 1, "continuation is optional");
nodes.continueNext.checked = true;
gateway.select(0);
nodes.audio.events.loadstart();
assert.equal(nodes.loadNote.hidden, false, "loading note appears only while audio loads");
nodes.audio.events.canplay();
assert.equal(nodes.loadNote.hidden, true);
gateway.select(0, 43);
nodes.audio.duration = 200;
nodes.audio.events.loadedmetadata();
assert.equal(nodes.audio.currentTime, 43, "timestamped links seek without starting playback");
assert.match(nodes.status.textContent, /0:43/);
const warmed = [];
window.Audio = class { constructor() { warmed.push(this); } removeAttribute() { this.src = ""; } };
gateway.select(1);
nodes.audio.duration = 100;
nodes.audio.currentTime = 30;
nodes.audio.events.timeupdate();
assert.equal(warmed.length, 0, "next release is not fetched early in the track");
nodes.audio.currentTime = 70;
nodes.audio.events.timeupdate();
nodes.audio.events.timeupdate();
assert.equal(warmed.length, 1, "next playable release is warmed once after 60%");
assert.equal(warmed[0].src, "/audio.mp3");
assert.equal(warmed[0].preload, "auto");
nodes.continueNext.checked = false;
gateway.select(0);
nodes.audio.duration = 100;
nodes.audio.currentTime = 90;
nodes.audio.events.timeupdate();
assert.equal(warmed.length, 1, "nothing is warmed when continuation is off");
nodes.continueNext.checked = true;
gateway.select(0);
nodes.audio.duration = 100;
nodes.audio.buffered = { length: 1, end: () => 40 };
nodes.audio.events.loadstart();
nodes.audio.events.progress();
assert.match(nodes.loadNote.textContent, /Buffered 40%/);
nodes.audio.events.canplay();
nodes.audio.currentTime = 75.8;
window.navigator.clipboard.writeText = async value => { assert.equal(new URL(value).searchParams.get("t"), "75"); };
await nodes.shareMoment.events.click();
assert.match(nodes.status.textContent, /1:15 copied/);
assert.ok(resets >= 3, "listening reports end before selection changes");
location.href = "https://halo.test/obsidian/?song=missing";
await gateway.load();
assert.equal(nodes.selectedTitle.textContent, "Release unavailable");
assert.equal(gateway.state.index, -1, "unknown song must not silently select another");
assert.equal(nodes.tracks.children.length, 2);
nodes.tracks.children[0].events.click();
assert.equal(gateway.state.index, 0);
assert.equal(location.href, "https://halo.test/obsidian/?song=alpha");
reply = async () => Response.json({ releases: [] });
await gateway.load();
assert.equal(nodes.selectedTitle.textContent, "No public releases yet");
assert.equal(nodes.releaseLink.href, "/music/");
assert.equal(nodes.lyrics.hidden, true, "stale lyrics clear when catalog has no releases");
assert.equal(nodes.audio.hidden, true);
reply = async () => Response.json({}, { status: 503 });
const originalError = console.error;
console.error = () => {};
try {
  await gateway.load();
  assert.equal(nodes.selectedTitle.textContent, "Catalog unavailable");
  assert.equal(nodes.retry.hidden, false);
  reply = async () => Response.json({ releases });
  nodes.retry.events.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.selectedTitle.textContent, releases[0].title);
} finally { console.error = originalError; }
assert.throws(() => eligibleReleases({}), /invalid/);
for (const value of ["javascript:alert(1)", "https://user:pass@evil.test/", "", "//user@evil.test"]) assert.equal(safeDestination(value, location.origin), "");
assert.equal(safeDestination("/music/", location.origin), "https://halo.test/music/");
const [page, css, client] = await Promise.all(["obsidian/index.html", "obsidian/obsidian.css", "obsidian/obsidian.js"].map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
assert.match(page, /<audio id="audio" controls preload="none"/);
assert.match(page, /id="loadNote" hidden/);
assert.match(page, /not measured audio frequencies/);
assert.match(css, /prefers-reduced-motion:reduce/);
assert.doesNotMatch(client, /innerHTML|autoplay|private.key|SECRET/);
console.log("Obsidian gateway contracts passed: public catalog, audio state, navigation, links and failures.");
