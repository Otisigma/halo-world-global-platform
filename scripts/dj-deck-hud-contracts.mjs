import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const deck = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");

const topbar = deck.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0];
const deckStrip = deck.match(/<section id="ambient-deck-bar"[\s\S]*?<\/section>/)?.[0];
assert.ok(topbar, "The top navigation header must remain available");
assert.ok(deckStrip, "The track readout must have its own deck section");
assert.match(deck, /<\/header>\s*<section id="ambient-deck-bar"/, "The deck strip must sit directly below navigation");
assert.match(deckStrip, /class="isolated-deck-strip" aria-labelledby="currentTrackLabel"/);
assert.match(deckStrip, /<h2 class="eyebrow" id="currentTrackLabel">Current track<\/h2>/);
assert.doesNotMatch(topbar, /now-track|masterTrack|masterStatus|openTrackPicker|MASTER TEMPO|LOAD A TRACK/);
assert.match(topbar, /class="pulse-dot" role="img" aria-label="System ready"/);
for (const id of ["masterTrack", "masterStatus", "openTrackPicker"]) {
  assert.match(deckStrip, new RegExp(`id="${id}"`), `${id} must belong to the isolated deck strip`);
  assert.equal(deck.split(`id="${id}"`).length - 1, 1, `${id} must remain unique`);
}
for (const id of ["sessionRevisionButton", "sessionSaveStatus", "cloudStatus", "focusMode"]) {
  assert.match(topbar, new RegExp(`id="${id}"`), `${id} must remain in navigation`);
}
for (const href of ["/halo-live.html", "/halo-x.html", "/mixes/", "/dreamweaver/", "/halo"]) {
  assert.ok(topbar.includes(`href="${href}"`), `${href} must remain in navigation`);
}
assert.match(deck, /elements\.openTrackPicker\.addEventListener\("click", \(\) => openTrackPicker\("header"\)\)/);

function extractFunctionSource(name) {
  const start = deck.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const braceStart = deck.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < deck.length; index += 1) {
    const character = deck[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return deck.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function textNode(text) {
  return { textContent: text };
}

const readoutSandbox = {
  deckState: {
    A: { title: "No track loaded", artist: "Choose from the library", bpm: 124, empty: true, playing: false },
    B: { empty: true, playing: false }
  },
  elements: {
    masterBpm: textNode(""),
    masterTrack: textNode(""),
    masterStatus: { textContent: "", dataset: {} }
  },
  audioHealth: { continuity: null },
  continuityStatusLabel: () => ""
};
vm.createContext(readoutSandbox);
vm.runInContext(extractFunctionSource("updateMasterReadout"), readoutSandbox);
readoutSandbox.updateMasterReadout();
assert.equal(readoutSandbox.elements.masterTrack.textContent, "No track loaded — Choose from the library");
assert.equal(readoutSandbox.elements.masterStatus.textContent, "LOAD A TRACK TO BEGIN");
readoutSandbox.deckState.B = { title: "Loaded track", artist: "Artist", bpm: 128, empty: false, playing: false };
readoutSandbox.updateMasterReadout();
assert.equal(readoutSandbox.elements.masterTrack.textContent, "Loaded track — Artist");
assert.equal(readoutSandbox.elements.masterBpm.textContent, "128.0");
assert.equal(readoutSandbox.elements.masterStatus.textContent, "DECK B READY · MASTER TEMPO 128.0 BPM");
readoutSandbox.deckState.B.playing = true;
readoutSandbox.audioHealth.continuity = { state: "normal" };
readoutSandbox.updateMasterReadout();
assert.equal(readoutSandbox.elements.masterStatus.textContent, "DECK B LIVE · MASTER TEMPO 128.0 BPM");
assert.equal(readoutSandbox.elements.masterStatus.dataset.continuityState, "normal");

const sandbox = {
  elements: {
    sessionSaveStatus: textNode("Cloud revision 12"),
    cloudStatus: textNode("Cloud ready"),
    maintenanceDock: { title: "", dataset: {} },
    maintenanceDockCount: { textContent: "Checking" },
    maintenanceDockHelp: { textContent: "" }
  },
  window: { location: { pathname: "/dj-deck.html" } },
  toastCalls: [],
  showToast(title, message) {
    sandbox.toastCalls.push({ title, message });
  }
};

vm.createContext(sandbox);
vm.runInContext([
  extractFunctionSource("maintenanceAlertCountLabel"),
  extractFunctionSource("syncMaintenanceDockLabel"),
  extractFunctionSource("currentCloudRevisionLabel"),
  extractFunctionSource("showCloudRevisionToast"),
  extractFunctionSource("showMaintenanceAlertsToast"),
  extractFunctionSource("syncMaintenanceDockFromControlRoom")
].join("\n\n"), sandbox);

assert.match(deck, /Upload once\. HALO watches every next step\./);
assert.match(deck, /HALO AI is watching the full artist journey\./);
assert.match(deck, /id="artistJourneyStageChips"/);
assert.match(deck, /<ol class="journey-chip-row" id="artistJourneyStageChips"/);
assert.match(deck, /function buildArtistJourneyModel\(/);
assert.match(deck, /function cleanupArtistJourneyGuidance\(/);
assert.match(deck, /<li class="journey-chip is-\$\{stage\.status\}"/);
assert.match(deck, /aria-current="step"/);
assert.match(deck, /halo-artist-journey-state\.v1/);
assert.match(deck, /halo:artist-journey-update/);
assert.match(deck, /Upload \/ ingest/);
assert.match(deck, /Artwork \/ contract/);
assert.match(deck, /Mix \/ review/);
assert.match(deck, /Release \/ sale/);
assert.match(deck, /Campaign launch/);
assert.match(deck, /beforeunload/);
assert.match(deck, /removeEventListener\("input", artistJourneyScheduleHandler\)/);
assert.match(deck, /observer\.disconnect\(\)/);

sandbox.showCloudRevisionToast();
assert.deepEqual(sandbox.toastCalls.shift(), { title: "Cloud revision", message: "Cloud revision 12" });

sandbox.elements.sessionSaveStatus.textContent = "Saved on device";
sandbox.showCloudRevisionToast();
assert.deepEqual(sandbox.toastCalls.shift(), { title: "Cloud revision", message: "Cloud ready · awaiting first revision" });

sandbox.showMaintenanceAlertsToast();
assert.deepEqual(sandbox.toastCalls.shift(), {
  title: "Maintenance control room",
  message: "Checking · latest scan covers runtime, links, watchers, accessible names, and recorder safety."
});
sandbox.syncMaintenanceDockFromControlRoom({
  detail: { pagePath: "/dj-deck.html", status: "broken", issueCount: 2, healedCount: 1, escalatedCount: 2 }
});
assert.equal(sandbox.elements.maintenanceDockCount.textContent, "2 at risk");
assert.equal(sandbox.elements.maintenanceDock.dataset.status, "broken");
assert.match(sandbox.elements.maintenanceDock.dataset.summary, /1 auto-repaired and verified · 2 escalated · 2 at risk/);
assert.match(sandbox.elements.maintenanceDock.title, /Maintenance control room\. 2 at risk\./);
assert.match(sandbox.elements.maintenanceDockHelp.textContent, /latest maintenance scan/i);

console.log("DJ deck HUD contracts: artist journey guidance plus cloud revision and maintenance toast actions behave as expected.");
