import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import {
  compareFileToManifest,
  createCatalogMasterProvenanceApi,
  createMasterProvenanceController,
  MAX_LOCAL_COMPARISON_BYTES,
} from "../song-catalog/master-provenance-panel.js";

const songId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const otherSongId = "33333333-3333-4333-8333-333333333333";
const observationId = "44444444-4444-4444-8444-444444444444";
const olderObservationId = "55555555-5555-4555-8555-555555555555";
const createdAt = "2026-11-08T03:00:00.000Z";
const bytes = new TextEncoder().encode("the exact master bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const observation = {
  observationId, createdAt, sha256, byteSize: bytes.byteLength,
  sourceType: "chunks", matchesCurrentSource: true, recordAuthenticated: "not_checked",
};
const historyResponse = {
  songId, versionId, observations: [observation], hasMore: false,
  limitation: "Observation of bytes read; source may change after the read.",
};
const manifest = { observationId, sha256, byteSize: bytes.byteLength, createdAt, limitation: "not a certificate" };
{
  for (const [code, expected] of [["provenance_keys_missing", "keys_missing"], ["provenance_schema_missing", "schema_missing"]]) {
    let repaired = false, observeCalls = 0;
    const api = createCatalogMasterProvenanceApi({ fetchImpl: async () => repaired
      ? Response.json({ ...historyResponse, observations: [] })
      : Response.json({ code, message: "setup required" }, { status: 503 }) });
    const controller = createMasterProvenanceController({ songId, versionId,
      api: { ...api, observe: async () => { observeCalls++; throw new Error("must not run while setup is missing"); } } });
    await controller.refreshHistory();
    assert.equal(controller.getState().status, expected);
    await controller.observe();
    assert.equal(observeCalls, 0);
    repaired = true;
    await controller.refreshHistory();
    assert.equal(controller.getState().historyState, "loaded");
    assert.equal(controller.getState().status, "not_checked", "refresh restores controls after repair even with no history");
    controller.dispose();
  }
}
{
  let manifestReads = 0;
  let currentManifest = manifest;
  const controller = createMasterProvenanceController({
    songId, versionId, authenticateStamp: true,
    api: {
      getHistory: async () => ({ observations: [observation], hasMore: false }),
      getManifest: async () => { manifestReads++; return currentManifest; },
      verify: async () => ({ result: "observed_bytes_differ" }),
    },
  });
  assert.equal(controller.getState().stampRecord, null);
  await controller.refreshHistory();
  assert.deepEqual(controller.getState().stampRecord, manifest);
  assert.equal(manifestReads, 1, "stamp authentication does not re-read audio");
  await controller.verify();
  assert.equal(controller.getState().stampRecord, null, "changed bytes hide the song stamp");
  currentManifest = { ...manifest, sha256: "0".repeat(64) };
  await controller.refreshHistory();
  assert.equal(controller.getState().stampRecord, null);
  assert.match(controller.getState().stampError, /could not be authenticated/);
  controller.dispose();
}
{
  let resolveManifest;
  const controller = createMasterProvenanceController({
    songId, versionId, authenticateStamp: true,
    api: {
      getHistory: async () => ({ observations: [observation], hasMore: false }),
      getManifest: () => new Promise(resolve => { resolveManifest = resolve; }),
    },
  });
  const pending = controller.refreshHistory();
  await new Promise(resolve => setImmediate(resolve));
  controller.dispose();
  resolveManifest(manifest);
  await pending;
  assert.equal(controller.getState().stampRecord, null, "switching songs discards late stamp authentication");
}
{
  const controller = createMasterProvenanceController({
    songId, versionId, authenticateStamp: true,
    api: {
      getHistory: async () => ({ observations: [], hasMore: false }),
      getManifest: async () => { throw new Error("must not authenticate a missing record"); },
    },
  });
  await controller.refreshHistory();
  assert.equal(controller.getState().stampRecord, null, "unstamped songs never receive a decorative badge");
  controller.dispose();
}
const localFile = content => ({
  size: content.byteLength,
  async arrayBuffer() {
    return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
  },
});

