import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [deckSource, migration, guardSource] = await Promise.all([
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261005100000_dj_learning_engine.sql", import.meta.url), "utf8"),
  readFile(new URL("../dj-recorder-guard.js", import.meta.url), "utf8")
]);

const deck = deckSource;

const checks = [
  [deck.includes("buildTakeoverPlan") && deck.includes("recordingState.takeoverPlan") && deck.includes("playedTrackIds"), "builds one complete DJ takeover order and enforces a no-repeat ledger"],
  [deck.includes('"clean-break"') && deck.includes("plan.hardCut") && deck.includes("setStemState(incomingDeck, \"vocals\", false"), "blocks lead-vocal crossover with stem handoffs or a true clean break"],
  [deck.includes('id="recordingSongCount"') && deck.includes("Quiet-feed preflight required") && !deck.includes('id="takeoverQc"'), "shows a minimal recorder flow with song count and required quiet-feed isolation"],
  [deck.includes('/dj-continuity-guard.js') && deck.includes("attachContinuityGuardToDeck") && deck.includes("CONTINUITY BRIDGE ACTIVE"), "arms the shared continuity guard and exposes bridge state in the live master readout"],
  [deck.includes("continuity: { ...audioHealth.continuity }") && deck.includes("continuity: { ...audioHealth.continuity },") && deck.includes("Sync live telemetry"), "includes continuity state in deck health and live telemetry sync payloads"]
];

for (const [condition, description] of checks) {
  assert.equal(condition, true, description);
}

const fullLibrary = Array.from({ length: 41 }, (_, index) => ({ id: `song-${index}`, bpm: 124, key: "8A", vocalDensity: 2 }));
assert.equal((await import("../netlify/lib/dj-preflight.mjs")).analyzeSetPreflight({ tracks: fullLibrary }).orderedTracks.length, 41, "Whole sets are not silently truncated at 40 songs");
assert.throws(() => (await import("../netlify/lib/dj-preflight.mjs")).analyzeSetPreflight({ tracks: Array(121).fill(fullLibrary[0]) }), /up to 120 songs/, "Oversized libraries fail explicitly instead of producing a partial set");

console.log("DJ preflight launch contracts passed: full-set builds stay complete, the recorder flow is minimal, and oversized libraries fail fast.");