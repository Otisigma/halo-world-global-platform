import assert from "node:assert/strict";
import { createArtScreen } from "../lib/halo-art-screen.js";

class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.classList = { add: name => { this[name] = true; }, toggle: (name, value) => { this[name] = value; } };
  }
  append(child) { this.children.push(child); }
  setAttribute(name, value) { this[name] = value; }
}
const document = { createElement: () => new Element() };
const frame = new Element();
const screen = createArtScreen(frame, document);
const overlay = frame.children[0];
const lyrics = "[00:02] <First>\n[00:04] Second";
screen.update({ lyricsText: lyrics, time: 1, playing: true });
assert.equal(overlay.hidden, true, "never reveal the first lyric before its timestamp");
screen.update({ lyricsText: lyrics, time: 2, playing: true });
assert.equal(overlay.textContent, "<First>", "lyrics are rendered as text, not markup");
assert.equal(overlay.hidden, false);
assert.equal(frame["halo-art-playing"], true);
screen.update({ lyricsText: lyrics, time: 4, playing: true });
assert.equal(overlay.textContent, "Second");
screen.update({ lyricsText: lyrics, time: 2, playing: true });
assert.equal(overlay.textContent, "<First>", "seeking backward updates the lyric");
screen.update({ lyricsText: lyrics, time: 4, playing: false });
assert.equal(overlay.hidden, true);
screen.update({ lyricsText: "Untimed line", time: 4, playing: true });
assert.equal(overlay.hidden, true, "untimed lyrics cannot be presented as synchronized");
screen.update({ lyricsText: "", playing: true });
assert.equal(overlay.hidden, true, "do not invent lyrics or master claims");
console.log("Shared artwork screen contracts passed: timed lyrics, seeks, pause, plain text and absent metadata.");
