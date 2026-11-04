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
checkbox is deliberately not restored. A session bound to an account requires
that same account before recovery; every new-protocol server write/status check
also checks the initiating account. Local records are not encrypted by HALO;
same-origin browser access and shared-device use remain privacy considerations.

The UI claims a backup is saved only after an IndexedDB transaction completes.
Unsupported storage, quota/permission errors, and checkpoint failures are shown
explicitly. The current tab may still upload/resume its in-memory file, but that
is not durable recovery. Browser data clearing, eviction, private-mode policies,
device loss, or closing before the initial backup commits can lose local data.
Keep the original recording; this is not a promise that data can never be lost.

Local records are removed when the creative project becomes ready or the user
chooses Discard local backup. Replacing a file requires confirmation. Discard
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
- Exhausted retries retain progress, show PAUSED / WAITING and Resume Upload,
  and do not reset the session. Reconnection makes manual recovery available;
  it does not start analysis or upload without the user's submission.
- The server checks owner, exact byte/chunk count, individual checksums and
  sizes, and completeness before creating a private project. The original is
  represented by its verified ordered chunks, using existing chunk-backed
  private storage rather than assembling 128 MiB into function memory.
- Resumable finalization uses the upload UUID as the project UUID with
  conflict-safe insertion. A lost finalization response returns the same project
  on the next status/finalize request. Project processing claims queued work
  atomically so concurrent resume requests do not launch duplicate AI jobs.
- Older clients can still submit the previous numbered-chunk protocol.
  New clients require the new server protocol; deploy server and client together.

This intake does not promote a Song Catalog canonical Sale master, publish a
release, or bypass rights checks. Saved private project audio remains distinct
from an approved catalog master. Interrupted server chunks are retained under
the existing storage policy; automatic remote garbage collection is not added.

## Verification and monitoring

Run `npm run test:song-lab-resume` for the actual handler with controlled
database/storage/Identity dependencies plus client reconciliation and real
shared-XHR retry contracts. It covers bad checksums, missing/inconsistent parts,
unauthorized account/origin, duplicate finalization, and bounded retries.
The suite is registered in PR CI.

Local desktop and mobile Chrome fixtures additionally exercised real IndexedDB
Blob/draft recovery across reload, three failed retries, missing-only resume,
account-switch rejection, renewed rights attestation, successful cleanup, and
unsupported-storage warnings. These fixtures do not prove deployed provider
availability, actual user credentials, Safari support, or physical audibility.

Monitor storage-backup failures, chunk retry/exhaustion rates, resumed bytes,
checksum/shape rejection, wrong-account attempts, finalization conflicts, and
project jobs stuck queued/analyzing. Baseline latency before setting alert
thresholds. Do not include private audio, filenames, lyrics, tokens, upload IDs,
or arbitrary error payloads in public telemetry. These are monitoring
recommendations, not newly enabled Sentinel or ledger integrations.
