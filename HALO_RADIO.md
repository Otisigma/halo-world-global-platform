# Halo Radio

Halo Radio uses the existing Halo site as the listener, creator, community, and control layer. A dedicated streaming server remains responsible for uninterrupted audio delivery, automated playlists, live DJ connections, transcoding, and listener scaling.

## Recommended broadcast engine

Use AzuraCast for the first creator-owned deployment. Run it outside Netlify on a small dedicated server and create three stations:

- `halo-club`
- `halo-chill`
- `halo-lounge`

Each station can run its own AutoDJ playlists and accept a live DJ source. Halo Radio reads public now-playing data through the AzuraCast API while browsers play the station's public HTTPS stream.

Netlify remains responsible for the parts that belong to the Halo product:

- The three-room radio interface
- Creator identity and membership
- Track uploads in Netlify Blobs
- Submission metadata and votes in Netlify Database
- Preview playback and community scoring
- Weekly programming, show subscriptions, station play history, and artist activity
- Future AI review, station scripts, moderation, and promotion workflows

This separation keeps the streaming layer replaceable. A managed provider can be connected later without redesigning the listener experience.

## Environment variables

Set the public base URL and station short names:

```text
HALO_RADIO_AZURACAST_URL=https://radio.example.com
HALO_RADIO_CLUB_STATION=halo-club
HALO_RADIO_CHILL_STATION=halo-chill
HALO_RADIO_LOUNGE_STATION=halo-lounge
```

If a different streaming service is used, connect each public HTTPS stream directly instead:

```text
HALO_RADIO_CLUB_STREAM_URL=https://stream.example.com/club
HALO_RADIO_CHILL_STREAM_URL=https://stream.example.com/chill
HALO_RADIO_LOUNGE_STREAM_URL=https://stream.example.com/lounge
```

Direct stream variables take priority over URLs reported by AzuraCast.

The AzuraCast setting accepts either the server origin or its `/api/nowplaying` URL. HALO supports both station-specific objects and the station-list array returned by AzuraCast. When HLS is enabled and marked as the station default, the public HTTPS HLS URL is preferred over internal or insecure mount URLs such as `localhost`.

## Launch sequence

1. Deploy AzuraCast and enable HTTPS.
2. Create the three stations and their initial playlists.
3. Add the environment variables to the Netlify project.
4. Confirm now-playing data appears at `/api/radio/stations`.
5. Test each room from `/radio/` on desktop and mobile.
6. Add creator terms covering ownership, public preview, streaming permission, AI analysis permission, and takedown requests.

## Programme grid and station desk

`/radio/#schedule` publishes the recurring weekly grid in each listener's local time. Signed-in listeners can follow individual shows. HALO owners and administrators receive an **Open station desk** control that can:

- Create or update recurring Club, Chill, and Lounge shows
- Assign hosts, producers, formats, durations, and linked artist rooms
- Publish, pause, or hold programmes in draft
- Log live, AutoDJ, replay, and station-desk plays
- Connect radio, magazine, release, event, replay, and community activity to an artist room

The public schedule API is available at `/api/radio/schedule`. Management actions require a verified same-origin request and an Identity user with an owner or administrator role. Schedule, subscription, play-history, follow, and activity records are stored in Netlify Database.

## DJ residents

`/radio/#residents` publishes the resident roster. DJ HALO, DJ BUTTERFLY, and DJ ROMY are station residents rather than deck mix styles: each holds a lane, a home room, a tempo range, and an earned level that decides what it is allowed to do on air. Levels are recomputed daily from listener retention indexed against the room's own baseline, and they can fall.

A resident builds an hour ahead of air from rotation-approved tracks — a deterministic running order with a chosen transition and reason at every handoff — and stores it as a proposal. Nothing airs without an owner approving it, which the database enforces rather than the application. Talk breaks are written text, and any line that cites nothing the station can verify is dropped before it is stored.

