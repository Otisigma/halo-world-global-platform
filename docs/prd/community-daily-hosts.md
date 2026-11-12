# Daily HALO clubhouse hosts

Nova, Muse and Echo are explicitly labelled automated AI hosts, not fabricated
fans. The main clubhouse explains this distinction beside its chat. At 09:00
UTC each day, a Netlify scheduled function generates one short conversation:
Nova opens a topic, Muse contributes a different perspective, and Echo responds
and invites real people to join. Fourteen all-genre music topics rotate by UTC
date; the posts are freshly generated. No private conversations, user messages,
artist records or visitor identities are sent to this generator.

The function uses the existing OpenAI client/model configuration. Its prompt
restricts generation to music opinions and open questions, without invented
events, news, releases, human attendance, personal memories, lyrics or promises.
The output must contain exactly three posts of 1–320 characters each. Links,
mentions, markup and control characters fail validation. Invalid output or
provider errors fail visibly in logs and the scheduled heartbeat; they are not
replaced with invented success. Generated content still needs human oversight:
the existing report/mute/block mechanisms remain available.

`community_host_days` enforces one conversation per date. The date claim,
opener, and two replies are inserted in one PostgreSQL statement. Concurrent
invocations cannot insert duplicate daily conversations. Already-published
dates do not invoke AI again. A failed generation leaves the date unclaimed;
an operator can rerun the scheduled function through Netlify. The generator
has a 20-second timeout, no automatic provider retries, and an 800-token cap.

Posts carry actual database timestamps; the guide does not simulate live
typing, fake votes, or human replies. Hosts are not shown as online humans,
and automated posts are excluded from daily human-message counts and the
agent council's seven-day community-message metric. There are no automatic
responses to members and no bot-to-bot feedback loop.

Deployment requires the new database migration and existing AI-provider
configuration. Scheduling runs on the production deployment, not the preview.
Set `HALO_COMMUNITY_HOSTS_ENABLED=false` to pause posting; disabled runs record
a successful skip heartbeat. No production run or publication is implied by
opening the pull request.

Validate with `node scripts/community-host-contracts.mjs`, existing community
contracts, database migration contracts, and `npm run build`. Run
`scripts/community-host-db-contracts.mjs` with `HALO_COMMUNITY_TEST_DSN` pointing
to a disposable `halo_community_test` PostgreSQL database on a
`/tmp/halo-community-hosts-*` socket. This verifies concurrent insertion,
duplicate handling and rollback after a failed reply insertion against real
PostgreSQL. Live AI generation and production rendering still require checks
after migration/deployment.

## Next level

Prioritize real participation: fan-selected topics, a weekly discussion digest,
catalog-backed artist spotlights with verified public data, and opt-in AI-host
replies with a separate rate limit and moderation. Measure human replies and
returning listeners separately from automated posts. Do not add those features
by manufacturing activity or presenting automated reactions as fan demand.
