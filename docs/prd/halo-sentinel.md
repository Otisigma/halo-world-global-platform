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
| Whole-site regression guard | PR CI and the repair workflow run the site link audit and registered satellite-route contract | Static source contracts do not replace authenticated live probes |

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

Before creating a branch/PR, the workflow requires the whole-site link audit,
registered satellite-route contracts, Sentinel source/runtime/API contracts,
Drive/catalog/player/preloader/Concierge contracts and build.
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

The automated checks cover all statically registered public pages/routes through
`scripts/site-audit.mjs` and `npm run halo-signal-check`; the runtime watcher and
recovery adapter remain intentionally limited to Dreamweaver and Album Concierge.
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

## Working list to reach the PRD target

“100%” here means every item below is implemented and independently verified
for an explicitly inventoried HALO scope. It does not mean zero outages or
guaranteed audible sound: browsers throttle background work, providers fail,
and software cannot verify a listener's speakers. Do not mark an item complete
from source inspection alone when it requires deployed evidence.

### Phase 0 — Establish a trusted production baseline

- [ ] **Review and land the current prerequisite changes.** Maintainer reviews
  and merges PR #487 (five audio endpoint probes), PR #488 (Dreamweaver
  playback recovery), and PR #489 (Sentinel). Resolve all required CI and
  independent review findings; do not merge on green CI alone. As of
  2026-11-03, all three are open; #489's checks pass, but production is not
  updated.
- [ ] **Verify deployed behavior after merge.** Using maintainer-approved,
  published assets and a production-safe account, verify the five stream routes,
  CORS/auth policy, browser playback in Dreamweaver and Concierge, and a real
  Sentinel event in the signed-in Ledger. Record environment, timestamp,
  route/asset class, status, and evidence without recording private IDs/tokens.
- [ ] **Baseline the supported surface.** Generate a versioned inventory of
  public pages, interactive media surfaces, audio APIs, canonical routes, and
  authenticated/rights-gated routes. Name each owner and test mode; do not
  probe private routes without explicit credentials and approval.

### Phase 1 — Close declared monitoring coverage

- [ ] **Add runtime adapters to every inventoried interactive media surface**
  (including radio, mixes, catalog players, and DJ deck where applicable).
  Acceptance: every adapter resolves only its existing authorized source,
  registers before interaction, preserves gesture-based playback, and has
  tests for source loss, error, pause, replacement, and teardown.
- [ ] **Add bounded server-side checks for every inventoried public audio/API
  route.** Reuse the five-route audio probe pattern; cap bytes, duration,
  redirects, and concurrency. Keep credentials scoped to approved origins and
  routes. Acceptance: route inventory and probe inventory match; missing
  configuration is reported as unknown/failure, never green.
- [ ] **Cover canonical and navigation health from the shared route registry.**
  Check all declared public canonical destinations and internal links, with
  explicit allowlists for redirects. Acceptance: wrong host/path is reported,
  not guessed or rewritten; route contract changes fail CI with actionable
  evidence.

### Phase 2 — Prove media readiness without false healthy states

- [ ] **Separate transport from media readiness.** Keep bounded HEAD/range
  checks as transport evidence; add browser `loadedmetadata`/`canplay` and
  observed `playing` checks where applicable. Acceptance: status names the
  evidence level and never equates HEAD or a resolved `play()` promise with
  decoded or audible playback.
- [ ] **Exercise approved media failure modes.** Test 404, non-audio response,
  range mismatch, expired authorization, CORS denial, timeout, decode error,
  autoplay denial, local Blob selection, and stale-source races. Acceptance:
  no source substitution, autoplay bypass, leaked private data, or stopped
  native playback solely because a metadata probe was CORS-blocked.
- [ ] **Add a repeatable production smoke procedure** for approved assets and
  accounts. Acceptance: store reproducible browser/network evidence and
  distinguish synthetic fixtures from deployed verification.

### Phase 3 — Make diagnostics dependable and operable

- [ ] **Design durable, privacy-minimal retry.** Specify retention, deduplication,
  offline behavior, storage limits, and deletion. Persist only the existing
  enum-only event contract; never queue URLs, tokens, private IDs, filenames,
  or stack traces. Acceptance: restart/offline/reconnect and quota failures
  are tested and never appear as successful ledger writes.
- [ ] **Complete operator controls.** Provide authorized pause/resume and
  recovery/audit history with clear scope, actor, and timestamps. Add a
  reviewed rollback procedure for runtime/config/source fixes. Acceptance:
  unauthorized users cannot change global settings; every control action is
  auditable and reversible.
- [ ] **Set measurable service objectives.** Define coverage denominator,
  detection delay for foreground/background checks, event-delivery success,
  false-positive rate, recovery success, and escalation behavior. Acceptance:
  report actual measurements and exclusions; do not promise hard SLAs for
  browser-throttled tabs or external dependencies.

### Phase 4 — Expand source repair safely

- [ ] **Grow the finite repair catalog from incident evidence.** Each recipe
  needs an owner, narrow allowlist, deterministic preconditions, regression
  test, idempotence test, and rollback instructions. Unknown or ambiguous
  states must stop without editing.
- [ ] **Treat AI-generated changes as proposals only.** If added, run in a
  least-privilege workflow with no secrets or production-write access; require
  tests, diff artifact, independent review, and maintainer approval before
  merge. Never let browser observations become executable instructions.
- [ ] **Drill the failure path.** Simulate a bad generated proposal, failing
  tests, duplicate proposals, missing PR permission, and rollback. Acceptance:
  no merge/deploy occurs, the exact failure is surfaced, and maintainers can
  recover through a reviewed revert.

### Phase 5 — Release gates and completion score

- [ ] **Independent verification:** reviewer not responsible for the
  implementation inspects the final diff, tests a failure scenario, and
  records findings/disposition.
- [ ] **Production acceptance:** maintainer verifies approved deployed routes,
  real ledger persistence, and supported-browser playback; unresolved
  limitations are listed.
- [ ] **Enablement:** only after the prior gates, maintainer explicitly enables
  the scheduled workflow and confirms its first run produces either a clean
  report or a review-only PR.

Track completion by acceptance items, not by confidence language. The target is
100% only when every checkbox is evidenced for the declared scope; any excluded
surface must be explicitly named rather than counted as covered. Current
implementation has the two-page adapters, finite markup recipes, static
19-page/32-route contracts, and local synthetic browser evidence, but the
production, full adapter/route inventory, durable queue, and operational gates
above remain open.

## Dreamweaver readiness telemetry bar

`dreamweaver/readiness-telemetry.js` renders the song-lobby "AI TELEMETRY" bar
(`#aiReadiness`) from observed `#showAudio` media events plus the player's
`halo:release-state` verdict. It never plays, mutes or rebinds audio.

| State | Evidence | `window.HALO_STREAM_READY` |
|---|---|---|
| `standby` / `deferred` | no source / preload deferred or fetch suspended until Play | `false` |
| `loading` / `buffering` | `loadstart` / buffered range at the playhead | `false` |
| `ready` / `loaded` | `canplaythrough` / buffer reaches 100% | `true` |
| `playing` | `playing` event | `true` |
| `stalled` | `waiting` / `stalled` with too little data | `false` |
| `fault` | media `error` with a source, or player verdict `unavailable` | `false` |

Agents should read `window.HaloDreamweaverReadiness` (`state`, `label`,
`percent`, `ready`, `readyState`, `local`) or `#aiReadiness[data-state]`.
`ready` means the browser expects uninterrupted playback; only `playing`
proves playback started, and neither proves audible sound.
