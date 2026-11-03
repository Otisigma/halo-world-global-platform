# Album Concierge workspace

The obsidian-and-gold showcase fills the initial workspace before a guided
concept session starts. It reads the existing public `/api/release-catalog`,
shows up to four published releases, and offers a selector for the remaining
catalog entries. Cards display persisted titles, artists, descriptions and
eligible public artwork. No chart rank or real-time synchronization is implied.

The curator preview archive is separate from real releases and private saved
sessions. Two fictional examples (Midnight Resonance LP and Quiet Heart Sessions)
open complete layouts with local CSS cover sketches, illustrative ordered
tracklists, planned durations, artwork direction and liner notes. Midnight opens
initially; Load Layout switches the example and moves keyboard focus to its title.
These examples make no network requests, play no audio, write no storage and
never populate or overwrite the guided form. They are not released recordings,
licensed assets, saved sessions or goods for sale. No sign-in is required.

Preview is user-triggered and uses a single native audio player. Only static
public audio passing the existing satellite media validator is accepted; private
stems, signed masters and API asset URLs are excluded. Releases without eligible
audio retain a genuine public shop link for listening, artwork and purchase
options. No synthetic fallback audio or alert-only buttons are used.

The signed-in concept vault reads `/api/album-concierge`, which enforces ownership.
It shows up to four recent sessions. Ready sessions link to the existing saved
concept flow; draft/generating/failed sessions are clearly labeled, not presented
as playable recordings. Account changes clear old content and ignore late
responses. The showcase never changes catalog entries, concepts, reward balances,
payments or licenses. The existing guided creation/save flow remains unchanged;
step navigation scrolls to the form rather than back above the new showcase.

Loading, empty, unavailable and signed-out states are explicit. Refresh retries
catalog and vault independently. Playback stops on selection, refresh, account
change or page exit. Public external artwork/audio hosts may receive visitor IPs,
as disclosed in the page; no playback telemetry or rewards are sent by this module.

Run `npm run test:concierge-showcase` and
`node scripts/album-concierge-contracts.mjs` for focused regression checks.
No migrations or new environment variables are required. Production catalog data,
Identity and media availability must be checked in deployment before rollout.
