import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYLIST_STORAGE_KEY, readPlaylists, writePlaylists, playlistName, publicPlaylistReleases,
  movePlaylistRelease, curatorMilestone, albumInspiration, createPlaylistQueue
} from "../lib/personal-playlists.js";
import { mountPlaylistInspiration } from "../album-concierge/playlist-inspiration.js";
import { createPlaylistStudio } from "../music/playlist-studio.js";

const releases = [
  { id: "one", title: "<First>", artist: "A", status: "published", src: "/one.mp3" },
  { id: "link", title: "Link only", artist: "B", status: "passed" },
  { id: "two", title: "Second", artist: "B", status: "published", src: "/two.mp3" },
  { id: "hidden", title: "Hidden", artist: "C", status: "published", isLiveVisible: false, src: "/hidden.mp3" },
  { id: "draft", title: "Draft", status: "draft", src: "/draft.mp3" }
];
const playlist = { id: "journey", name: "Night drive", releaseIds: ["one", "link", "two", "hidden", "draft", "removed"] };
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test("named playlists preserve the Obsidian format and report invalid storage", () => {
  const storage = memory();
  assert.deepEqual(readPlaylists(storage), []);
  writePlaylists(storage, [playlist]);
  assert.deepEqual(readPlaylists(storage), [playlist]);
  assert.equal(playlistName("  Dream state  ", []), "Dream state");
  for (const name of ["   ", "a".repeat(81), "NIGHT DRIVE"]) {
    assert.throws(() => playlistName(name, [playlist]), /name/);
  }
  assert.equal(playlistName("Night drive", [playlist], playlist.id), "Night drive");
  storage.setItem(PLAYLIST_STORAGE_KEY, '{"releaseIds":[]}');
  assert.throws(() => readPlaylists(storage), /invalid format/);
  storage.setItem(PLAYLIST_STORAGE_KEY, "[broken");
  assert.throws(() => readPlaylists(storage), SyntaxError);
  assert.throws(() => writePlaylists({ setItem() { throw new Error("Quota exceeded"); } }, [playlist]), /Quota/);
});

test("reordering retains unavailable IDs; milestones use only distinct public releases", () => {
  const moved = movePlaylistRelease(playlist, "two", -1);
  assert.deepEqual(moved.releaseIds, ["one", "two", "link", "hidden", "draft", "removed"]);
  assert.deepEqual(playlist.releaseIds, ["one", "link", "two", "hidden", "draft", "removed"]);
  assert.throws(() => movePlaylistRelease(playlist, "one", -1), /cannot move/);
  assert.throws(() => movePlaylistRelease(playlist, "missing", 1), /cannot move/);
  const available = publicPlaylistReleases({ releaseIds: [...playlist.releaseIds, "one"] }, releases);
  assert.deepEqual(available.map(item => item.id), ["one", "link", "two"]);
  assert.match(curatorMilestone(available), /Level 1/);
  const many = Array.from({ length: 10 }, (_, index) => ({ artist: String(index % 3) }));
  assert.match(curatorMilestone(many.slice(0, 4)), /Level 1/);
  assert.match(curatorMilestone(many.slice(0, 5)), /Level 2/);
  assert.match(curatorMilestone(many), /Level 3/);
  assert.match(curatorMilestone(many.map(() => ({ artist: "A" }))), /Level 2/);
});

test("playlist playback skips unavailable audio, respects order, repeat and competing selections", () => {
  let current = playlist, repeat = false, starts = 0;
  const messages = [], played = [], handlers = {};
  const player = {
    audio: { currentTime: 20, addEventListener: (name, fn) => { handlers[name] = fn; } },
    track: null, status: "paused",
    play(track) { this.track = track; this.status = "playing"; played.push(track.id); }
  };
  const queue = createPlaylistQueue({
    player, getPlaylist: id => current?.id === id ? current : null, getReleases: () => releases,
    trackFor: release => ({ ...release, src: release.src || "" }),
    repeat: () => repeat, report: message => messages.push(message), onStart: () => { starts++; }
  });
  assert.equal(played.length, 0, "mount never starts audio");
  assert.equal(queue.start("journey"), true);
  assert.deepEqual(played, ["one"]);
  assert.equal(starts, 1);
  queue.start("journey");
  assert.deepEqual(played, ["one"], "starting an already playing first song must not pause it");
  handlers.ended();
  assert.deepEqual(played, ["one", "two"]);
  handlers.ended();
  assert.equal(queue.activeId, "", "default playback finishes rather than trapping the listener");
  assert.match(messages.at(-1), /Finished/);
  repeat = true;
  queue.start("journey");
  handlers.ended();
  handlers.ended();
  assert.equal(played.at(-1), "one");
  queue.stop();
  const before = played.length;
  handlers.ended();
  assert.equal(played.length, before);
  queue.start("journey");
  player.track = { id: "other" };
  handlers.ended();
  assert.equal(queue.activeId, "", "another source cannot be hijacked");
  current = { ...playlist, releaseIds: ["hidden", "draft", "link"] };
  assert.equal(queue.start("journey"), false);
  assert.match(messages.at(-1), /no songs/);
  current = { ...playlist, releaseIds: ["one"] };
  queue.start("journey");
  player.audio.currentTime = 80;
  player.status = "paused";
  handlers.ended();
  assert.equal(player.audio.currentTime, 0, "a one-song repeating playlist rewinds");
  current = null;
  handlers.ended();
  assert.equal(queue.activeId, "", "deleting an active playlist stops continuation");
});

