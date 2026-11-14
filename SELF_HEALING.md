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

### HALO release watchdog

The existing `release-conveyor-recover` Netlify function runs every five minutes, inspecting up to ten active catalog songs per invocation within the conveyor's bounded recovery budget. Oldest watchdog checks run first, including blocked releases; existing audio retry limits and backoff still apply. Catalog saves/uploads continue through the same leased conveyor.

`netlify/lib/halo-watchdog.mjs` defines the shared intent and versioned watchdog state. Signed-in owners read it as `watchdog` in `GET /api/release-conveyor?songId=...`; findings render in the existing conveyor console. State and `watchdog_pulse` events use the existing conveyor tables, with owner, lease, and source-revision checks. Repairs and their audit append commit atomically.

- An approved canonical sale master can queue an empty, not-started radio lane with targets of **-16 LUFS / -1 dBTP**. This creates preparation work in the existing catalog mastering queue, not mastered audio or radio rotation. Originals, existing edits, clean-content declarations, and approvals remain unchanged.
- Missing ISRCs can be restored only from a previously Council-passed release package for the same owned recording/source identity. Existing values are never replaced. Historical rights declarations are review-only suggestions: no automatic rights clearance, dispute resolution, mastering approval, or publication occurs.
- Dreamweaver graphs bind inherited artwork, version-specific visuals, video, and parsed lyrics into the release package. Graphs lock only after all bound assets pass same-origin availability/content-type checks, and unlock when those checks fail. Custom version assets remain intact.
- The scheduled pulse checks the registry's Song Catalog, Release House, Finish House, Radio, and Dreamweaver console routes against Netlify's configured HTTPS `URL`. Requests are bounded and do not follow redirects. Asset checks are limited to that origin (and supported media API paths), at most twenty probes per song; external assets remain explicitly unverified/unlocked. Missing configuration, redirects, private/unavailable media, and failed probes are surfaced rather than silently certified or repaired.

Run `node scripts/halo-watchdog-contracts.mjs` for focused guard/audit contracts, or `npm run test:release-conveyor` for conveyor compatibility. Both are included in `npm test`. These checks do not prove that a production deploy, private storage, or scheduled function has run successfully.

Run `npm run -s deploy:feedback` for a focused readiness check, or `npm test` for the full contract suite (which now includes the same deploy feedback step).

Deploy feedback reports four explicit pass/fail contracts:

- migration ordering in `netlify/database/migrations`
- public root routing from `/` to `/halo.html`
- Album Concierge visibility in `halo.html` (name + `/album-concierge/` link)
- Build Your Album promotion + route health (homepage copy + `/album-concierge/` CTA + local route entrypoint)

When a contract fails, the script prints a `❌` line with the exact fix direction and exits non-zero so internal AI and maintainers can immediately treat the change as incomplete.

## Featured DJ shop: deployment verification

### Investigation evidence (2026-10-12)

