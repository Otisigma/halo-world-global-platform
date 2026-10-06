# HALO Site AI Operating Model

This handbook defines how HALO site teams operate so the owner can stay focused on strategy while specialist teams manage day-to-day execution. It is written as a reusable pattern that can be extended to future pages, systems, and operational domains.

## Shared operating rules

- Every team proposes, builds, verifies, releases, and monitors only within its boundary.
- Site Leadership sets priorities, approves cross-team tradeoffs, and owns the final launch decision.
- Teams may not silently change another team's data contract, UI contract, or release timing.
- Music and catalog terminology should match the live HALO model: releases, campaigns, artwork, playback, chart eligibility, fallback behavior, memberships, and creator economy flows.

## Standard team shape

Use the same role pattern for each new domain team:

- **Team Lead:** prioritization, approvals inside the team, and accountability.
- **Build / Experience Owner:** UI, workflows, and implementation details.
- **Data / Contract Owner:** schemas, integrations, business rules, and downstream safety.
- **QA / Release Owner:** tests, acceptance gates, rollout readiness, and rollback plan.
- **Monitoring / Incident Owner:** dashboards, alerts, triage, and post-incident follow-through.

Small teams can combine roles, but the responsibilities should still be covered.

## Creator studio and public Signal

- `/halo` remains the feature-directory front door. `/creator-network/` owns Creator Passes, projects, the release pipeline, and the HALO Orbits tier map. `/signal-network/#feed` is the public community surface; the existing private command center stays separate.
- DJ Halo, DJ Butterfly, and DJ Romy are curated directory seeds, not fabricated memberships. Seeds cannot receive project invitations. Member discovery remains opt-in, and matching a curated display name does not verify a member.
- Apply `20261003153000_create_studio_guardian_usage.sql` and `20261003160000_create_signal_public_feed.sql` after the existing creator and Signal migrations. Signal posts, replies, reactions, notifications, and rate limits are database-backed; notifications use polling, not push delivery.
- Public posting is deliberate. Audio attachments resolve published, public release previews, never private song versions or stem files. Optional purchase links use the release's existing artist-approved destination; the feed is not a new checkout or licensing engine.
- `/api/studio-guardian` accepts `{ action: "health" | "council", projectId }` for a project owner or accepted participant. `HaloAIService` reads stem metadata and recorded rights allocations on the server. Scores are workflow indicators, not sound-quality analysis, participant consent, legal verification, or permission to release.
- Health checks work without an AI provider. Optionally configure `GEMINI_API_KEY` in the server environment for Gemini 2.5 Flash council task prioritization. Keys never enter the browser; quota exhaustion, unavailable quota storage, or provider failure falls back to the local advisory checklist. Private titles, files, and participant names are not sent to Gemini.
- Validate this boundary with `npm run test:network`. Keep `npm run build`'s shared-catalog release guard unchanged.

## Dreamweaver Master Campaign Engine

