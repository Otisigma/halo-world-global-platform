import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { requestPreflight, parseRequest, APPROVAL_BOUNDARIES } from "../lib/request-preflight.js";
import { previewCandidate, previewOrigin, loadPreviewCandidate } from "../lib/guard-drive-preview.js";
import { ReleaseGuardAgent } from "../release-guard-agent.js";

const request = {
  originalRequest: "Please try the Google Drive preview iframe before changing Dreamweaver.",
  intent: "Hear the chosen catalog song",
  requestedApproach: "Google Drive /file/d/{id}/preview iframe",
  expectedBehavior: "Manual play produces audible audio",
  affectedSurface: "Dreamweaver owner preview only",
  acceptanceCriteria: "Compare iframe and authorized proxy on desktop and mobile",
  constraints: "No autoplay, deployment, paid API calls, private data publication or production changes"
};
const report = requestPreflight(request);
assert.deepEqual(report.request, request);
assert.deepEqual(ReleaseGuardAgent.preflightRequest(request), report);
assert.equal(report.status, "not tested", "schema validation must never claim runtime feasibility");
assert.equal(report.executionAuthorized, false);
assert.equal(report.paidCalls, 0);
assert.deepEqual(report.approvalsRequired, APPROVAL_BOUNDARIES);
assert.equal(requestPreflight(request, { proposedApproach: "proxy only" }).status, "blocked");
assert.equal(requestPreflight({ ...request, requestedApproach: "proxy only" }).status, "blocked");
const unknown = requestPreflight("Do this now");
assert.equal(unknown.status, "blocked");
assert.match(unknown.nextStep, /requestedApproach/);
assert.equal(parseRequest(request.originalRequest).requestedApproach, request.originalRequest);
for (const input of [null, [], {}, { intent: "x".repeat(3001) }, { intent: 42 }]) assert.throws(() => requestPreflight(input));
for (const boundary of APPROVAL_BOUNDARIES) {
  const forged = requestPreflight({ ...request, approvals: [boundary], executionAuthorized: true, paidCalls: true });
  assert.equal(forged.executionAuthorized, false);
  assert.equal(forged.paidCalls, 0);
}

const origin = "https://halo-world-global-platform.netlify.app";
const track = {
  id: "fixture-track", title: "Fixture only", artist: "Test artist", public: true,
  driveFileId: "fixture_drive_only", bpm: 120, durationSeconds: 300,
  energyLevel: "Warm-up Groove", rotationStatus: "Fresh"
};
const catalog = { configured: true, version: 1, tracks: [track] };
const candidate = previewCandidate(catalog, origin);
assert.equal(candidate.iframe, `https://drive.google.com/file/d/${track.driveFileId}/preview`);
assert.equal(candidate.proxy, `${origin}/api/drive-catalog/audio?track=fixture-track`);
assert.throws(() => previewCandidate({ ...catalog, configured: false }, origin), /unconfigured/);
assert.throws(() => previewCandidate({ ...catalog, tracks: [] }, origin), /no eligible/);
assert.throws(() => previewCandidate({ ...catalog, tracks: [{ ...track, public: false }] }, origin), /no eligible/);
const externalPrimaryCatalog = { ...catalog, tracks: [{ ...track, primaryAudioPath: "https://other.example/song.mp3" }] };
const externalPrimary = previewCandidate(externalPrimaryCatalog, origin);
assert.equal(externalPrimary.primary, "", "unreviewed primary host must not be fetched");
assert.equal(externalPrimary.iframe, candidate.iframe, "primary host restrictions must not silently reject the requested iframe");
assert.equal(externalPrimary.proxy, candidate.proxy);
for (const bad of [
  "http://169.254.169.254", "https://evil.example", `${origin}.evil.example`,
  "https://halo-world-global-platform.netlify.app@evil.example",
  `${origin}/api/elsewhere`, `${origin}?url=https://evil.example`, `${origin}:8443`,
  "https://halo-world-global-platform.netlify.app\\@evil.example"
]) assert.throws(() => previewOrigin(bad));
for (const allowed of [origin, "http://127.0.0.1:3000", "https://deploy-preview-427--halo-world-global-platform.netlify.app"]) {
  assert.equal(previewOrigin(allowed), allowed);
}

