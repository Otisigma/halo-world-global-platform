import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { CATALOG_ENDPOINT, fetchCatalog, normalizeCatalog, createPreview,
  rankPreview, exportSnapshot, exportCSV, csvCell } from "../public/catalog-data.js";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const row = {
  id: "public-release", title: "<img src=x onerror=alert(1)>", artist: "Artist",
  status: "published", genres: ["Soul"], isrc: "GBAAA2600001",
  releaseDate: "2026-10-13", visualManifest: { private: true },
  artwork: "https://untrusted.example/image", streamUrl: "/api/private-audio",
  rank: 1, votes: 2, signalScore: 10, chartActivity: { recentListens: 0, recentOpens: 0 }
};
const payload = { releases: [row, { ...row, status: "draft" }, { ...row, isLiveVisible: false },
  { ...row, id: "ineligible", isChartEligible: false }, { ...row, id: "unknown", isChartEligible: null },
  { ...row, status: "passed" }, { ...row }, { ...row, id: "../unsafe" }, null, {}] };
const result = await fetchCatalog(async (url, options) => {
  assert.equal(url, CATALOG_ENDPOINT);
  assert.equal(url, "https://halo-world-global-platform.netlify.app/api/catalog/chart");
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
assert.deepEqual(Object.keys(result[0]), ["id", "title", "artist", "genres", "releaseDate",
  "publicRank", "votes", "signalScore", "recentListens", "recentOpens"]);
assert.equal(result[0].title, row.title, "text is preserved, never interpreted as HTML");
assert(Object.isFrozen(result) && Object.isFrozen(result[0]) && Object.isFrozen(result[0].genres));
assert.deepEqual(normalizeCatalog({ releases: [] }), []);
assert.throws(() => normalizeCatalog({}), /Invalid public chart response/);
assert.throws(() => normalizeCatalog({ releases: {} }), /Invalid public chart response/);
assert.equal(normalizeCatalog({ releases: Array.from({ length: 250 }, (_, i) => ({ ...row, id: `track-${i}` })) }).length, 50);
assert.equal(normalizeCatalog({ releases: [{ ...row, isChartEligible: true, isLiveVisible: true }] }).length, 1);
assert.equal(normalizeCatalog({ releases: [{ ...row, title: {}, artist: null, genres: [1, null, " Jazz "] }] })[0].title, "Untitled release");
assert.deepEqual(normalizeCatalog({ releases: [{ ...row, genres: [1, null, " Jazz "] }] })[0].genres, ["Jazz"]);
const malformed = normalizeCatalog({ releases: [{
  ...row, votes: -1, signalScore: "10", rank: 0,
  chartActivity: { recentListens: Infinity, recentOpens: NaN }, releaseDate: "2026-02-30"
}] })[0];
for (const key of ["votes", "signalScore", "publicRank", "recentListens", "recentOpens"]) assert.equal(malformed[key], null);
assert.equal(malformed.releaseDate, "");
assert.equal(normalizeCatalog({ releases: [{ ...row, votes: 1e30, title: "x".repeat(500) }] })[0].votes, 1e12);
assert.equal(normalizeCatalog({ releases: [{ ...row, title: "x".repeat(500) }] })[0].title.length, 300);
await assert.rejects(fetchCatalog(async () => ({ ok: false })), /Public chart unavailable/);
await assert.rejects(fetchCatalog(async () => ({ ok: true, redirected: true })), /Public chart unavailable/);
await assert.rejects(fetchCatalog(async () => { throw new Error("network"); }), /network/);
await assert.rejects(fetchCatalog(async () => { throw new TypeError("redirect blocked"); }), /redirect blocked/);
const originalTimeout = AbortSignal.timeout;
try {
  AbortSignal.timeout = milliseconds => {
    assert.equal(milliseconds, 10000, "public GET must have a bounded ten-second timeout");
    return originalTimeout(1);
  };
  await assert.rejects(fetchCatalog(async (_url, { signal }) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    signal.throwIfAborted();
  }), { name: "TimeoutError" });
} finally {
  AbortSignal.timeout = originalTimeout;
}
await assert.rejects(fetchCatalog(async () => ({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } })), /invalid JSON/);
await assert.rejects(fetchCatalog(async () => ({ ok: true, json: async () => ({}) })), /Invalid public chart response/);

