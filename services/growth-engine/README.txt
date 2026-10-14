HALO GROWTH ENGINE — MVP / WORKER HANDOFF

Purpose
-------
An isolated distribution queue, not a replacement for upload, mastering, the
release conveyor, or catalog publication. Ingest references the existing active
sale_master and catalog/video artwork. No master files are copied or modified.
All database queries use the existing Netlify database tagged SQL convention.

Module map (paths relative to repository root)
---------------------------------------------
services/growth-engine/analysis.mjs: normalized mono PCM -> RMS frames -> ranked
  teaser windows, deterministic scoring and overlap suppression.
services/growth-engine/platforms.mjs: platform profiles, vertical FFmpeg argument
  plans and deterministic, review-required metadata drafts.
services/growth-engine/engine.mjs: stage handlers, adapter ports, runNextJob and
  runGrowthAgent, plus the named GROWTH_AGENT_ROLES worker registry.
netlify/lib/growth-engine-store.mjs: owner-scoped ingest, durable jobs, leases,
  atomic completion + downstream enqueue, audit history, bounded retries.
netlify/lib/growth-engine-http.mjs and netlify/functions/growth-engine.mjs:
  authenticated API. No public worker execution or result-submission endpoint.
db/schema.ts: schema definitions matching the additive SQL migration.
scripts/growth-engine-contracts.mjs: synthetic audio and behavioral contracts.

Setup and API
-------------
Apply netlify/database/migrations/20261014120000_growth_engine.sql through the
existing database migration process before enabling /api/growth-engine.
No new npm, Python, OAuth, platform, or FFmpeg dependency is installed by this MVP.

POST /api/growth-engine as an authenticated member, same-origin application/json:
  songId: existing catalog ID owned by that member
  requestKey: stable 1–80 character letters/digits/underscore/hyphen key
  rights: master=true, visual=true, promotion=true
  targets: optional array of youtube_shorts, tiktok, instagram_reels
  scheduledAt: optional ISO timestamp for the publishing adapter
  publishApproved: explicit opt-in, default false

Returns 202 with the durable campaign. Reusing the same song + requestKey returns
the original campaign and does not change its settings or enqueue duplicate jobs.
Use a new requestKey for revised settings/source assets. There is no listing or
public sharing endpoint: retain the campaign ID.
GET /api/growth-engine?campaignId=<id> returns that owner's campaign, jobs,
selected timestamps, feature scores, drafts, render plans/logs, platform response
IDs, statuses, and audit events. Other owners receive 404.

Worker agents and execution
---------------------------
The API only enqueues; there is intentionally no deployed timer, credential
bootstrap, subprocess runner, or live publisher. Run workers in a trusted backend
with the same database access. Construct createGrowthStore(db), then call
runNextJob(store, {ownerMemberId, campaignId, adapters}) repeatedly until idle.
Alternatively runGrowthAgent with a role:
  ingest -> ingest
  hook_analyzer -> analysis
  teaser_renderer -> render
  metadata_editor -> metadata
  publisher -> publish
  performance_collector -> analytics
These are constrained worker roles, not self-editing agents. The role selects
only its queue kind; each worker still enforces live ownership/rights.

Pipeline: ingest -> analysis -> render per hook/platform -> metadata per variant
-> publish per variant -> analytics per confirmed platform ID.

Adapter contracts
-----------------
decodeAudio(campaign) -> {samples, sampleRate}
  Resolve campaign.source's owned canonical master through existing storage
  helpers. Decode/downmix to finite mono PCM in [-1,1], covering the stored
  duration (maximum two hours, maximum 100M samples). Downsample if needed.
  Missing adapter blocks analysis explicitly. No placeholder hooks are invented.
  Actual sound decoding is NOT included; RMS extraction/scoring is implemented.

