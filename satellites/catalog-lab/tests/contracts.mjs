import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { CATALOG_ENDPOINT, fetchCatalog, normalizeCatalog } from "../public/catalog-data.js";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const row = {
  id: "public-release", title: "<img src=x onerror=alert(1)>", artist: "Artist",
  status: "published", isLiveVisible: true, genres: ["Soul"], isrc: "GBAAA2600001",
  releaseDate: "2026-10-13", visualManifest: { private: true },
  artwork: "https://untrusted.example/image", streamUrl: "/api/private-audio"
};
const payload = { releases: [row, { ...row, status: "draft" }, { ...row, isLiveVisible: false },
  { ...row, isLiveVisible: undefined }, null, {}] };
const result = await fetchCatalog(async (url, options) => {
  assert.equal(url, CATALOG_ENDPOINT);
  assert.equal(url, "https://halo-world-global-platform.netlify.app/api/release-catalog");
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.mode, "cors");
  assert.equal(options.cache, "no-store");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.deepEqual(options.headers, { Accept: "application/json" });
  assert.equal(options.body, undefined);
  assert(options.signal instanceof AbortSignal);
  return { ok: true, json: async () => payload };
});
assert.equal(result.length, 1);
assert.deepEqual(Object.keys(result[0]), ["id", "title", "artist", "genres", "isrc", "releaseDate"]);
assert.equal(result[0].title, row.title, "text is preserved, never interpreted as HTML");
assert(Object.isFrozen(result) && Object.isFrozen(result[0]) && Object.isFrozen(result[0].genres));
assert.deepEqual(normalizeCatalog({ releases: [] }), []);
assert.throws(() => normalizeCatalog({}), /Invalid public catalog response/);
assert.throws(() => normalizeCatalog({ releases: {} }), /Invalid public catalog response/);
assert.equal(normalizeCatalog({ releases: Array(250).fill(row) }).length, 200);
assert.equal(normalizeCatalog({ releases: [{ ...row, title: {}, artist: null, genres: [1, null, " Jazz "] }] })[0].title, "Untitled release");
assert.deepEqual(normalizeCatalog({ releases: [{ ...row, genres: [1, null, " Jazz "] }] })[0].genres, ["Jazz"]);
await assert.rejects(fetchCatalog(async () => ({ ok: false })), /Public catalog unavailable/);
await assert.rejects(fetchCatalog(async () => { throw new Error("network"); }), /network/);
await assert.rejects(fetchCatalog(async () => { throw new DOMException("timeout", "TimeoutError"); }), /timeout/);
await assert.rejects(fetchCatalog(async () => ({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } })), /invalid JSON/);
await assert.rejects(fetchCatalog(async () => ({ ok: true, json: async () => ({}) })), /Invalid public catalog response/);

// Exercise the browser entry with a small DOM double, without dependencies or network.
class Node {
  constructor() { this.children = []; this.attributes = {}; this.handlers = {}; this.value = ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
}
const nodes = Object.fromEntries(["releases", "status", "search", "refresh", "palette"].map(id => [id, new Node()]));
const body = new Node();
const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
let requests = 0;
let fail = false;
let responsePayload = payload;
globalThis.document = { body, getElementById: id => nodes[id], createElement: () => new Node() };
globalThis.fetch = async (url, options) => {
  requests++;
  assert.equal(url, CATALOG_ENDPOINT);
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "omit");
  if (fail) throw new Error("private database detail");
  return { ok: true, json: async () => responsePayload };
};
const settle = async () => {
  for (let i = 0; i < 20 && nodes.refresh.disabled; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(nodes.refresh.disabled, false, "load must finish");
};
try {
  await import("../public/catalog-lab.js");
  await settle();
  assert.equal(nodes.releases.children.length, 1);
  assert.equal(nodes.releases.children[0].children[1].textContent, row.title);
  assert.equal(nodes.releases.attributes["aria-busy"], "false");
  nodes.search.value = "missing";
  nodes.search.handlers.input();
  assert.equal(nodes.releases.children.length, 0);
  assert.match(nodes.status.textContent, /No releases match/);
  for (const query of ["Artist", "soul", "  <img  "]) {
    nodes.search.value = query;
    nodes.search.handlers.input();
    assert.equal(nodes.releases.children.length, 1);
  }
  nodes.palette.value = "ember";
  nodes.palette.handlers.change();
  assert.equal(body.className, "ember");
  assert.equal(requests, 1, "local controls must not make API requests");
  fail = true;
  const pending = nodes.refresh.handlers.click();
  await nodes.refresh.handlers.click();
  await pending;
  assert.equal(requests, 2, "overlapping refreshes must not duplicate requests");
  assert.equal(nodes.releases.children.length, 0, "failed refresh must clear stale data");
  assert.match(nodes.status.textContent, /Use Refresh/);
  assert.doesNotMatch(nodes.status.textContent, /private database detail/);
  nodes.search.handlers.input();
  assert.match(nodes.status.textContent, /Use Refresh/, "search must not hide the unavailable state");
  fail = false;
  responsePayload = { releases: [] };
  await nodes.refresh.handlers.click();
  assert.match(nodes.status.textContent, /No public releases/);
  responsePayload = payload;
  nodes.search.value = "";
  await nodes.refresh.handlers.click();
  assert.equal(nodes.releases.children.length, 1, "retry must recover");
} finally {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}

const html = await read("public/index.html");
const config = await read("netlify.toml");
assert.match(html, /lang="en"/);
assert.match(html, /name="viewport"/);
assert.match(html, /role="status"/);
assert.match(html, /Read-only connection/);
assert.match(config, /base = "satellites\/catalog-lab"/);
assert.match(config, /publish = "public"/);
assert.match(config, /directory = "disabled-functions"/);
assert.deepEqual(await readdir(new URL("disabled-functions/", root)), [".gitkeep"]);
assert.deepEqual((await readdir(new URL("public/", root))).sort(),
  ["catalog-data.js", "catalog-lab.css", "catalog-lab.js", "index.html"]);
for (const source of [html, config]) {
  assert(source.includes(`connect-src ${CATALOG_ENDPOINT};`), "CSP must restrict connections to the public read endpoint");
  for (const directive of ["default-src 'none'", "form-action 'none'", "base-uri 'none'", "media-src 'none'", "worker-src 'none'"]) {
    assert(source.includes(directive));
  }
}
for (const path of ["public/index.html", "public/catalog-lab.js", "public/catalog-data.js", "public/catalog-lab.css"]) {
  const source = await read(path);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|sendBeacon|WebSocket|serviceWorker|XMLHttpRequest/);
  assert.doesNotMatch(source, /\b(?:POST|PUT|PATCH|DELETE)\b|<form\b|url\s*\(|@import/);
  for (const match of source.matchAll(/(?:from|src=|href=)\s*["']([^"']+)["']/g)) {
    assert(match[1].startsWith("./"), "satellite assets/imports must stay inside the public boundary");
  }
  if (path !== "public/catalog-data.js") assert.doesNotMatch(source, /\bfetch\s*\(/, "network belongs only in the read-only adapter");
}
console.log("HALO catalog satellite: read-only fetch, UI states, local visuals, and deploy isolation passed");
