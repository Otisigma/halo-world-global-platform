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

Every deployed sweep stores its coverage and individual results in Netlify Database. Failed checks enter the existing AI-assisted maintenance triage flow, while recovered checks automatically heal their matching issue. Owners can inspect the latest evidence or request the rate-limited one-command `halo-signal-check` sweep from `/halo-command.html` to verify built, live, connected, and verified states while writing the command outcome into Halo Ledger.

## halo-signal-check

`halo-signal-check` is HALO's canonical one-command verification workflow for Dreamweaver pages and the other major menu-linked satellites.

### Purpose

- confirm the page or system is built
- confirm the main HALO menu links to it
- confirm the deployed route is live and reachable
- confirm the deployed route passes the live smoke check, while repository contracts guard menu links and route coverage

### Visible states

- Every main HALO menu button/tile renders a live **red/yellow/green status badge** beside the title as the primary operator signal, while the dashboard keeps the operator/admin reference light and full summary cards.
- When the menu is available on the page being viewed, that route is marked **CURRENT** so the active location is unambiguous.
- **Red** — a required build, route, menu link, or verification requirement is missing
- **Yellow** — the page is built and live, but a required menu connection or deployed smoke verification is still incomplete
- **Green** — the page is built, menu-connected, live, and verified by the deployed smoke check
- Red and yellow routes display **AI ALERTED** after the maintenance sweep queues the failure for AI-assisted triage and repair dispatch. The issue remains reviewable in the maintenance system and Halo Ledger until the route recovers.

### Ledger fields

Each `halo-signal-check` run writes a Halo Ledger system event with these reviewable fields:

- `commandName`
- `startedAt`
- `finishedAt`
- `status`
- `pagesChecked`
- `linksChecked`
- `routesChecked`
- `outputsChecked`
- `builtCount`
- `liveCount`
- `connectedCount`
- `verifiedCount`
- `passedChecks`
- `failedChecks`
- `failures`
- `notes`
- `satelliteStatuses`

## Daily operation

`halo-agent-daily.mjs` runs every published-deploy day at 07:30 UTC. Five specialist calls run in parallel with strict timeouts. Mirror then produces the combined report. If AI inference is unavailable or exceeds its time limit, deterministic fallbacks still produce a conservative report and mark the run as partial.

The latest report appears at `/halo-command.html`. Owners can also trigger up to two manual runs per hour from the dashboard.

For lightweight human updates across specialist teams, use `HALO_AGENT_STATUS_BOARD.md` as the shared Focus / Done / Watching / Impact / Next board plus dated change-log entries.

Use the same file's recent outcomes loop to summarize the latest operational change, the supporting evidence, what HALO learned, the open risk, and the next check to run. Prefer evidence from Halo Ledger, deploy-health feedback, status-board updates, and Builder/Verifier/Committee PR records so the learning loop stays reviewable. Include each outcome's check-by date so follow-up ownership stays explicit.

For multi-role verification governance, use `HALO_AI_COMMITTEE_WORKFLOW.md` to run the Builder → Verifier → Committee operating loop with evidence-first acceptance rules, and complete `.github/pull_request_template.md` for AI-delivered work so Builder evidence, Verifier findings, and Committee decision are recorded in every PR.

To deliver a privacy-safe summary to an external notification workflow, configure `HALO_AGENT_REPORT_WEBHOOK_URL` with a secure HTTPS webhook. The webhook receives aggregate health, findings, reflection, and proposed priorities. It does not receive private member messages, passwords, payment information, owner notes, or raw personal records.

The system cannot initiate a new ChatGPT conversation or proactively message the project owner inside this development session. Daily updates are delivered through the private dashboard and the optional webhook.

## Private control center

The owner observatory at `/control-center` now includes a persistent command channel for the full council or any individual specialist. Each instruction is stored in Netlify Database and shown in the private thread with a timestamp and accountable specialist. HALO Guard runs deterministic request preflight first, preserving the original request and requested approach and surfacing missing acceptance fields. Direct-command paid synthesis is off by default; an explicit authenticated-owner `approvePaidCalls: true` on a complete structured request opts into advisory synthesis using the latest council report, unresolved issues, action state, and team memory. It grants no implementation/deployment authority. See `HALO_AI_COMMITTEE_WORKFLOW.md` for the pre-Builder gate and `/halo-shield/preflight.html` for the isolated owner request/Drive comparison.

When a response identifies useful work, the system can create a linked proposal in the existing human decision queue. The proposal remains blocked behind owner approval and records its status back into the command thread. The same screen combines council runs, maintenance sweeps, unresolved issues, and action changes into a live operations feed that refreshes every 45 seconds while the page is visible.

