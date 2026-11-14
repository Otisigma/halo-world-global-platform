import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createGateway, eligibleReleases, safeDestination, releaseCategories } from "../obsidian/obsidian.js";

class Element {
  constructor() { this.children = []; this.events = {}; this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = ""; this.classList = { toggle: (key, value) => { this[key] = value; } }; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return name === "src" ? this.src : this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src" || name === "href") this[name] = ""; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelector() { return this.submitButton || (this.submitButton = new Element()); }
  pause() { this.paused = true; }
  play() { this.played = (this.played || 0) + 1; return Promise.resolve(); }
  load() {}
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
}
const ids = ["audio", "status", "tracks", "previous", "next", "retry", "share", "loop", "destination", "releaseLink", "artwork", "pulse", "selectedTitle", "artist", "position", "count", "lyrics", "lyricsStatus", "lyricsLines", "loadNote", "continueNext", "shareMoment", "quickFilters", "genreFilters", "versionFilters", "genreFilterSummary", "versionFilterSummary", "gridStatus", "createPlaylistForm", "newPlaylistName", "playlistStatus", "userPlaylists", "addToPlaylist", "addToPlaylistButton", "playlistPlayerStatus", "visualizerToggle", "visualizerStatus", "visualizerField"];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
nodes.audio.hidden = true;
nodes.visualizerField.style = { setProperty() {} };
const document = { getElementById: id => nodes[id], createElement: () => new Element(), addEventListener() {} };
nodes.continueNext.checked = true;
const location = { origin: "https://halo.test", href: "https://halo.test/obsidian/?song=beta" };
const saved = new Map();
let resets = 0, selection;
const window = {
  location,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
  crypto: { randomUUID: () => "playlist-1" },
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
releases[0].genres = ["Deep House"];
releases[1].genres = ["Ambient"];
releases[0].availableVersions = ["Instrumental", "Stems"];
releases[1].availableVersions = ["Radio Edit"];
releases[0].pitch = "<b>Artist-supplied description</b>";
assert.deepEqual(releaseCategories({ genres: [" Deep   House ", "deep house", null, 2, "Soulful House"] }), [
  { key: "deep house", label: "Deep House" }, { key: "soulful house", label: "Soulful House" }
]);
assert.deepEqual(releaseCategories({ genres: [], catalog: { genre: "Deep House, Afro House" } }).map(category => category.key), ["deep house", "afro house"]);
assert.deepEqual(releaseCategories({ genres: null, catalog: { genre: null } }), []);
assert.deepEqual(releaseCategories({ genres: ["AFRO BEATS", "Afrobeat", "AfroBeats", "Afrobeats House,", "Afrobeats House,DJ MIX"] }), [
  { key: "afrobeats", label: "Afrobeats" },
  { key: "afrobeats house", label: "Afrobeats House" },
  { key: "dj mix", label: "DJ Mix" }
]);
const gateway = createGateway({ document, window, fetcher: () => reply() });
nodes.newPlaylistName.value = "   ";
nodes.createPlaylistForm.events.submit({ preventDefault() {} });
assert.match(nodes.playlistStatus.textContent, /between 1 and 80/);
assert.equal(gateway.state.playlists.length, 0, "empty names show inline feedback instead of an inert native submit");
await gateway.load();
assert.equal(gateway.state.releases.length, 2);
assert.equal(nodes.selectedTitle.textContent, "Beta");
assert.equal(nodes.destination.hidden, true, "unsafe destination must not be linked");
assert.equal(nodes.audio.hidden, true);
assert.deepEqual(nodes.quickFilters.children.map(button => button.textContent), ["All Releases (2)", "In-page audio (1)"]);
assert.deepEqual(nodes.genreFilters.children.map(button => button.textContent), ["Ambient (1)", "Deep House (1)"]);
assert.deepEqual(nodes.versionFilters.children.map(button => button.textContent), ["Instrumental (1)", "Radio Edit (1)", "Stems (1)"]);
assert.equal(nodes.genreFilterSummary.textContent, "Genres (2)");
assert.equal(nodes.versionFilterSummary.textContent, "Versions (3)");
assert.equal(nodes.genreFilterSummary.textContent.includes("Deep House"), false);
const filterButton = id => [...nodes.quickFilters.children, ...nodes.genreFilters.children, ...nodes.versionFilters.children].find(button => button.dataset.filter === id);
assert.equal(nodes.loop.disabled, true);
assert.match(nodes.status.textContent, /unavailable/);
assert.match(nodes.lyricsStatus.textContent, /not timestamped/);
assert.equal(selection(), "beta");
nodes.next.events.click();
assert.equal(nodes.selectedTitle.textContent, "<img onerror=alert(1)>", "title rendered as literal text");
assert.equal(nodes.audio.src, "/audio.mp3");
nodes.newPlaylistName.value = "Late Night";
nodes.createPlaylistForm.events.submit({ preventDefault() {} });
assert.equal(nodes.userPlaylists.children.length, 1);
assert.match(nodes.playlistStatus.textContent, /Created “Late Night”/);
assert.equal(nodes.addToPlaylist.value, "playlist-1", "new playlist is selected automatically");
gateway.select(1);
assert.equal(nodes.addToPlaylist.value, "playlist-1", "changing songs preserves the selected playlist");
gateway.select(0);
nodes.addToPlaylist.value = "playlist-1";
nodes.addToPlaylistButton.events.click();
assert.deepEqual(JSON.parse(saved.get("halo_obsidian_playlists_v1"))[0].releaseIds, ["alpha"]);
assert.equal(nodes.userPlaylists.children[0].children[3].children.length, 1);
nodes.addToPlaylist.value = "playlist-1";
nodes.addToPlaylistButton.events.click();
assert.match(nodes.playlistStatus.textContent, /already in this playlist/);
assert.equal(nodes.playlistPlayerStatus.textContent, nodes.playlistStatus.textContent, "feedback appears beside the player as well as the playlist hub");
nodes.userPlaylists.children[0].children[3].children[0].children[1].events.click();
assert.deepEqual(JSON.parse(saved.get("halo_obsidian_playlists_v1"))[0].releaseIds, []);
nodes.addToPlaylist.value = "playlist-1";
nodes.addToPlaylistButton.events.click();
assert.deepEqual(JSON.parse(saved.get("halo_obsidian_playlists_v1"))[0].releaseIds, ["alpha"]);
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
assert.equal(nodes.tracks.children[0]["active-playing"], true, "only actual playback animates a card");
const beforeFilter = nodes.audio.src;
filterButton("genre:ambient").events.click();
assert.equal(nodes.tracks.children.length, 1, "genre filters use catalog metadata");
assert.equal(nodes.tracks.children[0].children[1].children[0].textContent, "Beta");
assert.equal(nodes.audio.src, beforeFilter, "filter changes do not replace the playing source");
assert.equal(nodes.pulse.playing, true, "filter changes do not stop playback");
filterButton("playable").events.click();
assert.equal(nodes.tracks.children.length, 1, "playable filter excludes link-only releases");
assert.equal(nodes.tracks.children[0]["active-playing"], true);
filterButton("all").events.click();
filterButton("version:stems").events.click();
assert.equal(nodes.versionFilterSummary.textContent, "Versions (3) · Stems");
assert.equal(nodes.tracks.children.length, 1, "all supplied version categories get a working filter");
assert.equal(nodes.tracks.children[0].children[1].children[2].children[0].textContent, "Deep House");
assert.equal(nodes.tracks.children[0].children[1].children[5].textContent, "<b>Artist-supplied description</b>", "pitch uses literal text");
assert.equal(nodes.audio.src, beforeFilter, "version filtering does not change the audio");
filterButton("all").events.click();
nodes.audio.events.waiting();
assert.equal(nodes.pulse.playing, false);
assert.equal(nodes.tracks.children[0]["active-playing"], false);
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
gateway.state.releases[1].streamUrl = "/beta.mp3";
gateway.select(1);
nodes.addToPlaylistButton.events.click();
gateway.select(0);
const beforePlaylistPlay = nodes.audio.played;
assert.equal(nodes.userPlaylists.children[0].children[2].children[0].textContent, "Play mix");
await nodes.userPlaylists.children[0].children[2].children[0].events.click();
assert.equal(gateway.state.queue.playlistId, "playlist-1");
assert.equal(nodes.selectedTitle.textContent, releases[0].title);
assert.equal(nodes.audio.played, beforePlaylistPlay + 1, "explicit Play mix starts the selected release");
assert.match(nodes.playlistStatus.textContent, /is playing/);
assert.equal(nodes.audio.scrolled, true, "Play mix brings the audio player into view");
assert.equal(nodes.audio.focused, true, "Play mix focuses native controls");
assert.equal(nodes.next.disabled, false, "playlist navigation sees the next playable release");
nodes.audio.events.ended();
assert.equal(gateway.state.index, 1, "ending a track continues to the next release in the playlist");
assert.equal(nodes.audio.played, beforePlaylistPlay + 2, "continuation starts the next playlist release");
const normalPlay = nodes.audio.play;
nodes.audio.play = () => Promise.reject(new Error("blocked"));
const originalPlaybackError = console.error;
console.error = () => {};
try {
  await nodes.userPlaylists.children[0].children[2].children[0].events.click();
  assert.match(nodes.playlistStatus.textContent, /playback could not start/);
  assert.match(nodes.status.textContent, /Press play to retry/);
} finally {
  nodes.audio.play = normalPlay;
  console.error = originalPlaybackError;
}
nodes.audio.events.ended();
assert.equal(gateway.state.index, 1, "continuation remains in the selected playlist");
nodes.userPlaylists.children[0].children[2].children[1].events.click();
assert.equal(gateway.state.playlists.length, 0, "deleting a playlist persists its removal");
assert.equal(gateway.state.queue, null, "deleting the active playlist clears its queue");
gateway.state.releases[1].streamUrl = "";
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
reply = async () => Response.json({ releases: [releases[1]] });
location.href = "https://halo.test/obsidian/?song=beta";
await gateway.load();
const playableFilter = filterButton("playable");
playableFilter.events.click();
assert.equal(nodes.tracks.children.length, 0);
assert.match(nodes.gridStatus.textContent, /No releases match/);
assert.equal(filterButton("playable"), playableFilter, "filter controls remain stable for keyboard focus");
assert.equal(nodes.selectedTitle.textContent, "Beta", "an empty filter does not change the selected release");
reply = async () => Response.json({}, { status: 503 });
location.href = "https://halo.test/obsidian/?song=alpha";
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
location.href = "https://halo.test/obsidian/";
reply = async () => Response.json({ releases: [
  { ...releases[0], genres: [" Deep House ", "deep house", "Soulful House"] },
  { ...releases[1], genres: [], catalog: { genre: "Deep House, Afro House" } },
  { id: "afro-beats", status: "published", title: "Afro beats", genres: ["AFRO BEATS", "AfroBeats", "Afrobeats House,", "Afrobeats House,DJ MIX"] },
  { id: "afrobeat", status: "published", title: "Afrobeat", genres: ["Afrobeat"] },
  { id: "uncategorized", status: "published", title: "No genre" }
] });
await gateway.load();
const findFilter = (group, label) => group.children.find(button => button.dataset.label === label);
assert.deepEqual(nodes.genreFilters.children.map(button => button.textContent), [
  "Afrobeats (2)", "Deep House (2)", "Afro House (1)", "Afrobeats House (1)",
  "DJ Mix (1)", "Soulful House (1)", "Genre not supplied (1)"
], "genres are consolidated and ordered by release count, then alphabetically");
findFilter(nodes.genreFilters, "Afro House").events.click();
assert.equal(nodes.tracks.children.length, 1, "catalog.genre is used when top-level genres are empty");
assert.equal(nodes.tracks.children[0].children[1].children[0].textContent, "Beta");
findFilter(nodes.genreFilters, "Genre not supplied").events.click();
assert.equal(nodes.tracks.children[0].children[1].children[0].textContent, "No genre");
assert.equal(nodes.genreFilterSummary.textContent, "Genres (7) · Genre not supplied");
findFilter(nodes.genreFilters, "Soulful House").events.click();
assert.equal(nodes.tracks.children.length, 1);
filterButton("all").events.click();
assert.equal(nodes.tracks.children.length, 5, "no uncategorized public release disappears");
assert.throws(() => eligibleReleases({}), /invalid/);
for (const value of ["javascript:alert(1)", "https://user:pass@evil.test/", "", "//user@evil.test"]) assert.equal(safeDestination(value, location.origin), "");
assert.equal(safeDestination("/music/", location.origin), "https://halo.test/music/");
const [page, css, client] = await Promise.all(["obsidian/index.html", "obsidian/obsidian.css", "obsidian/obsidian.js"].map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
assert.match(page, /<audio id="audio" controls preload="none"/);
assert.match(page, /id="loadNote" hidden/);
assert.match(page, /<details class="lyrics"/);
assert.match(page, /<details class="vault-filter-group" id="genreFilterGroup">/);
assert.match(page, /<details class="vault-filter-group" id="versionFilterGroup">/);
assert.doesNotMatch(page, /<details class="vault-filter-group" id="(?:genre|version)FilterGroup" open/);
assert.match(page, /No public SHA-256 verification evidence/);
assert.match(css, /#tracks \.track\.active-playing\{animation:none/);
assert.match(page, /not measured audio frequencies/);
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(page, /id="createPlaylistForm"/);
assert.match(page, /Playlists are not uploaded or shared between devices/);
assert.doesNotMatch(client, /innerHTML|private.key|SECRET/);
console.log("Obsidian gateway contracts passed: public catalog, audio state, navigation, playlists, links and failures.");
