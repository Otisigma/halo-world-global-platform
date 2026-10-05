import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COUNCIL_PILLARS,
  DJCouncilEngine,
  DJ_COUNCIL_VERSION,
  createSignalMeter,
  evaluateDJCouncil,
  isMixDeliverable,
  normalizeIsrc,
  resolveCouncilProfile
} from "../services/djCouncilEngine.js";
import { djCouncilBadgeMarkup } from "../dj-council-badge.js";

const [deckPage, mixesApi, badgeCss] = await Promise.all([
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/mixes.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dj-council-badge.css", import.meta.url), "utf8")
]);

let checks = 0;
function check(label, run) {
  run();
  checks += 1;
  return label;
}

const keys = ["8A", "8B", "9B", "9A", "10A", "10B", "11B", "11A", "12A"];
function passingMix(overrides = {}) {
  return {
    profile: "club",
    targetMinutes: 60,
    durationSeconds: 3580,
    masterBpm: 124,
    transitionsCompleted: 8,
    playbackFaults: 0,
    tracks: keys.map((key, index) => ({
      id: `track-${index}`,
      title: `Track ${index}`,
      artist: "HALO",
      bpm: 123 + (index % 3),
      key,
      energy: 4 + (index % 5),
      catalogId: `halo:track-${index}`,
      source: "HALO Library"
    })),
    signal: {
      preflightPassed: true, humDetected: false, integratedLufs: -14.3, peakDbfs: -1.4,
      cleanup: { clean: true, reliable: true, isolationSecure: true, humDetected: false, noiseFloorDbfs: -110, peakDbfs: -1.4 }
    },
    attribution: { remixer: "DJ HALO", credit: "Remix by DJ HALO" },
    ...overrides
  };
}

function failing(verdict, checkId) {
  const entry = verdict.checks.find(item => item.id === checkId);
  assert.ok(entry, `${checkId} is evaluated`);
  assert.equal(entry.status, "fail", `${checkId} fails`);
  assert.equal(entry.blocking, true, `${checkId} blocks delivery`);
  assert.equal(verdict.pass, false, `${checkId} keeps the mix out of delivery`);
  assert.equal(isMixDeliverable(verdict), false);
  assert.ok(verdict.recommendations.some(item => item.checkId === checkId && item.priority === "blocker" && item.message), `${checkId} surfaces an actionable fix`);
}

// ---- Pass path -------------------------------------------------------------------------------
const passed = evaluateDJCouncil(passingMix());
check("passing mix is deliverable", () => {
  assert.equal(passed.version, DJ_COUNCIL_VERSION);
  assert.equal(passed.pass, true);
  assert.equal(passed.deliverable, true);
  assert.ok(passed.score >= passed.passScore && passed.score <= 100);
  assert.equal(isMixDeliverable(passed), true);
  assert.deepEqual(passed.pillars.map(pillar => pillar.id), ["signal", "mechanics", "rights", "audience"]);
  assert.ok(passed.pillars.every(pillar => pillar.status === "pass"));
  assert.equal(passed.recommendations.length, 0);
  assert.equal(passed.profile, "house");
});
check("verdict is deterministic", () => {
  assert.deepEqual(evaluateDJCouncil(passingMix()), passed);
  assert.equal(JSON.stringify(evaluateDJCouncil(passingMix())), JSON.stringify(passed));
});
check("ISRC verification counts as cleared rights", () => {
  const mix = passingMix();
  mix.tracks = mix.tracks.map((track, index) => ({ ...track, catalogId: "", isrc: `GB-HLO-26-0000${index}`.padEnd(15, "0").slice(0, 15) }));
  assert.equal(normalizeIsrc("GB-HLO-26-00001"), "GBHLO2600001");
  assert.equal(normalizeIsrc("not-an-isrc"), "");
  assert.equal(evaluateDJCouncil(mix).pass, true);
});
check("vault stems with permission pass", () => {
  const mix = passingMix();
  mix.tracks[0] = { ...mix.tracks[0], stemsUsed: true, stemPermission: true };
  assert.equal(evaluateDJCouncil(mix).pass, true);
});

