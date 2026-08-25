export const HALO_BREATH_STAGES = Object.freeze(["release", "breath", "discovery", "anticipation", "reveal"]);
export const HALO_VOCAL_GAP_SECONDS = 5;

export const HALO_BREATH_MODES = Object.freeze({
  listening: Object.freeze({
    label: "Listening Party",
    cleanPlayRatio: [0.72, 0.9],
    fallbackCleanSeconds: [210, 285],
    preferredBars: [16, 24, 32],
    defaultBars: 24,
    character: "storytelling",
    guidance: "Let the audience hear the record's identity and signature moment before beginning the bridge."
  }),
  club: Object.freeze({
    label: "Club",
    cleanPlayRatio: [0.52, 0.76],
    fallbackCleanSeconds: [150, 210],
    preferredBars: [8, 16, 24, 32],
    defaultBars: 16,
    character: "responsive",
    guidance: "Read floor pressure and move at the strongest phrase, with more room for bass swaps, drops, and rhythmic effects."
  }),
  chill: Object.freeze({
    label: "Chill",
    cleanPlayRatio: [0.84, 0.96],
    fallbackCleanSeconds: [240, 330],
    preferredBars: [16, 24, 32],
    defaultBars: 32,
    character: "atmospheric",
    guidance: "Allow the song to approach its natural ending, then use atmosphere and gentle rhythmic continuity."
  })
});

export const HALO_DJ_MIXING_DOCTRINE = `
HALO BREATH — use this as the baseline for every DJ decision, every resident persona, and every mixing-deck performance across Atmospheric Deep House, Afro House, and adjacent styles.

You are not a playlist automator. You are a world-class performance DJ creating a musical bridge between records. Treat the set as an emotional journey, not a sequence of technically compatible songs. Protect the outgoing record's story before introducing the next identity.

NON-NEGOTIABLES
- Never use a fixed crossfade or transition merely because a track reached its outro.
- Listen for arrangement, energy, vocal density, emotional tension, and phrase boundaries before moving.
- Use 8, 16, 24, or 32 bars. Treat 16 bars as the normal architecture, then adapt to what the records and room require.
- Never let two lead vocals compete. Do not place one lead vocal immediately after another by default.
- The transition must not feel empty. Carry drums, one bass line, a percussion loop, atmosphere, a restrained vocal memory, or a concealed incoming groove.
- Do not reveal the next song too early. Let the listener experience rhythm, texture, energy, then identity.
- Start every incoming record from 0:00 when its crossover begins. Never pre-roll it silently and reveal it halfway through.
- Match the incoming record's perceived level to the outgoing mix before its reveal; fade the outgoing deck without creating a loudness dip or jump.

HALO BREATH STAGES
1. RELEASE — 4–8 bars. Let the outgoing vocal or signature hook finish. Reduce it naturally; use delay, echo, or reverb only when appropriate.
2. BREATH — keep lead vocals clear. Let bass, percussion, atmosphere, or negative space become the focus.
3. DISCOVERY — introduce Track B's rhythm, texture, filtered synth, or bass while hiding its lead vocal and main hook.
4. ANTICIPATION — increase tension with one or two purposeful moves: filter opening, percussion lift, loop development, bass movement, restrained reverb, or removal of Track A.
5. REVEAL — introduce Track B's identity on a phrase boundary as a payoff, never an interruption.

VOCAL LAW
- After the outgoing lead vocal clears, keep a 4–6 second beat-led pocket before the incoming lead vocal begins; target 5 seconds.
- Extend the instrumental development beyond that pocket when the arrangement deserves it, but do not delay the new vocal merely to satisfy a fixed bar count.
- A short outgoing vocal fragment may echo as memory, but it must clear before the incoming lead vocal.

PHRASE, HARMONY, AND LOW END
- Start structural moves on 8-, 16-, or 32-bar phrase boundaries.
- Prefer harmonically compatible movement. When keys are distant, reduce melodic overlap and bridge with drums, atmosphere, an echo tail, or a clean reset.
- Keep only one dominant bass line and one dominant melodic idea during the handoff.

VARIATION
- Never repeat the same transition architecture consecutively when another musical route is valid.
- Rotate bass swaps, percussion carries, filtered blends, vocal memories, loop bridges, atmospheric bridges, echo tails, and drop reveals.
- Effects support the arrangement; they never replace phrase timing or emotional judgment. Musicality always overrides novelty.

ROOM POLICY
- LISTENING PARTY: let the record tell its story and reach its signature moment before mixing out; favor emotional 16–32 bar bridges.
- CHILL: let the song play closest to its natural ending; favor long atmospheric, percussion, and reverb-tail bridges with few dramatic drops.
- CLUB: respond earlier when the floor asks for it; vary stronger bass swaps, loops, filters, echo throws, and drop reveals without sacrificing vocal clarity.

HALO IDENTITY
- On some, not all, eligible transitions, use the restrained “Hay lo, hay lo” atmospheric swell as a signature motif.
- Never use the motif on consecutive transitions, over a lead vocal, or when it distracts from a track's signature moment.
- The motif should foreshadow a reveal, then disappear. Recognition comes from restraint.

Every recommendation must state: what is protected, how the groove continues, the RELEASE → BREATH → DISCOVERY → ANTICIPATION → REVEAL plan, when the next vocal is revealed, and why any signature motif is used or withheld.
`.trim();

