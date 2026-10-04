// HALO DJ continuous learning engine.
// Scores completed mix transitions and nudges a small, fixed set of AI DJ mixing weights
// session over session. The engine only reads transition metrics and writes bounded numeric
// weights through an injected store; it never changes code, prompts, routing or any behaviour
// outside the DJ transition-planning workflow.

export const DJ_LEARNING_STORE_NAME = "halo-dj-learning";
export const DJ_LEARNING_WEIGHT_KEYS = Object.freeze(["phrasePrecision", "vocalSeparationStrictness", "eqBlendSmoothness"]);
export const DJ_LEARNING_DEFAULT_WEIGHTS = Object.freeze({ phrasePrecision: 1, vocalSeparationStrictness: 1, eqBlendSmoothness: 1 });
export const DJ_LEARNING_LIMITS = Object.freeze({ minWeight: 0.5, maxWeight: 2, historyLimit: 50 });

const DJ_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TRANSITION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const PENALTIES = Object.freeze({ vocalOverlap: 25, harmonicClash: 15, maxTempo: 20, maxRetention: 10 });
const TIGHT_BPM_DELTA = 0.2;
const STRONG_PHRASE_SCORE = 80;
const EXCEPTIONAL_SCORE = 85;
const REINFORCE = 1.05;
const VOCAL_REINFORCE = 1.1;
const RELAX_TOWARD_BASELINE = 0.02;

export class DJLearningInputError extends Error {}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, label) {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) {
    throw new DJLearningInputError(`${label} must be a finite number.`);
  }
  return number;
}

function bool(value, label) {
  if (typeof value !== "boolean") throw new DJLearningInputError(`${label} must be true or false.`);
  return value;
}

export function normalizeDjId(value) {
  const id = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!DJ_ID_PATTERN.test(id)) throw new DJLearningInputError("djName must identify an AI DJ persona.");
  return id;
}

export function normalizeTransitionMetrics(metrics = {}) {
  if (!metrics || typeof metrics !== "object") throw new DJLearningInputError("Transition metrics are required.");
  const transitionId = String(metrics.transitionId ?? "").trim();
  if (!TRANSITION_ID_PATTERN.test(transitionId)) throw new DJLearningInputError("transitionId must be a short identifier.");
  const phraseAlignmentScore = finite(metrics.phraseAlignmentScore, "phraseAlignmentScore");
  if (phraseAlignmentScore < 0 || phraseAlignmentScore > 100) throw new DJLearningInputError("phraseAlignmentScore must be between 0 and 100.");
  const listenerRetentionDelta = finite(metrics.listenerRetentionDelta, "listenerRetentionDelta");
  if (listenerRetentionDelta < -100 || listenerRetentionDelta > 100) throw new DJLearningInputError("listenerRetentionDelta must be between -100 and 100.");
  const bpmDelta = Math.abs(finite(metrics.bpmDelta, "bpmDelta"));
  if (bpmDelta > 300) throw new DJLearningInputError("bpmDelta is outside a plausible range.");
  return {
    transitionId,
    djId: normalizeDjId(metrics.djName),
    djName: String(metrics.djName).trim().slice(0, 80),
    bpmDelta,
    keyHarmonicMatch: bool(metrics.keyHarmonicMatch, "keyHarmonicMatch"),
    vocalOverlapDetected: bool(metrics.vocalOverlapDetected, "vocalOverlapDetected"),
    phraseAlignmentScore,
    listenerRetentionDelta
  };
}

export function scoreTransition(input) {
  const metrics = normalizeTransitionMetrics(input);
  const penalties = {
    vocalOverlap: metrics.vocalOverlapDetected ? PENALTIES.vocalOverlap : 0,
    harmonicClash: metrics.keyHarmonicMatch ? 0 : PENALTIES.harmonicClash,
    tempo: round(clamp((metrics.bpmDelta - TIGHT_BPM_DELTA) * 4, 0, PENALTIES.maxTempo), 2)
  };
  const retentionAdjustment = round(clamp(metrics.listenerRetentionDelta, -PENALTIES.maxRetention, PENALTIES.maxRetention), 2);
  const totalPenalty = penalties.vocalOverlap + penalties.harmonicClash + penalties.tempo;
  const performanceScore = round(clamp(metrics.phraseAlignmentScore - totalPenalty + retentionAdjustment, 0, 100), 2);
  return { metrics, penalties, retentionAdjustment, performanceScore };
}