The roster and its actions are served from `/api/radio/personas`, and `radio-persona-planner` prepares upcoming hours every six hours. Attach a resident to a programme by setting `halo_radio_shows.persona_id`. The full ladder, scoring model, grounding gate, and operating notes are in `RADIO_DJ_PERSONAS.md`.

## Artist fan connections

Published artist rooms use `/api/artist/connections` to display first-party follows, upcoming linked radio shows, recent verified station plays, and connected stories, events, and replays. A signed-in listener can follow an artist without leaving HALO, creating the foundation for future release and radio notifications.

## Station operations team

Halo Radio includes four automated station agents that run in the background every five minutes:

- Signal Agent verifies that each configured HTTPS audio stream answers.
- Clock Agent checks that station timestamps are valid and fresh.
- Data Agent validates all three rooms and their now-playing metadata.
- Recovery Agent sends failures into the existing AI-assisted maintenance workflow and closes incidents after recovery.

The public status endpoint is available at `/api/radio/health`. The radio console uses it to show the verified station state, network time, health score, agent status, and live signal scope. A room is shown as verified only after its stream endpoint answers the health probe.

The site intentionally shows a polished preview state before streams are configured. A valid HTTPS stream URL enables uninterrupted live broadcasting, while approved rotation tracks and Long Play mixes keep the player useful before that connection is ready.

Before an external stream is connected, each room can now run a Netlify-native AutoDJ rotation from tracks that have been approved for `rotation`. Newly uploaded rotation tracks play first. Every queued room track and takeover segment is preflighted before air where the browser can verify it, so a missing upload, incomplete source, or unplayable promotion is skipped before it can leave the station silent. After the room queue completes, the DJ HALO X 60 MIN TAKE OVER MIX runs as the station fallback before the room returns to the next ready room upload. If no ready room upload or takeover segment is available, the Halo artist playlist becomes the final visible recovery layer, and the console exposes manual takeover controls whenever the station backup mix is standing by. The takeover also remains in the Long Play queue, while AzuraCast or a direct HTTPS stream remains the path for uninterrupted live broadcasting.

Long Play also alternates approved YouTube sessions with Mix Cloud audio so listeners advance into a different full-length programme after each session. The curated YouTube catalog is stored in Netlify Database, appears in the visible Long Play queue, and advances automatically when a video finishes.

### Owner bulk catalog desk

Signed-in HALO owners receive a fast-lane upload desk above the public creator form. One file selection can contain up to 25 broadcast-ready tracks. The browser uploads each recording safely in chunks while the server reads embedded ID3 data such as title, artist, album, lyrics, source link, BPM, musical key, year, and artwork presence. Halo AI then turns the verified tags and lyrics into concise catalog descriptions, mood and theme labels, language, energy, radio fit, and room placement without claiming to hear or acoustically analyze the file. If AI is unavailable, the verified embedded metadata still completes the upload.

The owner confirms rights once for the batch and can send every successful track directly to `rotation`. Club, Chill, and Lounge now advance through their database rotation queues track by track before falling back to the looping YouTube playlist. Public creator submissions continue to enter community preview instead of bypassing review.

### Artist review updates

The station desk separates its private programming note from the update returned to the artist. Every preview, rotation, spotlight, hold, or rejection decision creates a new unread update on the linked artist release card. The artist sees the current outcome and any station guidance in their own room, then opening the radio action marks that update as read while keeping the linked Track Vault version available for a revised submission.

## AI station manager council

The owner-only station desk includes a coordinated five-role manager council: Programme Director, Audience Strategist, Artist Development Lead, Broadcast Systems Manager, and Growth Partnerships Lead. A council run reads the same current audience, catalogue, programming, reliability, and cost evidence already used by the radio operator, then produces one measurable operating plan instead of five disconnected opinions.

Council plans and their action queue are stored in Netlify Database. Every proposed action begins in `proposed` status and requires an owner to approve, reject, or later mark it complete. The managers do not change schedules, contact artists, spend money, or operate broadcast infrastructure directly.

