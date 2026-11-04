import assert from "node:assert/strict";
import { inspectAudioStream } from "../lib/audio-stream-diagnostics.js";
import { diagnoseDreamweaverSong } from "./dreamweaver-live-diagnostic.mjs";

const origin = "https://halo.test";
const route = "/api/song-catalog/audio?versionId=private-id&dreamweaver=1";
for (const [status, type, body, expected] of [
  [404, "application/json", '{"message":"Song audio was not found"}', /HTTP 404.*Song audio was not found/],
  [403, "application/json", '{"message":"That song was not found or is not available"}', /HTTP 403.*Access was refused/],
  [503, "application/json", '{"message":"Master storage is not configured"}', /HTTP 503.*Master storage is not configured/],
  [200, "text/html", "<html>Not an audio route</html>", /document, not audio/],
  [206, "audio/wav", "RIFFaudio", /HTTP 206.*server returned audio/],
]) {
  let cancelled = false;
  const detail = await inspectAudioStream(route, {
    origin, fetcher: async (url, options) => {
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Range, "bytes=0-63");
      assert.equal(options.credentials, "same-origin");
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(body)); },
        cancel() { cancelled = true; },
      }), { status, headers: { "Content-Type": type } });
    },
  });
  assert.match(detail, expected);
  assert.equal(cancelled, true, "diagnostics never download an entire master");
  assert.doesNotMatch(detail, /private-id/, "diagnostic output omits query identifiers");
}
assert.match(await inspectAudioStream(route, { origin, fetcher: async () => { throw new TypeError("fetch failed"); } }), /network\/CORS/);
let fetched = false;
assert.match(await inspectAudioStream("https://storage.example/master?signature=secret", {
  origin, fetcher: async () => { fetched = true; },
}), /external/);
assert.equal(fetched, false, "diagnostics do not probe arbitrary external or signed URLs");
assert.match(await inspectAudioStream(route, {
  origin, timeoutMs: 1, fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  }),
}), /timed out/);
console.log("Audio diagnostics contracts passed: exact HTTP failures, bounded range reads, cancellation, timeout and query privacy.");

const songId = "7c082952-f3e5-4ac9-a902-359e673758f2";
for (const status of [206, 503]) {
  const requests = [];
  const logs = [];
  const run = diagnoseDreamweaverSong({
    origin, songId, log: value => logs.push(value),
    fetcher: async (value, options) => {
      const url = new URL(value);
      requests.push(url);
      if (url.pathname === "/api/release-catalog") {
        assert.equal(url.searchParams.get("songId"), songId);
        return Response.json({ releases: [{ catalog: { songId, masterCopy: {
          audioSource: `/api/song-catalog/audio?songId=${songId}&dreamweaver=1&versionId=example`,
        } } }] });
      }
      assert.equal(options.headers.Range, "bytes=0-63");
      return new Response(status === 206 ? "RIFFaudio" : '{"message":"Storage failed"}', {
        status, headers: { "Content-Type": status === 206 ? "audio/wav" : "application/json" },
      });
    },
  });
  if (status === 503) await assert.rejects(run, /did not return an audio response/);
  else await run;
  assert.equal(requests.length, 2, "live diagnostics probe only the exact song and its canonical audio route");
  assert.ok(logs.some(line => line.includes(`HTTP ${status}`)));
}
await assert.rejects(diagnoseDreamweaverSong({ origin: "http://halo.test", songId }), /HTTPS origin/);
await assert.rejects(diagnoseDreamweaverSong({ origin, songId: "invalid" }), /UUID/);
