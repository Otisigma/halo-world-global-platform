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
assert.equal(overlay.textContent, "Lyrics · not synchronized\nUntimed line");
assert.equal(overlay.hidden, false);
const plain = "[Verse]\nFirst plain line\nSecond plain line\nThird plain line";
screen.update({ lyricsText: plain, time: 0, playing: true });
assert.equal(overlay.textContent, "Lyrics · not synchronized\nFirst plain line");
screen.update({ lyricsText: plain, time: 4.49, playing: true });
assert.equal(overlay.textContent, "Lyrics · not synchronized\nFirst plain line");
screen.update({ lyricsText: plain, time: 4.5, playing: true });
assert.equal(overlay.textContent, "Lyrics · not synchronized\nSecond plain line");
screen.update({ lyricsText: plain, time: 9, playing: true });
assert.equal(overlay.textContent, "Lyrics · not synchronized\nThird plain line");
screen.update({ lyricsText: plain, time: 13.5, playing: true });
assert.equal(overlay.textContent, "Lyrics · not synchronized\nFirst plain line", "lyrics loop without duration metadata");
screen.update({ lyricsText: plain, time: 4.5, playing: false });
assert.equal(overlay.hidden, true);
screen.update({ lyricsText: plain, time: 4.5, playing: true });
assert.equal(overlay.textContent, "Lyrics · not synchronized\nSecond plain line", "resume follows playback position");
screen.update({ lyricsText: "[Verse]", time: 0, playing: true });
assert.equal(overlay.hidden, true, "section headings alone are not lyrics");
screen.update({ lyricsText: "[00:05] Timed\nUntimed", time: 0, playing: true });
assert.equal(overlay.hidden, true, "partial timestamps do not falsely present guessed synchronization");
screen.update({ lyricsText: "", playing: true });
assert.equal(overlay.hidden, true, "do not invent lyrics or master claims");
const motion = { matches: true };
const reducedFrame = new Element();
const reduced = createArtScreen(reducedFrame, { ...document, defaultView: { matchMedia: () => motion } });
reduced.update({ lyricsText: plain, time: 10, playing: true });
assert.equal(reducedFrame.children[0].textContent, "Lyrics · not synchronized\nFirst plain line");
motion.matches = false;
reduced.update({ lyricsText: plain, time: 10, playing: true });
assert.equal(reducedFrame.children[0].textContent, "Lyrics · not synchronized\nThird plain line");
console.log("Shared artwork screen contracts passed: timed and unsynchronized lyrics, seeks, pause, reduced motion and missing metadata.");
