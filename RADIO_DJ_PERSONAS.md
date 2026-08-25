# HALO Radio DJ residents

DJ HALO, DJ BUTTERFLY, and DJ ROMY started as mix styles inside the live deck. They are now station residents: each holds a lane, an earned level, and a set of things it is allowed to do on air. A level is an amount of authority rather than a badge, it is recomputed from what listeners actually did, and it can fall.

The three residents are seeded by the `20260812170000_create-radio-dj-personas` migration with the same lanes, tempo ranges, and transition palettes they already had in `dj-deck.html`, so a resident on air behaves like the version listeners have heard.

| Resident | Lane | Home room | Tempo | Signature |
| --- | --- | --- | --- | --- |
| DJ HALO | Peak Hour | Club | 124–140 | Reads the room and changes mode mid-set |
| DJ BUTTERFLY | Sunset Terrace | Lounge | 118–123 | Long melodic blends across vocals |
| DJ ROMY | After Hours | Chill | 90–118 | Percussion tension, leaves through an echo |

## The rule that governs everything else

**A resident never reaches air on its own.** Every hour a resident builds is stored as a `planned` proposal. It becomes `approved` only when an owner approves it, and the database refuses to store an approved or aired set without the member id of the person who approved it:

```sql
CHECK (status NOT IN ('approved', 'aired') OR approved_by_member_id IS NOT NULL)
```

That constraint is in the schema rather than in application code or a prompt, so no future handler, model, or scheduled function can route around it.

## The ladder

Levels are earned against two independent gates: accumulated experience **and** a craft floor. Experience alone buys nothing, which is what stops a resident from levelling up purely by being scheduled a lot.

| Level | Title | Experience | Craft | Unlocks |
| --- | --- | --- | --- | --- |
| 1 | Selector | 0 | 0 | Plays the room's rotation in a sensible order |
| 2 | Programmer | 60 | 35 | Builds its own running order and energy arc |
| 3 | Host | 180 | 45 | Speaks between records, in station-written lines |
| 4 | Voice | 400 | 55 | Writes its own talk breaks, still grounded |
| 5 | Resident | 750 | 62 | Takes listener requests into the running order |
| 6 | Programmer of record | 1200 | 68 | Proposes programming to the station desk |
| 7 | Guest | 1800 | 74 | Plays outside its home room |

A Level 1 resident is silent. A Level 3 resident speaks only in lines assembled in code from station facts, with no model in the path. A Level 4 resident writes its own lines, and every line still has to pass the grounding gate below.

## How a set is built

`buildSetPlan` in `netlify/lib/radio-personas.mjs` is deterministic: the same rotation and the same seed produce the same hour, so a plan can be read and argued with before it airs. The seed comes from the persona id and the slot time, so replanning the same hour never reshuffles it by accident.

For each position it scores every remaining rotation-approved track in the room on five weighted axes — tempo continuity, harmonic distance on the Camelot wheel, distance from the arc's target energy at that point, novelty against recent plays and already-played artists, and the room's own voting record. Weights differ by resident: Butterfly protects harmony, Romy trades smoothness for tension, HALO stays balanced.

- **Energy arcs.** Club builds, Lounge follows a sunset curve, Chill runs an after-hours shape. Target energy is interpolated across six points and the set is divided into opening, build, peak, sustain, and close phases.
- **Energy itself is a proxy, not a measurement.** Until tracks carry real beat-grid and loudness analysis, energy is estimated from where a track sits in the resident's tempo lane plus the room's voting record. This is written down in the code rather than presented as analysis it is not.
- **Keys are parsed, never guessed.** `camelotFromKey` reads `5A`, `5A (D Minor)`, and `08B`, and returns nothing for anything else, so an unlabelled track scores neutrally instead of wrongly.
- **Tempo lanes are enforced.** A track well outside the resident's range is not programmable however popular it is. An unknown tempo is allowed through.
- **Transitions rotate.** The last three transition styles are removed from the next choice whenever the palette leaves an alternative, so a resident never repeats one move for an hour. Big energy jumps take a drop swap, big drops leave through an echo, distant keys cross a percussion bridge.

## Talk breaks and the grounding gate

The AI Gateway carries text and images, not speech, so residents are silent DJs: talk breaks are written text attached to a point in the running order. This tests whether the residents have anything worth saying before anyone pays for a voice.

Every talk break has to cite `signalKeys` — keys like `track.<id>.title`, `artist.<slug>.plays_30d`, or `station.rotation_tracks` — that are validated **in code** against a signal index built from the actual plan and the station's own records. A line citing nothing verifiable is dropped, and the count of dropped lines is stored on the set. Nothing prevents a model from writing "they just signed to a major label"; the gate is what prevents that line reaching a listener.

If the model fails, times out, or every line it writes fails the gate, the set falls back to the deterministic Level 3 templates rather than airing silence unexplained.

