# DJ HALO X Operations

DJ HALO X adds account-based memberships, collectible access passes, a single pinned signal for each member’s room, recoverable DJ session snapshots, and a daily owner report.

## Owner access

The owner desk is visible to Netlify Identity users with an `admin`, `owner`, `halo-admin`, or `halo-owner` role. It can also be enabled for specific accounts with the `HALO_OWNER_EMAILS` environment variable using a comma-separated list of account email addresses.

Owner access provides aggregate activity, recent member display names, invitation creation, and the invitation ledger. Email addresses are not displayed in the report interface.

## Daily report

`halo-daily-report.mjs` generates a report every day at 08:00 UTC and stores it in Netlify Database. The owner desk also refreshes the current report whenever an owner opens DJ HALO X.

The report includes total membership, new joins, active members, current online presence, daily visitors and page views, pass activations, room activity, room-pin changes, support signals, saved DJ sessions, and Artist Pro lead activity. Members are recorded when they enter the main clubhouse as well as when they use DJ HALO X.

The scheduled job also sends the summary to the configured owner inbox through the Netlify Email Integration. Enable the integration with Mailgun, Postmark, or SendGrid, then set `HALO_DAILY_REPORT_FROM_EMAIL` to an authorized sender address. Delivery is skipped safely when the email integration or sender is not configured. To additionally deliver the report to an external automation service, set `HALO_DAILY_REPORT_WEBHOOK_URL` to a secure HTTPS webhook endpoint.

## Track drop alerts and member rewards

When a song is explicitly published to the shop (Push to Shop & Charts, the unified upload pipeline, or the catalog publish stage), HALO records one track drop for that song. Members choose their alerts at `/track-drops/`: in-app track drop cards, Dreamweaver email cards (which require explicit email consent), and member rewards. The scheduled 15-minute publication repair never announces drops, so the existing catalog is not re-announced.

Email cards use the same Netlify Email Integration with the `emails/halo-track-drop` template and are sent by a separate scheduled dispatcher every 10 minutes. Set `HALO_TRACK_DROP_FROM_EMAIL` to an authorized sender. Until this sender, `NETLIFY_EMAILS_SECRET`, and an HTTPS site `URL` are all configured, cards stay queued and are not sent. Cards are also withheld from anyone who has since turned email off. Cards older than seven days expire rather than arriving late. Members collect reward points once for joining track drops and once for each drop they open. They only ever see their own points and tier.

## Passes

Owners can create Gold Tickets, Backstage Passes, permanent Founders Keys, and one-day Event Passes. A generated code is shown only once; the database stores its secure hash and final four-character hint.

The existing private beta key `HMW-VIP-2026` activates permanent Founders access for up to 250 members through January 1, 2027.

## Room pin

Each signed-in client can publish one room pin containing a title, short message, optional secure destination, and call-to-action label. Saving a new pin replaces the previous one. Recent room pins appear in the HALO Clubhouse on the main site.

## Signal Hype Rooms

Open **Hype Room** on a persisted Signal feed post at `/signal-network/`. A room is that post's comment thread, not a new channel: public posts authorize signed-in members, and private posts authorize only their author and selected audience. Changing accounts, leaving, switching rooms, or hiding the page clears displayed history and cancels pending requests. Visible rooms check for updates every 10 seconds, with bounded reconnect backoff; this is HTTP polling, not instantaneous WebSocket delivery or presence.

The Netlify `/api/hype-room` function uses Netlify Identity and Database, existing Signal comments, bidirectional blocks, private reports, and the shared atomic 30-writes/minute member quota. It accepts up to 500 characters with explicit audience consent and returns the latest 50 comments, without member IDs or Discoverer ranks. Messages also appear in the existing Signal comments interface (public comments remain public there). Existing comments can be longer than new chat messages. No local chat copies, private-content logs, automated resend, room creation, client system/breakout triggers, or voice-note delivery are added. Chat writes do not fan out DM or comment notifications.

Reports enter `halo_signal_reports` for operator review; they do not automatically remove content. Reports reference room/comment IDs without copying chat text. Authors can remove their own messages (and replies); operators can remove a reported `halo_signal_feed_comments` row using the existing database administration process. Blocks apply across Signal. There is no new moderation dashboard or automatic content-classification service.

For posts linked to a public published release, an existing persisted reviewed-rotation milestone may be displayed with its actual date. It is not a new breakout trigger or a claim that the release is currently playing. Private ranks and supporter identities stay in the existing opt-in Discoverer flow. The radio link opens the actual radio page; no sample song, rank, voice note, or simulated live state is supplied.

Deployment prerequisites: apply the existing migrations `20260829150000_create_signal_command_center.sql`, `20261003160000_create_signal_public_feed.sql`, `20261006080000_signal_feed_media.sql`, and PR #456's `20261027060000_discoverer_milestones.sql` (with their earlier prerequisites); enable Netlify Identity and Database on the same HTTPS origin. No new migration or dependency is required. The static Express/Docker server does **not** host this authenticated API; standalone static hosting will show unavailable/error states, not working chat. No persistent socket server is deployable on the configured Netlify Functions architecture.

Validate with `npm run test:hype-room`, `npm run test:network`, `npm run test:discoverer`, `npm run build`, and `npm test`. Set `HYPE_ROOM_TEST_DATABASE_URL` to an isolated local test database to also exercise real SQL persistence, authorization, safety controls, milestones and concurrent quotas; tests create and drop a temporary schema. Production Identity, migrations, delivery between two real sessions, audience revocation, and operator report review still require deployment verification. Live production access could not be verified from the implementation environment.

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
