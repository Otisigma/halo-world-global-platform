# Playlist Studio / Listening worlds

## Songs and personal playlists

Song cards and featured chart leaders at `/music/` and `/music-upload/` have a
**+** button. Choose a saved playlist or name a new one and add the song in one
action. Names are 1-80 trimmed characters. Duplicate songs and case-insensitive
duplicate names get inline feedback.

The hub creates, renames, reorders and deletes playlists and removes songs.
**Play playlist** starts only on a user action. Original playback uses the
existing HALO player and saved order, skips unavailable previews and applies the
playlist's content filter. It finishes unless **Repeat my playlist** is checked.
Previous/Next stay in the chosen queue. **Stop playlist continuation** lets the
current song finish; **Stop mixed playback** stops both mix decks.
Volume and Mute control both original playback and both mixed decks.

Browser playlists reuse Obsidian's `halo_obsidian_playlists_v1` format:
`[{ id, name, releaseIds, world? }]`. Old records without `world` remain valid.
Only names, catalog IDs and bounded world settings are stored, never recording
files or audio URLs. Open/reload Obsidian to see shop changes. Other-tab storage
changes refresh the studio. Failed/corrupt storage reports an error without an
optimistic save or data replacement. Clearing site storage removes local lists;
other people using the same browser profile can see them.

## Dreamweaver journeys and visual worlds

**Shape this world** provides an original generated SVG cover, four palette
choices, a dedication, chapter starts and a plain-language Dreamweaver request.
Chapter starts use `release ID | name | target energy 1-4`, up to 12 per playlist.
They move with their songs and are removed if the song is removed.

Each world displays its original palette cover by default. Select a palette or
enter a public HTTPS image URL (or a HALO `/assets/` path) to save the world and
show that cover. A broken image falls back to the selected palette. The URL can
point to an already uploaded image, but this editor does not upload or host files.
Changing a cover saves the other current world-editor fields as well. Browser
worlds remain local until **Save to account**; account and shared worlds retain
their cover settings. Anyone with a listening link can see the URL, and an
external image host receives image requests. Avoid private or expiring URLs.
The SVG download remains the generated palette cover, not the linked image.

**Propose a Dreamweaver journey** reuses `lib/mix-intent.js` and ranks public
catalog metadata locally. Supported mood/genre words, supplied BPM, a reproducible
variation seed and the listener's familiarity/discovery setting determine
recommendations. Each recommendation explains matching metadata and whether it
was already in this playlist. A proposal never starts playback or changes the
saved order until **Use this order and chapters** is clicked.

The familiarity control refers to songs in the current playlist, not inferred
listening history or a member profile. Unsupported request text is reported, not
guessed. Stage labels and chapter energy are creative targets, not measured song
energy. The existing parser keeps a level/rising arc; a quieter landing can be
set manually in the chapter editor. No third-party model, imitation, audio
analysis or invented metadata is involved.

Content choices are **all**, **exclude explicit** (unknown ratings allowed), and
**clean only** (both explicit and unknown excluded). They use the catalog's
`contentRating`, never guessed lyrics. Exports include an escaped original SVG,
JSON tracklist and printable HTML listening card with public song links.
Exports never include recording URLs, files or recording rights.

Each available song also opens its existing Dreamweaver listening world.
**Inspire an album** passes only a browser-local playlist ID to Album Concierge.
On step 4, **Use playlist as inspiration** explicitly checks the current public
catalog and appends ordered reference credits to the existing story. It does not
copy audio, import remix rights or automatically generate anything. The combined
story must fit 4,000 characters; generation retains the existing signed-in,
explicit **Build my album** action. DJ Deck remains available for hands-on mixing.

## Actual mixed playback

Web Audio is initialized only after opting into playback that needs mixing or
gain matching. Two dedicated HTML audio decks feed separate loudness-reduction
and equal-power fade gains. The original HALO player is stopped when mix decks
take ownership; the original player itself is never wrapped in a Web Audio
source, preserving its external-media behavior.

- **Original** preserves recording speed. Optional gain matching uses live RMS
  samples to reduce loud tracks; gain stays between 0.25 and 1 and never amplifies.
  It is not LUFS normalization or mastering.
- **Smooth** schedules actual sine/cosine equal-power gain envelopes near the
  current song's end. The next stream may preload after 60% of the current song
  once this explicit listening session has started.
- **Tempo-aware** adjusts the next deck only when supplied BPM can match within
  4%, with `preservesPitch` enabled. Larger/unknown BPM differences retain normal
  speed and crossfade. This is not beat-phase alignment or beatmatching.

Fade duration is 2-10 seconds, bounded by half each known song duration. Pause
suspends the audio clock and both playing decks; cleanup waits for audio-clock
completion rather than incorrectly finishing a paused fade on a wall-clock timer.
Stop releases media references, resets optional listening reports and silences
the engine. Crossfades are streaming playback, not rendered/downloaded mixes.

Mixed playback is limited to same-origin public preview streams. External sources
and unsupported Web Audio devices explicitly select original playback instead,
without fetching external recordings for analysis or making the original player
CORS-dependent. An actual media/play failure stops the mix and reports the error;
it does not start an unrelated substitute. Audible quality, browser policy and
device-specific pitch preservation still need live verification.

Original, chart, discovery and personal mix queues are mutually exclusive.
Choosing another song, starting another queue or closing the original player
stops the old personal route. Existing optional listening-report consent is
preserved. Playback never grants playlist rewards.

## Account sync and collaboration