// ---- Fail paths ------------------------------------------------------------------------------
check("hum blocks delivery", () => failing(evaluateDJCouncil(passingMix({ signal: { ...passingMix().signal, humDetected: true, humFrequency: 50 } })), "signal.hum"));
for (const cleanup of [undefined, {}, { clean: true }, { ...passingMix().signal.cleanup, reliable: false }, { ...passingMix().signal.cleanup, clean: false }, { ...passingMix().signal.cleanup, isolationSecure: false }, { ...passingMix().signal.cleanup, humDetected: true }]) {
  check("missing or failed cleanup audit blocks delivery", () => failing(evaluateDJCouncil(passingMix({ signal: { ...passingMix().signal, cleanup } })), "signal.cleanup"));
}
check("missing recorder preflight blocks delivery", () => failing(evaluateDJCouncil(passingMix({ signal: { ...passingMix().signal, preflightPassed: false } })), "signal.hum"));
check("loudness far from -14 LUFS blocks delivery", () => failing(evaluateDJCouncil(passingMix({ signal: { ...passingMix().signal, integratedLufs: -5 } })), "signal.loudness"));
check("unmetered loudness blocks delivery", () => failing(evaluateDJCouncil(passingMix({ signal: { preflightPassed: true } })), "signal.loudness"));
check("loudness just outside window is advisory", () => {
  const verdict = evaluateDJCouncil(passingMix({ signal: { ...passingMix().signal, integratedLufs: -10.5 } }));
  const entry = verdict.checks.find(item => item.id === "signal.loudness");
  assert.equal(entry.status, "warn");
  assert.equal(entry.blocking, false);
  assert.match(entry.recommendation, /Lower the master/);
});
check("clipping blocks delivery", () => failing(evaluateDJCouncil(passingMix({ signal: { ...passingMix().signal, peakDbfs: 0 } })), "signal.peak"));
check("house tempo far from 124 BPM blocks delivery", () => failing(evaluateDJCouncil(passingMix({ masterBpm: 132 })), "mechanics.tempo-target"));
check("tempo target is advisory outside the house profile", () => {
  const verdict = evaluateDJCouncil(passingMix({ profile: "listening", masterBpm: 160 }));
  assert.equal(verdict.checks.find(item => item.id === "mechanics.tempo-target").blocking, false);
  assert.equal(resolveCouncilProfile("club").targetBpm, 124);
});
check("tempo jumps between neighbours block delivery", () => {
  const mix = passingMix();
  mix.tracks[4] = { ...mix.tracks[4], bpm: 140 };
  failing(evaluateDJCouncil(mix), "mechanics.tempo-alignment");
});
check("playback faults block delivery", () => failing(evaluateDJCouncil(passingMix({ playbackFaults: 1 })), "mechanics.continuity"));
check("repeats block delivery", () => {
  const mix = passingMix();
  mix.tracks[3] = { ...mix.tracks[1] };
  failing(evaluateDJCouncil(mix), "mechanics.continuity");
});
check("incomplete transitions block delivery", () => failing(evaluateDJCouncil(passingMix({ transitionsCompleted: 3 })), "mechanics.continuity"));
check("unverified catalog/ISRC blocks delivery", () => {
  const mix = passingMix();
  mix.tracks[2] = { ...mix.tracks[2], catalogId: "", isrc: "", source: "Music service" };
  const verdict = evaluateDJCouncil(mix);
  failing(verdict, "rights.catalog");
  assert.match(verdict.checks.find(item => item.id === "rights.catalog").detail, /Track 2/);
});
check("stems without permission block delivery", () => {
  const mix = passingMix();
  mix.tracks[0] = { ...mix.tracks[0], stemsUsed: true, stemPermission: false };
  failing(evaluateDJCouncil(mix), "rights.stems");
});
check("missing remix attribution blocks delivery", () => failing(evaluateDJCouncil(passingMix({ attribution: {} })), "rights.attribution"));
check("short takeover blocks delivery", () => failing(evaluateDJCouncil(passingMix({ durationSeconds: 25 * 60 })), "audience.duration"));
check("overrun takeover blocks delivery", () => failing(evaluateDJCouncil(passingMix({ durationSeconds: 65 * 60 })), "audience.duration"));
check("30-minute takeover window is honoured", () => assert.equal(evaluateDJCouncil(passingMix({ targetMinutes: 30, durationSeconds: 1790 })).pass, true));
check("empty payload is never deliverable", () => {
  const verdict = evaluateDJCouncil({});
  assert.equal(verdict.pass, false);
  assert.equal(isMixDeliverable(verdict), false);
  assert.equal(isMixDeliverable(null), false);
  assert.equal(isMixDeliverable({ pass: true, deliverable: true, version: "forged", checks: [] }), false);
});
check("score below pass mark blocks delivery even without a blocker", () => {
  const engine = new DJCouncilEngine({ rules: { passScore: 101 } });
  const verdict = engine.evaluate(passingMix());
  assert.equal(verdict.pass, false);
  assert.ok(verdict.recommendations.some(item => item.checkId === "council.score"));
});

