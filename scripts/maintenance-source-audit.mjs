import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".html", ".css", ".js", ".mjs", ".sql", ".json", ".md", ".toml", ".webmanifest"]);
const ignoredDirectories = new Set([".git", ".netlify", "node_modules"]);
const netlifyConfigSource = await readFile(resolve(root, "netlify.toml"), "utf8");
const redirectAliases = new Set([...netlifyConfigSource.matchAll(/^\s*from\s*=\s*["']([^"']+)["']/gm)].map(match => match[1]));

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

async function targetExists(rawTarget, sourcePath) {
  if (rawTarget.includes("${") || rawTarget.includes("{{")) return true;
  const cleanTarget = rawTarget.split(/[?#]/)[0];
  if (!cleanTarget || /^(https?:|mailto:|tel:|data:|javascript:|%23|#|\/api\/)/i.test(rawTarget)) return true;
  if (cleanTarget.startsWith("/") && redirectAliases.has(cleanTarget)) return true;
  const target = cleanTarget.startsWith("/") ? resolve(root, cleanTarget.slice(1)) : resolve(dirname(sourcePath), cleanTarget);
  try {
    await access(target);
    return true;
  } catch {
    try {
      await access(resolve(target, "index.html"));
      return true;
    } catch {
      return false;
    }
  }
}

const files = await collectFiles(root);
let inspectedLines = 0;
let inspectedConnections = 0;

for (const path of files) {
  const source = await readFile(path, "utf8");
  assert.ok(!source.includes("\u0000"), `${path} must not contain null bytes`);
  const lines = source.split(/\r?\n/);
  inspectedLines += lines.length;
  lines.forEach((line, index) => {
    assert.doesNotMatch(line, /^(<<<<<<<|=======|>>>>>>>)/, `${path}:${index + 1} contains an unresolved merge marker`);
  });

  if ([".js", ".mjs"].includes(extname(path))) {
    const syntax = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(syntax.status, 0, `${path} must parse successfully\n${syntax.stderr}`);
  }

  if ([".json", ".webmanifest"].includes(extname(path))) {
    assert.doesNotThrow(() => JSON.parse(source), `${path} must contain valid JSON`);
  }

  if (extname(path) === ".html") {
    assert.match(source, /<!doctype html>/i, `${path} must declare an HTML doctype`);
    assert.match(source, /<html[^>]+lang=["'][^"']+["']/i, `${path} must declare a language`);
    for (const match of source.matchAll(/(?:^|\s)(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
      inspectedConnections += 1;
      assert.ok(await targetExists(match[1], path), `${path} references missing local target ${match[1]}`);
    }
  }

  if (extname(path) === ".css") {
    for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      inspectedConnections += 1;
      assert.ok(await targetExists(match[1], path), `${path} references missing local target ${match[1]}`);
    }
  }
}

assert.ok(files.length > 0, "The maintenance source audit must inspect project files");
console.log(`HALO maintenance source audit passed: ${files.length} files, ${inspectedLines} lines, ${inspectedConnections} connections.`);
