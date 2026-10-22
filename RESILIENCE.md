# HALO Resilience Architecture

HALO applies redundancy **where a dropped request loses work** (uploads, storage verification,
publishing) and keeps everything else simple: fail fast, explain clearly, and let durable state plus
scheduled reconcilers repair the rest. We deliberately do **not** dual-stream every request to two
regions — that doubles cost, creates write conflicts, and hides real outages.

Shared primitives live in [`netlify/lib/resilience.mjs`](netlify/lib/resilience.mjs) (server) and
[`upload-progress.js`](upload-progress.js) (browser). Behaviour is validated by
`node scripts/resilience-contracts.mjs`, which runs in `npm run upload-experience:watchdog` and `npm test`.

## Principles

1. **Every call is bounded.** Each tier has a timeout and a finite retry budget; timeouts abort the
   underlying request via `AbortSignal` rather than leaving it running.
2. **Only retry what is safe to repeat.** Retries are limited to transient failures (network drops,
   timeouts, `408/425/429/5xx`, transient database codes) on idempotent work. Validation errors
   (`4xx`) surface immediately and never trip a circuit breaker.
3. **Failover is sequential, not a race.** A backup only runs after the primary has failed, been
   reported unhealthy, or had its circuit opened. The result always reports which path served it.
4. **Durability belongs to infrastructure.** Replicate the object-storage bucket and database at the
   provider layer; application code keeps writes idempotent and conflict-safe.
5. **Degrade visibly.** Users see what is happening ("retrying part 3 of 8", "switched to the backup
   upload path", "you appear to be offline") and their saved work is never discarded.

## Tiers

| Tier | Timeout | Retries | Strategy |
| --- | --- | --- | --- |
| `interactive` | 8 s | 1 | User-facing requests: one quick retry, then a clear error state. |
| `ingest` | 120 s / chunk | 3 | Uploads: idempotent chunk writes, jittered backoff, offline wait, failover. |
| `background` | 30 s | 2 | Jobs: durable DB rows + scheduled reconcilers own long-horizon recovery. |
| `storage` | 10 s | 2 | Object storage: bounded HEAD/DELETE retries behind a circuit breaker. |
| `observability` | 2 s | 0 | Telemetry: best-effort, never throws, never blocks the request. |

### User-facing requests

Pages and JSON APIs fail fast. Use `retryWithBackoff` with the `interactive` profile only for
idempotent reads; show an informative error rather than spinning. Static pages and assets are served
by the CDN, which already provides edge redundancy.

### Uploads and ingest

- **Chunked uploads** (`/api/song-catalog/audio`, artwork, mixes, radio submissions, stem vault,
  Dream Weaver song lab) store each part under `uploadId + chunkIndex`, so a retried part simply
  overwrites the earlier attempt. `HaloUploadProgress.uploadChunkedFile` therefore retries network
  drops and `408/429/5xx` by default (`[800, 2000, 4000]` ms with jitter), waits for the browser to
  come back online, and reports each retry through `onRetry` so the UI can explain the pause.
  Finalize validates checksums and completeness before anything is committed.
- **Non-idempotent posts** (`sendFormDataWithRetry` without `retryOnStatus`) only retry network
  drops; an HTTP error is returned to the caller instead of being silently replayed.
- **Master copies** use real failover with a health gate:
  1. `presign` checks the storage circuit breaker (`masterStorageAvailable()`). If storage is
     degraded it answers `503 { directUpload: false, degraded: true }` and the client uses the backup
     chunked (Netlify Blobs) path for files ≤ 128 MB.
  2. Otherwise the browser PUTs directly to storage (primary). Only if that PUT fails transiently does
     `runWithFailover` switch to the chunked path — a healthy-but-slow primary is never raced.
  3. `register` verifies the stored object with a bounded, retried `HEAD`. A storage outage now
     returns a retryable `503` (not a misleading "file not found"), and the client retries
     verification without re-uploading. Registration is not failed over: the file is already safe in
     storage, so re-uploading elsewhere would only create a conflicting copy.
- The CLI uploader (`npm run upload:audio`) uses the same rules: per-request timeouts, backoff, and
  retries on transient statuses only.

### Background jobs

Work is recorded in durable database rows before it is processed, handlers are idempotent, and
scheduled reconcilers replay anything left behind:

- Release conveyor: `netlify/lib/release-conveyor-retry.mjs` (bounded retry within a deadline) and
  the watchdog in `release-conveyor-watchdog.mjs`.
- Song publication: `/api/song-publication-reconcile` repairs published songs every 15 minutes using
  `halo_song_publication_sync`.
- Upload pipeline stages are persisted on `halo_song_catalog.pipeline_status`, so an interrupted
  hand-off resumes instead of being lost.

### Storage

Enable versioning and cross-region replication on the `HALO_MASTER_STORAGE_BUCKET` bucket and rely
on Netlify Blobs / Netlify Database for their own replication. In application code,
`direct-upload-storage.mjs` wraps storage calls with the `storage` tier: a 10 s timeout, two jittered
retries for transient statuses, and the `master-storage` circuit breaker (opens after 5 consecutive
failed operations, probes again after 30 s). Breaker state is per warm function instance, so it is a
fast local signal, not a global switch — the durable fallback is always the chunked upload path.

### Observability

Breaker transitions are logged as structured `circuit_state_change` events. Telemetry and reporting
calls should use `bestEffort()` so a collector outage can never fail a user request. Persistent
problems flow into the self-reporting maintenance system described in [SELF_HEALING.md](SELF_HEALING.md).

## Why not `Promise.race` dual streams?

`Promise.race([primary, backup])` resolves with whichever stream settles first. That means:

- the backup can "win" while the primary is perfectly healthy, so writes land in the wrong place;
- a fast **rejection** from either side wins the race and fails the whole upload;
- the losing request keeps running, so both stores may hold partial or conflicting copies;
- nothing records which copy is canonical.

`failover()` (server) and `runWithFailover()` (browser) instead try targets in order, apply health
checks and circuit breakers before sending traffic, bound each attempt with an aborting timeout, refuse
to fail over on permanent errors, and return `{ target/path, failedOver }` so callers know exactly
which copy is authoritative.
