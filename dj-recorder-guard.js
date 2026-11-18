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

  class IsolatedFeed {
    constructor(context, masterLimiter) {
      this.context = context;
      this.gain = context.createGain();
      this.gain.gain.setValueAtTime(0.82, context.currentTime);
      this.limiter = context.createDynamicsCompressor();
      for (const parameter of ["threshold", "knee", "ratio", "attack", "release"]) {
        const value = masterLimiter[parameter].value;
        this.limiter[parameter].setValueAtTime(value, context.currentTime);
      }
      this.destination = context.createMediaStreamDestination();
      this.channelSplitter = context.createChannelSplitter(2);
      this.analyser = context.createAnalyser();
      this.rightAnalyser = context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.rightAnalyser.fftSize = 2048;
      context.createMediaStreamSource(this.destination.stream).connect(this.channelSplitter);
      this.channelSplitter.connect(this.analyser, 0);
      this.channelSplitter.connect(this.rightAnalyser, 1);
      this.gain.connect(this.limiter);
      this.limiter.connect(this.destination);
      this.musicSources = new Set();
    }

    connectMusicSource(source) {
      if (!source || this.musicSources.has(source)) return;
      source.connect(this.gain);
      this.musicSources.add(source);
    }

    async preflight(readRouting) {
      const validate = (checkSourceRoutes = true) => {
        const tracks = this.destination.stream?.getAudioTracks?.() || [];
        if (this.context.state !== "running" || !tracks.length
          || tracks.some(track => track.readyState !== "live" || track.enabled === false || track.muted)) {
          throw new Error("The recorder feed is not in an isolated state.");
        }
        if (Array.isArray(this.gain.connections)
          && (this.gain.connections.length !== 1 || this.gain.connections[0] !== this.limiter)) {
          throw new Error("Recorder routing changed during isolation preflight.");
        }
        if (Array.isArray(this.limiter.connections)
          && (this.limiter.connections.length !== 1 || this.limiter.connections[0] !== this.destination)) {
          throw new Error("Recorder routing changed during isolation preflight.");
        }
        const routing = readRouting?.();
        const sources = [...new Set(routing?.sources || [])];
        const forbiddenNodes = routing?.forbiddenNodes || [];
        if (!sources.length || sources.some(source => !this.musicSources.has(source)
          || forbiddenNodes.includes(source))) {
          throw new Error("The recorder feed is not in an isolated state.");
        }
        if (checkSourceRoutes && sources.some(source =>
          Array.isArray(source.connections) && !source.connections.includes(this.gain))) {
          throw new Error("Recorder routing changed during isolation preflight.");
        }
        return { sources, forbiddenNodes };
      };

      const initialRouting = validate();
      const detachedSources = [];
      try {
        for (const source of initialRouting.sources) {
          source.disconnect(this.gain);
          detachedSources.push(source);
        }

        const samples = [
          new Float32Array(this.analyser.fftSize),
          new Float32Array(this.rightAnalyser.fftSize)
        ];
        for (let window = 0; window < 4; window += 1) {
          await Promise.resolve();
          validate(false);
          this.analyser.getFloatTimeDomainData(samples[0]);
          this.rightAnalyser.getFloatTimeDomainData(samples[1]);
          if (samples.some(channel => channel.some(sample => !Number.isFinite(sample) || Math.abs(sample) >= 0.0001))) {
            throw new Error("Recorder quiet-feed preflight detected unexpected audio.");
          }
        }

        const finalRouting = validate(false);
        if (finalRouting.sources.length !== initialRouting.sources.length
          || finalRouting.sources.some(source => !initialRouting.sources.includes(source))
          || finalRouting.forbiddenNodes.length !== initialRouting.forbiddenNodes.length
          || finalRouting.forbiddenNodes.some(node => !initialRouting.forbiddenNodes.includes(node))) {
          throw new Error("Recorder routing changed during isolation preflight.");
        }
      } finally {
        for (const source of detachedSources) source.connect(this.gain);
      }
    }
  }

  function evaluateRecorderGuard(inputs = {}, config = {}) {
    const isRecording = Boolean(inputs.isRecording);
    const isolationVerified = Boolean(inputs.isolationVerified);
    const isolationError = typeof inputs.isolationError === "string" ? inputs.isolationError.trim() : "";
    const cueBusActive = Boolean(inputs.cueBusActive);
    const masterBusLevel = clampLevel(inputs.masterBusLevel);
    const activeCueDecks = Array.isArray(inputs.activeCueDecks) ? inputs.activeCueDecks.slice() : [];

    if (isolationError) {
      return {
        state: "triggered",
        isSecureToRecord: false,
        bleedDetected: true,
        isRecording,
        cueBusActive,
        masterBusLevel,
        activeCueDecks,
        title: TRIGGERED_TITLE,
        warningMessage: isolationError
      };
    }

    if (!isolationVerified) {
      return {
        state: "pending",
        isSecureToRecord: false,
        bleedDetected: false,
        isRecording,
        cueBusActive,
        masterBusLevel,
        activeCueDecks,
        title: "Recorder isolation pending",
        warningMessage: "",
        message: "Recorder isolation has not been verified by the quiet-feed preflight."
      };
    }

    const message = isRecording
      ? cueBusActive
        ? `Recording the verified isolated music feed. CUE stays monitor-only on ${deckList(activeCueDecks)}.`
        : "Recording the verified isolated music feed."
      : "Recorder isolation is verified. The music feed is ready to record.";
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
    const secure = state.state === "secure";
    const triggered = state.state === "triggered";
    const pending = state.state === "pending";
    element.classList?.toggle?.("is-secure", secure);
    element.classList?.toggle?.("is-triggered", triggered);
    element.classList?.toggle?.("is-pending", pending);
    element.dataset.state = state.state;
    element.setAttribute?.("role", triggered ? "alert" : "status");
    element.setAttribute?.("aria-live", triggered ? "assertive" : "polite");
    const title = element.querySelector?.("[data-recorder-guard-title]");
    const message = element.querySelector?.("[data-recorder-guard-message]");
    if (title) title.textContent = state.title || (triggered ? TRIGGERED_TITLE : pending ? "Recorder isolation pending" : SECURE_TITLE);
    if (message) message.textContent = triggered ? state.warningMessage : (state.message || "");
  }

  global.HaloRecorderGuard = HaloRecorderGuard;
  global.HaloRecorderGuard.IsolatedFeed = IsolatedFeed;
  global.HaloRecorderGuard.evaluate = evaluateRecorderGuard;
  global.HaloRecorderGuard.renderIndicator = renderRecorderGuardIndicator;
  global.useRecorderGuard = useRecorderGuard;
})(typeof window !== "undefined" ? window : globalThis);
