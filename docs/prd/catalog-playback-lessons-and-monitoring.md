# Catalog and Dreamweaver: lessons, test log, and monitoring

Recorded: 2026-11-04. Scope: Song Catalog, Dreamweaver Catalog Curator,
Dreamweaver song playback, Album Concierge, and their authorized audio routes.

## Evidence and rollout status

The direct Song Catalog playback implementation is commit `62884d6`, proposed in
PR #497. At the read-only GitHub check on 2026-11-04, that PR was still open with
no merge commit. The user reported starting testing; no production test outcome
has been supplied. Neither a successful preview build nor a green check establishes
that production contains the implementation.

Confirmed implementation and verification:

- Song-card selection binds its verified persisted canonical master to
  `showAudio`, calls `load()`, and requests playback within the click handler.
  Version Play actions bind the selected version without opening the editor.
- Only the exact version-matched owner route
  `/api/song-catalog/audio?versionId=<UUID>` is accepted by the new player.
  The server remains responsible for authorization and media delivery.
- Missing or unverified audio clears the prior source and readiness instead of
  leaving a different song playing. Existing version editing remains available.
- The new player's READY flag requires observed media readiness, with
  `readyState >= 3` and no media error. Loading, buffering, and faults clear it.
- Local Chrome checks at 1280 px and 390 px used mocked authenticated catalog
  responses and a synthetic WAV. Song selection and version selection started
  playback on the first click with advancing `currentTime`; unavailable audio
  cleared the source. The new player fit both viewports.
- `test:drive-catalog`, `test:dreamweaver-assets`, `test:sentinel`,
  `scripts/song-catalog-contracts.mjs` (89 checks), and
  `scripts/site-audit.mjs` (567 checks) passed locally. These are targeted results,
  not a claim that the entire repository suite passed.
- The implementation PR's reported checks passed; Netlify's Pages changed check
  was skipped. Its current checks must be re-read after subsequent commits.

Earlier live checks could not resolve the deployment hostname from this
environment. That was an observation at the time, not proof of a continuing
production outage. Physical audibility, real owner authentication, provider
availability, mobile Safari, and production deployment remain unverified here.
The Chrome layout check covered the new player, not the whole page: the fixture
also exposed overflow in existing pipeline and metadata panels outside this change.

## Owner outcome coverage

The private Control Center at `/halo-command.html` includes an outcome review,
served by the existing owner-authorized, read-only
`GET /api/halo-control-center?view=outcomes`. It performs four independent
aggregate reads. Missing sources are labelled unavailable, not zero; a zero
denominator produces "Not enough data", not a perfect success rate.

The verified-owner section of the HALO satellite menu includes an **Outcome
Dashboard** shortcut to `/control-center#ownerOutcomes`. The link scrolls to and
focuses the outcome heading only after owner authorization reveals the panel.
Opening the URL while signed out still requires the existing owner sign-in;
the shortcut does not expose private measurements in the public route map.

- **Creator preparation:** projects created in the last seven days with all
  thirteen Release House rooms currently complete. This is not proof of
  publication, unaided completion or time to completion; no historical
  completion timestamp or assistance attribution is inferred.
- **Repeat listeners:** distinct members with consented listening reports in
  both consecutive seven-day windows, divided by those in the preceding
  window. Only currently enabled preferences with recorded consent are
  included. Revoked data is excluded; anonymous listeners are not joined to
  members, and no identities leave the aggregate query.
- **Shop start reliability:** `shop_playback_attempt` precedes each shop-player
  `play()` request. `shop_playback_ready` requires the real `playing` event;
  `shop_playback_failed` records a media error or non-cancellation rejection.
  Reports carry only an ephemeral `play_id`, not media URLs. Duplicate terminal
  events are suppressed and aggregate queries deduplicate attempt identifiers
  per anonymous browser. A start and later failure can overlap. Missing
  terminal reports, cancellation and pending attempts remain unknown.
  This measures `/music/` and `/music-upload/`, not all players, audibility,
  buffering, full-track completion or platform uptime. Collection uses existing
  anonymous stats and browser tracking preferences. It starts at deployment;
  old events are not retroactively called playback attempts.
- **Operational follow-through:** open maintenance issues, newly observed issue
  records, currently scheduled-source records, and issues marked healed in the
  window. These are stored workflow signals, not proof that a problem was caught
  before users were affected or that a repair was independently verified.

