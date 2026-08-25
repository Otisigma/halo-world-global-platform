import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { chooseBreathBars, modeBreathProfile, shouldUseHaloMotif, transitionStages } from "./dj-mixing-doctrine.mjs";

export const PERSONA_MODEL = "gpt-5.4-mini";

/**
 * A level is an amount of authority, not a badge. Each step unlocks something the persona is
 * allowed to do on air, and every step is reachable only with both accumulated experience and a
 * craft floor — so volume alone never promotes a resident that the room keeps walking out on.
 *
 * Levels are recomputed from evidence on every evaluation and are allowed to fall.
 */
export const PERSONA_LEVELS = Object.freeze([
  { level: 1, title: "Selector", minExperience: 0, minCraft: 0, unlocks: "Plays a running order an owner approved." },
  { level: 2, title: "Programmer", minExperience: 60, minCraft: 35, unlocks: "Builds its own running order inside its lane." },
  { level: 3, title: "Host", minExperience: 180, minCraft: 45, unlocks: "Talk breaks assembled from station facts." },
  { level: 4, title: "Voice", minExperience: 400, minCraft: 55, unlocks: "Writes its own talk breaks through the grounding gate." },
  { level: 5, title: "Resident", minExperience: 750, minCraft: 62, unlocks: "Takes requests and runs a room vote inside its hour." },
  { level: 6, title: "Programmer of record", minExperience: 1200, minCraft: 68, unlocks: "Proposes grid changes into the operator briefing." },
  { level: 7, title: "Guest", minExperience: 1800, minCraft: 74, unlocks: "Can be booked outside its home room." }
]);

const ENERGY_ARCS = Object.freeze({
  club: "build",
  lounge: "sunset",
  chill: "afterhours"
});

/** Target energy (0-100) at each point of the set, per arc. */
const ARC_SHAPES = Object.freeze({
  build: [38, 52, 68, 84, 72, 58],
  sunset: [46, 56, 66, 72, 62, 48],
  afterhours: [40, 46, 54, 60, 50, 36],
  journey: [42, 58, 74, 62, 70, 50],
  steady: [55, 58, 60, 62, 58, 54]
});

const SET_PHASES = Object.freeze(["opening", "build", "peak", "release", "close"]);

/** Phrase-safe transition lengths in bars, matching the deck's 4-32 bar performance window. */
const TRANSITION_BARS = Object.freeze({
  "long-blend": 32,
  "vocal-handoff": 16,
  "filter-sweep": 16,
  "echo-out": 8,
  "percussion-bridge": 8,
  "drop-swap": 8
});

const TRANSITION_REASONS = Object.freeze({
  "long-blend": "Both records hold the same harmonic centre, so the blend can take its time.",
  "vocal-handoff": "The outgoing vocal keeps the room while the incoming vocal is revealed later in the phrase.",
  "filter-sweep": "A sweep clears space for a different low end without stopping the groove.",
  "echo-out": "The outgoing record leaves through its own tail rather than being cut.",
  "percussion-bridge": "Percussion carries the handoff while the melodic content changes underneath.",
  "drop-swap": "The energy step is large enough that the change should land as an event."
});

const TALK_KINDS = new Set(["intro", "segue", "artist-note", "station-id", "outro"]);

