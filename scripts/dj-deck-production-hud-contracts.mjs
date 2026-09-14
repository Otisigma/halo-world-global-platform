import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deck = await readFile(new URL("../dj-deck.html", import.meta.url), "utf8");

const checks = [
  [deck.includes('id="productionHud"') && deck.includes("Production HUD // additive overview"), "adds a top-level production HUD section without replacing the deck"],
  [deck.includes('id="hudDeckTitle"') && deck.includes('id="hudMixerMeta"') && deck.includes('id="hudLoaderMeta"') && deck.includes('id="hudTelemetryMeta"') && deck.includes('id="hudFlightplanMeta"') && deck.includes('id="hudDockMeta"'), "adds dedicated HUD readouts for deck, mixer, loader, telemetry, release, and dock state"],
  [deck.includes('id="deckOpsNowPlaying"') && deck.includes('id="deckOpsQueue"') && deck.includes('id="deckOpsBlend"') && deck.includes('id="deckOpsPolicy"'), "adds an additive deck and mixer summary strip inside the deck package"],
  [deck.includes('id="loaderHudLibrary"') && deck.includes('id="loaderHudImport"') && deck.includes('id="loaderHudVault"') && deck.includes('id="loaderHudRelease"'), "adds an additive loader summary above the music import station"],
  [deck.includes('id="telemetryHudCrowd"') && deck.includes('id="telemetryHudRecommendation"') && deck.includes('id="telemetryHudCloud"') && deck.includes('id="telemetryHudPreflight"'), "adds an additive telemetry summary above the live crowd and AI modules"],
  [deck.includes('id="maintenanceDockPanel"') && deck.includes('id="dockPanelTelemetry"') && deck.includes('id="dockPanelRevision"') && deck.includes('id="dockPanelTrackQr"'), "extends the existing floating maintenance dock with a detail panel and quick actions"],
  [deck.includes("function updateProductionHud()") && deck.includes("function setMaintenanceDockPanel(open)") && deck.includes('elements.hudDockAction?.addEventListener("click", showMaintenanceAlertsToast);'), "wires the additive HUD and floating dock panel into the existing DJ deck logic"],
  [deck.includes('aria-controls="productionHud mixOperations recordingRig mixFlightplan musicLibrary boothIntelligence"') && deck.includes('{ id: "productionHud", label: "Production HUD" }'), "keeps desk-only focus controls and collapsible panel state aware of the new HUD"]
];

for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
assert.equal(checks.every(([passed]) => passed), true);
console.log(`DJ deck production HUD contracts: ${checks.length}/${checks.length} checks passed.`);
