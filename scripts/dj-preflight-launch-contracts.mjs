import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { analyzeSetPreflight, analyzeTransition } from "../netlify/lib/dj-preflight.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, preflightApi, intelligenceApi, aiDj, deck, campaignApi, campaignClient, partyStyles, personas] = await Promise.all([
  read("netlify/database/migrations/20260815160000_add-dj-preflight-and-listening-party-launches.sql"),
  read("netlify/functions/set-preflight.mjs"),
  read("netlify/functions/dj-intelligence.mjs"),
  read("netlify/functions/ai-dj.mjs"),
  read("dj-deck.html"),
  read("netlify/functions/fan-campaigns.mjs"),
  read("campaign-studio/campaign-studio.js"),
  read("campaign-studio/party-effects.css"),
  read("netlify/lib/radio-personas.mjs")
]);

const vocalHandoff = analyzeTransition(
  { id: "out", bpm: 124, key: "8A", vocalDensity: 8, bassWeight: 6, hasStems: true },
  { id: "in", bpm: 125, key: "8A", vocalDensity: 8, bassWeight: 6, hasStems: true }
);
assert.equal(vocalHandoff.style, "vocal-handoff");
assert.match(vocalHandoff.guardrail, /both lead vocals/i);
assert.equal(vocalHandoff.vocalRevealBars, 24);
assert.equal(vocalHandoff.anticipationPlan.architecture, "release-breath-discovery-anticipation-reveal");
assert.match(vocalHandoff.anticipationPlan.revealInstruction, /incoming lead vocal muted/i);
assert.equal(vocalHandoff.signatureMotif, "none");

const unsafeVocalBlend = analyzeTransition(
  { id: "out", bpm: 124, key: "8A", vocalDensity: 9, bassWeight: 6 },
  { id: "in", bpm: 142, key: "2B", vocalDensity: 9, bassWeight: 6 }
);
assert.equal(unsafeVocalBlend.style, "clean-break");
assert.equal(unsafeVocalBlend.status, "blocked");

const report = analyzeSetPreflight({
  title: "Contract set",
  personaId: "butterfly",
  seed: 42,
  tracks: [
    { id: "a", title: "A", artist: "One", bpm: 122, key: "8A", vocalDensity: 3, bassWeight: 5 },
    { id: "b", title: "B", artist: "Two", bpm: 123, key: "9A", vocalDensity: 2, bassWeight: 5 },
    { id: "c", title: "C", artist: "Three", bpm: 124, key: "9B", vocalDensity: 4, bassWeight: 6 }
  ]
});
assert.equal(report.orderedTracks.length, 3);
assert.equal(report.transitions.length, 2);
assert.ok(report.qualityScore > 0);
assert.ok(report.fingerprint.includes(":"));
assert.ok(report.transitions.every(transition => transition.anticipationPlan?.groove));
assert.ok(report.transitions.every(transition => transition.vocalGapSeconds === 5));
assert.ok(report.transitions.every(transition => transition.incomingStartSeconds === 0));
assert.ok(report.transitions.every((transition, index, transitions) => index === 0 || transition.signatureMotif !== "hay-lo-swell" || transitions[index - 1].signatureMotif !== "hay-lo-swell"));

const deduplicatedReport = analyzeSetPreflight({
  title: "No repeat set",
  tracks: [
    { id: "same", title: "Same", bpm: 124, key: "8A" },
    { id: "same", title: "Same duplicate", bpm: 124, key: "8A" },
    { id: "next", title: "Next", bpm: 125, key: "9A" }
  ]
});
assert.deepEqual(deduplicatedReport.orderedTracks.map(track => track.id).sort(), ["next", "same"]);

