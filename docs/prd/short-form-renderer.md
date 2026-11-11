# HALO short-form teaser renderer

The local batch renderer turns audio assets already on the operator's machine
into vertical H.264/AAC MP4 files. It does not fetch catalog masters, edit
shared storage, call a social API or publish anything. Use audio and artwork
you control and have permission to publish.

## Requirements

- Node.js and the `ffmpeg` / `ffprobe` executables on `PATH`.
- A flat input folder containing WAV, MP3, M4A, AAC or FLAC audio files.
- A looping visual background video.
- A JSON cut manifest with one editorially selected `startSeconds` for every
  audio file. The renderer does not guess the hook or claim to identify a
  high-retention moment.

Example `cuts.json`:

```json
{
  "Black Book.wav": { "startSeconds": 43.5 },
  "Beautiful Liar.mp3": { "startSeconds": 61 }
}
```

Render the selected 20-second clips:

```sh
npm run render:teasers -- \
  --input ./masters \
  --background ./assets/obsidian-background.mp4 \
  --output ./teaser-output \
  --manifest ./cuts.json \
  --duration 20
```

The duration defaults to 20 seconds and is capped at 60. Each source is probed
to verify the selected range exists. Outputs are 1080 x 1920, H.264/AAC, and
are probed again before the script reports success. Existing files are never
overwritten (`ffmpeg -n`); choose a new output directory to rerender. Failed
items stop the batch with an error. Inspect and approve each output before
uploading to a platform. No automatic social publishing or A/B testing exists.

## Playlist curation

`youtube-playlist-plan.json` maps the supplied exact-title Shorts for Beautiful
Liar, Reciprocity, and Read The Room to proposed public playlists. The supplied
Black Book and Quiet Heart IDs are full-length releases, so they are recorded
as related sources rather than mislabeled as Shorts; related full-length
Beautiful Liar and Reciprocity releases are also cross-referenced. These IDs
and durations came from the channel owner's list and still need a final
publication/suitability check in YouTube Studio. No YouTube Studio playlist
changes were made: no write-authorized YouTube OAuth connection is configured
here, so the file is a reviewable mapping, not proof playlists were created.
