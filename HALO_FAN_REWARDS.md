# Fan curation and digital rewards

The experimental satellite lives at `/satellites/constellation-lab/`. There are no
links or embedded scripts on the stable Music, Album Concierge or Signal Network
pages. Those pages remain unchanged. This branch must not be merged or deployed
to production as part of preview testing.

## Local Constellation demo

The satellite draws an original visual journey from six fictional track concepts.
Visitors select stars, reorder the journey, choose a palette, name it, and export
an escaped SVG keepsake. Positions are deterministic artwork, not audio analysis,
music similarity, AI inference or a claim of world-first technology.

The demo is in-memory only: no account, storage, analytics, server calls, audio,
real points, or record ownership. Reloading clears it. Export is a local browser
download; no data is uploaded. No external scripts or fonts load on page open.
Only clicking "Check invited preview access" starts a live API request. Identity
is imported only after the API confirms the pilot is enabled.

## Default-off invited preview

All live API actions, reads and downloads fail closed before authentication or
database access unless `HALO_CONSTELLATION_ENABLED=true` and Netlify `CONTEXT` is
`dev`, `deploy-preview`, or `branch-deploy`. Production and missing/unknown contexts
are always blocked, even if the enable flag is set.

Only exact Identity member IDs listed in the server-side, comma-separated
`HALO_CONSTELLATION_PILOT_MEMBERS` can access the database. An empty list denies
everyone. The list is never returned to the browser. No query parameter or
client-side flag can enable the feature or confer an invitation.

Set `HALO_CONSTELLATION_DATABASE_URL` to a dedicated preview database. The satellite
explicitly passes this connection to `getDatabase`; it never falls back to HALO's
default connection. Missing/invalid URLs and URLs matching the host, port and
database of either `NETLIFY_DB_URL` or `DATABASE_URL` are rejected before database
access (changing passwords, query options, URL encoding or protocol does not bypass
that comparison).

An administrator must still verify that the dedicated endpoint is actually
non-production: a URL cannot prove the ownership/purpose of an unrelated database
or recognize every alias of a server. Do not copy production credentials, member
contacts or private catalogs into the preview.

The pilot uses existing HALO Identity (no duplicate accounts, new signup tracking
or billing). Sign in through an existing account screen, then explicitly connect
the satellite. The demo stays separate and is never submitted to the live API.
Disconnecting clears the displayed pilot state without deleting persisted records.
Turning `HALO_CONSTELLATION_ENABLED` off is the preview kill switch for all endpoints.

Invited signed-in members can save private, immutable lists of 3-12 different published,
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

Apply `netlify/database/migrations/20261103110000_fan_curation_rewards.sql` only to
the isolated preview database, after memberships, release campaigns and track-drop
migrations. This is additive schema, not permission to migrate production.
Deploy the function and satellite assets to the preview together. No new provider
credentials or AI keys are required.

`/api/fan-curations` supports authenticated GET and same-origin JSON POST:

```json
{"action":"save","title":"Night Drive","releaseIds":["release-one","release-two","release-three"]}
```

```json
{"action":"redeem","curationId":"server-issued-uuid","rewardId":"listening-card"}
```

The enable flag and invite list are server-derived, as are identity, rewards,
limits and costs. SQL functions
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

For browser verification run `node scripts/fan-curation-db-contracts.mjs --serve-demo`
to keep the pilot disabled, or `--serve` for the invited fixture. The localhost
server uses a disposable real database and a clearly test-only Identity module,
never production credentials. Stop it with SIGTERM to remove its cluster.

After preview deployment, use an invited test account with member rewards enabled:
save three public tracks, confirm +25 points, claim its card, confirm a 25-point
debit, download it, then retry the claim and verify no second debit. Verify that
another account cannot access the collection or card.

Before any later main-platform rollout, obtain a separate deployment decision,
verify production-safe migration/rollback steps, and revisit the production gate.
Do not remove that gate or add public navigation as part of this experimental PR.
