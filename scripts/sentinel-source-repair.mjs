import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const SENTINEL_PAGES = [
  { path: "dreamweaver/index.html", anchor: '<script type="module" src="/dreamweaver/dreamweaver.js" defer></script>' },
  { path: "album-concierge/index.html", anchor: '<script src="/album-concierge/album-concierge.js" defer></script>' }
];
const script = '<script type="module" src="/halo-sentinel.js"></script>';
const style = '<link rel="stylesheet" href="/halo-sentinel.css">';

export function repairSentinelMarkup(path, source) {
  const page = SENTINEL_PAGES.find(page => page.path === path);
  if (!page) throw new Error("Sentinel source repair path is not allowlisted");
  if (source.split(page.anchor).length !== 2) throw new Error(`Ambiguous or missing controller binding: ${path}`);
  const changes = [];
  for (const [asset, markup] of [["halo-sentinel.js", script], ["halo-sentinel.css", style]]) {
    const matches = [...source.matchAll(new RegExp(`<[^>]+(?:src|href)="/${asset.replace(".", "\\.")}"[^>]*>(?:</script>)?`, "g"))];
    if (matches.length > 1) throw new Error(`Duplicate Sentinel asset binding: ${path}`);
    if (matches.length === 0) {
      source = source.replace(page.anchor, `${markup}\n  ${page.anchor}`);
      changes.push(`restore ${asset}`);
    } else if (source.indexOf(matches[0][0]) > source.indexOf(page.anchor)) {
      source = source.replace(matches[0][0], "").replace(page.anchor, `${matches[0][0]}\n  ${page.anchor}`);
      changes.push(`order ${asset} before controller`);
    }
  }
  const audioSelector = path.startsWith("dreamweaver/") ? 'id="showAudio"' : "data-showcase-audio";
  const expected = path.startsWith("dreamweaver/") ? "auto" : "none";
  const audios = [...source.matchAll(/<audio\b[^>]*>/g)].filter(match => match[0].includes(audioSelector));
  if (audios.length !== 1) throw new Error(`Missing or ambiguous selected audio element: ${path}`);
  const tag = audios[0][0];
  if (!tag.includes(`preload="${expected}"`)) {
    const replacement = /\bpreload="[^"]*"/.test(tag)
      ? tag.replace(/\bpreload="[^"]*"/, `preload="${expected}"`)
      : tag.replace(/>$/, ` preload="${expected}">`);
    source = source.replace(tag, replacement);
    changes.push("restore selected audio preload attribute");
  }
  return { source, changes };
}

export async function inspectSentinelSources({ root = new URL("../", import.meta.url), write = false } = {}) {
  const report = [];
  for (const page of SENTINEL_PAGES) {
    const url = new URL(page.path, root);
    const original = await readFile(url, "utf8");
    const repaired = repairSentinelMarkup(page.path, original);
    report.push({ path: page.path, changes: repaired.changes });
    if (write && repaired.source !== original) await writeFile(url, repaired.source);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await inspectSentinelSources({ write: process.argv.includes("--write") });
    console.log(JSON.stringify({ mode: process.argv.includes("--write") ? "repair" : "inspect", pages: report }, null, 2));
    if (!process.argv.includes("--write") && report.some(page => page.changes.length)) process.exitCode = 1;
  } catch (error) {
    console.error("Sentinel source inspection failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  }
}
