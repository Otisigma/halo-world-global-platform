import { chooseBreathBars, modeBreathProfile, shouldUseHaloMotif, transitionStages } from "./dj-mixing-doctrine.mjs";

const TRANSITION_STYLES = new Set(["long-blend", "vocal-handoff", "filter-sweep", "echo-out", "percussion-bridge", "drop-swap", "clean-break"]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum));
}

function clean(value, maximum = 140) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function camelot(value) {
  const match = clean(value, 20).toUpperCase().match(/(?:^|\s)(1[0-2]|[1-9])([AB])(?:\s|$|\()/);
  return match ? { number: Number(match[1]), letter: match[2] } : null;
}

function harmonicScore(first, second) {
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

export function normalizePreflightTrack(track, index = 0) {
  const stemTypes = Array.isArray(track?.stemTypes) ? track.stemTypes.map(item => clean(item, 20).toLowerCase()) : [];
  return {
    id: clean(track?.id, 120) || `track-${index + 1}`,
    title: clean(track?.title, 140) || `Track ${index + 1}`,
    artist: clean(track?.artist, 140) || "Unknown artist",
    bpm: clamp(track?.bpm, 40, 240),
    key: clean(track?.key, 20) || "--",
    energy: clamp(track?.energy, 0, 10),
    vocalDensity: clamp(track?.vocalDensity, 0, 10),
    percussionDensity: clamp(track?.percussionDensity, 0, 10),
    bassWeight: clamp(track?.bassWeight, 0, 10),
    melodicDensity: clamp(track?.melodicDensity, 0, 10),
    atmosphere: clamp(track?.atmosphere, 0, 10),
    signatureMoment: clean(track?.signatureMoment, 300),
    hasStems: Boolean(track?.hasStems || track?.vaultPackId || stemTypes.length >= 2),
    stemTypes
  };
}

export function analyzeTransition(outgoingTrack, incomingTrack, options = {}) {
  const outgoing = normalizePreflightTrack(outgoingTrack);
  const incoming = normalizePreflightTrack(incomingTrack, 1);
  const bpmPercent = Math.abs(outgoing.bpm - incoming.bpm) / Math.max(1, outgoing.bpm) * 100;
  const harmony = harmonicScore(outgoing.key, incoming.key);
  const energyDelta = incoming.energy - outgoing.energy;
  const vocalCollision = outgoing.vocalDensity >= 6 && incoming.vocalDensity >= 6;
  const bassCollision = outgoing.bassWeight >= 7 && incoming.bassWeight >= 7;
  const denseCollision = outgoing.melodicDensity >= 7 && incoming.melodicDensity >= 7;
  const stemsAvailable = outgoing.hasStems || incoming.hasStems;

  let style = "filter-sweep";
  let bars = 16;
  let stemMove = "Clear the outgoing low end, then introduce the incoming groove beneath the final phrase.";
  let guardrail = "Keep one musical idea dominant until the handoff is established.";

  if (vocalCollision && stemsAvailable) {
    style = "vocal-handoff";
    stemMove = "Keep the outgoing vocal. Mute the incoming vocal while its drums and music enter, then exchange vocals after the phrase boundary.";
    guardrail = "Never expose both lead vocals together.";
  } else if (vocalCollision) {
    style = "clean-break";
    bars = 8;
    stemMove = "Use an echo tail or clean ending, then begin the incoming record after the outgoing lead vocal clears.";
    guardrail = "No stem-safe route exists, so continuous blending is blocked.";
  } else if (bassCollision) {
    style = "percussion-bridge";
    bars = 8;
    stemMove = "Carry percussion across the phrase and exchange bass lines at the downbeat.";
    guardrail = "Only one bass line stays open at a time.";
  } else if (bpmPercent <= 2.5 && harmony >= 0.85 && Math.abs(energyDelta) <= 2) {
    style = "long-blend";
    bars = 32;
    stemMove = "Open the incoming percussion and atmosphere first, then trade bass and melody gradually.";
    guardrail = "Protect the outgoing hook before the incoming melody reaches full level.";
  } else if (energyDelta >= 3) {
    style = "drop-swap";
    bars = 4;
    stemMove = "Reduce the outgoing low end before landing the incoming drop as a deliberate event.";
    guardrail = "Do not stack both drops or both bass peaks.";
  } else if (harmony < 0.45 || denseCollision) {
    style = "echo-out";
    bars = 8;
    stemMove = "Remove bass, shorten the overlap, and let the outgoing record leave through a controlled echo tail.";
    guardrail = "Avoid a long melodic overlap.";
  }

  const recentStyles = Array.isArray(options.recentStyles) ? options.recentStyles : [];
  if (recentStyles.at(-1) === style && !vocalCollision && style !== "clean-break") {
    if (!bassCollision && outgoing.percussionDensity >= 5) style = "percussion-bridge";
    else if (harmony >= 0.55) style = "filter-sweep";
    else style = "echo-out";
    stemMove = style === "percussion-bridge"
      ? "Carry a clean outgoing percussion phrase, tease the incoming rhythm, and exchange bass lines at the downbeat."
      : style === "filter-sweep"
        ? "Open the incoming texture behind a filter while the outgoing melody and bass make room."
        : "Shorten the melodic overlap and let the outgoing identity dissolve into a controlled echo tail.";
  }

  const mode = ["listening", "club", "chill"].includes(options.mode) ? options.mode : "listening";
  bars = chooseBreathBars({
    mode,
    requestedBars: bars,
    vocalCollision,
    energyDelta,
    randomValue: Number(options.randomValue)
  });

  const score = Math.round(clamp(
    100 - Math.min(34, bpmPercent * 7) - (1 - harmony) * 25 - (vocalCollision ? (stemsAvailable ? 7 : 24) : 0)
      - (bassCollision ? 9 : 0) - (denseCollision ? 7 : 0) - Math.max(0, Math.abs(energyDelta) - 3) * 5,
    0,
    100
  ));

  const warnings = [];
  if (bpmPercent > 4) warnings.push(`Tempo shift is ${bpmPercent.toFixed(1)}%; shorten the overlap or use a bridge.`);
  if (harmony < 0.45) warnings.push("The keys are distant; avoid a long melodic blend.");
  if (vocalCollision) warnings.push(stemsAvailable ? "Both tracks are vocal-heavy; enforce the planned vocal exchange." : "Both tracks are vocal-heavy and no separated stems were declared.");
  if (bassCollision) warnings.push("Both tracks carry heavy bass; make the bass swap explicit.");
  if (denseCollision) warnings.push("Both arrangements are dense; create negative space before the handoff.");
  if (!warnings.length) warnings.push("No critical collision detected. Keep phrase timing and loudness under operator review.");

  const bridge = style === "percussion-bridge"
    ? "a clean percussion loop and the concealed incoming groove"
    : style === "long-blend"
      ? "one bass line, percussion, and restrained atmosphere"
      : style === "echo-out"
        ? "an echo tail, room texture, and the incoming rhythm"
        : "the strongest available non-vocal element";
  const stages = transitionStages({ bars, vocalCollision, mode, bridge });
  const signatureMotif = shouldUseHaloMotif({
    personaId: clean(options.personaId, 96),
    recentMotif: Boolean(options.recentMotif),
    vocalCollision,
    transitionStyle: style,
    energyDelta,
    atmosphere: incoming.atmosphere,
    randomValue: Number(options.randomValue)
  }) ? "hay-lo-swell" : "none";

  return {
    id: `${outgoing.id}--${incoming.id}`,
    outgoingTrackId: outgoing.id,
    incomingTrackId: incoming.id,
    score,
    status: score >= 70 ? "ready" : score >= 45 ? "review" : "blocked",
    style: TRANSITION_STYLES.has(style) ? style : "clean-break",
    bars,
    bpmPercent: Math.round(bpmPercent * 10) / 10,
    harmonicScore: Math.round(harmony * 100),
    energyDelta: Math.round(energyDelta * 10) / 10,
    vocalCollision,
    bassCollision,
    vocalRevealBars: stages.vocalRevealBars,
    vocalGapSeconds: stages.vocalGapSeconds,
    incomingStartSeconds: stages.incomingStartSeconds,
    levelPolicy: stages.levelPolicy,
    anticipationPlan: stages,
    breathCharacter: modeBreathProfile(mode).character,
    signatureMotif,
    signatureMotifReason: signatureMotif === "hay-lo-swell"
      ? "Use the restrained motif inside the instrumental anticipation pocket, then clear it before the vocal reveal."
      : "Keep this handoff focused on the records so the HALO motif remains selective.",
    stemMove,
    guardrail,
    warnings
  };
}

function greedyOrderFromStart(tracks, startIndex) {
  const remaining = tracks.filter((_track, index) => index !== startIndex);
  const ordered = [tracks[startIndex]];
  while (remaining.length) {
    const current = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestScore = -1;
    remaining.forEach((candidate, index) => {
      const score = analyzeTransition(current, candidate).score;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

function greedyOrder(tracks) {
  if (tracks.length < 3) return tracks;
  return tracks.map((_track, startIndex) => {
    const ordered = greedyOrderFromStart(tracks, startIndex);
    const scores = ordered.slice(0, -1).map((track, index) => analyzeTransition(track, ordered[index + 1]).score);
    return {
      ordered,
      minimumScore: Math.min(...scores),
      averageScore: scores.reduce((sum, score) => sum + score, 0) / scores.length
    };
  }).sort((left, right) => right.minimumScore - left.minimumScore || right.averageScore - left.averageScore)[0].ordered;
}

export function analyzeSetPreflight(input = {}) {
  const seenTrackIds = new Set();
  const tracks = (Array.isArray(input.tracks) ? input.tracks : []).slice(0, 40).map(normalizePreflightTrack).filter(track => {
    if (seenTrackIds.has(track.id)) return false;
    seenTrackIds.add(track.id);
    return true;
  });
  if (tracks.length < 2) throw new Error("Add at least two tracks before running set preflight.");
  const orderedTracks = greedyOrder(tracks);
  const seed = Math.abs(Number(input.seed) || Date.now()) % 2147483647 || 1;
  let recentMotif = false;
  const recentStyles = [];
  const transitions = orderedTracks.slice(0, -1).map((track, index) => {
    const transition = analyzeTransition(track, orderedTracks[index + 1], {
      personaId: clean(input.personaId, 96),
      mode: ["listening", "club", "chill"].includes(input.mode) ? input.mode : "listening",
      recentStyles,
      recentMotif,
      randomValue: ((seededValue(seed, index) % 1000) / 1000)
    });
    recentStyles.push(transition.style);
    recentMotif = transition.signatureMotif === "hay-lo-swell";
    return transition;
  });
  const qualityScore = Math.round(transitions.reduce((sum, item) => sum + item.score, 0) / Math.max(1, transitions.length));
  const blocked = transitions.filter(item => item.status === "blocked").length;
  const review = transitions.filter(item => item.status === "review").length;
  const fingerprint = transitions.map(item => `${item.style}:${item.bars}`).join("|");
  return {
    version: 2,
    title: clean(input.title, 140) || "Untitled set",
    personaId: clean(input.personaId, 96) || null,
    mode: ["listening", "club", "chill"].includes(input.mode) ? input.mode : "listening",
    seed,
    status: blocked ? "blocked" : qualityScore >= 72 ? "ready" : "draft",
    qualityScore,
    summary: blocked
      ? `${blocked} transition${blocked === 1 ? " is" : "s are"} blocked until the vocal, tempo, or arrangement conflict is resolved.`
      : review
        ? `${review} transition${review === 1 ? " needs" : "s need"} an operator review before the set is cleared.`
        : "Every transition has a phrase-safe recipe. The operator still owns final approval.",
    orderedTracks: orderedTracks.map((track, index) => ({ ...track, position: index + 1 })),
    transitions,
    fingerprint,
    variation: {
      seed,
      rule: "HALO BREATH avoids consecutive transition architectures when another phrase-safe route exists; variation never overrides blocked transitions.",
      availableStyles: [...new Set(transitions.filter(item => item.status !== "blocked").map(item => item.style))]
    }
  };
}

function seededValue(seed, index) {
  let value = (Math.abs(Number(seed) || 1) + (index + 1) * 2654435761) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507);
  value ^= value >>> 13;
  return value >>> 0;
}