- Apply `netlify/database/migrations/20261006170000_master_campaign_engine.sql` after the existing membership, Dreamweaver, release, Signal visibility/media, and room-pin migrations. The campaign aggregate references existing sources; it does not create another audio master or replace the published release catalog.
- Open `/halo-relations.html#masterCampaignWorkspace` with the owner account. Create a factual brief for an owned song/release, mix, listening party, or a HALO update. HALO updates need neither an artificial mix nor a YouTube link. Song Lab input requires explicit review; its creative package is advisory evidence, not verified metadata.
- Select a versioned seasonal theme and channel drafts. Save channel edits before approval. Revisions invalidate previous approvals; review each saved output and authorize public publication explicitly. Queue only the channels you intend to publish. A lobby output replaces the account's room pin only with explicit overwrite approval.
- Signal delivery reuses the feed's server-side validation and rate limits with an explicit campaign-owner identity. Native delivery and outbox completion are transactional and idempotent. Successful release reconciliation creates a deduplicated **draft**, never an automatic announcement; periodic publication repair must not republish a campaign.
- Email, press, radio, DJ, and advance-listening outputs remain approved exports for human handoff. Generating, approving, exporting, and queueing are different actions. This engine does not send subscriber email or professional outreach.
- `/api/campaign-updates` manages separate opt-in `release_notes` and `halo_updates` preferences and the in-app inbox. The widgets on Signal and Dreamweaver allow subscribers to save preferences, unsubscribe, and mark notices read. Existing Dreamweaver unlock consent is not silently converted into broader subscriptions. Inbox delivery rechecks subscriptions and blocking; it is not background Web Push.
- The scheduled `master-campaign-worker` processes the durable outbox every minute with bounded attempts, leases, backoff, and independent channel results. Cancellation withdraws pending work but cannot recall an already published Signal, room pin, inbox item, or an external request already in flight.
- External connectors are optional and disabled without server configuration. Set `HALO_CAMPAIGN_HOOK_HOSTS` to comma-separated permitted hostnames, and configure `HALO_CAMPAIGN_<CHANNEL>_HOOK` and `HALO_CAMPAIGN_<CHANNEL>_SECRET` for `TIKTOK`, `INSTAGRAM`, `YOUTUBE`, `TWITTER`, `FACEBOOK`, or `DISCORD`. Hooks must be HTTPS without credentials, query strings, custom ports, or redirects; signing secrets must have at least 32 characters. Never expose these values in browser configuration or tracked source.
- A connector receives only its approved channel output and campaign/job/version identifiers, not CRM notes, member addresses, or the private brief. Verify `X-HALO-Signature` as hex HMAC-SHA256 over `X-HALO-Timestamp + "." + raw request body`; enforce the timestamp window and deduplicate using the `Idempotency-Key` job ID. A connector must honor that same key across retries, including an ambiguous timeout.
- A connector HTTP success means **accepted**, not delivered. After actual downstream delivery, POST to `/api/campaign-delivery-receipts` with `jobId`, `channel`, `status: "delivered"`, and a unique 16–100-character alphanumeric/underscore/hyphen `nonce`. Sign the canonical JSON in that field order using the channel secret and the same timestamp/signature headers. Receipts are job/channel-scoped and replay-protected.
- Validate changes with `npm run test:master-campaigns`, `node scripts/master-campaign-ui-contracts.mjs`, existing Signal/publication contracts, `npm test`, and `npm run build`. Set `CAMPAIGN_TEST_DATABASE_URL` to an isolated PostgreSQL test database to exercise transactional migration contracts; without it the SQL tests run static checks only. The worker and APIs require the migrated Netlify database; the static Express server does not emulate those endpoints.

## Team charters

### Site Leadership

- **Mission:** Keep the whole HALO platform aligned, safe, and shippable without requiring owner involvement in every detail.
- **Recommended roles:** Site Orchestrator, QA Standards Lead, Release Ops Lead, Monitoring Lead.
- **Owns:** prioritization, roadmap sequencing, shared operating rules, cross-team approvals, release calendar, incident command.
- **Does not own:** detailed implementation inside domain teams unless an escalation is opened.

### Music Team

- **Mission:** Own the public music experience and the release/catalog presentation layer across HALO.
- **Recommended roles:** Music Lead, Catalog Owner, Playback Owner, Release Campaign Owner, QA / Release Owner, Monitoring Owner.
- **Owns:** `/music`, release visibility, catalog correctness, artwork expectations, playback readiness, campaign presentation, chart/purchase/stream metadata.
- **Boundary:** Does not own Dreamweaver cinematic logic, payments, or competition rules.

### Dreamweaver Team

- **Mission:** Build and maintain immersive, cinematic, high-visual HALO experiences around releases and story worlds.
- **Recommended roles:** Dreamweaver Lead, Experience Owner, Media Owner, Content State Owner, QA / Release Owner, Monitoring Owner.
- **Owns:** Dreamweaver pages, scene behavior, media fallbacks, visual storytelling, release-world presentation.
- **Boundary:** Does not own CRN state integrity, money movement, or core catalog authority.

