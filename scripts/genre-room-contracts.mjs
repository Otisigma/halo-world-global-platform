import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [roomSource, music, upload, discovery, discoveryClient, musicClient, routes, netlify] = await Promise.all([
  read("music/genre-rooms.js"), read("music/index.html"), read("music-upload/index.html"),
  read("discover/index.html"), read("discover/discover.js"), read("music/music.js"),
  read("lib/route-registry.js"), read("netlify.toml")
]);

const window = {};
vm.runInNewContext(roomSource, { window });
const rooms = window.HaloGenreRooms;
assert.deepEqual(Array.from(rooms.gateways, room => room.label), [
  "Electronic & Deep House", "Afrobeats & Global Sounds",
  "Ambient & Experimental", "Rock & Alternative"
]);
assert.equal(rooms.gateways.length, 4);
assert.equal(rooms.matches({ genres: ["Atmospheric Deep House", "Afro House"], bpm: 122 }, "dance"), true);
assert.equal(rooms.matches({ genres: ["Afrobeats", "Amapiano", "Global Sounds"] }, "global"), true);
assert.equal(rooms.matches({ catalog: { genre: "Cinematic Ambient, Experimental" } }, "ambient"), true);
assert.equal(rooms.matches({ genres: ["Alternative Rock", "Indie Rock"] }, "rock-alternative"), true);
assert.equal(rooms.matches({ genres: ["Afrobeats"] }, "dance"), false);
assert.equal(rooms.matches({ genres: ["Deep House"] }, "global"), false);
assert.equal(rooms.matches({ genres: ["Afrobeats"] }, "all"), true);
const catalog = [
  { id: "house", title: "Night Drive", genres: ["Deep House"] },
  { id: "global", title: "Amapiano", genres: ["Amapiano"] },
  { id: "ambient", title: "Quiet", genres: ["Ambient"] }
];
assert.deepEqual(Array.from(rooms.filterReleases(catalog, "global"), release => release.id), ["global"]);
assert.deepEqual(Array.from(rooms.filterReleases(catalog, "all"), release => release.id), ["house", "global", "ambient"],
  "All restores every genre after selecting a narrowed room");
assert.deepEqual(Array.from(rooms.filterReleases(catalog, "all", "night"), release => release.id), ["house"]);
const buttons = ids => ids.map(id => ({
  dataset: { discoveryPlay: id }, textContent: "▶ Play", attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; }
}));
const visibleAfterFilter = buttons(["house"]);
rooms.syncPlaybackControls({ querySelectorAll: () => visibleAfterFilter }, "house", true);
const rerendered = buttons(["house", "ambient"]);
rooms.syncPlaybackControls({ querySelectorAll: () => rerendered }, "house", true);
assert.equal(rerendered[0].textContent, "❚❚ Pause");
assert.equal(rerendered[0].attributes["aria-pressed"], "true",
  "the active card stays visibly and accessibly playing when rerendered after search/filter");
assert.equal(rerendered[1].attributes["aria-pressed"], "false");

for (const [markup, name] of [[music, "music"], [upload, "music-upload"]]) {
  for (const label of ["Electronic &amp; Deep House", "Afrobeats &amp; Global Sounds",
    "Ambient &amp; Experimental", "Rock &amp; Alternative"]) {
    assert.ok(markup.includes(label), `${name} exposes ${label}`);
  }
  assert.match(markup, /More genre rooms/, `${name} retains specialist genre tabs`);
  assert.match(markup, /Discover artists &amp; releases/);
  assert.match(markup, /This room features Afrobeats and global sounds, ranked by recent 7-day listener activity/);
  assert.match(markup, /src="\/music\/genre-rooms\.js"[\s\S]*src="\/music\/music\.js"/);
}
assert.match(discovery, /id="genreGateways"/);
assert.match(discovery, /id="specialistRooms"/);
assert.match(discoveryClient, /All releases/);
assert.match(discovery, /<audio id="audio" controls preload="none"/);
assert.match(discoveryClient, /filter\(approved\)/);
assert.match(discoveryClient, /resolveAudio\(release, \{ preferPreview: true, requirePlayable: true \}\)/);
assert.match(discoveryClient, /new URLSearchParams\(\{ song: release\.id, add: release\.id \}\)/);
assert.match(discoveryClient, /releaseGrid\.replaceChildren[\s\S]*syncPlaybackControls\(\)/,
  "filter/search card replacement must resynchronize active play controls");
assert.doesNotMatch(discoveryClient, /innerHTML/, "artist/catalog strings are rendered as text nodes");
assert.match(musicClient, /function openRequestedAdd\(\)/);
assert.match(musicClient, /requestedRoom/);
assert.match(routes, /directoryRoute\("Artist Discovery", "\/discover\/", "discover\/index\.html"/);
assert.match(netlify, /from = "\/discover\/"[\s\S]*to = "\/discover\/index\.html"/);
console.log("Genre room contracts passed: primary gateways, specialist rooms, discovery cards, safe playback, and playlist handoff.");
