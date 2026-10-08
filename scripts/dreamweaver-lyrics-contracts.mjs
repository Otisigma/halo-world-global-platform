import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LYRICS_MAX_LINES,
  LYRICS_MAX_SOURCE_LENGTH,
  LYRIC_INSTRUMENTAL_MARK,
  createDreamweaverLyricsEngine,
  findActiveLyricIndex,
  formatLyricTimestamp,
  normalizeLyricsSource,
  parseLyricTimestamp,
  parseTimestampedLyrics,
  summarizeLyrics
} from "../lib/dreamweaver-lyrics.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
let checks = 0;
const check = (fn, label) => {
  try {
    fn();
    checks += 1;
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
};

class FakeElement extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.id = "";
    this.type = "";
    this.text = "";
    this.classes = new Set();
    this.scrolls = [];
    this.offsetTop = 0;
    this.offsetHeight = 40;
    this.clientHeight = 400;
    const classes = this.classes;
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      }
    };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => this.classes.add(name)); }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join("") : this.text; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get innerHTML() { throw new Error("innerHTML must not be read by the lyrics engine"); }
  set innerHTML(_value) { throw new Error("innerHTML must not be written by the lyrics engine"); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  replaceChildren(...nodes) { this.children = []; nodes.forEach(node => this.appendChild(node)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  scrollTo(options) { this.scrolls.push(options); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
}

function createFixture(source, { reducedMotion = false, duration = 240 } = {}) {
  const doc = { createElement: tag => new FakeElement(tag, doc) };
  const root = doc.createElement("section");
  const viewport = doc.createElement("div");
  const list = doc.createElement("ol");
  const modeToggle = doc.createElement("button");
  const status = doc.createElement("p");
  const audio = new EventTarget();
  audio.currentTime = 0;
  audio.duration = duration;
  audio.paused = true;
  const seeks = [];
  const win = { matchMedia: query => ({ matches: reducedMotion && query.includes("reduced-motion") }) };
  const engine = createDreamweaverLyricsEngine({ root, list, viewport, audio, modeToggle, status, doc, win, idPrefix: "lyric", onSeek: (time, line) => seeks.push({ time, text: line.text }) });
  engine.setSource(source);
  const rows = () => list.children;
  const lineOf = item => item.children[0];
  const tick = time => { audio.currentTime = time; audio.dispatchEvent(new Event("timeupdate")); };
  return { doc, root, viewport, list, modeToggle, status, audio, engine, seeks, rows, lineOf, tick };
}

const SONG = [
  "[ti:The Cold Is Lasting Longer]",
  "[Verse 1]",
  "[00:05] The room goes quiet || Written the night after the last show.",
  "[00:10.50] Every light still hums your name",
  "",
  "[00:20][01:00] Stay with the light",
  "[00:40]",
  "A whispered line with no timestamp"
].join("\n");

// --- Lyric parsing -------------------------------------------------------
check(() => {
  assert.equal(parseLyricTimestamp("01:15"), 75);
  assert.equal(parseLyricTimestamp("1:15.5"), 75.5);
  assert.equal(parseLyricTimestamp("00:10,25"), 10.25);
  assert.equal(parseLyricTimestamp("1:02:03"), 3723);
  assert.equal(parseLyricTimestamp("00:75"), null);
  assert.equal(parseLyricTimestamp("1:75:00"), null);
  assert.equal(parseLyricTimestamp("chorus"), null);
  assert.equal(formatLyricTimestamp(75), "1:15");
  assert.equal(formatLyricTimestamp(3723), "1:02:03");
}, "parses mm:ss, fractional and h:mm:ss timestamps and rejects invalid ones");

check(() => {
  const parsed = parseTimestampedLyrics(SONG);
  assert.deepEqual(parsed.lines.map(line => [line.time, line.text, line.kind]), [
    [null, "Verse 1", "section"],
    [5, "The room goes quiet", "lyric"],
    [10.5, "Every light still hums your name", "lyric"],
    [20, "Stay with the light", "lyric"],
    [40, LYRIC_INSTRUMENTAL_MARK, "instrumental"],
    [null, "A whispered line with no timestamp", "lyric"],
    [60, "Stay with the light", "lyric"]
  ]);
  assert.equal(parsed.lines[5].time, null, "untimed lines stay beside the line written before them");
  assert.equal(parsed.lines[1].insight, "Written the night after the last show.");
  assert.equal(parsed.lines[3].stanzaStart, true, "blank lines start a new stanza");
  assert.equal(parsed.timed, true);
  assert.equal(parsed.timedCount, 5);
  assert.equal(parsed.untimedCount, 2);
  assert.equal(parsed.insightCount, 1);
  assert.deepEqual(parsed.lines.map(line => line.index), [0, 1, 2, 3, 4, 5, 6]);
}, "parses timestamped lyrics, LRC metadata, sections, repeated stamps, instrumental gaps and Oracle insights");

check(() => {
  assert.deepEqual(parseTimestampedLyrics(null).lines, []);
  assert.deepEqual(parseTimestampedLyrics("").lines, []);
  assert.equal(parseTimestampedLyrics("Just words\nMore words").timed, false);
  assert.equal(normalizeLyricsSource("a\r\nb\u0000\u202E\u0007c\n\n\n\nd"), "a\nbc\n\nd");
  assert.equal(normalizeLyricsSource("x".repeat(LYRICS_MAX_SOURCE_LENGTH + 50)).length, LYRICS_MAX_SOURCE_LENGTH);
  const many = Array.from({ length: LYRICS_MAX_LINES + 25 }, (_, index) => `[00:${String(index % 60).padStart(2, "0")}] line ${index}`).join("\n");
  assert.equal(parseTimestampedLyrics(many).lines.length, LYRICS_MAX_LINES);
  assert.equal(parseTimestampedLyrics("[99:99] not a stamp").lines[0].text, "[99:99] not a stamp");
}, "normalizes, strips control/bidi characters, and caps lyric input");

check(() => {
  assert.match(summarizeLyrics(parseTimestampedLyrics(SONG)), /5 synced lines · 2 untimed · 1 Oracle insight/);
  assert.match(summarizeLyrics(parseTimestampedLyrics("words only")), /Lyric book only/);
  assert.match(summarizeLyrics(parseTimestampedLyrics("")), /No lyrics yet/);
}, "summarizes lyric readiness for the catalog builder");

// --- Active-line syncing -------------------------------------------------
check(() => {
  const { lines } = parseTimestampedLyrics(SONG);
  assert.equal(findActiveLyricIndex(lines, 0), -1);
  assert.equal(findActiveLyricIndex(lines, 5), 1);
  assert.equal(findActiveLyricIndex(lines, 4.97), 1, "tolerates timeupdate jitter");
  assert.equal(findActiveLyricIndex(lines, 12), 2);
  assert.equal(findActiveLyricIndex(lines, 45), 4);
  assert.equal(findActiveLyricIndex(lines, 500), 6);
  assert.equal(findActiveLyricIndex(lines, Number.NaN), -1);
}, "finds the active line for the audio playhead");

check(() => {
  const f = createFixture(SONG);
  assert.equal(f.root.hidden, false);
  assert.equal(f.root.dataset.lyricsMode, "sync");
  f.tick(11);
  const active = f.rows().filter(item => item.classList.contains("is-active"));
  assert.equal(active.length, 1);
  assert.equal(active[0].dataset.index, "2");
  assert.equal(f.rows()[1].dataset.state, "past");
  assert.equal(f.rows()[3].dataset.state, "upcoming");
  assert.equal(f.engine.getState().activeIndex, 2);
  assert.ok(f.viewport.scrolls.length > 0, "sync mode follows the active line");
  assert.equal(f.viewport.scrolls.at(-1).behavior, "smooth");
  f.tick(25);
  assert.equal(f.rows()[3].classList.contains("is-active"), true);
  assert.equal(f.rows()[2].classList.contains("is-active"), false);
  f.audio.currentTime = 6;
  f.audio.dispatchEvent(new Event("seeked"));
  assert.equal(f.engine.getState().activeIndex, 1, "seeking re-syncs the active line");
}, "syncs the active line to audio timeupdate and seeked events");

check(() => {
  const f = createFixture(SONG, { reducedMotion: true });
  f.tick(11);
  assert.equal(f.viewport.scrolls.at(-1).behavior, "auto", "reduced motion avoids smooth scrolling");
}, "respects prefers-reduced-motion while following lyrics");

// --- Click-to-seek -------------------------------------------------------
check(() => {
  const f = createFixture(SONG);
  const chorus = f.lineOf(f.rows()[6]);
  assert.equal(chorus.tagName, "BUTTON");
  assert.equal(chorus.type, "button");
  chorus.dispatchEvent(new Event("click"));
  assert.equal(f.audio.currentTime, 60);
  assert.deepEqual(f.seeks.at(-1), { time: 60, text: "Stay with the light" });
  assert.equal(f.rows()[6].classList.contains("is-active"), true);
  assert.equal(chorus.getAttribute("aria-current"), "true");
  const short = createFixture(SONG, { duration: 30 });
  short.lineOf(short.rows()[6]).dispatchEvent(new Event("click"));
  assert.equal(short.audio.currentTime, 30, "seeks are clamped to the loaded duration");
  const untimed = f.lineOf(f.rows()[5]);
  assert.equal(untimed.tagName, "P", "untimed lines are not seek targets");
  untimed.dispatchEvent(new Event("click"));
  assert.equal(f.audio.currentTime, 60);
}, "clicking a timed lyric line seeks the audio to its timestamp");

// --- Insight tooltip rendering / safety ---------------------------------
check(() => {
  const hostile = "[00:01] <img src=x onerror=alert(1)> || <script>alert('insight')</script>";
  const f = createFixture(hostile);
  const item = f.rows()[0];
  const line = f.lineOf(item);
  const tooltip = item.children[1];
  assert.equal(line.children[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(tooltip.children[1].textContent, "<script>alert('insight')</script>");
  assert.ok(f.list.descendants().every(node => ["LI", "BUTTON", "P", "SPAN", "STRONG"].includes(node.tagName)), "no markup from lyrics becomes an element");
  assert.equal(tooltip.getAttribute("role"), "tooltip");
  assert.equal(tooltip.id, "lyric-insight-0");
  assert.equal(line.getAttribute("aria-describedby"), tooltip.id);
  assert.equal(tooltip.hidden, true);
  assert.equal(item.classList.contains("has-insight"), true);
}, "renders insights as text-only, labelled tooltips");

check(() => {
  const f = createFixture("[00:01] One || First note\n[00:02] Two || Second note\nUntimed || Book note");
  const [first, second, third] = f.rows();
  first.dispatchEvent(new Event("mouseenter"));
  assert.equal(first.children[1].hidden, false);
  assert.equal(f.engine.getState().insightOpen, true);
  f.lineOf(second).dispatchEvent(new Event("focus"));
  assert.equal(first.children[1].hidden, true, "only one insight is open at a time");
  assert.equal(second.children[1].hidden, false);
  const escape = new Event("keydown");
  escape.key = "Escape";
  f.root.dispatchEvent(escape);
  assert.equal(second.children[1].hidden, true, "Escape dismisses the insight");
  f.lineOf(second).dispatchEvent(new Event("focus"));
  f.lineOf(second).dispatchEvent(new Event("blur"));
  assert.equal(second.children[1].hidden, true);
  first.dispatchEvent(new Event("mouseenter"));
  first.dispatchEvent(new Event("mouseleave"));
  assert.equal(first.children[1].hidden, true);
  assert.equal(f.lineOf(third).getAttribute("tabindex"), "0", "untimed insight lines stay keyboard reachable");
}, "reveals Oracle insights on hover and focus and dismisses them safely");

// --- Accessibility states ------------------------------------------------
check(() => {
  const f = createFixture(SONG);
  assert.equal(f.modeToggle.getAttribute("aria-pressed"), "false");
  assert.equal(f.modeToggle.disabled, false);
  assert.match(f.status.textContent, /Synced to playback/);
  f.tick(21);
  const current = f.rows().map(f.lineOf).filter(line => line.getAttribute("aria-current") === "true");
  assert.equal(current.length, 1, "exactly one line carries aria-current");
  assert.equal(current[0], f.lineOf(f.rows()[3]));
  assert.equal(f.lineOf(f.rows()[1]).children[1].textContent, " — jump to ");
  assert.equal(f.lineOf(f.rows()[1]).children[1].className, "dw-sr-only");
  assert.equal(f.lineOf(f.rows()[1]).children[2].textContent, "0:05");
  f.tick(0);
  assert.ok(f.rows().map(f.lineOf).every(line => !line.hasAttribute("aria-current")), "no line is current before the first timestamp");
}, "exposes aria-current, aria-pressed, status and screen-reader seek hints");

// --- Manual lyric-book fallback ------------------------------------------
check(() => {
  const f = createFixture(SONG);
  f.modeToggle.dispatchEvent(new Event("click"));
  assert.equal(f.root.dataset.lyricsMode, "book");
  assert.equal(f.modeToggle.getAttribute("aria-pressed"), "true");
  assert.match(f.status.textContent, /Lyric book/);
  const scrolls = f.viewport.scrolls.length;
  f.tick(25);
  assert.equal(f.viewport.scrolls.length, scrolls, "lyric book mode never auto-scrolls");
  assert.equal(f.rows()[3].classList.contains("is-active"), true, "lyric book still marks the playing line");
  f.lineOf(f.rows()[2]).dispatchEvent(new Event("click"));
  assert.equal(f.audio.currentTime, 10.5, "lyric book lines still seek");
  f.modeToggle.dispatchEvent(new Event("click"));
  assert.equal(f.root.dataset.lyricsMode, "sync");
}, "toggles between synced follow mode and manual lyric book mode");

check(() => {
  const f = createFixture("Line one\nLine two");
  assert.equal(f.root.dataset.lyricsMode, "book", "untimed lyrics fall back to lyric book");
  assert.equal(f.modeToggle.disabled, true);
  assert.equal(f.engine.setMode("sync"), "book");
  assert.match(f.status.textContent, /not timestamped/);
  f.engine.setSource("");
  assert.equal(f.root.hidden, true, "songs without lyrics hide the lyrics room");
  assert.equal(f.list.children.length, 0);
  f.engine.setSource("[00:03] Back again");
  assert.equal(f.root.hidden, false);
  assert.equal(f.root.dataset.lyricsMode, "sync", "a forced lyric book fallback does not stick once timestamps arrive");
  f.modeToggle.dispatchEvent(new Event("click"));
  f.engine.setSource("[00:04] Another song");
  assert.equal(f.root.dataset.lyricsMode, "book", "the listener's chosen mode is preserved across sources");
  const late = createFixture("");
  assert.equal(late.root.hidden, true);
  late.engine.setSource(SONG);
  assert.equal(late.root.dataset.lyricsMode, "sync", "lyrics that hydrate after an empty first render start in sync mode");
}, "falls back to lyric book for untimed lyrics and hides when empty");

check(() => {
  const f = createFixture(SONG);
  f.engine.destroy();
  f.tick(30);
  assert.equal(f.engine.getState().activeIndex, -1, "destroy detaches audio listeners");
}, "cleans up listeners on destroy");

// --- Integration contracts ----------------------------------------------
const [lib, dreamweaverScript, dreamweaverPage, dreamweaverCss, catalogPage, catalogScript, catalogApi, releaseCatalog, schema, migration, packageJson] = await Promise.all([
  read("lib/dreamweaver-lyrics.js"),
  read("dreamweaver/dreamweaver.js"),
  read("dreamweaver/index.html"),
  read("dreamweaver/dreamweaver.css"),
  read("song-catalog/index.html"),
  read("song-catalog/song-catalog.js"),
  read("netlify/functions/song-catalog.ts"),
  read("netlify/functions/release-catalog.mjs"),
  read("db/schema.ts"),
  read("netlify/database/migrations/20261008210000_add_song_catalog_lyrics.sql"),
  read("package.json")
]);

check(() => {
  assert.doesNotMatch(lib, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(lib, /textContent = line\.text/);
  assert.match(lib, /textContent = line\.insight/);
}, "lyrics engine never renders lyrics or insights as HTML");

check(() => {
  assert.match(dreamweaverScript, /import \{ createDreamweaverLyricsEngine \} from "\.\.\/lib\/dreamweaver-lyrics\.js";/);
  assert.match(dreamweaverScript, /function syncDreamweaverLyrics\(\)/);
  assert.match(dreamweaverScript, /audio: elements\.audio/);
  assert.match(dreamweaverScript, /state\.audioSourceMode === "local"\) return ""/, "local uploads never inherit catalog timestamps");
  assert.match(dreamweaverScript, /renderStoryActs\(\);\n    syncDreamweaverLyrics\(\);/);
  assert.match(dreamweaverPage, /<section class="dw-lyrics" id="dreamweaverLyrics" aria-labelledby="dreamweaverLyricsTitle" data-lyrics-mode="sync" hidden>/);
  assert.match(dreamweaverPage, /id="dreamweaverLyricsMode" type="button" aria-pressed="false"/);
  assert.doesNotMatch(dreamweaverPage, /<section class="dw-lyrics"[^>]*\sdata-mode=/, "the page-wide [data-mode] switcher must not capture lyric clicks");
  assert.doesNotMatch(lib, /dataset\.mode\b/);
  assert.match(dreamweaverPage, /id="dreamweaverLyricsStatus" role="status" aria-live="polite"/);
  assert.match(dreamweaverPage, /id="dreamweaverLyricsViewport" role="region" aria-label="Song lyrics" tabindex="0"/);
  assert.match(dreamweaverCss, /\.dw-lyric\.is-active \.dw-lyric__line \{[^}]*text-shadow/);
  assert.match(dreamweaverCss, /prefers-reduced-motion: reduce\), \(prefers-contrast: more\)/);
}, "Dreamweaver page wires the lyrics room to the shared audio element");

check(() => {
  assert.match(catalogPage, /<textarea id="lyricsText" maxlength="16000"/);
  assert.match(catalogPage, /id="lyricsSummary" role="status"/);
  assert.match(catalogScript, /import \{ parseTimestampedLyrics, summarizeLyrics \} from "\/lib\/dreamweaver-lyrics\.js";/);
  assert.match(catalogScript, /lyricsText:\$\("#lyricsText"\)\.value/);
  assert.match(catalogScript, /setValue\("#lyricsText",song\.lyricsText\|\|""\)/);
  assert.match(catalogApi, /lyricsText: song\.lyricsText \|\| ""/);
  assert.match(catalogApi, /const hasLyrics = Object\.hasOwn\(payload, "lyricsText"\);/, "saves that omit lyrics must not erase them");
  assert.match(catalogApi, /\.\.\.\(hasLyrics \? \{ lyricsText: normalizeLyricsSource\(payload\.lyricsText\) \} : \{\}\)/);
  assert.match(releaseCatalog, /song\.lyrics_text AS catalog_lyrics_text/);
  assert.match(releaseCatalog, /lyricsText: normalizeLyricsSource\(row\.catalog_lyrics_text\)/);
  assert.match(schema, /lyricsText: text\("lyrics_text"\)\.notNull\(\)\.default\(""\)/);
  assert.match(migration, /ALTER TABLE halo_song_catalog\s+ADD COLUMN IF NOT EXISTS lyrics_text TEXT NOT NULL DEFAULT '';/);
  assert.match(packageJson, /node scripts\/dreamweaver-lyrics-contracts\.mjs/);
}, "catalog builder stores timestamped lyrics and the release catalog publishes them to Dreamweaver");

console.log(`Dreamweaver lyrics contracts: ${checks}/${checks} checks passed.`);