function sanitizeWeights(weights = {}) {
  const next = {};
  for (const key of DJ_LEARNING_WEIGHT_KEYS) {
    const value = Number(weights?.[key]);
    next[key] = Number.isFinite(value)
      ? clamp(value, DJ_LEARNING_LIMITS.minWeight, DJ_LEARNING_LIMITS.maxWeight)
      : DJ_LEARNING_DEFAULT_WEIGHTS[key];
  }
  return next;
}

function relax(value) {
  return value + (1 - value) * RELAX_TOWARD_BASELINE;
}

// Weights are emphasis multipliers for the AI DJ transition planner. A weak dimension raises
// its emphasis; a clean transition lets the emphasis relax gently back toward the 1.0 baseline.
export function adjustWeights(previousWeights, scored) {
  const current = sanitizeWeights(previousWeights);
  const { metrics, performanceScore } = scored;
  const phraseWeak = metrics.phraseAlignmentScore < STRONG_PHRASE_SCORE || performanceScore < STRONG_PHRASE_SCORE;
  const blendWeak = metrics.bpmDelta >= TIGHT_BPM_DELTA || metrics.listenerRetentionDelta < 0;
  const next = {
    phrasePrecision: phraseWeak ? current.phrasePrecision * REINFORCE : relax(current.phrasePrecision),
    vocalSeparationStrictness: metrics.vocalOverlapDetected ? current.vocalSeparationStrictness * VOCAL_REINFORCE : relax(current.vocalSeparationStrictness),
    eqBlendSmoothness: blendWeak ? current.eqBlendSmoothness * REINFORCE : relax(current.eqBlendSmoothness)
  };
  for (const key of DJ_LEARNING_WEIGHT_KEYS) {
    next[key] = round(clamp(next[key], DJ_LEARNING_LIMITS.minWeight, DJ_LEARNING_LIMITS.maxWeight));
  }
  return next;
}

export function feedbackSummary(scored) {
  const { metrics, performanceScore } = scored;
  if (performanceScore > EXCEPTIONAL_SCORE) {
    return `Exceptional transition flow. Phrase alignment locked at ${metrics.phraseAlignmentScore}% (performance ${performanceScore}).`;
  }
  const reasons = [];
  if (metrics.vocalOverlapDetected) reasons.push("vocal collision");
  if (!metrics.keyHarmonicMatch) reasons.push("harmonic clash");
  if (metrics.bpmDelta >= TIGHT_BPM_DELTA) reasons.push(`${round(metrics.bpmDelta, 2)} BPM drift`);
  if (metrics.phraseAlignmentScore < STRONG_PHRASE_SCORE) reasons.push(`phrase alignment at ${metrics.phraseAlignmentScore}%`);
  if (metrics.listenerRetentionDelta < 0) reasons.push(`${metrics.listenerRetentionDelta}% listener retention`);
  return `Transition optimization required (performance ${performanceScore})${reasons.length ? `: ${reasons.join(", ")}.` : "."}`;
}

export function emptyLearningProfile(djId) {
  return {
    schemaVersion: 1,
    djId,
    weights: { ...DJ_LEARNING_DEFAULT_WEIGHTS },
    transitionsEvaluated: 0,
    averagePerformance: 0,
    recentTransitions: [],
    updatedAt: null
  };
}

function normalizeProfile(djId, stored) {
  const base = emptyLearningProfile(djId);
  if (!stored || typeof stored !== "object" || stored.djId !== djId) return base;
  const evaluated = Number(stored.transitionsEvaluated);
  const average = Number(stored.averagePerformance);
  return {
    ...base,
    weights: sanitizeWeights(stored.weights),
    transitionsEvaluated: Number.isSafeInteger(evaluated) && evaluated > 0 ? evaluated : 0,
    averagePerformance: Number.isFinite(average) ? clamp(average, 0, 100) : 0,
    recentTransitions: Array.isArray(stored.recentTransitions)
      ? stored.recentTransitions.filter(entry => entry && typeof entry.transitionId === "string").slice(-DJ_LEARNING_LIMITS.historyLimit)
      : [],
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null
  };
}

