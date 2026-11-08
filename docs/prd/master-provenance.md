# HALO master provenance

## Outcome

Give an authorized creator a reliable way to record and check whether an exact
master file matches a HALO catalog record. This is an integrity and provenance
record, not proof of legal ownership, an ownership transfer, a copyright
registration, or an industry-certified mastering process.

## Requirements

1. Hash the exact stored master bytes using SHA-256, with bounded memory. Never
   treat a client-supplied digest, filename, waveform features, or uploaded
   metadata as proof of the contents in storage. Direct-object and chunked
   uploads need equivalent verification.
2. Record a versioned, unambiguous canonical payload containing the file hash,
   byte length, master version, song, authenticated owner, and one recorded
   timestamp. Authenticate that payload with HMAC-SHA-256 and a server-held,
   versioned secret. Preserve the timestamp and canonicalization version so
   verification can reproduce the same payload. Include a distinct key ID for
   rotation; old records need their original key.
3. Anchor records to the correct owner and master version. Upload retries must
   be idempotent, replacements must not inherit another file's seal, and
   concurrent uploads must not attach a seal to a different master. Preserve
   history and distinguish active, superseded, missing and unverified records.
   Avoid blocking existing upload or playback paths on speculative readiness.
4. An authenticated, authorized owner or explicitly authorized auditor can
   verify a supplied file or the stored bytes against the corresponding record.
   Report a match, mismatch, missing record, unsupported source, unavailable
   key, or operational error distinctly. Limit input sizes and processing time;
   never fetch arbitrary user-supplied URLs or disclose other owners' data.
5. Any available audio analysis (for example spectral centroid, estimated key,
   and dynamics from Song Lab) is optional descriptive evidence, with algorithm
   version and source recorded. It is not a unique identifier, and browser
   analysis is not a server-verified fact. Do not fabricate unavailable metrics.
6. Design signing, upload and verification failures to be visible and
   recoverable. Configure secrets outside source control, do not log keys or
   signed media URLs, and provide a key-rotation and backup procedure.
   Database migration versions must follow already-applied production migrations.

## Trust and limits

- HMAC verification requires access to the secret; it is not publicly or
  independently verifiable. Anyone with the key can create a valid HMAC. The
  record is not immutable against an administrator who can change the database
  and signing key. An independently verifiable design would require asymmetric
  signatures and trustworthy public-key publication, not just HMAC.
- The record does not embed a watermark or signature into audio. Re-encoding,
  editing, or metadata changes alter the file hash; a mismatch does not prove
  that the audio is unrelated. Robust identification across distributed
  transformations is a separate, unimplemented fingerprinting problem.
- A recorded timestamp is the server's claim, not an independently witnessed
  time. A storage provider, database or key-management outage can still affect
  availability. Do not claim permanent provenance or immunity from downtime.
- Keep any listening telemetry and personal data separate from provenance.
  Signing a creator account ID does not establish legal title to the audio.

## Acceptance evidence

Test exact byte matches and one-byte changes; chunk boundaries and large files;
both storage routes; unauthorized access; stale/replaced and deleted masters;
idempotent retries and concurrent replacements; malformed, oversized and
truncated inputs; missing storage/key/database; key rotation and retained old
keys; auditable error states; and absence of secrets in output and logs.
Production readiness also requires a safely applied migration and explicitly
configured key. A successful build or a promotional visual is not evidence that
the production pipeline is stamping or verifying masters.

## Implementation status

The owner-only catalog panel provides on-demand authenticated observations,
stored-byte comparisons and browser-local exact-byte comparisons. This is a
partial implementation of the desired outcome, not upload-time stamping:
mutable storage cannot yet guarantee an atomic snapshot or bind a record to an
immutable master. See [the operational guide](../master-provenance-foundation.md)
for deployment prerequisites, key management and the remaining work. Production
behavior requires the migration and server secrets to be configured and verified.
