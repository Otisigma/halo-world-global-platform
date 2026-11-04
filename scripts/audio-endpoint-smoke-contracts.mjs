import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { buildAudioProbeUrls, runAudioEndpointSmoke } from "./audio-endpoint-smoke.mjs";

const fixture = Buffer.alloc(128);
fixture.write("RIFF", 0);
fixture.writeUInt32LE(120, 4);
fixture.write("WAVE", 8);

const ids = {
  driveTrackId: "drive-track",
  songId: "11111111-1111-4111-8111-111111111111",
  songVersionId: "22222222-2222-4222-8222-222222222222",
  radioTrackId: "radio-track",
  mixId: "mix-track",
  stemPackId: "stem-pack",
  stemType: "full"
};
const server = createServer((request, response) => {
  if (request.headers.authorization) authorizedPaths.push(new URL(request.url, "http://localhost").pathname);
  if (request.headers.range !== "bytes=0-63") {
    response.writeHead(400).end();
    return;
  }
  response.writeHead(206, {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": "64",
    "Content-Range": "bytes 0-63/128",
    "Content-Type": "audio/wav"
  });
  response.end(fixture.subarray(0, 64));
});
const authorizedPaths = [];
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;

try {
  const urls = buildAudioProbeUrls({ origin, ...ids });
  assert.deepEqual(urls.map(({ url }) => url.pathname), [
    "/api/drive-catalog/audio",
    "/api/song-catalog/audio",
    "/api/radio/audio",
    "/api/mixes/audio",
    "/api/stem-vault/audio"
  ]);
  assert.equal(urls[0].url.searchParams.get("track"), ids.driveTrackId);
  assert.equal(urls[1].url.searchParams.get("songId"), ids.songId);
  assert.equal(urls[1].url.searchParams.get("versionId"), ids.songVersionId);
  assert.equal(urls[1].url.searchParams.get("dreamweaver"), "1");
  assert.equal(urls[2].url.searchParams.get("id"), ids.radioTrackId);
  assert.equal(urls[3].url.searchParams.get("id"), ids.mixId);
  assert.equal(urls[4].url.searchParams.get("pack"), ids.stemPackId);
  assert.equal(urls[4].url.searchParams.get("stem"), ids.stemType);
  assert.throws(() => buildAudioProbeUrls({ ...ids, origin: "http://example.com" }), /HTTPS/);
  assert.throws(() => buildAudioProbeUrls({ ...ids, stemType: "unknown", origin }), /STEM_TYPE/);
  assert.throws(() => buildAudioProbeUrls({ ...ids, driveTrackId: "", origin }), /DRIVE_TRACK_ID/);

  const logs = [];
  const results = await runAudioEndpointSmoke({
    origin,
    ids,
    authorization: "Bearer fixture-token",
    log: message => logs.push(message)
  });
  assert.equal(results.length, 5);
  assert.equal(logs.length, 5);
  assert.ok(logs.every(line => line.startsWith("PASS ")));
  assert.deepEqual(authorizedPaths, ["/api/stem-vault/audio"], "the private-stem token is sent only to that route");

  const failingServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<html>not audio</html>");
  });
  failingServer.listen(0, "127.0.0.1");
  await once(failingServer, "listening");
  try {
    await assert.rejects(runAudioEndpointSmoke({
      origin: `http://127.0.0.1:${failingServer.address().port}`,
      ids,
      log: () => {}
    }), /expected HTTP 206/);
  } finally {
    failingServer.close();
    await once(failingServer, "close");
  }

  const oversizedServer = createServer((_request, response) => {
    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": "128",
      "Content-Range": "bytes 0-63/128",
      "Content-Type": "audio/wav"
    }).end(fixture);
  });
  oversizedServer.listen(0, "127.0.0.1");
  await once(oversizedServer, "listening");
  try {
    await assert.rejects(runAudioEndpointSmoke({
      origin: `http://127.0.0.1:${oversizedServer.address().port}`,
      ids,
      log: () => {}
    }), /exceeded the requested byte-range limit/);
  } finally {
    oversizedServer.close();
    await once(oversizedServer, "close");
  }
} finally {
  server.close();
  await once(server, "close");
}

console.log("Audio endpoint live-probe contracts passed: all five routes, range/media validation, and error detection.");