render(plan, campaign, {idempotencyKey}) ->
  {status:"ready", artifactId, logs:[...]}
  Download owned inputs into a sandbox; replace fixed input identifiers in the
  argument array with worker-local files. Execute FFmpeg without a shell, enforce
  time/CPU/output limits and restrict its protocols to local inputs. Never pass
  arbitrary URLs to FFmpeg or run its command as a concatenated shell string.
  Bind artifact IDs to the campaign owner, persist atomically, and reuse outputs
  on retries. Persist sanitized, bounded logs, not credentials or signed URLs.
  If no renderer is installed, the stage emits an honest "planned" manifest,
  generates metadata, and queues publication; plans can NEVER be published.
  Artwork looping and video center-crop plans are included. Caption burn-in needs
  a future timed-transcript adapter; no captioned output is claimed.

publishers[target].publish({artifactId, metadata, scheduledAt, idempotencyKey}) ->
  {publishId, uploadId?, status:"published"|"scheduled", ...sanitizedReceipt}
  Only invoked for real rendered artifacts and explicit publication approval.
  Review platform policy, OAuth consent/scopes, asset ownership, privacy and
  scheduling rules before implementing. All publishers currently default to
  blocked; no external API calls, insecure OAuth transport, credential files,
  fake upload IDs or automatic public publishing are included.
  YouTube scheduling must use private visibility + publishAt; a Premiere cannot
  be assumed from a scheduled Data API upload. Shorts eligibility is not assured.
  TikTok and Instagram use separate approved adapters and platform profiles.
  No undocumented browser automation or platform engagement manipulation.

publishers[target].analytics(publishId) -> {views, ...sanitizedMetrics}
  Views must be non-negative. Stores a timestamped observation for future scoring
  feedback. This MVP does not schedule polling, interpret retention, retrain
  scores, or claim any guaranteed algorithmic reach.

Queue and failure contract
--------------------------
PostgreSQL SKIP LOCKED claims, 10-minute fenced leases, at most three attempts.
Claim/success/blocked/failure/exhaustion/retry events remain on each job.
Workers must finish inside the lease (no heartbeat in MVP). Expired attempts can
be reclaimed; final expired attempts become failed on the next campaign claim.
Completion and all next jobs commit in one statement with per-campaign unique
job keys. Recheck the live source fingerprint, ownership and cleared rights
before each stage; changed/replaced masters or visuals block further work.
No pipeline statuses or upload tables are written.

Delivery is AT LEAST ONCE, not exactly once. A platform can accept an upload
before the worker loses its lease. Adapters MUST reconcile by the stable job ID
before retrying to prevent duplicate remote uploads. The queue cannot undo a
remote side effect, or revoke an already published post when rights change.
Trusted operators use store.retry(ownerMemberId, campaignId, jobId) only after
resolving a blocked/failed job; it delays 30 seconds and preserves attempt count.
Unconfigured/failed jobs are not automatically hammered. Changed source inputs
require a new campaign, not a bypass of the fingerprint guard.

Generic adapter errors are persisted as safe failure messages. Keep detailed
diagnostics in restricted worker logs; sanitize successful adapter results too.
Owner confirmations are recorded attestations, not legal verification. HALO
ownership does not establish third-party artwork or promotional license rights.

Extension backlog / explicit boundaries
---------------------------------------
Add durable asset storage/decoder and bounded render workers first, then approved
platform adapters, per-variant review UI and scheduling, analytics polling and
retention/CTR feedback. Add optional repetition/onset/lyric signals with a
versioned scoring model; RMS energy alone does not prove a memorable chorus.
Ad orchestration should be a separate approved adapter/job kind with account,
budget cap, currency, explicit opt-in, idempotency and spend audit. adsEnabled is
always false in this MVP; no spending API or inferred approval exists.

Validation
----------
npm run test:growth
npm test
npm run build
Contracts cover synthetic hook selection, short/silent inputs, platform plans,
metadata, planned-vs-real artifacts, stage handoffs, publication IDs, analytics,
rights revocation, lease-loss responses, SQL fencing/atomicity and API boundaries.
PostgreSQL contracts also exercise the real migration, concurrent claims,
atomic rollback, owner isolation, retries and expired/stale worker fencing,
using the repository's existing local PostgreSQL 16 test pattern. Those checks
report a skip when local PostgreSQL binaries are unavailable.