// Model actions never mutate the frozen public snapshot or insert tracks.
const second = { ...row, id: "peer-track", title: '=HYPERLINK("bad")', artist: "@artist", votes: 2,
  signalScore: 10, rank: 2, releaseDate: "2026-10-12" };
const chart = normalizeCatalog({ releases: [row, second] });
const preview = createPreview();
assert.equal(preview.nomination(), null);
assert.equal(rankPreview(chart, preview)[0].id, row.id);
assert.equal(preview.toggleVote(chart, second.id), true);
for (const mode of ["signal", "votes"]) {
  const ranked = rankPreview(chart, preview, mode);
  assert.equal(ranked[0].id, second.id);
  assert.equal(ranked[0].previewVotes, 3);
  assert.equal(ranked[0].previewSignal, 15);
  assert.equal(ranked[0].votes, 2);
  assert.equal(ranked[0].publicRank, 2);
  assert.equal(ranked[0].previewRank, 1);
}
assert.equal(rankPreview(chart, preview, "newest")[0].id, row.id);
assert.equal(preview.toggleVote(chart, second.id), true);
assert.equal(rankPreview(chart, preview)[0].id, row.id);
assert.equal(preview.toggleVote(chart, "not-a-track"), false);
assert.equal(preview.toggleVote([malformed], malformed.id), false);
assert.equal(rankPreview([malformed], preview)[0].previewVotes, null);
preview.nominate(chart, second.id);
assert.equal(preview.nomination(), second.id);
assert.equal(chart.length, 2);
assert.equal(chart[1].votes, 2, "nomination never seeds votes");
preview.nominate(chart, "arbitrary-track");
assert.equal(preview.nomination(), null);
preview.nominate(chart, second.id);
preview.toggleVote(chart, second.id);
const snapshot = exportSnapshot(chart, preview, "votes", "2026-10-20T12:00:00.000Z");
assert.equal(snapshot.source, CATALOG_ENDPOINT);
assert.match(snapshot.scope, /not submitted/);
assert.match(snapshot.scope, /no artist verification/);
assert.equal(snapshot.releases[0].unsavedNomination, true);
assert.equal(snapshot.releases[0].previewVote, true);
assert.equal(snapshot.releases[0].votes, 2);
assert.equal(snapshot.releases[0].previewVotes, 3);
assert.deepEqual(Object.keys(snapshot.releases[0]), ["id", "title", "artist", "genres", "releaseDate",
  "publicRank", "votes", "signalScore", "recentListens", "recentOpens", "previewRank",
  "previewVote", "previewVotes", "previewSignal", "unsavedNomination"]);
assert.doesNotMatch(JSON.stringify(snapshot), /visualManifest|streamUrl|artwork|isrc|private-audio/);
const csv = exportCSV(snapshot);
assert(csv.includes(csvCell(second.title)));
assert(csv.includes(csvCell(second.artist)));
assert(csv.includes(snapshot.fetchedAt));
assert(csv.includes(snapshot.scope));
for (const cell of ["=1+1", "+cmd", "-cmd", "@SUM(A1)", "  =1", "\tvalue", "\rvalue", "\nvalue", "\uFEFF=1"]) {
  assert.equal(csvCell(cell), `"'${cell.replaceAll('"', '""')}"`);
}
assert.equal(csvCell('one,"two"\nthree'), '"one,""two""\nthree"');
assert.equal(csvCell(null), '""');
assert.equal(csvCell("safe"), '"safe"');
assert.equal(exportCSV(exportSnapshot([], preview, "signal", "")).split("\r\n").length, 1);
preview.clear();
assert.equal(preview.nomination(), null);
assert.equal(preview.hasVote(second.id), false);
assert.equal(createPreview().hasVote(second.id), false, "new page state starts without votes");
assert.equal(chart[1].votes, 2);

