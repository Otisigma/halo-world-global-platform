# HALO Artist Agent Teams

The HALO Agent Council works for the platform owner. Artist Agent Teams apply the same architecture to a single artist. Each team is scoped to one artist room, reads only that room's recorded signals, and returns a short briefing, a queue of proposals, and drafted words the artist can use.

The artist room is the team's operating base. It acts as a private backstage desk for each client: the public page remains the artist's outward-facing home, while the attached team dashboard holds the evidence, recommendations, drafts, approvals, and recorded outcomes for that room alone.

A team does not publish, post, send, spend, sign, contract, or contact anyone. Every recommendation and every draft stays a proposal until the room's owner approves it, and approval records which member approved it.

## The four seats, plus a critic

- **Scout** works the A and R angle: which material is actually connecting, what is worth finishing next, and which track deserves the push.
- **Steer** works management: sequencing, release timing, what to say yes to, and what the artist should stop spending time on.
- **Echo** works content and social: what to make this week, in this artist's voice, for the rooms they already have.
- **Circle** works fan growth: turning listeners into followers and followers into people who return.
- **Compass** reads all four, removes anything the evidence does not support, and writes the one briefing the artist actually reads.

A plan decides which seats an artist has. `PLAN_TIER_DEFAULTS` sets the starter tier to Scout and Circle only; solo, pro, and label tiers open all four and buy strictly more monthly runs.

## Grounding is the product

The failure mode for an AI team is confident, generic advice. Two artists in different genres at different career stages get the same five bullet points, and both cancel.

So every run builds a signal index from that artist's own recorded numbers — follower counts and recent follows, radio plays over 7 and 30 days, the top track by play count, published activity and days since the last post, release recency, show subscribers, and room views and visitors. Roughly two dozen keys, each tied to a real query.

Every agent must cite the signal keys behind each recommendation. `groundRecommendation` then checks those keys against the index in code, not in a prompt. A recommendation citing nothing, or citing a signal this artist does not have, is dropped before it is ever stored. The briefing tells the artist how many recommendations were kept and how many were dropped, so the filter is visible rather than implied.

The momentum score works the same way. It is computed deterministically from the signals in `momentumScore`, never asked of the model, so the same numbers always produce the same score and the artist can be told exactly what moved it.

## Publishing boundary

Drafts are the only content output. They are written for named surfaces — the artist room, a radio note, a fan update, a press note, or an external social post — and they carry a disclosure sentence by default.

Three things enforce the boundary:

1. `external_publishing_enabled` defaults to `FALSE` on every plan.
2. A database check constraint refuses to store a draft as approved or published without an `approved_by_member_id`.
3. Anything aimed at an outside platform is labelled for the artist to copy and post themselves. HALO holds no social credentials on their behalf.

## Cost and plans

An agent team has a real per-run inference cost, so a plan cannot be priced against a number nobody records. Each run stores `input_tokens`, `output_tokens`, `inference_calls`, and `fallback_calls`, and the artist's plan panel shows what the last run cost to produce.

Every published artist room receives the free `starter` plan automatically. Starter enables Scout and Circle with four runs each month, creating a useful entry point without requiring payment details. Existing plans are never overwritten by the activation path, and the self-service migration backfills Starter only for published rooms that do not already have a plan.

`reserveArtistRun` reserves capacity in a single SQL statement before any inference is spent. The same statement handles month rollover, so a plan resets on the first run of a new month rather than needing a separate job. Both the manual and scheduled paths reserve before running. A room without a plan gets `402`; a room that has spent its allowance gets `429` with a `Retry-After` header.

## Operation

`artist-agent-weekly.mjs` runs Mondays at 08:15 UTC across up to twelve active plans, reserving quota per artist and logging why any artist was skipped. Artists can also run their team by hand from the dashboard, against the same allowance.

Specialist calls run in parallel with strict timeouts. If inference fails or times out, deterministic fallbacks still produce a conservative, grounded briefing and the run is marked partial rather than failed.

## Access

The dashboard lives at `/artist-team.html`. The API returns `401` without a signed-in identity, `404` when the room does not exist, and `403` when the signed-in member does not own that room. Artists activate Starter by publishing their own room; later plan changes remain platform-owner only because they grant additional spend. Artists can create and edit only release campaigns owned by their membership, while the platform owner retains oversight across all campaigns. The link into the dashboard appears on an artist room only for the member who owns it, never for fans.

## Main files

- `artist-team.html`, `artist-team.css`, and `artist-team.js` provide the artist's private workspace.
- `netlify/lib/artist-agents.mjs` contains the signal collection, momentum score, grounding gate, agent roles, persistence, quota reservation, and fallbacks.
- `netlify/functions/artist-agents.mjs` provides the ownership-scoped dashboard, run, approval, and plan API.
- `netlify/functions/artist-agent-weekly.mjs` runs active plans on the weekly schedule.
- `netlify/database/migrations/20260812160000_create-artist-agent-teams.sql` creates plans, runs, findings, actions, drafts, and per-agent memory.
- `netlify/database/migrations/20260812180000_enable-self-service-starter-promotion.sql` backfills free Starter access for published rooms without changing existing plans.
- `scripts/artist-agent-contracts.mjs` verifies the grounding, authority, tenancy, and metering contracts.

Run `npm test` to execute the repository contracts. Netlify applies the new database migration automatically during deployment.
