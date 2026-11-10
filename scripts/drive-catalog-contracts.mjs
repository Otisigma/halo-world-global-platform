import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createDriveCatalogService, driveCatalogConfig } from "../netlify/lib/drive-catalog.mjs";
import catalogHandler, { config as catalogRoute } from "../netlify/functions/drive-catalog.mjs";
import audioHandler, { config as audioRoute } from "../netlify/functions/drive-catalog-audio.mjs";

const folderId = "masters_folder_123";
const fileId = "audio_file_12345";
const indexId = "catalog_index_123";
const settings = { folderId, clientEmail: "catalog@example.test", privateKey: "test-key" };
const track = {
  id: "summer-mix", title: "Summer", artist: "HALO", bpm: 124, durationSeconds: 180,
  energyLevel: "Build-up", rotationStatus: "Fresh", driveFileId: fileId, public: true,
};
const indexMetadata = { id: indexId, name: "catalog-index.json", parents: [folderId], trashed: false, size: "500" };
const assetMetadata = { id: fileId, parents: [folderId], trashed: false, size: "1000", mimeType: "audio/mpeg" };
const request = (path = "/api/drive-catalog", options) => new Request(`https://halo.test${path}`, options);
const audioRequest = options => request(`/api/drive-catalog/audio?track=${encodeURIComponent(track.id)}`, options);

function fixture(options = {}) {
  const calls = [];
  let clock = 1;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    assert.equal(init.redirect, "error", "upstream redirects must never carry service credentials");
    assert.ok(init.signal, "all upstream requests have timeouts");
    if (url.href === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "mock-access" });
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(new Headers(init.headers).get("authorization"), ["Bearer", "mock-access"].join(" "));
    if (options.fail) throw new Error("secret-provider-diagnostic");
    if (url.pathname === "/drive/v3/files") {
      assert.ok(url.searchParams.get("q").includes(`'${folderId}' in parents`));
      if (!url.searchParams.has("pageToken")) return Response.json({ files: [], nextPageToken: "page-two" });
      assert.equal(url.searchParams.get("pageToken"), "page-two");
      return Response.json({ files: options.indexes || [indexMetadata] });
    }
    if (url.pathname.endsWith(`/${indexId}`)) {
      if (options.indexResponse) return options.indexResponse();
      return Response.json(options.index || { version: 1, tracks: [track] });
    }
    if (options.assetResponse && url.searchParams.get("alt") !== "media") {
      return options.assetResponse(url.pathname.split("/").at(-1));
    }
    assert.equal(url.pathname, `/drive/v3/files/${fileId}`, "requests may only use verified catalog asset IDs");
    if (url.searchParams.get("alt") !== "media") return Response.json({ ...assetMetadata, ...options.asset });
    if (options.audioResponse) return options.audioResponse(init);
    const headers = { "Content-Type": "audio/mpeg", "Content-Length": "4", "Accept-Ranges": "bytes" };
    return new Response(init.method === "HEAD" ? null : new Uint8Array([73, 68, 51, 0]), { headers });
  };
  const service = createDriveCatalogService({
    config: settings,
    fetchImpl,
    getAccessToken: async () => "mock-access",
    now: () => clock,
    ...options.service,
  });
  return { ...service, calls, advance: milliseconds => { clock += milliseconds; }, fetchImpl };
}

test("Netlify public routes are declared and unconfigured mode preserves legacy catalog", async () => {
  assert.equal(catalogRoute.path, "/api/drive-catalog");
  assert.equal(audioRoute.path, "/api/drive-catalog/audio");
  assert.equal(typeof catalogHandler, "function");
  assert.equal(typeof audioHandler, "function");
  const service = createDriveCatalogService({ config: null, fetchImpl: () => assert.fail("No upstream without config") });
  const response = await service.catalogHandler(request());
  assert.deepEqual(await response.json(), { configured: false, tracks: [] });
  assert.equal((await service.audioHandler(audioRequest())).status, 404);
});

test("actual paginated ingestion, verification, canonical stream URLs and 60-second cache", async () => {
  const service = fixture();
  const response = await service.catalogHandler(request());
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.version, 1);
  assert.equal(catalog.configured, true);
  assert.equal(catalog.tracks[0].streamUrl, `/api/drive-catalog/audio?track=${encodeURIComponent(track.id)}`);
  assert.equal(catalog.tracks[0].fallbackUrl, catalog.tracks[0].streamUrl);
  assert.equal(service.calls.length, 4, "two pages, index media and asset verification");
  await service.catalogHandler(request());
  assert.equal(service.calls.length, 4);
  service.advance(60_001);
  await service.catalogHandler(request());
  assert.equal(service.calls.length, 8);
});

