import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DJLearningEngine, DJLearningInputError, DJ_LEARNING_DEFAULT_WEIGHTS, DJ_LEARNING_LIMITS, DJ_LEARNING_STORE_NAME,
  adjustWeights, createBlobLearningStore, createMemoryLearningStore, normalizeTransitionMetrics, scoreTransition
} from "../netlify/lib/dj-learning-engine.mjs";

const logs = [];
const logger = { info: message => logs.push(["info", message]), warn: message => logs.push(["warn", message]) };
const fixedNow = () => new Date("2026-10-04T00:00:00Z");

const clean = {
  transitionId: "set-1:t1",
  djName: "DJ Halo",
  bpmDelta: 0.1,
  keyHarmonicMatch: true,
  vocalOverlapDetected: false,
  phraseAlignmentScore: 94,
  listenerRetentionDelta: 2
};
const rough = {
  transitionId: "set-1:t2",
  djName: "DJ Halo",
  bpmDelta: -2.2,
  keyHarmonicMatch: false,
  vocalOverlapDetected: true,
  phraseAlignmentScore: 70,
  listenerRetentionDelta: -4
};

const cleanScore = scoreTransition(clean);
assert.equal(cleanScore.metrics.djId, "dj-halo", "DJ names normalize to persona-safe ids");
assert.equal(cleanScore.performanceScore, 96, "Clean transitions keep phrase score plus retention lift");
const roughScore = scoreTransition(rough);
assert.equal(roughScore.metrics.bpmDelta, 2.2, "BPM delta is evaluated as an absolute drift");
assert.deepEqual({ ...roughScore.penalties }, { vocalOverlap: 25, harmonicClash: 15, tempo: 8 }, "Vocal, harmonic and tempo penalties apply");
assert.equal(roughScore.performanceScore, 18, "Penalties and retention loss reduce the performance score");
assert.equal(scoreTransition({ ...rough, phraseAlignmentScore: 5, bpmDelta: 40 }).performanceScore, 0, "Performance score never drops below zero");

for (const [patch, label] of [
  [{ transitionId: "" }, "transition id"],
  [{ djName: "!!!" }, "dj name"],
  [{ phraseAlignmentScore: 140 }, "phrase range"],
  [{ bpmDelta: "fast" }, "bpm number"],
  [{ keyHarmonicMatch: "yes" }, "harmonic boolean"],
  [{ vocalOverlapDetected: undefined }, "vocal boolean"],
  [{ listenerRetentionDelta: Infinity }, "retention finite"]
]) {
  assert.throws(() => normalizeTransitionMetrics({ ...clean, ...patch }), DJLearningInputError, `Rejects invalid ${label}`);
}

const store = createMemoryLearningStore();
const engine = new DJLearningEngine({ store, logger, now: fixedNow });
assert.deepEqual({ ...(await engine.loadWeights("DJ Halo")).weights }, { ...DJ_LEARNING_DEFAULT_WEIGHTS }, "New personas start at the baseline weights");

const first = await engine.evaluateAndLearn(rough);
assert.equal(first.persisted, true);
assert.deepEqual({ ...first.updatedWeights }, { phrasePrecision: 1.05, vocalSeparationStrictness: 1.1, eqBlendSmoothness: 1.05 }, "Weak dimensions raise their emphasis");
assert.match(first.feedbackSummary, /optimization required/i);
assert.match(first.feedbackSummary, /vocal collision/);
assert.ok(logs.some(([level, message]) => level === "warn" && /Vocal collision/.test(message)), "Vocal collisions are logged as warnings");
assert.ok(logs.some(([, message]) => /Persisted weights for dj-halo/.test(message)), "Persistence is logged");

const nextSessionEngine = new DJLearningEngine({ store, logger, now: fixedNow });
const carried = await nextSessionEngine.loadWeights("dj-halo");
assert.deepEqual({ ...carried.weights }, { ...first.updatedWeights }, "Learned weights carry into the next session");
assert.equal(carried.transitionsEvaluated, 1);

