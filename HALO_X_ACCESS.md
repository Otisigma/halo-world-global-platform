# DJ HALO X Operations

DJ HALO X adds account-based memberships, collectible access passes, a single pinned signal for each member’s room, recoverable DJ session snapshots, and a daily owner report.

## Owner access

The owner desk is visible to Netlify Identity users with an `admin`, `owner`, `halo-admin`, or `halo-owner` role. It can also be enabled for specific accounts with the `HALO_OWNER_EMAILS` environment variable using a comma-separated list of account email addresses.

Owner access provides aggregate activity, recent member display names, invitation creation, and the invitation ledger. Email addresses are not displayed in the report interface.

## Daily report

`halo-daily-report.mjs` generates a report every day at 08:00 UTC and stores it in Netlify Database. The owner desk also refreshes the current report whenever an owner opens DJ HALO X.

The report includes total membership, new joins, active members, current online presence, daily visitors and page views, pass activations, room activity, room-pin changes, support signals, saved DJ sessions, and Artist Pro lead activity. Members are recorded when they enter the main clubhouse as well as when they use DJ HALO X.

The scheduled job also sends the summary to the configured owner inbox through the Netlify Email Integration. Enable the integration with Mailgun, Postmark, or SendGrid, then set `HALO_DAILY_REPORT_FROM_EMAIL` to an authorized sender address. Delivery is skipped safely when the email integration or sender is not configured. To additionally deliver the report to an external automation service, set `HALO_DAILY_REPORT_WEBHOOK_URL` to a secure HTTPS webhook endpoint.

## Passes

Owners can create Gold Tickets, Backstage Passes, permanent Founders Keys, and one-day Event Passes. A generated code is shown only once; the database stores its secure hash and final four-character hint.

The existing private beta key `HMW-VIP-2026` activates permanent Founders access for up to 250 members through January 1, 2027.

## Room pin

Each signed-in client can publish one room pin containing a title, short message, optional secure destination, and call-to-action label. Saving a new pin replaces the previous one. Recent room pins appear in the HALO Clubhouse on the main site.

## Session continuity

The DJ console immediately stores recoverable session state in the browser and also saves it to the member’s account when they are signed in. Session snapshots include deck and queue state, track metadata, crossfader position, mix intent, and focus mode.

Original local audio files remain on the client’s device. HALO restores their metadata and marks the session continuity state, but it does not upload those files without a separate explicit upload flow.
