# Dreamweaver mix requests

Dreamweaver can curate a 20- or 60-minute set from the published Google Drive catalog (`catalog-index.json`, served by `/api/drive-catalog`) based on a plain-language request.

> **Curated sequence, not a rendered DJ mix.** Dreamweaver chooses and orders catalog tracks, then plays them one after another through the existing allowlisted stream/proxy URLs. It doesn't render an audio file, time-stretch, beatmatch, or crossfade. Tracks are kept within ±8 BPM of each other and the energy only stays level or rises, but each transition is a straight cut to the next track.

## Request a mix

1. Open **Dreamweaver** (`/dreamweaver/`).
2. Type a request in **Mix request**, for example:
   > Create a 20-minute Halo X mix: warm, cinematic opening; deep-house build; finish with a big lifter. Avoid tracks from last week.
3. Optionally pick a **HALO profile preset**. Your request text is applied on top of the preset.
4. Choose **20 minutes** or **60 minutes**. If the request includes "20 minutes", "60 minutes" or "1 hour", that setting updates the selector.
5. Select **Generate & play set**. The progress steps follow request parsing, canonical catalog availability, track ranking and sequence preparation, without simulated delays. An unavailable catalog or empty result leaves the remaining work incomplete. Completed steps mean a sequence was prepared, not that live streams were verified. Before playback starts, Dreamweaver lists the generated tracks and shows a summary of how it read your request. It also lists any parts of the request it didn't understand.

The catalog badge reports **loading**, **standby** (unconfigured or a linked item hasn't requested the catalog yet), **empty**, or **unavailable** as appropriate. **Catalog synced** means the canonical response was successfully loaded with tracks; it doesn't guarantee that every stream is currently playable. Loading failures never substitute another catalog. On a linked song/mix route, generating a playable set explicitly switches playback to the curator; a failed or empty result leaves the linked item in place.

Each setlist row includes its slot, title, artist, BPM, energy role and scheduled duration. **Play stream** starts that slot through the existing player and continues the sequence, using the allowlisted proxy fallback when available. No raw Drive URLs or preview iframes are used.

### What the request understands

The parser is local and rule-based (`lib/mix-intent.js`). No request text, catalog data or audio is sent to an external AI service. It recognizes:

| Part | Examples | Effect |
| --- | --- | --- |
| Duration | `20-minute`, `60 minutes`, `1 hour` | Selects 20 or 60 minutes. Other lengths are reported and ignored. |
| Profile | `Halo X`, `DJ Halo`, `DJ Butterfly`, `DJ Romy`, saved preset names | Applies that HALO profile or your saved preset. |
| Moods | warm, cinematic, dreamy, dark, uplifting, euphoric, chill, emotional, soulful, melodic, groovy, romantic, sunset, late night | Prefers tracks whose `genre` or `tags` contain these words. |
| Genres | deep house, tech house, afro house, melodic/progressive/organic house, house, melodic techno, techno, trance, disco, nu-disco, amapiano, soul, r&b, pop, hip hop, drum and bass, ambient, downtempo, garage, electronica, edm | Prefers matching tracks. |
| Energy arc | `warm opening`, `deep house build`, `finish with a big lifter`, `anthemic peak`, `high energy`, `chill` | Sets the target energy for the opening, build, peak and closing sections. |
| Tempo | `124 bpm` (±4), `120-126 bpm` | Gives a preference to tracks in that BPM range. |
| Rotation | `avoid tracks from last week`, `skip anything played last month`, `allow repeats`, `fresh tracks` | Sets a recent-play window of 1, 7 or 30 days. Recently played tracks are reused only if you allow it. You can also prefer tracks marked as fresh. |
| Avoid | `no vocals`, `avoid techno` | Excludes tracks whose title, artist, genre or tags contain that term. |

Unsupported requests aren't guessed. Dreamweaver ignores them and reports them under the summary. For example, it reports "with a saxophone solo", 45-minute sets, and cool-down endings.

Names such as **Halo X** or **DJ Butterfly** refer to HALO profiles: house-defined genre, mood, BPM and energy settings for HALO's own DJ personas. Dreamweaver doesn't imitate or clone any artist.

### Variation and replaying a set

Each **Generate & play set** creates a new random **variation code**, shown in the summary, so the same request can produce different sets. To replay a set, enter its code in **Variation code**. Dreamweaver produces the same set when the catalog, request, code and listening history are unchanged. Variation only changes which of the similarly well-matched tracks are chosen and in what order. It never adds duplicates, ignores the BPM or energy rules, or pads a short set.

If the eligible catalog can't fill the selected duration, Dreamweaver shows **Short by mm:ss** instead of claiming a full set. To fill the gap, add tracks to `catalog-index.json` or allow recent tracks to be reused.

A track counts as played only after its audio actually starts. Generating or loading a set doesn't update the history.

## Presets

### HALO presets (code)

Built-in presets are defined in `MIX_PRESETS` in `lib/mix-intent.js`. Each preset has an `id`, `label`, `aliases`, `description`, and settings for `moods`, `genres`, `bpmRange` and `arc` (energy levels 1–4 for `opening`, `build`, `peak` and `closing`; the levels can't go down), plus `preferFresh`. Use only words from `MOOD_VOCABULARY` or `GENRE_VOCABULARY` in a preset. To add or change a preset, edit that list, open a pull request and run `node scripts/mix-intent-contracts.mjs`.

Two dashboard profiles are HALO-defined settings, not third-party artist imitations:

| Profile | Genre / mood | BPM | Opening → build → peak → closing |
| --- | --- | --- | --- |
| The French Connection (Deep / Hypnotic) | Deep / melodic house; hypnotic, groovy, late night | 118–124 | 1 → 2 → 2 → 3 |
| Halo X Club Anthem Sprint | House, tech house, afro house; uplifting, euphoric; prefer fresh | 124–132 | 2 → 3 → 4 → 4 |

### Your presets (browser)

Open **Save this request as my preset**, enter a name and select **Save preset**. Saving another request under the same name updates that preset. To delete a saved preset, select it and choose **Delete selected preset**. Saved presets are request text stored in this browser (`localStorage` key `halo:dreamweaver-mix-presets`, maximum 12). They can't contain markup and can't use the name of a HALO preset. To use a preset, choose it from **HALO profile preset** or mention its name in a request.

## Catalog metadata that improves results

In `catalog-index.json`, the optional `genre` and `tags` fields give Dreamweaver words to match against requests. `tags` can contain up to 12 short words, such as `["warm", "cinematic"]`. Dreamweaver still uses only tracks marked `public: true` with valid BPM, duration, energy and rotation metadata. A request can't make private tracks eligible.

## Tests

```sh
npm run -s test:drive-catalog   # curator, mix-intent, Drive catalog and Dreamweaver player contracts
```

Manual smoke test still required against the deployed Drive catalog: test desktop and mobile playback, per-slot playback and advancement, blocked streams and proxy/local-upload fallback, keyboard controls and screen-reader announcements. Local contracts cannot verify real device autoplay policies or live Drive availability.