The outcome panel shares the existing owner sign-in lifecycle, clears on
sign-out and authorization denial, ignores stale responses and does not cache
private results in browser storage. It does not invent an overall quality
score, an industry benchmark, sales, or revenue. Refresh after deployment and
compare the labelled coverage against real artist and listener pilot results.

## What we learned

| Lesson | Rule for future work |
| --- | --- |
| A completed release conveyor is saved workflow state, not audio evidence. | Keep catalog, publication, transport, media readiness, and audible-output claims separate. |
| Assigning a URL, successful HEAD, or resolving `play()` is insufficient. | Observe media events and advancing `currentTime`; ask a human to confirm sound. |
| An asynchronous preflight can consume the browser's gesture window. | Bind/load/play synchronously from the click; do not make a network round-trip a prerequisite for that gesture. |
| A CORS-mode HEAD can fail while native audio plays a signed-storage redirect. | Preserve the existing bounded native-media verification path for ambiguous fetch failures; do not override definitive HTTP/media errors or bypass CORS. |
| A Drive share link is not an authorized stream or a canonical-master grant. | Use the surface's existing owner route or allowlisted same-song proxy; never substitute arbitrary external audio. |
| Different players had different resolvers and extra edit/upload steps. | Reuse authorized source resolution and keep identity, title, artist, and source together on every selection. |
| Local previews can be useful but are not persisted masters. | Clearly label local audio; never let it authorize publication, catalog readiness, or remote repair. |
| Stale asynchronous work can describe the wrong selected song. | Test rapid A/B/A switching, late errors, rejected play promises, and stale preflight responses. |
| `preload="none"` and a suspended idle preload can be intentional. | Do not classify deferred loading or an inactive/background tab as a broken stream. |
| A mute or autoplay permission failure is not necessarily a transport failure. | Preserve mute/volume choices and offer explicit gesture recovery; never silently unmute. |
| Static assertions and mock media miss deployment and browser failures. | Combine focused contracts, actual HTTP semantics, browser decoding, and approved live checks. |
| Broad CSS regexes previously produced false positives. | Scope assertions to the intended selector/media block and include negative fixtures. |
| Green CI, merge, deployment, and live acceptance are distinct milestones. | Record each separately; do not label unresolved or unobserved stages healthy. |

## Live upload readiness telemetry

Catalog audio uploads now report readiness while bytes land instead of only after a manual recheck.

- Each stored chunk returns an owner-scoped `readiness` preflight (`INGESTING`, progress, metadata/rights/sale-master checks and blockers). Preflight is advisory and always reports `catalogReady: false` and `streamReady: false`; partial bytes are never playable.
- `finalize_upload` and direct master `register` already run Dream Weaver review, the release conveyor and publication reconciliation. Their responses now include the resulting receipt: `NEEDS_ATTENTION`, `CATALOG_READY` or `LIVE` (catalog ready, release published and Dreamweaver share confirmed).
- If the readiness lookup fails after audio is locked in, the response reports `PENDING_RECHECK`; the upload is never rolled back, and scheduled recovery refreshes publication state.
- The catalog UI shows the live note during upload, in the final receipt, and dispatches a `halo:upload-readiness` window event for other panels.
- Monitor: chunk responses missing `readiness`, `PENDING_RECHECK` rates, and finalized uploads that stay `CATALOG_READY` because `shareVerification.reason` is pending.

## Dreamweaver show-view canonical master

The public release catalog includes `catalog.masterCopy.audioSource` only for
one approved, persisted sale master on a rights-cleared, published public song.
It contains the existing access-checked HALO audio route, never a storage key,
signed storage URL, or raw Drive share link.

Song-linked Dreamweaver show views prefer this live catalog binding and load it
into `showAudio` using the existing preload/load/play controller. Visual assets
hydrate independently and cannot replace that selected master. If this field
is absent, the existing canonical binding and authorized same-song stream
fallback remain in place. Cached records cannot authorize the direct path.
Transport/media failures still surface honestly; a completed conveyor is not
proof that audio is audible, and binding does not autoplay.

On a remote fault, Play and the explicit retry button retry that same song's
canonical route rather than opening a file picker. The local-preview picker
remains separate. A failed background HEAD/CORS probe alone does not discard an
otherwise healthy native media source; definitive HTTP failures with no native
readiness and actual media errors still fail normally.