test("album inspiration uses fresh public metadata and requires explicit import", async () => {
  let imported = 0, fetched = 0;
  const storage = memory();
  writePlaylists(storage, [playlist]);
  const status = { textContent: "" }, button = { addEventListener(_name, fn) { this.click = fn; } };
  const story = { value: "My existing story.", dispatchEvent() { imported++; } };
  const root = { hidden: true, querySelector: selector => selector === "[data-import-playlist]" ? button : status };
  mountPlaylistInspiration({
    document: { getElementById: id => id === "playlistInspiration" ? root : story },
    window: { location: { href: "https://halo.test/album-concierge/?playlist=journey" }, localStorage: storage, Event },
    fetcher: async () => { fetched++; return Response.json({ releases }); }
  });
  assert.equal(fetched, 0);
  assert.equal(imported, 0);
  await button.click();
  assert.equal(fetched, 1);
  assert.equal(imported, 1);
  assert.match(story.value, /^My existing story\./);
  assert.match(story.value, /1\. <First> - A/);
  assert.match(story.value, /2\. Link only - B/);
  assert.doesNotMatch(story.value, /Hidden|Draft|\/one.mp3/);
  assert.match(story.value, /do not grant remix/);
  assert.equal(button.disabled, true, "successful import cannot append itself repeatedly");
  assert.throws(() => albumInspiration({ ...playlist, releaseIds: ["hidden"] }, releases), /no currently available/);
  assert.throws(() => albumInspiration(playlist, releases.map(release => ({ ...release, title: "a".repeat(4000) }))), /too long/);
});

test("album import failures preserve the user's story and allow retry", async () => {
  const status = {}, button = { addEventListener(_name, fn) { this.click = fn; } };
  const story = { value: "Keep me", dispatchEvent() { assert.fail("failed import changed the story"); } };
  mountPlaylistInspiration({
    document: { getElementById: id => id === "playlistInspiration"
      ? { querySelector: selector => selector === "[data-import-playlist]" ? button : status } : story },
    window: { location: { href: "https://halo.test/album-concierge/?playlist=missing" }, localStorage: memory() },
    fetcher: () => { assert.fail("a missing browser playlist must not fetch"); }
  });
  await button.click();
  assert.equal(story.value, "Keep me");
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /not saved in this browser/);
});

class TestNode {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase();
    this.document = document;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.events = {};
    this.value = "";
  }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  emit(type) { for (const fn of this.events[type] || []) fn({ target: this, currentTarget: this, preventDefault() {} }); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    else this[name] = value;
  }
  matches(selector) {
    if (selector.includes(",")) return selector.split(/,\s*/).some(part => this.matches(part));
    if (selector.startsWith(".")) return this.className?.split(" ").includes(selector.slice(1));
    const attribute = selector.match(/^(.*?)\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) return (!attribute[1] || this.tagName === attribute[1].toUpperCase())
      && (attribute[3] === undefined ? attribute[2] in this.attributes : this[attribute[2]] === attribute[3]);
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(selector.split(/,\s*/).some(part => child.matches(part)) ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  focus() { this.document.activeElement = this; }
  get isConnected() { return this === this.document.body || Boolean(this.parent?.isConnected); }
  get elements() { return Object.fromEntries(this.querySelectorAll("input, select").map(node => [node.name, node])); }
  reset() { for (const node of this.querySelectorAll("input, select")) node.value = ""; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
  set innerHTML(html) {
    this.children = [];
    const stack = [this];
    for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
      if (match[0].startsWith("</")) { stack.pop(); continue; }
      const node = new TestNode(match[1], this.document);
      for (const attribute of match[2].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/gi)) node.setAttribute(attribute[1], attribute[2] ?? "");
      stack.at(-1).append(node);
      if (!["INPUT", "BR", "IMG"].includes(node.tagName) && !match[0].endsWith("/>")) stack.push(node);
    }
  }
}

function studioFixture(storage = memory()) {
  const document = { createElement: tag => new TestNode(tag, document), events: {} };
  document.body = document.createElement("body");
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.addEventListener = (name, fn) => { (document.events[name] ||= []).push(fn); };
  const root = document.createElement("section"), plus = document.createElement("button");
  plus.setAttribute("data-add-playlist", "one");
  document.body.append(root, plus);
  const windowEvents = {};
  let sequence = 0;
  const window = {
    location: { href: "https://halo.test/music/", origin: "https://halo.test" },
    localStorage: storage, crypto: { randomUUID: () => `studio-${++sequence}` },
    CustomEvent, addEventListener(name, fn) { (windowEvents[name] ||= []).push(fn); },
    dispatchEvent(event) { for (const fn of windowEvents[event.type] || []) fn(event); }
  };
  const played = [];
  const player = { audio: { addEventListener() {} }, play(track) { played.push(track.id); } };
  const studio = createPlaylistStudio({
    document, window, root, getReleases: () => releases, player,
    trackFor: release => ({ ...release, src: release.src || "" })
  });
  return { document, window, root, plus, storage, studio, played };
}

