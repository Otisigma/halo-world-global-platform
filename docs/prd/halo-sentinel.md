# HALO Sentinel: autonomous diagnostics and bounded repair

## Executive summary

Sentinel observes the Dreamweaver and Album Concierge listening surfaces, offers
safe runtime recovery, and records browser observations in HALO's existing ledger.
Known source-markup regressions have a deterministic, verified pull-request repair
path. It does not merge or deploy code, invent replacement recordings, or bypass
Identity, publication/rights checks, CORS, or browser autoplay policy.

This is a bounded first implementation, not a promise of zero faults, guaranteed
audibility, 100% route coverage, or sub-60-second repair of arbitrary defects.

## Objectives and evidence

| Objective | Implemented measurement | Limitation |
| --- | --- | --- |
| Detect routine binding drift within 60 seconds | MutationObserver plus a 15-second watchdog in an active tab | Background tabs can be throttled; unloaded pages cannot be observed |
| Inspect selected audio before reporting readiness | Dreamweaver awaits a 12-second, CORS-mode HEAD preflight before READY; source must already be bound | HEAD validates status/type only, not bytes, decoding, or sound |
| Preserve the browser's user gesture | Concierge starts its selected-track HEAD check alongside the explicit Preview gesture | It does not await a network check before calling play, which would lose gesture authorization |
| Safe recovery | Restore a missing source only from the controller's already-authorized selection; expose existing controls on failure | Never substitute another song or arbitrarily import a Drive share link |
| Auditability | Typed events persisted through the existing ledger helper; local delivery state shown | Browser claims are untrusted observations, not server-certified repairs |
| Source repair | Finite markup recipes, required contracts/build, diff artifact, review PR | Unknown code defects are not automatically rewritten |

## Architecture

`lib/halo-sentinel.js` implements the watcher and controller adapter.
`halo-sentinel.js` provides an accessible collapsible audit/override console on the
two integrated pages. `#site-status` reports WATCHING, attention/recovery activity,
or PAUSED; it never replaces the catalog badge with a false healthy claim.

```
DOM mutation / timer / media event / controller preflight
  -> bounded Sentinel diagnosis
     -> existing player recovery / gesture-only sound prompt
     -> typed event -> /api/sentinel/events -> halo_ledger

Actions schedule or manual dispatch
  -> allowlisted source recipes -> contracts + build
  -> diff artifact -> review branch and pull request (no merge/deploy)
```

### Watcher

- Each audio controller registers its selected-source resolver and recovery
  callbacks. Source is assigned before load; watcher repairs never autoplay.
- Preflight follows HEAD redirects with a 12-second deadline and requires HTTP
  200/206 plus `audio/*`. Browser `mode: cors` enforces cross-origin access;
  Sentinel cannot reliably read a non-exposed CORS header or distinguish a CORS
  rejection from DNS/network failure. A compatible origin-specific CORS policy
  is valid; wildcard CORS is not imposed on private media.
- Local Blob sources are never sent to the server or remotely probed. External
  HEAD requests omit credentials. Same-origin requests preserve existing auth.
- Pending checks cannot mark a replacement/local source failed. Disable cancels
  in-flight inspection; page teardown removes timers, observer and listeners.
- Canonical repair is restricted to the same-origin, annotated Dreamweaver or
  Concierge path and changes only the trailing slash. Song/mix query parameters
  remain intact. Wrong hosts or wrong distribution paths require review.
- Dreamweaver checks its canvas context before rendering. An unavailable context
  produces an explicit render error; it is not replaced with a fake canvas.
- Unhandled runtime errors and promises are recorded but not suppressed. Unknown
  promises cannot safely be attributed to audio or used to unmute a player.

### Healer and lifecycle

Level 1 critical categories are binding, transport, canvas and runtime. Canonical
drift and policy-blocked autoplay are Level 2 warnings: a browser permission
requirement is not proof of a broken stream.