// Exercise the browser entry with a small DOM double, without dependencies or network.
class Node {
  constructor() { this.children = []; this.attributes = {}; this.handlers = {}; this.value = ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  focus() { this.focused = true; }
  click() { this.clicked = true; }
  remove() { this.removed = true; }
}
const nodes = Object.fromEntries(["releases", "status", "search", "refresh", "palette", "sort",
  "summary", "source", "inventory", "nomination", "nominate", "clear-nomination", "draft",
  "reset", "export-json", "export-csv"].map(id => [id, new Node()]));
nodes.sort.value = "signal";
const body = new Node();
const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
let requests = 0;
let fail = false;
let responsePayload = payload;
let fetchGate;
const created = [];
globalThis.document = { body, getElementById: id => nodes[id], createElement: tag => {
  const node = new Node();
  node.tag = tag;
  created.push(node);
  return node;
} };
globalThis.fetch = async (url, options) => {
  requests++;
  assert.equal(url, CATALOG_ENDPOINT);
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "omit");
  if (fetchGate) await fetchGate;
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
  assert.equal(nodes.releases.children[0].children[2].textContent, row.title);
  assert.equal(created.filter(node => node.tag === "img").length, 0, "markup stays text");
  assert.match(nodes.summary.textContent, /2 public votes/);
  assert.match(nodes.source.textContent, /Fetched \d{4}-/);
  assert.equal(nodes.inventory.children.length, 1);
  const voteButton = () => nodes.releases.children[0].children.find(node => node.tag === "button");
  voteButton().handlers.click();
  assert.equal(voteButton().attributes["aria-pressed"], "true");
  assert.equal(voteButton().focused, true);
  assert.match(nodes.summary.textContent, /1 preview votes/);
  assert.match(nodes.releases.children[0].children[6].textContent, /Public votes: 2 · Preview total: 3/);
  nodes.nomination.value = row.id;
  nodes.nomination.handlers.change();
  assert.equal(nodes.nominate.disabled, false);
  nodes.nominate.handlers.click();
  assert.match(nodes.draft.textContent, /Unsaved nomination draft/);
  assert.match(nodes.draft.textContent, /Not submitted/);
  assert.equal(nodes.inventory.children[0].children[5].textContent, "Draft only");
  nodes["clear-nomination"].handlers.click();
  assert.match(nodes.draft.textContent, /No unsaved/);
  nodes.nominate.handlers.click();
  nodes.reset.handlers.click();
  assert.equal(voteButton().attributes["aria-pressed"], "false");
  assert.match(nodes.draft.textContent, /No unsaved/);
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
  nodes.search.value = "";
  nodes.search.handlers.input();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalSetTimeout = globalThis.setTimeout;
  const blobs = [];
  const revoked = [];
  try {
    URL.createObjectURL = blob => { blobs.push(blob); return "blob:test-download"; };
    URL.revokeObjectURL = url => revoked.push(url);
    globalThis.setTimeout = callback => { callback(); return 0; };
    nodes["export-json"].handlers.click();
    nodes["export-csv"].handlers.click();
    assert.equal(JSON.parse(await blobs[0].text()).releases[0].title, row.title);
    assert.match(await blobs[1].text(), /unsavedNomination/);
    const links = created.filter(node => node.tag === "a");
    assert.deepEqual(links.map(link => link.download), ["halo-chart-preview.json", "halo-chart-preview.csv"]);
    assert(links.every(link => link.clicked && link.removed && link.href === "blob:test-download"));
    assert.equal(revoked.length, 2);
    URL.createObjectURL = () => { throw new Error("not supported"); };
    nodes["export-json"].handlers.click();
    assert.match(nodes.status.textContent, /Download unavailable/);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    globalThis.setTimeout = originalSetTimeout;
  }
  let releaseFetch;
  fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  const loading = nodes.refresh.handlers.click();
  assert.match(nodes.status.textContent, /Connecting to the public chart/);
  assert.equal(nodes.releases.attributes["aria-busy"], "true");
  assert.equal(nodes.search.disabled, true);
  assert.equal(nodes.sort.disabled, true);
  assert.equal(nodes.nomination.disabled, true);
  assert.equal(nodes["export-csv"].disabled, true);
  assert.equal(nodes.releases.children.length, 0, "loading clears stale cards");
  assert.equal(nodes.inventory.children.length, 0, "loading clears stale inventory");
  await nodes.refresh.handlers.click();
  assert.equal(requests, 2, "loading refresh cannot overlap");
  releaseFetch();
  await loading;
  fetchGate = undefined;
  fail = true;
  const pending = nodes.refresh.handlers.click();
  await nodes.refresh.handlers.click();
  await pending;
  assert.equal(requests, 3, "overlapping refreshes must not duplicate requests");
  assert.equal(nodes.releases.children.length, 0, "failed refresh must clear stale data");
  assert.equal(nodes.inventory.children.length, 0);
  assert.equal(nodes["export-json"].disabled, true);
  assert.equal(nodes.nominate.disabled, true);
  assert.match(nodes.status.textContent, /Use Refresh/);
  assert.doesNotMatch(nodes.status.textContent, /private database detail/);
  nodes.search.handlers.input();
  assert.match(nodes.status.textContent, /Use Refresh/, "search must not hide the unavailable state");
  fail = false;
  responsePayload = { releases: [] };
  await nodes.refresh.handlers.click();
  assert.match(nodes.status.textContent, /No public chart entries/);
  assert.equal(nodes.nomination.disabled, true);
  responsePayload = payload;
  nodes.search.value = "";
  await nodes.refresh.handlers.click();
  assert.equal(nodes.releases.children.length, 1, "retry must recover");
  responsePayload = { releases: [row, second] };
  await nodes.refresh.handlers.click();
  nodes.sort.value = "votes";
  nodes.sort.handlers.change();
  const peerVote = nodes.releases.children[1].children.find(node => node.tag === "button");
  peerVote.handlers.click();
  assert.equal(nodes.releases.children[0].children[2].textContent, second.title, "vote reorders the rendered chart");
  nodes.sort.value = "newest";
  nodes.sort.handlers.change();
  assert.equal(nodes.releases.children[0].children[2].textContent, row.title);
  nodes.nomination.value = second.id;
  nodes.nominate.handlers.click();
  await nodes.refresh.handlers.click();
  assert.match(nodes.draft.textContent, /No unsaved/);
  assert.match(nodes.summary.textContent, /0 preview votes/, "refresh resets preview annotations");
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
assert.match(html, /Preview votes — not submitted to HALO/);
assert.match(html, /Not submitted \/ no artist verification/);
assert.match(html, /non-playing preview/);
assert.match(html, /separately authorized backend/);
assert.doesNotMatch(html, /<audio\b|<video\b|<iframe\b|\son\w+\s*=/i);
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
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|sendBeacon|WebSocket|serviceWorker|XMLHttpRequest|document\.cookie/);
  assert.doesNotMatch(source, /\b(?:POST|PUT|PATCH|DELETE)\b|<form\b|url\s*\(|@import|api\/catalog\/vote|apiKey|halo_key_/);
  for (const match of source.matchAll(/(?:from|src=|href=)\s*["']([^"']+)["']/g)) {
    assert(match[1].startsWith("./"), "satellite assets/imports must stay inside the public boundary");
  }
  if (path !== "public/catalog-data.js") assert.doesNotMatch(source, /\bfetch\s*\(/, "network belongs only in the read-only adapter");
}
console.log("HALO chart satellite: public normalization, safe DOM, preview-only votes/drafts, exports, fetch failures, and isolation passed");