The command channel does not grant autonomous authority. It can run the existing council and maintenance monitoring tools, organize evidence, and propose measurable work. External communications, production changes, publishing, spending, contracts, account changes, and people decisions still require explicit human execution and review.

### Private signup review

The **Signups & email preferences** panel at `/control-center` reads a separate GET `/api/halo-control-center?view=signups` snapshot after owner verification. It requires the existing Netlify Identity session and `isOwner(user)` and returns `Cache-Control: private, no-store`. HEAD remains an authorization-only check, and POST to this signup view is rejected. Signup records never enter the operations feed, council/model context, or public telemetry.

Each source is independently bounded to **30 rows**, not a total subscriber count. Dreamweaver uses the same recent CRM query as Relations (`last_signup_at DESC, email ASC`); Track Drops uses `email_consent_at DESC, member_id ASC`; Artist Pro uses `updated_at DESC, id ASC`. Failed or missing sources are **unavailable**, not zero. The panel is a manually refreshed snapshot; sign-out/identity changes clear its rows and cancel pending reads.

- **Dreamweaver**: CRM capture of release-unlock/contact consent, not general newsletter permission. Shows source, CRM state, earliest captured consent, and first/latest signup times. It does not infer a subscription or present a withdrawal history that this table does not store.
- **Track Drops**: current email preferences joined to memberships, requiring both `track_drops_email = TRUE` and `email_consent_at IS NOT NULL`. Revoked/missing consent is excluded. No withdrawal-history count is inferred from current disabled preferences.
- **Artist Pro**: application source, status, contact-consent capture, creation and update times. Application contact permission is not newsletter consent; review status is not a subscription state.

Only email, source/state and relevant timestamps are displayed. There are no sending, export, clipboard, deletion, or preference-edit controls in this panel. Existing Relations workflows remain separate and unchanged. Validate with `node scripts/owner-signups-contracts.mjs`, `npm run contracts:ai-maintenance`, `node scripts/dreamweaver-fan-signup-api-contracts.mjs`, and `node scripts/dreamweaver-show-contracts.mjs`. Live Identity/database integration requires an authenticated Netlify environment.

## Dreamweaver AI operations oracle

The owner-only `/control-center` includes a separate read-only Dreamweaver AI panel. It uses the existing Netlify Identity session and server-side `isOwner(user)` authorization; no individual email is hardcoded. GET `/api/dreamweaver/oracle` reads telemetry, HEAD checks access, and POST accepts JSON `{ "mode": "chat", "message": "...", "history": [], "useAI": false }`. POST requires a same-origin Origin header and Identity origin verification. Responses are never cached.

Requests are capped at 12,000 streamed bytes, questions at 2,000 characters, and history at six 1,000-character user/assistant entries. The panel refreshes every 45 seconds while visible, keeps up to 20 displayed messages in tab memory, and clears its state on sign-out. Do not paste credentials, private member data, or sensitive logs into questions. No conversations are persisted by this feature.

Telemetry sources fail independently and are labelled unavailable rather than zero:

- All active published `halo_song_catalog` records and `halo_song_publication_sync`, with active version readiness facts evaluated through the existing publication-health helper. Counts include missing sync rows and checks older than 30 minutes. This is recorded readiness, not live public-page verification.
- `halo_radio_tracks` room/status aggregates, including rooms without rotation tracks. No stream URLs are fetched; playback availability remains unverified.
- `halo_dreamweaver_campaign_events` copy/download/publish-ready counts over 30 days. These measure share preparation, not external delivery. Publication telemetry separately reports canonical Dreamweaver share readiness.
- `halo_social_snippet_feedback` signal counts and `halo_chart_votes` vote counts over 30 days. These are community signals, **not verified subscriber-only sentiment or unique-person counts**. Raw feedback, voter keys, member identifiers, URLs, and error text are not returned or sent as model context.

Deterministic evidence summaries and read-only diagnostic SQL remain available without AI configuration. Checking the paid-AI option explicitly opts into one server-only OpenAI call using the existing `OPENAI_API_KEY`/gateway configuration and `AI_MODELS.council`. No new keys, database migrations, or dependencies are required. The call has no automatic retries, a 12-second timeout, bounded context/output, and no tools or arbitrary URL fetching. Provider failures or malformed responses fall back safely.

Suggestions are **unverified proposals**, with evidence keys, rationale, verification steps and copyable JavaScript/SQL/HTML text. Aggregates cannot diagnose a particular track or prove a missing sync loop; inspect Song Catalog publication health and review the scheduled reconciler before proposing a repair. Nothing is executed, queued for execution, or deployed. Validate this feature with `npm run test:dreamweaver-oracle`; live Identity/database/provider behavior still requires an authenticated Netlify deployment.

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
