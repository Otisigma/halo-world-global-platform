# Song Lab resumable private uploads

Song Lab already used numbered chunks, but each submission generated a fresh
upload ID and a transient failure ended the transfer without recovery. The
resumable protocol preserves the same upload ID across retries and reloads.

## Local recovery

On a valid file selection or drop, Song Lab writes the original Blob and session
metadata to IndexedDB before waveform decoding. A tab-scoped sessionStorage
pointer identifies the recovery record. Audio bytes are never put in localStorage,
converted to base64 for backup, or logged to analytics. Draft title, artist,
creative direction, lyrics, and measured evidence are checkpointed separately
without rewriting the Blob on each progress update.

Reload restores the original audio and saved measurements without requiring file
reselection or repeat decoding when measurements are available. On a later visit,
the signed-in account can recover its latest locally retained session even if the
tab pointer was lost. Unsubmitted, account-unbound drafts require their original
tab pointer rather than being exposed to a different signed-in account. The rights
checkbox is deliberately not restored. Automatic continuation uses only a
previously submitted authorization and the saved auto-resume preference; an
unsubmitted file never starts automatically. Changing draft inputs or withdrawing
rights disables that continuation. A session bound to an account requires
that same account before recovery; every new-protocol server write/status check
also checks the initiating account. Local records are not encrypted by HALO;
same-origin browser access and shared-device use remain privacy considerations.

The UI claims a backup is saved only after an IndexedDB transaction completes.
Unsupported storage, quota/permission errors, and checkpoint failures are shown
explicitly. The current tab may still upload/resume its in-memory file, but that
is not durable recovery. Browser data clearing, eviction, private-mode policies,
device loss, or closing before the initial backup commits can lose local data.
Keep the original recording; this is not a promise that data can never be lost.

Completed sessions now retain the original Blob, draft and measurements in
IndexedDB until the user chooses Discard local backup or replaces the file.
On initialization, a single authenticated history read verifies the account
before restoring local work. Completed local sessions hydrate the saved private
package from the owner-authenticated API, restore audio preview from the Blob,
and disable upload continuation. Pending drafts take priority over older server
packages. Completed packages are not uploaded or generated again on reload.

An account-scoped localStorage preference stores only the last opened project
ID, never audio, lyrics or creative packages. A selected history project wins
over an unrelated completed local buffer. If no local work remains, Song Lab
opens that account's last active private project (or its latest ready project).
Packages outside the recent history window are fetched by ID through the same
owner-authenticated API. A server package without a retained local Blob restores
results but does not claim an audio preview; no catalog master, arbitrary archive
URL or hardcoded project title is substituted. Pending server projects remain
available in history for manual continuation. Initialization retries on the
identity-ready event after sign-in; storage and authentication failures are
visible and do not delete saved work.

Restored local audio displays an explicit restored-preview label instead of the
empty-waveform "NO SIGNAL LOADED" label. The audio controls play the original
cached file; a full waveform is not claimed when only saved measurements exist.
Open this saved audio in Dreamweaver carries only the project ID. The show
offers Preview saved Song Lab audio: after a click, it verifies the current
account, reads that account's matching IndexedDB file and uses the existing
local-file player lifecycle. With no project ID, the button previews the most
recent saved file for that account. Missing backups or sign-in/storage errors
are shown without replacing the current stream. No iframe scraping, global
blob pointer, radio check, upload or master replacement is involved. Playback
restrictions still show the existing Press Play/unmute controls.

Replacing a file requires confirmation. Discard
does not remove existing server chunks or private projects. Recovery supports
one active selected upload per tab and restores the account's latest saved session
on a fresh visit; it is not a cross-device upload archive.

## Transport and finalization

- Sequential chunks are at most 4 MiB, within the existing server limit; the file
  limit remains 128 MiB. Each chunk has a SHA-256 checksum.
- Before resuming, an authenticated, origin-checked `upload_status` request reads
  the server's actual chunk metadata. Local progress is advisory: only parts
  with matching checksums and consistent shape are skipped.
- Numbered writes use deterministic owner/session/index keys. The shared XHR
  transport allows three automatic retries after the initial attempt, with
  backoff/jitter and a 120-second per-request deadline. Network drops, timeouts,
  and supported transient HTTP statuses are retryable; auth/validation failures
  are not. Offline waits are bounded.
- After exhausted chunk retries, transient failures (including HTML 502 responses
  from a gateway) can restart from server-confirmed checkpoints with 2/4/8-second
  backoff, for up to three recovery rounds. That budget is checkpointed and does
  not reset on reload. Only the submitted authorized session with automatic
  recovery enabled can continue on reload or reconnect; manual Resume resets the
  recovery budget. Authentication, validation, and explicit pause require action.
- Pause after current request retains the latest acknowledged chunk and prevents
  the next chunk/restart. It does not abort a server job already dispatched.
  Supported browsers use Web Locks to prevent two tabs from continuing the same
  upload concurrently. Without tab-lock support, recovery is manual-only.
- The server checks owner, exact byte/chunk count, individual checksums and
  sizes, and completeness before creating a private project. The original is
  represented by its verified ordered chunks, using existing chunk-backed
  private storage rather than assembling 128 MiB into function memory.
- Resumable finalization uses the upload UUID as the project UUID with
  conflict-safe insertion. A lost finalization response returns the same project
  on the next status/finalize request. Project processing claims queued work
  atomically so concurrent resume requests do not launch duplicate AI jobs.
