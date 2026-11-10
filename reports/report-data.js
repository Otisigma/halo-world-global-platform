export const reports = [
  {
    id: "HALO-TECH-001",
    slug: "project-handover",
    title: "Music that can be handed on",
    subtitle: "Project context and selected-file recovery packs",
    edition: "1.0",
    published: "10 November 2026",
    status: "Implemented capability and explicit limits",
    summary: "A technical report on HALO's device-first catalog recovery workspace: the project context it records, how selected files are packaged and checked, and what still requires a person to verify.",
    sections: [
      {
        heading: "The handover problem",
        paragraphs: [
          "A finished master rarely carries all the context needed by the next person. A useful handover may also need session files, stems, reference renders, supporting documents, dependency notes, version relationships and a clear statement about what was actually included.",
          "HALO's catalog recovery workspace is designed to prepare a portable, artist-controlled register and a ZIP of files the artist selects. The artist keeps responsibility for choosing the right originals and storing independent copies."
        ]
      },
      {
        heading: "What the pack records",
        paragraphs: [
          "The current recovery manifest can record the DAW and version, sample rate, tempo, plugin and library notes, routing and automation, external-media references, availability and licence notes, and version notes. Each song's versions can be given roles such as master, stem, session, reference render, supporting document or external media, and linked to another version of that same song.",
          "Exports list the selected file IDs in the pack inventory. A standalone verifier checks file fingerprints against extracted files. Older version 1 manifests are upgraded with empty project context; the importer does not invent a reopening test or claim that old files are newly included."
        ]
      },
      {
        heading: "What the check establishes",
        paragraphs: [
          "A matching cryptographic fingerprint is evidence that the checked bytes match the recorded fingerprint. An inventory entry records the exporter's declared inclusion; after extraction, run the verifier against the actual files. Neither fact proves legal ownership, an independent backup, DAW compatibility or that a session will reopen.",
          "A reopening result is an explicit human declaration, with details and a date. HALO does not infer a successful test from hashes, inspect plugin licenses, install dependencies, copy external media automatically, recreate the original DAW folder layout or open a DAW."
        ]
      },
      {
        heading: "Practical restore test",
        paragraphs: [
          "The current recovery workflow limits an individual file to 200 MiB and a ZIP pack to 2 GiB. For a meaningful handover test, export real project files, extract the pack on a second device, run its included verifier, then open the session in the intended DAW. Note missing media and plugins, check license availability, and compare playback with the supplied reference render. Record the environment and outcome rather than assuming a successful export means a successful restore."
        ]
      }
    ],
    sources: [
      { label: "HALO catalog recovery guide", url: "/docs/catalog-recovery.md" },
      { label: "Implementation merged as pull request #527", url: "https://github.com/Otisigma/halo-world-global-platform/pull/527" }
    ],
    limitations: [
      "File inclusion and user-entered project notes are not independently certified.",
      "The report does not establish that any particular artist's session has been reopened.",
      "Large-file limits and external-media references may require a separate archival process."
    ]
  },
  {
    id: "HALO-TECH-002",
    slug: "master-byte-observations",
    title: "What a master-byte observation can tell you",
    subtitle: "Authenticated fingerprints, comparisons and their boundaries",
    edition: "1.0",
    published: "10 November 2026",
    status: "Implemented capability; production behavior must be checked",
    summary: "A plain-language technical report explaining HALO's owner-scoped byte observations, authenticated stamps, and the difference between recording an observation and comparing bytes.",
    sections: [
      {
        heading: "An observation is a measured read",
        paragraphs: [
          "For a supported canonical sale master, HALO's server reads the stored bytes, counts them and computes a SHA-256 digest. It authenticates an observation record that binds the owner, song, version, source identity, byte count, digest, timestamp and key version. The private catalog can show a gold stamp after it authenticates a current-source observation.",
          "The stamp indicates an authenticated byte observation. It is not a public certification badge, copyright ruling, legal ownership record or proof that the storage is immutable."
        ]
      },
      {
        heading: "Observe and compare are different actions",
        paragraphs: [
          "Recording an observation creates a record of the bytes read at that time. A later stored-byte comparison rereads the source and compares the new digest and size with the selected authenticated observation. The interface should report the comparison outcome explicitly; a history row or stamp alone is not a match result.",
          "An artist can also choose a local file for an in-browser exact-byte comparison. The supported local path hashes the selected file without uploading it, up to 100 MiB and subject to secure-browser cryptography."
        ]
      },
      {
        heading: "Limits and operating conditions",
        paragraphs: [
          "Storage may change during or after a read. Chunked writes can race with reads; an observation can reflect a sequence assembled from concurrent writes. Database history can also be changed by an operator with access. HMAC authenticates records for the configured service; it is not an independent public-key certificate.",
          "Automatic observations after supported master uploads depend on the database migration, server-only HMAC keys, storage and database access, authorization, and a shared one-read-per-owner-per-minute limit. A saved upload is not rolled back if its observation fails; the receipt must be checked separately."
        ]
      },
      {
        heading: "How to verify the experience",
        paragraphs: [
          "For an existing master, request an observation and confirm the record ID, byte count and digest. Then request Compare stored bytes and confirm an explicit match result. Refresh the catalog and confirm the authenticated stamp returns. For a new upload, inspect the receipt for automatic-observation success and then repeat the comparison after the rate limit window.",
          "A successful deployment or a visible stamp is not a substitute for these production checks. Do not share signing keys, tokens or private storage URLs while collecting evidence."
        ]
      }
    ],
    sources: [
      { label: "Master provenance observations guide", url: "/docs/master-provenance-foundation.md" },
      { label: "Observation implementation and contracts in the repository", url: "https://github.com/Otisigma/halo-world-global-platform/tree/main/netlify/lib" }
    ],
    limitations: [
      "An authenticated digest is not a proof of ownership or an immutable master.",
      "Byte equality does not establish audio quality, provenance before observation or legal rights.",
      "Production keys and database migration status must be verified in the deployed environment."
    ]
  }
];
