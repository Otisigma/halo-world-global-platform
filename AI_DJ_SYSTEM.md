# HALO AI DJ System

## DJ Vault

`/dj-vault/` is a separate, opt-in curated catalog; normal release uploads and the canonical song `sale_master` are unchanged. Apply `netlify/database/migrations/20261011040000_dj_vault.sql` and `20261011060000_dj_vault_rarity.sql` before enabling the section. Operators provision `dj`, `selector`, or `admin` in `halo_dj_vault_roles` for an existing `halo_memberships.member_id` through trusted database administration. No profile, signup, or browser endpoint grants these roles.

Endpoint layout (Netlify functions):

- `GET /api/dj-vault/session`: reports authenticated identity and database-backed permissions.
- `GET /api/dj-vault/tracks?offset=0`: paginated public metadata (including `rarity`, which drives the white-label card variants in `dj-vault/vault-card.js` and client-side crate-digger sort/filters for BPM, Camelot key, price, newest, and exclusivity); verified roles additionally see member-only editions. Hidden/standard editions and private storage keys never appear.
- `PATCH /api/dj-vault/routing`: selectors/admins explicitly route editions into/out of `dj_vault` or set `hidden`, `public`, or `members` visibility. Supply `trackId` (new UUID), optional `songId`, `title`, `artist`, `bpm`, `musicalKey`, integer `pricePence`, `deliveryFormat` (`wav`/`flac`), `previewType`, optional `rarity` (`white_label` default, `test_press`, `promo_copy`, `vault_only`, `selector_exclusive`; omitted on update keeps the current label), and `previewPackId`/`previewStem`/`deliveryPackId`/`deliveryStem`.
- `POST /api/dj-vault/checkout`: verified DJs send `{trackId}`; the server records a pending GBP order and creates Stripe Checkout using the database price.
- `POST /api/dj-vault/confirm`: send `{trackId, sessionId}` after checkout (or retry later). The server retrieves the session directly from Stripe, checking paid/completed status, order ownership, currency, amount, and order metadata before atomically recording payment, a unique entitlement, and audit log. A browser success flag never grants access.
- `POST /api/dj-vault/entitlements`: admins may grant `{trackId, memberId}` to an operator-verified DJ without payment.
- `GET /api/dj-vault/preview?trackId=…`: only the separate preview file; public or verified member visibility is enforced.
- `GET /api/dj-vault/download?trackId=…`: requires current verified role and an unrevoked entitlement; streams private bytes with range support and no-store headers, never a public delivery URL.

Upload the preview and delivery files through the existing private DJ Deck stem-pack workflow, with explicit rights attestation. Linked song assets must belong to its owner; standalone editions use the curator's files. Use distinct files and a preview of 1–90 seconds; the curator must verify clip/watermark quality and WAV/FLAC fidelity before publishing. Do not upload exclusive delivery audio into public song-version URLs. Existing public releases are not retroactively made exclusive. Edition assets are immutable once routed; create a new edition to replace files.

Set `STRIPE_SECRET_KEY` and `DJ_VAULT_SITE_ORIGIN` (the exact canonical HTTPS origin) to enable checkout. Missing configuration fails closed. All mutations require same-origin JSON requests, and sensitive authenticated requests use a database-backed per-member rate limit. Keep blob storage private; apply edge/IP rate limits for public catalog and preview traffic. Refunds/disputes must be handled by operators by setting `halo_dj_vault_entitlements.revoked_at`; automatic refund webhooks are not part of this flow. Payment confirmation is retryable on return to the vault, including on another device using the original session ID.

Schema includes private edition metadata/assets, server-provisioned roles, immutable price snapshots in orders, unique member/edition entitlements, and routing/preview/purchase/grant/download audit logs. Run `npm run test:dj-vault` for permission, payment verification, private delivery, and dependency-free frontend rendering contracts.

### Featured DJ shop push

Apply `netlify/database/migrations/20261012040000_dj_shop_featured.sql` before deploying the featured upload path. Selectors/admins use `/dj-vault/upload/` and check **Push to DJ Shop Featured Banner**, optionally choosing `featured`, `white_label`, or `test_press`. The JSON publish request to `/api/upload-mix` accepts `isShopPush` (boolean, default `false`) and `pushPriority` (default `featured`).

