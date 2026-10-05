// HALO OS DJ Council — binding internal quality gate for takeover mixes.
// A mix is not deliverable (post, publish, release) until every blocking council check passes
// and the weighted score reaches the pass mark. Evaluation is pure, synchronous and deterministic:
// the same mix payload always yields the same verdict. New specialist checks plug in through
// DJCouncilEngine#registerCheck without touching the existing pillars.
//
// Runs in the browser (window.HaloDJCouncil) and in Netlify functions (ES module import), so the
// server re-evaluates exactly the same rules the DJ deck shows to the operator.

export const DJ_COUNCIL_VERSION = "2026.10.1";

export const COUNCIL_PILLARS = Object.freeze([
  Object.freeze({ id: "signal", label: "Signal integrity", specialist: "Signal engineer" }),
  Object.freeze({ id: "mechanics", label: "Mix mechanics", specialist: "Transition technician" }),
  Object.freeze({ id: "rights", label: "Rights & metadata", specialist: "Rights clerk" }),
  Object.freeze({ id: "audience", label: "Audience readiness", specialist: "Floor reader" })
]);

export const COUNCIL_PROFILES = Object.freeze({
  house: Object.freeze({ id: "house", label: "House / club", targetBpm: 124, bpmTolerancePct: 3, bpmTargetBlocking: true, minPeakEnergy: 7 }),
  listening: Object.freeze({ id: "listening", label: "Listening", targetBpm: 122, bpmTolerancePct: 8, bpmTargetBlocking: false, minPeakEnergy: 6 }),
  chill: Object.freeze({ id: "chill", label: "Chill", targetBpm: 118, bpmTolerancePct: 12, bpmTargetBlocking: false, minPeakEnergy: 4 })
});

export const DEFAULT_COUNCIL_RULES = Object.freeze({
  passScore: 80,
  targetLufs: -14,
  lufsTolerance: 2,
  lufsHardLimit: 6,
  peakCeilingDbfs: -1,
  clipDbfs: -0.1,
  maxTransitionBpmDeltaPct: 6,
  minHarmonicScore: 0.45,
  minHarmonicRatio: 0.75,
  targetMinutes: 60,
  minDurationRatio: 0.9,
  maxOverrunSeconds: 120,
  minutesPerTrack: 8,
  humFrequencies: Object.freeze([50, 60])
});

const PILLAR_IDS = new Set(COUNCIL_PILLARS.map(pillar => pillar.id));
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const MAX_TRACKS = 200;

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function text(value, maximum = 140) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizeIsrc(value) {
  const isrc = text(value, 24).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ISRC_PATTERN.test(isrc) ? isrc : "";
}

export function resolveCouncilProfile(value) {
  const id = text(value, 20).toLowerCase();
  if (id === "club" || id === "peak" || id === "house") return COUNCIL_PROFILES.house;
  return COUNCIL_PROFILES[id] || COUNCIL_PROFILES.house;
}

