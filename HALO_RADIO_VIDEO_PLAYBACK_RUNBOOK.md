# Halo Radio audio and visible video recovery

## Outcome

On August 11, 2026, Halo Radio reached a stable recovery design that can keep the station useful while an external stream is unavailable. A listener can see and hear the looping Halo YouTube artist playlist inside the station interface, while approved creator tracks and full-length mixes remain available as separate rotation paths. This also demonstrates the product direction for pairing an artist's video with their record while that artist is featured in rotation.

The current visible player uses the Halo artist playlist at `PLcmaoB9ss1YE`, advances through its videos, and loops back to the start so music can continue while the catalog grows. Per-track artist video synchronization with the database-backed station rotation is a logical next feature, but it is not yet automatically driven by the now-playing track.

## What was changed

1. Removed generated oscillator tones from public listening paths after they produced an unusable high-pitched sound instead of music.
2. Expanded Long Play loading so the full available mix catalog is requested, duration and progress are shown, and the queue advances when a mix ends.
3. Added approved-track AutoDJ behavior so rooms without a live stream can play creator tracks already approved for rotation.
4. Replaced the hidden or audio-only emergency behavior with a visible, looping YouTube artist-playlist player controlled through the YouTube IFrame API.
5. Made station audio and YouTube recovery playback mutually exclusive. Starting one pauses the other, preventing overlapping sources and reducing the risk of noise or confusing playback state.
6. Normalized AzuraCast now-playing responses so Halo accepts both a single station object and the station-list array returned by some installations.
7. Changed AzuraCast stream selection to prefer its default public HTTPS HLS URL over internal or insecure mount URLs such as `localhost`.
8. Added radio contract coverage for the recovery mix, public HLS selection, station response normalization, Long Play behavior, health checks, and background station agents.

## Playback paths

Halo Radio now treats each playback source as a distinct path:

- **Verified station stream:** A direct public HTTPS stream or an AzuraCast stream that passes station health checks.
- **Approved creator rotation:** Browser audio sourced from tracks approved for `rotation` when a room has no external stream.
- **Long Play:** Full-length mixes from the Halo mix catalog, with visible queue and progress behavior.
- **Visible recovery video:** The looping Halo YouTube artist playlist used when the normal station path is unavailable.

Only one audible path should be active at a time. The video may remain visible as presentation, but its player must be paused whenever browser audio is the active source.

## Fast diagnosis

When the station is silent, squeals, stalls, or reports a false live signal, check these items in order:

1. Open `/api/radio/health` and identify whether the station API, timing, data, or a specific room is failing.
2. Open `/api/radio/stations` and verify that configured stream URLs are public and use HTTPS.
3. If AzuraCast returns an array, confirm the configured station short name selects the intended station.
4. If AzuraCast exposes both mount and HLS URLs, confirm the default public HLS URL is selected instead of a `localhost` mount.
5. Search the browser code for `createOscillator`; generated tones must not be used as a music fallback.
6. Confirm `playFallbackMix` pauses `stationAudio` before starting YouTube playback.
7. Confirm station and Long Play actions pause the YouTube player before browser audio starts.
8. For Long Play stalls, verify the catalog request, audio content headers, duration metadata, progress updates, and `ended` queue advancement.

## Verification

- Run `node scripts/radio-contracts.mjs`.
- Verify `/api/radio/stations` returns the intended public stream and now-playing metadata.
- Verify `/api/radio/health` reports healthy timing, data, and reachable configured rooms.
- Test play, pause, recovery video, room switching, Long Play progress, and automatic advancement.
- Repeat the player test on desktop and mobile because browser autoplay and media policies differ.
- Confirm the visible recovery player pauses when a normal station, approved track, or Long Play source begins.

## Selected-track loading and responsiveness diagnostics

The chart/shop (`music/audioPreloader.js`) and Dreamweaver (`audio-preloader.js`)
use HTML media, not React or decoded Web Audio buffers. Only the selected
same-origin `/audio/` file without query parameters is eligible for speculative
metadata loading. No other queue or fallback sources are warmed. Signed URLs,
external hosts, private paths and catalog API URLs remain play-on-demand using
their existing authorization and publication gates. Selection never calls play.
Save-Data, offline/hidden pages, slow connections, low-memory/low-core devices,
and touch devices without connection information disable speculative loading.
Explicit play retains browser gesture requirements and existing fallback paths.