### CRN Team

- **Mission:** Protect CRN workflows, state, and integration reliability across the platform.
- **Recommended roles:** CRN Lead, Workflow Owner, Data / Integration Owner, QA / Release Owner, Monitoring Owner.
- **Owns:** CRN contracts, state synchronization, identity/relationship workflow integrity, event reliability, system-to-system consistency.
- **Boundary:** Does not own Dreamweaver presentation decisions or Stripe execution.

### Dreamweaver + CRN Bridge Team

- **Mission:** Keep Dreamweaver and CRN aligned when experience logic depends on CRN events, identity, or shared state.
- **Recommended roles:** Bridge Lead, Contract Owner, Sync Owner, QA Owner, Incident Owner.
- **Owns:** shared contracts, field/event mappings, version compatibility, integration acceptance tests, cross-system triage.
- **Boundary:** Does not replace either team’s internal ownership; it only owns the handshake between them.

### Payments / Stripe Team

- **Mission:** Own secure money movement and billing reliability across HALO.
- **Recommended roles:** Payments Lead, Stripe Integration Owner, Billing State Owner, Fraud / Risk Owner, QA / Release Owner, Monitoring Owner.
- **Owns:** checkout, subscriptions, billing state, receipts, retries, refunds, payment webhooks, payment-failure recovery.
- **Boundary:** Does not own catalog presentation or competition policy except where payment status gates access.

### Gamification Team

- **Mission:** Design and operate points, badges, progression, and reward mechanics that reinforce healthy platform behavior.
- **Recommended roles:** Gamification Lead, Rules Owner, Rewards Owner, Economy Owner, QA / Release Owner, Monitoring Owner.
- **Owns:** point logic, badge criteria, progression rules, reward issuance, anti-abuse guardrails for game mechanics.
- **Boundary:** Does not own prize eligibility rules for formal competitions.

### Halo Party Team

- **Mission:** Run `/live-party/` as HALO's internal-first music venue with clear free access, healthy loyalty progression, and safe event operations.
- **Recommended roles:** Party Lead, Experience Owner, Loyalty & Perks Owner, Access Standards Owner, Moderation Liaison, Seasonal Programming Owner, QA / Analytics Owner.
- **Owns:** room atmosphere standards, event run-of-show, loyalty/perk policy for party experiences, gift/unlock guardrails, free/supporter/vip access standards, launch checklists, party analytics and quality reviews.
- **Boundary:** Does not replace Community moderation policy, payment-state authority, or canonical gamification and competition rule ownership.
- **Operating standard:** `HALO_PARTY_TEAM_CHARTER.md`

### Competition Team

- **Mission:** Run contests, challenges, rankings, and prize flows with clear fairness and auditability.
- **Recommended roles:** Competition Lead, Eligibility Owner, Scoring Owner, Anti-Abuse Owner, QA / Release Owner, Monitoring Owner.
- **Owns:** competition rules, entry validation, leaderboard integrity, prize eligibility, challenge windows, dispute handling.
- **Boundary:** Does not own general gamification economy rules unless explicitly delegated.

## Handoff rules

1. **Site Leadership → Domain team:** every request includes objective, priority, deadline, dependencies, and approval level.
2. **Music ↔ Dreamweaver:** Music owns release truth and catalog metadata; Dreamweaver consumes approved release/story inputs and may not redefine canonical catalog data.
3. **Dreamweaver ↔ CRN:** any shared event, identity, or state dependency must go through a versioned contract owned by the Bridge Team.
4. **Payments ↔ other teams:** access rules based on paid status must rely on Stripe-owned payment state, never copied logic.
5. **Gamification ↔ Competition:** reusable points/progression stay with Gamification; event-specific scoring and prizes stay with Competition.
6. **Halo Party ↔ Community/Gamification/Payments:** party operations may use room actions, progression, and tier hooks, but must inherit moderation boundaries, avoid shadow payment logic, and keep free-core access explicit.
7. **Any cross-team change:** the sending team must provide a clear contract, expected result, rollback note, and monitoring check.

