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

## Artist video direction

The successful recovery player proves that Halo can present video inside the station experience. The strongest next iteration is to add an approved `videoUrl` or YouTube video identifier to eligible rotation tracks, then synchronize the visible player with now-playing metadata. That feature should preserve the same rules established here: rights approval, one active audio source, a reliable audio-only fallback, explicit content status, and health telemetry when video loading fails.