## Levelling from evidence

`evaluatePersonas` runs daily inside the planner function and writes one score row per resident per day. It attributes listener telemetry — `radio_tune_in`, `radio_heartbeat`, `radio_tune_out`, `radio_skip` — to the windows a resident was actually on air, using a semi-join so overlapping windows cannot double-count a single event. Artist follows count only where that resident actually played that artist inside that window.

Two scores are kept apart on purpose:

- **Craft** is retention indexed against *the room's own baseline* over the same window, plus the rate at which listeners did not skip. Matching the room scores 0.5; roughly doubling it scores 1. This is what stops an excellent 3am Chill resident from being permanently outranked by a Friday peak-hour slot.
- **Reach** is share of the room's listening, unique listeners, and the follows and subscriptions the hour pulled in.

Experience accrues from sets aired weighted by both scores. A resident with no measurable window loses 8% of its experience, because a number that can only rise stops meaning anything. Levels are recomputed from the resulting numbers, so a resident that stops holding a room drops back down the ladder and loses the authority that came with it.

Each evaluation also writes a plain-language rationale and a `halo_radio_persona_memory` row, so the reason for a level change is readable rather than buried in a model.

Transition-level outcomes now contribute to craft when evidence exists. Prepared and performed transitions retain their recipe, predicted fit, audience outcome, and operator-override state. Authorized platform metrics such as saves, shares, completions, streams, likes, comments, and watch signals can be imported from approved APIs or owner exports. External metrics are normalized against audience size and never require unsupported scraping.

## HALO mixing doctrine

Every resident and AI DJ decision now inherits HALO BREATH: **Release → Breath → Discovery → Anticipation → Reveal**. The system protects the outgoing vocal, carries a non-vocal musical bridge, conceals the incoming identity until its payoff, aligns structural changes to 8-, 16-, 24-, or 32-bar architecture, and reduces melodic overlap when harmonic distance is high.

The residents share the architecture without becoming interchangeable. DJ HALO uses the widest Club palette and can choose peak-time or experimental routes. DJ BUTTERFLY gives Listening Party records more emotional breathing room and favors melodic handoffs. DJ ROMY lets Chill records play closest to their natural ending and favors atmosphere, percussion, and reverb-tail continuity. All three remember recent transition styles and avoid repeating the same architecture consecutively when another safe route exists.

Techniques rotate across bass swaps, percussion bridges, filter movement, delay or echo tails, atmospheric bridges, silence, and drop swaps. DJ HALO may add the restrained “Hay lo, hay lo” atmospheric swell on eligible transitions, but never consecutively, over a lead vocal, or as a substitute for phrase control. Withholding the motif is part of the identity system: scarcity keeps it recognizable.

## Operating the residents

- `/radio/#residents` shows the roster: level, capability ladder, craft and reach, the next slot, and the approved running orders with their talk breaks.
- `GET /api/radio/personas` is public. Listeners see approved and aired sets only; owners also see planned proposals.
- `POST /api/radio/personas` is owner-only, same-origin verified, and accepts `plan_set`, `approve_set`, `mark_aired`, `update_set`, `set_persona_status`, and `evaluate`. Approving and airing from the residents section on the radio page calls the same endpoint.
- `radio-persona-planner` runs every six hours, plans up to six sets within a 36-hour horizon for published shows that name a resident, and recomputes levels once a day at 06:00 UTC. It cannot approve or air anything.
- Planning is metered through `halo_ai_usage_events` under the `radio_persona` feature at 12 plans an hour, sharing the same budget table as the AI DJ rather than being given an unbounded one.

Attach a resident to a show by setting `halo_radio_shows.persona_id`. Only published shows with a resident attached are planned for.

## Tables

| Table | Holds |
| --- | --- |
| `halo_radio_personas` | The roster: lane, tempo range, palette, level, experience, craft, reach, status |
| `halo_radio_persona_sets` | Planned hours: running order, transitions, talk breaks, approval and air record |
| `halo_radio_persona_scores` | One evaluation per resident per day, with the signals behind it |
| `halo_radio_persona_memory` | Reviewable working notes, mirroring `halo_agent_memory` |

`scripts/radio-persona-contracts.mjs` covers the pure planning and scoring functions, the grounding gate, the room-baseline normalisation, and the presence of the approval constraint. It runs as part of `npm test`.

## What is deliberately not built

- **No voice.** Adding speech means a TTS vendor, a key, and audio storage. The text tier tells us first whether the residents are worth hearing.
- **No autonomous airing.** The planner proposes; a person approves.
- **No real audio analysis yet.** Energy is a documented proxy. Replacing it with beat-grid and loudness analysis is the clearest single upgrade to set quality.
- **No requests pipeline.** Level 5 unlocks taking requests; the intake for them is not built.