**Connect HALO account** loads the existing Identity integration only on a click.
Sign in, then load account lists or explicitly **Save to account**. Local playlists
are never silently uploaded. Saving again replaces that browser list's previously
saved account version with optimistic revision checks; edits by another device or
collaborator produce a conflict rather than losing their changes.

Account playlists use `/api/playlists` and are private by default. They can be
opened, reordered, renamed and edited on any signed-in device. Sign-out/account
changes clear account UI, invalidate in-flight responses and stop room/mix state.
Local browser copies remain local and are disclosed as shared-profile storage.

Owners can generate/rotate or disable an **unlisted listening link**. Anyone with
the active link can see the chosen title, dedication, chapters and public song
credits. It is a bearer link, not a publicly indexed profile or search result.
The server stores only a SHA-256 token hash. Private request text, personalization
preferences, collaborator identities, owner IDs, emails and asset URLs are never
returned in the public view. Revocation blocks subsequent reads; material already
viewed or exported cannot be recalled. A listener can explicitly keep an editable,
browser-local public-reference copy.

Single-use collaborator invitations expire after seven days. **Contributors**
suggest public songs and cast one vote per suggestion. **Editors** can also
change the list/world and approve/reject suggestions. Only the owner can share,
invite/revoke, delete, broadcast or claim curator bonuses. The host/editor decides
which approved song to place next; votes do not override playback automatically.
Removing a collaborator also revokes outstanding invitations and their votes.
Owners can remove collaborators; collaborators can leave.

Limits: 100 owned playlists, 100 songs each, 20 collaborators and outstanding
invites per playlist, 20 joined worlds per member, 100 suggestions per playlist
and 60 mutations per member per minute. Mutations serialize member and playlist
rows, and edits use revisions. Added songs are rechecked as currently published
and public. Saved unavailable positions can be retained or removed, without
exposing their title, artist or assets.

## Listening rooms

Only the owner can **Broadcast original player** after choosing a public song
from that playlist. Mixed decks have overlapping playheads and therefore cannot
claim a single synchronized broadcast. The owner sends current song, pause state
and playback time every five seconds while broadcasting.

Following is an explicit listener action. Lightweight `?room=<playlist UUID>`
(member access) or `?room=<share token>` (unlisted access) polls only public room
state, not account/editor metadata. The same original player follows source,
pause and approximate seek position. A paused host never causes a new song to
start. Browser policy may require the listener to tap Play again.
The room content filter excludes catalog-labelled explicit songs by default and
clearly allows unknown ratings; listeners can choose clean-only or allow all.
Excluded songs pause guest audio. Manual guest pause stops following, and small
timing differences below 1.5 seconds do not trigger repeated disruptive seeks.

Room updates are not verified listens, analytics rewards or a participant roster.
Polling skips hidden documents. Stop explicitly clears a host's persisted room;
lost/closed sessions expire from reads after 20 seconds, preventing stale audio
from starting indefinitely. Revoked access stops following. Network latency and
device buffering mean this is approximate shared listening, not sample-accurate
multi-device audio synchronization.

## Consent-gated rewards

Local curator labels remain non-spendable progress: 1 song / First spark, 5 songs
/ Journey builder, 10 songs from 3 named artists / World selector. These can fall
when songs disappear and are not real balances.

**Claim verified curator milestones** is a separate authenticated server action.
Existing Track Drops reward consent must already be on; this action never changes
it. The server counts current published/public releases from at least three named
artists, excluding releases owned by the claimant. Five eligible songs unlock 25
points once per account lifetime; ten unlock 50 once. Claiming at ten for the first
time can grant both (75 total lifetime). Playback, repeat loops, renames, copying,
reordering, deleting/recreating or repeated requests cannot grant more.

The grants use existing `halo_member_reward_events` and existing member tiers.
They lock the same consent row used by preference changes and reward claims, and
unique member/reward keys prevent repeat credit. No physical prize, artist
endorsement, discount, license or spendable client balance is invented. Printable
listening cards and original covers are useful free digital keepsakes; recording
rights and the default-off Constellation pilot gates remain unchanged.

## Deployment and verification

The additive migration is
`netlify/database/migrations/20261112050000_playlist_worlds.sql`. It requires the
existing memberships, release catalog, song catalog, notification preferences and
member reward-event tables. Ship the function and client assets with the migration
through the maintainer's reviewed database deployment process. A code push does
not itself establish that a production database migration has been applied.
Without the migration/connection, cloud actions return an explicit 503; local
playlists continue working. No production migration command or secrets are
included, and no existing pilot flag is removed.

Run `npm run test:playlists` for local interaction, request bounds, permissions,
actual SQL function/migration behavior in an in-memory PostgreSQL engine,
deduplicated consent-gated points, safe exports, journey rules, queue competition,
audio-envelope scheduling, tempo bounds and account-change races. PGlite uses no
network listener, system PostgreSQL directory, production data or credentials.
It validates real SQL but not native multi-connection PostgreSQL locking under
load. Run existing build, Obsidian, chart/player, video-discovery, Album Concierge,
request-security and interaction contracts too.

Before enabling cloud actions on a deployed site, independently verify the
migration against a non-production database and repeat on desktop/mobile:
sign in/out and switch accounts; save on one device and open on another; share and
revoke; claim/join/revoke invites; conflicting edits; suggestions and votes; room
pause/seek/expiry; clean/unknown ratings; audible crossfades and pause/resume;
blocked/unsupported sources; reward consent, milestone retry and deletion.
Automated checks do not establish audible live playback or production deployment.