// Repository-backed adapter on Netlify Blobs, consistent with other HALO function stores.
export function createBlobLearningStore(getStore) {
  if (typeof getStore !== "function") throw new TypeError("getStore is required for the DJ learning store.");
  const store = getStore({ name: DJ_LEARNING_STORE_NAME, consistency: "strong" });
  const key = djId => `weights/${djId}`;
  return {
    async read(djId) { return (await store.get(key(djId), { type: "json" })) ?? null; },
    async write(djId, profile) { await store.setJSON(key(djId), profile); }
  };
}

// In-memory stub for local development and contract tests.
export function createMemoryLearningStore(initial = {}) {
  const profiles = new Map(Object.entries(initial).map(([djId, profile]) => [djId, structuredClone(profile)]));
  return {
    profiles,
    async read(djId) { return profiles.has(djId) ? structuredClone(profiles.get(djId)) : null; },
    async write(djId, profile) { profiles.set(djId, structuredClone(profile)); }
  };
}

export class DJLearningEngine {
  constructor({ store = createMemoryLearningStore(), logger = console, now = () => new Date() } = {}) {
    if (!store || typeof store.read !== "function" || typeof store.write !== "function") {
      throw new TypeError("DJLearningEngine requires a store with read() and write().");
    }
    this.store = store;
    this.logger = logger;
    this.now = now;
  }

  async loadWeights(djName) {
    const djId = normalizeDjId(djName);
    const profile = normalizeProfile(djId, await this.store.read(djId));
    return { djId, weights: profile.weights, transitionsEvaluated: profile.transitionsEvaluated, updatedAt: profile.updatedAt };
  }

  /**
   * Evaluates a completed mix transition and updates the AI DJ weight profile for the next session.
   */
  async evaluateAndLearn(input) {
    const scored = scoreTransition(input);
    const { metrics, performanceScore } = scored;
    this.logger.info?.(`[DJ Learning Engine] Analyzing transition ${metrics.transitionId} for ${metrics.djId}.`);
    if (metrics.vocalOverlapDetected) {
      this.logger.warn?.(`[DJ Learning Engine] Vocal collision on transition ${metrics.transitionId}; raising vocal separation strictness.`);
    }

    const profile = normalizeProfile(metrics.djId, await this.store.read(metrics.djId));
    const summary = feedbackSummary(scored);
    if (profile.recentTransitions.some(entry => entry.transitionId === metrics.transitionId)) {
      this.logger.info?.(`[DJ Learning Engine] Transition ${metrics.transitionId} already learned; weights unchanged.`);
      return { djId: metrics.djId, performanceScore, updatedWeights: profile.weights, previousWeights: profile.weights, feedbackSummary: summary, persisted: false, duplicate: true };
    }

    const previousWeights = profile.weights;
    const updatedWeights = adjustWeights(previousWeights, scored);
    const transitionsEvaluated = profile.transitionsEvaluated + 1;
    const updatedAt = this.now().toISOString();
    const nextProfile = {
      ...profile,
      weights: updatedWeights,
      transitionsEvaluated,
      averagePerformance: round(profile.averagePerformance + (performanceScore - profile.averagePerformance) / transitionsEvaluated, 2),
      recentTransitions: [...profile.recentTransitions, { transitionId: metrics.transitionId, performanceScore, evaluatedAt: updatedAt }].slice(-DJ_LEARNING_LIMITS.historyLimit),
      updatedAt
    };

    await this.store.write(metrics.djId, nextProfile);
    this.logger.info?.(`[DJ Learning Engine] Persisted weights for ${metrics.djId}: ${JSON.stringify(updatedWeights)} (performance ${performanceScore}).`);
    return { djId: metrics.djId, performanceScore, updatedWeights, previousWeights, feedbackSummary: summary, persisted: true, duplicate: false };
  }
}