- Private builds now checkpoint creative copy separately from artwork.
  `resume_project` retains those server checkpoints, claims queued/failed or
  expired work with a 90-second lease, and uses fenced writes to reject an older
  worker's completion. Each generation stage has a 25-second deadline and abort
  signal. Repeated calls on active or ready projects do not create duplicate
  work; a recovered stage does not discard already saved output.
- The client dispatches `/api/dreamweaver-song-lab-background`, a native Netlify
  background function, rather than holding a synchronous API request open for AI
  generation. A platform 202 acknowledgment is not proof of authorization or
  job completion; the worker verifies account/origin/rights and the normal API's
  project state provides the actual result.
- The client dispatches each newly observed queued stage promptly and throttles
  repeated recovery checks to every 30 seconds while its polling loop is active,
  for at most ten minutes per polling attempt. Browser closure stops those checks. Platform background
  execution/provider cancellation remain best effort, not a scheduler or exactly
  once external billing guarantee. A saved server job and a browser checkpoint
  remain distinct evidence.
- Older clients can still submit the previous numbered-chunk protocol.
  New clients require the new server protocol; deploy server and client together.

Completed and restored projects automatically connect saved audio to a private
Song Catalog draft through the authenticated, origin-checked
`POST /api/song-lab/catalog-bridge` endpoint. The server requires recording
permission, a title and artist, verifies each saved chunk and its checksum when
available, and copies the original into the catalog audio store before atomically
creating the song and its canonical master version. The project UUID is the
stable draft/version identity: retries do not duplicate songs or overwrite an
existing catalog master. Archived or conflicting drafts require catalog action.
The source project and its local preview are unchanged.

The draft is not for sale, has rights awaiting review and unapproved mastering,
and is never automatically published or put on radio. Owner playback uses the
catalog's authenticated stream independently of those publication checks.
Browser `blob:` URLs, audio bytes and storage keys are never sent through
localStorage or cross-tab messages. Open catalog tabs refresh their own
authenticated records on a connection notification without switching tracks or
autoplaying. Song Lab shows an Open connected catalog player link or an explicit
connection error and retry button; a connection failure does not invalidate the
private creative package. This bridge runs while Song Lab is open, not as a
server scheduler. Previously saved projects connect when opened.

Interrupted server chunks, including copies from a failed bridge operation,
are retained under the existing storage policy; automatic remote garbage
collection is not added.

## Verification and monitoring

Run `npm run test:song-lab-resume` for the actual handler with controlled
database/storage/Identity dependencies plus client reconciliation and real
shared-XHR retry contracts. It covers bad checksums, missing/inconsistent parts,
unauthorized account/origin, duplicate finalization, and bounded retries.
The suite is registered in PR CI.
It also checks stage leases/checkpoints, expired-worker fencing, generation
deadlines, late provider completions, automatic retry budgets, and spoofed iframe
messages. No live account/provider success is inferred from these fixtures.

Local desktop and mobile Chrome fixtures additionally exercised real IndexedDB
Blob/draft recovery across reload, three failed retries, missing-only resume,
account-switch rejection, renewed rights attestation, explicit discard, and
unsupported-storage warnings. These fixtures do not prove deployed provider
availability, actual user credentials, Safari support, or physical audibility.

Monitor storage-backup failures, chunk retry/exhaustion rates, resumed bytes,
checksum/shape rejection, wrong-account attempts, finalization conflicts, and
project jobs stuck queued/analyzing. Baseline latency before setting alert
thresholds. Do not include private audio, filenames, lyrics, tokens, upload IDs,
or arbitrary error payloads in public telemetry. These are monitoring
recommendations, not newly enabled Sentinel or ledger integrations.

## Coordinated responsibilities and limits

The implementation separates three deterministic responsibilities, not three
autonomous production LLMs:

1. **Pipeline overseer:** checksum reconciliation, bounded retries, persisted
   continuation preference/budget, same-account checks, and private job recovery.
2. **Audio telemetry scout:** native preview media observations only. READY for
   local audio is not proof of upload completion, storage health, or public
   stream availability. Existing Sentinel remains scoped to its registered
   Dreamweaver/Concierge controllers; it does not continuously inspect unloaded
   pages or arbitrarily probe private Drive URLs.
3. **UI synchronizer:** `HaloSongLabCheckpoint` and `halo:song-lab-progress` expose
   stage, percent, backup availability, restart count, and preview state without
   filenames, lyrics, URLs, or project IDs. The embedded catalog panel accepts
   only same-origin messages from its own Song Lab iframe, with allowlisted
   stages and bounded percent. It never overwrites `HALO_STREAM_READY` or treats
   a private package as an approved catalog master.

Focused implementation work can run in parallel, but adding agents is not proof
of reduced build time or fewer defects. This public repository cannot provision
Copilot cloud automation groups. No group, schedule, monitoring service, new AI
worker credentials, or automatic merge/deploy is created by this implementation.

For optional improvement, compare confirmed interruption recoveries with all
observed interrupted submissions and record unresolved/missing evidence
separately. Review retry exhaustion, time to recovered progress, duplicate job
attempts, provider cost, wrong-account blocks, and false-ready incidents before
proposing different retry or lease rules. Maintainers approve changes; the
controllers do not rewrite their own policies. This measurement plan is not a
claim of a measured reliability improvement.
