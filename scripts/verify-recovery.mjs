import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The exported pack includes recovery-core.mjs next to this script.
const coreUrl = new URL("./recovery-core.mjs", import.meta.url);
let core;
try {
  await readFile(coreUrl);
  core = await import(coreUrl);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  core = await import("../lib/catalog-recovery.js");
}

export async function verifyRecoveryDirectory(directory) {
  const root = await realpath(directory);
  const manifestPath = path.join(root, "manifest.json");
  const info = await stat(manifestPath);
  if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error("Recovery manifest must be a file no larger than 10 MiB.");
  const serialized = await readFile(manifestPath, "utf8");
  if (Buffer.byteLength(serialized) > 10 * 1024 * 1024) throw new Error("Recovery manifest exceeds 10 MiB.");
  const manifest = core.validateRecovery(JSON.parse(serialized));
  const results = [];
  for (const song of manifest.songs) {
    for (const version of song.versions) {
      if (!version.file) {
        results.push({ songId: song.id, versionId: version.id, state: "not_recorded" });
        continue;
      }
      const relative = core.recoveryAssetPath(song, version);
      const requested = path.join(root, relative);
      let resolved;
      try {
        resolved = await realpath(requested);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        results.push({ songId: song.id, versionId: version.id, path: relative, state: "missing" });
        continue;
      }
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Recovery asset resolves outside the pack.");
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of createReadStream(resolved)) {
        size += chunk.length;
        if (size > core.MAX_RECOVERY_FILE_BYTES) throw new Error("Recovery asset exceeds its size bound.");
        hash.update(chunk);
      }
      const matches = size === version.file.bytes && hash.digest("hex") === version.file.sha256;
      results.push({ songId: song.id, versionId: version.id, path: relative, state: matches ? "matched" : "different" });
    }
  }
  return {
    limitation: "Matches are against this unsigned manifest, not proof of ownership, legal title or an authenticated HALO stamp. No DAW session was reopened; dependencies and session-test declarations are not verified.",
    projects: manifest.songs.map(song => ({
      songId: song.id,
      sessionReopening: "not_verified_by_this_check",
      recordedHumanTest: song.project.reopenTest,
      packInclusionRecorded: manifest.packInventory !== null
    })),
    results
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node verify-recovery.mjs /path/to/extracted-pack");
    const report = await verifyRecoveryDirectory(process.argv[2]);
    console.log(JSON.stringify(report, null, 2));
    if (!report.results.length || report.results.some(item => item.state !== "matched")) process.exitCode = 1;
  } catch (error) {
    console.error(`Recovery verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
