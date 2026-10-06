import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const deck = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");

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

const sandbox = {
  elements: {
    sessionSaveStatus: textNode("Cloud revision 12"),
    cloudStatus: textNode("Cloud ready"),
    maintenanceDock: { title: "" },
    maintenanceDockCount: { textContent: "0 alerts" },
    maintenanceDockHelp: { textContent: "" }
  },
  toastCalls: [],
  showToast(title, message) {
    sandbox.toastCalls.push({ title, message });
  }
};

vm.createContext(sandbox);
vm.runInContext([
  extractFunctionSource("currentCloudRevisionLabel"),
  extractFunctionSource("showCloudRevisionToast")
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

assert.match(deck, /id="maintenanceDockCount">0 alerts<\/strong>/);
assert.match(deck, /src="\/halo-alert-store\.js" defer/);
assert.match(deck, /src="\/maintenance-panel\.js" defer/);
assert.match(deck, /href="\/maintenance-panel\.css"/);
assert.doesNotMatch(deck, /10 alerts/);

console.log("DJ deck HUD contracts: artist journey guidance, cloud revision toast, and live maintenance panel wiring behave as expected.");
