import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pageHelp, GUIDE_ROUTES } from "../lib/halo-guide-content.js";
import { controlHelp, controlLabel, visibleControl } from "../lib/halo-page-guide.js";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
assert.deepEqual(pageHelp("/obsidian/index.html"), pageHelp("/obsidian/"));
assert.match(pageHelp("/obsidian/").overview, /browser only, not uploaded or synced/);
assert.equal(pageHelp("/musical-unrelated").title, "Explore this HALO page");
assert.equal(pageHelp("/missing").title, "Explore this HALO page");
assert.equal(GUIDE_ROUTES.includes("/obsidian/"), true);
assert.match(pageHelp("/dreamweaver/").overview, /not proof of an offline/);

const makeNode = ({ tag = "BUTTON", attributes = {}, text = "", authored = null, matching = null, type = "", disabled = false } = {}) => ({
  tagName: tag, textContent: text, labels: [], isConnected: true, type, disabled,
  get value() { assert.fail("the guide must never read field values"); },
  getAttribute: name => attributes[name] || null,
  closest: selector => selector === "[data-halo-guide]" ? authored : selector === matching ? {} : null,
  getClientRects: () => [{}]
});
const document = { getElementById: id => id === "fieldLabel" ? { textContent: "Artist name" } : null };
assert.equal(controlLabel(makeNode({ attributes: { "aria-label": "Save recording" }, text: "Save" }), document), "Save recording");
assert.equal(controlLabel(makeNode({ tag: "INPUT", attributes: { "aria-labelledby": "fieldLabel" } }), document), "Artist name");
assert.equal(controlLabel(makeNode({ tag: "INPUT", type: "password", attributes: { placeholder: "Password" } }), document), "Password");
assert.match(controlHelp(makeNode({ tag: "INPUT", type: "password" }), pageHelp("/missing")), /does not read or send its value/);
assert.match(controlHelp(makeNode(), pageHelp("/missing")), /has not been authored/);
assert.match(controlHelp(makeNode({ disabled: true }), pageHelp("/missing")), /currently unavailable/);
assert.match(controlHelp(makeNode({ matching: "#loop" }), pageHelp("/obsidian/")), /Loop takes priority/);
const authored = { getAttribute: () => "This exact authored help takes precedence." };
assert.match(controlHelp(makeNode({ authored, matching: "#loop" }), pageHelp("/obsidian/")), /exact authored help/);
assert.equal(controlHelp(makeNode({ authored, matching: "#loop" }), pageHelp("/obsidian/")).includes("Loop takes"), false);
const window = { getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
assert.equal(visibleControl(makeNode(), window), true);
const detached = makeNode();
detached.isConnected = false;
assert.equal(visibleControl(detached, window), false);
assert.equal(visibleControl(makeNode(), { getComputedStyle: () => ({ display: "none" }) }), false);
const noLayout = makeNode();
noLayout.getClientRects = () => [];
assert.equal(visibleControl(noLayout, window), false);

for (const [path, file] of [
  ["/obsidian/", "obsidian/index.html"], ["/music/", "music/index.html"],
  ["/song-catalog/", "song-catalog/index.html"], ["/dreamweaver/", "dreamweaver/index.html"]
]) {
  const html = await read(file);
  for (const selector of Object.keys(pageHelp(path).controls)) {
    assert.ok(html.includes(`id="${selector.slice(1)}"`), `${file} has authored target ${selector}`);
  }
}
const htmlFiles = execFileSync("git", ["ls-files", "*.html"], { cwd: root, encoding: "utf8" }).trim().split("\n");
let pages = 0;
for (const file of htmlFiles) {
  if (/^(emails|satellites)\//.test(file)) continue;
  const html = await read(file);
  if (!/<html\b/i.test(html)) continue;
  assert.match(html, /src="\/(?:site-monitor|halo-companion)\.js"/, `${file} mounts the guide`);
  pages++;
}
const [client, companion, server, css] = await Promise.all([
  read("lib/halo-page-guide.js"), read("halo-companion.js"),
  read("netlify/functions/halo-companion.mjs"), read("halo-page-guide.css")
]);
assert.doesNotMatch(client, /fetch\(|localStorage|innerHTML|\.click\(|node\.value/);
assert.match(client, /aria-describedby/);
assert.match(client, /MutationObserver/);
assert.match(client, /event\.key === "Escape"/);
assert.match(companion, /import\("\/lib\/halo-page-guide\.js"\)/);
assert.match(companion, /Page walkthrough could not load/);
assert.match(server, /JSON\.stringify\(pageHelp\(path\)\)/);
assert.match(server, /GUIDE_ROUTES\.includes\(result\.route\)/);
assert.match(css, /outline:3px solid/);
assert.doesNotMatch(css, /animation:|transition:/);
console.log(`HALO page guide contracts passed: ${pages} pages mounted, authored targets, safe labels, grounding, and no page actions.`);
