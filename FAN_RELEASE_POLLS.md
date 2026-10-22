# Fan release-consideration polls

Campaign Studio (`/campaign-studio/`, API `/api/fan-campaigns`) supports two separate kinds of fan vote. Existing listening-party campaigns are unchanged; the release-consideration poll is a separate, opt-in, advisory purpose.

| | Listening-party campaign (`purpose: listening_party`, existing default) | Release-consideration poll (`purpose: release_consideration`) |
| --- | --- | --- |
| Who creates it | Signed-in artist team using their own HALO Radio tracks (`preview`/`rotation`); HALO owners can use any | Signed-in artist team using their own eligible catalog songs; HALO owners can use any eligible song |
| Who can vote | Anyone: signed-in members, or anonymous browsers with a device token | Signed-in Netlify Identity members only, with member rewards turned on and at least **Insider (100 earned points)** |
| Votes | One current choice per member or device; can be changed | One current choice per member; can be changed until the poll closes; device tokens never count |
| What the result means | Community goal / unlock for the listening party | **Advisory** fan recommendation for the artist team |
| Rewards | Unchanged | Voting does not earn reward points |

## Voter eligibility rule

- The voter must be signed in with a real Netlify Identity account. Anonymous or device-token votes are refused (`401`) and blocked again by a database trigger.
- The voter must have **member rewards turned on** (`halo_member_notification_preferences.rewards_enabled`, set on `/track-drops/`). If rewards are off, points do not count, in line with the existing rewards policy.
- The voter must have at least **100 earned points** (the existing **Insider** tier in `REWARD_TIERS`, `netlify/lib/track-drops.mjs`). Points come from `loadMemberRewards`, which adds up persisted `halo_member_reward_events` rows. The threshold is stored on each poll (`voter_min_reward_points`, minimum 100).
- Eligibility is recalculated from the database for every vote. The `halo_fan_release_poll_vote_guard` trigger checks it again inside the write. Rank, points, or tier sent by the browser are ignored.
- Tier unlocks voting but **never adds weight**. Insider, Inner Circle, and HALO VIP votes each count once.
- Public poll responses never include emails, member ids, voter keys, or point totals. A signed-in viewer only sees their own tier label and eligibility message.

## Vote counting and audit

- The current choice is stored in `halo_fan_vote_campaign_votes` with `voter_key = 'member:<id>'`. A unique index on `(campaign_id, member_id)` allows only one current vote per member per campaign. Changing a vote replaces the earlier choice.
- Each accepted submission is written to `halo_fan_release_poll_vote_events` in the same statement. The record includes the member's tier id at that time, but not their points. Members can submit up to 10 times per poll every 10 minutes.
- Votes are only accepted while the poll is `published` and the current time is between `starts_at` and `ends_at`. The app checks this, and the database trigger checks it again. The trigger also takes a share lock on the poll, so closing the poll waits for in-flight votes.

## Candidate eligibility

A song can be shortlisted only if all of the following are true in the real catalog schema:

- an `active` `halo_song_catalog` record owned by the creating team (`owner_member_id`); the HALO owner may shortlist any artist's song;
- `rights_status = 'cleared'`;
- `metadata_status` is `ready` or `reviewed` (Dream Weaver found no required blockers);
- an active `sale_master` version with `mastering_status = 'approved'` and connected audio;
- `pipeline_status` is not already `published`.

If any requested song fails a check, the poll is not created. Candidates are copied into `halo_fan_vote_campaign_tracks`, and `source_song_id` links each one to its catalog song. They stay private while the poll is a draft. The public poll shows only the title, artist, genre, and position; no audio or artwork is exposed. After the poll leaves draft, the shortlist cannot be edited (`release_poll_candidates_locked`). To change it, close the poll and create a new one. A poll's purpose and threshold cannot change after creation, and a closed release poll cannot be reopened.

## Result and human approval

When the team closes the poll, HALO records the result once in `halo_fan_vote_campaigns.recommendation` and adds a `pending` ledger entry. The result is labeled **"Fan recommendation / awaiting artist-team decision"**.

- **Leader:** one song has the most votes. It is shown as the fan recommendation.
- **Tie:** all tied songs are listed in shortlist order and marked as unresolved for artist-team review. HALO never breaks ties automatically.
- **No votes:** the team decides without a fan recommendation.

Closing a poll never changes `halo_song_catalog`, versions, `halo_release_campaigns`, chart eligibility, or `halo_song_publication_sync`. It also never runs `/api/song-publication-reconcile` or calls any external service. Only the artist or rights holder and an authorized HALO owner can release a song, using the existing Song Catalog release controls (`/song-catalog/`) after reviewing rights, consent, metadata, and release readiness.

## No automatic third-party distribution

A release poll does not send audio to Spotify, Apple Music, or any other service. It also does not authorize anyone to do so. Fan popularity is not rights clearance or publishing approval.

## Validation

```
node scripts/fan-release-poll-contracts.mjs
node scripts/fan-campaign-contracts.mjs
npm test
```

The contract script runs the real `/api/fan-campaigns` handler against an in-memory database double. That double mirrors the migration's vote guard, so it does not replace testing the migration and triggers against a real Netlify Database in a deploy preview.