const second = await nextSessionEngine.evaluateAndLearn(clean);
assert.match(second.feedbackSummary, /Exceptional transition flow/);
assert.ok(second.updatedWeights.vocalSeparationStrictness < first.updatedWeights.vocalSeparationStrictness, "Clean transitions relax emphasis toward baseline");
assert.ok(second.updatedWeights.vocalSeparationStrictness > 1, "Relaxation is gradual rather than a reset");
assert.equal(store.profiles.get("dj-halo").transitionsEvaluated, 2);
assert.equal(store.profiles.get("dj-halo").averagePerformance, 57);

const replay = await nextSessionEngine.evaluateAndLearn(clean);
assert.equal(replay.duplicate, true, "Replaying a transition is idempotent");
assert.equal(replay.persisted, false);
assert.equal(store.profiles.get("dj-halo").transitionsEvaluated, 2, "Duplicate transitions are not double-counted");

let weights = { ...DJ_LEARNING_DEFAULT_WEIGHTS };
for (let index = 0; index < 200; index += 1) weights = adjustWeights(weights, roughScore);
assert.ok(Object.values(weights).every(value => value <= DJ_LEARNING_LIMITS.maxWeight), "Weights are bounded above");
for (let index = 0; index < 200; index += 1) weights = adjustWeights(weights, cleanScore);
assert.ok(Object.values(weights).every(value => value >= DJ_LEARNING_LIMITS.minWeight && value >= 1), "Weights decay toward baseline and stay bounded below");
assert.deepEqual(Object.keys(adjustWeights({ phrasePrecision: 99, injected: 5 }, cleanScore)).sort(), ["eqBlendSmoothness", "phrasePrecision", "vocalSeparationStrictness"], "Only the three DJ mixing weights are learned");

const tampered = createMemoryLearningStore({ "dj-romy": { djId: "dj-romy", weights: { phrasePrecision: 50, vocalSeparationStrictness: "x" }, transitionsEvaluated: -3 } });
const tamperedWeights = await new DJLearningEngine({ store: tampered, logger }).loadWeights("DJ Romy");
assert.equal(tamperedWeights.weights.phrasePrecision, DJ_LEARNING_LIMITS.maxWeight, "Stored weights are clamped on read");
assert.equal(tamperedWeights.weights.vocalSeparationStrictness, 1, "Invalid stored weights fall back to baseline");
assert.equal(tamperedWeights.transitionsEvaluated, 0);

const blobCalls = [];
const blobStore = createBlobLearningStore(options => {
  blobCalls.push(["open", options]);
  return {
    async get(key, options) { blobCalls.push(["get", key, options]); return null; },
    async setJSON(key, value) { blobCalls.push(["set", key, value.djId]); }
  };
});
const blobEngine = new DJLearningEngine({ store: blobStore, logger, now: fixedNow });
await blobEngine.evaluateAndLearn({ ...clean, djName: "DJ Butterfly" });
assert.deepEqual(blobCalls[0], ["open", { name: DJ_LEARNING_STORE_NAME, consistency: "strong" }], "Blob adapter uses a strongly consistent named store");
assert.deepEqual(blobCalls[1], ["get", "weights/dj-butterfly", { type: "json" }]);
assert.deepEqual(blobCalls[2], ["set", "weights/dj-butterfly", "dj-butterfly"]);
assert.throws(() => new DJLearningEngine({ store: {} }), TypeError, "Engine requires a persistence adapter");

const [source, docs] = await Promise.all([
  readFile(new URL("../netlify/lib/dj-learning-engine.mjs", import.meta.url), "utf8"),
  readFile(new URL("../AI_DJ_SYSTEM.md", import.meta.url), "utf8")
]);
assert.doesNotMatch(source, /\beval\(|new Function\(|child_process|writeFile|\bimport\(/, "Learning engine never modifies code or executes dynamic input");
assert.match(docs, /DJ continuous learning engine/i, "AI DJ system docs describe the learning engine");
assert.match(docs, /Recorder isolation/i, "AI DJ system docs describe the recorder guard");

console.log("DJ learning engine contracts: scoring, bounded weight learning, persistence, idempotency, and safety checks passed.");
