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
6. **Any cross-team change:** the sending team must provide a clear contract, expected result, rollback note, and monitoring check.

## Escalation matrix

| Issue type | First owner | Escalate to | Final decision |
| --- | --- | --- | --- |
| Catalog/release visibility issue | Music Team | Site Leadership | Site Orchestrator |
| Dreamweaver experience failure | Dreamweaver Team | Bridge Team if CRN-linked | Site Leadership |
| CRN state or sync defect | CRN Team | Bridge Team if shared | Site Leadership |
| Dreamweaver/CRN contract mismatch | Bridge Team | Dreamweaver Lead + CRN Lead | Site Orchestrator |
| Payment failure or Stripe webhook issue | Payments / Stripe Team | Release Ops + Site Leadership | Site Orchestrator |
| Points/rewards logic dispute | Gamification Team | Site Leadership | Site Orchestrator |
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

## Practical scaling model

Use this operating loop:

1. Site Leadership sets weekly priorities and approves launch windows.
2. Domain teams execute inside clear boundaries.
3. Bridge teams absorb shared-contract complexity instead of pushing it to the owner.
4. QA / Release owners prevent partial work from shipping.
5. Monitoring owners watch live health and trigger fast escalation when signals drift.

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
