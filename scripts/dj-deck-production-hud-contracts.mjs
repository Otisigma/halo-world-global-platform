import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deck = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");
const hasAll = values => values.every(value => deck.includes(value));
const ids = values => values.every(value => deck.includes(`id="${value}"`));

const checks = [
  [ids(["productionHud"]) && deck.includes("Production HUD // additive overview"), "adds a top-level production HUD section without replacing the deck"],
  [ids(["hudDeckTitle", "hudMixerMeta", "hudLoaderMeta", "hudTelemetryMeta", "hudFlightplanMeta", "hudDockMeta"]), "adds dedicated HUD readouts for deck, mixer, loader, telemetry, release, and dock state"],
  [ids(["deckOpsNowPlaying", "deckOpsQueue", "deckOpsBlend", "deckOpsPolicy"]), "adds an additive deck and mixer summary strip inside the deck package"],
  [ids(["loaderHudLibrary", "loaderHudImport", "loaderHudVault", "loaderHudRelease"]), "adds an additive loader summary above the music import station"],
  [ids(["telemetryHudCrowd", "telemetryHudRecommendation", "telemetryHudCloud", "telemetryHudPreflight"]), "adds an additive telemetry summary above the live crowd and AI modules"],
  [ids(["maintenanceDockPanel", "dockPanelTelemetry", "dockPanelRevision", "dockPanelTrackQr"]), "extends the existing floating maintenance dock with a detail panel and quick actions"],
  [hasAll(["function updateProductionHud()", "function setMaintenanceDockPanel(open)", "showMaintenanceAlertsToast", "prepareRecommendedTransition", "syncTelemetry"]), "wires the additive HUD and floating dock panel into the existing DJ deck logic"],
  [deck.includes('aria-controls="productionHud mixOperations recordingRig mixFlightplan musicLibrary boothIntelligence"') && deck.includes('{ id: "productionHud", label: "Production HUD" }'), "keeps desk-only focus controls and collapsible panel state aware of the new HUD"]
];

for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(checks.every(([passed]) => passed), true);
console.log(`DJ deck production HUD contracts: ${checks.length}/${checks.length} checks passed.`);