let calls = 0;
const fetchFixture = async (url, options) => {
  calls++;
  assert.equal(url, `${origin}/api/drive-catalog`);
  assert.equal(options.redirect, "error");
  assert.equal(options.credentials, "omit");
  assert.ok(options.signal);
  return Response.json(catalog);
};
const fixture = await loadPreviewCandidate({ origin, source: "fixture", fetchImpl: fetchFixture });
assert.equal(calls, 1);
assert.equal(fixture.evidence.mocked, true);
assert.equal(fixture.evidence.source, "fixture");
assert.equal(fixture.evidence.playback, "not tested");
assert.match(fixture.evidence.observation, /Mocked/);
assert.doesNotMatch(JSON.stringify(fixture.evidence), /fixture_drive_only|fixture-track|Fixture only/);
const externalReport = await loadPreviewCandidate({ origin, source: "fixture", fetchImpl: async () => Response.json(externalPrimaryCatalog) });
assert.match(externalReport.evidence.observation, /only that probe is blocked/);
assert.equal(externalReport.candidate.iframe, candidate.iframe);
// Even an HTTP-shaped response labeled live-catalog cannot establish browser playback.
const liveShape = await loadPreviewCandidate({ origin, fetchImpl: fetchFixture });
assert.equal(liveShape.evidence.status, "partially feasible");
assert.equal(liveShape.evidence.playback, "not tested");
assert.equal(liveShape.evidence.mocked, false);
const initialCalls = calls;
assert.equal((await loadPreviewCandidate({ origin: "https://evil.example", fetchImpl: fetchFixture })).evidence.status, "blocked");
assert.equal(calls, initialCalls);
for (const fetchImpl of [
  async () => Response.json({ configured: false, tracks: [] }),
  async () => Response.json({ ...catalog, tracks: [] }),
  async () => new Response("private upstream marker", { status: 503 }),
  async () => new Response("x".repeat(1024 * 1024 + 1), { headers: { "Content-Type": "application/json" } }),
  async () => { throw new Error("private-file-url-and-response"); },
  async () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } })
]) {
  const unavailable = await loadPreviewCandidate({ origin, source: "fixture", fetchImpl });
  assert.equal(unavailable.candidate, null);
  assert.equal(unavailable.evidence.status, "blocked");
  assert.equal(unavailable.evidence.playback, "not tested");
  assert.doesNotMatch(JSON.stringify(unavailable.evidence), /private-|evil\.example/);
}
for (const fetchImpl of [
  () => new Promise(() => {}),
  async () => new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } })
]) {
  const timed = await loadPreviewCandidate({ origin, source: "fixture", timeoutMs: 15, fetchImpl });
  assert.match(timed.evidence.observation, /timed out/);
}
for (const timeoutMs of [0, 8001, NaN, Infinity]) {
  assert.equal((await loadPreviewCandidate({ origin, timeoutMs, fetchImpl: fetchFixture })).evidence.status, "blocked");
}

const read = file => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
// Execute the actual owner handler with identity/database boundaries stubbed, not a deployed auth test.
let user = null;
let sameOrigin = true;
let databaseCalls = 0;
const apiSource = (await read("netlify/functions/halo-control-center.mjs"))
  .replace(/^import .*;\n/gm, "").replace("export default async function", "async function").replace("export const config", "const config");
const sandbox = {
  Response, Request, Buffer, requestPreflight,
  getUser: async () => user, isOwner: value => value.owner === true,
  verifyRequestOrigin: async () => sameOrigin,
  getDatabase() { databaseCalls++; throw new Error("preflight must not open the database"); },
  console: { error() {} }
};
vm.createContext(sandbox);
vm.runInContext(apiSource, sandbox);
const invoke = async (body, headers = {}) => sandbox.haloControlCenterHandler(new Request(`${origin}/api/halo-control-center`, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body)
}));
assert.equal((await invoke({ action: "preflight", request })).status, 401);
user = { id: "fixture-owner", owner: false };
assert.equal((await invoke({ action: "preflight", request })).status, 403);
user.owner = true;
sameOrigin = false;
assert.equal((await invoke({ action: "preflight", request })).status, 403);
sameOrigin = true;
const ownerReport = await invoke({ action: "preflight", request });
assert.equal(ownerReport.status, 200);
assert.equal(ownerReport.headers.get("cache-control"), "private, no-store");
assert.deepEqual((await ownerReport.json()).preflight, report);
assert.equal((await invoke({ action: "preflight", request: {} })).status, 422);
assert.equal((await invoke({ action: "preflight", request: { intent: "x".repeat(9000) } }, { "Content-Length": "1" })).status, 413);
assert.equal(databaseCalls, 0);

// Exercise command preflight before paid synthesis, while preserving the existing SQL/action queue.
let paidCalls = 0;
const commandSource = (await read("netlify/lib/control-center.mjs")).replace(/^import .*;\n/gm, "").replace(/export async function/g, "async function");
const commandSandbox = {
  requestPreflight, actorIdFor: id => id, AGENT_ROLES: {}, AGENT_MODEL: "fixture-model",
  OpenAI: class { constructor() { paidCalls++; throw new Error("fixture paid call"); } },
  AbortSignal, console: { error() {} }
};
vm.createContext(commandSandbox);
vm.runInContext(commandSource, commandSandbox);
let assessment;
const db = { sql: async (strings, ...values) => {
  if (strings.join("").includes("UPDATE halo_agent_commands")) {
    assessment = JSON.parse(values[1]);
    return [{ id: 1, created_at: new Date().toISOString() }];
  }
  return [{ id: 1 }];
} };
for (const payload of [
  { message: request.originalRequest, requestProposal: false },
  { message: request.originalRequest, request, requestProposal: false },
  { message: request.originalRequest, request, proposedApproach: "proxy only", approvePaidCalls: true, requestProposal: false }
]) {
  await commandSandbox.createAgentCommand(db, { id: "owner" }, payload);
  assert.equal(assessment.preflight.paidCalls, 0);
  assert.equal(assessment.preflight.request.originalRequest, request.originalRequest);
}
assert.equal(paidCalls, 0, "default and blocked requests must never construct a paid client");
await commandSandbox.createAgentCommand(db, { id: "owner" }, { message: request.originalRequest, request, approvePaidCalls: true, requestProposal: false });
assert.equal(paidCalls, 1, "only explicit owner opt-in with complete request reaches optional synthesis");
assert.equal(assessment.preflight.executionAuthorized, false);

