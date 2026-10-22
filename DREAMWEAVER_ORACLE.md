# Dreamweaver AI Oracle

The owner-only Oracle extends the existing HALO command panel and Netlify Function. It is read-only: it does not execute suggestions, publish releases, modify routing, or start playback.

## Endpoint

- `GET /api/dreamweaver/oracle` returns available aggregate publication, radio, sharing, feedback, and vote telemetry. Unavailable sources are identified as unavailable, not zero or healthy.
- `POST /api/dreamweaver/oracle` accepts bounded JSON. `{ "mode": "chat", "message": "...", "history": [], "useAI": false }` requests advice; optional OpenAI synthesis is server-side and opt-in. `{ "mode": "catalog", "query": "..." }` searches active song metadata. In the panel, use `catalog: <title, artist, album, or ISRC>`.
- Both reads and chat/catalog requests require an authenticated Netlify Identity user with HALO owner/admin access. POST additionally requires the request `Origin` to exactly match the endpoint origin and pass Netlify Identity origin verification. Responses are non-cacheable.

## Data and safety boundaries

Catalog search returns bounded title, artist, album, ISRC, genre, clearance/review states, and active-version availability metadata. It does not return audio URLs, lyrics, notes, owner IDs, or document/stem URLs. ISRC values remain intact in this owner-only response as legitimate music metadata.

An approved fallback suggestion is reported only when an active `radio_edit` or `clean` version has recorded audio and approved mastering status. This is metadata for a human to verify; the Oracle does not route or play it. If no such version is recorded, no fallback is suggested. Linked documents and individual stems cannot be retrieved through this endpoint.

DAW state synchronization is not implemented: there is no established scoped persistence path for Oracle playback state. BPM, key, playhead, playing state, and active-stem data are not accepted or persisted.

Requests for credentials, secrets, private instructions, or sensitive personal data are rejected before telemetry or model access. Request, conversation, and context sizes are bounded. Model output has targeted credential and tax-identifier redaction; ordinary music identifiers such as ISRC are not stripped. Database values and logs are untrusted data, never model instructions. Raw prompts and provider/database error details are not logged.

AI-generated code is a grounded but unverified proposal only. It is displayed as text, requires human review/testing, and is never claimed executed or deployed. Unsupported multimodal or persistence capabilities must be treated as unavailable, not inferred.

## Validation

Run `npm run test:dreamweaver-oracle` for endpoint, authorization, contract, redaction, and UI behavior checks.