{
  const requests = [];
  const api = createCatalogMasterProvenanceApi({
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url, "https://halo.test"), options });
      if (options.method === "GET" && !new URL(url, "https://halo.test").searchParams.has("action")) {
        return Response.json(historyResponse);
      }
      if (options.method === "GET") return Response.json(manifest);
      return Response.json({ result: new URL(url, "https://halo.test").searchParams.get("action") === "observe" ? "observed" : "observed_bytes_match" });
    },
  });
  assert.deepEqual(await api.getHistory({ songId, versionId }), {
    observations: [observation], hasMore: false, limitation: historyResponse.limitation,
  });
  const observed = await api.observe({ songId, versionId });
  assert.equal(observed.result, "observed");
  assert.equal((await api.verify({ songId, versionId, observationId })).result, "observed_bytes_match");
  assert.deepEqual(await api.getManifest({ songId, versionId, observationId }), manifest);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url.searchParams.get("songId"), songId);
  assert.equal(requests[0].url.searchParams.get("versionId"), versionId);
  assert.equal(requests[0].url.searchParams.has("action"), false, "history uses the authenticated GET collection route");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].url.searchParams.get("action"), "observe");
  assert.equal(requests[1].url.searchParams.get("songId"), songId);
  assert.equal(requests[2].url.searchParams.get("observationId"), observationId);
  assert.equal(requests[3].url.searchParams.get("action"), "manifest");
  for (const request of requests) assert.equal(request.options.body, undefined, "audio and observation metadata are never posted in the request body");
}

for (const [status, expected, body] of [
  [401, "unauthenticated", {}],
  [403, "forbidden", {}],
  [404, "not_found", {}],
  [409, "stale", { result: "stale" }],
  [409, "record_unverified", { message: "Observation record failed authentication" }],
  [409, "unsupported_source", { message: "No supported stored master is available" }],
  [409, "error", {}],
  [429, "rate_limited", {}],
  [503, "unavailable", {}],
  [400, "error", {}],
]) {
  const api = createCatalogMasterProvenanceApi({ fetchImpl: async () => Response.json(body, { status }) });
  await assert.rejects(api.verify({ songId, versionId, observationId }), error => error.result === expected);
}

{
  const api = createCatalogMasterProvenanceApi({
    fetchImpl: async () => Response.json({ ...historyResponse, songId: otherSongId }),
  });
  await assert.rejects(api.getHistory({ songId, versionId }), /did not match the selected master/);
  const malformedHistory = {
    ...historyResponse,
    observations: [
      observation,
      { ...observation, observationId: "not-a-uuid" },
      { ...observation, recordAuthenticated: "authenticated" },
      { ...observation, sha256: "not-a-hash" },
      { ...observation, observationId: olderObservationId, matchesCurrentSource: false },
    ],
  };
  const filtered = createCatalogMasterProvenanceApi({ fetchImpl: async () => Response.json(malformedHistory) });
  assert.deepEqual((await filtered.getHistory({ songId, versionId })).observations.map(item => item.matchesCurrentSource), [true, false],
    "valid observations remain visible, including those whose source identity no longer matches");
  const filteredHistory = await filtered.getHistory({ songId, versionId });
  assert.equal(filteredHistory.observations[0].recordAuthenticated, "not_checked");
}

{
  const goodManifest = { ...manifest };
  assert.equal(await compareFileToManifest(localFile(bytes), goodManifest, { cryptoProvider: webcrypto }), "file_bytes_match");
  assert.equal(await compareFileToManifest(localFile(new TextEncoder().encode("changed bytes")), goodManifest, { cryptoProvider: webcrypto }), "file_bytes_differ");
  let readCount = 0;
  const wrongSizeFile = { size: bytes.byteLength + 1, arrayBuffer() { readCount++; throw new Error("must not read"); } };
  assert.equal(await compareFileToManifest(wrongSizeFile, goodManifest, { cryptoProvider: webcrypto }), "file_bytes_differ");
  assert.equal(readCount, 0, "size mismatch short-circuits before reading the file");
  const tooLarge = { size: MAX_LOCAL_COMPARISON_BYTES + 1, arrayBuffer() { readCount++; } };
  await assert.rejects(compareFileToManifest(tooLarge, goodManifest, { cryptoProvider: webcrypto }), /100 MiB/);
  assert.equal(readCount, 0, "files beyond the bounded memory budget are rejected before read");
  await assert.rejects(compareFileToManifest(localFile(bytes), goodManifest, { cryptoProvider: {} }), /securely compare/);
  await assert.rejects(compareFileToManifest(localFile(bytes), { ...goodManifest, sha256: "bad" }, { cryptoProvider: webcrypto }), /manifest is invalid/);
}

