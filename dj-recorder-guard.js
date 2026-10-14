(function (global) {
  "use strict";

  // Recorder isolation & audio feedback guard for the DJ deck takeover recorder.
  // Capture owns its post-limiter music path; CUE and speaker routing are never rewired.
  // Preflight removes only the music capture taps to measure unexpected signal on the feed.

  const DEFAULT_CONFIG = Object.freeze({
    checkIntervalMs: 250
  });

  const SECURE_TITLE = "Recorder isolation secure";
  const TRIGGERED_TITLE = "Audio bleed guard triggered";

  class IsolatedRecorderFeed {
    #context;
    #sources = [];
    #gain;
    #limiter;
    #destination;
    #stream;
    #monitor;
    #splitter;
    #analysers;
    #checking = false;

    constructor(context, limiter) {
      this.#context = context;
      this.#gain = context.createGain();
      this.#limiter = context.createDynamicsCompressor();
      this.#destination = context.createMediaStreamDestination();
      this.#stream = this.#destination.stream;
      this.#monitor = context.createMediaStreamSource(this.#stream);
      this.#splitter = context.createChannelSplitter(2);
      this.#analysers = [context.createAnalyser(), context.createAnalyser()];
      this.#analysers.forEach(analyser => { analyser.fftSize = 2048; });
      this.#gain.gain.setValueAtTime(.82, context.currentTime);
      ["threshold", "knee", "ratio", "attack", "release"].forEach(parameter => {
        this.#limiter[parameter].setValueAtTime(limiter[parameter].value, context.currentTime);
      });
      this.#gain.connect(this.#limiter);
      this.#limiter.connect(this.#destination);
      // Inspect the actual stereo capture, including any accidental destination bypass.
      this.#monitor.connect(this.#splitter);
      this.#analysers.forEach((analyser, channel) => this.#splitter.connect(analyser, channel));
    }

    get gain() { return this.#gain; }
    get limiter() { return this.#limiter; }
    get destination() { return this.#destination; }
    get analyser() { return this.#analysers[0]; }

    connectMusicSource(source) {
      if (this.#sources.includes(source)) return;
      if (this.#checking || source.context !== this.#context) throw new Error("Recorder music routing is invalid.");
      source.connect(this.#gain);
      this.#sources.push(source);
    }

    assertIsolated({ sources, forbiddenNodes }) {
      const nodes = [this.#gain, this.#limiter, this.#destination, this.#monitor, this.#splitter, ...this.#analysers];
      const tracks = this.#stream.getAudioTracks();
      if (this.#context.state !== "running"
        || sources.length !== 2 || this.#sources.length !== 2
        || sources.some((source, index) => source !== this.#sources[index])
        || [...sources, ...nodes].some(node => !node || node.context !== this.#context || forbiddenNodes.includes(node))
        || this.#destination.stream !== this.#stream
        || tracks.length !== 1 || tracks[0].readyState !== "live" || !tracks[0].enabled || tracks[0].muted) {
        throw new Error("Recorder feed is not in the expected isolated state.");
      }
    }

    async preflight(readRouting) {
      if (this.#checking) throw new Error("Recorder isolation preflight is already running.");
      this.assertIsolated(readRouting());
      this.#checking = true;
      const detached = [];
      const samples = new Float32Array(this.#analysers[0].fftSize);
      const interval = Math.max(50, Math.ceil(samples.length / this.#context.sampleRate * 1000));
      const wait = () => new Promise(resolve => global.setTimeout(resolve, interval));
      try {
        for (const source of this.#sources) {
          source.disconnect(this.#gain);
          detached.push(source);
        }
        // Let the analyser window and compressor look-ahead drain without muting the monitors.
        for (let index = 0; index < 3; index += 1) await wait();
        for (let index = 0; index < 4; index += 1) {
          this.assertIsolated(readRouting());
          for (const analyser of this.#analysers) {
            analyser.getFloatTimeDomainData(samples);
            if (samples.some(sample => !Number.isFinite(sample) || Math.abs(sample) > .0001)) {
              throw new Error("Recorder quiet-feed preflight detected unexpected audio. Recording was blocked.");
            }
          }
          await wait();
        }
        this.assertIsolated(readRouting());
      } finally {
        try {
          for (const source of detached) source.connect(this.#gain);
        } finally {
          this.#checking = false;
        }
      }
    }
  }

  function evaluateRecorderGuard(inputs = {}) {
    const isRecording = Boolean(inputs.isRecording);
    const cueBusActive = Boolean(inputs.cueBusActive);
    const masterBusLevel = Number.isFinite(inputs.masterBusLevel) ? inputs.masterBusLevel : 0;
    const activeCueDecks = Array.isArray(inputs.activeCueDecks) ? inputs.activeCueDecks.slice() : [];
    const bleedRisk = Boolean(inputs.isolationError);

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
        warningMessage: inputs.isolationError
      };
    }

    const verified = Boolean(inputs.isolationVerified);
    const message = verified
      ? "Quiet-feed preflight passed. The recorder taps only the post-limiter music bus; CUE stays monitor-only."
      : "Recording requires a quiet-feed isolation preflight. CUE stays monitor-only.";

    return {
      state: verified ? "secure" : "pending",
      isSecureToRecord: verified,
      bleedDetected: false,
      isRecording,
      cueBusActive,
      masterBusLevel,
      activeCueDecks,
      title: verified ? SECURE_TITLE : "Recorder isolation pending",
      warningMessage: "",
      message
    };
  }

  class HaloRecorderGuard {
    constructor(options = {}) {
      this.config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
      this.callbacks = {
        readInputs: options.readInputs || (() => ({})),
        onStatusChange: options.onStatusChange || (() => {})
      };
      this.timer = 0;
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
      const resolved = next;
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
  // isolation preflight and cue bus activity and pushes status to the listener.
  function useRecorderGuard(options = {}) {
    return new HaloRecorderGuard(options).init();
  }

  function renderRecorderGuardIndicator(element, state) {
    if (!element || !state) return;
    const secure = state.state === "secure";
    const triggered = state.state === "triggered";
    element.dataset.state = state.state;
    element.classList?.toggle?.("is-secure", secure);
    element.classList?.toggle?.("is-triggered", triggered);
    element.setAttribute?.("role", triggered ? "alert" : "status");
    element.setAttribute?.("aria-live", triggered ? "assertive" : "polite");
    const title = element.querySelector?.("[data-recorder-guard-title]");
    const message = element.querySelector?.("[data-recorder-guard-message]");
    if (title) title.textContent = state.title || (secure ? SECURE_TITLE : TRIGGERED_TITLE);
    if (message) message.textContent = triggered ? state.warningMessage : (state.message || "");
  }

  global.HaloRecorderGuard = HaloRecorderGuard;
  global.HaloRecorderGuard.evaluate = evaluateRecorderGuard;
  global.HaloRecorderGuard.IsolatedFeed = IsolatedRecorderFeed;
  global.HaloRecorderGuard.renderIndicator = renderRecorderGuardIndicator;
  global.useRecorderGuard = useRecorderGuard;
})(typeof window !== "undefined" ? window : globalThis);
