import assert from "node:assert/strict";
import aiDjHandler from "../netlify/functions/ai-dj.mjs";
import resolveTrackHandler from "../netlify/functions/resolve-track.mjs";
import releasePackHandler from "../netlify/functions/release-pack.mjs";
import releaseCatalogHandler from "../netlify/functions/release-catalog.mjs";
import haloCompanionHandler from "../netlify/functions/halo-companion.mjs";

async function expectStatus(handler, request, expectedStatus) {
  const response = await handler(request);
  assert.equal(response.status, expectedStatus);
  return response;
}

await expectStatus(aiDjHandler, new Request("https://halo.test/api/ai-dj", { method: "GET" }), 405);
await expectStatus(releasePackHandler, new Request("https://halo.test/api/release-pack", { method: "DELETE" }), 405);
await expectStatus(releaseCatalogHandler, new Request("https://halo.test/api/release-catalog", { method: "POST" }), 405);
await expectStatus(haloCompanionHandler, new Request("https://halo.test/api/halo-companion", { method: "GET" }), 405);

await expectStatus(
  resolveTrackHandler,
  new Request("https://halo.test/api/resolve-track", {
    method: "POST",
    headers: { Origin: "https://outside.test", "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://bandcamp.com/track/example" })
  }),
  403
);

await expectStatus(
  resolveTrackHandler,
  new Request("https://halo.test/api/resolve-track", {
    method: "POST",
    headers: { "Content-Length": "9000", "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://bandcamp.com/track/example" })
  }),
  413
);

const originalFetch = globalThis.fetch;
let outboundCalls = 0;
globalThis.fetch = async () => {
  outboundCalls += 1;
  return new Response(null, { status: 302, headers: { Location: "https://outside.test/private" } });
};

try {
  await expectStatus(
    resolveTrackHandler,
    new Request("https://halo.test/api/resolve-track", {
      method: "POST",
      headers: { Origin: "https://halo.test", "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://artist.bandcamp.com/track/example" })
    }),
    502
  );
  assert.equal(outboundCalls, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("HALO security contracts: 7/7 checks passed.");