test("linked-song proxy resolution only accepts an already allowlisted Drive asset", async () => {
  const service = fixture();
  assert.equal(await service.resolveAudioProxy(["https://unrelated.test/song.mp3"]), "");
  assert.equal(service.calls.length, 0, "non-Drive sources do not initiate catalog transport");
  const share = `https://drive.google.com/file/d/${fileId}/view`;
  const proxy = await service.resolveAudioProxy([share]);
  assert.equal(proxy, `/api/drive-catalog/audio?track=${track.id}`);
  assert.ok(!proxy.includes(fileId), "a binding exposes only the public catalog key, never the raw Drive identifier");
  assert.equal(await service.resolveAudioProxy(["https://drive.google.com/file/d/unapproved_file_123/view"]), "");
  assert.equal((await service.audioHandler(request(proxy))).status, 200);
  const privateCatalog = fixture({ index: { version: 1, tracks: [{ ...track, public: false }] } });
  assert.equal(await privateCatalog.resolveAudioProxy([share]), "", "a private manifest record cannot authorize a linked release");
});

test("partial or invalid Drive configuration is configured failure, not legacy fallback", async () => {
  assert.equal(driveCatalogConfig({}), null);
  for (const env of [
    { GOOGLE_DRIVE_MASTERS_FOLDER_ID: folderId },
    { GOOGLE_SERVICE_ACCOUNT_JSON: "{invalid" },
    { GOOGLE_SERVICE_ACCOUNT_EMAIL: "catalog@example.test" },
    { GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "invalid" },
    { GOOGLE_DRIVE_MASTERS_FOLDER_ID: "../invalid", GOOGLE_SERVICE_ACCOUNT_EMAIL: "catalog@example.test", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "PRIVATE KEY" },
  ]) {
    const service = createDriveCatalogService({
      config: () => driveCatalogConfig(env),
      fetchImpl: () => assert.fail("Invalid configuration must not contact Google"),
    });
    const response = await service.catalogHandler(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).configured, true);
    assert.equal((await service.audioHandler(audioRequest())).status, 503);
    assert.equal((await service.audioHandler(audioRequest({ method: "OPTIONS" }))).status, 204);
  }
});

test("verification and allowlist use normalized IDs and Drive fallback references", async () => {
  const service = fixture({ index: { version: 1, tracks: [{
    ...track, id: ` ${track.id} `, driveFileId: undefined,
    googleDriveFallbackUrl: `https://drive.google.com/file/d/${fileId}/view`,
  }] } });
  const response = await service.catalogHandler(request());
  assert.equal(response.status, 200);
  const canonical = (await response.json()).tracks[0];
  assert.equal(canonical.id, track.id);
  assert.equal(canonical.driveFileId, fileId);
  assert.equal(canonical.public, true);
  assert.equal((await service.audioHandler(audioRequest())).status, 200);
});

test("asset verification uses at most six concurrent requests and deduplicates shared assets", async () => {
  let active = 0;
  let peak = 0;
  let verified = 0;
  const tracks = Array.from({ length: 14 }, (_, index) => ({
    ...track, id: `track-${index}`, driveFileId: `audio_file_${index % 13}_123`,
  }));
  const service = fixture({
    index: { version: 1, tracks },
    async assetResponse(id) {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      verified++;
      return Response.json({ ...assetMetadata, id });
    },
  });
  const response = await service.catalogHandler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tracks.length, 14);
  assert.equal(verified, 13);
  assert.equal(peak, 6, "parallel verification is bounded to six");
});

test("service-account token exchange is reused with timed, redirect-safe fetch", async () => {
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  const upstream = fixture();
  const service = createDriveCatalogService({ config: { ...settings, privateKey }, fetchImpl: upstream.fetchImpl });
  assert.equal((await service.catalogHandler(request())).status, 200);
  assert.equal(upstream.calls[0].url.origin, "https://oauth2.googleapis.com");
  assert.equal(upstream.calls[0].init.method, "POST");
});

test("only explicit publication consent is normalized and allowlisted; primary path is retained", async () => {
  const primary = "/public/audio/example.mp3";
  const service = fixture({ index: { version: 1, tracks: [
    { ...track, primaryAudioPath: primary },
    { id: "draft", public: false, driveFileId: "outside-private" },
    { id: "missing-flag" }, { id: "string-flag", public: "true" }, null,
  ] } });
  const catalog = await (await service.catalogHandler(request())).json();
  assert.equal(catalog.tracks.length, 1);
  assert.equal(catalog.tracks[0].primaryAudioPath, primary);
  assert.equal(catalog.tracks[0].streamUrl, primary);
  assert.ok(catalog.tracks[0].fallbackUrl.startsWith("/api/drive-catalog/audio?track="));
  const before = service.calls.length;
  for (const id of ["draft", "missing-flag", "string-flag", fileId, "https://evil.test/audio"]) {
    assert.equal((await service.audioHandler(request(`/api/drive-catalog/audio?track=${encodeURIComponent(id)}`))).status, 404);
  }
  assert.equal(service.calls.length, before, "unknown IDs never trigger media fetches");
});

