# Master provenance foundation

`netlify/lib/master-provenance.mjs` is an **unconnected cryptographic foundation**.
It is not a ledger, upload integration, endpoint, or verification dashboard.
Existing uploads and playback are unchanged. No records are persisted and no
existing or future upload is automatically protected or verified by this code.

The primitive streams actual bytes into SHA-256, enforces an exact expected length
and bound, and authenticates a fixed, versioned record with HMAC-SHA-256. The MAC
covers owner, song, version, source kind and identifier, byte count, digest,
timestamp, and key version using a domain-separated deterministic encoding.
Record authentication alone does not check the current audio; `verifyMasterBytes`
also reads and compares the bytes. A stream error or length mismatch is an error,
not a successful verification. All source identity, expected size, timestamp,
and storage access must be established by trusted server code.

## Key management for future integration

Set `HALO_PROVENANCE_ACTIVE_KEY` to a version identifier (letters, digits, `_`,
or `-`) and `HALO_PROVENANCE_KEYS` to a JSON object mapping version identifiers
to canonical base64-encoded random keys of at least 32 bytes. Generate keys with
a cryptographically secure random source; do not use passwords. Configure these
as server-only secrets, never in the browser or a repository. Rotate by adding a
new random key and changing the active identifier while retaining previous keys
for verification. Removing or losing an old key makes its records unverifiable;
compromise of a key permits forgery. Keep secure backups and restrict access.
The loader rejects malformed configuration and missing active keys.

## Work required before deployment

* Design durable transactional persistence and schema/migrations consistent with
  the existing Drizzle snapshots; define replacement, deletion, idempotency and
  concurrency semantics. A MAC does not by itself prevent deletion or rollback.
* Integrate both direct S3 and chunked blob uploads, reading server-side stored
  bytes in order, not client checksums or audio metrics. Bind the read to an
  immutable object version or otherwise eliminate overwrites and races between
  reading, finalizing, and persisting. Handle timeouts, storage and database
  failures explicitly without disrupting existing playback.
* Add authenticated, owner-scoped authorization for every read and verification
  operation; do not expose secrets, storage credentials, or other users' data.
  Add a dashboard only after these backend guarantees exist.
* Add deployment-level tests for real storage behavior, concurrent replacement,
  key rotation, authorization, retries and failure recovery.

This is a private server-authenticated integrity record, not proof of ownership,
an audio watermark, a public timestamp, or independently verifiable evidence.
Anyone holding the HMAC key can create records; a valid MAC does not prove when
or by whom the recording was originally created.

Run the foundation contracts with `node scripts/master-provenance-contracts.mjs`.