- PR [#372](https://github.com/Otisigma/halo-world-global-platform/pull/372) merged at 02:54:31 UTC and adds selector/admin audio upload and free-stream publication. PR [#373](https://github.com/Otisigma/halo-world-global-platform/pull/373) merged at 03:17:51 UTC and adds the featured toggle, singleton banner slot, and public featured endpoint. The checked `main` commit is `9f0739a18856da9e25cbd7237321f300b6c06033`.
- The code path is upload chunks → atomic mix/release-plan/optional featured-slot write → `/api/dj-vault/featured-push` → banner above the crates → `/mixes/?mix=<id>#editions`. Featured retries do not reclaim a newer slot; ordinary uploads preserve it. Private mixes are excluded and public rendering uses text-safe DOM methods. Featuring does **not** enable sales, set a price, or perform audio mastering.
- `npm run test:dj-vault` passes upload validation, role/origin gates, catalog publication, featured replacement, retry/failure isolation, private filtering, and banner/pagination rendering contracts. `npm run test:database` passes the earlier migration-conflict checks. These are repository checks, not proof of live Netlify storage, migrations, or playback.
- CI [run 38199196819](https://github.com/Otisigma/halo-world-global-platform/actions/runs/38199196819) passed on the merge commit. The optional deploy [run 38199196652](https://github.com/Otisigma/halo-world-global-platform/actions/runs/38199196652/job/114648568815) explicitly logged `NETLIFY_BUILD_HOOK is not set; skipping deploy trigger.` A successful workflow therefore did **not** trigger Netlify through that hook. Netlify Git integration may deploy independently.
- Netlify checks on #372/#373 reference deploys, but do not establish which commit is currently published in production or which database branch was migrated. The documented production host, `https://halo-world-global-platform.netlify.app`, and Netlify dashboard could not resolve from the investigation environment; the browser transport was also unavailable. No live response, production commit, database state, or real audio upload was verified.
- No confirmed code defect was found that warrants changing the flow. The confirmed configuration gap is the absent optional build hook; whether this caused a stale deployment is **unverified**. A missing/failed featured migration and a runtime configuration failure remain alternatives, not established root causes. PRs #263 (literal chart routes) and #295 (retry-safe `drive_url` migration) are merged historical fixes, not evidence of a current production failure.

### Maintainer production checks

1. **Match the published deploy to Git.** In the Netlify project's production deploy view, record the published deploy ID, context, branch, commit SHA, and build/migration outcome. Compare it with `9f0739a18856da9e25cbd7237321f300b6c06033` or a later commit containing both PRs. A successful deploy preview is not a published production deploy. If production is older, inspect the failed/pending deploy logs before redeploying the approved `main` commit. Verify Git auto-publishing is enabled or configure the optional `NETLIFY_BUILD_HOOK` repository secret for the intended production branch; never put the hook URL in source or logs.
2. **Verify served assets and routes independently.** Open `/dj-vault/upload/` and confirm the “Push to DJ Shop Featured Banner” toggle and tag selector. Compare served `/dj-vault/upload-mix.js` and `/dj-vault/dj-vault.js` with the published commit (including the toggle payload and featured fetch). Bypass browser/service-worker cache during this check. Request these endpoints on the same production origin:

   ```sh
   SITE=https://halo-world-global-platform.netlify.app
   curl --silent --show-error --include "$SITE/api/dj-vault/featured-push"
   curl --silent --show-error --include "$SITE/api/dj-vault/session"
   curl --silent --show-error --include "$SITE/api/upload-mix"
   ```

   The first two should return JSON with HTTP 200; an anonymous session should not grant `canRoute`. The last is a non-mutating GET and should return HTTP 405 with JSON because uploads require POST. HTML or 404 indicates an origin/routing/deploy mismatch; compare the published function bundle as well as static assets. The workflow's `public/telemetry.json` is an ephemeral Actions artifact, not a reliable production commit marker.
3. **Check the production database, not a preview branch.** In an authorized database console for the branch used by production functions, run this read-only query:

   ```sql
   SELECT to_regclass('public.halo_mixes') AS mixes,
          to_regclass('public.halo_mix_release_plans') AS release_plans,
          to_regclass('public.halo_dj_vault_roles') AS roles,
          to_regclass('public.halo_dj_shop_featured') AS featured;
   ```

   If `featured` is null, confirm whether `20261012040000_dj_shop_featured.sql` was skipped or failed in that branch's migration logs. Apply the reviewed migration through the authorized migration process after its existing DJ Vault/mix dependencies, then verify its columns, singleton primary key/checks, and cascading mix foreign key. `CREATE TABLE IF NOT EXISTS` does not repair a malformed existing table; inspect schema drift rather than blindly replaying it. Do not reset the database or overwrite catalog rows. This migration is required before deploying #373: even an ordinary new publish references the featured table in its SQL statement.

   Once the table exists, inspect the slot without exposing storage keys or member identities:

   ```sql
   SELECT f.slot, f.mix_id, f.push_priority, m.title, m.visibility,
          m.sales_status, m.client_sale_enabled
   FROM halo_dj_shop_featured f JOIN halo_mixes m ON m.id = f.mix_id;
   ```

   HTTP 200 with `{"success":true,"edition":null}` is valid when no slot exists or the selected mix is private. A hidden banner alone is not proof of an empty slot: the UI also hides it when the featured API fails, without blocking catalog browsing.
4. **Separate runtime failures from migration failures.** For HTTP 503, inspect private function logs for the failing request: a missing relation identifies a schema/branch gap; database connection errors require checking the production Netlify Database binding; Identity failures require checking the site's Identity setup; blob errors require checking access to the existing `halo-mixes` store. Confirm the signed-in operator has `selector` or `admin` in `halo_dj_vault_roles` and `/api/dj-vault/session` reports `canRoute:true`. Upload requests must originate from the same site. Do not disable role/origin checks or share tokens to bypass a failure. A standalone static/self-hosted page or a passing `/healthz` check does not verify Netlify functions.
5. **Run an authorized end-to-end smoke test after migration/deploy verification.** Sign in as a selector/admin and upload a real, rights-attested supported audio file with the featured toggle enabled. Record the returned mix ID and require a successful publish response, the matching public featured API entry, and the banner title/tag/“Free stream” label. Follow both success links; confirm the mix is selected in the Vault and plays in `/mixes/?mix=<id>`, including seeking with a valid audio Range response. Publish a second featured mix to verify replacement without deleting the first catalog entry. Publish an ordinary mix and confirm the featured slot remains unchanged. Repository contracts cover retry safety; do not expect re-publishing the first ID to reclaim the slot. Coordinate any production test content and cleanup with the maintainer.

Close the incident only with the published SHA, successful production migration evidence, endpoint statuses, and real upload/banner/playback results. Until those are captured, report **repository flow validated; production root cause and recovery unconfirmed**, not “live site fixed.”

## Catalog / Release House rollout readiness (2026-10-28)

**Repository fixes are not a production release.** This audit did not trigger a
deploy, execute migrations, modify secrets/settings, or verify the live site.

### Verified evidence and proposed repairs

- The checked `main` head is `90850b756214762274c4759b266b53254a5cb8a9`:
  PR #466's owner-scoped distribution-link editor is merged, following #465's
  guarded public Stream / DSPs cards and #463/#464's submission/review work.
  Saving the catalog link does not publish private releases or approve submissions.
- [CI run 40623527931](https://github.com/Otisigma/halo-world-global-platform/actions/runs/40623527931)
  built Docker successfully, then timed out polling `/healthz`. Local reproduction
  showed a startup crash: `.dockerignore` omitted the imported Drive-catalog
  handlers. The repair includes only those handlers and their library dependencies,
  retains the 30-second readiness deadline and `status:ok` assertion, bounds each
  HTTP probe, detects early crashes, captures container state/logs on failure, and
  always cleans up. This tests the standalone server, not Netlify functions.
- [Optional deploy run 40623527869](https://github.com/Otisigma/halo-world-global-platform/actions/runs/40623527869)
  succeeded but explicitly logged `NETLIFY_BUILD_HOOK is not set; skipping deploy trigger.`
  The hook secret was empty/unavailable **in that run**; this does not establish
  the current settings or whether Netlify Git integration deployed independently.
- PR #466 has successful Netlify redirect/header checks referencing
  [deploy 6ae15fcb06894541dd8f894d](https://app.netlify.com/projects/halo-world-global-platform/deploys/6ae15fcb06894541dd8f894d).
  This evidences a Netlify integration on the PR, not the published production
  commit or the production branch/auto-publish settings.
- `.github/workflows/ai-autodeploy.yml` uploads ephemeral telemetry on PRs,
  pushes to `main`, and manual runs. Only a **push to `main`** with a non-empty
  repository secret can request Netlify deployment. Manual runs do not deploy.
  The proposed reporting distinguishes skipped, not requested, failed, and
  accepted requests. HTTPS-only hook calls have connection/total deadlines,
  discard response bodies, reject non-2xx responses, and do not follow redirects
  or automatically retry POSTs. Acceptance is not build/publication success.
- `netlify.toml` sets `npm run build` and publish directory `.`; the build runs
  the release guard and music-chart contracts. Neither Actions workflow runs
  migrations, uploads a site bundle, nor waits for Netlify publication. Netlify
  project identity, Git linkage, production branch, auto-publishing, database
  binding, and any project-managed migration integration cannot be confirmed
  from this configuration. `drizzle.config.ts` identifies schema/migration paths;
  it does not prove that SQL files were executed. Do not assume automatic migration
  execution merely because older feature docs describe it.

### Maintainer-only rollout gates

1. In the Netlify project serving the intended production domain (the repository
   documents `https://halo-world-global-platform.netlify.app`), verify the linked
   repository is `Otisigma/halo-world-global-platform`, production branch is `main`,
   build command is `npm run build`, and publish directory is `.`. Record the
   published production deploy ID/SHA and inspect pending/failed build logs.
   Confirm the actual custom domain/project mapping, not just a deploy preview.
2. Choose the intended deployment trigger. If Netlify Git integration is intended,
   confirm automatic builds and production publishing are enabled for `main`.
   If Actions hooks are intended, create a build hook for **that project and
   `main`** in Netlify's **Project configuration → Build & deploy → Build hooks**.
   Store its URL in GitHub **Settings → Secrets and variables → Actions →
   New repository secret**, named `NETLIFY_BUILD_HOOK`. Do not paste it into source,
   issues, logs, or PR comments; no PAT or repository write permission is needed.
   Coordinate Git auto-builds and hook usage to avoid duplicate builds. Configuration
   and any subsequent production build/publish require maintainer approval; this
   PR does neither. A timed-out POST may have been accepted: check Netlify before
   authorizing another request.
3. Before approving rollout, verify the production Netlify Database branch/binding,
   Identity configuration, migration history, and actual schema. Required existing
   relations include memberships, Release House projects, and release campaigns.
   Review missing prerequisites in timestamp order, including:
   - `20260828080000_add_music_publishing_workflow.sql` (`purchase_url`);
   - `20261028010000_release_house_submissions.sql`;
   - `20261028020000_release_house_review_notes.sql` (after submissions).
   PR #466 itself needs no new migration. These existing files are not proof of
   production schema state. The earlier publishing migration includes data
   backfills: do not blindly replay it. Have the authorized database maintainer
   review drift, backup/recovery arrangements, and approve execution through the
   project's established migration process. If no runner is configured, resolve
   that blocker explicitly; do not improvise a database reset or migration command.
4. After those approvals, the maintainer must authorize the selected Netlify path
   to build/publish the reviewed `main` commit containing these fixes. Inspect
   Netlify build/function/migration logs and confirm the **published production**
   SHA contains `90850b7…` and this repair. A green Actions run or accepted hook
   alone is insufficient; the telemetry artifact is not a live commit marker.
5. Verify the served catalog/editor assets with caches bypassed, same-origin
   `/api/release-catalog` JSON, and signed-in owner access to the release editor.
   With approved test content, verify saving a valid distribution link persists
   for that owner and only a published/public release exposes Stream / DSPs.
   Confirm draft/private links and pending submissions remain private. Verify
   Release House submission/review endpoints against the migrated schema and
   inspect private function logs for 503s; do not bypass authorization to test.
   Record deploy SHA, schema evidence, endpoint results, and the authorized
   save/card smoke test before saying the live rollout is complete.

Local checks: `npm run deploy:feedback` (includes offline hook/status contracts),
`npm run build`, `npm run diagnose`, `npm run test:database`, and `npm test`.
None of these establish a live production deployment or migrated database.

## Prebuild release guard

Netlify runs `npm run build`: npm first runs `npm run release-guard -- --allow-missing-catalog`, then the existing music chart contracts. The storefront loads its live catalog from the Netlify Database-backed `/api/release-catalog` endpoint, so the root `shared-catalog.json` is an optional static catalog, not a deployment prerequisite. The prebuild flag skips only an absent static catalog and does not create one or modify live database records. If a static catalog is supplied, it must contain an array or an object with a `songs` array; malformed or unsupported catalogs still block the build without rewriting them. Running `npm run release-guard` directly remains strict and fails if the catalog is missing. An unresolved quarantine blocks both modes even if the catalog has been removed.

Each track must have `PUBLISHED` in every supplied `releaseStatus`/`status` field, non-placeholder artwork, a positive USD price, and an HTTP(S) checkout URL. Missing prices default to `US$1.29`; missing checkout routes use the URL-encoded track id or title slug. Remote artwork must pass a bounded HEAD request to a public address; redirects fail closed (supply the final URL). Root-relative artwork must resolve to an existing file inside the catalog root. No database or live publication records are modified.

The approved catalog retains its original array/object shape, top-level metadata, and unrelated track fields. If any track is quarantined, the guard saves the exact original catalog to `.netlify/release-guard/shared-catalog.original.json` and annotated quarantined tracks plus diagnostics to `.netlify/release-guard/quarantine.json` before atomically writing only approved tracks back to `shared-catalog.json`. These recovery files are ignored build-local data, not storefront assets or tracked source. The command exits non-zero, so Netlify does not publish that build.

To recover, restore the original backup to `shared-catalog.json`, repair the reported tracks, and only then remove `.netlify/release-guard/` and rerun `npm run release-guard`. An unresolved backup blocks subsequent runs, preventing a failed audit from silently passing after unsafe tracks were removed. Preserve the backup if writing the sanitized catalog fails. Run `npm run test:release-guard` for isolated audit, networking, and CLI recovery contracts; the script also exports `ReleaseGuardAgent` as an ES module.