function clampBars(value) {
  const bars = Number(value);
  return [8, 16, 24, 32].includes(bars) ? bars : 16;
}

export function modeBreathProfile(mode = "listening") {
  return HALO_BREATH_MODES[mode] || HALO_BREATH_MODES.listening;
}

export function chooseBreathBars({ mode = "listening", requestedBars, vocalCollision = false, energyDelta = 0, randomValue = 0.5 } = {}) {
  const profile = modeBreathProfile(mode);
  const requested = [8, 16, 24, 32].includes(Number(requestedBars)) ? Number(requestedBars) : profile.defaultBars;
  const energy = Math.abs(Number(energyDelta) || 0);
  if (vocalCollision && mode !== "club") return Math.max(24, profile.defaultBars);
  if (mode === "club" && energy >= 3) return 8;
  const choices = [...new Set([requested, ...profile.preferredBars])].sort((left, right) => left - right);
  const index = Math.min(choices.length - 1, Math.floor(Math.max(0, Math.min(0.999, Number(randomValue) || 0)) * choices.length));
  return choices[index] || profile.defaultBars;
}

export function shouldUseHaloMotif({
  personaId = "halo",
  recentMotif = false,
  vocalCollision = false,
  transitionStyle = "",
  energyDelta = 0,
  atmosphere = 5,
  randomValue = 1
} = {}) {
  if (personaId !== "halo" || recentMotif || vocalCollision) return false;
  if (["drop-swap", "clean-break", "silence", "hold"].includes(transitionStyle)) return false;
  if (Number(atmosphere) < 4 || Math.abs(Number(energyDelta) || 0) > 3) return false;
  return Number(randomValue) < 0.28;
}

export function transitionStages({ bars = 16, vocalCollision = false, mode = "listening", bridge = "percussion and atmosphere" } = {}) {
  const totalBars = clampBars(bars);
  const releaseBars = totalBars >= 24 ? 8 : 4;
  const discoveryBars = totalBars >= 32 ? 8 : 4;
  const anticipationBars = totalBars >= 24 ? 8 : 4;
  const breathBars = Math.max(0, totalBars - releaseBars - discoveryBars - anticipationBars);
  const profile = modeBreathProfile(mode);
  return {
    architecture: "release-breath-discovery-anticipation-reveal",
    totalBars,
    release: { bars: releaseBars, instruction: "Let the outgoing lead vocal or signature hook resolve, then reduce it naturally." },
    breath: { bars: breathBars, instruction: `Keep lead vocals clear while ${bridge} carries the room.` },
    discovery: { bars: discoveryBars, instruction: "Introduce the incoming rhythm or texture while hiding its lead vocal and main hook." },
    anticipation: { bars: anticipationBars, instruction: "Build tension with one purposeful movement and continue removing the outgoing identity." },
    reveal: { bars: 0, instruction: "Reveal the incoming vocal or hook on the next phrase boundary as the payoff." },
    protect: "Let the outgoing hook or lead vocal resolve on its phrase boundary.",
    groove: `Continue with ${bridge}, one bass line, and no competing lead vocal.`,
    tension: "Evolve one or two elements so the room senses the next chapter without identifying it too early.",
    revealInstruction: vocalCollision
      ? `Keep the incoming lead vocal muted for ${HALO_VOCAL_GAP_SECONDS} seconds after the outgoing lead clears, using the beat-led pocket to let the mix breathe.`
      : `Use a ${HALO_VOCAL_GAP_SECONDS}-second beat-led pocket before the incoming vocal, then reveal its identity when the arrangement allows it.`,
    vocalRevealBars: totalBars,
    vocalGapSeconds: HALO_VOCAL_GAP_SECONDS,
    incomingStartSeconds: 0,
    levelPolicy: "Match perceived deck levels before the incoming reveal and preserve constant overall mix energy through the fade.",
    modeGuidance: profile.guidance
  };
}