test("invalid, ambiguous, oversized and out-of-folder catalogs fail closed", async () => {
  const cases = [
    { indexes: [] },
    { indexes: [indexMetadata, { ...indexMetadata, id: "another_index_123" }] },
    { indexes: [{ ...indexMetadata, parents: ["other_folder_123"] }] },
    { index: { version: 2, tracks: [track] } },
    { index: { version: 1, tracks: [{ ...track, bpm: "invalid" }] } },
    { index: { version: 1, tracks: [{ ...track, driveFileId: "../outside" }] } },
    { asset: { parents: ["other_folder_123"] } },
    { asset: { trashed: true } }, { asset: { size: "0" } },
    { asset: { mimeType: "text/html" } },
    { asset: { id: "different_audio_123" } },
    { indexResponse: () => new Response("<html>Google error</html>", { headers: { "Content-Type": "text/html" } }) },
    { indexResponse: () => new Response("x", { headers: { "Content-Length": String(1024 * 1024 + 1) } }) },
    { indexResponse: () => new Response(" ".repeat(1024 * 1024 + 1)) },
  ];
  for (const options of cases) {
    const response = await fixture(options).catalogHandler(request());
    assert.equal(response.status, 503, JSON.stringify(options));
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.ok(!(await response.text()).includes("Google error"));
  }
});

test("GET proxies bounded-memory audio with CORS; HEAD never reads media", async () => {
  const service = fixture();
  const response = await service.audioHandler(audioRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store", "mutable public catalog media is not immutable");
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-expose-headers"), /Content-Length/);
  assert.match(response.headers.get("access-control-expose-headers"), /Content-Range/);
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 0]);
  const head = await service.audioHandler(audioRequest({ method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers.get("content-length"), "4");
  assert.equal(service.calls.at(-1).init.method, "HEAD");
});

test("Range, 206 and 416 preserve upstream semantics", async () => {
  const service = fixture({ audioResponse(init) {
    assert.equal(init.headers.Range, "bytes=1-2");
    return new Response(new Uint8Array([68, 51]), { status: 206, headers: {
      "Content-Type": "audio/mpeg", "Content-Range": "bytes 1-2/4", "Content-Length": "2", "Accept-Ranges": "bytes",
    } });
  } });
  const response = await service.audioHandler(audioRequest({ headers: { Range: "bytes=1-2" } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("content-range"), "bytes 1-2/4");
  assert.equal((await response.arrayBuffer()).byteLength, 2);
  const invalidRange = fixture({ audioResponse: () => new Response("private error details", {
    status: 416, headers: { "Content-Range": "bytes */4", "Content-Type": "application/json" },
  }) });
  const rejected = await invalidRange.audioHandler(audioRequest({ headers: { Range: "bytes=100-" } }));
  assert.equal(rejected.status, 416);
  assert.equal(rejected.headers.get("cache-control"), "no-store");
  assert.equal(rejected.headers.get("content-range"), "bytes */4");
  assert.equal(await rejected.text(), "");
});

test("successful audio advertises byte ranges even when Drive omits Accept-Ranges", async () => {
  const service = fixture({ audioResponse: init => new Response(init.method === "HEAD" ? null : "ID3!", {
    headers: { "Content-Type": "audio/mpeg", "Content-Length": "4" },
  }) });
  for (const method of ["GET", "HEAD"]) {
    const response = await service.audioHandler(audioRequest({ method }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    if (method === "GET") assert.equal(await response.text(), "ID3!");
  }
});

test("private HTML/errors and upstream failures return friendly CORS responses; OPTIONS always works", async () => {
  for (const options of [
    { fail: true },
    { audioResponse: () => new Response("<html>private login</html>", { headers: { "Content-Type": "text/html" } }) },
    { audioResponse: () => new Response("<!doctype html><html>private login", { headers: { "Content-Type": "audio/mpeg" } }) },
    { audioResponse: () => Response.json({ error: "private secret" }, { status: 403 }) },
    { audioResponse: () => new Response(null, { status: 302, headers: { Location: "https://evil.test/" } }) },
  ]) {
    const service = fixture(options);
    const response = await service.audioHandler(audioRequest());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.doesNotMatch(await response.text(), /secret|private login|evil\.test/);
    for (const handler of [service.audioHandler, service.catalogHandler]) {
      const preflight = await handler(request("/api/drive-catalog/audio", { method: "OPTIONS" }));
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
      assert.equal((await handler(request("/api/drive-catalog", { method: "POST" }))).status, 405);
    }
  }
});

test("audio first-byte timeout fails safely instead of hanging", async () => {
  const service = fixture({
    service: { timeoutMs: 10 },
    audioResponse: () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), {
      headers: { "Content-Type": "audio/mpeg" },
    }),
  });
  assert.equal((await service.audioHandler(audioRequest())).status, 503);
});

test("refresh failures do not retain expired publication grants", async () => {
  let fail = false;
  const upstream = fixture();
  let clock = 1;
  const service = createDriveCatalogService({
    config: settings, getAccessToken: async () => "mock-access", now: () => clock,
    fetchImpl: (...args) => {
      if (fail) throw new Error("provider failed");
      return upstream.fetchImpl(...args);
    },
  });
  assert.equal((await service.catalogHandler(request())).status, 200);
  clock += 60_001;
  fail = true;
  assert.equal((await service.audioHandler(audioRequest())).status, 503);
});