const sparseReport = analyzeSetPreflight({
  tracks: [
    { id: "upload", title: null, bpm: 124, key: "8A", stemTypes: [null, undefined, " VOCALS "] },
    { id: "upload", bpm: 124 },
    { id: "import", artist: null, bpm: 125, key: "9A" }
  ]
});
assert.equal(sparseReport.orderedTracks.length, 2);
assert.equal(sparseReport.transitions.length, 1);
assert.ok(Number.isFinite(sparseReport.qualityScore));
assert.ok(sparseReport.orderedTracks.every(track => typeof track.title === "string" && typeof track.artist === "string"));

function deckFunction(name) {
  const start = deck.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = deck.slice(start).search(/\n    (?:async )?function /);
  return deck.slice(start, end < 0 ? deck.length : start + end);
}

const planning = {
  tracks: [],
  deckState: { A: { id: "active", title: "Active", bpm: 124, key: "8A", energy: 5 }, B: {} },
  elements: {
    mixIntent: { value: "hold" }, setPhase: { value: "build" },
    crossfader: { value: "0" }, analyzeSet: {}, aiBrief: {},
    preflightPersona: { value: "halo" }, energyCurve: { value: "steady" }
  },
  djMode: "listening",
  modeProfiles: { listening: { breathBars: [16, 32], character: "patient", transition: "long-blend" } },
  trackQueue: [], currentRecommendation: null,
  takeoverSession: null, djSessionId: "test",
  audioEngine: { context: null }, recordingState: { transitionHistory: [] },
  window: {},
  document: { querySelector: () => ({ textContent: "80" }) },
  haloBreathPlan: () => ({}),
  renderArtistJourneyGuidance() {},
  applyRecommendation(recommendation, mode) { planning.applied = { recommendation, mode }; },
  showToast(title, message) { planning.toast = { title, message }; }
};
vm.createContext(planning);
vm.runInContext([
  deck.match(/const TRACK_DNA_DEFAULTS = .*?;/)[0],
  ...["trackText", "activeDeckId", "trackHasPlayableAudio", "camelotCompatibility", "scoreTrack", "localAssistantTeam", "recommendLocally"].map(deckFunction),
  `async ${deckFunction("analyzeSet")}`
].join("\n"), planning);

for (const weather of [undefined, null, "", "   ", 42, false, { description: "Warm" }, "Warm AND Spacious"]) {
  planning.tracks = [
    { id: "seeded", title: "Seeded", bpm: 124, key: "8A", sonicWeather: "Seeded weather", energy: 5 },
    { id: "drive", title: "Folder upload", bpm: 124, key: "--", energy: 3, audioAsset: { file: {} }, sonicWeather: weather }
  ];
  const recommendation = planning.recommendLocally();
  assert.equal(recommendation.trackId, "drive", "Playable uploads win over metadata-only seeds");
  const expected = String(weather ?? "").trim() || "Balanced, groove-led and open enough for a patient blend.";
  assert.equal(recommendation.sonicWeather, expected);
  assert.ok(recommendation.whyThisTrack.endsWith(expected.toLowerCase()));
}
planning.tracks = [{ id: "import", title: "Imported link", bpm: 120, key: "--" }];
assert.equal(planning.recommendLocally().trackId, "import", "Metadata-only imports remain valid local candidates");

const recommend = planning.recommendLocally;
planning.recommendLocally = () => { throw new Error("Broken local plan"); };
planning.fetch = () => { assert.fail("Cloud must not run after local planning fails"); };
await planning.analyzeSet();
assert.equal(planning.elements.analyzeSet.disabled, false);
assert.equal(planning.elements.analyzeSet.textContent, "Analyze set");
assert.match(planning.elements.aiBrief.textContent, /Local planning failed: Broken local plan/);
assert.equal(planning.toast.title, "Local planning unavailable");
assert.equal(planning.currentRecommendation, null, "Failed planning clears stale recommendations");
planning.recommendLocally = () => null;
await planning.analyzeSet();
assert.equal(planning.elements.analyzeSet.disabled, false, "No candidates also restores the controls");
planning.recommendLocally = recommend;
planning.fetch = async () => { throw new Error("Cloud offline"); };
await planning.analyzeSet();
assert.equal(planning.applied.mode, "Local brain", "Cloud failures retain a successful local plan");
assert.equal(planning.elements.analyzeSet.disabled, false);

