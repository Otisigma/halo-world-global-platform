import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyExperienceDecay,
  buildSetPlan,
  camelotFromKey,
  capabilitiesForLevel,
  chooseTransition,
  evaluatePersonaSignals,
  groundTalkBreak,
  harmonicDistance,
  levelFor,
  seedForSlot,
  seededRandom,
  serializePersona,
  templateTalkBreaks
} from "../netlify/lib/radio-personas.mjs";
import { shouldUseHaloMotif, transitionStages } from "../netlify/lib/dj-mixing-doctrine.mjs";

const [migration, priorUsageMigration, personaFunction, plannerFunction, operator, sweep, radioPage, radioClient, radioStyles, personaDoc, radioDoc] =
  await Promise.all([
    readFile(new URL("../netlify/database/migrations/20260812170000_create-radio-dj-personas.sql", import.meta.url), "utf8"),
    readFile(new URL("../netlify/database/migrations/20260810120000_enable-artist-page-scout.sql", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/radio-personas.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/radio-persona-planner.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/lib/radio-operator.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/lib/maintenance-sweep.mjs", import.meta.url), "utf8"),
    readFile(new URL("../radio/index.html", import.meta.url), "utf8"),
    readFile(new URL("../radio/radio.js", import.meta.url), "utf8"),
    readFile(new URL("../radio/radio.css", import.meta.url), "utf8"),
    readFile(new URL("../RADIO_DJ_PERSONAS.md", import.meta.url), "utf8"),
    readFile(new URL("../HALO_RADIO.md", import.meta.url), "utf8")
  ]);

// A level is an amount of authority. Each step has to unlock exactly one new thing.
const level1 = capabilitiesForLevel(1);
assert.equal(level1.buildsOwnRunningOrder, false);
assert.equal(level1.speaks, false);
assert.equal(capabilitiesForLevel(3).speaks, true);
assert.equal(capabilitiesForLevel(3).writesOwnTalkBreaks, false);
assert.equal(capabilitiesForLevel(4).writesOwnTalkBreaks, true);
assert.equal(capabilitiesForLevel(6).playsOutsideHomeRoom, false);
assert.equal(capabilitiesForLevel(7).playsOutsideHomeRoom, true);
assert.equal(capabilitiesForLevel(99).level, 7);
assert.equal(capabilitiesForLevel(0).level, 1);

// Experience alone must never buy a level: the craft floor has to be cleared as well.
assert.equal(levelFor(0, 0), 1);
assert.equal(levelFor(100_000, 0), 1);
assert.equal(levelFor(200, 40), 2);
assert.equal(levelFor(200, 50), 3);
assert.equal(levelFor(5_000, 100), 7);

assert.deepEqual(camelotFromKey("8A"), { number: 8, letter: "A" });
assert.deepEqual(camelotFromKey("5A (D Minor)"), { number: 5, letter: "A" });
assert.deepEqual(camelotFromKey("08b"), { number: 8, letter: "B" });
assert.equal(camelotFromKey("13A"), null);
assert.equal(camelotFromKey("D minor"), null);
assert.equal(camelotFromKey(""), null);

assert.equal(harmonicDistance("8A", "8A"), 0);
assert.equal(harmonicDistance("8A", "9A"), 1);
assert.equal(harmonicDistance("8A", "7A"), 1);
assert.equal(harmonicDistance("8A", "8B"), 1);
assert.equal(harmonicDistance("8A", "10A"), 2);
assert.equal(harmonicDistance("8A", "2A"), 3);
// An unknown key scores neutrally rather than being guessed at.
assert.equal(harmonicDistance("8A", "whatever"), null);

// A resident must not repeat one move all hour: the last three styles drop out of the next choice.
const palette = ["long-blend", "vocal-handoff", "echo-out", "filter-sweep"];
const repeated = chooseTransition({
  palette,
  recentStyles: ["long-blend", "vocal-handoff", "echo-out"],
  energyStep: 0,
  harmonicDistanceValue: 1,
  random: seededRandom(7)
});
assert.equal(repeated.style, "filter-sweep");
assert.equal(repeated.bars, 16);
assert.equal(repeated.vocalRevealBars, 16);
assert.equal(repeated.stages.architecture, "release-breath-discovery-anticipation-reveal");
assert.match(repeated.stages.discovery.instruction, /hiding its lead vocal/i);
// A big energy jump should be taken on a drop swap, a big drop should leave through an echo.
assert.equal(
  chooseTransition({ palette: ["long-blend", "drop-swap"], recentStyles: [], energyStep: 20, harmonicDistanceValue: 1, random: seededRandom(1) }).style,
  "drop-swap"
);

assert.equal(shouldUseHaloMotif({ personaId: "halo", transitionStyle: "long-blend", atmosphere: 8, randomValue: 0.1 }), true);
assert.equal(shouldUseHaloMotif({ personaId: "halo", recentMotif: true, transitionStyle: "long-blend", atmosphere: 8, randomValue: 0.1 }), false);
assert.equal(shouldUseHaloMotif({ personaId: "halo", vocalCollision: true, transitionStyle: "vocal-handoff", atmosphere: 8, randomValue: 0.1 }), false);
assert.equal(shouldUseHaloMotif({ personaId: "butterfly", transitionStyle: "long-blend", atmosphere: 8, randomValue: 0.1 }), false);
assert.equal(transitionStages({ bars: 32, vocalCollision: true }).vocalRevealBars, 32);
assert.equal(
  chooseTransition({ palette: ["long-blend", "echo-out"], recentStyles: [], energyStep: -20, harmonicDistanceValue: 1, random: seededRandom(1) }).style,
  "echo-out"
);

const persona = {
  id: "halo",
  name: "DJ HALO",
  homeRoom: "club",
  bpmMin: 124,
  bpmMax: 140,
  transitionPalette: palette
};

const catalogue = [
  { id: "t1", title: "Opening Signal", artistName: "Owen Anthony", bpm: 126, musicalKey: "8A", durationSeconds: 300, votesUp: 9, votesDown: 1 },
  { id: "t2", title: "Second Wind", artistName: "Nova Lane", bpm: 128, musicalKey: "9A", durationSeconds: 300, votesUp: 6, votesDown: 2 },
  { id: "t3", title: "Third Rail", artistName: "Kite Season", bpm: 131, musicalKey: "9B", durationSeconds: 300, votesUp: 4, votesDown: 1 },
  { id: "t4", title: "Late Rise", artistName: "Halcyon Bay", bpm: 134, musicalKey: "10A", durationSeconds: 300, votesUp: 7, votesDown: 3 },
  { id: "t5", title: "Ballad Room", artistName: "Slow Harbour", bpm: 84, musicalKey: "4A", durationSeconds: 300, votesUp: 20, votesDown: 0 },
  { id: "t6", title: "No Tempo Given", artistName: "Unlisted", bpm: null, musicalKey: "", durationSeconds: 300, votesUp: 2, votesDown: 0 }
];

const plan = buildSetPlan({ persona, tracks: catalogue, durationMinutes: 25, seed: 42 });
assert.ok(plan.tracks.length >= 4);
// A record well outside the resident's lane is not programmable, however popular it is.
assert.ok(!plan.tracks.some(track => track.trackId === "t5"));
// An unknown tempo is not a disqualification.
assert.ok(plan.tracks.some(track => track.trackId === "t6"));
assert.deepEqual(plan.tracks.map(track => track.position), plan.tracks.map((_, index) => index + 1));
assert.equal(plan.tracks[0].transitionIn, null);
assert.ok(plan.tracks.slice(1).every(track => track.transitionIn && track.transitionIn.bars > 0));
assert.ok(plan.tracks.every(track => track.phase && typeof track.targetEnergy === "number"));
assert.equal(plan.arc, "build");
// Same tracks and same seed must produce the same hour, so a plan can be reviewed before it airs.
const replay = buildSetPlan({ persona, tracks: catalogue, durationMinutes: 25, seed: 42 });
assert.deepEqual(replay.tracks.map(track => track.trackId), plan.tracks.map(track => track.trackId));

const knownKeys = new Set(["persona.name", "track.t1.title", "set.track_count"]);
assert.equal(groundTalkBreak({ text: "", signalKeys: ["persona.name"] }, knownKeys, 5), null);
// The gate: a line that cites nothing this station holds never reaches a listener.
assert.equal(groundTalkBreak({ text: "They just signed to a major label.", signalKeys: [] }, knownKeys, 5), null);
assert.equal(
  groundTalkBreak({ text: "Charting at number one this week.", signalKeys: ["chart.position"] }, knownKeys, 5),
  null
);
const kept = groundTalkBreak(
  { text: "That was the opener.", signalKeys: ["track.t1.title", "chart.position"], afterTrack: 99, kind: "nonsense" },
  knownKeys,
  5
);
assert.deepEqual(kept.signalKeys, ["track.t1.title"]);
assert.equal(kept.afterTrack, 5);
assert.equal(kept.kind, "segue");

const templates = templateTalkBreaks({ persona, plan, artists: [] });
assert.ok(templates.length >= 2);
assert.ok(templates[0].text.includes("DJ HALO"));
assert.ok(templates.every(line => line.signalKeys.length > 0));

// Nothing measurable means nothing earned. Sets that aired without listening cannot score craft.
const unmeasured = evaluatePersonaSignals({ setsAired: 2, tuneIns: 0, minutesOnAir: 120 });
assert.equal(unmeasured.measured, false);
assert.equal(unmeasured.craftScore, 0);
assert.equal(unmeasured.experienceDelta, 0);
assert.equal(evaluatePersonaSignals({ setsAired: 0 }).rationale, "No sets aired in this window.");

// Retention is indexed against the room's own baseline, so a quiet room and a busy room can be
// equally well mixed. These two residents hold their own rooms identically and must score alike.
const busyRoom = evaluatePersonaSignals({
  setsAired: 4, tuneIns: 100, minutesOnAir: 240, listenerMinutes: 3600,
  roomListenerMinutes: 7200, roomRetention: 0.6, skips: 10, uniqueListeners: 40, follows: 4, subscriptions: 4
});
const quietRoom = evaluatePersonaSignals({
  setsAired: 4, tuneIns: 100, minutesOnAir: 240, listenerMinutes: 1800,
  roomListenerMinutes: 3600, roomRetention: 0.3, skips: 10, uniqueListeners: 40, follows: 4, subscriptions: 4
});
assert.equal(busyRoom.measured, true);
assert.equal(busyRoom.craftScore, quietRoom.craftScore);
assert.equal(busyRoom.retention, 0.6);
assert.equal(quietRoom.retention, 0.3);
// Reach still separates them by audience size, which is what reach is for.
assert.ok(busyRoom.reachScore >= quietRoom.reachScore);
assert.ok(busyRoom.experienceDelta > 0);
// Skipping costs craft even when the retention is identical.
const skipped = evaluatePersonaSignals({
  setsAired: 4, tuneIns: 100, minutesOnAir: 240, listenerMinutes: 3600,
  roomListenerMinutes: 7200, roomRetention: 0.6, skips: 60, uniqueListeners: 40
});
assert.ok(skipped.craftScore < busyRoom.craftScore);

// A number that can only rise stops meaning anything.
assert.equal(applyExperienceDecay(100, false), 92);
assert.equal(applyExperienceDecay(100, true), 100);
assert.equal(applyExperienceDecay(0, false), 0);

// Planning the same hour twice must land on the same seed, and two residents must not share one.
assert.equal(seedForSlot("halo", "2026-08-14T22:00:00.000Z"), seedForSlot("halo", "2026-08-14T22:00:00.000Z"));
assert.notEqual(seedForSlot("halo", "2026-08-14T22:00:00.000Z"), seedForSlot("romy", "2026-08-14T22:00:00.000Z"));
assert.notEqual(seedForSlot("halo", "2026-08-14T22:00:00.000Z"), seedForSlot("halo", "2026-08-15T22:00:00.000Z"));

const serialized = serializePersona({
  id: "butterfly", name: "DJ BUTTERFLY", tagline: "The sunset terrace.", lane: "Sunset Terrace",
  home_room: "lounge", bpm_min: 118, bpm_max: 123, transition_palette: ["long-blend"],
  signature_move: "Long melodic blends.", voice: "Warm and specific.", accent_color: "#a855f7",
  level: 2, experience: 100, craft_score: 40, reach_score: 20, sets_aired: 5, status: "resident"
});
assert.equal(serialized.levelTitle, "Programmer");
assert.equal(serialized.nextLevel.level, 3);
assert.equal(serialized.nextLevel.experienceNeeded, 80);
assert.equal(serialized.nextLevel.craftNeeded, 5);
assert.equal(serialized.capabilities.buildsOwnRunningOrder, true);
assert.equal(serialized.capabilities.speaks, false);
// The voice is a prompt input, not something the roster hands to a browser.
assert.equal(serialized.voice, undefined);
assert.equal(serializePersona({ id: "x", level: 7, experience: 9000, craft_score: 90, home_room: "club", name: "X" }).nextLevel, null);

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_radio_personas/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_radio_persona_sets/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_radio_persona_scores/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_radio_persona_memory/);
// The approval boundary is enforced by the database, not by a prompt.
assert.match(migration, /CHECK \(status NOT IN \('approved', 'aired'\) OR approved_by_member_id IS NOT NULL\)/);
assert.match(migration, /UNIQUE \(persona_id, planned_for\)/);
assert.match(migration, /ALTER TABLE halo_radio_shows\s+ADD COLUMN IF NOT EXISTS persona_id/);
// Rewriting a CHECK that live rows already satisfy has to widen it, never narrow it. Dropping a
// feature the table already records makes the migration fail against real data, so the replacement
// list must contain every value the previous migration allowed, plus the new one.
const featureList = (source) => {
  const match = source.match(/feature IN \(([^)]*)\)/);
  assert.ok(match, "expected a halo_ai_usage_events feature check");
  return match[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
};
const allowedFeatures = featureList(migration);
for (const feature of featureList(priorUsageMigration)) {
  assert.ok(allowedFeatures.includes(feature), `feature check dropped '${feature}', which existing rows use`);
}
assert.ok(allowedFeatures.includes("radio_persona"));
assert.match(migration, /'halo', 'DJ HALO'/);
assert.match(migration, /'butterfly', 'DJ BUTTERFLY'/);
assert.match(migration, /'romy', 'DJ ROMY'/);
assert.match(migration, /ON CONFLICT \(id\) DO NOTHING/);

assert.match(personaFunction, /path: "\/api\/radio\/personas"/);
assert.match(personaFunction, /verifyRequestOrigin/);
assert.match(personaFunction, /action === "plan_set"/);
assert.match(personaFunction, /action === "approve_set"/);
assert.match(personaFunction, /action === "mark_aired"/);
assert.match(personaFunction, /action === "evaluate"/);
assert.match(personaFunction, /halo_ai_usage_events/);
assert.match(personaFunction, /'radio_persona'/);

assert.match(plannerFunction, /schedule: "40 \*\/6 \* \* \*"/);
assert.match(plannerFunction, /upcomingPersonaSlots/);
assert.match(plannerFunction, /evaluatePersonas/);
// Every planned hour is stored as a proposal, so the scheduler must never approve its own work.
assert.doesNotMatch(plannerFunction, /approvePersonaSet/);
assert.doesNotMatch(plannerFunction, /markPersonaSetAired/);

assert.match(operator, /radio-persona-planner/);
assert.match(sweep, /\/api\/radio\/personas/);

assert.match(radioPage, /id="residentGrid"/);
assert.match(radioPage, /id="residentSets"/);
assert.match(radioClient, /loadResidents/);
assert.match(radioClient, /data-persona-approve/);
assert.match(radioClient, /residentCapabilities/);
assert.match(radioStyles, /\.resident-card \{/);

assert.match(personaDoc, /halo_radio_personas/);
assert.match(personaDoc, /A resident never reaches air on its own/);
assert.match(personaDoc, /\| 7 \| Guest \|/);
assert.match(personaDoc, /HALO mixing doctrine/);
assert.match(personaDoc, /Hay lo, hay lo/);
assert.match(radioDoc, /RADIO_DJ_PERSONAS\.md/);

console.log("Radio persona contracts passed");
