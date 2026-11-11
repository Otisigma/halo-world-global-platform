import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createGateway, eligibleReleases, safeDestination } from "../obsidian/obsidian.js";

class Element {
  constructor() { this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ""; this.classList = { toggle: (key, value) => { this[key] = value; } }; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src" || name === "href") this[name] = ""; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  pause() { this.paused = true; }
  load() {}
}
const ids = ["audio", "status", "tracks", "previous", "next", "retry", "share", "loop", "destination", "releaseLink", "artwork", "pulse", "selectedTitle", "artist", "position", "count"];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
nodes.audio.hidden = true;
const document = { getElementById: id => nodes[id], createElement: () => new Element() };
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
  { id: "alpha", status: "published", title: "<img onerror=alert(1)>", artist: "A", streamUrl: "/audio.mp3", distributionUrl: "https://distrokid.com/hyperfollow/artist/release" },
  { id: "beta", status: "passed", title: "Beta", artist: "B", purchaseUrl: "javascript:alert(1)" },
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
assert.equal(selection(), "beta");
nodes.next.events.click();
assert.equal(nodes.selectedTitle.textContent, "<img onerror=alert(1)>", "title rendered as literal text");
assert.equal(nodes.audio.src, "/audio.mp3");
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
assert.match(page, /not measured audio frequencies/);
assert.match(css, /prefers-reduced-motion:reduce/);
assert.doesNotMatch(client, /innerHTML|autoplay|private.key|SECRET/);
console.log("Obsidian gateway contracts passed: public catalog, audio state, navigation, links and failures.");
