(function (global) {
  "use strict";

  // Recorder isolation & audio feedback guard for the DJ deck takeover recorder.
  // The recorder taps the post-limiter master bus while CUE monitoring runs on a separate
  // local path. This guard watches for the conditions that most often let cue-monitor bleed,
  // background monitoring audio, or feedback loops reach a direct recording, and raises an
  // actionable warning. It reduces risk; it does not guarantee absolute silence on the feed.

  const DEFAULT_CONFIG = Object.freeze({
    checkIntervalMs: 250,
    masterLimit: 0.8,
    holdMs: 1500
  });

  const SECURE_TITLE = "Recorder isolation secure";
  const TRIGGERED_TITLE = "Audio bleed guard triggered";

  function clampLevel(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(1, number);
  }

  function deckList(decks) {
    const list = Array.isArray(decks) ? decks.filter(Boolean).map(String) : [];
    if (!list.length) return "the cue bus";
    return `Deck ${list.join(" and Deck ")}`;
  }

  function evaluateRecorderGuard(inputs = {}, config = {}) {
    const settings = { ...DEFAULT_CONFIG, ...config };
    const isRecording = Boolean(inputs.isRecording);
    const cueBusActive = Boolean(inputs.cueBusActive);
    const masterBusLevel = clampLevel(inputs.masterBusLevel);
    const activeCueDecks = Array.isArray(inputs.activeCueDecks) ? inputs.activeCueDecks.slice() : [];
    const nearLimit = masterBusLevel > settings.masterLimit;
    const levelPercent = Math.round(masterBusLevel * 100);
    const bleedRisk = isRecording && cueBusActive && nearLimit;

    if (bleedRisk) {
      return {
        state: "triggered",
        isSecureToRecord: false,
        bleedDetected: true,
        isRecording,
        cueBusActive,
        masterBusLevel,
        activeCueDecks,
        title: TRIGGERED_TITLE,
        warningMessage: `CUE monitoring on ${deckList(activeCueDecks)} is active while the master bus is near its limit (${levelPercent}%). Release CUE or pull the channel faders down so headphone bleed and feedback stay out of the recording.`
      };
    }

    let message;
    if (!isRecording) {
      message = "The recorder taps the post-limiter master bus only; CUE headphones stay on a separate local path. The guard watches for likely bleed conditions once recording starts.";
    } else if (cueBusActive) {
      message = `Recording the master bus. CUE on ${deckList(activeCueDecks)} stays on the local monitor path — keep the master below its limit to avoid headphone bleed.`;
    } else {
      message = "Recording the master bus only. No likely cue-bleed or feedback conditions detected.";
    }

    return {
      state: "secure",
      isSecureToRecord: true,
      bleedDetected: false,
      isRecording,
      cueBusActive,
      masterBusLevel,
      activeCueDecks,
      title: SECURE_TITLE,
      warningMessage: "",
      message
    };
  }

  class HaloRecorderGuard {
    constructor(options = {}) {
      this.config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
      this.callbacks = {
        readInputs: options.readInputs || (() => ({})),
        onStatusChange: options.onStatusChange || (() => {}),
        now: options.now || (() => Date.now())
      };
      this.timer = 0;
      this.triggeredUntil = 0;
      this.heldLevel = 0;
      this.state = evaluateRecorderGuard({}, this.config);
    }

    init() {
      this.callbacks.onStatusChange(this.state);
      this.startWatchdog();
      return this;
    }

    tick() {
      const inputs = this.callbacks.readInputs() || {};
      const next = evaluateRecorderGuard(inputs, this.config);
      const now = this.callbacks.now();
      let resolved = next;
      if (next.state === "triggered") {
        this.triggeredUntil = now + this.config.holdMs;
        this.heldLevel = next.masterBusLevel;
      } else if (this.state.state === "triggered" && next.isRecording && next.cueBusActive && now < this.triggeredUntil) {
        // Hold the warning briefly at the last hot peak so transient dips do not make the indicator
        // flicker, while still reflecting the cue decks that are active right now.
        resolved = evaluateRecorderGuard({ ...inputs, masterBusLevel: this.heldLevel }, this.config);
      } else {
        this.triggeredUntil = 0;
        this.heldLevel = 0;
      }
      const changed = resolved.state !== this.state.state
        || resolved.warningMessage !== this.state.warningMessage
        || resolved.message !== this.state.message;
      this.state = resolved;
      if (changed) this.callbacks.onStatusChange(resolved);
      return resolved;
    }

    startWatchdog() {
      this.stopWatchdog();
      this.timer = global.setInterval(() => this.tick(), this.config.checkIntervalMs);
    }

    stopWatchdog() {
      if (!this.timer) return;
      global.clearInterval(this.timer);
      this.timer = 0;
    }

    destroy() {
      this.stopWatchdog();
    }
  }

  // Framework-free equivalent of a `useRecorderGuard` hook: subscribes to recording state,
  // master bus level and cue bus activity and pushes secure/triggered state to the listener.
  function useRecorderGuard(options = {}) {
    return new HaloRecorderGuard(options).init();
  }

  function renderRecorderGuardIndicator(element, state) {
    if (!element || !state) return;
    const secure = state.state !== "triggered";
    element.dataset.state = secure ? "secure" : "triggered";
    element.classList?.toggle?.("is-secure", secure);
    element.classList?.toggle?.("is-triggered", !secure);
    element.setAttribute?.("role", secure ? "status" : "alert");
    element.setAttribute?.("aria-live", secure ? "polite" : "assertive");
    const title = element.querySelector?.("[data-recorder-guard-title]");
    const message = element.querySelector?.("[data-recorder-guard-message]");
    if (title) title.textContent = state.title || (secure ? SECURE_TITLE : TRIGGERED_TITLE);
    if (message) message.textContent = secure ? (state.message || "") : state.warningMessage;
  }

  global.HaloRecorderGuard = HaloRecorderGuard;
  global.HaloRecorderGuard.evaluate = evaluateRecorderGuard;
  global.HaloRecorderGuard.renderIndicator = renderRecorderGuardIndicator;
  global.useRecorderGuard = useRecorderGuard;
})(typeof window !== "undefined" ? window : globalThis);
