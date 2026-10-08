(function (global) {
  "use strict";

  // Only deck music enters this graph. Room input, continuity synthesis and CUE
  // retain their live monitor routes and cannot reach the recorder limiter.
  class HaloRecorderGuard {
    constructor(options = {}) {
      this.context = options.context;
      this.onStatusChange = options.onStatusChange || (() => {});
      this.wait = options.wait || (ms => new Promise(resolve => global.setTimeout(resolve, ms)));
      const context = this.context;
      this.musicBus = context.createGain();
      this.musicBus.gain.setValueAtTime(.82, context.currentTime);
      this.limiter = context.createDynamicsCompressor();
      for (const [name, value] of Object.entries({ threshold: -8, knee: 8, ratio: 8, attack: .004, release: .16 })) {
        this.limiter[name].setValueAtTime(value, context.currentTime);
      }
      this.destination = context.createMediaStreamDestination();
      this.musicBus.connect(this.limiter);
      this.limiter.connect(this.destination);
      this.probe = context.createMediaStreamSource(this.destination.stream);
      const splitter = context.createChannelSplitter(2);
      this.probe.connect(splitter);
      this.analysers = [0, 1].map(channel => {
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        splitter.connect(analyser, channel);
        return analyser;
      });
      this.samples = new Float32Array(2048);
      this.publish("idle", "Quiet-feed preflight required", "Post-limiter music only. CUE stays monitor-only.");
    }

    isFeedAvailable() {
      const tracks = this.destination.stream.getAudioTracks();
      return this.context.state === "running" && tracks.length === 1
        && tracks[0].readyState === "live" && tracks[0].enabled && !tracks[0].muted;
    }

    publish(state, title, message) {
      this.state = { state, title, message };
      this.onStatusChange(this.state);
    }

    async preflight(isQuiet) {
      this.publish("checking", "Checking recorder isolation", "Measuring both recorder channels before recording.");
      try {
        // Do not mute the recorder branch: that would conceal noise or bleed.
        await this.wait(300);
        const startedAt = this.context.currentTime;
        for (let index = 0; index < 8; index += 1) {
          await this.wait(100);
          if (this.context.state !== "running" || !isQuiet()) throw new Error("Stop both decks before the quiet-feed isolation check.");
          if (!this.isFeedAvailable()) throw new Error("Recorder audio feed is unavailable.");
          for (const analyser of this.analysers) {
            this.samples.fill(Number.NaN);
            analyser.getFloatTimeDomainData(this.samples);
            if (!HaloRecorderGuard.isQuietFrame(this.samples)) throw new Error("Noise or audio remains on the recorder music bus. Quiet-feed isolation did not pass.");
          }
        }
        if (!(this.context.currentTime - startedAt >= .7)) throw new Error("Recorder isolation could not measure a running audio feed.");
        this.publish("ready", "Quiet-feed isolation passed", "Recording is armed for this start only; CUE remains monitor-only.");
      } catch (error) {
        this.publish("blocked", "Recording blocked", error.message);
        throw error;
      }
    }

    async start(createRecorder, isQuiet) {
      if (this.starting) throw new Error("Recorder start is already in progress.");
      this.starting = true;
      try {
        await this.preflight(isQuiet);
        if (!isQuiet() || this.context.state !== "running") throw new Error("Recorder feed changed after preflight.");
        if (!this.isFeedAvailable()) throw new Error("Recorder audio feed is unavailable.");
        const recorder = createRecorder(this.destination.stream);
        recorder.start(1000);
        this.publish("recording", "Recording isolated music", "Post-limiter deck music only. CUE and continuity monitoring are excluded.");
        return recorder;
      } catch (error) {
        this.publish("blocked", "Recording blocked", error.message);
        throw error;
      } finally {
        this.starting = false;
      }
    }

    static isQuietFrame(samples) {
      if (!samples.length) return false;
      let total = 0;
      let peak = 0;
      for (const sample of samples) {
        if (!Number.isFinite(sample)) return false;
        total += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      return Math.sqrt(total / samples.length) <= .0001 && peak <= .0005;
    }

    static renderIndicator(element, state) {
      if (!element || !state) return;
      const blocked = state.state === "blocked";
      element.dataset.state = state.state;
      element.classList.toggle("is-secure", ["ready", "recording"].includes(state.state));
      element.classList.toggle("is-triggered", blocked);
      element.setAttribute("role", blocked ? "alert" : "status");
      element.setAttribute("aria-live", blocked ? "assertive" : "polite");
      element.querySelector("[data-recorder-guard-title]").textContent = state.title;
      element.querySelector("[data-recorder-guard-message]").textContent = state.message;
    }
  }

  global.HaloRecorderGuard = HaloRecorderGuard;
})(typeof window !== "undefined" ? window : globalThis);
