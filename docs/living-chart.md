# Living Chart listening experience

The public homepage's **Global Living Chart** entry opens `/music/#living-chart`.
The same experience is available in `/music-upload/` and `/shop`.
The separate `/global-chart/` catalog-lab preview remains isolated: its browser-only
preview votes are not production votes.

## Discovery and eligibility

- **Discover everything** lists all approved public releases A-Z, including
  songs without activity and songs explicitly excluded from chart rankings.
- **New arrivals** lists the same public catalog newest first.
- Search and genre rooms apply to either discovery view and the activity views.
  Neither discovery view has a Top 20 cap, and the public catalog query no
  longer silently drops releases after the newest 200.
- Activity views show at most 20 chart-eligible public releases with clicks or
  room opens in the last 14 days, or cumulative votes. Private, draft and
  unapproved releases never enter public discovery.

The shop and `/api/catalog/chart` now share `lib/chart-signal.js`:

`signal = cumulative votes * 5 + last-7-day outbound clicks * 8 + last-7-day room opens * 3`

This intentionally replaces the shop's earlier `recent * 2 + previous` formula
with the chart API's existing score. Equal signal scores sort by release ID.
The API uses the same public eligibility and activity window, ranks all
candidates before returning up to 50, and no longer only considers the newest
200 candidates. Other views (most clicks, most opens, newest) deliberately
have their own labelled order.

Activity change compares weighted clicks/opens against the previous 7 days.
It is **not saved position history**. Counts are not verified audio streams,
unique listeners, sales, DSP rankings or country rankings. "Global" means the
combined HALO catalog, and rooms are genres, not regions.

## One player, listener control

The stage uses `window.HaloPlayer`, the same native audio instance as release
cards, the floating bar and playlists. It adds finite-duration seeking,
previous/next, **Play this view**, a visible finite queue, and moment links to
the existing Obsidian deep-link player. A new listening queue snapshots the
current view, skips entries without direct playable audio and never loops.
Filtering and explicit refresh do not silently rewrite that queue.

Chart, featured-hero and personal-playlist queues exchange their existing
ownership events so only one continuation controller advances playback.
Manual card playback, another track source, or a media error stops chart
continuation. Pausing and resuming a queued selection preserves it.

Artwork uses the shared lyrics screen and shared page-level toggle. Supplied
timestamps remain authoritative; untimed percentage pacing is labelled
estimated, not synchronized. No lyrics or timestamps are invented. The optional
frequency visualizer reuses the tested Obsidian `captureStream` analyser,
does not capture a microphone, and never routes a second audible output.
It is off by default, resets between tracks, respects reduced motion and
visibility, and reports unsupported browsers or restricted audio honestly.

Existing playlist, artist-approved listen/buy/share, release-room, story and
available-video actions remain on the selected release. Mobile puts the stage
before the scrollable board. Keyboard focus and seeking stay under listener
control, and lyrics/clock updates do not rebuild the stage.
Real video playback stops the listening queue and pauses shared audio;
returning to audio restores the video poster instead of leaving two sources
playing. Story, activity and footage are available in a native disclosure
below the primary listening controls.

## Voting and freshness

Stage votes call the real `/api/catalog/vote` endpoint for eligible published
public releases. The server applies its existing one-vote-per-release/day key
derived from IP and user agent. This is a network-identity limit, **not verified
listener identity or fraud-proof voting**. Success, already-voted and failure
states are explicit; the order changes only when the listener refreshes.

The loaded-at time describes a browser catalog snapshot, not an event timestamp
or a continuously updating feed. Refresh failures retain the previous snapshot
and ongoing audio with a visible stale-state message. No automatic reorder or
fabricated historical movement is added.
