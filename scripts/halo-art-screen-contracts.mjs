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
  addEventListener(name, callback) { this[name] = callback; }
}
const buttons = [];
const document = {
  createElement: () => { const element = new Element(); buttons.push(element); return element; },
  createElementNS: () => new Element(),
  querySelectorAll: () => buttons.filter(element => element.className === "halo-art-lyrics-toggle")
};
const frame = new Element();
const screen = createArtScreen(frame, document);
const overlay = frame.children[0];
const lyrics = "[00:02] <First>\n[00:04] Second";
screen.update({ lyricsText: lyrics, time: 1, playing: true });
assert.equal(overlay.hidden, true, "never reveal the first lyric before its timestamp");
screen.update({ lyricsText: lyrics, time: 2, duration: 60, playing: true });
assert.equal(overlay.textContent, "<First>", "lyrics are rendered as text, not markup");
assert.equal(overlay.hidden, false);
assert.equal(frame["halo-art-playing"], true);
const toggle = frame.children[2];
assert.equal(toggle["aria-pressed"], "true");
toggle.click({ stopPropagation() {} });
assert.equal(toggle["aria-pressed"], "false");
assert.equal(overlay.hidden, true, "turning lyrics off hides the active lyric immediately");
assert.equal(frame.children[1].style.display, "none", "turning lyrics off also hides the SVG vignette");
const otherFrame = new Element();
const otherScreen = createArtScreen(otherFrame, document);
otherScreen.update({ lyricsText: lyrics, time: 2, playing: true });
assert.equal(otherFrame.children[2]["aria-pressed"], "false", "new cards retain the page preference");
assert.equal(otherFrame.children[0].hidden, true);
otherFrame.children[2].click({ stopPropagation() {} });
assert.equal(toggle["aria-pressed"], "true", "changing one control updates existing cards");
assert.equal(overlay.hidden, false);
assert.equal(frame.children[1].style.display, "");
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
screen.update({ lyricsText: plain, time: 0, duration: 60, playing: true });
assert.equal(overlay.textContent, "Lyrics · estimated, not synchronized\nFirst plain line");
screen.update({ lyricsText: plain, time: 20, duration: 60, playing: true });
assert.equal(overlay.textContent, "Lyrics · estimated, not synchronized\nSecond plain line");
screen.update({ lyricsText: plain, time: 40, duration: 60, playing: true });
assert.equal(overlay.textContent, "Lyrics · estimated, not synchronized\nThird plain line");
screen.update({ lyricsText: plain, time: 59.9, duration: 60, playing: true });
assert.equal(overlay.textContent, "Lyrics · estimated, not synchronized\nThird plain line");
screen.update({ lyricsText: plain, time: 60, duration: 60, playing: true });
assert.equal(overlay.textContent, "Lyrics · estimated, not synchronized\nThird plain line", "the final lyric remains visible at track end");
screen.update({ lyricsText: plain, time: 20, duration: 60, playing: true });
assert.equal(overlay.textContent, "Lyrics · estimated, not synchronized\nSecond plain line", "seeking recalculates proportional lyric progress");
screen.update({ lyricsText: plain, time: 9, duration: 0, playing: true });
assert.equal(overlay.textContent, "Lyrics · not synchronized\nThird plain line", "missing duration retains rolling fallback");
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
const compactFrame = new Element();
createArtScreen(compactFrame, document, { toggle: false }).update({ playing: true });
assert.equal(compactFrame.children.length, 1, "compact play buttons do not contain nested buttons");
console.log("Shared artwork screen contracts passed: timed and unsynchronized lyrics, seeks, pause, reduced motion and missing metadata.");