function camelot(value) {
  const match = text(value, 20).toUpperCase().match(/(?:^|\s)(1[0-2]|[1-9])([AB])(?:\s|$|\()/);
  return match ? { number: Number(match[1]), letter: match[2] } : null;
}

// Mirrors the Camelot scoring used by the set preflight so the council and the planner agree.
export function harmonicScore(first, second) {
  const left = camelot(first);
  const right = camelot(second);
  if (!left || !right) return 0.55;
  if (left.number === right.number && left.letter === right.letter) return 1;
  if (left.number === right.number) return 0.9;
  const distance = Math.min(Math.abs(left.number - right.number), 12 - Math.abs(left.number - right.number));
  if (distance === 1 && left.letter === right.letter) return 0.94;
  if (distance === 1) return 0.76;
  return Math.max(0.2, 0.68 - distance * 0.12);
}

function normalizeTrack(track, index) {
  return Object.freeze({
    id: text(track?.id, 120) || `track-${index + 1}`,
    title: text(track?.title, 140) || `Track ${index + 1}`,
    artist: text(track?.artist, 140),
    bpm: finite(track?.bpm, 0) > 0 ? clamp(finite(track.bpm), 40, 240) : 0,
    key: text(track?.key, 20) || "--",
    energy: clamp(finite(track?.energy, 0), 0, 10),
    isrc: normalizeIsrc(track?.isrc),
    catalogId: text(track?.catalogId, 120),
    source: text(track?.source, 80),
    stemsUsed: track?.stemsUsed === true,
    stemPermission: track?.stemPermission === true
  });
}

export function normalizeCouncilMix(mix = {}) {
  const signal = mix?.signal && typeof mix.signal === "object" ? mix.signal : {};
  const attribution = mix?.attribution && typeof mix.attribution === "object" ? mix.attribution : {};
  const tracks = (Array.isArray(mix?.tracks) ? mix.tracks : []).slice(0, MAX_TRACKS).map(normalizeTrack);
  const profile = resolveCouncilProfile(mix?.profile);
  return Object.freeze({
    profile: profile.id,
    targetMinutes: clamp(finite(mix?.targetMinutes, DEFAULT_COUNCIL_RULES.targetMinutes) || DEFAULT_COUNCIL_RULES.targetMinutes, 1, 720),
    durationSeconds: clamp(finite(mix?.durationSeconds, 0), 0, 43200),
    masterBpm: finite(mix?.masterBpm, 0) > 0 ? clamp(finite(mix.masterBpm), 40, 240) : 0,
    transitionsCompleted: clamp(Math.floor(finite(mix?.transitionsCompleted, 0)), 0, 10000),
    playbackFaults: clamp(Math.floor(finite(mix?.playbackFaults, 0)), 0, 10000),
    tracks: Object.freeze(tracks),
    signal: Object.freeze({
      preflightPassed: signal.preflightPassed === true,
      humDetected: signal.humDetected === true,
      humFrequency: finite(signal.humFrequency, null),
      integratedLufs: finite(signal.integratedLufs, null),
      peakDbfs: finite(signal.peakDbfs, null)
    }),
    attribution: Object.freeze({
      remixer: text(attribution.remixer, 100),
      credit: text(attribution.credit, 200)
    })
  });
}

function pass(detail, value) {
  return { status: "pass", score: 1, detail, value };
}

function warn(score, detail, value, recommendation, action) {
  return { status: "warn", score: clamp(score, 0, 0.99), detail, value, recommendation, action };
}

function fail(detail, value, recommendation, action) {
  return { status: "fail", score: 0, detail, value, recommendation, action };
}

function listTitles(tracks, limit = 3) {
  const names = tracks.slice(0, limit).map(track => `“${track.title}”`);
  return tracks.length > limit ? `${names.join(", ")} +${tracks.length - limit} more` : names.join(", ");
}

// ---- Signal engineer -------------------------------------------------------------------------

const humCheck = {
  id: "signal.hum",
  pillar: "signal",
  label: "Mains hum (50/60 Hz)",
  severity: "blocking",
  weight: 3,
  run(mix) {
    if (!mix.signal.preflightPassed) {
      return fail("The isolated recorder feed did not pass the quiet-feed hum preflight.", null,
        "Re-arm the recorder so the quiet-feed preflight can verify the master bus is free of hum and cue bleed.", "rerun-recorder-preflight");
    }
    if (mix.signal.humDetected) {
      const hz = mix.signal.humFrequency ? `${Math.round(mix.signal.humFrequency)} Hz` : "mains";
      return fail(`Steady ${hz} hum was measured on the recorded master bus.`, mix.signal.humFrequency,
        `Remove the ${hz} ground-loop source feeding the decks, then re-record. Desk-only notch filters cannot clean the recorder bus.`, "remove-hum-source");
    }
    return pass("Recorder preflight passed and no 50/60 Hz hum was measured in quiet passages.", 0);
  }
};

const loudnessCheck = {
  id: "signal.loudness",
  pillar: "signal",
  label: "Integrated loudness",
  severity: "blocking",
  weight: 2,
  run(mix, profile, rules) {
    const lufs = mix.signal.integratedLufs;
    if (lufs === null) {
      return fail("No loudness measurement was captured from the recorder bus.", null,
        "Record from the HALO deck so the council can meter the isolated master bus.", "rerecord-with-meter");
    }
    const deviation = lufs - rules.targetLufs;
    const value = round(lufs);
    if (Math.abs(deviation) <= rules.lufsTolerance) return pass(`${value} LUFS (target ${rules.targetLufs} ±${rules.lufsTolerance}).`, value);
    const direction = deviation > 0 ? "lower" : "raise";
    const recommendation = `${direction === "lower" ? "Lower" : "Raise"} the master by about ${round(Math.abs(deviation))} dB to land near ${rules.targetLufs} LUFS.`;
    if (Math.abs(deviation) <= rules.lufsHardLimit) {
      return warn(1 - (Math.abs(deviation) - rules.lufsTolerance) / (rules.lufsHardLimit - rules.lufsTolerance) * 0.6,
        `${value} LUFS is outside the ${rules.targetLufs} ±${rules.lufsTolerance} LU window.`, value, recommendation, `${direction}-master-gain`);
    }
    return fail(`${value} LUFS is more than ${rules.lufsHardLimit} LU away from the ${rules.targetLufs} LUFS target.`, value, recommendation, `${direction}-master-gain`);
  }
};

const peakCheck = {
  id: "signal.peak",
  pillar: "signal",
  label: "Peak safety",
  severity: "blocking",
  weight: 2,
  run(mix, profile, rules) {
    const peak = mix.signal.peakDbfs;
    if (peak === null) {
      return fail("No peak measurement was captured from the recorder bus.", null,
        "Record from the HALO deck so the council can meter the isolated master bus.", "rerecord-with-meter");
    }
    const value = round(peak, 2);
    if (peak >= rules.clipDbfs) {
      return fail(`Peaks reached ${value} dBFS — the master clipped.`, value,
        `Pull the channel trims down until peaks stay below ${rules.peakCeilingDbfs} dBFS, then re-record.`, "reduce-trim");
    }
    if (peak > rules.peakCeilingDbfs) {
      return warn(0.6, `Peaks reached ${value} dBFS, above the ${rules.peakCeilingDbfs} dBFS safety ceiling.`, value,
        `Leave at least ${Math.abs(rules.peakCeilingDbfs)} dB of headroom for encoding.`, "reduce-trim");
    }
    return pass(`Peaks held at ${value} dBFS (ceiling ${rules.peakCeilingDbfs} dBFS).`, value);
  }
};

// ---- Transition technician -------------------------------------------------------------------

const tempoTargetCheck = {
  id: "mechanics.tempo-target",
  pillar: "mechanics",
  label: "Master tempo",
  severity: profile => (profile.bpmTargetBlocking ? "blocking" : "advisory"),
  weight: 2,
  run(mix, profile) {
    if (!mix.masterBpm) {
      return fail("The master tempo was not recorded.", null, "Sync the decks before starting the takeover so the master tempo is locked.", "sync-master-tempo");
    }
    const deviationPct = Math.abs(mix.masterBpm - profile.targetBpm) / profile.targetBpm * 100;
    const value = round(mix.masterBpm);
    const recommendation = `Lock the master tempo to ${profile.targetBpm.toFixed(1)} BPM for the ${profile.label} profile.`;
    if (deviationPct <= profile.bpmTolerancePct) return pass(`${value} BPM is within ${profile.bpmTolerancePct}% of ${profile.targetBpm.toFixed(1)} BPM.`, value);
    if (deviationPct <= profile.bpmTolerancePct * 2) {
      return warn(0.5, `${value} BPM drifts ${round(deviationPct)}% from the ${profile.targetBpm.toFixed(1)} BPM target.`, value, recommendation, "sync-master-tempo");
    }
    return fail(`${value} BPM is ${round(deviationPct)}% away from the ${profile.targetBpm.toFixed(1)} BPM target.`, value, recommendation, "sync-master-tempo");
  }
};

function transitionPairs(tracks) {
  const pairs = [];
  for (let index = 1; index < tracks.length; index += 1) pairs.push([tracks[index - 1], tracks[index]]);
  return pairs;
}

const tempoAlignmentCheck = {
  id: "mechanics.tempo-alignment",
  pillar: "mechanics",
  label: "Transition tempo alignment",
  severity: "blocking",
  weight: 2,
  run(mix, profile, rules) {
    const pairs = transitionPairs(mix.tracks).filter(([left, right]) => left.bpm && right.bpm);
    if (!pairs.length) return pass("No tempo-mapped transitions to compare.", 0);
    let worst = { delta: 0, pair: null };
    for (const pair of pairs) {
      const delta = Math.abs(pair[0].bpm - pair[1].bpm) / pair[0].bpm * 100;
      if (delta > worst.delta) worst = { delta, pair };
    }
    const value = round(worst.delta);
    if (worst.delta <= rules.maxTransitionBpmDeltaPct) return pass(`Largest tempo shift between neighbours is ${value}%.`, value);
    return fail(`“${worst.pair[0].title}” → “${worst.pair[1].title}” jumps ${value}% in tempo.`, value,
      `Re-order the set or add a bridge track so no handoff shifts more than ${rules.maxTransitionBpmDeltaPct}% in tempo.`, "reorder-for-tempo");
  }
};

const keyCompatibilityCheck = {
  id: "mechanics.key-compatibility",
  pillar: "mechanics",
  label: "Harmonic key flow",
  severity: "advisory",
  weight: 1,
  run(mix, profile, rules) {
    const pairs = transitionPairs(mix.tracks);
    if (!pairs.length) return pass("No transitions to compare.", 1);
    const compatible = pairs.filter(([left, right]) => harmonicScore(left.key, right.key) >= rules.minHarmonicScore).length;
    const ratio = compatible / pairs.length;
    const value = round(ratio, 2);
    if (ratio >= rules.minHarmonicRatio) return pass(`${compatible} of ${pairs.length} handoffs are harmonically compatible.`, value);
    return warn(ratio, `Only ${compatible} of ${pairs.length} handoffs are harmonically compatible.`, value,
      "Re-run the set preflight to re-order clashing keys, or use echo-out transitions on distant keys.", "rerun-set-preflight");
  }
};

const continuityCheck = {
  id: "mechanics.continuity",
  pillar: "mechanics",
  label: "Transition continuity",
  severity: "blocking",
  weight: 3,
  run(mix) {
    if (mix.tracks.length < 2) {
      return fail("A takeover needs at least two played tracks.", mix.tracks.length, "Load at least two playable tracks and rebuild the takeover.", "rebuild-takeover");
    }
    const ids = mix.tracks.map(track => track.id);
    const repeats = ids.length - new Set(ids).size;
    if (repeats) {
      return fail(`${repeats} track repeat${repeats === 1 ? "" : "s"} detected in the played order.`, repeats,
        "Rebuild the takeover so every song is used once.", "rebuild-takeover");
    }
    if (mix.playbackFaults) {
      return fail(`${mix.playbackFaults} playback fault${mix.playbackFaults === 1 ? "" : "s"} interrupted the automated sequence.`, mix.playbackFaults,
        "Replace the track that failed to decode, then re-record the takeover.", "replace-faulty-track");
    }
    const expected = mix.tracks.length - 1;
    if (mix.transitionsCompleted < expected) {
      return fail(`${mix.transitionsCompleted} of ${expected} transitions completed.`, mix.transitionsCompleted,
        "Re-record so every handoff completes inside the takeover window.", "rerecord-takeover");
    }
    return pass(`${mix.transitionsCompleted} transitions completed with zero repeats or faults.`, mix.transitionsCompleted);
  }
};

// ---- Rights clerk ----------------------------------------------------------------------------

const catalogRightsCheck = {
  id: "rights.catalog",
  pillar: "rights",
  label: "Catalog / ISRC verification",
  severity: "blocking",
  weight: 3,
  run(mix) {
    if (!mix.tracks.length) return fail("No tracks were declared for rights review.", 0, "Rebuild the takeover from catalog tracks.", "rebuild-takeover");
    const unverified = mix.tracks.filter(track => !track.isrc && !track.catalogId);
    if (!unverified.length) return pass(`All ${mix.tracks.length} tracks resolve to a HALO catalog entry or ISRC.`, mix.tracks.length);
    return fail(`${unverified.length} track${unverified.length === 1 ? " has" : "s have"} no catalog entry or ISRC: ${listTitles(unverified)}.`, unverified.length,
      "Replace unverified tracks with HALO catalog or Stem Vault material, or add a valid ISRC before delivery.", "verify-track-rights");
  }
};

const stemPermissionCheck = {
  id: "rights.stems",
  pillar: "rights",
  label: "Stem permissions",
  severity: "blocking",
  weight: 2,
  run(mix) {
    const stemTracks = mix.tracks.filter(track => track.stemsUsed);
    if (!stemTracks.length) return pass("No separated stems were performed.", 0);
    const missing = stemTracks.filter(track => !track.stemPermission);
    if (!missing.length) return pass(`Stem permission is on file for all ${stemTracks.length} stem tracks.`, stemTracks.length);
    return fail(`Stems were performed without permission on ${listTitles(missing)}.`, missing.length,
      "Upload the stems through the Stem Vault with a rights attestation, or perform the full track instead.", "attest-stem-rights");
  }
};

const attributionCheck = {
  id: "rights.attribution",
  pillar: "rights",
  label: "Remix attribution",
  severity: "blocking",
  weight: 1,
  run(mix) {
    if (mix.attribution.remixer) return pass(`Remix credited to ${mix.attribution.remixer}.`, mix.attribution.remixer);
    return fail("The remix/DJ credit is missing.", "", "Add the DJ or remixer credit before delivery.", "add-remix-credit");
  }
};

// ---- Floor reader ----------------------------------------------------------------------------

function formatMinutes(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

const durationCheck = {
  id: "audience.duration",
  pillar: "audience",
  label: "Takeover window",
  severity: "blocking",
  weight: 3,
  run(mix, profile, rules) {
    const target = mix.targetMinutes * 60;
    const minimum = target * rules.minDurationRatio;
    const maximum = target + rules.maxOverrunSeconds;
    const value = Math.round(mix.durationSeconds);
    if (mix.durationSeconds >= minimum && mix.durationSeconds <= maximum) {
      return pass(`${formatMinutes(value)} fills the ${mix.targetMinutes}-minute takeover window.`, value);
    }
    if (mix.durationSeconds < minimum) {
      return fail(`${formatMinutes(value)} is short of the ${mix.targetMinutes}-minute window (minimum ${formatMinutes(minimum)}).`, value,
        `Add more unique tracks so the set fills at least ${formatMinutes(minimum)}, then re-record.`, "extend-set");
    }
    return fail(`${formatMinutes(value)} overruns the ${mix.targetMinutes}-minute window.`, value,
      `Trim the set to finish by ${formatMinutes(maximum)}.`, "trim-set");
  }
};

const energyArcCheck = {
  id: "audience.energy",
  pillar: "audience",
  label: "Energy arc",
  severity: "advisory",
  weight: 1,
  run(mix, profile) {
    const energies = mix.tracks.map(track => track.energy).filter(energy => energy > 0);
    if (energies.length < 2) return warn(0.4, "Not enough energy data to read the room.", 0, "Tag track energy so the council can read the arc.", "tag-track-energy");
    const peak = Math.max(...energies);
    const range = peak - Math.min(...energies);
    if (peak >= profile.minPeakEnergy && range >= 2) return pass(`Energy moves across ${round(range)} points and peaks at ${round(peak)}.`, peak);
    const score = (Math.min(1, peak / profile.minPeakEnergy) + Math.min(1, range / 2)) / 2;
    return warn(score, peak < profile.minPeakEnergy
      ? `Energy peaks at ${round(peak)}, below the ${profile.label} floor of ${profile.minPeakEnergy}.`
      : `Energy stays flat (range ${round(range)}).`, peak,
      "Add a peak-time record and a release moment so the set builds and breathes.", "reshape-energy-arc");
  }
};

const setDepthCheck = {
  id: "audience.set-depth",
  pillar: "audience",
  label: "Set depth",
  severity: "advisory",
  weight: 1,
  run(mix, profile, rules) {
    const needed = Math.max(2, Math.ceil(mix.targetMinutes / rules.minutesPerTrack));
    const count = mix.tracks.length;
    if (count >= needed) return pass(`${count} unique tracks for a ${mix.targetMinutes}-minute window.`, count);
    return warn(count / needed, `${count} unique tracks is thin for a ${mix.targetMinutes}-minute window (aim for ${needed}+).`, count,
      `Add ${needed - count} more catalog track${needed - count === 1 ? "" : "s"} before the next takeover.`, "extend-set");
  }
};

export const DEFAULT_COUNCIL_CHECKS = Object.freeze([
  humCheck, loudnessCheck, peakCheck,
  tempoTargetCheck, tempoAlignmentCheck, keyCompatibilityCheck, continuityCheck,
  catalogRightsCheck, stemPermissionCheck, attributionCheck,
  durationCheck, energyArcCheck, setDepthCheck
]);

function validateCheck(check) {
  if (!check || typeof check !== "object") throw new TypeError("Council check must be an object.");
  if (!text(check.id)) throw new TypeError("Council check needs an id.");
  if (!PILLAR_IDS.has(check.pillar)) throw new TypeError(`Council check ${check.id} has an unknown pillar.`);
  if (typeof check.run !== "function") throw new TypeError(`Council check ${check.id} needs a run function.`);
  if (!(finite(check.weight, 0) > 0)) throw new TypeError(`Council check ${check.id} needs a positive weight.`);
  return check;
}

export class DJCouncilEngine {
  constructor(options = {}) {
    this.rules = Object.freeze({ ...DEFAULT_COUNCIL_RULES, ...(options.rules || {}) });
    this.checks = [];
    for (const check of options.checks || DEFAULT_COUNCIL_CHECKS) this.registerCheck(check);
  }

  registerCheck(check) {
    validateCheck(check);
    if (this.checks.some(existing => existing.id === check.id)) throw new Error(`Council check ${check.id} is already registered.`);
    this.checks.push(check);
    return this;
  }

  evaluate(input = {}) {
    const mix = normalizeCouncilMix(input);
    const profile = resolveCouncilProfile(mix.profile);
    const checks = this.checks.map(check => {
      const severity = typeof check.severity === "function" ? check.severity(profile) : check.severity === "advisory" ? "advisory" : "blocking";
      let result;
      try {
        result = check.run(mix, profile, this.rules) || {};
      } catch (error) {
        // Fail closed: a crashing specialist can never wave a mix through.
        result = fail(`Council check crashed: ${text(error?.message, 160) || "unknown error"}.`, null, "Report this council fault to HALO ops before delivery.", "report-council-fault");
      }
      const status = ["pass", "warn", "fail"].includes(result.status) ? result.status : "fail";
      return Object.freeze({
        id: check.id,
        pillar: check.pillar,
        label: text(check.label, 80) || check.id,
        severity,
        weight: finite(check.weight, 1),
        status,
        score: status === "pass" ? 1 : status === "fail" ? 0 : clamp(finite(result.score, 0), 0, 1),
        blocking: severity === "blocking" && status === "fail",
        detail: text(result.detail, 300),
        value: result.value ?? null,
        recommendation: status === "pass" ? "" : text(result.recommendation, 300),
        action: status === "pass" ? "" : text(result.action, 60)
      });
    });

    const weighted = list => {
      const total = list.reduce((sum, check) => sum + check.weight, 0);
      return total ? Math.round(list.reduce((sum, check) => sum + check.weight * check.score, 0) / total * 100) : 100;
    };
    const score = weighted(checks);
    const blockers = checks.filter(check => check.blocking);
    const passed = blockers.length === 0 && score >= this.rules.passScore;

    const pillars = COUNCIL_PILLARS.map(pillar => {
      const pillarChecks = checks.filter(check => check.pillar === pillar.id);
      return Object.freeze({
        ...pillar,
        score: weighted(pillarChecks),
        status: pillarChecks.some(check => check.blocking) ? "fail" : pillarChecks.some(check => check.status !== "pass") ? "warn" : "pass",
        checks: Object.freeze(pillarChecks.map(check => check.id))
      });
    });

    const recommendations = checks
      .filter(check => check.status !== "pass" && check.recommendation)
      .sort((left, right) => Number(right.blocking) - Number(left.blocking) || right.weight - left.weight)
      .map(check => Object.freeze({
        checkId: check.id,
        pillar: check.pillar,
        priority: check.blocking ? "blocker" : "advisory",
        message: check.recommendation,
        action: check.action
      }));
    if (!blockers.length && score < this.rules.passScore) {
      recommendations.push(Object.freeze({
        checkId: "council.score",
        pillar: "audience",
        priority: "blocker",
        message: `Raise the council score from ${score} to at least ${this.rules.passScore} by resolving the advisory items above.`,
        action: "raise-council-score"
      }));
    }

    return Object.freeze({
      version: DJ_COUNCIL_VERSION,
      profile: profile.id,
      pass: passed,
      deliverable: passed,
      score,
      passScore: this.rules.passScore,
      summary: passed
        ? `DJ Council passed this mix at ${score}/100. It is cleared for delivery.`
        : blockers.length
          ? `DJ Council blocked delivery: ${blockers.length} blocking check${blockers.length === 1 ? "" : "s"} failed (${score}/100).`
          : `DJ Council blocked delivery: ${score}/100 is below the ${this.rules.passScore} pass mark.`,
      pillars: Object.freeze(pillars),
      checks: Object.freeze(checks),
      recommendations: Object.freeze(recommendations)
    });
  }
}

const defaultEngine = new DJCouncilEngine();

export function evaluateDJCouncil(mix, options) {
  return (options ? new DJCouncilEngine(options) : defaultEngine).evaluate(mix);
}

export function isMixDeliverable(verdict) {
  return Boolean(verdict && verdict.version === DJ_COUNCIL_VERSION && verdict.pass === true && verdict.deliverable === true
    && Array.isArray(verdict.checks) && !verdict.checks.some(check => check.blocking));
}

// ---- Recorder-bus signal meter ---------------------------------------------------------------
// Read-only: consumes analyser frames from the isolated post-limiter recorder tap. It never
// connects, disconnects or reroutes audio nodes, so recorder isolation is untouched.
// Loudness follows the ITU-R BS.1770 two-stage gating structure (unweighted approximation).

export function createSignalMeter(options = {}) {
  const humFrequencies = Array.isArray(options.humFrequencies) ? options.humFrequencies : DEFAULT_COUNCIL_RULES.humFrequencies;
  const quietLufs = finite(options.quietLufs, -45);
  const humProminenceDb = finite(options.humProminenceDb, 20);
  const humConsecutive = Math.max(1, Math.floor(finite(options.humConsecutive, 3)));
  const maxBlocks = Math.max(1, Math.floor(finite(options.maxBlocks, 20000)));
  const blocks = [];
  let peak = 0;
  let sampled = false;
  let humRun = 0;
  let humBin = -1;
  let humDetected = false;
  let humFrequency = null;

  function inspectHum(frame) {
    const spectrum = frame.spectrum;
    if (!spectrum?.length || !(frame.sampleRate > 0)) return null;
    const binWidth = frame.sampleRate / (2 * spectrum.length);
    let strongest = -Infinity;
    let strongestBin = 0;
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      if (spectrum[bin] > strongest) { strongest = spectrum[bin]; strongestBin = bin; }
    }
    if (!Number.isFinite(strongest)) return null;
    const frequency = strongestBin * binWidth;
    const mains = humFrequencies.find(hz => [1, 2, 3, 4].some(harmonic => Math.abs(frequency - hz * harmonic) <= binWidth));
    if (!mains) return null;
    const floor = [];
    for (let bin = Math.max(1, strongestBin - 24); bin <= Math.min(spectrum.length - 1, strongestBin + 24); bin += 1) {
      if (Math.abs(bin - strongestBin) > 2 && Number.isFinite(spectrum[bin])) floor.push(spectrum[bin]);
    }
    floor.sort((left, right) => left - right);
    const median = floor.length ? floor[Math.floor(floor.length / 2)] : -Infinity;
    return strongest - median >= humProminenceDb ? { bin: strongestBin, frequency: mains } : null;
  }

  return Object.freeze({
    push(frames) {
      if (!Array.isArray(frames) || !frames.length) return false;
      let blockPower = 0;
      for (const frame of frames) {
        const samples = frame?.samples;
        if (!samples?.length) return false;
        let energy = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const value = samples[index];
          if (!Number.isFinite(value)) return false;
          energy += value * value;
          const magnitude = Math.abs(value);
          if (magnitude > peak) peak = magnitude;
        }
        blockPower += energy / samples.length;
      }
      sampled = true;
      const loudness = blockPower > 0 ? -0.691 + 10 * Math.log10(blockPower) : -Infinity;
      if (blocks.length < maxBlocks) blocks.push(blockPower);
      if (loudness > -100 && loudness < quietLufs) {
        const hum = inspectHum(frames[0]);
        humRun = hum && (humBin < 0 || Math.abs(hum.bin - humBin) <= 1) ? humRun + 1 : hum ? 1 : 0;
        humBin = hum ? hum.bin : -1;
        if (humRun >= humConsecutive) {
          humDetected = true;
          humFrequency = hum.frequency;
        }
      } else {
        humRun = 0;
        humBin = -1;
      }
      return true;
    },
    result() {
      const absolute = blocks.filter(power => power > 0 && -0.691 + 10 * Math.log10(power) > -70);
      let integratedLufs = null;
      if (absolute.length) {
        const relativeGate = -0.691 + 10 * Math.log10(absolute.reduce((sum, power) => sum + power, 0) / absolute.length) - 10;
        const gated = absolute.filter(power => -0.691 + 10 * Math.log10(power) > relativeGate);
        integratedLufs = round(-0.691 + 10 * Math.log10(gated.reduce((sum, power) => sum + power, 0) / gated.length));
      }
      return Object.freeze({
        integratedLufs,
        peakDbfs: sampled ? (peak > 0 ? round(20 * Math.log10(peak), 2) : -120) : null,
        humDetected,
        humFrequency,
        measuredBlocks: blocks.length
      });
    }
  });
}

if (typeof window !== "undefined") {
  window.HaloDJCouncil = Object.freeze({
    DJ_COUNCIL_VERSION,
    COUNCIL_PILLARS,
    COUNCIL_PROFILES,
    DEFAULT_COUNCIL_RULES,
    DJCouncilEngine,
    evaluate: evaluateDJCouncil,
    isMixDeliverable,
    createSignalMeter,
    resolveProfile: resolveCouncilProfile
  });
  window.dispatchEvent?.(new CustomEvent("halo:dj-council-ready"));
}
