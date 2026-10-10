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

## Signal One-Word Map launch

The shop (`/music/`) and Music World player show an active-track emotional map: one word, letters only, up to 20 characters. Recent words refresh every 15 seconds while the page is visible; there are no replies, avatars, likes, or reaction counts. Reduced-motion preferences disable drifting text. Local uploads and fallback catalog tracks do not receive stored reactions.

- Apply `netlify/database/migrations/20261010170000_signal_emotions.sql` through the existing Netlify Database migration process before enabling the feature.
- Configure `SIGNAL_EMOTION_IDENTITY_SECRET` (or reuse `JOURNEY_IDENTITY_SECRET` / `JWT_SECRET`). Writes fail safely when no secret or trusted Netlify `context.ip` is available. The static Express server does not host this API.
- `POST /api/signal/emotion` accepts `{ releaseId, word, playbackSeconds? }`; `GET /api/signal/emotion?releaseId=…` returns up to 24 recent visible words for a currently public, published release.
- Anonymous listeners receive a signed, secure HTTP-only session cookie. Stored anonymous/member and IP quota references are HMAC hashes; public responses never expose them. Quotas are three writes per identity and ten per trusted IP per minute.
- Basic moderation rejects blocked words; add comma-separated words through `SIGNAL_EMOTION_BLOCKED_WORDS`. Set an emotion row's `hidden` column to `TRUE` to remove it from the map. Set `SIGNAL_EMOTION_WRITES_DISABLED=true` to pause submissions without affecting playback.
- Emotion storage and its ledger trace commit in one SQL statement. Ledger entries reference the emotion ID without copying the word or listener identity. Release, publication, and Dreamweaver records are never updated.

Launch checklist:

- [ ] Apply the migration and configure the identity secret on the Netlify deployment.
- [ ] Run `npm run test:signal-emotion`, `npm run build`, and `npm test`.
- [ ] Listen to a published Red Flags / Side By Side release; transmit one word, refresh, and switch tracks to confirm isolation.
- [ ] Check moderation, rapid-submit limits, reduced motion, mobile layout, and safe behavior while writes are paused.
- [ ] Have the DJ invite listeners: “What word does this track leave you with? One word only — we’re mapping the emotional current.”
- [ ] Confirm existing DJ Council preflight and approved release/Dreamweaver routes before announcing the map. This feature does not alter audio processing or publication automation.