// ---- Extensibility ---------------------------------------------------------------------------
check("new specialist checks can be registered", () => {
  const engine = new DJCouncilEngine();
  engine.registerCheck({ id: "audience.explicit-content", pillar: "audience", label: "Explicit content", severity: "blocking", weight: 1, run: mix => mix.tracks.length ? { status: "fail", detail: "Explicit lyric flagged.", recommendation: "Swap in the clean edit.", action: "use-clean-edit" } : { status: "pass" } });
  const verdict = engine.evaluate(passingMix());
  assert.equal(verdict.pass, false);
  assert.ok(verdict.pillars.find(pillar => pillar.id === "audience").checks.includes("audience.explicit-content"));
  assert.throws(() => engine.registerCheck({ id: "audience.explicit-content", pillar: "audience", weight: 1, run() {} }), /already registered/);
  assert.throws(() => engine.registerCheck({ id: "x", pillar: "unknown", weight: 1, run() {} }), /unknown pillar/);
});
check("crashing checks fail closed", () => {
  const engine = new DJCouncilEngine();
  engine.registerCheck({ id: "signal.crash", pillar: "signal", label: "Crash", severity: "blocking", weight: 1, run() { throw new Error("boom"); } });
  const verdict = engine.evaluate(passingMix());
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find(item => item.id === "signal.crash").detail, /boom/);
});

// ---- Recorder-bus signal meter ---------------------------------------------------------------
const sampleRate = 48000;
function sineFrame(frequency, amplitude, spectrum) {
  const samples = new Float32Array(8192);
  for (let index = 0; index < samples.length; index += 1) samples[index] = amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate);
  return { samples, spectrum: spectrum || new Float32Array(4096).fill(-110), sampleRate };
}
check("meter reports loudness and peak from the recorder feed", () => {
  const meter = createSignalMeter();
  for (let block = 0; block < 12; block += 1) meter.push([sineFrame(1000, 0.25), sineFrame(1000, 0.25)]);
  const result = meter.result();
  assert.ok(Math.abs(result.integratedLufs - -12.7) < 0.2, `integrated loudness ${result.integratedLufs}`);
  assert.ok(Math.abs(result.peakDbfs - -12.04) < 0.1, `peak ${result.peakDbfs}`);
  assert.equal(result.humDetected, false);
});
check("meter detects steady 50 Hz and 60 Hz hum in quiet passages", () => {
  for (const hz of [50, 60]) {
    const meter = createSignalMeter();
    const spectrum = new Float32Array(4096).fill(-110);
    spectrum[Math.round(hz / (sampleRate / 8192))] = -50;
    for (let block = 0; block < 4; block += 1) meter.push([sineFrame(hz, 0.003, spectrum), sineFrame(hz, 0.003, spectrum)]);
    const result = meter.result();
    assert.equal(result.humDetected, true, `${hz} Hz hum detected`);
    assert.equal(result.humFrequency, hz);
    const verdict = evaluateDJCouncil(passingMix({ signal: { preflightPassed: true, ...result } }));
    assert.equal(verdict.pass, false);
  }
});
check("meter with no frames cannot pass the council", () => {
  const verdict = evaluateDJCouncil(passingMix({ signal: { preflightPassed: true, ...createSignalMeter().result() } }));
  assert.equal(verdict.pass, false);
});

// ---- Badge -----------------------------------------------------------------------------------
check("badge renders a passing verdict", () => {
  const markup = djCouncilBadgeMarkup(passed);
  assert.match(markup, /data-council-state="pass"/);
  assert.match(markup, /Deliverable/);
  assert.match(markup, new RegExp(`<b>${passed.score}</b>`));
  for (const pillar of COUNCIL_PILLARS) assert.match(markup, new RegExp(`data-council-pillar="${pillar.id}"`));
  assert.doesNotMatch(markup, /data-council-apply/);
});
check("badge renders blockers, fixes and the optional apply button", () => {
  const verdict = evaluateDJCouncil(passingMix({ durationSeconds: 600, attribution: { remixer: "" } }));
  const markup = djCouncilBadgeMarkup(verdict, { onApplyFixes() {} });
  assert.match(markup, /data-council-state="fail"/);
  assert.match(markup, /Not deliverable/);
  assert.match(markup, /Must fix/);
  assert.match(markup, /data-council-action="extend-set"/);
  assert.match(markup, /data-council-apply/);
  assert.doesNotMatch(djCouncilBadgeMarkup(verdict), /data-council-apply/);
  assert.match(djCouncilBadgeMarkup(null), /data-council-state="unavailable"/);
});
check("badge escapes track metadata", () => {
  const mix = passingMix();
  mix.tracks[0] = { ...mix.tracks[0], title: "<img src=x onerror=alert(1)>", catalogId: "" };
  const markup = djCouncilBadgeMarkup(evaluateDJCouncil(mix));
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /&lt;img/);
  assert.match(badgeCss, /\.dj-council-pillars/);
});

