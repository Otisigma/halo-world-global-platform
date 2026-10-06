# Self-Reporting Maintenance System

The site now records browser, customer, and scheduled health findings in Netlify Database. Duplicate reports are grouped into one issue, AI Gateway adds a concise diagnosis and verification plan, and the issue is sent to a maintenance worker when a webhook is configured.

## Required configuration

- `MAINTENANCE_AGENT_TOKEN`: a private bearer token used by the maintenance worker and the webhook request.
- `MAINTENANCE_AI_WEBHOOK_URL`: an HTTPS endpoint that accepts new issue notifications. If omitted, issues remain stored for polling.

AI triage uses Netlify AI Gateway automatically. No provider key needs to be added when AI Gateway is enabled for the project.

## Maintenance worker contract

New issues are delivered as `maintenance.issue.reported` events. The payload includes the issue, AI-generated fix and verification steps, and a callback path.

The worker can also poll `GET /api/maintenance/issues?status=open` or `GET /api/maintenance/issues?status=reported` with `Authorization: Bearer <MAINTENANCE_AGENT_TOKEN>`.

After diagnosing or fixing an issue, the worker updates it with:

```text
PATCH /api/maintenance/issues/:id
Authorization: Bearer <MAINTENANCE_AGENT_TOKEN>
Content-Type: application/json

{"status":"in_progress","reference":"maintenance-run-reference"}
```

When verification passes, use `status: "healed"` and include a short `resolutionSummary`. Scheduled checks also mark their own availability incidents healed automatically after the affected route recovers.

The deployed site never executes arbitrary repair commands. Repository changes remain the responsibility of the authorized maintenance worker, which keeps the public reporting surface separated from code-writing permissions.

Public reports are same-origin only, payload-limited, sanitized, deduplicated, and rate-limited before AI triage. Report text is always treated as untrusted data rather than executable instructions.

## Instant deploy feedback loop

Run `npm run -s deploy:feedback` for a focused readiness check, or `npm test` for the full contract suite (which now includes the same deploy feedback step).

Deploy feedback reports four explicit pass/fail contracts:

- migration ordering in `netlify/database/migrations`
- public root routing from `/` to `/halo.html`
- Album Concierge visibility in `halo.html` (name + `/album-concierge/` link)
- Build Your Album promotion + route health (homepage copy + `/album-concierge/` CTA + local route entrypoint)

When a contract fails, the script prints a `❌` line with the exact fix direction and exits non-zero so internal AI and maintainers can immediately treat the change as incomplete.

## Prebuild release guard

Netlify runs `npm run build`: npm first runs `npm run release-guard -- --allow-missing-catalog`, then the existing music chart contracts. The storefront loads its live catalog from the Netlify Database-backed `/api/release-catalog` endpoint, so the root `shared-catalog.json` is an optional static catalog, not a deployment prerequisite. The prebuild flag skips only an absent static catalog and does not create one or modify live database records. If a static catalog is supplied, it must contain an array or an object with a `songs` array; malformed or unsupported catalogs still block the build without rewriting them. Running `npm run release-guard` directly remains strict and fails if the catalog is missing. An unresolved quarantine blocks both modes even if the catalog has been removed.

Each track must have `PUBLISHED` in every supplied `releaseStatus`/`status` field, non-placeholder artwork, a positive USD price, and an HTTP(S) checkout URL. Missing prices default to `US$1.29`; missing checkout routes use the URL-encoded track id or title slug. Remote artwork must pass a bounded HEAD request to a public address; redirects fail closed (supply the final URL). Root-relative artwork must resolve to an existing file inside the catalog root. No database or live publication records are modified.

The approved catalog retains its original array/object shape, top-level metadata, and unrelated track fields. If any track is quarantined, the guard saves the exact original catalog to `.netlify/release-guard/shared-catalog.original.json` and annotated quarantined tracks plus diagnostics to `.netlify/release-guard/quarantine.json` before atomically writing only approved tracks back to `shared-catalog.json`. These recovery files are ignored build-local data, not storefront assets or tracked source. The command exits non-zero, so Netlify does not publish that build.

To recover, restore the original backup to `shared-catalog.json`, repair the reported tracks, and only then remove `.netlify/release-guard/` and rerun `npm run release-guard`. An unresolved backup blocks subsequent runs, preventing a failed audit from silently passing after unsafe tracks were removed. Preserve the backup if writing the sanitized catalog fails. Run `npm run test:release-guard` for isolated audit, networking, and CLI recovery contracts; the script also exports `ReleaseGuardAgent` as an ES module.

## DJ control room (background self-repair loop)

`site-monitor.js` runs the shared control room in `lib/dj-control-room.js` before every monitor pass (on page load, every 15 seconds, and on audio-state changes). The loop has no UI of its own and never shows popups:

1. **Detect + classify** — unnamed controls, placeholder/unsafe links (`isUnsafeHref`), runtime exceptions, route/control mismatches, and watcher failures from `lib/watcher-registry.js`. Each defect receives a failure type (`MISSING_CONTROL`, `MISSING_ACCESSIBLE_NAME`, `UNSAFE_LINK`, `RUNTIME_EXCEPTION`, `ROUTE_CONTROL_MISMATCH`, …) and an owner from the Dash fix roster (Routing, UI, Playback, Content Agent).
2. **Repair only broken state** — re-bind stale watcher selectors to the matching control (`data-watcher-id` → canonical target + control text), name unnamed controls from existing markup, and drop `href="#"` from hidden placeholder links. Visible placeholders, `javascript:`/`data:` links, missing controls, and runtime exceptions are never rewritten; they escalate through `/api/issues` with `defectType`, `ownerAgent`, and `labels: MACHINE_GENERATED,AUTO_REPAIR` metadata.
3. **Log + learn** — every attempt, success, and failure becomes an `AUTO_REPAIR_AUDIT` event (`halo:control-room-repair`, journaled as `auto_repair`) and is persisted in `localStorage` under `halo:control-room:repair-history.v1`. Patterns seen three or more times are escalated once per page as `DJ Control Room recurring …` so maintainers can promote them into regression contracts. The current state is exposed on `window.__haloControlRoom` (`halo:control-room-update`), including the DJ deck header controls and their route targets.

Use `halo-safe-text.js` (`window.HaloSafeText.lower/upper/text/eventKey`) instead of calling `toLowerCase()` on values that may be missing. Run `node scripts/dj-control-room-contracts.mjs` to validate the loop; it also pins the regressions behind the reported `toLowerCase` crash, the DJ deck header watchers, and the recording-download placeholder link.

The DJ deck also treats a source ending before its scheduled buffer end as an unexpected playback failure. It retries that source once; a second failure stops the deck, updates Audio Scout, and reports the incident through `/api/issues`. Intentional pause/cue stops are ignored, and the silence bridge is reported as an Audio Scout failure while active.

The deck’s maintenance dock uses `halo-alert-store.js` and `maintenance-panel.js` to show current runtime, diagnostic, and network alerts with retry and clear actions. `site-monitor.js` refreshes diagnostic alerts on retry and makes failed issue submissions retryable. Run `node scripts/maintenance-alert-contracts.mjs` and `node scripts/radio-continuity-guard-contracts.mjs` to cover alert and playback-continuity behavior.
