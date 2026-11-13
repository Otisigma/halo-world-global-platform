import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makePreview } from "../netlify/edge-functions/social-preview.js";

const page = await readFile(new URL("../obsidian/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../obsidian/obsidian.css", import.meta.url), "utf8");
const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const png = await readFile(new URL("../assets/obsidian-social-preview.png", import.meta.url));
assert.equal(png.readUInt32BE(16), 1200);
assert.equal(png.readUInt32BE(20), 630);
assert.match(config, /path = "\/obsidian\/"\s+function = "social-preview"/);
assert.match(css, /prefers-reduced-motion:reduce\)\{\.intro,\.gateway,\.gateway::before\{animation:none\}\}/);
assert.match(page, /<audio id="audio" controls preload="none"/);

const releases = [
  { id: "song & one", status: "published", title: 'Sound "<script>', artist: "A & B", artwork: "https://cdn.example/cover.jpg?x=1&y=2" },
  { id: "private", status: "published", isLiveVisible: false, title: "Not public" },
  { id: "draft", status: "draft", title: "Unpublished" },
  { id: "unsafe", status: "published", title: "Safe", artwork: "javascript:alert(1)" }
];
let fetchCount = 0;
const fetchCatalog = async url => {
  fetchCount++;
  assert.equal(url.href, "https://halo.test/api/release-catalog");
  return Response.json({ releases });
};
const context = { next: async () => new Response(page, { headers: { "content-type": "text/html", "content-length": "123", etag: '"old"' } }) };
async function run(path, fetcher = fetchCatalog) {
  const response = await makePreview(new Request(`https://halo.test${path}`), context, fetcher);
  return { response, html: await response.text() };
}
const result = await run("/obsidian/?song=song%20%26%20one&t=32&tracking=secret");
assert.match(result.html, /content="Sound &quot;&lt;script&gt; — A &amp; B \| HALO Music World"/);
assert.match(result.html, /content="https:\/\/halo\.test\/obsidian\/\?song=song\+%26\+one&amp;t=32"/);
assert.match(result.html, /content="https:\/\/cdn\.example\/cover\.jpg\?x=1&amp;y=2"/);
assert.match(result.html, /assets\/obsidian-social-preview\.png/);
assert.match(result.html, /id="audio" controls/);
assert.doesNotMatch(result.html, /tracking=secret/);
assert.equal(result.response.headers.get("cache-control"), "no-store");
assert.equal(result.response.headers.get("content-length"), null);
assert.equal(result.response.headers.get("etag"), null);
for (const id of ["private", "draft", "missing"]) {
  const { html } = await run(`/obsidian/?song=${id}`);
  assert.match(html, /content="Obsidian Gateway \| HALO Music World"/);
  assert.doesNotMatch(html, /Not public|Unpublished/);
}
const unsafe = await run("/obsidian/?song=unsafe&t=bad");
assert.match(unsafe.html, /content="Safe \| HALO Music World"/);
assert.doesNotMatch(unsafe.html, /javascript:alert|&amp;t=bad/);
const before = fetchCount;
await run("/obsidian/");
assert.equal(fetchCount, before, "generic page must not fetch the catalog");
const originalError = console.error;
console.error = () => {};
try {
  const failed = await run("/obsidian/?song=missing", async () => { throw new Error("offline"); });
  assert.match(failed.html, /Obsidian Gateway \| HALO Music World/);
  assert.match(failed.html, /id="audio" controls/);
} finally {
  console.error = originalError;
}
const headResponse = new Response(null, { headers: { "content-type": "text/html" } });
assert.equal(await makePreview(new Request("https://halo.test/obsidian/", { method: "HEAD" }), { next: async () => headResponse }, fetchCatalog), headResponse);
console.log("Obsidian social preview contracts passed: public catalog, escaping, image fallback, moments, failures and reduced motion.");
