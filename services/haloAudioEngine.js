(function (global) {
  "use strict";

  // HALO audio engine stabilization helpers for the DJ deck.
  // Encapsulates the AudioContext, Deck A/B gains, master gain and the optional
  // Live Intelligence room input (mic/line-in). Every gain change is scheduled with
  // Web Audio ramps so track starts, stops and crossfades avoid clicks and DC thumps.
  // The room input is attenuated to near-zero while tracks load, trigger or transition and
  // restored after playback stabilises. These are best-effort safeguards, not guarantees.

  const SILENCE = 0.0001;
  const DEFAULTS = Object.freeze({
    fadeInDuration: 0.05,
    fadeOutDuration: 0.05,
    trackFadeInDuration: 0.08,
    stabilizationDelayMs: 175,
    crossfadeTimeConstant: 0.015,
    liveInputLevel: 1
  });

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function constantPowerGains(mixRatio) {
    const mix = clamp(mixRatio, 0, 1);
    return { gainA: Math.cos(mix * 0.5 * Math.PI), gainB: Math.sin(mix * 0.5 * Math.PI) };
  }

  function createAudioContext(config) {
    const AudioContextClass = global.AudioContext || global.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser does not support audio playback.");
    return config.sampleRate ? new AudioContextClass({ sampleRate: config.sampleRate }) : new AudioContextClass();
  }

  class HaloAudioEngine {
    constructor(config = {}) {
      this.config = {
        fadeInDuration: positiveNumber(config.fadeInDuration, DEFAULTS.fadeInDuration),
        fadeOutDuration: positiveNumber(config.fadeOutDuration, DEFAULTS.fadeOutDuration),
        trackFadeInDuration: positiveNumber(config.trackFadeInDuration, DEFAULTS.trackFadeInDuration),
        stabilizationDelayMs: positiveNumber(config.stabilizationDelayMs, DEFAULTS.stabilizationDelayMs),
        crossfadeTimeConstant: positiveNumber(config.crossfadeTimeConstant, DEFAULTS.crossfadeTimeConstant),
        liveInputLevel: positiveNumber(config.liveInputLevel, DEFAULTS.liveInputLevel)
      };
      this.timers = {
        setTimeout: config.setTimeout || global.setTimeout.bind(global),
        clearTimeout: config.clearTimeout || global.clearTimeout.bind(global)
      };
      this.audioCtx = config.context || createAudioContext(config);

      // Adopt the deck's existing graph when provided so there is a single audio engine.
      this.masterGain = config.masterGain || this.audioCtx.createGain();
      this.deckAGain = config.deckAGain || this.audioCtx.createGain();
      this.deckBGain = config.deckBGain || this.audioCtx.createGain();
      if (!config.masterGain) this.masterGain.connect(this.audioCtx.destination);
      if (!config.deckAGain) this.deckAGain.connect(this.masterGain);
      if (!config.deckBGain) this.deckBGain.connect(this.masterGain);

      this.micStreamNode = null;
      this.micGainNode = null;
      this.analyzerNode = null;
      this.isAnalyzing = false;
      this.liveInputSuppressed = false;
      this.restoreTimer = null;
    }

    get context() {
      return this.audioCtx;
    }

    getDeckGain(deck) {
      return deck === "B" ? this.deckBGain : this.deckAGain;
    }

    attachLiveIntelligenceInput(mediaStream, options = {}) {
      this.detachLiveIntelligenceInput();
      this.micStreamNode = this.audioCtx.createMediaStreamSource(mediaStream);
      this.micGainNode = this.audioCtx.createGain();
      this.analyzerNode = this.audioCtx.createAnalyser();
      this.micGainNode.gain.setValueAtTime(this.liveInputSuppressed ? SILENCE : this.config.liveInputLevel, this.audioCtx.currentTime);
      this.micStreamNode.connect(this.micGainNode);
      this.micGainNode.connect(this.analyzerNode);
      // Analysis-only by default: routing the room back to the master path invites feedback.
      if (options.monitor === true) this.micGainNode.connect(this.masterGain);
      this.isAnalyzing = !this.liveInputSuppressed;
      return this.analyzerNode;
    }

    detachLiveIntelligenceInput() {
      for (const node of [this.micStreamNode, this.micGainNode, this.analyzerNode]) {
        try { node?.disconnect(); } catch {}
      }
      this.micStreamNode = null;
      this.micGainNode = null;
      this.analyzerNode = null;
      this.isAnalyzing = false;
    }

    clearLiveIntelligenceRestore() {
      if (this.restoreTimer !== null) this.timers.clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }

    setLiveIntelligenceInputState(enable) {
      if (!enable) this.clearLiveIntelligenceRestore();
      this.liveInputSuppressed = !enable;
      if (!this.micGainNode) {
        this.isAnalyzing = false;
        return;
      }
      const gain = this.micGainNode.gain;
      const currentTime = this.audioCtx.currentTime;
      gain.cancelScheduledValues(currentTime);
      gain.setValueAtTime(Math.max(gain.value, SILENCE), currentTime);
      if (enable) {
        gain.exponentialRampToValueAtTime(this.config.liveInputLevel, currentTime + 0.1);
        this.isAnalyzing = true;
      } else {
        // Near-instant attenuation (10ms) cuts the room path without a hard step.
        gain.exponentialRampToValueAtTime(SILENCE, currentTime + 0.01);
        this.isAnalyzing = false;
      }
    }

    scheduleLiveIntelligenceRestore(afterSeconds = 0) {
      this.clearLiveIntelligenceRestore();
      const delayMs = Math.max(0, Number(afterSeconds) || 0) * 1000 + this.config.stabilizationDelayMs;
      this.restoreTimer = this.timers.setTimeout(() => {
        this.restoreTimer = null;
        this.setLiveIntelligenceInputState(true);
      }, delayMs);
      return delayMs;
    }

    suppressLiveIntelligence(durationSeconds = 0) {
      this.setLiveIntelligenceInputState(false);
      return this.scheduleLiveIntelligenceRestore(durationSeconds);
    }

    applySmoothGainRamp(gainNode, targetVolume, duration = this.config.fadeInDuration, startTime) {
      if (!gainNode?.gain) return;
      const currentTime = this.audioCtx.currentTime;
      const rampStart = Math.max(currentTime, Number(startTime) || currentTime);
      const rampDuration = positiveNumber(duration, this.config.fadeInDuration);
      const safeTarget = Math.max(Number(targetVolume) || 0, SILENCE);
      const gain = gainNode.gain;
      gain.cancelScheduledValues(currentTime);
      gain.setValueAtTime(Math.max(gain.value, SILENCE), currentTime);
      if (rampStart > currentTime) gain.setValueAtTime(Math.max(gain.value, SILENCE), rampStart);
      gain.exponentialRampToValueAtTime(safeTarget, rampStart + rampDuration);
      if (!(Number(targetVolume) > 0)) gain.setValueAtTime(0, rampStart + rampDuration + 0.001);
    }

    startSourceWithFadeIn(sourceNode, destinationNode, options = {}) {
      const currentTime = this.audioCtx.currentTime;
      const when = Math.max(currentTime, Number(options.when) || currentTime);
      const duration = positiveNumber(options.fadeDuration, this.config.trackFadeInDuration);
      const envelope = this.audioCtx.createGain();
      envelope.gain.setValueAtTime(SILENCE, currentTime);
      envelope.gain.setValueAtTime(SILENCE, when);
      envelope.gain.exponentialRampToValueAtTime(positiveNumber(options.level, 1), when + duration);
      sourceNode.connect(envelope);
      envelope.connect(destinationNode);
      sourceNode.start(when, Math.max(0, Number(options.offset) || 0));
      return { envelope, stabilizesAt: when + duration };
    }

    stopSourceSmoothly(sourceNode, envelope, duration = this.config.fadeOutDuration) {
      if (!sourceNode) return;
      const fade = positiveNumber(duration, this.config.fadeOutDuration);
      if (!envelope?.gain) {
        try { sourceNode.stop(); } catch {}
        return;
      }
      const currentTime = this.audioCtx.currentTime;
      const gain = envelope.gain;
      gain.cancelScheduledValues(currentTime);
      gain.setValueAtTime(Math.max(gain.value, SILENCE), currentTime);
      gain.exponentialRampToValueAtTime(SILENCE, currentTime + fade);
      try { sourceNode.stop(currentTime + fade + 0.005); } catch {}
      sourceNode.addEventListener?.("ended", () => {
        try { envelope.disconnect(); } catch {}
      }, { once: true });
    }

    async loadAndPlayTrack(deck, audioSourceNode, options = {}) {
      this.setLiveIntelligenceInputState(false);
      try {
        const destination = options.destination || this.getDeckGain(deck);
        const started = this.startSourceWithFadeIn(audioSourceNode, destination, options);
        this.scheduleLiveIntelligenceRestore(Math.max(0, started.stabilizesAt - this.audioCtx.currentTime));
        return started;
      } catch (error) {
        this.scheduleLiveIntelligenceRestore(0);
        throw error;
      }
    }

    crossfade(mixRatio) {
      const { gainA, gainB } = constantPowerGains(mixRatio);
      const currentTime = this.audioCtx.currentTime;
      const timeConstant = this.config.crossfadeTimeConstant;
      // Successive setTargetAtTime events continue from the current computed value, so the
      // fader glides without cancelScheduledValues (which can snap back mid-ramp in some browsers).
      this.deckAGain.gain.setTargetAtTime(gainA, currentTime, timeConstant);
      this.deckBGain.gain.setTargetAtTime(gainB, currentTime, timeConstant);
      return { gainA, gainB };
    }
  }

  HaloAudioEngine.SILENCE = SILENCE;
  HaloAudioEngine.DEFAULTS = DEFAULTS;
  HaloAudioEngine.constantPowerGains = constantPowerGains;
  global.HaloAudioEngine = HaloAudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