## Escalation matrix

| Issue type | First owner | Escalate to | Final decision |
| --- | --- | --- | --- |
| Catalog/release visibility issue | Music Team | Site Leadership | Site Orchestrator |
| Dreamweaver experience failure | Dreamweaver Team | Bridge Team if CRN-linked | Site Leadership |
| CRN state or sync defect | CRN Team | Bridge Team if shared | Site Leadership |
| Dreamweaver/CRN contract mismatch | Bridge Team | Dreamweaver Lead + CRN Lead | Site Orchestrator |
| Payment failure or Stripe webhook issue | Payments / Stripe Team | Release Ops + Site Leadership | Site Orchestrator |
| Points/rewards logic dispute | Gamification Team | Site Leadership | Site Orchestrator |
| Live-party free-vs-premium, perk fairness, or launch-readiness dispute | Halo Party Team | Site Leadership + Gamification Lead | Site Orchestrator |
| Competition eligibility/scoring dispute | Competition Team | Site Leadership | Site Orchestrator |
| Cross-team release blocker | Release Ops Lead | Relevant team leads | Site Leadership |
| Production incident affecting multiple domains | Monitoring Lead | Incident command with all leads | Site Orchestrator |

## QA and release gates

No team ships changes until these gates are green for its scope:

1. Team-level acceptance criteria are written down.
2. Relevant repository contracts/tests pass.
3. Upstream and downstream handoff contracts are verified.
4. Rollback path is known for risky changes.
5. Monitoring checks are ready before release.
6. Site Leadership approves any cross-team or high-risk launch.

For documentation-only changes, use the normal repository validation path and confirm no product behavior changed.

## Monitoring and incident response

- Each team owns its own success metrics, alerts, and first-response triage.
- Monitoring must cover both user-visible failures and silent data/contract drift.
- Sev-1 or multi-team incidents move immediately to Site Leadership-led incident command.
- The team closest to the failing boundary opens the incident; the Bridge Team joins if the issue crosses contracts.
- Every incident ends with: root cause, owner, fix, verification, and whether handbook rules need updating.
- Teams should keep `HALO_AGENT_STATUS_BOARD.md` current so owners can see Focus, Done, Watching, Impact, Next, and dated changes across domains.
- Teams should also keep the status board's recent outcomes loop current so the latest operational change, evidence, learning, open risk, next check, and check-by date stay visible in one owner-readable place.

## Practical scaling model

Use this operating loop:

1. Site Leadership sets weekly priorities and approves launch windows.
2. Domain teams execute inside clear boundaries.
3. Bridge teams absorb shared-contract complexity instead of pushing it to the owner.
4. QA / Release owners prevent partial work from shipping.
5. Monitoring owners watch live health and trigger fast escalation when signals drift.
6. Recent outcomes are reviewed against Halo Ledger, deploy-health checks, and Builder/Verifier/Committee evidence so the next improvement question stays explicit.

For AI-delivered work verification, follow `HALO_AI_COMMITTEE_WORKFLOW.md` so implementation, challenge testing, and acceptance are separated across Builder, Verifier, and Committee roles, and complete `.github/pull_request_template.md` to capture Builder evidence, Verifier findings, and Committee decision in the PR record.

This keeps decision rights close to the work, while preserving one clear escalation and approval path for the whole site.

## Reusable template for future teams

When adding a new HALO page or system team, document:

1. Mission
2. Recommended roles
3. Ownership boundary
4. Required handoffs
5. Escalation path
6. QA / release gates
7. Monitoring expectations

New teams should follow this handbook unless Site Leadership approves an explicit exception.
