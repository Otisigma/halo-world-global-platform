# HALO Agent Council

The HALO Agent Council is an owner-only daily operating system. It reads aggregate product signals, creates specialist findings, challenges those findings through a reflection agent, stores proposed actions, and learns from outcomes recorded by the owner.

It does not autonomously send messages, spend money, publish content, modify accounts, make payments, enter contracts, approve legal decisions, or manage people. Every external action remains a proposal until a human owner approves it.

## Council roles

- **Atlas** protects strategy, product focus, and the 90-day commercial sequence.
- **Pulse** reviews acquisition, conversion, recurring revenue, and retention.
- **Bridge** reviews creator onboarding, offers, partnerships, rights readiness, and creator economics.
- **Hearth** reviews community participation, healthy return behavior, care, consent, and trust.
- **Sentinel** reviews reliability, privacy, security, fulfillment, rights, and operational risk.
- **Mirror** compares all findings with the evidence and prior outcomes, removes weak recommendations, records corrections, and prepares the daily owner briefing.

## Maintenance team

Sentinel now receives evidence from a dedicated maintenance team with two complementary layers. The source-line audit inspects every first-party project text line during validation, checks JavaScript syntax and JSON structure, and verifies local page and asset connections. The deployed-site sweep runs every 15 minutes, loads every core page, discovers and verifies same-origin links, scripts, styles, images, and form actions, then verifies every declared API route plus important API and browser output contracts.

Every deployed sweep stores its coverage and individual results in Netlify Database. Failed checks enter the existing AI-assisted maintenance triage flow, while recovered checks automatically heal their matching issue. Owners can inspect the latest evidence or request a rate-limited full sweep from `/halo-command.html`.

## Daily operation

`halo-agent-daily.mjs` runs every published-deploy day at 07:30 UTC. Five specialist calls run in parallel with strict timeouts. Mirror then produces the combined report. If AI inference is unavailable or exceeds its time limit, deterministic fallbacks still produce a conservative report and mark the run as partial.

The latest report appears at `/halo-command.html`. Owners can also trigger up to two manual runs per hour from the dashboard.

For lightweight human updates across specialist teams, use `HALO_AGENT_STATUS_BOARD.md` as the shared Focus / Done / Watching / Impact / Next board plus dated change-log entries.

To deliver a privacy-safe summary to an external notification workflow, configure `HALO_AGENT_REPORT_WEBHOOK_URL` with a secure HTTPS webhook. The webhook receives aggregate health, findings, reflection, and proposed priorities. It does not receive private member messages, passwords, payment information, owner notes, or raw personal records.

The system cannot initiate a new ChatGPT conversation or proactively message the project owner inside this development session. Daily updates are delivered through the private dashboard and the optional webhook.

## Private control center

The owner observatory at `/control-center` now includes a persistent command channel for the full council or any individual specialist. Each instruction is stored in Netlify Database, answered using the latest council report, unresolved issue signals, action state, and team memory, and shown in the private thread with a timestamp and accountable specialist.

When a response identifies useful work, the system can create a linked proposal in the existing human decision queue. The proposal remains blocked behind owner approval and records its status back into the command thread. The same screen combines council runs, maintenance sweeps, unresolved issues, and action changes into a live operations feed that refreshes every 45 seconds while the page is visible.

The command channel does not grant autonomous authority. It can run the existing council and maintenance monitoring tools, organize evidence, and propose measurable work. External communications, production changes, publishing, spending, contracts, account changes, and people decisions still require explicit human execution and review.

## Living memory

The council's “learning” is explicit and reviewable rather than hidden model retraining:

1. Each run stores the aggregate evidence used by the council.
2. Each specialist stores its confidence, evidence, risks, and proposed actions.
3. The owner approves, dismisses, starts, or completes an action.
4. The owner records notes and the measurable actual outcome.
5. The next run compares those outcomes with earlier expectations and updates working memory.
6. Mirror identifies what changed, what was wrong, what should be learned, and the question the next report must answer.

This creates a self-reflective operating loop while keeping the evidence, corrections, and authority visible to a human.

The council also has durable operational runbooks in `halo_agent_knowledge`. These records preserve known symptoms, diagnosis steps, resolutions, verification checks, and related project paths independently of the shorter per-agent working memory. Every specialist and Mirror receives the active runbooks during a council review. Recent unresolved maintenance issues are included as bounded technical evidence, allowing Sentinel and the other specialists to match a live failure to a known recovery path. The first stored runbook covers the August 11, 2026 Halo Radio audio and visible-video recovery documented in `HALO_RADIO_VIDEO_PLAYBACK_RUNBOOK.md`.

## Privacy and safety

The council uses aggregate counts from analytics, membership, community, marketplace, release, relationship, care, DJ-intelligence, and mix systems. It also receives a bounded set of unresolved maintenance titles and technical details so specialists can match live failures to operational runbooks. It does not send member emails, private notes, conversation bodies, uploaded audio, passwords, payment details, IP addresses, or raw identity records to the model.

The API requires a signed-in Netlify Identity user with an `admin`, `owner`, `halo-admin`, or `halo-owner` role, or an account included in the existing `HALO_OWNER_EMAILS` configuration. Mutations verify request origin. Proposed actions default to requiring approval.

## Main files

- `halo-command.html`, `halo-command.css`, and `halo-command.js` provide the private owner observatory.
- `netlify/functions/halo-agent-team.mjs` provides the protected report and action API.
- `netlify/functions/halo-control-center.mjs` provides the protected owner command and live operations API.
- `netlify/functions/halo-agent-daily.mjs` generates the scheduled daily report.
- `netlify/lib/agent-team.mjs` contains metrics, specialist roles, reflection, persistence, fallbacks, and webhook delivery.
- `netlify/lib/control-center.mjs` grounds direct team responses in current operating evidence and routes proposed work into the approval queue.
- `netlify/lib/maintenance-sweep.mjs` crawls deployed pages, checks internal connections and outputs, and reconciles maintenance issues.
- `netlify/database/migrations/20260808160000_create-halo-agent-team.sql` creates runs, findings, actions, and memory.
- `netlify/database/migrations/20260811170000_create-agent-incident-knowledge.sql` creates searchable operational runbooks and records the radio/video recovery.
- `netlify/database/migrations/20260813160000_create-halo-control-center.sql` stores owner commands and links them to proposed actions.
- `netlify/database/migrations/20260809150000_create-maintenance-sweeps.sql` stores sweep coverage and check evidence.
- `scripts/maintenance-source-audit.mjs` inspects first-party source lines, syntax, and local references.
- `scripts/agent-team-contracts.mjs` verifies the governance and integration contract.

Run `npm test` to execute the repository contracts. Netlify applies the new database migration automatically during deployment.