Chunk-backed master playback caps each requested byte range at one storage chunk
(4 MiB), including
open-ended browser requests such as `bytes=0-`. Previously that request assembled
the entire remaining HD file before returning its first bytes. Partial responses
retain the full file size in `Content-Range`, allowing the browser to request
subsequent windows or seek. Signed direct-storage redirects are unchanged.
Matching the upload chunk size avoids repeatedly fetching a four-MiB storage
chunk for each smaller playback response while staying below buffered binary
response limits.
Initial metadata/decoder loading has a bounded 20-second budget; a buffered
stream retains the existing five-second stall watchdog. The real master required
an initial range, a tail metadata range and a subsequent audio range. Applying a
five-second stall deadline to that startup sequence paused the player even after
the bounded responses made the 292.4-second WAV decodable.

The show displays a bounded diagnostic GET on a failed same-origin source,
including its HTTP status, content type and API message. It requests only bytes
0–63, cancels after the first response chunk, has an eight-second timeout, and
never displays audio bytes, redirect targets or query parameters. This diagnostic
does not authorize playback or certify a deployment. A successful response does
not establish that a browser decoded or audibly played the stream.

The existing manual Live audio endpoint smoke workflow has a `diagnose_song`
mode. It needs only a public song UUID, looks up that exact song's canonical
route, and probes it without private credentials. This mode uses the repository
probe origin, or the HALO production origin if unset. Normal five-stream mode
still validates all required IDs in the smoke script. Neither mode changes
Netlify configuration, publication data or stored audio.

The public-song mode also opens the actual show in isolated headless Chrome,
uses a real input click and checks advancing `currentTime`. Its separate
bounded-range experiment caps only the test browser's requests, explicitly
without changing deployed code. This comparison can isolate range-assembly
latency from metadata availability. It does not certify physical audibility.
The experiment also loads this branch's four player modules only in that
isolated browser, so startup timing changes can be tested against real public
audio without deploying candidate code or modifying production records.

A local native-Chrome reproduction used the real show code and actual catalog
handler with a synthetic 28 MiB PCM WAV and 900 ms per storage chunk. Unbounded
`bytes=0-` assembled all seven chunks, exceeded the player's five-second startup
watchdog and remained paused at 0:00. With the same WAV and one-MiB response cap,
Chrome observed `loadedmetadata`, `canplay`, `playing`, and advancing time
(`0.502252` seconds). This isolates the failure mechanism but is not a claim
that production has deployed the fix or played the real master.
The final chunk-aligned four-MiB implementation was then checked with the same
real handler and fixture: Chrome received `bytes 0-4194303/29360128`, reached
`readyState: 4`, emitted `playing`, and advanced to `0.500782` seconds with mute
off and volume 1.

## Shared player upload indicator

The shared compact upload indicator appears over player pages while a Song
Catalog audio upload is active. It shows the song title and byte progress,
switches to an indeterminate state while the server finalizes the upload, and
briefly confirms completion. If an upload pauses, it points the user back to
the Song Catalog resume flow. A same-origin `BroadcastChannel` mirrors updates
to other open player tabs without persisting the title or upload state.

Pages with their own player bootstrap load the shared indicator directly;
pages using `stats.js` receive it through that shared bootstrap. This visual
receipt reports upload activity only—it does not claim that playback or
publication is ready.

## What AI monitoring exists, and what is still missing

Sentinel currently integrates with Dreamweaver and Album Concierge. Its active-tab
watcher uses mutations, media events, and a 15-second watchdog; background
throttling prevents a universal detection-time guarantee. It offers bounded
authorized recovery and privacy-restricted browser observations in the HALO Ledger.

The new Song Catalog player exposes `HALO_STREAM_READY` and
`HaloDreamweaverReadiness` in its own window but does **not** register a Sentinel
adapter or send its player events to the ledger. An embedded Song Lab has a
separate window; parent readiness does not certify iframe playback. Site-wide
runtime coverage and continuous live endpoint monitoring must not be inferred
from these integrations or from CI.

`.github/workflows/halo-sentinel.yml` supports manual source checks and an opt-in
15-minute schedule gated by `HALO_SENTINEL_REPAIR_ENABLED == 'true'`. It restores
only known markup recipes, verifies them, and proposes a review PR. It does not
merge or deploy. The schedule variable could not be read by this session's
integration (HTTP 403), so whether scheduled repair is enabled is **unknown**.
No monitoring configuration or schedule was changed while writing this log.

## What AI should monitor next

The following is a recommended monitoring backlog, not newly deployed monitoring.
Owners are proposed responsibilities rather than confirmed assignments.