const checks = [
  [migration.includes("halo_dj_set_preflights") && migration.includes("halo_dj_transition_observations"), "stores set reports and transition outcomes in Netlify Database"],
  [migration.includes("halo_dj_external_signals") && migration.includes("authorized_api"), "stores authorized external learning signals without scraping"],
  [preflightApi.includes("analyzeSetPreflight") && preflightApi.includes("verifyRequestOrigin(request);") && !preflightApi.includes("await verifyRequestOrigin(request)") && !preflightApi.includes("!verifyRequestOrigin(request)"), "accepts valid same-origin preflight requests without weakening origin protection"],
  [(deck.match(/fetch\("\/api\/set-preflight"/g) || []).length === 2 && (deck.match(/credentials: "same-origin"/g) || []).length >= 2, "sends the active HALO session with manual and takeover preflight requests"],
  [deck.includes("Run full preflight") && deck.includes("collectPreflightTracks") && deck.includes("preflight-transition"), "adds full-set preflight to the DJ Deck"],
  [deck.includes("recordTransitionObservation") && intelligenceApi.includes('action === "transition"'), "records prepared and performed transition evidence"],
  [intelligenceApi.includes('action === "external_signal"') && intelligenceApi.includes("EXTERNAL_METRICS"), "accepts bounded authorized platform metrics"],
  [campaignApi.includes('body.action === "launch"') && campaignApi.includes("launchPack"), "creates a one-action listening-party launch pack"],
  [campaignClient.includes("Create launch pack + go live") && campaignClient.includes("data-share-party"), "adds launch and native sharing controls to Dreamweaver"],
  [partyStyles.includes("party-atmosphere") && partyStyles.includes("prefers-reduced-motion"), "adds accessible confetti, streamers, and starlight atmospheres"],
  [personas.includes("transitionOutcomeScore") && personas.includes("externalEngagementScore"), "feeds transition and external response into persona evaluation"],
  [personas.includes("signatureMotif") && personas.includes("vocalRevealBars"), "carries selective HALO identity and delayed-vocal staging into resident plans"],
  [aiDj.includes("HALO_DJ_MIXING_DOCTRINE") && aiDj.includes("breathPlan") && aiDj.includes("bridgeElement"), "applies the five-stage HALO BREATH doctrine to cloud AI transition decisions"],
  [deck.includes("HALO BREATH") && deck.includes("scheduleBreathStages") && deck.includes("cleanRatio"), "executes mode-aware breath stages while protecting full-song listening time"],
  [deck.includes("matchDeckLevels") && deck.includes("Math.max(5000") && deck.includes("source.start(startAt, 0)"), "starts incoming records at zero, matches their level, and preserves a five-second vocal gap"],
  [deck.includes("buildTakeoverPlan") && deck.includes("recordingState.takeoverPlan") && deck.includes("playedTrackIds"), "builds one complete DJ takeover order and enforces a no-repeat ledger"],
  [deck.includes('"clean-break"') && deck.includes("plan.hardCut") && deck.includes("setStemState(incomingDeck, \"vocals\", false"), "blocks lead-vocal crossover with stem handoffs or a true clean break"],
  [deck.includes("Takeover quality control") && deck.includes("updateTakeoverQualityControl"), "shows live sequence, vocal, repeat, and continuity quality control"],
  [deck.includes('/dj-continuity-guard.js') && deck.includes("attachContinuityGuardToDeck") && deck.includes("CONTINUITY BRIDGE ACTIVE"), "arms the shared continuity guard and exposes bridge state in the live master readout"],
  [deck.includes("continuity: { ...audioHealth.continuity }") && deck.includes("continuity: { ...audioHealth.continuity },") && deck.includes("Sync live telemetry"), "includes continuity state in deck health and live telemetry sync payloads"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`DJ preflight and launch contracts: ${checks.length}/${checks.length} checks passed.`);
