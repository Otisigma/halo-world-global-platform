# Retained master snapshots and verification satellite

## Implemented guarantees

When explicitly enabled and correctly configured, both direct-master registration
and chunk finalization attempt a retained snapshot. The existing upload remains
available even if capture fails; the upload receipt explicitly reports the
separate provenance result. The owner can retry through the song workspace's
**Retained snapshots, lineage & public verification** link.

Capture reads the owner-authorized registered source into a private, size-bounded
temporary file while calculating SHA-256, then uploads it with a signed checksum
and S3 Object Lock COMPLIANCE retention headers to a separate archival bucket.
It requires a non-null object version ID, checks the pinned version's size and
retention with HEAD, then re-reads that version and compares its digest. It signs
a canonical versioned manifest with Ed25519 only after those checks pass.
Temporary files are removed on normal completion or failure.

The signed manifest binds the song/version, record ID, digest, byte count, signing
key ID, server time, retention expiry, private storage commitment and declared
parent relationship. Private account identity and storage addresses are not
included in public manifests. The same ledger powers the owner workspace and
`/provenance/verify/`; there is no separate satellite ledger.

Database claims and a five-minute lease coordinate overlapping captures. An
attempt ID prevents an older attempt from completing or failing a newer one.
The final update rechecks the owner's active master and its registered source
metadata. Ready records are reused for retries of the same registered source.
Capture and verification share the existing one-expensive-read-per-owner/minute
limit. Lineage capture with a parent creates a separate snapshot record; it
cannot rewrite the original record's relationship. Parent snapshots must already
be ready, signature-authenticated and owned by the caller.

## What these guarantees do not mean

**The retained copy is stable; its input is not necessarily a stable original.**
The original direct PUT URLs and chunk writes remain mutable. Chunk capture can
combine concurrent writes. Registration checks cannot detect a same-key,
same-size overwrite. The manifest explicitly records `sourceConsistency:
"mutable_read"`. By default, canonical playback still reads the original source.
With the separately enabled `HALO_RETAINED_MASTER_PLAYBACK=true`, authorized
canonical sale-master requests use only the ready snapshot for that registered
source, pin the exact storage version, and refuse mutable fallback on missing,
invalid or expired records. Other version types remain unchanged. This stabilizes
the finalized playback bytes, not their initial input or DAW-to-streaming lineage.

Retention lasts until the specified date, not forever. AWS-style COMPLIANCE
semantics are required; GOVERNANCE mode, unversioned/null-version storage,
unconfirmed retention and a different returned version are rejected. Provider
headers are trusted only within the configured storage provider's contract;
tests against a mocked provider cannot establish that a real provider actually
enforces the contract. No immunity from outages, account loss or disaster is
claimed. Set up provider-supported replication and key backups separately.

The database can still be deleted or rolled back. The signed record can detect
tampering with its covered fields, not prove that the ledger is complete.
Operators with signing keys can issue records. Parent relationships are
creator-declared, not verified acoustic derivation. No audio DNA, watermark,
copyright registration, legal-title verification or industry-first claim is made.
The timestamp is a server assertion; **independent RFC 3161 timestamping is not
implemented or provisioned**.

## Deployment prerequisites

1. Apply `20261108020000_retained_master_snapshots.sql` after the observation
   migration through the repository's normal database migration process.
2. Provision a separate versioned, Object-Lock-enabled archival bucket with
   verified COMPLIANCE support. Use a least-privilege server-only identity:
   PUT, GET/HEAD by version and retention inspection as required by the provider.
   Do not grant bypass-retention or deletion permissions to the application.
   Check provider-specific permissions, encryption, lifecycle and replication.
