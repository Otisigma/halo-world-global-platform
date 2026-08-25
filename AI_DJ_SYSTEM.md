# HALO AI DJ System

HALO treats AI as a four-person booth crew rather than a random autoplay button. The live deck remains operator-controlled while a music director, mix engineer, crowd reader, and quality controller rank candidates, explain their reasoning, prepare the inactive deck, and fall back to a local performance engine whenever cloud analysis is unavailable.

## Protected song policy

- **Clean play first:** Listening Party protects roughly 72–90% of a known record, Chill protects roughly 84–96%, and Club can respond earlier at roughly 52–76%. Unknown-duration tracks use mode-specific phrase-aligned fallbacks.
- **One purposeful idea:** each handoff commits to a long blend, vocal handoff, echo-out, filter sweep, percussion bridge, or drop swap rather than stacking unrelated effects.
- **Phrase-safe exit:** transition lengths are calculated from the live BPM with adaptive 8-, 16-, 24-, or 32-bar architectures and style-specific crossfader curves.
- **Operator freedom:** manual deck, stem, and crossfader controls remain available at all times; the timing lock applies to automated performance decisions.

## HALO BREATH

Every resident and deck transition uses the same five-stage musical architecture: **Release → Breath → Discovery → Anticipation → Reveal**. The outgoing vocal or signature hook resolves first. A non-vocal bridge then carries drums, one bassline, a percussion loop, atmosphere, a restrained vocal memory, or the concealed incoming groove. Track B's rhythm and texture can appear during Discovery, but its lead vocal and main hook stay muted until the Reveal phrase boundary.

The normal vocal-to-vocal gap is 16 bars. The planner extends it to 24–32 bars for emotional, melodic, or Chill transitions and reduces it to 8 bars only when Club energy or arrangement pressure justifies the faster handoff. Recent transition history prevents the same architecture from being chosen consecutively when another safe route exists.

## Performance variation

- Every takeover receives a fresh session seed that changes transition timing and style choices.
- The planner remembers recent moves and removes the last three styles from the next choice whenever alternatives are available.
- DJ HALO uses the full palette and can move into peak-time or experimental characters, DJ BUTTERFLY favors emotional storytelling and melodic vocal handoffs, and DJ ROMY favors near-full-song play, atmosphere, percussion bridges, and echo exits.
- Vocal handoffs preserve the outgoing vocal focus while clearing bass and percussion, then reveal the incoming vocal later in the phrase.
- Echo sends, high-pass and low-pass sweeps, synchronized percussion fills, stem exchanges, and multiple crossfader curves are executed by the deterministic Web Audio engine so timing does not depend on network latency.

## What the system reads

- **Musical compatibility:** tempo distance, Camelot-key relationships, energy movement, genre, and source novelty.
- **Track DNA:** danceability, emotional intensity, darkness, warmth, vocal density, percussion density, bass weight, melodic density, atmosphere, energy role, sonic weather, and protected signature moments.
- **Performance state:** which deck is live, crossfader position, loaded tracks, pitch state, and the prepared queue.
- **Room state:** crowd score, motion, density, response, and the operator's selected intent.
- **Operator intent:** lift, hold, contrast, or peak. This keeps the DJ in control of the story instead of asking the model to guess the entire creative direction.
- **Audience memory:** loved, skipped, room-lifting, groove-holding, and release-vote signals are stored by mode and carried into later decisions.

## HALO modes

The same records should not produce the same set in every context. HALO starts with three operating modes that change selection weights, pacing, transition policy, success criteria, and the amount of space given to each record.

- **Listening Party:** discovery, storytelling, patience, full hooks, emotional recognition, release voting, and hearing the record's signature moment before the mix-out.
- **Club:** groove, bass relationships, percussion, tension, recovery, release, and dancefloor trust.
- **Chill:** warmth, atmosphere, harmonic continuity, low interruption, long-form space, and letting the record approach its natural ending.

Each mode is paired with an energy architecture: Journey, Build, Steady, Wave, Double Peak, Emotional Journey, Sunset, or Afterhours. The active set phase—opening, build, peak, release, or close—places the next decision inside a wider arc instead of treating it as an isolated transition.