const previewJs = await read("halo-shield/preflight.js");
const previewHtml = await read("halo-shield/preflight.html");
const elements = new Map();
const nodes = id => {
  if (!elements.has(id)) elements.set(id, {
    value: "", textContent: "", disabled: true, handlers: {}, children: [],
    addEventListener(name, callback) { this.handlers[name] = callback; },
    querySelectorAll(name) { return this.children.filter(child => child.tag === name); },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); }
  });
  return elements.get(id);
};
let browserCatalogCalls = 0;
let ownerResponse = async () => Response.json({ preflight: report });
let expire;
const pageHandlers = {};
const browser = {
  document: {
    getElementById: nodes,
    createElement(tag) {
      return {
        tag, attributes: {}, pause() {}, load() {}, removeAttribute(key) { delete this[key]; },
        addEventListener() {}, setAttribute(key, value) { this.attributes[key] = value; }
      };
    },
    addEventListener(name, callback) { pageHandlers[name] = callback; }
  },
  window: { location: { origin }, addEventListener(name, callback) { pageHandlers[name] = callback; } },
  AbortSignal,
  fetch: (...args) => ownerResponse(...args),
  loadPreviewCandidate: async () => { browserCatalogCalls++; return fixture; },
  setTimeout(callback) { expire = callback; }, clearTimeout() {}
};
vm.createContext(browser);
vm.runInContext(previewJs.replace(/^import .*;\n/gm, ""), browser);
await nodes("load-candidate").handlers.click();
assert.equal(browserCatalogCalls, 0, "no data fetch before server owner authorization");
for (const field of Object.keys(request)) nodes(field).value = request[field];
ownerResponse = async () => new Response(null, { status: 403 });
await nodes("preflight-form").handlers.submit({ preventDefault() {} });
assert.equal(nodes("load-candidate").disabled, true);
ownerResponse = async () => Response.json({ preflight: report });
await nodes("preflight-form").handlers.submit({ preventDefault() {} });
assert.equal(nodes("load-candidate").disabled, false);
await nodes("load-candidate").handlers.click();
assert.equal(browserCatalogCalls, 1);
assert.equal(nodes("try-iframe").disabled, false);
await nodes("try-iframe").handlers.click();
assert.equal(nodes("preview-container").children[0].src, candidate.iframe);
assert.equal(nodes("preview-container").children[0].attributes.allow, "autoplay 'none'");
assert.doesNotMatch(nodes("preview-report").textContent, /fixture_drive_only|fixture-track/);
await nodes("try-proxy").handlers.click();
assert.equal(nodes("preview-container").children.length, 1);
assert.equal(nodes("preview-container").children[0].src, candidate.proxy);
assert.equal(nodes("preview-container").children[0].preload, "none");
expire();
assert.equal(nodes("preview-container").children.length, 0);
assert.equal(nodes("originalRequest").value, "");
assert.equal(nodes("try-iframe").disabled, true);
let finishOwner;
ownerResponse = () => new Promise(resolve => { finishOwner = resolve; });
const pendingOwner = nodes("preflight-form").handlers.submit({ preventDefault() {} });
pageHandlers.pagehide();
finishOwner(Response.json({ preflight: report }));
await pendingOwner;
assert.equal(nodes("load-candidate").disabled, true, "late authenticated responses cannot restore cleared data");
assert.equal(nodes("preflight-report").textContent, "Locked. Private request cleared.");
assert.doesNotMatch(previewJs + previewHtml, /localStorage|sessionStorage|innerHTML|\.play\(|YOUR_DRIVE_ID|fixture_drive_only/);
assert.match(previewJs, /60_000/);
assert.match(previewJs, /pagehide/);
assert.match(previewJs, /visibilitychange/);
assert.match(previewJs, /autoplay 'none'/);
assert.match(previewHtml, /not proof|not playback evidence/);
assert.match(await read("netlify.toml"), /frame-src https:\/\/drive\.google\.com/);
assert.doesNotMatch(await read("halo-shield/shield.js"), /preflight|driveFileId/);
console.log("HALO Guard preflight contracts passed (synthetic fixtures/stubbed identity; NO live playback tested).");
