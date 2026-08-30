/**
 * HALO World production smoke contracts.
 *
 * Run after a main deploy:
 *   npm run -s deploy:verify
 *
 * Override the target for a deploy preview or custom domain:
 *   HALO_PRODUCTION_URL=https://example.netlify.app npm run -s deploy:verify
 */

import assert from "node:assert/strict";

const defaultSiteUrl = "https://halo-world-global-platform.netlify.app";
const siteUrl = new URL(process.env.HALO_PRODUCTION_URL || process.argv[2] || defaultSiteUrl);
const results = [];

const report = (name, passed, detail) => {
  const prefix = passed ? "PASS" : "FAIL";
  console.log(`${prefix}: ${name}${detail ? ` — ${detail}` : ""}`);
  results.push({ name, passed });
};

const fetchResponse = async (path, options = {}) => {
  const url = new URL(path, siteUrl);
  url.searchParams.set("deploy-health", Date.now().toString());
  return fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    ...options
  });
};

const check = async (name, callback) => {
  try {
    const detail = await callback();
    report(name, true, detail);
  } catch (error) {
    report(name, false, error.message);
  }
};

await check("Production homepage", async () => {
  const response = await fetchResponse("/");
  const html = await response.text();
  assert.equal(response.status, 200, `Expected HTTP 200, received ${response.status}.`);
  assert.match(html, /<title>HALO Music World — Artist-Controlled Music Infrastructure<\/title>/, "The public HALO homepage was not served.");
  assert.match(html, /Build Your Album/i, "The homepage does not visibly promote Build Your Album.");
  assert.match(html, /href=["']\/album-concierge\//, "The homepage does not link to /album-concierge/.");
  return `${response.url} serves the current public homepage`;
});

await check("Build Your Album page", async () => {
  const response = await fetchResponse("/album-concierge/");
  const html = await response.text();
  assert.equal(response.status, 200, `Expected HTTP 200, received ${response.status}.`);
  assert.match(html, /<title>Album Concierge — HALO World<\/title>/, "The route fell back to a different page.");
  assert.match(html, /id=["']step-1["']/, "The guided album flow entrypoint is missing.");
  assert.match(html, /src=["']\/album-concierge\/album-concierge\.js["']/, "The album flow controller is missing.");
  return `${response.url} serves the Album Concierge flow`;
});

await check("Album Concierge API route", async () => {
  const response = await fetchResponse("/api/album-concierge", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: siteUrl.origin
    }
  });
  const contentType = response.headers.get("content-type") || "";
  assert.notEqual(response.status, 200, "The API path returned a static HTML fallback instead of the Netlify Function.");
  assert.match(contentType, /application\/json/i, `Expected a JSON API response, received ${contentType || "no content type"}.`);
  assert.ok([400, 401, 403, 405].includes(response.status), `Expected an authentication or request validation response, received ${response.status}.`);
  return `/api/album-concierge responds through the Netlify Function (${response.status})`;
});

const failures = results.filter(result => !result.passed);
console.log(`Production site summary: ${results.length - failures.length}/${results.length} checks passed for ${siteUrl.origin}.`);
if (failures.length) process.exitCode = 1;