// ---- DJ deck wiring --------------------------------------------------------------------------
check("deck loads the council engine and badge", () => {
  assert.match(deckPage, /<script type="module" src="\/services\/djCouncilEngine\.js"><\/script>/);
  assert.match(deckPage, /<script type="module" src="\/dj-council-badge\.js"><\/script>/);
  assert.match(deckPage, /<link rel="stylesheet" href="\/dj-council-badge\.css">/);
  assert.match(deckPage, /id="djCouncil"/);
});
check("finished takeover is gated by the council before auto-download", () => {
  const stopHandler = deckPage.slice(deckPage.indexOf('recorder.addEventListener("stop"'), deckPage.indexOf("stopAutomatedMix();\n        stopTakeoverDecks();\n        resetDJCouncil();"));
  assert.ok(stopHandler.length > 0);
  const councilAt = stopHandler.indexOf("const councilPassed = runDJCouncil();");
  assert.ok(councilAt > 0, "council runs when the recording stops");
  assert.ok(councilAt < stopHandler.indexOf("elements.recordingDownload.click()"), "council runs before the auto-download");
  assert.ok(councilAt < stopHandler.indexOf("elements.postMix.disabled = false"), "post stays disabled until the council passes");
  assert.match(stopHandler, /if \(!councilPassed\) \{[\s\S]*?elements\.postMix\.disabled = true;[\s\S]*?not deliverable[\s\S]*?return;/);
});
check("publishing re-checks the verdict and sends the council payload", () => {
  const publish = deckPage.slice(deckPage.indexOf("async function publishFinishedMix"), deckPage.indexOf("async function addFinishedMixToPlaylist"));
  assert.ok(publish.indexOf("isMixDeliverable(recordingState.councilVerdict)") < publish.indexOf("uploadChunkedFile"));
  assert.match(publish, /council: recordingState\.councilPayload/);
});
check("council metering is read-only and recorder isolation is preserved", () => {
  const meter = deckPage.slice(deckPage.indexOf("function sampleCouncilSignal"), deckPage.indexOf("function councilTrackPayload"));
  assert.match(meter, /getFloatTimeDomainData/);
  assert.doesNotMatch(meter, /\.connect\(|\.disconnect\(/);
  assert.match(deckPage, /recordingState\.councilTimer = setInterval\(sampleCouncilSignal, 120\);/, "meter samples faster than the analyser window");
  assert.match(deckPage, /recorder\.addEventListener\("stop", \(\) => \{\n\s+clearInterval\(recordingState\.councilTimer\);/, "meter stops with the recorder");
  assert.match(deckPage, /routingIsolated = Boolean\(audioEngine\.routing\?\.assertNoUtilityLeak\(\)\.ok && audioEngine\.recorderIsolation\?\.assertGraph\(\)\)/);
  assert.match(deckPage, /await audioEngine\.recorderIsolation\.armAndStartRecording\(recorder,/);
  assert.match(deckPage, /window\.HaloDeskNoiseCleaner\.connect\(context, audioEngine\.monitorBus, audioEngine\.recorderIsolation\)/);
  const armAt = deckPage.indexOf("await audioEngine.recorderIsolation.armAndStartRecording(recorder,");
  assert.ok(deckPage.indexOf("recordingState.recorderPreflightPassed = true;", armAt) > armAt, "preflight pass is only recorded after the recorder arms");
});

// ---- Server gate -----------------------------------------------------------------------------
check("mixes API re-evaluates the council for HALO deck deliveries", () => {
  assert.match(mixesApi, /import \{ evaluateDJCouncil, isMixDeliverable \} from "\.\.\/\.\.\/services\/djCouncilEngine\.js";/);
  assert.match(mixesApi, /if \(uploadSource === "halo_deck"\) \{[\s\S]*?DJ Council review is required[\s\S]*?422\)/);
  assert.match(mixesApi, /evaluateDJCouncil\(\{ \.\.\.payload\.council, durationSeconds \}\)/);
  assert.match(mixesApi, /if \(!isMixDeliverable\(councilVerdict\)\)[\s\S]*?422\)/);
  const gateAt = mixesApi.indexOf("if (!isMixDeliverable(councilVerdict))");
  assert.ok(gateAt > 0 && gateAt < mixesApi.indexOf("INSERT INTO halo_mixes"), "council gate runs before the mix is stored");
  // Server-trusted duration overrides any client claim.
  assert.equal(evaluateDJCouncil({ ...passingMix(), durationSeconds: 120 }).pass, false);
});

console.log(`DJ Council contracts: ${checks}/${checks} checks passed.`);
