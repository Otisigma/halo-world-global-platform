# HALO Artist Economy

HALO Artist Economy is the private operating system that connects an artist's rights, income, campaign spending, licensing pipeline, live work, and long-term livelihood plan. It is available at `/artist-economy/` and is scoped to the signed-in owner of a HALO artist room. HALO platform owners can open the same workspace for oversight and can access the conscience review desk.

## What the workspace records

- The artist's working currency, career stage, monthly net-income target, and configurable allocation plan
- Recordings and compositions, rights readiness, master ownership, composition ownership, publishing/admin status, identifiers, restrictions, and participants
- Territory-specific PRO, CMO, neighbouring-rights, mechanical, and publishing-admin memberships for each collaborator
- Expected, received, overdue, disputed, and reconciled income with fees, tax reserve, and contractual obligations separated from gross
- Campaign budgets, spend, stop-loss, meaningful actions, decisions, and lessons
- Licensing opportunities from brief through rights review, artist approval, pitch, negotiation, delivery, and payment, with explicit approval status recorded before anything moves externally
- AI-assisted rights guidance that flags missing data, ownership conflicts, split problems, registration gaps, and draft-only next-step checklists
- Shows, performance fees, ticket and merchandise income, real costs, fan capture, settlements, and set-list reporting
- Owner-only reviews of products, fees, algorithms, partnerships, campaigns, licensing, and policy against HALO's artist-livelihood covenant

## Authority boundaries

The system records and prepares decisions. It does not move money, connect a payment account, submit a pitch, grant a licence, register a work, accept a contract, purchase advertising, report a set list, or contact a buyer automatically. Those actions remain with the artist or an authorised human operator.

The Rights Passport is UK-first rather than BMI-first. It supports societies such as PRS for Music and PPL out of the box through territory-specific membership records, while staying generic enough for BMI, ASCAP, SESAC, SOCAN, SACEM, and other PRO/CMO paths.

`payment_model` and `payment_status` are readiness records rather than a simulated payment integration. A direct-to-fan checkout should be added only after HALO has selected the correct seller and tax model and connected an approved marketplace payment provider. Artist balances must not be stored in an informal HALO wallet.

## Money model

Money is stored in integer minor units. The dashboard distinguishes received gross from processing or service fees, tax reserve, collaborator and contractual obligations, and the amount available after those entries. The allocation percentages always total 100% and apply only to that available amount.

The default planning allocation is:

- 50% artist pay
- 20% next music and production
- 15% audience development
- 10% business reserve
- 5% experiments and education

These percentages are configurable planning aids rather than accounting, tax, investment, or legal advice.

## Access and security

The API lives at `/api/artist-economy`. Reads require a signed-in Identity user who owns the selected artist room, unless the user is a HALO platform owner. Writes also require a verified same-origin request. Every artist record carries both the artist slug and owning membership identifier.

Conscience reviews are visible and writable only to HALO platform owners. The review desk cannot execute the proposal it evaluates.

## Creator Network integration

`/creator-network/` is the first-party member collaboration workspace; `/creators/` remains the public Creator World preview. It uses shared Netlify Identity and membership, and the existing sitewide Companion rather than a separate guide or account system.

Creator Pass discovery is opt-in and visible only to signed-in members. Members can edit their profile, filter creators and opportunities by role, genre, language and BPM (plus key for opportunities), post briefs, invite discoverable creators, and apply to projects. Incoming and outgoing requests retain pending, accepted or declined states. Only invite recipients can answer invitations; only project owners can answer applications or close projects.

`/api/creator-network` provides authenticated GET workspace reads and same-origin POST actions: `save_profile`, `create_project`, `invite`, `apply`, `respond`, and `close_project`. Project briefs can reference an owned `songId`, its `songVersionId`, an owned `stemPackId`, and an owned `rightsWorkId`. Artist room links must also belong to the profile owner. These references do not copy media, grant access to private assets, or change existing catalog, follow, review, Song Lab or rights permissions.

Accepting a collaboration request records participation only. Split preferences are non-binding; rights approval, split participants and release readiness remain in Artist Economy. No automatic contracts, royalties, payouts or AI generation are introduced.

The additive migration `netlify/database/migrations/20261003095500_create_creator_network.sql` creates member-linked profiles, projects and participants during Netlify deployment. Apply it through the existing migration process before using the API. Validate the integration with `npm run test:creator-network`; these contracts also run in `npm test`.

## Main files

- `artist-economy/index.html` provides the private artist-company workspace.
- `artist-economy/artist-economy.css` provides the editorial control-room interface.
- `artist-economy/artist-economy.js` handles Identity, artist selection, forms, summaries, and status updates.
- `netlify/functions/artist-economy.mjs` provides the ownership-scoped API, rights guidance, and financial summaries.
- `netlify/database/migrations/20260816120000_create-artist-economy.sql` creates the livelihood records as a new roll-forward migration.
- `netlify/database/migrations/20260913071000_expand_artist_rights_ownership.sql` expands rights ownership with composition control, admin publishing status, territory-specific society memberships, and explicit licensing approvals.
- `scripts/artist-economy-contracts.mjs` verifies the ownership, security, schema, and interface contracts.

Netlify applies the migration during deployment. It must not be run manually or merged into an older applied migration.
