import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, renderBatch, validateOffsets } from "./render-halo-teasers.mjs";

const root = await mkdtemp(join(tmpdir(), "halo-teaser-contracts-"));
try {
  const input = join(root, "input"), output = join(root, "output");
  const background = join(root, "background.mp4"), manifest = join(root, "cuts.json");
  await mkdir(input);
  await writeFile(background, "fixture-background");
  await writeFile(join(input, "Black Book.wav"), "fixture-audio");
  await writeFile(join(input, "Beautiful Liar.mp3"), "fixture-audio");
  await writeFile(join(input, "ignore.txt"), "not audio");
  const args = parseArgs(["--input", input, "--background", background, "--output", output, "--manifest", manifest, "--duration", "20"]);
  assert.equal(args.duration, 20);
  for (const invalid of [
    [], ["--input", input], ["--input", input, "--bad", "x"],
    ["--input", input, "--background", background, "--output", output, "--manifest", manifest, "--duration", "61"]
  ]) assert.throws(() => parseArgs(invalid));
  assert.throws(() => validateOffsets({ "Black Book.wav": { startSeconds: -1 } }, [{ name: "Black Book.wav" }], 20));
  assert.throws(() => validateOffsets({}, [{ name: "Black Book.wav" }], 20), /every audio file/);
  assert.throws(() => validateOffsets({ "../secret.wav": { startSeconds: 0 } }, [{ name: "Black Book.wav" }], 20), /does not match/);
  assert.throws(() => validateOffsets({ "Black Book.wav": { startSeconds: "10" } }, [{ name: "Black Book.wav" }], 20));
  await writeFile(manifest, JSON.stringify({
    "Black Book.wav": { startSeconds: 14.25 },
    "Beautiful Liar.mp3": { startSeconds: 0 }
  }));
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args });
    if (command === "ffprobe-fixture") {
      const file = args.at(-1);
      return { stdout: JSON.stringify(file.endsWith(".mp4")
        ? { format: { duration: "20" }, streams: [{ codec_type: "video", width: 1080, height: 1920 }] }
        : { format: { duration: "60" }, streams: [{ codec_type: "audio" }] }) };
    }
    assert.equal(command, "ffmpeg-fixture");
    const target = args.at(-1);
    assert.ok(args.includes("-n"), "must never silently overwrite rendered files");
    if (await access(target).then(() => true, () => false)) throw new Error(`Refusing to overwrite rendered output: ${target}`);
    await writeFile(target, "rendered-fixture");
    return { stdout: "", stderr: "" };
  };
  const results = await renderBatch(args, { ffmpeg: "ffmpeg-fixture", ffprobe: "ffprobe-fixture", runCommand });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(item => item.input), ["Beautiful Liar.mp3", "Black Book.wav"]);
  assert.equal(results[1].startSeconds, 14.25);
  const ffmpegCalls = calls.filter(call => call.command === "ffmpeg-fixture");
  assert.equal(ffmpegCalls.length, 2);
  for (const call of ffmpegCalls) {
    assert.ok(call.args.includes("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"));
    assert.ok(call.args.includes("libx264"));
    assert.ok(call.args.includes("aac"));
    assert.equal(call.args.includes("-shortest"), false);
  }
  assert.equal(await readFile(results[0].output, "utf8"), "rendered-fixture");
  const playlistPlan = JSON.parse(await readFile(new URL("../docs/prd/youtube-playlist-plan.json", import.meta.url), "utf8"));
  assert.deepEqual(playlistPlan.playlists.map(playlist => playlist.title), ["HALO House Shorts", "HALO Obsidian Reels"]);
  const playlistIds = playlistPlan.playlists.flatMap(playlist => playlist.entries.map(entry => entry.videoId));
  assert.ok(playlistIds.filter(Boolean).every(id => /^[A-Za-z0-9_-]{11}$/.test(id)));
  assert.equal(playlistIds.filter(Boolean).length, 1, "only the exact user-supplied YouTube ID is prefilled");
  assert.match(await readFile(new URL("../docs/prd/short-form-renderer.md", import.meta.url), "utf8"), /No automatic social publishing or A\/B testing exists/);
  await assert.rejects(renderBatch(args, { ffmpeg: "ffmpeg-fixture", ffprobe: "ffprobe-fixture", runCommand }),
    /Refusing to overwrite rendered output/);
  const collisionInput = join(root, "collision-input");
  await mkdir(collisionInput);
  await writeFile(join(collisionInput, "Same.wav"), "fixture-audio");
  await writeFile(join(collisionInput, "Same.mp3"), "fixture-audio");
  const collisionManifest = join(root, "collision-cuts.json");
  await writeFile(collisionManifest, JSON.stringify({
    "Same.wav": { startSeconds: 0 },
    "Same.mp3": { startSeconds: 0 }
  }));
  await assert.rejects(renderBatch({
    ...args, input: collisionInput, manifest: collisionManifest, output: join(root, "collision-output")
  }), /same MP4 output name/);
  console.log("Teaser renderer contracts passed: explicit batch cuts, input coverage, safe paths and validated vertical outputs.");
} finally {
  await rm(root, { recursive: true, force: true });
}