`GET /api/radio/manager-council` returns the latest protected plan. `POST /api/radio/manager-council` supports `run_council` and `decide_action`; both require a signed-in owner and same-origin requests.

When the verified station path is unavailable, the console opens the Halo YouTube artist playlist as a continuous, looping recovery rotation. The player advances through the playlist while more artists are added, and its visible now-playing details update for each video. Browser audio and YouTube recovery playback are mutually exclusive so the listener never receives both audio sources at once. The complete incident history, diagnosis order, recovery sequence, verification checklist, and artist-video direction are documented in `HALO_RADIO_VIDEO_PLAYBACK_RUNBOOK.md` and stored in the AI council's operational knowledge table.

## Listener audience measurement

`halo_radio_play_history` records what the station broadcast. It does not record whether anyone was listening. The radio console now reports that separately through the shared stats client:

- `radio_tune_in` when playback starts
- `radio_heartbeat` roughly every 45 seconds, carrying the number of seconds actually listened since the last beat
- `radio_tune_out` when playback stops or the page is hidden
- `radio_skip` only when a listener presses next or previous on a Long Play mix, or switches rooms, within 30 seconds

Heartbeats report elapsed seconds rather than a count, so a throttled background tab reduces the number of beats without inflating or deflating the listening total. Live station rotation between tracks is never counted as a skip, because listeners have no skip control on a live room.

`GET /api/radio/audience` returns the full station picture — listener minutes, tune-ins, unique listeners, peak and current concurrency, per-room and per-artist breakdowns, and a daily series. It requires the `STATS_ADMIN_TOKEN` bearer token.

`GET /api/radio/audience?artist=<slug>` is public and returns an aggregate-only proof card for one artist: plays, unique listeners, listener minutes, followers, and last played date. Artist listening is attributed by matching each heartbeat's room and timestamp against the play log.

## Dawn: the 5am station briefing

Dawn is a scheduled operator that runs at 05:00 UTC every day, reads the station's own numbers, and writes a briefing to `halo_radio_operator_briefings`. It never acts on the station. Every move it proposes is a recommendation held for owner approval.

Each briefing grades the station `healthy`, `watch`, or `at-risk`, and returns a cost watch, programming moves, artist spotlights, priorities, and blind spots. Signals are gathered from the database only, with no outbound calls beyond the model request, so a dependency outage cannot stop the run. If inference fails or times out, Dawn stores a deterministic fallback briefing built from the same signals and flags it with `used_fallback`.

`GET /api/radio/operator?limit=7` returns the latest briefing and recent history. `POST /api/radio/operator` triggers a run immediately. Both require the `STATS_ADMIN_TOKEN` bearer token. Dawn uses the Netlify AI Gateway, so no separate model key is needed.

Cost figures in the briefing are projections from Netlify's published credit rates applied to measured usage. The Netlify billing dashboard remains authoritative.

## Gemma radio operator

The owner-only station desk includes Gemma, a guarded radio operations assistant. Gemma can inspect current station health, explain priorities, run a fresh signal verification, and request an AzuraCast update check after explicit owner approval.

Gemma never receives the Docker socket. Remote update requests pass through the narrow relay in `ops/gemma-relay`, which accepts only the `watchtower_update` action for the `azuracast` scope and forwards it to Watchtower's authenticated HTTP API.

Configure the Netlify side with:

```text
HALO_GEMMA_OPERATOR_URL=https://your-protected-relay.example.com/v1/commands
HALO_GEMMA_OPERATOR_TOKEN=use-a-long-random-shared-token
HALO_GEMMA_MODEL=gpt-5.4-mini
```

Configure the relay container with matching `GEMMA_OPERATOR_TOKEN`, the existing Watchtower HTTP API token as `WATCHTOWER_TOKEN`, and the internal Watchtower endpoint as `WATCHTOWER_URL`. Publish the relay only through an HTTPS reverse proxy. Do not publish Watchtower port 8080 or mount `/var/run/docker.sock` into the Gemma relay.
