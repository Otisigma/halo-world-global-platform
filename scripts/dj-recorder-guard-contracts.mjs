import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [guardSource, deckPage] = await Promise.all([
  readFile(new URL("../dj-recorder-guard.js", import.meta.url), "utf8"),
  readFile(new URL("../dj-deck.html", import.meta.url), "utf8")
]);

const sandbox = {
  console,
  globalThis: null,
  setInterval(handler, interval) { sandbox.__interval = interval; sandbox.__handler = handler; return 1; },
  clearInterval() { sandbox.__cleared = true; }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(guardSource, sandbox);

const { HaloRecorderGuard, useRecorderGuard } = sandbox;
assert.equal(typeof HaloRecorderGuard, "function", "Recorder guard exports a global constructor");
assert.equal(typeof useRecorderGuard, "function", "Recorder guard exposes a hook-style entry point");
const evaluate = HaloRecorderGuard.evaluate;

const idle = evaluate({ isRecording: false, masterBusLevel: 0.95, cueBusActive: true, activeCueDecks: ["A"] });
assert.equal(idle.isSecureToRecord, true, "Guard stays secure while the recorder is not running");
assert.equal(idle.bleedDetected, false);
assert.equal(idle.warningMessage, "");

const cleanRecording = evaluate({ isRecording: true, masterBusLevel: 0.95, cueBusActive: false });
assert.equal(cleanRecording.state, "secure", "Hot master without cue monitoring is not a bleed condition");

const quietCue = evaluate({ isRecording: true, masterBusLevel: 0.5, cueBusActive: true, activeCueDecks: ["B"] });
assert.equal(quietCue.state, "secure", "Cue monitoring below the master limit stays secure");
assert.match(quietCue.message, /Deck B/, "Secure copy still names the active cue deck");

const triggered = evaluate({ isRecording: true, masterBusLevel: 0.92, cueBusActive: true, activeCueDecks: ["A", "B"] });
assert.equal(triggered.state, "triggered", "Recording + active cue + master near limit triggers the guard");
assert.equal(triggered.isSecureToRecord, false);
assert.equal(triggered.bleedDetected, true);
assert.match(triggered.warningMessage, /Deck A and Deck B/, "Warning names the cue decks");
assert.match(triggered.warningMessage, /92%/, "Warning reports the master level");
assert.match(triggered.warningMessage, /Release CUE/, "Warning is actionable");

assert.equal(evaluate({ isRecording: true, masterBusLevel: Number.NaN, cueBusActive: true }).state, "secure", "Invalid levels are treated as silence");
assert.equal(evaluate({ isRecording: true, masterBusLevel: 0.8, cueBusActive: true }).state, "secure", "The configured limit itself is not exceeded");
assert.equal(evaluate({ isRecording: true, masterBusLevel: 0.7, cueBusActive: true }, { masterLimit: 0.6 }).state, "triggered", "The master limit is configurable");

for (const state of [idle, cleanRecording, quietCue, triggered]) {
  assert.doesNotMatch(`${state.title} ${state.message || ""} ${state.warningMessage}`, /zero bleed|guarantee|pristine|100% clean/i, "Guard copy never promises absolute silence");
}

let clock = 0;
let inputs = { isRecording: false, masterBusLevel: 0, cueBusActive: false, activeCueDecks: [] };
const statuses = [];
const guard = useRecorderGuard({ readInputs: () => inputs, onStatusChange: status => statuses.push(status), now: () => clock });
assert.equal(sandbox.__interval, 250, "Guard samples the recorder feed four times per second");
assert.equal(statuses.at(-1).state, "secure", "Guard publishes an initial secure state");

inputs = { isRecording: true, masterBusLevel: 0.9, cueBusActive: true, activeCueDecks: ["A"] };
guard.tick();
assert.equal(statuses.at(-1).state, "triggered", "Guard publishes the triggered state");

clock = 500;
inputs = { ...inputs, masterBusLevel: 0.4 };
guard.tick();
assert.equal(guard.state.state, "triggered", "Warning is held briefly so transient peaks do not flicker");
assert.match(guard.state.warningMessage, /90%/, "Held warning keeps the last hot peak");

clock = 700;
inputs = { ...inputs, activeCueDecks: ["B"] };
guard.tick();
assert.equal(statuses.at(-1).state, "triggered");
assert.match(statuses.at(-1).warningMessage, /Deck B/, "Held warning follows the cue deck that is active now");
assert.doesNotMatch(statuses.at(-1).warningMessage, /Deck A/);

clock = 2500;
guard.tick();
assert.equal(statuses.at(-1).state, "secure", "Guard clears once the hold window passes");

inputs = { isRecording: true, masterBusLevel: 0.9, cueBusActive: true, activeCueDecks: ["A"] };
clock = 3000;
guard.tick();
inputs = { isRecording: true, masterBusLevel: 0.9, cueBusActive: false, activeCueDecks: [] };
clock = 3100;
guard.tick();
assert.equal(statuses.at(-1).state, "secure", "Releasing CUE clears the guard immediately");
guard.destroy();
assert.equal(sandbox.__cleared, true, "Guard stops its watchdog on destroy");

const classes = new Set();
const title = { textContent: "" };
const message = { textContent: "" };
const indicator = {
  dataset: {},
  attributes: {},
  classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
  setAttribute(name, value) { this.attributes[name] = value; },
  querySelector(selector) { return selector === "[data-recorder-guard-title]" ? title : selector === "[data-recorder-guard-message]" ? message : null; }
};
HaloRecorderGuard.renderIndicator(indicator, triggered);
assert.equal(indicator.dataset.state, "triggered");
assert.ok(classes.has("is-triggered") && !classes.has("is-secure"), "Indicator switches to the triggered style");
assert.equal(indicator.attributes.role, "alert", "Triggered indicator is announced as an alert");
assert.equal(indicator.attributes["aria-live"], "assertive", "Alert live region is assertive");
assert.equal(title.textContent, "Audio bleed guard triggered");
assert.equal(message.textContent, triggered.warningMessage);
HaloRecorderGuard.renderIndicator(indicator, cleanRecording);
assert.ok(classes.has("is-secure") && !classes.has("is-triggered"), "Indicator returns to the secure style");
assert.equal(title.textContent, "Recorder isolation secure");
assert.equal(indicator.attributes["aria-live"], "polite", "Secure status live region is polite");

assert.match(deckPage, /<script src="\/dj-recorder-guard\.js" defer><\/script>/, "DJ deck loads the recorder guard");
const guardIndex = deckPage.indexOf('id="recorderGuard"');
const rigIndex = deckPage.indexOf('id="recordingRig"');
const recorderTitleIndex = deckPage.indexOf('id="recordingTitle"');
assert.ok(rigIndex > -1 && guardIndex > rigIndex && guardIndex < recorderTitleIndex, "Indicator sits directly above the Takeover recorder heading");
assert.match(deckPage, /data-recorder-guard-title/, "Indicator exposes a title slot");
assert.match(deckPage, /data-recorder-guard-message/, "Indicator exposes a message slot");
assert.match(deckPage, /function attachRecorderGuardToDeck\(/, "DJ deck wires the recorder guard");
assert.match(deckPage, /const isRecording = recordingState\.recorder\?\.state === "recording"/, "Guard reads the live recorder state");
assert.match(deckPage, /const cueBusActive = activeCueDecks\.length > 0/, "Guard reads cue bus activity");
assert.match(deckPage, /masterBusLevel: isRecording && cueBusActive \? recorderGuardMasterLevel\(\) : 0/, "Guard reads the master bus level only when it can affect the result");
assert.match(deckPage, /recorderGuardState\.guard\?\.tick\(\);/, "Cue toggles refresh the guard immediately");
assert.match(deckPage, /cueGain\.connect\(context\.destination\)/, "CUE monitoring stays on the local output path");
assert.match(deckPage, /limiter\.connect\(audioEngine\.recordingDestination\)/, "Recorder taps the post-limiter master bus");
assert.doesNotMatch(deckPage, /cueGain\.connect\(audioEngine\.recordingDestination\)/, "CUE monitoring is never routed into the recorder");

console.log("DJ recorder guard contracts: bleed detection, hold window, indicator rendering, and deck wiring behave as expected.");
