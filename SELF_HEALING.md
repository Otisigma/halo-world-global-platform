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
