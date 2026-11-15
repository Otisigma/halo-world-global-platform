# Offline lyric alignment

The optional alignment tool proposes timestamps for lyrics you already have.
It processes a local recording on your computer, not in the live player.
Singing, backing vocals, long instrumental passages and incorrect lyric text can
produce inaccurate timings. **Listen to the result and correct it before
publishing**; the tool cannot guarantee millisecond accuracy.

Use only recordings and lyrics you have permission to process. Nothing is
uploaded by this script, but the first run may download public model weights.
`stable-ts` and PyTorch are third-party tools; stable-ts development is paused.

## Setup

Install Python 3, FFmpeg on your PATH, and a suitable PyTorch installation for
your computer. In a virtual environment, install stable-ts:

```sh
python3 -m venv .venv-lyric-sync
source .venv-lyric-sync/bin/activate
python -m pip install stable-ts
```

On macOS, FFmpeg can be installed with `brew install ffmpeg`. For GPU support,
follow the PyTorch installation instructions for your device. The model download
and inference can require substantial disk space and processing time.

## Generate and review

Create a UTF-8 lyric file with one sung line per line. Repeat choruses wherever
they are sung; optional `[Verse]` headings and `||` Oracle notes are preserved
but not passed to the aligner. Do not supply existing timestamps.

```sh
python scripts/halo_ai_lyric_sync.py \
  --audio /path/to/master.wav \
  --lyrics /path/to/lyrics.txt \
  --output /path/to/review-lyrics.json \
  --language en \
  --model base
```

The output must not already exist. Its `lyrics` array contains proposed start
and end times; its `lyricsText` string is the timestamped format used by HALO's
Song Catalog. Review the audio and all proposed lines, then copy `lyricsText`
into that song's **Timestamped lyrics · Dreamweaver** field and save using the
normal catalog workflow. The tool does not write to the catalog, upload the
audio, publish a release or make the JSON itself available to the player.

To display the catalog-ready text with actual line breaks for copying:

```sh
python -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["lyricsText"])' /path/to/review-lyrics.json
```

The aligner rejects missing, reordered, changed, zero-length or invalid segment
timings instead of writing a partial result. Such checks do not prove accuracy.
If alignment fails, check the text and recording, adjust the model or language,
and try a new output path. Instrumentals without lyric text need no alignment;
the player does not invent lyrics for them.

To run the offline contract tests without installing a model:

```sh
python3 scripts/halo_ai_lyric_sync_test.py
```
