# HALO AI DJ Personas

DJ Halo, DJ Butterfly and DJ Romy are HALO's AI DJ personas for The Signal. They share one architecture but never one voice. `lib/dj-personas.js` is the single authoritative registry: identity, voice rules, emotional tone, behaviour tags, memory hooks, visual identity, music lanes, event routing and Signal style packs all live there. Radio residents (`RADIO_DJ_PERSONAS.md`), the live deck and the creator-network demo profiles stay aligned with it, and `scripts/dj-persona-contracts.mjs` fails if they drift.

## The three personalities

| | DJ Halo | DJ Butterfly | DJ Romy |
| --- | --- | --- | --- |
| Archetype | The Signal Captain | The Metamorphosis Storyteller | The After-Hours Confidant |
| Tagline | Reads the room, then lifts it. | Every track is a cocoon. Every blend, a reveal. | Soul for the hours nobody else stays up for. |
| Lane / room | Peak Hour · Club · 124–140 BPM | Sunset Terrace · Lounge · 118–123 BPM | After Hours · Chill · 90–118 BPM |
| Genres | House, Afro House, Tech House, Peak-time House | Melodic, Progressive and Organic House, Electronica | Deep House, Soul, Downtempo, Lo-fi House |
| Voice | Punchy hype-captain, speaks for the floor ("we") | Poetic, curious, ends on an invitation ("you") | Low, warm, lowercase, never an exclamation mark |
| Tone | Electric · generous (intensity 0.85) | Wonder · tender (0.55) | Warm · reflective (0.35) |
| Signature event | `release_drop` | `remix_request` | `late_night_listen` |
| Memory hooks | Releases championed, milestones called | Collaboration journeys, melodic evolution | Returning night regulars, soul crate |
| Visual identity | Gold halo ring, laser shafts, gold haze | Iridescent wing projections at sunset | Candle-warm amber, indigo night, vinyl crates |
| Sign-off | — DJ Halo ⚡ | — DJ Butterfly 🦋 | — romy 🌙 |

Visual identity is concept metadata (description, palette, motifs, wardrobe, lighting, alt text). `imageUrl` stays empty until owner-approved artwork is committed; the registry never invents media URLs.

## Event routing

`routeDjEvent(event, { state, now })` decides which DJ acts on one of the supported `DJ_EVENT_TYPES`:

1. The event is normalised to safe plain-text facts (title, artist, creator, genre, milestone, BPM, Camelot key and an opaque `subjectId`). Links, markup, control characters and contact details are dropped.
2. A `comment_reply` on a thread owned by a DJ (`threadOwnerId`) always stays with that DJ. If the owner is on cooldown the reply is held (`thread-owner-cooldown`) rather than handed to a different voice.
3. Otherwise every persona is scored: event affinity (40%), genre match (25%), BPM fit against its lane (25%) and Camelot key fit (10%). Missing facts score neutrally.
4. Personas on cooldown for that channel (`post` or `comment`) are skipped, so the next best DJ takes the event. Ties resolve in registry order, and the full ranking with per-axis breakdown is returned so every decision is explainable.
5. Below the confidence threshold nobody acts (`no-confident-match`).

`markDjActed` returns a new cooldown state; `planDjResponse` routes, drafts and starts the cooldown in one step.

## Memory

`rememberDjEvent` records an event against each memory hook of the persona that listens for it. Memory stores only an opaque subject id, a public title, the event type, the hook and a timestamp — never message text or contact details — and is capped at `DJ_MEMORY_LIMIT` entries per persona. `parseDjMemory` re-validates anything loaded from storage, dropping unknown personas, foreign hooks and unsafe titles. When a DJ meets a subject again, the draft adds that persona's recall line (for example DJ Halo: "Last time it was “First Light” — the floor remembers.").

## Signal style packs and guardrails

`composeDjSignalDraft(personaId, event, { memory, seed, channel })` writes a post or comment from the persona's style pack using only facts supplied by the event; templates that need a missing fact are skipped and a fact-free fallback is used instead. Every draft:

- is labelled with `DJ_AI_DISCLOSURE` and `demo: true`,
- requires human approval (`requiresHumanApproval: true`) and carries `publishPublic: false`, so it cannot pass the Signal feed's deliberate-publication check by itself,
- fits the Signal post body limit once a human chooses to publish it through the normal flow.

Nothing in the persona system publishes, sends messages, changes follower counts or claims releases, rights or bookings. The creator-network demo profile shows each DJ's voice, tone, behaviours, visual concept and one sample draft as text only.

## Premium CreatorPass integration

`lib/creator-pass.js` owns the runtime entitlement policy; `types/creatorPass.ts` describes its JSON-safe contract. Apply the CreatorPass and vault quota database migrations before deploying the premium surfaces. Only trusted server-side billing/operations may write `halo_creator_passes`: no profile, browser metadata, membership tier, or request entitlement flag grants Premium. This change does not add checkout or a billing webhook; provision subscription records through trusted operations until billing synchronization is connected.

Premium requires `subscription_tier = 'PREMIUM'` and either an active subscription with a strictly future expiry, or a trial with a strictly future trial end (and a future subscription expiry if present). Missing, malformed, expired, past-due, canceled, and inactive records receive Standard entitlements. Update status and dates from verified billing events; renewals must extend the expiry. Existing Gold, Backstage, and Founder memberships remain separate and do not imply a Premium subscription.

Standard vault capacity is 5 GiB. Premium vault capacity is uncapped (`vaultCapacityBytes: null` with `unlimitedVault: true` in JSON), but the 4 MiB chunk and 512 MiB per-stem safety limits still apply. Server-side quota reservations count actual uploaded bytes, including archived files and unfinished uploads; archiving is not deletion. Unchanged failed batches reuse their upload ID and existing reservations. Abandoned-upload cleanup is a trusted operational task: quiesce writers and verify blob deletion before releasing reservations; no browser quota-release endpoint is provided. Over-capacity downgrades retain their files but cannot add more data.

Discovery ranks eligible Premium creators and open briefs before applying result limits. Verified Premium is a subscription badge, not identity or rights verification; curated/demo creators never acquire it from sample flags. DJ brief promotion remains an AI-labelled draft requiring explicit human approval, not automatic Signal publication.

Studio Guardian and `/api/dreamweaver-smart-splits` enforce Premium on the server. Smart splits draft the owner's recorded master or composition allocations for a linked project; songwriter ownership and optional publisher allocations are separate pools, each totaling 100%. Drafts neither clear rights nor record consent, and must receive contributor consent and human/legal review before use. Custom artist room entitlement is represented but room customization, subdomain provisioning, automated audio indexing, and KPI reporting are not implemented by this wiring.

## Validation

```bash
node scripts/dj-persona-contracts.mjs
npm run test:network
npm run test:creator-pass
```
