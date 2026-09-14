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
assert.match(deck, /function buildArtistJourneyModel\(/);
assert.match(deck, /Upload \/ ingest/);
assert.match(deck, /Artwork \/ contract/);
assert.match(deck, /Mix \/ review/);
assert.match(deck, /Release \/ sale/);
assert.match(deck, /Campaign launch/);
assert.match(deck, /HALO AI is waiting at upload and will guide ingest, artwork, review, release, and campaign launch without changing the decks\./);
assert.match(deck, /Campaign is ready to launch/);
assert.match(deck, /All five stages are ready\. HALO AI can guide the launch without changing the mix desk\./);

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

console.log("DJ deck HUD contracts: artist journey guidance plus cloud revision and maintenance toast actions behave as expected.");
