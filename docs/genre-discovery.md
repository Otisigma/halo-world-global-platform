# Artist and genre discovery

`/discover/` is the public release discovery page and the Music navigation includes
a direct link to it. It reads `/api/release-catalog`, showing only approved
`passed`/`published` releases that are publicly visible. Release titles, artists,
stories, optional credits, BPM and years come from available catalog fields; the
page does not invent artist biographies, dates, credits, or recording claims.

The four equal primary gateways are Electronic & Deep House, Afrobeats & Global
Sounds, Ambient & Experimental, and Rock & Alternative. Matching uses genre
metadata, including `catalog.genre` where the release has no genre array. A
release can appear in more than one gateway when its supplied genres match.
Deep House and Afro House are routed to Electronic & Deep House; Afrobeats,
Amapiano and global rhythm tags are routed to Afrobeats & Global Sounds.
Supplemental Hip-Hop/Rap, R&B/Soul, and Gospel/Inspirational rooms remain in
“More genre rooms.” BPM is descriptive metadata; it never invents or changes a
genre classification.

Each card allows explicit preview playback when the existing release-artwork
resolver finds an approved playable source, or opens the normal release page.
“Add to Mix” returns to the Music catalog and opens its existing browser-local
playlist picker. No release is auto-played or saved.

The Living Chart uses the same primary gateway IDs and retains a direct shortcut
to the full public catalog. Its Afrobeats room tooltip says that rankings use
recent seven-day activity and directs listeners to the catalog for electronic,
deep-house, ambient and other work. Existing specialist chart rooms remain
available. Activity rankings continue to distinguish recorded clicks and
release-room opens from industry sales or verified streams.

The main HALO menu and both Music headers link directly to `#living-chart`.
Decorative chart bars in the main menu are not activity data and animate only
when reduced motion is not requested.

The separate `/global-chart/` preview provides the public chart snapshot,
including listed artist and track tables, available metrics, and JSON/CSV
exports. It shows at most 50 returned chart-eligible HALO releases, not global
DSP charts or all artists worldwide. Its votes and nominations are preview-only
and never submitted. Missing data remains labelled as not reported.

The Signal Orbit on a selected chart release compares the last seven days with
the preceding seven using reported listen exits and release-room opens, weighted
8 and 3 respectively. Ring lengths are relative to the larger period, not a
timeline or live listener count; orbit animation is decorative and respects
reduced motion. Releases without recorded activity do not get invented values.
