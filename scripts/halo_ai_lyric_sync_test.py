import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("halo_ai_lyric_sync.py")
SPEC = importlib.util.spec_from_file_location("halo_ai_lyric_sync", SCRIPT)
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class AlignmentTests(unittest.TestCase):
    def setUp(self):
        self.records, self.lyrics = sync.parse_lyrics("[Verse]\nFirst line || Note\n\nSecond line")

    def result(self, *segments):
        return SimpleNamespace(segments=[SimpleNamespace(text=t, start=s, end=e) for t, s, e in segments])

    def test_catalog_text_and_structure(self):
        payload = sync.build_payload(self.records, self.lyrics, self.result(
            (" First line", 14.2, 18.5), (" Second line", 19.1, 24.0)
        ), "base", "en")
        self.assertEqual(payload["lyricsText"], "[Verse]\n[00:14.200] First line || Note\n\n[00:19.100] Second line")
        self.assertEqual(payload["lyrics"][0], {"time": 14.2, "end": 18.5, "text": "First line"})
        self.assertTrue(payload["review_required"])

    def test_invalid_results_never_become_timestamps(self):
        for result in [
            None,
            self.result(("First line", 0, 1)),
            self.result(("Changed", 0, 1), ("Second line", 2, 3)),
            self.result(("First line", 0, 0), ("Second line", 2, 3)),
            self.result(("First line", 2, 3), ("Second line", 1, 4)),
            self.result(("First line", 0, float("nan")), ("Second line", 1, 2)),
            self.result(("First line", 0.0001, 0.0002), ("Second line", 1, 2)),
        ]:
            with self.subTest(result=result), self.assertRaises(ValueError):
                sync.build_payload(self.records, self.lyrics, result, "base", "en")

    def test_invalid_input_and_timestamp_formats(self):
        for value in ["", "[Chorus]", "[00:12] Timed", "A\x00B", "x" * 241, "😀" * 121]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                sync.parse_lyrics(value)
        self.assertEqual(sync.timestamp(60000.123), "[16:40:00.123]")
        self.assertEqual(sync.timestamp(59.9998), "[01:00.000]")

    def test_write_failures_leave_no_partial_or_overwritten_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "lyrics.json"
            with patch.object(sync.json, "dump", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    sync.write_new_output(output, {"lyrics": []})
            self.assertEqual(list(root.iterdir()), [])
            output.write_text("existing", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                sync.write_new_output(output, {"lyrics": []})
            self.assertEqual(output.read_text(encoding="utf-8"), "existing")
            self.assertEqual([path.name for path in root.iterdir()], ["lyrics.json"])

    def test_cli_with_mocked_model_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "audio.wav").write_bytes(b"fixture")
            (root / "lyrics.txt").write_text("[Verse]\nFirst line || Note\nSecond line", encoding="utf-8")
            (root / "stable_whisper.py").write_text(
                "from types import SimpleNamespace as S\n"
                "def load_model(name):\n"
                " class Model:\n"
                "  def align(self,audio,text,language,original_split,regroup,verbose):\n"
                "   assert text == 'First line\\nSecond line' and original_split and not regroup\n"
                "   return S(segments=[S(text='First line',start=1.2,end=2),S(text='Second line',start=3,end=4)])\n"
                " return Model()\n", encoding="utf-8")
            output = root / "out.json"
            command = [sys.executable, str(SCRIPT), "--audio", str(root / "audio.wav"),
                       "--lyrics", str(root / "lyrics.txt"), "--output", str(output)]
            env = dict(os.environ, PYTHONPATH=str(root))
            first = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["lyricsText"], "[Verse]\n[00:01.200] First line || Note\n[00:03.000] Second line")
            parser = SCRIPT.parent.parent / "lib" / "dreamweaver-lyrics.js"
            js = (
                f"import {{parseTimestampedLyrics}} from {json.dumps(parser.as_uri())};"
                "let data=''; for await (const chunk of process.stdin) data += chunk;"
                "const parsed=parseTimestampedLyrics(JSON.parse(data).lyricsText);"
                "console.log(JSON.stringify(parsed));"
            )
            checked = subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(payload),
                                     capture_output=True, text=True, check=True)
            parsed = json.loads(checked.stdout)
            self.assertTrue(parsed["timed"])
            lines = [line for line in parsed["lines"] if line["kind"] == "lyric"]
            self.assertEqual([(line["time"], line["text"], line["insight"]) for line in lines],
                             [(1.2, "First line", "Note"), (3, "Second line", "")])
            second = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("already exists", second.stderr)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), payload)


if __name__ == "__main__":
    unittest.main()
