import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MENU_ROUTE_REGISTRY } from "../lib/route-registry.js";
import { ORBIT_TIERS, SEEDED_CREATORS } from "../lib/halo-creator-seed.js";
import { layoutOrbits, orbitTierFor } from "../lib/halo-orbits.js";
import {
  COUNCIL_MIN_SCORE, GUARDIAN_ENGINE, HaloAIService, createCouncilReview,
  parseStemLines, scoreProjectHealth, validateStems, verifySplits
} from "../lib/halo-ai-service.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [html, client, styles, home] = await Promise.all([
  read("creator-network/index.html"), read("creator-network/orbits.js"), read("creator-network/network.css"), read("halo.html")
]);

// Creator Network surfaces: verified cards, HALO Orbits, Studio Guardian.
assert.match(html, /<script type="module" src="\/creator-network\/orbits.js"><\/script>/);
assert.match(html, /<script type="module" src="\/creator-network\/network.js"><\/script>/, "Creator Network retains the private workspace module");
for (const id of ["verifiedCreators", "orbits", "orbitMesh", "orbitDetail", "orbitLegend", "guardianDraft", "guardianDraftForm",
  "guardianScore", "guardianChecks", "guardianStems", "guardianSplits", "councilReview", "councilTicket"]) {
  assert.match(html, new RegExp(`id="${id}"`), `Creator Network renders #${id}`);
}
for (const id of ["guardianDraftForm", "guardianForm"]) {
  assert.equal([...html.matchAll(new RegExp(`<form\\b[^>]*\\bid="${id}"`, "g"))].length, 1, `Creator Network has one distinct #${id} form`);
}
assert.match(html, /<section\b[^>]*\bid="guardianDraft"/, "The browser-local Guardian draft has its own section");
assert.match(html, /<section\b[^>]*\bid="guardian"/, "The private Guardian keeps its section");
assert.match(client, /byId\("guardianDraftForm"\)/, "Orbits attaches only to the browser-local Guardian draft form");
assert.doesNotMatch(client, /byId\("guardianForm"\)/, "Orbits must not attach to the private Guardian form");
for (const route of ["/signal/", "/signal-network/"]) {
  assert.ok(MENU_ROUTE_REGISTRY.some(entry => entry.route === route), `Menu registry retains ${route}`);
  assert.match(home, new RegExp(`href="${route}" data-stat-event="[^"]+" data-stat-target="header"`), `Main menu retains ${route}`);
}
assert.match(html, /href="\/signal-network\/#feed"/, "Creator Network links to the backend public feed");
assert.match(html, /browser[- ]local/i, "The Guardian draft is explicitly labeled browser-local");
assert.match(html, /href="#orbits"/);
assert.match(html, /href="#guardian"/, "Studio Guardian navigation opens the private project-backed section");
assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|outerHTML|eval\(/);
assert.match(client, /createElementNS/, "Orbits render as SVG nodes");
assert.match(client, /from "\/lib\/halo-ai-service.js"/);
assert.match(styles, /\.orbit-node/);
assert.match(styles, /\.guardian-report/);

// HALO Orbits layout.
assert.deepEqual(ORBIT_TIERS.map(tier => tier.label), ["Core Studio Vault", "Inner Crew", "Network Peers", "Public Signal"]);
assert.equal(orbitTierFor({ orbitTier: "unknown" }), "public", "Unknown tiers fall back to the public ring");
const layout = layoutOrbits([...SEEDED_CREATORS, { id: "fan", displayName: "Fan", orbitTier: "public" }], { size: 640 });
assert.equal(layout.rings.length, 4);
assert.ok(layout.rings.every((ring, index) => index === 0 || ring.radius > layout.rings[index - 1].radius), "Rings expand outward");
assert.deepEqual(layout.rings.map(ring => ring.count), [1, 1, 1, 1]);
const halo = layout.nodes.find(node => node.id === "dj-halo");
assert.deepEqual([halo.x, halo.y], [320, 320], "A lone vault owner sits at the core");
for (const node of layout.nodes) {
  assert.ok(node.x >= 0 && node.x <= 640 && node.y >= 0 && node.y <= 640, `${node.id} stays on the canvas`);
  const ring = layout.rings.find(item => item.id === node.tier);
  if (node.tier !== "core") assert.ok(Math.abs(Math.hypot(node.x - 320, node.y - 320) - ring.radius) < 0.1, `${node.id} sits on its ring`);
}

