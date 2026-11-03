# Fan curation and digital rewards

The first fan loop is available at `/album-concierge/#fan-curations`, linked from Music
and Signal Network. It is separate from AI-generated Album Concierge concepts.

Signed-in members can save private, immutable lists of 3-12 different published,
public HALO releases. Artist credits and listening destinations come from the
catalog, not client URLs. Collections do not copy audio or grant licenses,
distribution rights, cross-promotion consent, or recording ownership.

## Points and limits

- Existing member reward consent in Track Drops controls new grants and claims;
  it is not automatically enabled and does not require listening analytics.
- A new track set earns 25 points once per UTC day. The same set in another order
  or under another title is a duplicate, not another collection or reward.
- Members can save 10 new collections per UTC day, 50 in total.
- A listening card costs 25 points per collection, once. It is a downloadable,
  printable HTML tracklist with public listening links, not paid audio or merchandise.
- Existing earned-point totals, reward tiers, affiliate eligibility and poll
  eligibility remain unchanged. Available points equal lifetime earned minus
  committed card redemptions. Browser-local HP never enters these calculations.
- Disabling rewards stops new grants and claims, not downloads of previously
  claimed cards. Cards cannot be downloaded while any included release is hidden,
  unpublished or removed; existing spending is retained, with no automatic refund.

## Persistence and deployment

Apply `netlify/database/migrations/20261103110000_fan_curation_rewards.sql` after the
existing memberships, release campaigns and track-drop migrations, using the
repository's Netlify database migration pipeline. Deploy the function and static
assets together. No new provider credentials or AI keys are required.

`/api/fan-curations` supports authenticated GET and same-origin JSON POST:

```json
{"action":"save","title":"Night Drive","releaseIds":["release-one","release-two","release-three"]}
```

```json
{"action":"redeem","curationId":"server-issued-uuid","rewardId":"listening-card"}
```

The member identity, rewards, limits and costs are server-derived. SQL functions
lock the existing member preference row to serialize concurrent saves, consent
changes and debits. Release locks prevent visibility changes during mutations.
Unique keys prevent repeated grants and charges. No client-supplied balance,
membership tier, price, reward amount or asset URL is accepted.

GET `/api/fan-curations/card?curationId=server-issued-uuid` checks the authenticated
member's persisted redemption and current public release availability before
returning an escaped HTML attachment. No member contact data is included.

Mutation responses report committed outcomes separately from refreshed state.
If a response is interrupted, refresh before retrying. Retrying the same save or
claim is duplicate-safe. No bulk deletion, transfer, refund or physical
fulfillment endpoint is provided in this milestone.

## Verification

Run `npm run test:fan-curations` for API and client contracts. Run
`npm run test:fan-curations:db` with local PostgreSQL tools installed for disposable
database tests, including concurrent claims and real handler-to-database flows.
The database runner creates and removes only its own temporary cluster. CI runs
both contract suites on pull requests and main pushes; no production database or
credentials are used.

After deployment, use a signed-in test account with member rewards enabled:
save three public tracks, confirm +25 points, claim its card, confirm a 25-point
debit, download it, then retry the claim and verify no second debit. Verify that
another account cannot access the collection or card.
