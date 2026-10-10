import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { addAlbumTrack, moveAlbumTrack, safePreviewUrl, createJourneyController } from "../empath-journey/journey.js";
import { createLyricInteractionRecorder } from "../lib/journey-interactions.js";

class Element extends EventTarget {
  constructor(tag) {
    super(); this.tagName = tag; this.children = []; this.attributes = new Map();
    this.value = ""; this.checked = false; this.hidden = false; this.textContent = "";
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value) };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  play() { this.dispatchEvent(new Event("play")); return Promise.resolve(); }
  pause() { this.dispatchEvent(new Event("pause")); }
  load() {}
}
const ids = ["journey", "status", "tracks", "presence", "sequence", "trackCount", "albumName",
  "shared", "shareLink", "albums", "audio", "lyricsRoot", "lyricsList", "lyricsViewport",
  "lyricsMode", "lyricsStatus", "recordLyrics", "nowPlaying", "save", "loadMine", "refresh", "newAlbum"];
const nodes = Object.fromEntries(ids.map(id => [id, new Element(id)]));
const doc = { getElementById: id => nodes[id], createElement: tag => new Element(tag) };
const tracks = Array.from({ length: 13 }, (_, index) => ({
  id: `release-${index}`, title: `Track ${index}`, artist: "HALO", previewUrl: `/preview-${index}.mp3`,
  lyricsText: "[00:01] Stay || Artist insight", votes: { track: 0, remix: 0, priority: 0 }
}));
const persisted = new Map();
const writes = [];
let callbacks;
const controller = createJourneyController({
  doc, win: { location: { href: "https://halo.test/empath-journey/" } },
  lyricsFactory: options => { callbacks = options; return { setSource: source => { nodes.lyricsList.textContent = source; } }; },
  fetcher: async (url, options) => {
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      writes.push(body);
      if (body.action === "album") {
        const album = { ...body, id: body.id || "saved-arc" };
        persisted.set(album.id, structuredClone(album));
        return Response.json({ album });
      }
      return Response.json({ ok: true });
    }
    if (url.includes("mine=1")) return Response.json({ albums: [...persisted.values()] });
    return Response.json({ tracks, presence: "gathering" });
  }
});
await controller.init();
const click = async node => {
  node.dispatchEvent(new Event("click"));
  await new Promise(resolve => setImmediate(resolve));
};
assert.equal(nodes.presence.textContent, "Quiet presence · listening together");
assert.equal(nodes.tracks.children.length, 13);
await click(nodes.tracks.children[0].children.at(-1).children[0]);
assert.deepEqual(writes[0], { action: "vote", releaseId: "release-0", kind: "track" });
for (let index = 0; index < 12; index++) await click(nodes.tracks.children[index].children.at(-1).children[3]);
assert.equal(controller.state.sequence.length, 12);
await click(nodes.tracks.children[12].children.at(-1).children[3]);
assert.match(nodes.status.textContent, /at most 12/);
assert.throws(() => addAlbumTrack(controller.state.sequence, "release-0"), /already/);
await click(nodes.sequence.children[0].children[0].children[2]);
assert.equal(controller.state.sequence[0].releaseId, "release-1");
assert.equal(controller.state.sequence[1].releaseId, "release-0");
const transition = nodes.sequence.children[0].children[1].children[0];
transition.value = "3";
transition.dispatchEvent(new Event("change"));
nodes.albumName.value = "A calmer chapter";
nodes.shared.checked = true;
await click(nodes.save);
assert.equal(persisted.get("saved-arc").tracks[0].releaseId, "release-1");
assert.equal(persisted.get("saved-arc").tracks[0].transitionSeconds, 3);
assert.equal(nodes.shareLink.attributes.get("href"), "/empath-journey/?album=saved-arc");
await click(nodes.loadMine);
await click(nodes.albums.children[0]);
assert.equal(controller.state.albumId, "saved-arc");
nodes.shared.checked = false;
await click(nodes.save);
assert.equal(persisted.get("saved-arc").shared, false);
assert.equal(nodes.shareLink.hidden, true);
assert.equal(nodes.shareLink.attributes.has("href"), false);
await click(nodes.sequence.children[0].children[0].children[0]);
assert.equal(nodes.audio.src, "/preview-1.mp3");
assert.match(nodes.lyricsList.textContent, /\|\| Artist insight/);
callbacks.onSeek(1);
assert.equal(writes.filter(write => write.action === "lyric").length, 0, "lyric tracing is opt-in");
nodes.recordLyrics.checked = true;
callbacks.onInsight({ time: 1 });
await new Promise(resolve => setImmediate(resolve));
assert.equal(writes.filter(write => write.action === "lyric").length, 1);
nodes.audio.duration = 10; nodes.audio.currentTime = 9;
nodes.audio.dispatchEvent(new Event("timeupdate"));
assert.equal(nodes.audio.volume, 1 / 3);
nodes.audio.dispatchEvent(new Event("ended"));
assert.equal(nodes.audio.src, "/preview-0.mp3", "ordered sequence advances to next preview");
assert.equal(nodes.audio.volume, 0, "the next preview fades in from the previous transition");
nodes.audio.currentTime = 1.5;
nodes.audio.dispatchEvent(new Event("timeupdate"));
assert.equal(nodes.audio.volume, 0.5, "transition after the previous track controls the next fade-in");
controller.state.tracks[2].previewUrl = "";
await click(nodes.tracks.children[2].children.at(-1).children[4]);
assert.equal(nodes.nowPlaying.textContent, "Track 2 · HALO");
assert.match(nodes.lyricsList.textContent, /Artist insight/, "lyric books work without audio previews");
assert.equal(controller.state.previewIndex, -1);
assert.deepEqual(moveAlbumTrack([{ releaseId: "one" }], 0, -1), [{ releaseId: "one" }]);
for (const url of ["javascript:alert(1)", "//evil.test/file", "/\\evil.test", "******example.test/a"]) assert.equal(safePreviewUrl(url), "");
assert.equal(safePreviewUrl("/audio.mp3"), "/audio.mp3");
let time = 0;
const events = [];
const recorder = createLyricInteractionRecorder({ now: () => time, enabled: () => true,
  releaseId: () => "release", fetcher: async (_url, options) => events.push(JSON.parse(options.body)) });
recorder(12); recorder(13); time = 5000; recorder(14);
assert.equal(events.length, 2, "rapid interactions are coalesced");
const html = await readFile(new URL("../empath-journey/index.html", import.meta.url), "utf8");
assert.match(html, /id="recordLyrics" type="checkbox"/);
assert.doesNotMatch(html, /id="recordLyrics"[^>]*checked/);
const css = await readFile(new URL("../empath-journey/journey.css", import.meta.url), "utf8");
assert.match(css, /prefers-reduced-motion/);
const sharedController = createJourneyController({
  doc, win: { location: { href: "https://halo.test/empath-journey/?album=shared-arc" } },
  lyricsFactory: () => ({ setSource() {} }),
  fetcher: async url => url.includes("album=")
    ? Response.json({ album: { id: "shared-arc", name: "Public arc", shared: true,
      tracks: [{ releaseId: "release-0", transitionSeconds: 0 }] }, tracks })
    : Response.json({ tracks, presence: "quiet" })
});
await sharedController.init();
assert.equal(sharedController.state.albumId, null);
assert.equal(nodes.shared.checked, false, "copies of shared albums are private by default");
assert.equal(nodes.shareLink.hidden, true);
console.log("Empath journey UI contracts passed: vote controls, 12-track limit, ordered persistence, edit/revoke, preview, and consent.");