// Stem validation.
const stems = parseStemLines("Kick.wav 48000 24 212.4\nPads.mp3 44100 16 200\n\nVox.WAV 44100 24 212.2");
assert.equal(stems.length, 3);
assert.equal(stems[2].format, "wav");
const stemReport = validateStems(stems);
assert.equal(stemReport.passed, false);
assert.deepEqual(stemReport.stems.map(stem => stem.passed), [true, false, true]);
assert.equal(stemReport.stems[1].issues.length, 3, "MP3, 16-bit, and short duration are all flagged");
assert.equal(validateStems([]).passed, false);
assert.match(validateStems([{ name: "a.wav", sampleRate: 48000, bitDepth: 24, durationSec: 1 }, { name: "A.wav", sampleRate: 48000, bitDepth: 24, durationSec: 1 }]).stems[1].issues[0], /Duplicate/);
assert.equal(validateStems(parseStemLines("Kick.wav 48000 24 200\nBass.flac 96000 32 200")).passed, true);

// 50/50 split verification.
assert.equal(verifySplits([{ party: "DJ Halo", share: 50 }, { party: "DJ Butterfly", share: 50 }]).passed, true);
assert.equal(verifySplits([{ party: "DJ Halo", share: 60 }, { party: "DJ Butterfly", share: 40 }]).passed, false);
assert.equal(verifySplits([{ party: "DJ Halo", share: 60 }, { party: "DJ Butterfly", share: 40 }], { policy: "custom" }).passed, true);
assert.equal(verifySplits([{ party: "DJ Halo", share: 50 }, { party: "dj halo", share: 50 }]).passed, false, "Duplicate parties fail");
assert.equal(verifySplits([{ party: "DJ Halo", share: 100 }]).passed, false, "50/50 needs two parties");
assert.equal(verifySplits([{ party: "", share: 50 }, { party: "B", share: 50 }]).passed, false);
assert.equal(verifySplits([]).passed, false);
assert.equal(verifySplits("nope").passed, false);

// Project health scoring + council review.
const ready = {
  title: "Vault Session 01", artist: "DJ Halo", bpm: 122, musicalKey: "A minor", isrc: "GB-ABC-26-00001",
  hasMaster: true, hasArtwork: true, stems: parseStemLines("Kick.wav 48000 24 200\nBass.wav 48000 24 200"),
  splits: [{ party: "DJ Halo", share: 50 }, { party: "DJ Butterfly", share: 50 }]
};
const health = scoreProjectHealth(ready);
assert.equal(health.score, 100);
assert.equal(health.grade, "Release ready");
assert.equal(health.checks.reduce((sum, check) => sum + check.weight, 0), 100);
const empty = scoreProjectHealth({});
assert.equal(empty.score, 0);
assert.match(empty.nextAction, /^Next:/);
const council = createCouncilReview(ready, health, { now: new Date("2026-10-03T00:00:00Z") });
assert.equal(council.status, "queued");
assert.equal(council.requiresHumanApproval, true, "AI can never release without a human");
assert.equal(council.requestedAt, "2026-10-03T00:00:00.000Z");
assert.deepEqual(council.lanes, ["A&R", "Rights + splits", "Mastering"]);
const unsplit = { ...ready, splits: [{ party: "DJ Halo", share: 70 }, { party: "DJ Butterfly", share: 30 }] };
const blocked = createCouncilReview(unsplit);
assert.equal(scoreProjectHealth(unsplit).score >= COUNCIL_MIN_SCORE, true);
assert.equal(blocked.status, "blocked", "Unverified splits block council review even with a passing score");
assert.ok(blocked.blockers.some(item => /Splits/.test(item)));
assert.equal(createCouncilReview({}).status, "blocked");

// HaloAIService: local engine is authoritative; remote transport is advisory only.
assert.equal(GUARDIAN_ENGINE.plannedRemoteModel, "gemini-2.5-flash");
const local = await new HaloAIService().review(ready);
assert.equal(local.engine, GUARDIAN_ENGINE.local);
assert.equal(local.advisory, null);
let sent;
const remote = await new HaloAIService({ transport: async payload => { sent = payload; return { advisory: "Tighten the low end.", score: 0, status: "released" }; } }).review(ready);
assert.equal(sent.model, "gemini-2.5-flash");
assert.equal(remote.advisory, "Tighten the low end.");
assert.equal(remote.health.score, 100, "Remote output cannot override local scoring");
assert.equal(remote.council.status, "queued", "Remote output cannot change council status");
const failing = await new HaloAIService({ transport: async () => { throw new Error("offline"); } }).review(ready);
assert.equal(failing.advisory, null, "Transport failures degrade to the local engine");

console.log("Studio Guardian contracts passed: orbits layout, stem validation, 50/50 splits, health scoring, council review");
