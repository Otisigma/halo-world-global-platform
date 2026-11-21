import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../signal-network/console-evidence.js", import.meta.url), "utf8");
const song = "10000000-0000-4000-8000-000000000001";
const version = "10000000-0000-4000-8000-000000000002";

function setup(fetch) {
  const ids = ["evidence-listener-status", "evidence-master-status", "evidence-master-list",
    "evidence-song", "evidence-version", "evidence-listeners", "evidence-form"];
  const element = () => ({
    value: "", textContent: "", children: [], events: {},
    addEventListener(name, fn) { this.events[name] = fn; },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); }
  });
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const window = element();
  vm.runInNewContext(source, {
    document: { getElementById: id => nodes[id], createElement: element },
    window, fetch, AbortSignal, URLSearchParams, Date, Number
  });
  return { nodes, window };
}

test("owner listener aggregate is labeled and failures never appear as zero", async () => {
  let response = Response.json({ outcomes: { sources: { listeners: { status: "available", metrics: { currentListeners: 12 } } },
    window: { end: "2026-11-21T00:00:00.000Z" } } });
  const { nodes } = setup(async () => response);
  await nodes["evidence-listeners"].events.click();
  assert.match(nodes["evidence-listener-status"].textContent, /12 distinct opted-in members/);
  assert.match(nodes["evidence-listener-status"].textContent, /not a play count/);
  response = Response.json({}, { status: 403 });
  await nodes["evidence-listeners"].events.click();
  assert.match(nodes["evidence-listener-status"].textContent, /not authorized/);
  response = Response.json({ outcomes: { sources: { listeners: { status: "unavailable" } } } });
  await nodes["evidence-listeners"].events.click();
  assert.match(nodes["evidence-listener-status"].textContent, /unavailable/);
});

test("owner-scoped observations render safely and stale responses are discarded", async () => {
  let resolve;
  const calls = [];
  const { nodes, window } = setup((url, options) => {
    calls.push({ url, options });
    return new Promise(r => { resolve = r; });
  });
  nodes["evidence-song"].value = song;
  nodes["evidence-version"].value = version;
  const submit = () => nodes["evidence-form"].events.submit({ preventDefault() {} });
  let pending = submit();
  assert.match(calls[0].url, /songId=10000000/);
  assert.equal(calls[0].options.credentials, "same-origin");
  resolve(Response.json({ observations: [{ createdAt: "date", sha256: "<not markup>", byteSize: 1,
    matchesCurrentSource: true }], hasMore: false }));
  await pending;
  assert.match(nodes["evidence-master-list"].children[0].textContent, /<not markup>/);
  assert.match(nodes["evidence-master-list"].children[0].textContent, /authentication not checked/);
  pending = submit();
  nodes["evidence-song"].events.input();
  resolve(Response.json({ observations: [{ sha256: "stale" }] }));
  await pending;
  assert.equal(nodes["evidence-master-list"].children.length, 0);
  pending = submit();
  window.events.pagehide();
  resolve(Response.json({ observations: [{ sha256: "stale" }] }));
  await pending;
  assert.equal(nodes["evidence-master-list"].children.length, 0);
  nodes["evidence-song"].value = "bad";
  await submit();
  assert.match(nodes["evidence-master-status"].textContent, /valid lowercase/);
  assert.equal(calls.length, 3);
});
