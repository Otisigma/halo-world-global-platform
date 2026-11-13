# Obsidian Gateway: first rollout

`/obsidian/` provides a public obsidian-and-gold landing page backed by the
existing `/api/release-catalog` published release feed. `/obsidian/?song=<id>`
selects a matching public release, allowing the owner to share a direct link.
An unknown or no-longer-public ID is reported as unavailable instead of silently
playing another release. The API returns at most 200 releases.

Shared gateway links have OpenGraph and Twitter card metadata. A Netlify edge
function uses the same public catalog and visibility rules to supply a release
title, artist, and, when available, a direct HTTPS JPEG or PNG cover, with a
branded 1200×630 PNG fallback. Unknown releases or catalog failures use the
generic card; catalog errors are logged. The HTML and player are the same for
visitors and scrapers. Only `song` and a valid `t` moment are included in the
canonical share URL. Cards are static: external services control their previews,
supported image formats, cropping, and cache refresh. Existing shortened links
and their previews are controlled by their redirect and social provider.

The gateway has a CSS-only entrance and ambient glow that respect reduced-motion
preferences; these are decorative, not Dreamweaver-generated or audio-reactive.
The link does not start audio, change volume, or force preloading. Playback
remains under the listener's control, and the page remains usable without the
edge function through its default metadata.

The page reuses the site's release artwork/audio resolver, selects playable
preview or stream URLs, and uses the browser's native audio controls. Previous,
next and release selections do not start playback automatically; the explicit
Play mix action starts its selected audio. The opt-in loop repeats the
selected audio file; it does not generate a short clip. Some Drive share links and
external stream pages are not direct playable audio: the page offers the
existing release/artist-approved link instead. Normal playback errors and
catalog loading failures are shown, with retry for catalog failures.
Optional existing authenticated listening reports respect the user's consent.
The motion indicator is deliberately labelled as playback-state animation, not
a frequency analyser, and respects reduced-motion preferences.
Lyrics already supplied by the published catalog are shown as plain text.
Timestamped lines follow the current audio time; untimed lines remain readable
without implying synchronization. No lyric text or timestamps are invented.

Listeners can create playlists in the Obsidian Gateway, add or remove public
catalog releases, and queue a mix through the existing player. Playlist data
contains release IDs only and is stored in the listener's browser local storage;
it is not uploaded, synced, or shareable between devices. Play mix selects
and starts its first playable release on the listener's click. Next, previous, buffering, and
end-of-track continuation stay within the queued playlist.

Playlist creation validates names inline, including an empty-name submit.
The chosen playlist survives changing releases, and a newly created playlist
is selected for adding songs. Action feedback appears beside the player and
in the playlist section. Play mix scrolls to and focuses the audio controls,
and reports playback failures so the listener can retry. Room mix playlists on the main page are a separate
authenticated service; their buttons show saving, success, or error feedback
beside each mix and ignore duplicate clicks while a save is pending.

No sample song names, generic DistroKid destination, copied lyric, fabricated
visualization, or external payment checkout is used. Artist destinations come
from the published release record and are validated as safe HTTP(S) links.
The gateway does not add cryptographic tokens, identity or ownership claims,
new signing keys, short-form generation, third-party publishing, A/B tests,
tipping, audio crossfade or cross-site continuous audio.
The existing release teaser readiness feature does not currently deploy a
video renderer. These features require independent implementation, rights
review and, where applicable, platform API and provider access. Never reuse
master-provenance private keys for fan tokens.

Deployment on Netlify follows the repository's normal build/deploy process;
domain routing and real production playback must be verified by the operator.
No new environment variables are required by the gateway.
