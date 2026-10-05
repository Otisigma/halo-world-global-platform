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
    maintenanceDock: { title: "" },
    maintenanceDockCount: { textContent: "10 alerts" },
    maintenanceDockHelp: { textContent: "" }
  },
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
  extractFunctionSource("showMaintenanceAlertsToast")
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
  title: "Maintenance alerts",
  message: "10 alerts watching booth video, cloud revision, upload progress, and audio verification."
});
assert.match(sandbox.elements.maintenanceDock.title, /10 alerts currently monitored\.$/);
assert.match(sandbox.elements.maintenanceDockHelp.textContent, /10 alerts currently monitored\.$/);

const searchSandbox = {
  tracks: [
    { id: "warm", title: "Warm Groove", artist: "Artist", genre: "House", bpm: 124, platform: "Drive" },
    { id: "sparse", title: "Sparse", artist: null, genre: undefined, key: null, bpm: 120 },
    { id: "number", title: 42, bpm: 125 }
  ],
  trackQueue: [], selectedPickerDeck: "A",
  elements: { list: {}, empty: { style: {} }, trackCount: {}, trackPickerList: {} },
  escapeHTML: value => String(value ?? ""),
  coverMarkup: () => "", safeUrl: () => "",
  bindBrokenArtwork() {}, renderArtistJourneyGuidance() {}
};
vm.createContext(searchSandbox);
vm.runInContext([
  extractFunctionSource("filterLibraryTracks"),
  extractFunctionSource("renderTracks"),
  extractFunctionSource("renderTrackPicker")
].join("\n"), searchSandbox);
for (const [query, expectedIds] of [
  [undefined, ["warm", "sparse", "number"]],
  [null, ["warm", "sparse", "number"]],
  ["", ["warm", "sparse", "number"]],
  ["  hOuSe  ", ["warm"]],
  ["  ARTIST ", ["warm"]],
  ["DRIVE", ["warm"]],
  [42, ["number"]],
  ["undefined", []],
  ["null", []]
]) {
  assert.deepEqual(Array.from(searchSandbox.filterLibraryTracks(query), track => track.id), expectedIds);
  searchSandbox.renderTracks(query);
  searchSandbox.renderTrackPicker(query);
  const libraryIds = [...searchSandbox.elements.list.innerHTML.matchAll(/data-track-id="([^"]+)"/g)].map(match => match[1]);
  const pickerIds = [...searchSandbox.elements.trackPickerList.innerHTML.matchAll(/data-picker-track="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(libraryIds)], expectedIds, "Library renders expected search results");
  assert.deepEqual(pickerIds, expectedIds, "Picker and library share search semantics");
}

console.log("DJ deck HUD contracts: artist journey guidance plus cloud revision and maintenance toast actions behave as expected.");
