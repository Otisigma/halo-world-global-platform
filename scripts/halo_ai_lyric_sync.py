#!/usr/bin/env python3
"""Generate reviewable, catalog-ready lyric timing from a local recording."""

import argparse
import json
import math
import os
import re
import shutil
import sys
import tempfile
import unicodedata
from pathlib import Path

MAX_SOURCE = 16000
MAX_LINES = 400
MAX_TEXT = 240
MAX_INSIGHT = 480
MAX_SECONDS = 86400
SECTION = re.compile(r"^\[([^\]\d:][^\]]{0,60})\]$")
LEADING_TAG = re.compile(r"^\[[^\]\n]{1,24}\]")
CONTROLS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]")


def catalog_length(text):
    return len(text.encode("utf-16-le")) // 2


def parse_lyrics(raw):
    if CONTROLS.search(raw):
        raise ValueError("Lyrics contain control characters; remove them before alignment.")
    records = []
    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line:
            records.append(("blank", "", ""))
            continue
        if SECTION.fullmatch(line):
            records.append(("section", line, ""))
            continue
        if LEADING_TAG.match(line):
            raise ValueError("Input must be untimed lyrics; remove existing timestamp or metadata tags.")
        text, separator, insight = line.partition("||")
        text, insight = " ".join(text.split()), " ".join(insight.split())
        if not text or catalog_length(text) > MAX_TEXT or catalog_length(insight) > MAX_INSIGHT:
            raise ValueError("A lyric or insight is empty or exceeds the catalog length limit.")
        records.append(("lyric", text, insight if separator else ""))
    lyrics = [text for kind, text, _ in records if kind == "lyric"]
    if not lyrics:
        raise ValueError("No lyric lines found; instrumentals require no alignment.")
    if len(records) > MAX_LINES or catalog_length(raw) > MAX_SOURCE:
        raise ValueError("Lyrics exceed the catalog's line or text limit.")
    return records, lyrics


def comparable(text):
    return " ".join(unicodedata.normalize("NFC", text).split()).casefold()


def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    minutes, remainder = divmod(milliseconds, 60000)
    whole_seconds, fraction = divmod(remainder, 1000)
    if minutes > 999:
        hours, minutes = divmod(minutes, 60)
        return f"[{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{fraction:03d}]"
    return f"[{minutes:02d}:{whole_seconds:02d}.{fraction:03d}]"


def build_payload(records, lyrics, result, model_name, language):
    segments = getattr(result, "segments", None)
    if segments is None or len(segments) != len(lyrics):
        raise ValueError("Alignment did not return one segment per lyric line; no output was written.")
    aligned = []
    previous_start = -1
    for original, segment in zip(lyrics, segments):
        segment_text = getattr(segment, "text", "")
        if not isinstance(segment_text, str) or comparable(segment_text) != comparable(original):
            raise ValueError("Alignment changed or reordered lyric lines; no output was written.")
        start, end = getattr(segment, "start", None), getattr(segment, "end", None)
        if (not isinstance(start, (int, float)) or not isinstance(end, (int, float))
                or not math.isfinite(start) or not math.isfinite(end)
                or start < 0 or end <= start or end > MAX_SECONDS or start <= previous_start):
            raise ValueError("Alignment returned invalid, zero-length, or non-increasing timings; no output was written.")
        start, end = round(start, 3), round(end, 3)
        if start <= previous_start or end <= start:
            raise ValueError("Alignment timings collide at millisecond precision; no output was written.")
        previous_start = start
        aligned.append({"time": start, "end": end, "text": original})
    rendered = []
    index = 0
    for kind, text, insight in records:
        if kind == "lyric":
            line = f"{timestamp(aligned[index]['time'])} {text}"
            if insight:
                line += f" || {insight}"
            rendered.append(line)
            index += 1
        else:
            rendered.append(text)
    catalog_text = "\n".join(rendered).strip()
    if catalog_length(catalog_text) > MAX_SOURCE:
        raise ValueError("Timestamped output exceeds the catalog's 16,000-character limit.")
    return {
        "alignment_engine": "stable-ts",
        "model": model_name,
        "language": language,
        "review_required": True,
        "lyrics": aligned,
        "lyricsText": catalog_text,
    }


def write_new_output(path, payload):
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".halo-lyrics-", delete=False) as output:
            temp_path = Path(output.name)
            json.dump(payload, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.link(temp_path, path)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True, help="Local master audio file")
    parser.add_argument("--lyrics", type=Path, required=True, help="UTF-8 untimed lyrics, one line per lyric")
    parser.add_argument("--output", type=Path, required=True, help="New JSON output file; never overwritten")
    parser.add_argument("--model", default="base", help="Whisper model name (default: base)")
    parser.add_argument("--language", default="en", help="Language code of the provided lyrics (default: en)")
    args = parser.parse_args(argv)
    try:
        if not args.audio.is_file() or not args.lyrics.is_file():
            raise ValueError("Audio and lyrics must be existing local files.")
        if args.output.exists() or args.output.is_symlink():
            raise ValueError("Output already exists; choose a new path.")
        if not shutil.which("ffmpeg"):
            raise RuntimeError("FFmpeg was not found on PATH; install it before running alignment.")
        records, lyrics = parse_lyrics(args.lyrics.read_text(encoding="utf-8-sig"))
        try:
            import stable_whisper
        except ImportError as error:
            raise RuntimeError("stable-ts or a dependency could not be imported; install with: python -m pip install stable-ts") from error
        print("Loading the alignment model; first use may download model weights.", file=sys.stderr)
        model = stable_whisper.load_model(args.model)
        result = model.align(str(args.audio), "\n".join(lyrics), language=args.language,
                             original_split=True, regroup=False, verbose=None)
        payload = build_payload(records, lyrics, result, args.model, args.language)
        write_new_output(args.output, payload)
        print(f"Created {args.output}. Review the timestamps before copying lyricsText into Song Catalog.")
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Alignment failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