{
  const calls = [];
  const api = {
    getHistory: async request => { calls.push(["history", request]); return { observations: [observation], hasMore: false, limitation: "Mutable source." }; },
    observe: async request => { calls.push(["observe", request]); return { result: "observed", ...manifest }; },
    verify: async request => { calls.push(["verify", request]); return { result: "observed_bytes_match" }; },
    getManifest: async request => { calls.push(["manifest", request]); return manifest; },
  };
  const controller = createMasterProvenanceController({ songId, versionId, api, cryptoProvider: webcrypto });
  await controller.refreshHistory();
  assert.equal(controller.getState().historyState, "loaded");
  assert.equal(controller.getState().selectedObservationId, observationId, "refresh selects the newest valid observation for the current source");
  assert.equal(controller.getState().selectedObservation.recordAuthenticated, "not_checked",
    "history does not claim server authentication until comparison");
  assert.equal(controller.getState().limitation, "Mutable source.");
  assert.deepEqual(calls[0], ["history", { songId, versionId }]);
  assert.equal(await controller.verify(), "observed_bytes_match");
  assert.deepEqual(calls[1], ["verify", { songId, versionId, observationId }]);
  assert.ok(controller.getState().authenticatedObservationIds.includes(observationId));

  assert.equal(await controller.compareFile(localFile(bytes)), "file_bytes_match");
  assert.deepEqual(calls[2], ["manifest", { songId, versionId, observationId }]);
  assert.equal(controller.getState().status, "file_bytes_match");
  assert.ok(controller.getState().authenticatedObservationIds.includes(observationId));
  assert.equal(calls.some(([, request]) => request?.file), false, "local files are not included in any API request");
  controller.dispose();
}

{
  const controller = createMasterProvenanceController({
    songId, versionId,
    api: {
      getHistory: async () => ({ observations: [observation], hasMore: false }),
      verify: async () => ({ result: "stale" }),
    },
  });
  await controller.refreshHistory();
  assert.equal(await controller.verify(), "stale");
  assert.equal(controller.getState().selectedObservationId, "");
  assert.equal(controller.getState().observations[0].matchesCurrentSource, false);
  assert.ok(controller.getState().authenticatedObservationIds.includes(observationId),
    "the server checked the observation record before reporting its source stale");
  controller.dispose();
}

{
  const api = createCatalogMasterProvenanceApi({
    fetchImpl: async (url, options) => options.method === "GET"
      ? Response.json(historyResponse)
      : Response.json({ result: "stale" }, { status: 409 }),
  });
  const controller = createMasterProvenanceController({ songId, versionId, api });
  await controller.refreshHistory();
  assert.equal(await controller.verify(), "stale");
  assert.equal(controller.getState().selectedObservationId, "");
  assert.equal(controller.getState().observations[0].matchesCurrentSource, false);
  controller.dispose();
}

{
  const recentButDifferentSource = {
    ...observation,
    observationId: olderObservationId,
    createdAt: "2026-11-08T03:01:00.000Z",
    matchesCurrentSource: false,
  };
  const controller = createMasterProvenanceController({
    songId, versionId,
    api: { getHistory: async () => ({ observations: [observation, recentButDifferentSource], hasMore: false }) },
  });
  await controller.refreshHistory();
  assert.equal(controller.getState().observations[0].observationId, olderObservationId, "history is ordered newest first");
  assert.equal(controller.getState().selectedObservationId, observationId,
    "refresh selects the newest valid observation that still matches the source identity");
  assert.equal(controller.selectObservation(olderObservationId), false, "an old source identity cannot be selected for current-source comparison");
  controller.dispose();
}