The mix, release plan, and singleton `halo_dj_shop_featured` slot are saved atomically. A new featured publish replaces the slot without deleting older mixes; ordinary uploads and retries of already-published mixes never change it. The slot is the canonical featured state, rather than separate flags that could disagree. Concurrent pushes leave one active item, and deleting its mix removes the slot.

`GET /api/dj-vault/featured-push` returns `{success: true, edition}` with public catalog metadata, or `edition: null` if there is no public feature. `/dj-vault/` displays it above the crates using text-only rendering and the catalog title, artist, and price. Ingested mixes remain **free streams**; the banner links to the existing mix player/editions page and does not enable sales or bypass checkout/readiness checks. Banner failures do not block catalog browsing. Validate with `npm run test:dj-vault`.

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

## Recorder isolation guard

The Takeover recorder captures the post-limiter master bus only; CUE headphone monitoring runs on a separate local output path and is never connected to the recorder. `dj-recorder-guard.js` (`useRecorderGuard` / `HaloRecorderGuard`) samples the recorder state, the master bus peak level and the CUE bus four times per second. When a recording is running, CUE monitoring is active and the master is above 80% of full scale, the indicator directly above the Takeover recorder switches from "Recorder isolation secure" to "Audio bleed guard triggered" and tells the DJ to release CUE or pull the faders down. The guard flags likely bleed and feedback conditions (for example open headphones near a hot master or an external loopback); it reduces risk but does not guarantee absolute silence on the feed. Validate with `node scripts/dj-recorder-guard-contracts.mjs`.

## DJ Council quality gate

No takeover mix is deliverable until the DJ Council passes it. `services/djCouncilEngine.js` (`DJCouncilEngine`, `evaluateDJCouncil`) is a pure, deterministic evaluator with four specialist pillars: signal integrity (50/60 Hz hum, integrated loudness near -14 LUFS, peaks below the -1 dBFS ceiling), mix mechanics (124.0 BPM house-profile master tempo, neighbour tempo alignment, Camelot key flow, transition continuity), rights and metadata (HALO catalog entry or valid ISRC per track, stem permission, remix attribution), and audience readiness (takeover window duration, energy arc, set depth). Blocking failures or a score below 80/100 keep the mix out of delivery and return actionable fixes; extra checks plug in through `registerCheck`. During recording, `createSignalMeter` only reads the isolated post-limiter recorder analysers, so recorder isolation and desk-only noise cleanup are unchanged. `dj-council-badge.js` renders the verdict on the Takeover recorder; a failing mix keeps "Post to room" disabled, skips the automatic download and offers only a review copy. `/api/mixes` re-evaluates the same council for HALO deck publishes with the server-side duration and rejects failing or missing reviews with 422; audio metrics and track rights fields are measured in the deck, so the server enforces the council rules on those reported values rather than re-measuring the audio. Validate with `node scripts/dj-council-contracts.mjs`.

## DJ continuous learning engine

`netlify/lib/dj-learning-engine.mjs` (`DJLearningEngine`) evaluates completed transitions from BPM delta, harmonic match, vocal overlap, phrase alignment score and listener retention delta. It computes a 0–100 performance score and nudges three bounded emphasis weights for the AI DJ transition planner: `phrasePrecision`, `vocalSeparationStrictness` and `eqBlendSmoothness`. A weak dimension raises its emphasis by a small step; clean transitions relax it gently back toward the 1.0 baseline, and every weight is clamped between 0.5 and 2.0. Profiles persist per DJ persona through an injected store — `createBlobLearningStore(getStore)` uses the `halo-dj-learning` Netlify Blobs store, and `createMemoryLearningStore()` is the local/test stub — so learned weights carry into the next session. Writes are conditional on the version that was read (Blobs ETags) and retried, so concurrent evaluations never overwrite each other, and transition IDs replayed within the most recent 50 evaluations per persona are ignored. The engine only reads transition metrics and writes these numeric weights; it does not change code, prompts, routing or any behaviour outside DJ transition planning. Validate with `node scripts/dj-learning-engine-contracts.mjs`.

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
