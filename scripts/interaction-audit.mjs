import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", ".netlify", "node_modules"]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

function parseAttributes(source) {
  const attributes = new Map();
  for (const match of source.matchAll(/([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function isExternalTarget(target) {
  return /^(?:https?:|mailto:|tel:|sms:|data:|blob:|javascript:)/i.test(target)
    || target.includes("${")
    || target.includes("{")
    || target.includes("{{");
}

async function targetExists(page, target, redirectAliases, redirectWildcardPrefixes) {
  const cleanTarget = target.split(/[?#]/)[0];
  const fileTarget = cleanTarget.startsWith("/")
    ? resolve(root, cleanTarget.slice(1))
    : resolve(dirname(page), cleanTarget);

  try {
    await access(fileTarget);
    return true;
  } catch {}

  try {
    await access(resolve(fileTarget, "index.html"));
    return true;
  } catch {}

  if (!cleanTarget.startsWith("/")) return false;
  return redirectAliases.has(cleanTarget) || redirectWildcardPrefixes.some(prefix => cleanTarget.startsWith(prefix));
}

const files = await walk(root);
const pages = files.filter(file => extname(file) === ".html");
const netlifyConfig = await readFile(resolve(root, "netlify.toml"), "utf8");
const redirectAliases = new Set(
  [...netlifyConfig.matchAll(/^\s*from\s*=\s*["']([^"']+)["']/gm)].map(match => match[1])
);
const redirectWildcardPrefixes = [...redirectAliases]
  .filter(path => path.includes("*"))
  .map(path => path.split("*")[0])
  .filter(Boolean);
const failures = [];
let targetCount = 0;
let buttonCount = 0;

for (const page of pages) {
  const pageName = relative(root, page);
  const source = await readFile(page, "utf8");
  let scripts = "";

  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = parseAttributes(match[1]);
    const scriptTarget = attributes.get("src");
    if (!scriptTarget) {
      scripts += `\n${match[2]}`;
      continue;
    }
    if (isExternalTarget(scriptTarget)) continue;
    const scriptFile = scriptTarget.startsWith("/")
      ? resolve(root, scriptTarget.slice(1))
      : resolve(dirname(page), scriptTarget);
    try {
      scripts += `\n${await readFile(scriptFile, "utf8")}`;
    } catch {}
  }

  for (const match of source.matchAll(/<(a|link|script|img|source|video|audio|form)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    const attributeName = tag === "form" ? "action" : tag === "a" || tag === "link" ? "href" : "src";
    const target = attributes.get(attributeName);
    if (!target || target.startsWith("#") || isExternalTarget(target)) continue;
    targetCount += 1;
    if (!await targetExists(page, target, redirectAliases, redirectWildcardPrefixes)) {
      failures.push(`${pageName}: unresolved ${tag} ${attributeName}="${target}"`);
    }
  }

  for (const match of source.matchAll(/<a\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1]);
    if (attributes.get("href") !== "#") continue;
    const id = attributes.get("id");
    const escapedId = id?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const assignmentPattern = escapedId
      ? new RegExp(`(?:getElementById\\(["']${escapedId}["']\\)|querySelector\\(["']#${escapedId}["']\\)|\\b${escapedId}\\b)[\\s\\S]{0,240}\\.href\\s*=`)
      : null;
    if (!assignmentPattern?.test(scripts)) {
      failures.push(`${pageName}: placeholder link "#" is never assigned a destination`);
    }
  }

  for (const match of source.matchAll(/<button\b([^>]*)>/gi)) {
    buttonCount += 1;
    const rawAttributes = match[1];
    const attributes = parseAttributes(rawAttributes);
    const type = (attributes.get("type") || "").toLowerCase();
    if (rawAttributes.includes("{")) continue;
    if (/\bonclick\s*=/i.test(rawAttributes) || type === "submit" || type === "reset") continue;

    const precedingSource = source.slice(0, match.index);
    const insideForm = precedingSource.lastIndexOf("<form") > precedingSource.lastIndexOf("</form>");
    if (!type && insideForm) continue;

    const id = attributes.get("id");
    if (id && scripts.includes(id)) continue;

    const dataAttributes = [...attributes.keys()].filter(name => name.startsWith("data-"));
    const hasDataHandler = dataAttributes.some(name => {
      const datasetName = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      return scripts.includes(name) || scripts.includes(datasetName);
    });
    if (hasDataHandler) continue;

    const classes = (attributes.get("class") || "").split(/\s+/).filter(Boolean);
    const hasClassHandler = classes.some(name => (
      scripts.includes(`.${name}`)
      || scripts.includes(`"${name}"`)
      || scripts.includes(`'${name}'`)
    ));
    if (hasClassHandler) continue;

    failures.push(`${pageName}: button lacks a detectable handler (${id || classes.join(".") || "unnamed"})`);
  }
}

if (failures.length) {
  console.error(`HALO interaction audit failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`HALO interaction audit passed across ${pages.length} pages, ${targetCount} local targets, and ${buttonCount} buttons.`);
}
