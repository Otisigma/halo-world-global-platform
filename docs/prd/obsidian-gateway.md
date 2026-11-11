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

No sample song names, generic DistroKid destination, copied lyric, fabricated
visualization, or external payment checkout is used. Artist destinations come
from the published release record and are validated as safe HTTP(S) links.
The gateway does not add cryptographic tokens, identity or ownership claims,
new signing keys, short-form generation, third-party publishing, A/B tests,
synchronized lyrics, tipping, audio crossfade or cross-site continuous audio.
The existing release teaser readiness feature does not currently deploy a
video renderer. These features require independent implementation, rights
review and, where applicable, platform API and provider access. Never reuse
master-provenance private keys for fan tokens.

Deployment on Netlify follows the repository's normal build/deploy process;
domain routing and real production playback must be verified by the operator.
No new environment variables are required by the gateway.
