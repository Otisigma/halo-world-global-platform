import assert from "node:assert/strict";
import { generateAutomatedSet, intentMatchScore } from "../lib/catalog-curator.js";
import {
  MIX_PRESETS, MIX_PRESET_STORAGE_KEY, createMixSeed, deleteUserPreset, describeMixIntent, normalizeMixIntent,
  normalizeMixSeed, normalizeUserPreset, parseMixPrompt, readUserPresets, saveUserPreset, seededUnit
} from "../lib/mix-intent.js";

// Prompt parsing: the headline request maps to a structured, bounded intent.
const HEADLINE = "Create a 20-minute Halo X mix: warm, cinematic opening; deep-house build; finish with a big DJ Butterfly-style lifter. Avoid tracks from last week.";
const headline = parseMixPrompt(HEADLINE);
assert.equal(headline.intent.durationMinutes, 20);
assert.equal(headline.intent.profileId, "halo-x");
assert.equal(headline.intent.profileLabel, "Halo X");
for (const mood of ["warm", "cinematic"]) assert.ok(headline.intent.moods.includes(mood), mood);
assert.ok(headline.intent.genres.includes("deep house"));
assert.equal(headline.intent.genres.filter(genre => genre === "house").length, 1, "deep house never double-counts as a second house entry");
assert.deepEqual(headline.intent.bpmRange, { min: 122, max: 130 });
assert.equal(headline.intent.arc.closing, 3, "a big lifter closer maps to lift energy");
assert.equal(headline.intent.allowRecent, false);
assert.equal(headline.intent.recentWindowDays, 7);
assert.deepEqual(headline.unsupported, []);
assert.ok(headline.notes.some(note => /doesn't imitate any artist/.test(note)), "profile names are HALO labels, never imitation instructions");
assert.ok(headline.notes.some(note => /Blended HALO profiles: Halo X \+ DJ Butterfly/.test(note)));
assert.deepEqual(parseMixPrompt(HEADLINE), headline, "parsing is deterministic");

// BPM, energy, reuse, avoid terms, and honest reporting of what was not understood.
const tempo = parseMixPrompt("high energy tech house 124-130 bpm, no vocals, allow repeats, with a saxophone solo");
assert.deepEqual(tempo.intent.bpmRange, { min: 124, max: 130 });
assert.deepEqual(tempo.intent.arc, { opening: 2, build: 3, peak: 4, closing: 4 });
assert.equal(tempo.intent.allowRecent, true);
assert.deepEqual(tempo.intent.avoidTerms, ["vocals"]);
assert.deepEqual(tempo.unsupported, ["saxophone solo"]);
assert.ok(tempo.notes.some(note => /Not understood, so ignored: “saxophone solo”/.test(note)));
assert.deepEqual(parseMixPrompt("around 120 bpm").intent.bpmRange, { min: 116, max: 124 });
assert.equal(parseMixPrompt("900 bpm").intent.bpmRange, null);
assert.ok(parseMixPrompt("900 bpm").notes.some(note => /between 40 and 240/.test(note)));
assert.equal(parseMixPrompt("a one hour set").intent.durationMinutes, 60);
const odd = parseMixPrompt("45 minute chill set that winds down");
assert.equal(odd.intent.durationMinutes, null, "unsupported durations fall back to the selector");
assert.ok(odd.notes.some(note => /20 or 60 minutes/.test(note)));
assert.ok(odd.notes.some(note => /Cool-down endings aren't supported/.test(note)));
assert.deepEqual(odd.intent.arc, { opening: 1, build: 1, peak: 2, closing: 2 });
assert.equal(parseMixPrompt("skip anything played last month").intent.recentWindowDays, 30);
assert.equal(parseMixPrompt("high energy at 128 bpm then halo x").intent.bpmRange.min, 124, "explicit tempo beats profile defaults");
assert.deepEqual(parseMixPrompt("open with peak energy then end with chill").intent.arc.closing >= 4, true, "energy arc never descends");
const defaults = parseMixPrompt("");
assert.deepEqual(defaults.intent.arc, { opening: 1, build: 2, peak: 3, closing: 4 });
assert.ok(defaults.notes.some(note => /default/.test(note)));
const hostile = parseMixPrompt(`<img src=x onerror=alert(1)> ${"a".repeat(800)}`);
assert.ok(hostile.unsupported.every(part => !/[<>="]/.test(part)), "unsupported fragments are sanitized plain text");
assert.ok(hostile.notes.some(note => /first 500 characters/.test(note)));
assert.ok(!/[<>]/.test(describeMixIntent(hostile.intent)));

// Presets: built-in HALO profiles and validated user presets.
assert.ok(MIX_PRESETS.length >= 4 && MIX_PRESETS.every(preset => preset.source === "halo" && Object.isFrozen(preset)));
assert.equal(parseMixPrompt("", { presetId: "dj-romy" }).intent.profileId, "dj-romy");
assert.ok(parseMixPrompt("", { presetId: "missing" }).notes.some(note => /no longer available/.test(note)));
const records = new Map();
const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
assert.equal(normalizeUserPreset({ label: "Halo X", prompt: "techno" }), null, "user presets cannot shadow HALO presets");
assert.equal(normalizeUserPreset({ label: "<></>", prompt: "techno" }), null);
assert.equal(normalizeUserPreset({ label: "Night Drive", prompt: "" }), null);
const saved = saveUserPreset({ label: "  Night <Drive> ", prompt: "dark melodic techno around 124 bpm" }, storage);
assert.equal(saved.ok, true);
assert.equal(saved.preset.label, "Night Drive", "labels are stripped of markup characters");
assert.equal(saved.preset.id, "user-night-drive");
assert.equal(JSON.parse(records.get(MIX_PRESET_STORAGE_KEY)).length, 1);
const byMention = parseMixPrompt("night drive, avoid recent", { userPresets: readUserPresets(storage) });
assert.equal(byMention.intent.profileId, "user-night-drive");
assert.ok(byMention.intent.genres.includes("melodic techno"));
assert.deepEqual(byMention.intent.bpmRange, { min: 120, max: 128 });
assert.equal(parseMixPrompt("", { presetId: "user-night-drive", userPresets: readUserPresets(storage) }).intent.moods.includes("dark"), true);
assert.ok(saveUserPreset({ label: "Night Drive", prompt: "deep house" }, storage).ok, "saving the same name edits the preset");
assert.equal(readUserPresets(storage).length, 1);
assert.equal(readUserPresets(storage)[0].prompt, "deep house");
assert.deepEqual(deleteUserPreset("user-night-drive", storage), []);
records.set(MIX_PRESET_STORAGE_KEY, "not json");
assert.deepEqual(readUserPresets(storage), []);
assert.deepEqual(readUserPresets(null), []);
assert.equal(saveUserPreset({ label: "X1", prompt: "house" }, { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } }).ok, false);

// Seeds: safe, bounded, deterministic.
assert.equal(normalizeMixSeed(" AbC-12 "), "abc-12");
assert.equal(normalizeMixSeed("<script>"), "");
assert.match(createMixSeed({ getRandomValues: bytes => bytes.fill(171) }), /^abababab$/);
assert.match(createMixSeed(null), /^[0-9a-f]{8}$/);
assert.equal(seededUnit("a", "b"), seededUnit("a", "b"));
assert.ok(seededUnit("a", "b") >= 0 && seededUnit("a", "b") < 1);
assert.equal(normalizeMixIntent({ moods: ["<script>", "warm"], genres: ["house", "polka"], arc: { opening: 9, build: 0 } }).moods.join(), "warm");
assert.deepEqual(normalizeMixIntent({ arc: { opening: 9, build: 0 } }).arc, { opening: 4, build: 4, peak: 4, closing: 4 });

// Curation with intent: ranking, BPM/energy, variation, reproducibility, history, and shortfall.
const now = Date.parse("2026-10-19T12:00:00Z");
const track = (id, overrides = {}) => ({
  id, title: `Track ${id}`, artist: "HALO", bpm: 124, durationSeconds: 240, energyLevel: "Build-up",
  rotationStatus: "Active", driveFileId: `DriveFile_${id.padStart(10, "0")}`, public: true, ...overrides
});
const genres = ["Deep House", "Tech House", "Melodic House", "Techno"];
const catalog = { version: 1, tracks: [
  ...Array.from({ length: 6 }, (_, i) => track(`open_${i}`, { energyLevel: "Warm-up Groove", bpm: 118 + i, genre: genres[i % 4], tags: i % 2 ? ["cinematic", "warm"] : ["dark"] })),
  ...Array.from({ length: 24 }, (_, i) => track(`build_${i}`, { bpm: 120 + (i % 8), genre: genres[i % 4], tags: i % 3 ? ["warm"] : ["vocals"] })),
  ...Array.from({ length: 8 }, (_, i) => track(`lift_${i}`, { energyLevel: "Crowd-Lifter", bpm: 124 + (i % 4), genre: genres[i % 4] })),
  ...Array.from({ length: 4 }, (_, i) => track(`peak_${i}`, { energyLevel: "Peak Anthemic", bpm: 126 + i, genre: genres[i % 4] }))
] };
const before = JSON.stringify(catalog);
const { intent } = parseMixPrompt("warm cinematic opening; deep house build; finish with a big lifter around 124 bpm; no vocals");
assert.ok(intentMatchScore({ genre: "Deep House", tags: ["warm"], bpm: 124 }, normalizeMixIntent(intent)) >
  intentMatchScore({ genre: "Techno", tags: [], bpm: 140 }, normalizeMixIntent(intent)));
for (const minutes of [20, 60]) {
  const options = { now, intent, seed: "alpha" };
  const set = generateAutomatedSet(catalog, minutes, options);
  assert.equal(set.complete, true, `${minutes}-minute intent set fills the duration`);
  assert.equal(set.durationSeconds, minutes * 60);
  assert.equal(set.tracks.reduce((sum, t) => sum + t.playDurationSeconds, 0), minutes * 60);
  assert.equal(new Set(set.tracks.map(t => t.id)).size, set.tracks.length, "no duplicate tracks");
  assert.equal(set.tracks[0].energyLevel, "Warm-up Groove");
  assert.equal(set.tracks.some(t => (t.tags || []).includes("vocals")), false, "avoid terms exclude matching tracks");
  assert.equal(set.avoidedTrackCount, 8);
  assert.equal(set.seed, "alpha");
  for (let i = 1; i < set.tracks.length; i++) {
    assert.ok(Math.abs(set.tracks[i].bpm - set.tracks[i - 1].bpm) <= 8, "BPM-compatible transitions");
  }
  assert.ok(["Crowd-Lifter", "Peak Anthemic"].includes(set.tracks.at(-1).energyLevel), "closer lifts");
  assert.deepEqual(generateAutomatedSet({ version: 1, tracks: [...catalog.tracks].reverse() }, minutes, options), set,
    "same catalog, intent, seed, and history reproduce the same set");
}
assert.equal(generateAutomatedSet(catalog, 20, { now, intent, seed: "alpha" }).tracks[1].genre, "Deep House", "intent genres steer the build");
const variants = new Set(["alpha", "bravo", "charlie", "delta", "echo"].map(seed =>
  generateAutomatedSet(catalog, 60, { now, intent, seed }).tracks.map(t => t.id).join()));
assert.ok(variants.size >= 3, "new seeds produce meaningfully different sets");
const inRange = generateAutomatedSet(catalog, 20, { now, intent, seed: "bravo" }).tracks.filter(t => t.bpm >= 120 && t.bpm <= 128);
assert.ok(inRange.length >= generateAutomatedSet(catalog, 20, { now, intent, seed: "bravo" }).tracks.length - 1, "BPM preference is honoured");
assert.equal(JSON.stringify(catalog), before, "curation never mutates the catalog");

const played = catalog.tracks.slice(0, 20).map(t => t.id);
const fresh = generateAutomatedSet(catalog, 20, { now, intent, seed: "alpha", recentTrackIds: played });
assert.equal(fresh.tracks.some(t => played.includes(t.id)), false, "recent tracks are avoided by default");
const tiny = { version: 1, tracks: [track("solo_a", { energyLevel: "Warm-up Groove" }), track("solo_b", { energyLevel: "Peak Anthemic" })] };
const short = generateAutomatedSet(tiny, 20, { now, intent, seed: "alpha", recentTrackIds: ["solo_a"] });
assert.equal(short.complete, false);
assert.equal(short.shortfallSeconds, 1200 - 240, "shortfall is reported, never padded");
const reuse = generateAutomatedSet(tiny, 20, { now, intent: { ...intent, allowRecent: true }, allowRecent: true, seed: "alpha", recentTrackIds: ["solo_a"] });
assert.equal(reuse.tracks.length, 2, "explicit reuse may include recent tracks");
const windowed = { version: 1, tracks: [track("old", { lastPlayedAt: "2026-10-01T00:00:00Z" })] };
assert.equal(generateAutomatedSet(windowed, 20, { now, intent: parseMixPrompt("").intent }).tracks.length, 1);
assert.equal(generateAutomatedSet(windowed, 20, { now, intent: parseMixPrompt("avoid anything played last month").intent }).tracks.length, 0, "the requested rotation window is respected");
assert.equal(generateAutomatedSet({ version: 1, tracks: [track("private", { public: false })] }, 20, { now, intent: { ...intent, allowRecent: true }, allowRecent: true }).tracks.length, 0, "prompts never bypass publication eligibility");
assert.throws(() => generateAutomatedSet(catalog, 45, { intent }));
assert.throws(() => generateAutomatedSet({ version: 1, tracks: [track("bad", { tags: "warm" })] }, 20));
console.log("Mix intent contracts passed: prompt parsing, HALO/user presets, BPM/energy, seeded variation, reproducibility, history, and shortfall.");
