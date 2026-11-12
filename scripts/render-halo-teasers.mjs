import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac"]);
const DEFAULT_DURATION = 20;
const MAX_DURATION = 60;

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${basename(command)} exited with code ${code}: ${stderr.trim().slice(-1200)}`));
    });
  });
}

export function parseArgs(args) {
  const options = { input: "", background: "", output: "", manifest: "", duration: DEFAULT_DURATION };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--input", "--background", "--output", "--manifest", "--duration"].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    index += 1;
    if (name === "--duration") {
      options.duration = Number(value);
      if (!Number.isFinite(options.duration) || options.duration <= 0 || options.duration > MAX_DURATION) {
        throw new Error(`Duration must be greater than 0 and no more than ${MAX_DURATION} seconds.`);
      }
    } else {
      const key = { "--input": "input", "--background": "background", "--output": "output", "--manifest": "manifest" }[name];
      options[key] = resolve(value);
    }
  }
  for (const key of ["input", "background", "output", "manifest"]) {
    if (!options[key]) throw new Error(`Required option is missing: --${key}`);
  }
  return options;
}

export function validateOffsets(value, audioFiles, duration) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The cut manifest must be a JSON object mapping audio filenames to startSeconds.");
  }
  const files = new Set(audioFiles.map(file => file.name));
  for (const [name, entry] of Object.entries(value)) {
    if (!files.has(name)) throw new Error(`Manifest entry does not match an audio file: ${name}`);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.startSeconds !== "number" || !Number.isFinite(entry.startSeconds)
      || entry.startSeconds < 0 || entry.startSeconds > 86_400) {
      throw new Error(`Manifest entry for ${name} needs a non-negative numeric startSeconds.`);
    }
  }
  const missing = [...files].filter(name => !Object.hasOwn(value, name));
  if (missing.length) throw new Error(`Choose a cut start for every audio file before rendering: ${missing.join(", ")}`);
  if (duration <= 0 || duration > MAX_DURATION) throw new Error(`Duration must be no more than ${MAX_DURATION} seconds.`);
  return value;
}

async function probe(ffprobe, file, runCommand = run) {
  const { stdout } = await runCommand(ffprobe, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json", file
  ]);
  try { return JSON.parse(stdout); }
  catch { throw new Error(`ffprobe returned invalid metadata for ${basename(file)}.`); }
}

export async function renderBatch(options, {
  ffmpeg = process.env.FFMPEG_PATH || "ffmpeg",
  ffprobe = process.env.FFPROBE_PATH || "ffprobe",
  runCommand = run
} = {}) {
  const [entries, manifestText] = await Promise.all([
    readdir(options.input, { withFileTypes: true }),
    readFile(options.manifest, "utf8")
  ]);
  const audioFiles = entries
    .filter(entry => entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map(entry => ({ name: entry.name, path: join(options.input, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!audioFiles.length) throw new Error("No supported WAV, MP3, M4A, AAC or FLAC audio files found in the input folder.");
  let offsets;
  try { offsets = validateOffsets(JSON.parse(manifestText), audioFiles, options.duration); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error("The cut manifest is not valid JSON.");
    throw error;
  }
  const background = resolve(options.background);
  const output = resolve(options.output);
  await Promise.all([access(background), access(options.manifest)]);
  if (output === background) throw new Error("Output folder cannot be the background video.");
  await mkdir(output, { recursive: true });

  const outputPaths = audioFiles.map(file => join(output, `${file.name.slice(0, -extname(file.name).length)}.mp4`));
  if (new Set(outputPaths).size !== outputPaths.length) {
    throw new Error("Multiple audio files map to the same MP4 output name; rename the sources before rendering.");
  }
  const results = [];
  for (const [index, file] of audioFiles.entries()) {
    const startSeconds = offsets[file.name].startSeconds;
    const source = await probe(ffprobe, file.path, runCommand);
    const sourceDuration = Number(source?.format?.duration);
    if (!Number.isFinite(sourceDuration) || sourceDuration < startSeconds + options.duration) {
      throw new Error(`${file.name} does not contain ${options.duration} seconds after startSeconds ${startSeconds}.`);
    }
    const outputPath = outputPaths[index];
    if (outputPath === file.path || outputPath === background) throw new Error(`Refusing to overwrite an input: ${outputPath}`);
    await runCommand(ffmpeg, [
      "-hide_banner", "-nostdin", "-n", "-stream_loop", "-1", "-i", background,
      "-ss", String(startSeconds), "-i", file.path, "-t", String(options.duration),
      "-map", "0:v:0", "-map", "1:a:0", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath
    ]);
    const rendered = await probe(ffprobe, outputPath, runCommand);
    const video = rendered.streams?.find(stream => stream.codec_type === "video");
    const renderedDuration = Number(rendered.format?.duration);
    if (Number(video?.width) !== 1080 || Number(video?.height) !== 1920
      || !Number.isFinite(renderedDuration) || renderedDuration < options.duration - 0.25
      || renderedDuration > options.duration + 0.25) {
      throw new Error(`Rendered output failed vertical 9:16 or ${options.duration}-second validation: ${outputPath}`);
    }
    results.push({ input: file.name, output: outputPath, startSeconds, durationSeconds: renderedDuration });
    console.log(`Rendered ${file.name} -> ${outputPath} (${renderedDuration.toFixed(2)}s)`);
  }
  return results;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    await renderBatch(options);
  } catch (error) {
    console.error(`HALO teaser rendering stopped: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
