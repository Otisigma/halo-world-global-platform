# Obsidian Gateway: first rollout

`/obsidian/` provides a public obsidian-and-gold landing page backed by the
existing `/api/release-catalog` published release feed. `/obsidian/?song=<id>`
selects a matching public release, allowing the owner to share a direct link.
An unknown or no-longer-public ID is reported as unavailable instead of silently
playing another release. The API returns at most 200 releases.

The page reuses the site's release artwork/audio resolver, selects playable
preview or stream URLs, and uses the browser's native audio controls. Previous,
next and playlist selections do not autoplay. The opt-in loop repeats the
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
it is not uploaded, synced, or shareable between devices. Queueing a mix selects
its first playable release but does not autoplay. Next, previous, buffering, and
end-of-track continuation stay within the queued playlist.

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
