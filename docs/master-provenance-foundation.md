# Master provenance observations

The catalog's owner-only provenance panel can record an authenticated
**observation of bytes read** from a selected active sale master, list recent
observations, and re-read storage to compare it with an observation. It can
also compare a local file's exact bytes in the browser against an authenticated
observation without uploading the file. The local comparison has a 100 MiB
limit and requires Web Crypto in a secure browser context.

The selected song's private workspace displays the gold HALO provenance stamp
only after the server authenticates a current-source observation's manifest.
It shows the record ID, date, byte size and SHA-256 digest. Merely having artwork,
an uploaded master or an unauthenticated history row does not earn this display.
Refreshing reauthenticates the record; unavailable keys or invalid records hide
the stamp and show an explicit error. This is not a public certification badge.

The server reads the configured direct-object or chunked storage source rather
than trusting a client-supplied digest. It hashes the bytes with SHA-256 and
authenticates a versioned record with HMAC-SHA-256. The record binds the
authenticated owner, song, version, source identity, byte count, digest, server
timestamp, and key version. Verification authenticates that record before
comparing it. A history listing alone does **not** authenticate its entries.
Failures, unavailable keys, stale source identities, size limits and storage
errors are not successful comparisons.

## Important limitations

Storage is mutable. Direct uploads use reusable presigned URLs and chunk writes
can race with finalization or reads. An observation is of the sequence actually
read; in particular, a concurrent chunk rewrite can produce a sequence assembled
from different writes. It is not necessarily a snapshot of a master that existed
at a single instant. An identical later read does not prove that the bytes were
never changed in between. The ledger can be deleted or rolled back by those
with database access; HMAC does not prevent this.

Successful direct-master registration and chunked sale-master finalization now
attempt an observation automatically. Upload retries reuse an authenticated
observation for the same registered source. Other version types are not observed.
The upload receipt reports observation failures separately: missing keys,
migration or storage, a changed source, or the shared one-read-per-minute limit
do not undo a saved upload. The panel refreshes history after catalog reload.
Existing uploads are not backfilled; use **Record observation** for them.
Automatic observations require the observation migration and HMAC keys below,
not the separate retained-snapshot bucket or Ed25519 keys.
When retained capture is enabled, a successful capture supplies its authenticated
digest to the observation writer, avoiding a second master read and contention
with the shared read limit.

No audio DNA,
watermark, independent timestamp, public-key signature, proof of legal ownership,
or independently verifiable certificate is provided. Re-encoding, metadata
changes or edits change the byte digest; a mismatch does not establish that the
recordings are unrelated. Anyone with the HMAC key can create records.

## Deployment and key management

### If the panel reports service unavailable

The panel is a reader/comparison workspace, not another upload destination.
Upload the sale master through the main catalog upload; automatic observation
creation runs after successful registration.

Authenticated errors now distinguish missing signing keys, incomplete database
schema, and other database/storage failures. **Signing setup required** means
configure both HMAC environment variables below and redeploy; **Database setup
required** means apply the observation migration. Observation controls are
disabled for these setup errors, but **Refresh history** stays available.
After fixing configuration, refresh history to restore the controls.
Generic connectivity or incomplete-read failures remain explicit non-successes;
check function logs and the configured storage provider. No error exposes
credentials or storage URLs, and observation failures do not delete uploaded audio.

Apply the `master_provenance_observations` migration using the existing database
migration process before enabling the feature. Set `HALO_PROVENANCE_ACTIVE_KEY`
to a version identifier (letters, digits, `_`, or `-`) and
`HALO_PROVENANCE_KEYS` to a JSON object mapping version identifiers to canonical
base64-encoded random keys of at least 32 bytes. Generate keys with a
cryptographically secure random source; do not use passwords. Configure these
as server-only secrets, never in the browser or a repository.

Rotate by adding a new random key and changing the active identifier while
retaining previous keys for verification. Removing or losing an old key makes
its records unverifiable; compromise of a key permits forgery. Keep secure
backups and restrict access. Restore missing keys or database connectivity
before retrying a failed operation; do not treat an error as a match. If a
master's source was replaced, record a new observation after confirming the
intended file.

## Work still required

A separate [retained snapshot implementation](retained-master-snapshots.md) now
provides opt-in archival copies and Ed25519 signatures. It does not upgrade
existing observations or make their original sources immutable. Its configuration,
deployment prerequisites and explicit source-consistency limitations are separate.

Immutable versioned storage or another proven mechanism is needed to bind a
read and persisted record to one stable master under concurrent writes, followed
by safe automatic upload-time integration and retry semantics. Real deployment
tests must exercise storage races, database migration, keys, authorization and
failure recovery. A build or promotional page is not evidence that production
is configured or that observations are being created.

Run the foundation, observation API, panel and promotion contracts with
`npm run test:master-provenance`.