export function clamp(value, min, max) {
  return Math.min(Math.max(Number.isFinite(Number(value)) ? Number(value) : min, min), max);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

export function cleanLine(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

/**
 * Seeded generator. The deck gives every takeover a fresh session seed so two runs of the same
 * records do not produce the same set; a stored seed does the same thing here while keeping a
 * planned set reproducible when an owner wants to know why it chose what it chose.
 */
export function seededRandom(seed) {
  let state = Number(seed) >>> 0 || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedForSlot(personaId, plannedFor) {
  const source = `${personaId}:${new Date(plannedFor).toISOString()}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function capabilitiesForLevel(level) {
  const value = clamp(level, 1, 7);
  return {
    level: value,
    title: PERSONA_LEVELS[value - 1]?.title || "Selector",
    buildsOwnRunningOrder: value >= 2,
    speaks: value >= 3,
    writesOwnTalkBreaks: value >= 4,
    takesRequests: value >= 5,
    proposesProgramming: value >= 6,
    playsOutsideHomeRoom: value >= 7
  };
}

export function levelFor(experience, craftScore) {
  let earned = 1;
  for (const step of PERSONA_LEVELS) {
    if (experience >= step.minExperience && craftScore >= step.minCraft) earned = step.level;
  }
  return earned;
}

export function nextLevelTarget(level) {
  return PERSONA_LEVELS.find(step => step.level === clamp(level, 1, 7) + 1) || null;
}

/**
 * Camelot position parsed from whatever the uploader typed: "5A", "5A (D Minor)", "08B".
 * Returns null rather than guessing, so an unknown key scores neutrally instead of wrongly.
 */
export function camelotFromKey(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\s*([AB])/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isInteger(number) || number < 1 || number > 12) return null;
  return { number, letter: match[2].toUpperCase() };
}

/**
 * Distance around the Camelot wheel. 0 is the same key, 1 is an adjacent or relative key, 2 is a
 * two-step move, 3 is everything a phrase-safe blend should avoid.
 */
export function harmonicDistance(fromKey, toKey) {
  const from = camelotFromKey(fromKey);
  const to = camelotFromKey(toKey);
  if (!from || !to) return null;
  const steps = Math.min((from.number - to.number + 12) % 12, (to.number - from.number + 12) % 12);
  if (from.letter === to.letter) return Math.min(steps, 3);
  if (steps === 0) return 1;
  return Math.min(steps + 1, 3);
}

/**
 * Energy is a proxy, not measurement. Real beat-grid, loudness, and spectral analysis is the
 * documented upgrade path; until tracks carry it, tempo position inside the persona's lane plus
 * the room's own voting record is the most honest estimate available.
 */
export function estimateEnergy(track, persona) {
  const bpm = Number(track?.bpm) || 0;
  const low = Number(persona?.bpmMin) || 90;
  const high = Number(persona?.bpmMax) || 140;
  const span = Math.max(1, high - low);
  const tempoPart = bpm > 0 ? clamp01((bpm - low) / span) : 0.5;
  const votesUp = Number(track?.votesUp) || 0;
  const votesDown = Number(track?.votesDown) || 0;
  const votes = votesUp + votesDown;
  const votePart = votes > 0 ? votesUp / votes : 0.5;
  return Math.round(100 * (0.72 * tempoPart + 0.28 * votePart));
}

export function targetEnergyAt(progress, arc) {
  const shape = ARC_SHAPES[arc] || ARC_SHAPES.journey;
  const position = clamp01(progress) * (shape.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(shape.length - 1, lower + 1);
  const blend = position - lower;
  return Math.round(shape[lower] + (shape[upper] - shape[lower]) * blend);
}

export function phaseAt(progress) {
  const value = clamp01(progress);
  if (value < 0.15) return SET_PHASES[0];
  if (value < 0.45) return SET_PHASES[1];
  if (value < 0.7) return SET_PHASES[2];
  if (value < 0.88) return SET_PHASES[3];
  return SET_PHASES[4];
}

/**
 * Weights differ by lane so a resident sounds like itself. Butterfly protects harmony and smooth
 * energy movement, Romy trades some smoothness for tension, Halo stays balanced across the palette.
 */
function weightsFor(personaId) {
  if (personaId === "butterfly") return { tempo: 0.26, harmonic: 0.34, energy: 0.24, novelty: 0.1, audience: 0.06 };
  if (personaId === "romy") return { tempo: 0.24, harmonic: 0.2, energy: 0.34, novelty: 0.14, audience: 0.08 };
  return { tempo: 0.28, harmonic: 0.26, energy: 0.26, novelty: 0.12, audience: 0.08 };
}

export function scoreCandidate({ current, candidate, persona, targetEnergy, playedArtists, recentTrackIds }) {
  const weights = weightsFor(persona.id);
  const currentBpm = Number(current?.bpm) || 0;
  const candidateBpm = Number(candidate?.bpm) || 0;
  const tempoScore = currentBpm > 0 && candidateBpm > 0 ? clamp01(1 - Math.abs(candidateBpm - currentBpm) / 12) : 0.5;

  const distance = current ? harmonicDistance(current.musicalKey, candidate.musicalKey) : null;
  const harmonicScore = distance === null ? 0.5 : [1, 0.78, 0.42, 0.12][distance];

  const energy = estimateEnergy(candidate, persona);
  const energyScore = clamp01(1 - Math.abs(energy - targetEnergy) / 45);

  const artistRepeat = playedArtists.has(candidate.artistKey) ? 0 : 1;
  const recentlyAired = recentTrackIds.has(candidate.id) ? 0.25 : 1;
  const noveltyScore = clamp01(artistRepeat * 0.6 + recentlyAired * 0.4);

  const votes = Number(candidate.votesUp || 0) + Number(candidate.votesDown || 0);
  const audienceScore = votes > 0 ? clamp01(Number(candidate.votesUp || 0) / votes) : 0.5;

  const score =
    weights.tempo * tempoScore +
    weights.harmonic * harmonicScore +
    weights.energy * energyScore +
    weights.novelty * noveltyScore +
    weights.audience * audienceScore;

  return {
    score: Math.round(score * 1000) / 1000,
    energy,
    harmonicDistance: distance,
    tempoScore: Math.round(tempoScore * 100) / 100,
    harmonicScore: Math.round(harmonicScore * 100) / 100,
    energyScore: Math.round(energyScore * 100) / 100
  };
}

/**
 * Picks the transition for a handoff. Mirrors the deck rule: the last three styles are removed from
 * the next choice whenever the palette still leaves an alternative, so a resident never falls into
 * repeating one move for a whole hour.
 */
export function chooseTransition({ palette, recentStyles, energyStep, harmonicDistanceValue, random, mode = "listening" }) {
  const available = palette.length ? palette : ["long-blend"];
  let choices = available.filter(style => !recentStyles.slice(-3).includes(style));
  if (!choices.length) choices = available;

  const preferred = [];
  if (energyStep >= 14 && choices.includes("drop-swap")) preferred.push("drop-swap");
  if (energyStep <= -12 && choices.includes("echo-out")) preferred.push("echo-out");
  if (harmonicDistanceValue !== null && harmonicDistanceValue >= 2 && choices.includes("percussion-bridge")) {
    preferred.push("percussion-bridge");
  }
  if (harmonicDistanceValue === 0 && choices.includes("long-blend")) preferred.push("long-blend");

  const pool = preferred.length ? preferred : choices;
  const style = pool[Math.floor(random() * pool.length) % pool.length];
  const bridge = style === "percussion-bridge"
    ? "an outgoing percussion loop and the incoming groove tease"
    : style === "long-blend"
      ? "percussion, atmosphere, and a controlled bass exchange"
      : style === "echo-out"
        ? "an echo tail, room texture, and the concealed incoming rhythm"
        : "the strongest non-vocal musical element";
  const bars = chooseBreathBars({
    mode,
    requestedBars: TRANSITION_BARS[style],
    vocalCollision: style === "vocal-handoff",
    energyDelta: energyStep,
    randomValue: random()
  });
  const stages = transitionStages({ bars, vocalCollision: style === "vocal-handoff", mode, bridge });
  return {
    style,
    bars,
    reason: TRANSITION_REASONS[style] || "Phrase-safe handoff.",
    stages,
    vocalRevealBars: stages.vocalRevealBars,
    breathCharacter: modeBreathProfile(mode).character
  };
}

/**
 * Builds the running order ahead of air. Deterministic given the same tracks and seed: an owner
 * reading the plan can be told exactly why each record follows the one before it.
 */
export function buildSetPlan({ persona, tracks, durationMinutes = 60, seed = 1, recentTrackIds = [] }) {
  const random = seededRandom(seed);
  const arc = ENERGY_ARCS[persona.homeRoom] || "journey";
  const breathMode = persona.homeRoom === "chill" ? "chill" : persona.homeRoom === "club" ? "club" : "listening";
  const recent = new Set(recentTrackIds);
  const targetSeconds = durationMinutes * 60;

  const pool = tracks
    .map(track => ({
      ...track,
      artistKey: String(track.artistSlug || track.artistName || "").trim().toLowerCase(),
      durationSeconds: Number(track.durationSeconds) > 0 ? Number(track.durationSeconds) : 300
    }))
    .filter(track => {
      const bpm = Number(track.bpm) || 0;
      // An unknown tempo is not a disqualification; a tempo clearly outside the lane is.
      return bpm === 0 || (bpm >= persona.bpmMin - 4 && bpm <= persona.bpmMax + 4);
    });

  const remaining = new Map(pool.map(track => [track.id, track]));
  const ordered = [];
  const playedArtists = new Set();
  const recentStyles = [];
  let recentMotif = false;
  let elapsedSeconds = 0;
  let previous = null;

  while (remaining.size && elapsedSeconds < targetSeconds) {
    const progress = clamp01(elapsedSeconds / targetSeconds);
    const targetEnergy = targetEnergyAt(progress, arc);
    let best = null;

    for (const candidate of remaining.values()) {
      const scored = scoreCandidate({
        current: previous,
        candidate,
        persona,
        targetEnergy,
        playedArtists,
        recentTrackIds: recent
      });
      if (!best || scored.score > best.scored.score) best = { candidate, scored };
    }
    if (!best) break;

    const { candidate, scored } = best;
    const energyStep = previous ? scored.energy - previous.energy : 0;
    const transition = previous
      ? chooseTransition({
          palette: persona.transitionPalette,
          recentStyles,
          energyStep,
          harmonicDistanceValue: scored.harmonicDistance,
          random,
          mode: breathMode
        })
      : null;
    if (transition) recentStyles.push(transition.style);
    if (transition) {
      transition.signatureMotif = shouldUseHaloMotif({
        personaId: persona.id,
        recentMotif,
        vocalCollision: transition.style === "vocal-handoff",
        transitionStyle: transition.style,
        energyDelta: energyStep,
        atmosphere: candidate.atmosphere ?? 5,
        randomValue: random()
      }) ? "hay-lo-swell" : "none";
      transition.signatureMotifReason = transition.signatureMotif === "hay-lo-swell"
        ? "A restrained HALO swell foreshadows the reveal without covering a lead vocal."
        : "The track story and transition movement stay unbranded here so the motif remains recognizable.";
      recentMotif = transition.signatureMotif === "hay-lo-swell";
    }

    ordered.push({
      position: ordered.length + 1,
      trackId: candidate.id,
      title: candidate.title,
      artistName: candidate.artistName,
      artistSlug: candidate.artistSlug || "",
      bpm: Number(candidate.bpm) || null,
      musicalKey: candidate.musicalKey || "",
      genre: candidate.genre || "",
      durationSeconds: candidate.durationSeconds,
      phase: phaseAt(progress),
      targetEnergy,
      energy: scored.energy,
      fit: scored.score,
      transitionIn: transition,
      startsAtSecond: elapsedSeconds
    });

    remaining.delete(candidate.id);
    playedArtists.add(candidate.artistKey);
    elapsedSeconds += candidate.durationSeconds;
    previous = { ...candidate, energy: scored.energy };
  }

  return {
    arc,
    tracks: ordered,
    plannedSeconds: elapsedSeconds,
    plannedMinutes: Math.round(elapsedSeconds / 60),
    // A short plan is a catalogue problem, not a planner failure, and the station desk should see it.
    shortOfSlot: elapsedSeconds < targetSeconds * 0.9,
    candidatesConsidered: pool.length
  };
}

/**
 * The index every spoken claim must be traceable to. Keys are checked in code, never in the prompt,
 * so a talk break citing a signal this station does not have is dropped before it can be stored.
 */
export function buildSignalIndex({ persona, plan, artists, station, show }) {
  const index = {
    "persona.level": persona.level,
    "persona.name": persona.name,
    "persona.lane": persona.lane,
    "persona.sets_aired": persona.setsAired,
    "persona.signature_move": persona.signatureMove,
    "set.track_count": plan.tracks.length,
    "set.arc": plan.arc,
    "set.room": persona.homeRoom,
    "station.rotation_tracks": station.rotationTracks,
    "station.artists_in_rotation": station.artistsInRotation
  };
  if (show?.id) {
    index["show.title"] = show.title;
    index["show.starts_at"] = show.startsAt;
    index["show.subscribers"] = show.subscriberCount;
  }
  for (const track of plan.tracks) {
    index[`track.${track.trackId}.title`] = track.title;
    index[`track.${track.trackId}.artist`] = track.artistName;
    if (track.bpm) index[`track.${track.trackId}.bpm`] = track.bpm;
    if (track.musicalKey) index[`track.${track.trackId}.key`] = track.musicalKey;
    if (track.genre) index[`track.${track.trackId}.genre`] = track.genre;
  }
  for (const artist of artists) {
    index[`artist.${artist.slug}.name`] = artist.artistName;
    index[`artist.${artist.slug}.followers`] = artist.followers;
    index[`artist.${artist.slug}.plays_30d`] = artist.plays30d;
    if (artist.releaseTitle) index[`artist.${artist.slug}.release`] = artist.releaseTitle;
  }
  return index;
}

/**
 * The gate. A talk break survives only if it cites at least one signal key this station actually
 * has, and only if it sits at a real point in the running order.
 */
export function groundTalkBreak(value, knownKeys, trackCount) {
  const text = cleanLine(value?.text, 400);
  if (!text) return null;
  const signalKeys = (Array.isArray(value?.signalKeys) ? value.signalKeys : [])
    .map(key => cleanLine(key, 120))
    .filter(key => knownKeys.has(key))
    .slice(0, 6);
  if (!signalKeys.length) return null;
  const afterTrack = clamp(Math.round(Number(value?.afterTrack)), 0, Math.max(0, trackCount));
  return {
    afterTrack,
    kind: TALK_KINDS.has(value?.kind) ? value.kind : "segue",
    text,
    signalKeys
  };
}

/**
 * Level 3 speaks, but only in lines assembled here from station facts. There is no model in this
 * path, so a Host-level resident cannot say anything the station cannot prove.
 */
export function templateTalkBreaks({ persona, plan, artists }) {
  const breaks = [];
  const opener = plan.tracks[0];
  if (opener) {
    breaks.push({
      afterTrack: 0,
      kind: "intro",
      text: `${persona.name} on HALO ${persona.homeRoom}. ${plan.tracks.length} records tonight, opening with ${opener.title} by ${opener.artistName}.`,
      signalKeys: ["persona.name", "set.track_count", `track.${opener.trackId}.title`]
    });
  }
  const spotlight = artists.find(artist => artist.followers > 0 || artist.plays30d > 0);
  if (spotlight) {
    const position = plan.tracks.findIndex(track => track.artistSlug === spotlight.slug);
    if (position >= 0) {
      breaks.push({
        afterTrack: position + 1,
        kind: "artist-note",
        text: `That was ${spotlight.artistName}, played ${spotlight.plays30d} times on HALO in the last thirty days.`,
        signalKeys: [`artist.${spotlight.slug}.name`, `artist.${spotlight.slug}.plays_30d`]
      });
    }
  }
  const closer = plan.tracks[plan.tracks.length - 1];
  if (closer && plan.tracks.length > 1) {
    breaks.push({
      afterTrack: plan.tracks.length - 1,
      kind: "outro",
      text: `Last one from me. ${closer.title} by ${closer.artistName}, and the rotation carries on after it.`,
      signalKeys: [`track.${closer.trackId}.title`, `track.${closer.trackId}.artist`]
    });
  }
  return breaks;
}

const TALK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["talkBreaks"],
  properties: {
    talkBreaks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["afterTrack", "kind", "text", "signalKeys"],
        properties: {
          afterTrack: { type: "number" },
          kind: { type: "string", enum: ["intro", "segue", "artist-note", "station-id", "outro"] },
          text: { type: "string" },
          signalKeys: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

function talkSystemPrompt(persona) {
  return `You are ${persona.name}, a resident DJ on HALO Radio. Lane: ${persona.lane}. Voice: ${persona.voice}

You are writing the short spoken links between records for a set that has already been planned. You are not choosing the music and you are not performing the mix.

Every claim you make must be traceable to the supplied signal index. Cite the exact signal keys you used in signalKeys. If you cannot support a sentence with a key, do not write the sentence. Never invent a listener count, a chart position, a label, a release date, a tour, a quote, or anything an artist has said.

Write between two and five links for the whole hour. Radio talk is short: one or two sentences each. Say something about the record or the artist that the room would not otherwise know. Do not greet the audience more than once, do not read out the entire running order, and never talk over the point of a record.

Return JSON only.`;
}

/**
 * Level 4 and above write their own links. Inference is bounded and optional: if it fails, the
 * resident falls back to its Host-level template lines rather than going silent.
 */
export async function composeTalkBreaks({ persona, plan, artists, signalIndex }) {
  const capabilities = capabilitiesForLevel(persona.level);
  if (!capabilities.speaks) {
    return { talkBreaks: [], kept: 0, dropped: 0, model: "", usedFallback: false, errorSummary: "" };
  }

  const knownKeys = new Set(Object.keys(signalIndex));
  const fallback = () => {
    const grounded = templateTalkBreaks({ persona, plan, artists })
      .map(item => groundTalkBreak(item, knownKeys, plan.tracks.length))
      .filter(Boolean);
    return { talkBreaks: grounded, kept: grounded.length, dropped: 0 };
  };

  if (!capabilities.writesOwnTalkBreaks) {
    return { ...fallback(), model: "", usedFallback: false, errorSummary: "" };
  }

  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create(
      {
        model: PERSONA_MODEL,
        max_completion_tokens: 900,
        messages: [
          { role: "system", content: talkSystemPrompt(persona) },
          {
            role: "user",
            content: JSON.stringify({
              room: persona.homeRoom,
              energyArc: plan.arc,
              runningOrder: plan.tracks.map(track => ({
                position: track.position,
                trackId: track.trackId,
                title: track.title,
                artist: track.artistName,
                phase: track.phase
              })),
              signalIndex
            })
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "halo_radio_persona_talk", strict: true, schema: TALK_SCHEMA }
        }
      },
      { signal: AbortSignal.timeout(20_000) }
    );

    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    const proposed = Array.isArray(parsed.talkBreaks) ? parsed.talkBreaks.slice(0, 8) : [];
    const grounded = proposed
      .map(item => groundTalkBreak(item, knownKeys, plan.tracks.length))
      .filter(Boolean)
      .sort((first, second) => first.afterTrack - second.afterTrack);

    // A model run that survives nothing is worse than not having spoken: fall back to the
    // template lines so the hour still has a host.
    if (!grounded.length) {
      const templated = fallback();
      return { ...templated, dropped: proposed.length, model: PERSONA_MODEL, usedFallback: true, errorSummary: "no grounded lines survived" };
    }

    return {
      talkBreaks: grounded,
      kept: grounded.length,
      dropped: proposed.length - grounded.length,
      model: PERSONA_MODEL,
      usedFallback: false,
      errorSummary: ""
    };
  } catch (error) {
    const templated = fallback();
    return {
      ...templated,
      model: PERSONA_MODEL,
      usedFallback: true,
      errorSummary: error instanceof Error ? error.message.slice(0, 1000) : "unknown error"
    };
  }
}

/**
 * Craft and reach, computed here and never asked of a model, so the same numbers always produce the
 * same score and a resident can be told exactly what moved it.
 *
 * Retention is indexed against the room's own baseline over the same window. Matching the room
 * scores 0.5; roughly doubling it scores 1. That is what stops a 3am chill resident from being
 * permanently outranked by a Friday peak-hour slot.
 */
export function evaluatePersonaSignals(signals) {
  const setsAired = Math.max(0, Number(signals.setsAired) || 0);
  const tuneIns = Math.max(0, Number(signals.tuneIns) || 0);
  const listenerMinutes = Math.max(0, Number(signals.listenerMinutes) || 0);
  const minutesOnAir = Math.max(0, Number(signals.minutesOnAir) || 0);
  const skips = Math.max(0, Number(signals.skips) || 0);
  const uniqueListeners = Math.max(0, Number(signals.uniqueListeners) || 0);
  const follows = Math.max(0, Number(signals.follows) || 0);
  const subscriptions = Math.max(0, Number(signals.subscriptions) || 0);
  const transitionCount = Math.max(0, Number(signals.transitionCount) || 0);
  const transitionOutcomeScore = clamp(Number(signals.transitionOutcomeScore) || 0, 0, 100);
  const transitionPredictionAccuracy = clamp(Number(signals.transitionPredictionAccuracy) || 0, 0, 100);
  const externalSignalCount = Math.max(0, Number(signals.externalSignalCount) || 0);
  const externalEngagementScore = clamp(Number(signals.externalEngagementScore) || 0, 0, 100);
  const roomListenerMinutes = Math.max(0, Number(signals.roomListenerMinutes) || 0);
  const roomRetention = clamp01(Number(signals.roomRetention) || 0);
  const measured = setsAired > 0 && tuneIns > 0 && minutesOnAir > 0;

  if (!measured) {
    return {
      measured: false,
      retention: 0,
      craftScore: 0,
      reachScore: 0,
      experienceDelta: 0,
      rationale:
        setsAired > 0
          ? "Sets aired in this window but no listening was recorded against them, so craft cannot be scored yet."
          : "No sets aired in this window."
    };
  }

  const averageSetMinutes = minutesOnAir / setsAired;
  const retention = clamp01(listenerMinutes / Math.max(1, tuneIns * averageSetMinutes));
  const baseline = Math.max(roomRetention, 0.05);
  const retentionIndex = clamp01(retention / baseline / 2);
  const holdRate = clamp01(1 - skips / Math.max(1, tuneIns));
  const transitionCraft = transitionOutcomeScore / 100;
  const craftScore = Math.round(100 * (
    transitionCount > 0
      ? 0.52 * retentionIndex + 0.28 * holdRate + 0.2 * transitionCraft
      : 0.65 * retentionIndex + 0.35 * holdRate
  ));

  const share = clamp01(listenerMinutes / Math.max(1, roomListenerMinutes));
  const audience = clamp01(uniqueListeners / 25);
  const pull = clamp01((follows + subscriptions) / 8);
  const reachScore = Math.round(100 * (
    externalSignalCount > 0
      ? 0.4 * share + 0.3 * audience + 0.15 * pull + 0.15 * (externalEngagementScore / 100)
      : 0.45 * share + 0.35 * audience + 0.2 * pull
  ));

  const experienceDelta = Math.round(setsAired * 8 + craftScore * 0.5 + reachScore * 0.2 + Math.min(20, transitionCount) * 0.5);

  return {
    measured: true,
    retention: Math.round(retention * 10000) / 10000,
    craftScore,
    reachScore,
    experienceDelta,
    rationale: `${setsAired} set${setsAired === 1 ? "" : "s"} aired. Listeners held ${Math.round(retention * 100)}% of the hour against a room baseline of ${Math.round(baseline * 100)}%, with ${skips} skip${skips === 1 ? "" : "s"} across ${tuneIns} tune-in${tuneIns === 1 ? "" : "s"}.${transitionCount ? ` ${transitionCount} measured transition${transitionCount === 1 ? "" : "s"} averaged ${Math.round(transitionOutcomeScore)}% audience outcome with ${Math.round(transitionPredictionAccuracy)}% prediction accuracy.` : ""}${externalSignalCount ? ` ${externalSignalCount} authorized external signal${externalSignalCount === 1 ? "" : "s"} contributed a normalized ${Math.round(externalEngagementScore)}% engagement score.` : ""}`
  };
}

/** Idle residents lose ground. A number that can only rise stops meaning anything. */
export function applyExperienceDecay(experience, measured) {
  if (measured) return Math.max(0, Math.round(experience));
  return Math.max(0, Math.round(experience * 0.92));
}

export function serializePersona(row, { includeInternals = false } = {}) {
  if (!row) return null;
  const level = Number(row.level) || 1;
  const experience = Number(row.experience) || 0;
  const craftScore = Number(row.craft_score) || 0;
  const next = nextLevelTarget(level);
  const payload = {
    id: row.id,
    name: row.name,
    tagline: row.tagline || "",
    lane: row.lane || "",
    homeRoom: row.home_room,
    bpmMin: Number(row.bpm_min),
    bpmMax: Number(row.bpm_max),
    transitionPalette: Array.isArray(row.transition_palette) ? row.transition_palette : [],
    signatureMove: row.signature_move || "",
    accentColor: row.accent_color || "#f4f4f5",
    status: row.status,
    level,
    levelTitle: PERSONA_LEVELS[level - 1]?.title || "Selector",
    unlocks: PERSONA_LEVELS[level - 1]?.unlocks || "",
    capabilities: capabilitiesForLevel(level),
    experience,
    craftScore,
    reachScore: Number(row.reach_score) || 0,
    setsAired: Number(row.sets_aired) || 0,
    lastAiredAt: row.last_aired_at ? new Date(row.last_aired_at).toISOString() : null,
    nextLevel: next
      ? {
          level: next.level,
          title: next.title,
          unlocks: next.unlocks,
          experienceNeeded: Math.max(0, next.minExperience - experience),
          craftNeeded: Math.max(0, Math.round(next.minCraft - craftScore))
        }
      : null
  };
  if (includeInternals) payload.voice = row.voice || "";
  return payload;
}

export function serializePersonaSet(row, { includeTalk = true } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    personaId: row.persona_id,
    room: row.room,
    showId: row.show_id || "",
    plannedFor: new Date(row.planned_for).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    status: row.status,
    energyArc: row.energy_arc,
    tracks: Array.isArray(row.tracks) ? row.tracks : [],
    talkBreaks: includeTalk && Array.isArray(row.talk_breaks) ? row.talk_breaks : [],
    talkLinesKept: Number(row.talk_lines_kept) || 0,
    talkLinesDropped: Number(row.talk_lines_dropped) || 0,
    model: row.model || "",
    usedFallback: Boolean(row.used_fallback),
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    airedAt: row.aired_at ? new Date(row.aired_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

export async function loadPersonas(db) {
  const rows = await db.sql`
    SELECT * FROM halo_radio_personas
    WHERE status <> 'retired'
    ORDER BY level DESC, experience DESC, id ASC
  `;
  return rows;
}

async function loadRotationTracks(db, room) {
  return db.sql`
    SELECT id, title, artist_name, room, genre, bpm, musical_key, duration_seconds, votes_up, votes_down, play_count
    FROM halo_radio_tracks
    WHERE status = 'rotation' AND room = ${room}
    ORDER BY votes_up DESC, created_at DESC
    LIMIT 200
  `;
}

/**
 * Plans one hour and stores it as a proposal. Nothing here writes to the schedule, the play log, or
 * the stream: the row it creates is `planned` and stays that way until an owner approves it.
 */
export async function planPersonaSet(db, { personaId, plannedFor, durationMinutes = 60, showId = null, room = "" }) {
  const personaRows = await db.sql`SELECT * FROM halo_radio_personas WHERE id = ${personaId} LIMIT 1`;
  const personaRow = personaRows[0];
  if (!personaRow) return null;

  const persona = serializePersona(personaRow, { includeInternals: true });
  const capabilities = capabilitiesForLevel(persona.level);
  const targetRoom = room && capabilities.playsOutsideHomeRoom ? room : persona.homeRoom;
  const slot = new Date(plannedFor);
  if (Number.isNaN(slot.getTime())) return null;

  const [trackRows, recentPlayRows, stationRows] = await Promise.all([
    loadRotationTracks(db, targetRoom),
    db.sql`
      SELECT DISTINCT title, artist_name
      FROM halo_radio_play_history
      WHERE room = ${targetRoom} AND started_at >= NOW() - INTERVAL '3 days'
      LIMIT 100
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'rotation')::int AS rotation_tracks,
        COUNT(DISTINCT artist_name) FILTER (WHERE status = 'rotation')::int AS artists_in_rotation
      FROM halo_radio_tracks
    `
  ]);

  const tracks = trackRows.map(row => ({
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    artistSlug: "",
    bpm: row.bpm,
    musicalKey: row.musical_key,
    genre: row.genre,
    durationSeconds: Number(row.duration_seconds) || 0,
    votesUp: Number(row.votes_up) || 0,
    votesDown: Number(row.votes_down) || 0,
    playCount: Number(row.play_count) || 0
  }));

  const recentTitles = new Set(recentPlayRows.map(row => `${row.title}|${row.artist_name}`.toLowerCase()));
  const recentTrackIds = tracks
    .filter(track => recentTitles.has(`${track.title}|${track.artistName}`.toLowerCase()))
    .map(track => track.id);

  const seed = seedForSlot(persona.id, slot);
  const plan = buildSetPlan({ persona, tracks, durationMinutes, seed, recentTrackIds });
  if (!plan.tracks.length) return { persona, plan, stored: null, reason: "no_rotation_tracks" };

  // Artist facts are read only for artists actually in the running order, so the talk-break index
  // can never reference someone this hour is not playing.
  const artistNames = [...new Set(plan.tracks.map(track => track.artistName))].slice(0, 24);
  const artistRows = artistNames.length
    ? await db.sql`
        SELECT
          page.slug, page.artist_name, page.release_title,
          (SELECT COUNT(*)::int FROM halo_artist_follows follow WHERE follow.artist_slug = page.slug) AS followers,
          (SELECT COUNT(*)::int FROM halo_radio_play_history play
            WHERE play.artist_slug = page.slug AND play.started_at >= NOW() - INTERVAL '30 days') AS plays_30d
        FROM halo_artist_pages page
        WHERE page.status = 'published' AND lower(page.artist_name) = ANY(${artistNames.map(name => name.toLowerCase())}::text[])
        LIMIT 24
      `
    : [];

  const artists = artistRows.map(row => ({
    slug: row.slug,
    artistName: row.artist_name,
    releaseTitle: row.release_title || "",
    followers: Number(row.followers) || 0,
    plays30d: Number(row.plays_30d) || 0
  }));

  // Link running-order entries back to artist rooms where the names match a published page.
  const slugByName = new Map(artists.map(artist => [artist.artistName.toLowerCase(), artist.slug]));
  for (const track of plan.tracks) {
    track.artistSlug = slugByName.get(String(track.artistName).toLowerCase()) || "";
  }

  let show = null;
  if (showId) {
    const showRows = await db.sql`
      SELECT id, title, start_time_utc,
        (SELECT COUNT(*)::int FROM halo_radio_show_subscriptions subscription WHERE subscription.show_id = halo_radio_shows.id) AS subscriber_count
      FROM halo_radio_shows WHERE id = ${showId} LIMIT 1
    `;
    if (showRows[0]) {
      show = {
        id: showRows[0].id,
        title: showRows[0].title,
        startsAt: slot.toISOString(),
        subscriberCount: Number(showRows[0].subscriber_count) || 0
      };
    }
  }

  const station = {
    rotationTracks: Number(stationRows[0]?.rotation_tracks) || 0,
    artistsInRotation: Number(stationRows[0]?.artists_in_rotation) || 0
  };
  const signalIndex = buildSignalIndex({ persona, plan, artists, station, show });
  const talk = await composeTalkBreaks({ persona, plan, artists, signalIndex });

  const id = randomUUID();
  const signals = {
    station,
    artists,
    candidatesConsidered: plan.candidatesConsidered,
    plannedMinutes: plan.plannedMinutes,
    shortOfSlot: plan.shortOfSlot,
    signalKeyCount: Object.keys(signalIndex).length
  };

  const rows = await db.sql`
    INSERT INTO halo_radio_persona_sets (
      id, persona_id, room, show_id, planned_for, duration_minutes, status, energy_arc, seed,
      tracks, talk_breaks, signals, talk_lines_kept, talk_lines_dropped, model, used_fallback, error_summary
    )
    VALUES (
      ${id}, ${persona.id}, ${targetRoom}, ${show?.id || null}, ${slot.toISOString()}, ${durationMinutes},
      'planned', ${plan.arc}, ${seed}, ${JSON.stringify(plan.tracks)}::jsonb, ${JSON.stringify(talk.talkBreaks)}::jsonb,
      ${JSON.stringify(signals)}::jsonb, ${talk.kept}, ${talk.dropped}, ${talk.model}, ${talk.usedFallback}, ${talk.errorSummary}
    )
    ON CONFLICT (persona_id, planned_for) DO UPDATE SET
      room = EXCLUDED.room,
      show_id = EXCLUDED.show_id,
      duration_minutes = EXCLUDED.duration_minutes,
      energy_arc = EXCLUDED.energy_arc,
      seed = EXCLUDED.seed,
      tracks = EXCLUDED.tracks,
      talk_breaks = EXCLUDED.talk_breaks,
      signals = EXCLUDED.signals,
      talk_lines_kept = EXCLUDED.talk_lines_kept,
      talk_lines_dropped = EXCLUDED.talk_lines_dropped,
      model = EXCLUDED.model,
      used_fallback = EXCLUDED.used_fallback,
      error_summary = EXCLUDED.error_summary,
      updated_at = NOW()
    WHERE halo_radio_persona_sets.status = 'planned'
    RETURNING *
  `;

  // An approved or already-aired plan is never silently rewritten underneath the owner.
  if (!rows.length) return { persona, plan, stored: null, reason: "already_approved" };
  return { persona, plan, stored: serializePersonaSet(rows[0]), talk, reason: "" };
}

export async function approvePersonaSet(db, setId, memberId) {
  const rows = await db.sql`
    UPDATE halo_radio_persona_sets
    SET status = 'approved', approved_by_member_id = ${memberId}, approved_at = NOW(), updated_at = NOW()
    WHERE id = ${setId}::uuid AND status = 'planned'
    RETURNING *
  `;
  return rows[0] ? serializePersonaSet(rows[0]) : null;
}

export async function updatePersonaSetStatus(db, setId, status) {
  const allowed = new Set(["skipped", "archived"]);
  if (!allowed.has(status)) return null;
  const rows = await db.sql`
    UPDATE halo_radio_persona_sets
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${setId}::uuid AND status IN ('planned', 'approved')
    RETURNING *
  `;
  return rows[0] ? serializePersonaSet(rows[0]) : null;
}

/**
 * Marks an approved set as aired and logs its running order into the station's play history, which
 * is what later makes the hour measurable against listening telemetry.
 */
export async function markPersonaSetAired(db, setId, memberId) {
  const rows = await db.sql`
    UPDATE halo_radio_persona_sets
    SET status = 'aired', aired_at = NOW(), updated_at = NOW()
    WHERE id = ${setId}::uuid AND status = 'approved'
    RETURNING *
  `;
  const set = rows[0];
  if (!set) return null;

  const tracks = Array.isArray(set.tracks) ? set.tracks : [];
  const plannedFor = new Date(set.planned_for);
  for (const track of tracks) {
    const startedAt = new Date(plannedFor.getTime() + (Number(track.startsAtSecond) || 0) * 1000);
    await db.sql`
      INSERT INTO halo_radio_play_history (
        room, title, artist_name, artist_slug, source, started_at, duration_seconds, created_by_member_id
      )
      VALUES (
        ${set.room}, ${String(track.title || "").slice(0, 140)}, ${String(track.artistName || "").slice(0, 140)},
        ${track.artistSlug || null}, ${`persona:${set.persona_id}`}, ${startedAt.toISOString()},
        ${Math.max(0, Math.min(7200, Number(track.durationSeconds) || 0))}, ${memberId}
      )
    `;
  }

  await db.sql`
    UPDATE halo_radio_personas
    SET sets_aired = sets_aired + 1, last_aired_at = NOW(), updated_at = NOW()
    WHERE id = ${set.persona_id}
  `;

  return serializePersonaSet(set);
}

/**
 * Reads what actually happened during each persona's aired hours and recomputes craft, reach,
 * experience, and level. Everything is measured against the room's own baseline over the same
 * window, and a level is allowed to fall.
 */
export async function evaluatePersonas(db, { windowDays = 30 } = {}) {
  const interval = `${clamp(windowDays, 7, 180)} days`;
  const personaRows = await loadPersonas(db);
  const evaluatedOn = new Date().toISOString().slice(0, 10);
  const results = [];

  for (const personaRow of personaRows) {
    const persona = serializePersona(personaRow);

    const airedRows = await db.sql`
      SELECT id, room, planned_for, duration_minutes, aired_at
      FROM halo_radio_persona_sets
      WHERE persona_id = ${persona.id}
        AND status = 'aired'
        AND planned_for >= NOW() - ${interval}::interval
      ORDER BY planned_for DESC
      LIMIT 120
    `;

    const windows = airedRows.map(row => ({
      room: row.room,
      startsAt: new Date(row.planned_for).toISOString(),
      endsAt: new Date(new Date(row.planned_for).getTime() + Number(row.duration_minutes || 60) * 60_000).toISOString()
    }));
    const minutesOnAir = airedRows.reduce((total, row) => total + Number(row.duration_minutes || 60), 0);

    let listening = {};
    let roomTotals = {};
    if (windows.length) {
      // Listening is attributed to a persona only inside the exact windows its sets were on air.
      // The window match is a semi-join so an event is counted once even if two windows overlap.
      const listeningRows = await db.sql`
        SELECT
          COUNT(*) FILTER (WHERE event.event_name = 'radio_tune_in')::int AS tune_ins,
          COUNT(*) FILTER (WHERE event.event_name = 'radio_tune_out')::int AS tune_outs,
          COUNT(*) FILTER (WHERE event.event_name = 'radio_skip')::int AS skips,
          COUNT(DISTINCT event.anonymous_id)::int AS unique_listeners,
          COALESCE(SUM(
            CASE
              WHEN event.event_name = 'radio_heartbeat' AND jsonb_typeof(event.metadata->'seconds') = 'number'
                THEN (event.metadata->>'seconds')::numeric
              ELSE 0
            END
          ), 0) AS listened_seconds
        FROM analytics_events event
        WHERE event.event_name IN ('radio_tune_in', 'radio_heartbeat', 'radio_tune_out', 'radio_skip')
          AND event.created_at >= NOW() - ${interval}::interval
          AND EXISTS (
            SELECT 1
            FROM jsonb_to_recordset(${JSON.stringify(windows)}::jsonb)
              AS slot(room text, "startsAt" timestamptz, "endsAt" timestamptz)
            WHERE event.created_at >= slot."startsAt"
              AND event.created_at < slot."endsAt"
              AND COALESCE(NULLIF(event.metadata->>'room', ''), 'unknown') = slot.room
          )
      `;
      listening = listeningRows[0] || {};

      const roomRows = await db.sql`
        SELECT
          COUNT(*) FILTER (WHERE event_name = 'radio_tune_in')::int AS tune_ins,
          COALESCE(SUM(
            CASE
              WHEN event_name = 'radio_heartbeat' AND jsonb_typeof(metadata->'seconds') = 'number'
                THEN (metadata->>'seconds')::numeric
              ELSE 0
            END
          ), 0) AS listened_seconds
        FROM analytics_events
        WHERE created_at >= NOW() - ${interval}::interval
          AND event_name IN ('radio_tune_in', 'radio_heartbeat')
          AND COALESCE(NULLIF(metadata->>'room', ''), 'unknown') = ${persona.homeRoom}
      `;
      roomTotals = roomRows[0] || {};
    }

    // A follow counts for a persona only when that artist was actually played by this persona
    // inside the same on-air window. Every follow gained during the hour would over-credit it.
    const followRows = windows.length
      ? await db.sql`
          SELECT
            (
              SELECT COUNT(*)::int
              FROM halo_artist_follows follow
              WHERE EXISTS (
                SELECT 1
                FROM jsonb_to_recordset(${JSON.stringify(windows)}::jsonb)
                  AS slot(room text, "startsAt" timestamptz, "endsAt" timestamptz)
                WHERE follow.created_at >= slot."startsAt"
                  AND follow.created_at < slot."endsAt"
                  AND EXISTS (
                    SELECT 1
                    FROM halo_radio_play_history play
                    WHERE play.artist_slug = follow.artist_slug
                      AND play.source = ${`persona:${persona.id}`}
                      AND play.started_at >= slot."startsAt"
                      AND play.started_at < slot."endsAt"
                  )
              )
            ) AS follows,
            (
              SELECT COUNT(*)::int
              FROM halo_radio_show_subscriptions subscription
              JOIN halo_radio_shows show ON show.id = subscription.show_id
              WHERE show.persona_id = ${persona.id}
                AND subscription.created_at >= NOW() - ${interval}::interval
            ) AS subscriptions
        `
      : [];

    const listenerMinutes = Math.round((Number(listening.listened_seconds || 0) / 60) * 100) / 100;
    const roomListenerMinutes = Math.round((Number(roomTotals.listened_seconds || 0) / 60) * 100) / 100;
    const roomTuneIns = Number(roomTotals.tune_ins || 0);
    // The room's own average hold, used as the baseline a resident is indexed against.
    const roomRetention = roomTuneIns > 0 ? clamp01(roomListenerMinutes / Math.max(1, roomTuneIns * 60)) : 0;
    const transitionRows = await db.sql`
      SELECT COUNT(*)::int AS transition_count,
        COALESCE(AVG(outcome_score), 0)::numeric(5,2) AS outcome_score,
        COALESCE(AVG(GREATEST(0, 100 - ABS(predicted_score - outcome_score))), 0)::numeric(5,2) AS prediction_accuracy
      FROM halo_dj_transition_observations
      WHERE persona_id = ${persona.id}
        AND performed_at >= NOW() - ${interval}::interval
        AND outcome_score IS NOT NULL
    `;
    const externalRows = await db.sql`
      SELECT COUNT(*)::int AS signal_count,
        COALESCE(AVG(LEAST(100,
          CASE metric_name
            WHEN 'saves' THEN metric_value / GREATEST(audience_size, metric_value, 1) * 260
            WHEN 'shares' THEN metric_value / GREATEST(audience_size, metric_value, 1) * 300
            WHEN 'completions' THEN metric_value / GREATEST(audience_size, metric_value, 1) * 120
            WHEN 'likes' THEN metric_value / GREATEST(audience_size, metric_value, 1) * 180
            WHEN 'comments' THEN metric_value / GREATEST(audience_size, metric_value, 1) * 240
            ELSE metric_value / GREATEST(audience_size, metric_value, 1) * 100
          END
        )), 0)::numeric(5,2) AS engagement_score
      FROM halo_dj_external_signals
      WHERE persona_id = ${persona.id}
        AND observed_at >= NOW() - ${interval}::interval
    `;

    const signals = {
      setsAired: airedRows.length,
      minutesOnAir,
      listenerMinutes,
      tuneIns: Number(listening.tune_ins || 0),
      tuneOuts: Number(listening.tune_outs || 0),
      skips: Number(listening.skips || 0),
      uniqueListeners: Number(listening.unique_listeners || 0),
      follows: Number(followRows[0]?.follows || 0),
      subscriptions: Number(followRows[0]?.subscriptions || 0),
      transitionCount: Number(transitionRows[0]?.transition_count || 0),
      transitionOutcomeScore: Number(transitionRows[0]?.outcome_score || 0),
      transitionPredictionAccuracy: Number(transitionRows[0]?.prediction_accuracy || 0),
      externalSignalCount: Number(externalRows[0]?.signal_count || 0),
      externalEngagementScore: Number(externalRows[0]?.engagement_score || 0),
      roomListenerMinutes,
      roomRetention
    };

    const evaluation = evaluatePersonaSignals(signals);
    const experienceBefore = persona.experience;
    const experienceAfter = applyExperienceDecay(experienceBefore + evaluation.experienceDelta, evaluation.measured);
    const levelBefore = persona.level;
    const levelAfter = levelFor(experienceAfter, evaluation.craftScore);

    await db.sql`
      INSERT INTO halo_radio_persona_scores (
        persona_id, evaluated_on, window_days, sets_aired, listener_minutes, room_listener_minutes,
        tune_ins, tune_outs, skips, unique_listeners, follows, subscriptions, retention,
        craft_score, reach_score, experience_before, experience_after, level_before, level_after,
        measured, rationale, signals
      )
      VALUES (
        ${persona.id}, ${evaluatedOn}::date, ${windowDays}, ${signals.setsAired}, ${signals.listenerMinutes},
        ${signals.roomListenerMinutes}, ${signals.tuneIns}, ${signals.tuneOuts}, ${signals.skips},
        ${signals.uniqueListeners}, ${signals.follows}, ${signals.subscriptions}, ${evaluation.retention},
        ${evaluation.craftScore}, ${evaluation.reachScore}, ${experienceBefore}, ${experienceAfter},
        ${levelBefore}, ${levelAfter}, ${evaluation.measured}, ${evaluation.rationale},
        ${JSON.stringify(signals)}::jsonb
      )
      ON CONFLICT (persona_id, evaluated_on) DO UPDATE SET
        window_days = EXCLUDED.window_days,
        sets_aired = EXCLUDED.sets_aired,
        listener_minutes = EXCLUDED.listener_minutes,
        room_listener_minutes = EXCLUDED.room_listener_minutes,
        tune_ins = EXCLUDED.tune_ins,
        tune_outs = EXCLUDED.tune_outs,
        skips = EXCLUDED.skips,
        unique_listeners = EXCLUDED.unique_listeners,
        follows = EXCLUDED.follows,
        subscriptions = EXCLUDED.subscriptions,
        retention = EXCLUDED.retention,
        craft_score = EXCLUDED.craft_score,
        reach_score = EXCLUDED.reach_score,
        experience_after = EXCLUDED.experience_after,
        level_after = EXCLUDED.level_after,
        measured = EXCLUDED.measured,
        rationale = EXCLUDED.rationale,
        signals = EXCLUDED.signals
    `;

    await db.sql`
      UPDATE halo_radio_personas
      SET level = ${levelAfter}, experience = ${experienceAfter}, craft_score = ${evaluation.craftScore},
        reach_score = ${evaluation.reachScore}, evaluated_at = NOW(), updated_at = NOW()
      WHERE id = ${persona.id}
    `;

    await db.sql`
      INSERT INTO halo_radio_persona_memory (persona_id, memory_key, note, evidence, observations)
      VALUES (
        ${persona.id}, ${`evaluation:${evaluatedOn}`}, ${evaluation.rationale},
        ${JSON.stringify({ ...signals, craftScore: evaluation.craftScore, reachScore: evaluation.reachScore })}::jsonb, 1
      )
      ON CONFLICT (persona_id, memory_key) DO UPDATE SET
        note = EXCLUDED.note,
        evidence = EXCLUDED.evidence,
        observations = halo_radio_persona_memory.observations + 1,
        updated_at = NOW()
    `;

    results.push({
      personaId: persona.id,
      name: persona.name,
      measured: evaluation.measured,
      craftScore: evaluation.craftScore,
      reachScore: evaluation.reachScore,
      experienceBefore,
      experienceAfter,
      levelBefore,
      levelAfter,
      rationale: evaluation.rationale,
      signals
    });
  }

  return { evaluatedOn, windowDays, results };
}

/**
 * Persona-hosted shows starting inside the window, with whatever plan already exists for each.
 * The scheduler uses this to decide what still needs planning.
 */
export async function upcomingPersonaSlots(db, hoursAhead = 36) {
  const hours = clamp(hoursAhead, 1, 336);
  const rows = await db.sql`
    SELECT id, persona_id, room, title, day_of_week, start_time_utc, duration_minutes, status
    FROM halo_radio_shows
    WHERE persona_id IS NOT NULL AND status = 'published'
    ORDER BY day_of_week, start_time_utc
  `;

  const now = new Date();
  const limit = new Date(now.getTime() + hours * 3_600_000);
  const slots = [];

  for (const row of rows) {
    const [hour, minute] = String(row.start_time_utc || "00:00").split(":").map(Number);
    const candidate = new Date(now);
    candidate.setUTCHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0);
    const offset = (Number(row.day_of_week) - now.getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
    if (candidate > limit) continue;
    slots.push({
      showId: row.id,
      personaId: row.persona_id,
      room: row.room,
      title: row.title,
      durationMinutes: Number(row.duration_minutes) || 60,
      plannedFor: candidate.toISOString()
    });
  }

  return slots.sort((first, second) => first.plannedFor.localeCompare(second.plannedFor));
}

/** The roster as the radio page and the station desk read it. */
export async function loadPersonaDashboard(db, { canManage = false } = {}) {
  const personaRows = await loadPersonas(db);
  const setRows = await db.sql`
    SELECT * FROM halo_radio_persona_sets
    WHERE planned_for >= NOW() - INTERVAL '2 days'
      AND (${canManage} OR status IN ('approved', 'aired'))
    ORDER BY planned_for ASC
    LIMIT 40
  `;
  const scoreRows = await db.sql`
    SELECT DISTINCT ON (persona_id) *
    FROM halo_radio_persona_scores
    ORDER BY persona_id, evaluated_on DESC
  `;
  const slots = await upcomingPersonaSlots(db, 168);

  const latestScore = new Map(scoreRows.map(row => [row.persona_id, row]));

  return {
    canManage,
    levels: PERSONA_LEVELS,
    personas: personaRows.map(row => {
      const persona = serializePersona(row);
      const score = latestScore.get(row.id);
      return {
        ...persona,
        nextSlot: slots.find(slot => slot.personaId === row.id) || null,
        latestEvaluation: score
          ? {
              evaluatedOn: String(score.evaluated_on).slice(0, 10),
              measured: Boolean(score.measured),
              setsAired: Number(score.sets_aired) || 0,
              listenerMinutes: Number(score.listener_minutes) || 0,
              retention: Number(score.retention) || 0,
              craftScore: Number(score.craft_score) || 0,
              reachScore: Number(score.reach_score) || 0,
              levelBefore: Number(score.level_before) || 1,
              levelAfter: Number(score.level_after) || 1,
              rationale: score.rationale || ""
            }
          : null
      };
    }),
    sets: setRows.map(row => serializePersonaSet(row)),
    upcomingSlots: slots.slice(0, 12)
  };
}
