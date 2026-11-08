# Video discovery loop

The Hub (`/halo`), Dreamweaver and music catalog share a discovery panel:
silent eight-second visual preview → song-specific Dreamweaver room → themed
playlist → another song or the Hub. Native release footage takes priority over
linked watch pages. Without native footage, an explicitly labeled HALO visual
backdrop is used; it is not presented as the song's official video.

Video loads only after a click, remains muted, and stops after eight seconds,
on navigation or when the tab is hidden. Reduced-motion users get artwork and
navigation without the animated preview. The master audio is not edited or
front-loaded; this is a separate promotional surface, not a new render.

Playlists are deterministic editorial groupings of published, publicly visible
releases using catalog genre metadata. Cinematic nights, Electronic energy,
Soul & reflection and Uplifting signals do not infer moods from audio.
Empty themes are explicitly shown as empty. Available direct audio plays
back-to-back in the existing music player, with no crossfade, new audio element,
or automatic start. Chart and discovery queues relinquish continuation to each
other; discovery stops at the end and offers another playlist or the Hub.

## Feedback

The existing stats endpoint accepts `video_discovery_preview`,
`video_discovery_navigation`, `video_discovery_playlist_start` and
`video_discovery_continuation`. Metadata contains release ID, surface,
destination and playlist variant—not audio or video URLs. These are interaction
signals, not proof of listening duration, completed streams, or improvement.
The component respects Do Not Track and Global Privacy Control; existing
optional listening reports remain separate and unchanged.

Use stored activity in the existing analytics ledger to compare previews with
Dreamweaver/playlist navigation and manual starts with continuation requests
over equal time windows. A missing event is unknown, not a listener rejection.
Review the optional listening reports, when available and consented, separately
for listening outcomes. A maintainer can adjust featured release configuration,
genre metadata or artwork after reviewing evidence; the panel does not silently
rewrite those choices or claim that recommendations improved.

Run `npm run test:video-discovery`. A successful merge is not evidence of a
successful Netlify deployment or production playback; confirm the deployed
panel and media separately.