| Priority | Signal and acceptance evidence | Follow-up owner |
| --- | --- | --- |
| Critical | Selected identity disagrees with the bound source/title, private media is accessible without authorization, or a fallback changes songs. Test authorized and unauthorized access plus rapid selection. | Catalog/API maintainer; stop unsafe recovery and require review. |
| High | A verified master enters an upload/local-preview interruption, selection fails to load/play, or stale readiness survives a source change. Test song cards, version Play, and Curator actions. | Player maintainer; add Song Catalog Sentinel adapter coverage. |
| High | READY contradicts media errors, insufficient data, or a stalled playhead after a user requested playback. Preserve intentional pause/ended/deferred states. | Player/telemetry maintainer; reproduce with browser events before repair. |
| High | Audio returns HTML, failed status, invalid range responses, expired redirects, or authentication failures. Check approved assets with bounded HEAD/range requests and browser decoding. | API/storage maintainer; diagnose auth, provider, and transport separately. |
| High | Deployed version differs from the accepted commit, canonical song routes break, or stale cached assets hide changes. Record deployed revision and verify the actual catalog and Dreamweaver routes. | Release maintainer; review deployment evidence. |
| Medium | Browser gesture denial, mute/volume regressions, repeated retries, or duplicate competing players. Exercise Chrome and mobile Safari with explicit clicks. | Player maintainer; distinguish permission warnings from outages. |
| Medium | Ledger delivery fails, observations remain queued, reports flood, or an adapter loses listeners/teardown. Verify a stored acknowledgment, bounded retry, offline/reconnect, and pause/resume. | Sentinel maintainer; never claim an incident was recorded without acknowledgment. |
| Medium | Runtime/probe inventory falls behind new media surfaces or route changes. Compare declared surfaces and authorized test modes against implemented adapters and CI coverage. | Platform maintainer; mark missing coverage unknown. |
| Medium | Controls overflow, keyboard Play/Edit behavior breaks, status is inaccessible, or Song Lab reload loses work. Test long titles, small viewports, focus, and panel reopening. | UI maintainer; include the wider-page overflow observed above. |

Baseline selection-to-`playing` latency, playback failure rate, buffering frequency
and duration, and recovery success by surface and environment before approving
alert thresholds. No measured latency target or service-level guarantee exists
in this log. Exclude deliberate pause, end-of-track, and deferred preloads from
stall statistics. A repair is recovered only after subsequent observed playback;
actual sound still requires a human check.

## Safe incident records and AI action boundaries

Use the existing typed Sentinel event schema. Never send signed URLs, query
strings, private song IDs, credentials, filenames, stack traces, or arbitrary
incident prose through its enum-only ingestion endpoint. New aggregate metrics
need explicit schema/privacy review; this document does not add fields to it.
Browser reports are untrusted observations, not authority to change code.

AI may diagnose, exercise approved read-only probes, and propose tested repairs.
Runtime restoration must use the controller's already-authorized same-song
source, without autoplay. Unknown defects, cross-song substitutions, missing
permissions, unavailable credentials, and privacy violations require escalation.
Do not publish, change rights, weaken authentication/CORS, enable a schedule,
merge, deploy, or overwrite originals based on a browser report.

## Production test log to complete

Record environment, UTC time, deployed revision, browser/device, route class,
expected behavior, observation, and pass/fail/unknown. Keep private identifiers
and tokens out of the shared log; use approved synthetic or public assets.

| Scenario | Current evidence | Production result |
| --- | --- | --- |
| Song card starts its verified canonical master on one click | Desktop/mobile Chrome fixture passed | Pending user result |
| Version Play changes source/title without opening edit/upload | Desktop/mobile Chrome fixture passed | Pending user result |
| Missing/unverified source clears previous audio and readiness | Contracts and Chrome fixture passed | Pending user result |
| Curator selection preserves same-song binding and fallback | Existing contracts passed | Pending user result |
| Slow/broken stream withdraws READY and exposes honest recovery | Targeted media/transport contracts passed | Pending live exercise |
| Private owner playback succeeds; unauthorized access is denied | Server contracts; no live identity exercise here | Pending authorized live check |
| Real storage redirect, seeking, and decoding work | Controlled transport/media evidence only | Pending live check |
| Listener hears expected audio with intentional mute respected | Not established by automated checks | Pending human confirmation |
| Monitoring records incident and recovery durably | Sentinel contracts; new catalog adapter absent | Pending adapter/live ledger check |

For reproducible local regression commands and the broader phased coverage plan,
see `package.json` and [HALO Sentinel](halo-sentinel.md). Update this log with
actual test outcomes; do not convert pending entries into passes by inference.
