import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const deck = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");
const hasAll = values => values.every(value => deck.includes(value));
const ids = values => values.every(value => deck.includes(`id="${value}"`));

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

const sandbox = {
  elements: {
    maintenanceDockPanel: { hidden: true },
    maintenanceDock: {
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    },
    maintenanceDockCount: { textContent: "10 alerts" },
    maintenanceDockHelp: { textContent: "" }
  },
  toastCalls: [],
  updateProductionHud() {},
  syncMaintenanceDockLabel() {},
  showToast(title, message) { sandbox.toastCalls.push({ title, message }); }
};

vm.createContext(sandbox);
vm.runInContext([
  extractFunctionSource("maintenanceAlertCountLabel"),
  extractFunctionSource("setMaintenanceDockPanel"),
  extractFunctionSource("showMaintenanceAlertsToast")
].join("\n\n"), sandbox);

sandbox.setMaintenanceDockPanel(true);
assert.equal(sandbox.elements.maintenanceDockPanel.hidden, false);
assert.equal(sandbox.elements.maintenanceDock.attributes["aria-expanded"], "true");
sandbox.setMaintenanceDockPanel(false);
assert.equal(sandbox.elements.maintenanceDockPanel.hidden, true);
assert.equal(sandbox.elements.maintenanceDock.attributes["aria-expanded"], "false");
sandbox.showMaintenanceAlertsToast();
assert.equal(sandbox.elements.maintenanceDockPanel.hidden, false);
assert.deepEqual(sandbox.toastCalls.pop(), {
  title: "Maintenance alerts",
  message: "10 alerts watching booth video, cloud revision, upload progress, and audio verification."
});

const checks = [
  [ids(["productionHud"]) && deck.includes("Production HUD // additive overview"), "adds a top-level production HUD section without replacing the deck"],
  [ids(["hudDeckTitle", "hudMixerMeta", "hudLoaderMeta", "hudTelemetryMeta", "hudFlightplanMeta", "hudDockMeta"]), "adds dedicated HUD readouts for deck, mixer, loader, telemetry, release, and dock state"],
  [ids(["deckOpsNowPlaying", "deckOpsQueue", "deckOpsBlend", "deckOpsPolicy"]), "adds an additive deck and mixer summary strip inside the deck package"],
  [ids(["loaderHudLibrary", "loaderHudImport", "loaderHudVault", "loaderHudRelease"]), "adds an additive loader summary above the music import station"],
  [ids(["telemetryHudCrowd", "telemetryHudRecommendation", "telemetryHudCloud", "telemetryHudPreflight"]), "adds an additive telemetry summary above the live crowd and AI modules"],
  [ids(["maintenanceDockPanel", "dockPanelTelemetry", "dockPanelRevision", "dockPanelTrackQr"]), "extends the existing floating maintenance dock with a detail panel and quick actions"],
  [hasAll(["function updateProductionHud()", "function setMaintenanceDockPanel(open)", "showMaintenanceAlertsToast", "prepareRecommendedTransition", "syncTelemetry"]), "wires the additive HUD and floating dock panel into the existing DJ deck logic"],
  [/hudDockAction\?\.addEventListener\("click",\s*showMaintenanceAlertsToast\)/.test(deck) && /closeMaintenanceDockPanel\?\.addEventListener\("click",\s*\(\)\s*=>\s*setMaintenanceDockPanel\(false\)\)/.test(deck) && /event\.key === "Escape" && elements\.maintenanceDockPanel && !elements\.maintenanceDockPanel\.hidden/.test(deck), "covers dock-panel open and close affordances in the runtime wiring"],
  [deck.includes('aria-controls="productionHud mixOperations recordingRig mixFlightplan musicLibrary boothIntelligence"') && deck.includes('{ id: "productionHud", label: "Production HUD" }'), "keeps desk-only focus controls and collapsible panel state aware of the new HUD"]
];

for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(checks.every(([passed]) => passed), true);
console.log(`DJ deck production HUD contracts: ${checks.length}/${checks.length} checks passed.`);