{
  let resolveHistory;
  const updates = [];
  const controller = createMasterProvenanceController({
    songId, versionId,
    api: { getHistory: () => new Promise(resolve => { resolveHistory = resolve; }) },
    onStateChange: state => updates.push(state),
  });
  const pending = controller.refreshHistory();
  controller.dispose();
  const updateCount = updates.length;
  resolveHistory(historyResponse);
  await pending;
  assert.equal(controller.getState().observations.length, 0, "disposed panel discards late private history");
  assert.equal(updates.length, updateCount, "disposed panel does not publish late owner data");
}

{
  let resolveManifest;
  const updates = [];
  const controller = createMasterProvenanceController({
    songId, versionId,
    api: {
      getHistory: async () => ({ observations: [observation], hasMore: false }),
      getManifest: () => new Promise(resolve => { resolveManifest = resolve; }),
    },
    cryptoProvider: webcrypto,
    onStateChange: state => updates.push(state),
  });
  await controller.refreshHistory();
  const pending = controller.compareFile(localFile(bytes));
  await new Promise(resolve => setImmediate(resolve));
  controller.dispose();
  const updateCount = updates.length;
  resolveManifest(manifest);
  await pending;
  assert.equal(updates.length, updateCount, "switching away during manifest fetch cannot publish stale file-comparison state");
  assert.equal(controller.getState().observations.length, 0);
}

{
  const source = await readFile(new URL("../song-catalog/song-catalog.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../song-catalog/index.html", import.meta.url), "utf8");
  assert.match(source, /!state\.authenticated\|\|!song\|\|!master/);
  assert.match(source, /version\.versionType==="sale_master"&&version\.isCanonicalMaster===true/,
    "integration only displays the selected owner's canonical sale master");
  assert.match(source, /masterProvenancePanel\?\.dispose\(\)/, "switching songs disposes prior private panel");
  assert.match(source, /masterProvenanceScope!==scope|scope!==masterProvenanceScope/,
    "song/master changes remount with isolated scope");
  assert.match(source, /createCatalogMasterProvenanceApi/);
  assert.match(html, /id="masterProvenancePanel"/);
  assert.match(html, /master-provenance\.css/);
}

const panel = await readFile(new URL("../song-catalog/master-provenance-panel.js", import.meta.url), "utf8");
const css = await readFile(new URL("../song-catalog/master-provenance.css", import.meta.url), "utf8");
assert.match(panel, /aria-live="polite"/);
assert.match(panel, /record\.recordAuthenticated !== "not_checked"/);
assert.match(panel, /Record authentication: not checked/);
assert.match(panel, /An observation records bytes the service read from a mutable source/);
assert.match(panel, /Stored-byte observation and comparison share a limit of one expensive read per owner per minute/);
assert.match(panel, /The file is never uploaded/);
assert.match(panel, /const result = await controller\.compareFile[\s\S]*?if \(!mounted\) return;/, "a disposed panel cannot publish a late file result into a newly mounted panel");
assert.match(panel, /MAX_LOCAL_COMPARISON_BYTES = 100 \* 1024 \* 1024/);
assert.doesNotMatch(panel, /HALO_PROVENANCE_KEYS|HALO_PROVENANCE_ACTIVE_KEY/);
assert.doesNotMatch(panel, /site operator|redeploy|database migration|docs\/master-provenance-foundation/);
assert.match(panel, /query\("\.master-provenance-panel__actions"\)\.hidden=setupUnavailable/);
assert.match(panel, /query\("\.master-provenance-panel__file"\)\.hidden=setupUnavailable/);
{
  const { provenanceFailure } = await import("../netlify/lib/master-provenance-errors.mjs");
  for (const code of ["provenance_keys_missing", "42P01", "ECONNRESET"]) {
    const result = provenanceFailure({ code });
    assert.doesNotMatch(result.message, /HALO_|operator|migration|redeploy|docs\//);
    assert.match(result.message, /do not need to upload it again/);
    assert.match(result.message, /No verified stamp|No verification result/);
  }
}
assert.match(css, /:focus-visible/);
assert.match(css, /@media \(max-width: 600px\)/);
assert.match(css, /min-height: 44px/);
console.log("Owner-scoped master observation integration contracts passed.");
