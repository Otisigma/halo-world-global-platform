import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reviewRequest, reviews } from "../music-legacy-team/reviews.js";
import { requestPreflight } from "../lib/request-preflight.js";

test("three reviews use real council members and a complete advisory-only request", () => {
  assert.deepEqual(Object.keys(reviews), ["guardian", "builder", "advocate"]);
  for (const [key, target] of [["guardian", "sentinel"], ["builder", "atlas"], ["advocate", "bridge"]]) {
    const request = reviewRequest(key);
    assert.equal(request.targetAgent, target);
    assert.equal(request.approvePaidCalls, false);
    assert.equal(request.requestProposal, true);
    const preflight = requestPreflight({ ...request.request, originalRequest: request.message });
    assert.equal(preflight.status, "not tested");
    assert.equal(preflight.executionAuthorized, false);
    assert.match(request.request.constraints, /Do not claim tests ran/);
    assert.equal(reviewRequest(key, true).approvePaidCalls, true);
    assert.doesNotMatch(JSON.stringify(request), /https?:\/\/|password\s*[:=]|private.key\s*[:=]/i);
  }
  for (const key of ["constructor", "__proto__", "missing"]) assert.throws(() => reviewRequest(key), /valid review/);
  assert.throws(() => reviewRequest("builder", "true"), /valid review/);
});

test("private satellite uses the existing owner API without scheduling, uploads, or implementation authority", async () => {
  const [html, js, controlPage, api, docs, ci] = await Promise.all([
    readFile(new URL("../music-legacy-team/index.html", import.meta.url), "utf8"),
    readFile(new URL("../music-legacy-team/team.js", import.meta.url), "utf8"),
    readFile(new URL("../halo-command.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/halo-control-center.mjs", import.meta.url), "utf8"),
    readFile(new URL("../HALO_AGENT_TEAM.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  ]);
  assert.match(controlPage, /href="\/music-legacy-team\/"/);
  assert.match(html, /not three new independently running agents/);
  assert.match(html, /Nothing runs automatically|nothing runs automatically/);
  assert.match(html, /id="workspace"[^>]*hidden/);
  assert.match(html, /id="paid" type="checkbox"/);
  assert.doesNotMatch(html, /id="paid"[^>]*checked/);
  assert.match(js, /method: "HEAD"/);
  assert.match(js, /response.status !== 204/);
  assert.match(js, /method: "POST"/);
  assert.match(js, /credentials: "same-origin"/);
  assert.match(js, /deterministic-fallback/);
  assert.match(js, /Check the control center before retrying/);
  assert.doesNotMatch(js, /localStorage|indexedDB|setInterval|innerHTML|FormData/);
  assert.match(api, /if \(!isOwner\(user\)\)/);
  assert.match(api, /verifyRequestOrigin\(request\)/);
  assert.match(docs, /not new autonomous agents/);
  assert.match(ci, /npm run test:music-legacy-team/);
});