test("song plus creates a named playlist, rejects duplicates and restores focus on close", () => {
  const fixture = studioFixture();
  const { root, plus, storage, studio, document, played } = fixture;
  const form = root.querySelector("[data-save-song]"), dialog = root.querySelector("dialog");
  studio.open("one", plus);
  assert.equal(dialog.open, true);
  assert.equal(document.activeElement, form.elements.name);
  form.elements.name.value = "  Dream world  ";
  form.emit("submit");
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, plus);
  assert.deepEqual(readPlaylists(storage), [{ id: "studio-1", name: "Dream world", releaseIds: ["one"] }]);
  assert.deepEqual(played, [], "saving a song must not interrupt or start playback");
  studio.open("one", plus);
  assert.equal(form.elements.playlist.value, "studio-1");
  assert.equal(form.elements.name.required, false);
  form.emit("submit");
  assert.equal(dialog.open, true, "duplicates keep the picker open with feedback");
  assert.match(root.querySelector("[data-dialog-status]").textContent, /already in/);
  assert.deepEqual(readPlaylists(storage)[0].releaseIds, ["one"]);
  root.querySelector("[data-close-playlist]").emit("click");
  assert.equal(document.activeElement, plus);
});

test("playlist management persists rename, order, removals and deletion", () => {
  const storage = memory();
  writePlaylists(storage, [{ ...playlist, releaseIds: ["one", "two", "hidden"] }]);
  const { root, studio, played, document } = studioFixture(storage);
  let world = root.querySelector(".playlist-world");
  const rename = world.querySelector("form");
  rename.querySelector("input").value = "New journey";
  rename.emit("submit");
  assert.equal(readPlaylists(storage)[0].name, "New journey");
  world = root.querySelector(".playlist-world");
  const second = world.querySelectorAll("li")[1];
  second.querySelector("button").focus();
  second.querySelector("button").emit("click");
  assert.deepEqual(readPlaylists(storage)[0].releaseIds, ["two", "one", "hidden"]);
  assert.ok(document.activeElement.isConnected, "reordering retains a connected keyboard focus target");
  world = root.querySelector(".playlist-world");
  assert.match(world.querySelectorAll("li")[2].children[0].textContent, /unavailable/);
  world.querySelectorAll("li")[2].querySelectorAll("button")[2].emit("click");
  assert.deepEqual(readPlaylists(storage)[0].releaseIds, ["two", "one"]);
  studio.render();
  world = root.querySelector(".playlist-world");
  world.querySelector(".playlist-world-actions").querySelector("button").emit("click");
  assert.deepEqual(played, ["two"], "play starts at the user-reordered first preview");
  world.querySelector(".playlist-world-actions").querySelectorAll("button")[1].emit("click");
  assert.deepEqual(readPlaylists(storage), []);
  assert.equal(studio.queue.activeId, "");
});

test("blocked storage disables saving and does not pretend to add the song", () => {
  const storage = { getItem() { throw new Error("Storage blocked"); }, setItem() { assert.fail("blocked storage must not be overwritten"); } };
  const { root, studio, plus } = studioFixture(storage);
  assert.equal(plus.disabled, true);
  assert.equal(root.querySelector("[data-create-playlist]").querySelector("button").disabled, true);
  assert.match(root.querySelector("[data-playlist-status]").textContent, /could not be accessed/);
  studio.open("one", plus);
  assert.notEqual(root.querySelector("dialog").open, true);
});

test("quota failures leave the picker open and keep the saved playlist unchanged", () => {
  const storage = memory();
  storage.setItem = () => { throw new Error("Quota exceeded"); };
  const { root, studio, plus } = studioFixture(storage);
  studio.open("one", plus);
  const form = root.querySelector("[data-save-song]");
  form.elements.name.value = "Do not pretend";
  form.emit("submit");
  assert.equal(root.querySelector("dialog").open, true);
  assert.match(root.querySelector("[data-dialog-status]").textContent, /Could not save/);
  assert.deepEqual(readPlaylists(storage), []);
});

test("personal playback yields to chart and discovery queues and other-tab deletion", () => {
  const storage = memory();
  writePlaylists(storage, [playlist]);
  const { studio, window } = studioFixture(storage);
  studio.queue.start("journey");
  window.dispatchEvent(new CustomEvent("halo:chart-queue-start"));
  assert.equal(studio.queue.activeId, "");
  studio.queue.start("journey");
  window.dispatchEvent(new CustomEvent("halo:discovery-queue-start"));
  assert.equal(studio.queue.activeId, "");
  studio.queue.start("journey");
  writePlaylists(storage, []);
  studio.render();
  assert.equal(studio.queue.activeId, "");
});