Contract baseline before this change: the chart helper constructed seven
secondary Audio elements for an eight-source queue, retained four, and did not
reuse them for playback. Dreamweaver retained five secondary elements plus the
selected player. Both used `preload=auto` for the first source. Contracts now
verify zero secondary elements/requests, metadata-only selected loading and
same-source reuse. This verifies resource bounds, **not** a latency reduction
in milliseconds. Metadata is a browser hint, not a byte limit: container layout
and browser behavior can still cause extra reads.

No immutable audio manifest or fingerprinted public audio deployment is present,
so no long-lived immutable header is introduced. Mutable Drive audio stays
`no-store`; catalog master streams and signed redirects stay `private, no-store`.
Keep GET/HEAD, `audio/*` content types, `Accept-Ranges`, 206 `Content-Range`, and
416 behavior intact. Do not copy a private/signed URL into public Cache Storage.
The registered `/sw.js` handles navigations only. The experimental
`/public/sw.js` is not registered by the app and must not be enabled: its
extension-based caching lacks access eligibility and range-safe replay.
HTTP/browser caching under the origin's existing policies is the supported
media strategy; offline navigation does not imply offline audio availability.

Reproduce on the same published release before/after deployment:

1. In DevTools Network, retain the log and filter Media. Compare cold-cache and
   warm-cache runs separately; record browser/device, connection throttling,
   Save-Data, visibility, URL source class, and worker registrations.
2. Before pressing play, verify at most selected metadata traffic; never a queue
   sweep. On constrained devices verify no speculative media request. Inspect
   actual transferred bytes, since `preload=metadata` is advisory.
3. On `/music/`, attach local-only timing diagnostics in the console:

   ```js
   const audio = window.HaloPlayer.audio;
   let start, waiting, stalls = 0, stallMs = 0;
   audio.addEventListener("play", () => { start = performance.now(); stalls = 0; stallMs = 0; });
   audio.addEventListener("waiting", () => { waiting ??= performance.now(); stalls++; });
   audio.addEventListener("playing", () => {
     if (waiting !== undefined) { stallMs += performance.now() - waiting; waiting = undefined; }
     console.table({ playToPlayingMs: performance.now() - start, stalls, stallMs });
   });
   ```

   For Dreamweaver use `document.querySelector("#showAudio")`; for the older
   storefront use `document.querySelector("#musicWorldAudio")`. Measure click to
   first `playing` separately with a Performance recording (the snippet starts
   at the media `play` event). Run at least ten cold/warm trials and compare
   medians and p95, transferred bytes, TTFB, range requests and rebuffer time.
   Local diagnostics send nothing and do not alter optional listening telemetry.
4. Verify pause/resume, seeking, rapid track changes, denied autoplay, failed
   media, and canonical/local-upload fallback. Repeat with analytics off, DNT/GPC,
   and then explicit opt-in; metadata must never count as a listen.
5. Inspect a real approved stream's GET and HEAD response headers and a
   `Range: bytes=0-1023` request. Verify 206, exact Content-Range/length, audio MIME
   type and appropriate cache policy. Do not share signed query strings or
   credentials in diagnostics. CDN TTFB, redirects, authorization/storage latency
   and mobile container metadata placement require production measurement.

Validation: `npm run test:audio-preloader`,
`node scripts/music-featured-player-contracts.mjs`,
`node scripts/dreamweaver-assets-contracts.mjs`,
`npm run test:drive-catalog`, `npm run test:listening-telemetry`,
`npm test`, and `npm run build`.
No zero-latency or commercial-platform-parity claim is supported.

## Artist video direction

The successful recovery player proves that Halo can present video inside the station experience. The strongest next iteration is to add an approved `videoUrl` or YouTube video identifier to eligible rotation tracks, then synchronize the visible player with now-playing metadata. That feature should preserve the same rules established here: rights approval, one active audio source, a reliable audio-only fallback, explicit content status, and health telemetry when video loading fails.