3. Configure server-only environment variables:
   - `HALO_PROVENANCE_STORAGE_BUCKET`
   - `HALO_PROVENANCE_STORAGE_REGION` (defaults to `us-east-1`)
   - `HALO_PROVENANCE_STORAGE_ENDPOINT` (HTTPS S3-compatible endpoint, optional
     for AWS S3)
   - `HALO_PROVENANCE_STORAGE_FORCE_PATH_STYLE` (provider-dependent)
   - `HALO_PROVENANCE_STORAGE_ACCESS_KEY_ID`
   - `HALO_PROVENANCE_STORAGE_SECRET_ACCESS_KEY`
   - `HALO_PROVENANCE_RETENTION_DAYS` (integer 1–3650; no implicit retention)
   - `HALO_PROVENANCE_SIGNING_KEY_ID` (versioned identifier)
   - `HALO_PROVENANCE_SIGNING_PRIVATE_KEY` (Ed25519 PKCS#8 PEM)
   - `HALO_PROVENANCE_PUBLIC_KEYS` (JSON map from key IDs to SPKI public PEM)
4. Validate an actual provider upload, version-pinned read, denied overwrite/
   deletion of a retained version, database concurrency, outage recovery and
   deployed function time/memory/disk limits. Capture uses up to 200 MiB of
   temporary disk and streams memory-bounded reads; source capture and storage
   checks have bounded deadlines, but large files may exceed hosting limits.
   Failed capture must remain an explicit non-success. No background processing
   service is provisioned by this implementation.
5. Only then set `HALO_RETAINED_MASTER_ENABLED=true`. Absence of this exact value
   keeps automatic archival work disabled and leaves existing playback intact.
6. After capture and real provider media playback are confirmed, optionally set
   `HALO_RETAINED_MASTER_PLAYBACK=true`. This intentionally prevents sale masters
   from falling back to mutable sources: pending, failed or expired capture means
   unavailable canonical playback until resolved. The archival bucket must support
   the media playback/CORS/range requirements of existing direct storage.

The application does not generate or provision production keys or storage.
Generate keys in an approved secure environment, place the private key in secret
storage, and publish only public keys. Keep old public keys after rotation;
verification does not require the private signing key. Compare the active public
key with the private key before activation. Plan compromise/revocation handling:
there is no independent revocation registry in this release.

## Public and offline verification

Use the **snapshot record ID** to inspect a signed record at
`/provenance/verify/?record=SNAPSHOT_ID`. The **song ID** identifies the catalog
song and is used with its master version ID to capture or list snapshots.
Contextual help beside both fields explains the distinction on keyboard and
touch devices. Neither identifier is a signing key, and loading a snapshot does
not require re-uploading audio. Private records still require owner authentication.

Records are private until their owner deliberately publishes one. Public
verification returns only the signed record, signature and limitations.
Stopping sharing works even when capture/storage is disabled; it cannot recall
copies already downloaded. The satellite verifies Ed25519 using Web Crypto,
compares up to 100 MiB locally without uploading files, and labels retention as
not rechecked unless the owner completes a server storage check.

Public keys at `/api/master-snapshots?action=keys` are authenticated by the
trusted HALO origin, not independent trust. Exported records include verification
keys for convenience, but bundled keys are untrusted unless checked separately.
For offline checks with a separately trusted PEM:

```sh
node scripts/verify-master-snapshot.mjs \
  --manifest halo-snapshot.json --key trusted-public.pem --audio master.wav
```

This checks the signed record and exact file bytes. It does not call HALO,
recheck retention, infer rights, establish creation time or authenticate the key
provided by the caller.

## Failure recovery and remaining infrastructure

A failed/interrupted attempt may leave a retained orphan object. Compliance
retention intentionally prevents immediate cleanup. Use a provider lifecycle
policy after retention and monitor archival cost; never silently shorten
retention. Retry a failed capture, or wait for an interrupted pending attempt's
five-minute lease. Do not regenerate a ready record to disguise a changed source.
An expired ready record is not renewed in place. With pinned playback enabled,
upload a new registered master/capture with a new retention period before the
old period ends; otherwise canonical playback intentionally becomes unavailable.

Before stronger master-certification claims, eliminate mutable reads at the
initial upload boundary, validate the opt-in pinned canonical playback path
against the actual provider, wire remaining distribution/export routes to that
version, and test both upload routes under adversarial concurrency. An independently witnessed timestamp requires selecting, provisioning
and validating an external timestamp authority and trust policy. Neither that
service nor legal ownership adjudication can be supplied by a source-code merge.

Run `npm run test:retained-master` and `npm run test:retained-master:db`.
The latter uses an isolated real PostgreSQL instance and does not skip missing
database tools. Local checks and a main-branch merge are not a production
deployment, migration, or verified provider configuration.