States are `detected`, `recovery_available`, `recovered`, `unresolved`, and
`disabled`. Media recovery is recorded only on a subsequent `playing` event, not
on a successful HEAD request or a resolved play promise. `playing` establishes
browser playback state, not audible output at the listener's speakers.

Dreamweaver retains its existing same-song authorized Drive fallback and local
file preview. Sentinel does not compete with its media-error handler. Concierge
stops a failed preview and offers retry/public-release navigation instead of
silently switching recordings or creating a second local upload workflow.

### Ledger and privacy

`POST /api/sentinel/events` requires the exact same-origin header, JSON, at most
2 KiB of actual body bytes, and enum-only category/state/target/page data.
It reuses maintenance rate limiting (20 reports/minute per reporter key) and
`appendLedgerEntry`, so no new database migration is needed. There is no public
read endpoint; the existing signed-in HALO Ledger provides history.

Entries contain a server-derived signature and timestamp, severity and
resolution state, and explicitly label evidence `untrusted-browser-observation`.
No audio URL, signed token, query string, private song ID, local filename, stack
trace, or browser-supplied free text is accepted into the entry. A failed write
returns 503; the console shows failed delivery rather than claiming persistence.
These events cannot close maintenance issues, authorize source changes, or
assert a source fix was applied.

The tab retains at most 40 events, suppresses identical events for one minute,
and allows at most 16 delivery attempts per minute and three attempts per event.
The console distinguishes queued/failed events from stored events. Delivery
retry occurs on reconnect and during active-tab inspections within those bounds.

## Repository repair and deployment controls

The public repository cannot use Copilot cloud Automations. The
**HALO Sentinel verified repairs** GitHub Actions workflow instead supports
manual dispatch and an opt-in 15-minute schedule. Set the repository Actions
variable `HALO_SENTINEL_REPAIR_ENABLED` to `true` only after review/merge to enable
scheduled source checks. GitHub schedules are best-effort, not a 60-second SLA.

Allowed recipes cover only the two integrated HTML files:

1. Restore missing Sentinel script/style references.
2. Move those references before the existing controller.
3. Restore the selected audio element's known preload attribute.

The script rejects unknown paths, ambiguous controller bindings and missing or
duplicate audio nodes instead of guessing. It does not generate arbitrary JS,
alter credentials/rights, or accept browser incident text as executable input.
An unknown defect causes a failed workflow for developer investigation.

Before creating a branch/PR, the workflow requires Sentinel source/runtime/API
contracts, Drive/catalog/player/preloader/Concierge contracts and build.
It uploads the exact diff, avoids duplicate open repair proposals, and never
merges or pushes to main. The repository must allow GitHub Actions to create pull
requests; otherwise a failed run and diff artifact are the review handoff.
GitHub-token-created PRs may require a maintainer to trigger additional CI.

The workflow PR and artifact are the source-repair audit trail. They are not
misrepresented as browser ledger events; the workflow has no production ledger
credential. Source fixes are rolled back through reviewed Git reverts. Runtime
repairs can be paused/resumed in the console; pausing does not undo a listener's
active playback or a previously corrected link. Reloading resets tab-local state.

## Acceptance and rollout

`npm run test:sentinel` exercises missing source binding, no autoplay, real-HTTP
HEAD transport, failed transport, explicit policy prompts, stale results,
canonical query preservation, canvas failure, audit delivery failure, ingestion
bounds/origin/rate checks, and idempotent allowlisted source recipes.

Rollout remains a review PR; do not merge merely because the new job is green
when other required checks are red. No production config or schedule is enabled
by development alone. Verify deployed metadata, Identity, byte ranges, browser
decoding and audible sound with approved assets before claiming live resolution.
Existing `audio-endpoint-smoke` work is a separate review change, not a dependency
silently assumed to be deployed.

## Remaining roadmap

Broad all-release/server-route crawling, decoded-media and hardware-audibility
proof, durable offline replay, operator-authenticated rollback controls, and
general-purpose AI-generated source repair require separate design and approval.
They are not implemented or guaranteed by this bounded subsystem.
