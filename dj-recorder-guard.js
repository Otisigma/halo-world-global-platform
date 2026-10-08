(function (global) {
  "use strict";

  // The feed is owned here and measured from the recorder stream, never the monitor output.
  const recordingFeeds = new WeakSet();

  const DEFAULT_CONFIG = Object.freeze({
    checkIntervalMs: 250,
    quietPeak: 0.0001
  });

  const SECURE_TITLE = "Recorder isolation secure";
  const TRIGGERED_TITLE = "Recorder isolation not confirmed";

  function evaluateRecorderGuard(inputs = {}, config = {}) {
    const isRecording = Boolean(inputs.isRecording);
    const cueBusActive = Boolean(inputs.cueBusActive);
    const activeCueDecks = Array.isArray(inputs.activeCueDecks) ? inputs.activeCueDecks.slice() : [];
    const secure = inputs.isolationConfirmed === true && inputs.preflightPassed === true;
    return {
      state: secure ? "secure" : "triggered",
      isSecureToRecord: secure,
      bleedDetected: false,
      isRecording,
      cueBusActive,
      activeCueDecks,
      title: secure ? SECURE_TITLE : TRIGGERED_TITLE,
      warningMessage: secure ? "" : "A quiet-feed isolation preflight is required before recording. Live playback and CUE remain available.",
      message: secure ? "Recorder captures the post-limiter music bus only. CUE and room input stay monitor-only." : ""
    };
  }

  function createRecordingFeed(context, postLimiterMusicBus) {
    const destination = context.createMediaStreamDestination();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    const probe = context.createMediaStreamSource(destination.stream);
    probe.connect(analyser);
    postLimiterMusicBus.connect(destination);
    const feed = Object.freeze({ context, destination, analyser, probe, musicBus: postLimiterMusicBus });
    recordingFeeds.add(feed);
    return feed;
  }

  function isFeedAvailable(feed) {
    if (!feed || !recordingFeeds.has(feed) || feed.context.state !== "running") return false;
    const tracks = feed.destination.stream.getAudioTracks();
    return tracks.length === 1 && tracks[0].readyState === "live" && tracks[0].enabled && !tracks[0].muted;
  }

  async function preflight(feed, { isMusicIdle } = {}) {
    const fail = () => { throw new Error("Recorder isolation preflight failed. Keep the music bus quiet and try again."); };
    if (typeof isMusicIdle !== "function" || !isFeedAvailable(feed) || !isMusicIdle()) fail();
    const startedAt = feed.context.currentTime;
    const samples = new Float32Array(feed.analyser.fftSize);
    // Let the stream probe warm up, then require multiple quiet frames and an advancing audio clock.
    await new Promise(resolve => global.setTimeout(resolve, 100));
    for (let frame = 0; frame < 6; frame += 1) {
      await new Promise(resolve => global.setTimeout(resolve, 50));
      if (!isFeedAvailable(feed) || !isMusicIdle()) fail();
      samples.fill(Number.NaN);
      feed.analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) {
        if (!Number.isFinite(sample) || Math.abs(sample) > DEFAULT_CONFIG.quietPeak) fail();
      }
    }
    if (!(feed.context.currentTime - startedAt >= 0.25)) fail();
    return true;
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
      const changed = next.state !== this.state.state
        || next.warningMessage !== this.state.warningMessage
        || next.message !== this.state.message;
      this.state = next;
      if (changed) this.callbacks.onStatusChange(next);
      return next;
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
  global.HaloRecorderGuard.createRecordingFeed = createRecordingFeed;
  global.HaloRecorderGuard.isFeedAvailable = isFeedAvailable;
  global.HaloRecorderGuard.preflight = preflight;
  global.HaloRecorderGuard.renderIndicator = renderRecorderGuardIndicator;
  global.useRecorderGuard = useRecorderGuard;
})(typeof window !== "undefined" ? window : globalThis);
