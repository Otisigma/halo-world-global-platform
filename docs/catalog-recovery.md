# Catalog recovery satellite

`/catalog-recovery/` is a device-first **recovery workspace**, linked from the
catalog header. It does not replace the backend ledger, change existing uploads,
activate signing, or make device-only audio available for public streaming.
Existing catalog playback and optional cloud hosting remain unchanged.

## User workflow

1. Load an authenticated owner catalog, add a device-only song, or import a
   previously exported register. A device-only SID is a local reference, not
   a registered HALO release.
2. Select actual originals. Bulk file/folder selection matches historical
   fingerprints or unique catalog filename/size candidates. Ambiguous and
   unmatched files require manual assignment. Confirm intended version identity:
   names and sizes alone do not authenticate a master.
3. Name separate storage and select a copied file for byte comparison. The
   browser cannot prove that this selection came from another physical device.
   Recorded matches are historical; it cannot promise continuing availability.
4. Add agreement documents and references if desired. Supply no passwords,
   recovery phrases or private keys. Legal validity, title and shares are not
   adjudicated. Ask a solicitor to arrange rights, inheritance and access.
5. Download a full or per-song ZIP with selected files and check that it saved.
   Extract it on another device and verify before relying on it as a backup.
   Print/save PDF from the register or the exported HTML.

Nothing autosaves. Save the register draft before closing; drafts contain
metadata and checks, **not audio**. Importing a draft does not reselect files,
authenticate stamps or recheck backups. Files are never written to browser
storage or uploaded by this satellite. Original catalog reads and optional
observation authentication contact HALO with metadata only. The pack exporter
loads two public, static verification tools, not a server-side upload.

## Pack contents and limits

- `manifest.json`: versioned, unsigned asset register.
- `register.html`: self-contained printable inventory and local file checker.
- `assets/<song-id>/<version-id>/<safe-filename>`: selected original files and
  supporting documents. Missing versions are reported, not fabricated.
- `verify-recovery.mjs` and `recovery-core.mjs`: standalone Node verifier.
- `README.txt`: counts, missing versions, recovery and security instructions.

At most 500 songs, 100 versions per song, 5000 versions overall, 200 MiB per
file and 2 GiB per ZIP. Browsers hash one whole file at a time with Web Crypto;
this is bounded, not streaming hashing. Smaller per-song exports avoid the
whole-catalog pack bound. Large files need an independent archival workflow.
Available memory/disk and browser download permissions can impose lower limits.
ZIP files are **not encrypted**. Use encrypted storage and separate locations;
keep access instructions and secrets in an agreed secure arrangement.
Do not assume a downloaded ZIP has been copied to a USB or survived restore.

## Offline recovery

Extract the pack and open `register.html` locally. Select recovered files for
SHA-256 comparison; no external network is used. If browser cryptography is
unavailable, install Node.js 20+ on the recovery machine and run:

```sh
node verify-recovery.mjs /path/to/extracted-pack
```

The script hashes assets as streams. It exits nonzero if any catalog version is
missing, differs, has no recorded fingerprint, or cannot be checked. It rejects
asset links resolving outside the extracted directory. Extra unlisted files
are not evidence of complete recovery. Optional missing stems or alternate
versions therefore cause a strict inventory check to report incompleteness.

A changed manifest can carry changed fingerprints: **this is not a signed
certificate**. Keep an independent copy of the register. HMAC observation
references are historical assertions in this pack; they cannot be independently
verified offline. Use the separate retained-snapshot export and separately
trusted public key for its Ed25519 verification, if actually configured.
No private signing key is needed to recover audio or check exact file bytes.

## Trust and legal boundaries

No “always backed up,” copyright, valuation, legal inheritance, independent
timestamp or immutable ledger claim is made. Rights fields are declarations and
agreements are supporting files, not automated legal proof. Source files may
change after checks. A lost sole file cannot be reconstructed from its hash.
An encrypted USB and a hardware signing token are different devices; personal
key generation, signing, encryption, inheritance automation and USB management
are not implemented here. Platform-held HMAC keys are not client wallet keys.

Run `npm run test:catalog-recovery`. Browser checks should cover catalog loading,
device-only creation, file/no-network behavior, different backup bytes, ZIP
export and offline restore, printed layout, and imported unsigned records.