## Decision contract

Every recommendation now returns an explicit musical decision rather than only a candidate track:

- **Mix:** prepare a phrase-safe transition because the next record serves the current moment.
- **Hold:** keep the current record in control because vocals, bass, melody, or emotional timing would be damaged by an early transition.
- **Silence:** allow a clean ending because stopping and beginning again creates greater impact than continuous blending.

The recommendation must answer four questions: why this track, why now, why this transition, and what the audience should feel next. It also returns sonic weather, the moment that must be protected, do-not-mix reasons, and a three-track planning horizon with roles and target energy.

## Persistent intelligence

Netlify Database stores four linked layers of learning:

- Track profiles keep confidence-aware DJ DNA without treating subjective analysis as unquestionable fact.
- Sessions preserve mode, energy architecture, and current phase.
- Decisions record the transition purpose, energy movement, sonic weather, set horizon, and explanatory reasoning.
- Audience signals build mode-specific memory from love, lift, hold, skip, and release-vote responses.

The database is the memory layer, not the timing engine. Netlify AI Gateway reasons over bounded candidates and returns structured intent. The browser's deterministic Web Audio engine continues to own playback, phrase timing, EQ, effects, crossfader movement, manual override, and failure-safe local operation.

## Set preflight and rehearsal

The DJ Deck can run both loaded decks and the prepared queue through a complete preflight before air. The deterministic analyzer checks tempo distance, Camelot relationships, energy movement, vocal pressure, bass pressure, arrangement density, and declared stem availability. It can reorder the proposed path for safer handoffs and writes a transition recipe with bars, stem moves, guardrails, warnings, and a quality score for every pair.

Vocal-heavy records default to a stem-aware vocal handoff when separated audio is available. Without safe stems, HALO blocks the continuous blend and recommends a clean break or echo exit. Variation remains seeded, but the seed can choose only among approved recipes and can never override a blocked transition.

Every prepared or performed transition can be attached to the active session and preflight. Audience responses update that transition's outcome score, allowing later persona evaluations to compare predicted and observed results.

## Decision pipeline

1. The browser scores every unloaded candidate using tempo, harmonic, energy, queue, and novelty weights.
2. The best local recommendation appears immediately, so the deck never waits on a network request.
3. On request, Netlify AI Gateway receives a bounded set context and recent transition history. It returns a strict recommendation containing an existing track ID, fit score, transition length, performance style, crossfader curve, vocal-handoff decision, phrase-level brief, and four specialist feedback notes.
4. The operator can queue the recommendation or prepare it on the inactive deck. Preparing matches tempo within the deck's pitch range but does not start playback or move the crossfader.
5. If cloud AI is unavailable, the local recommendation remains active and every performance control continues to work.

## Path to an elite autonomous DJ

The next production stage should replace metadata estimates with real musical analysis: beat-grid confidence, downbeat and phrase detection, loudness, spectral balance, vocal activity, percussion density, key confidence, and section boundaries. These features should be computed ahead of performance and cached with each track.

The transition planner should then evaluate multiple horizons instead of one next song. A strong set planner models a 3–5 track arc, protects recovery tracks, avoids repeating artists and textures, tracks how long the room has stayed at one intensity, and preserves enough harmonic and tempo options to exit any decision.

World-class performance also requires listening after every move. Crowd telemetry should compare predicted and observed response, update confidence, and learn venue-specific preferences without treating raw movement as the only signal. Manual overrides, undoable preparation, confidence displays, and a hard rule against automatic live cuts keep the system safe and musically accountable.

The current browser deck uses frequency shaping to demonstrate stem-like bass, percussion, and vocal moves. Production-quality vocal handoffs require offline stem separation or licensed pre-separated stems, plus beat grids and phrase markers generated before performance. Licensed playback sources, preflight checks, redundant local playback, headphone cue routing, real EQ and channel faders, quantized loops, recording consent, and a complete event log remain essential. The intelligence layer recommends; the deterministic audio engine executes timing-critical actions.
