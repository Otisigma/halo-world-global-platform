(function (global) {
  "use strict";

  // Graph isolation and quiet-feed preflight supplement the live cue-risk indicator.
  // Only explicitly approved music sources may reach the post-limiter recorder tap.

  const DEFAULT_CONFIG = Object.freeze({
    checkIntervalMs: 250,
    masterLimit: 0.8,
    holdMs: 1500
  });

  const SECURE_TITLE = "Recorder isolation secure";
  const TRIGGERED_TITLE = "Audio bleed guard triggered";
  const contextInterlocks = new WeakMap();
  let guardedNativeConnect = null;

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

  function createIsolation(context) {
    const nodes = new WeakMap();
    const params = new WeakMap();
    const connecting = new WeakSet();
    const factories = new Map();
    let destination = null;
    let violation = "";
    let arming = false;
    const fail = message => {
      violation = message;
      throw new Error(message);
    };
    const prototype = global.AudioNode?.prototype;
    if (prototype) {
      if (!guardedNativeConnect) {
        const nativeConnect = prototype.connect;
        guardedNativeConnect = function (target, ...ports) {
          contextInterlocks.get(this.context)?.(this, target);
          return nativeConnect.call(this, target, ...ports);
        };
        prototype.connect = guardedNativeConnect;
      }
      contextInterlocks.set(context, (node, target) => {
        if ((!nodes.has(node) && (nodes.has(target) || params.has(target))) || (nodes.has(node) && !connecting.has(node))) {
          fail("Untracked source or native connection bypass attempted. Reload the deck.");
        }
      });
    }
    function reaches(from, target, seen = new Set()) {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return [...(nodes.get(from)?.edges.keys() || [])].some(next => reaches(params.get(next) || next, target, seen));
    }
    function assertGraph() {
      if (!destination || !nodes.has(destination)) throw new Error("Recorder isolation is unavailable.");
      if (violation) throw new Error(violation);
      if (prototype && prototype.connect !== guardedNativeConnect) fail("Native recorder routing guard was bypassed.");
      for (const [factory, create] of factories) {
        if (context[factory] !== create) fail("Audio node factory guard was bypassed.");
      }
      const pending = [destination];
      const seen = new Set();
      while (pending.length) {
        const node = pending.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        const entry = nodes.get(node);
        if (node.connect !== entry.connect || node.disconnect !== entry.disconnect) fail("Recorder graph guard was bypassed. Reload the deck.");
        if (entry.monitor || (entry.source && !entry.music)) fail("An unapproved source reaches the recorder.");
        pending.push(...entry.incoming);
      }
      return true;
    }
    function track(node, source) {
      const nativeConnect = node.connect;
      const nativeDisconnect = node.disconnect;
      const entry = { source, music: false, monitor: false, edges: new Map(), incoming: new Set() };
      nodes.set(node, entry);
      for (const key of ["gain", "frequency", "detune", "Q", "delayTime", "playbackRate", "threshold", "knee", "ratio", "attack", "release", "pan", "offset"]) {
        if (node[key]) params.set(node[key], node);
      }
      entry.connect = function (target, ...ports) {
        const targetNode = params.get(target) || target;
        if (!nodes.has(targetNode) && target !== context.destination) fail("Untracked audio routing is not permitted.");
        const previous = entry.edges.get(target) || [];
        entry.edges.set(target, [...previous, ports]);
        nodes.get(targetNode)?.incoming.add(node);
        try {
          if (destination) assertGraph();
          connecting.add(node);
          try { return nativeConnect.call(node, target, ...ports); }
          finally { connecting.delete(node); }
        } catch (error) {
          if (previous.length) entry.edges.set(target, previous);
          else {
            entry.edges.delete(target);
            if (![...entry.edges.keys()].some(next => (params.get(next) || next) === targetNode)) nodes.get(targetNode)?.incoming.delete(node);
          }
          throw error;
        }
      };
      entry.disconnect = function (...args) {
        const previousTargets = [...entry.edges.keys()].map(target => params.get(target) || target);
        const result = nativeDisconnect.apply(node, args);
        if (!args.length) entry.edges.clear();
        else if (typeof args[0] === "object") {
          if (args.length === 1) entry.edges.delete(args[0]);
          else {
            const remaining = (entry.edges.get(args[0]) || []).filter(ports => (ports[0] || 0) !== args[1] || (args.length > 2 && (ports[1] || 0) !== args[2]));
            if (remaining.length) entry.edges.set(args[0], remaining);
            else entry.edges.delete(args[0]);
          }
        } else {
          for (const [target, connections] of entry.edges) {
            const remaining = connections.filter(ports => (ports[0] || 0) !== args[0]);
            if (remaining.length) entry.edges.set(target, remaining);
            else entry.edges.delete(target);
          }
        }
        for (const target of previousTargets) {
          if (![...entry.edges.keys()].some(next => (params.get(next) || next) === target)) nodes.get(target)?.incoming.delete(node);
        }
        return result;
      };
      node.connect = entry.connect;
      node.disconnect = entry.disconnect;
      if (source) node.addEventListener?.("ended", () => { try { node.disconnect(); } catch {} }, { once: true });
      return node;
    }
    // Install before graph construction, including source and AudioParam connections.
    for (const factory of ["createGain", "createDynamicsCompressor", "createBiquadFilter", "createDelay", "createAnalyser", "createChannelSplitter", "createChannelMerger", "createStereoPanner", "createPanner", "createConvolver", "createWaveShaper", "createIIRFilter", "createMediaStreamDestination", "createBufferSource", "createOscillator", "createConstantSource", "createMediaStreamSource", "createMediaStreamTrackSource", "createMediaElementSource", "createScriptProcessor"]) {
      if (typeof context[factory] !== "function") continue;
      const create = context[factory].bind(context);
      context[factory] = (...args) => track(create(...args), /Source|Oscillator|ScriptProcessor/.test(factory));
      factories.set(factory, context[factory]);
    }
    return {
      setDestination(node) {
        if (destination || !nodes.has(node)) fail("Invalid recorder destination.");
        destination = node;
      },
      allowMusicSource(node) {
        const entry = nodes.get(node);
        if (!entry?.source || entry.monitor || typeof node.buffer === "undefined" || !node.buffer) fail("Only decoded music/stem buffers may be recorded.");
        entry.music = true;
      },
      monitorOnly(node) {
        const entry = nodes.get(node);
        if (!entry || (destination && reaches(node, destination))) fail("Monitor audio cannot join the recorder.");
        entry.monitor = true;
      },
      assertGraph,
      async armAndStartRecording(recorder, options) {
        if (arming || recorder.state !== "inactive") throw new Error("Recorder is already armed.");
        arming = true;
        try {
          assertGraph();
          if (recorder.stream !== destination.stream) throw new Error("Recorder stream is not the isolated master.");
          await runPreflight({ ...options, assertGraph });
          assertGraph();
          options.assertSignalClean?.();
          recorder.start(1000);
        } finally {
          arming = false;
        }
      }
    };
  }

  function inspectQuietFrame(frame) {
    if (!frame?.samples?.length || !frame?.spectrum?.length || !Number.isFinite(frame.sampleRate) || frame.sampleRate <= 0) throw new Error("Recorder preflight analysis is unavailable.");
    let energy = 0;
    let peak = 0;
    for (const value of frame.samples) {
      if (!Number.isFinite(value)) throw new Error("Invalid recorder preflight samples.");
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const rmsDb = 20 * Math.log10(Math.sqrt(energy / frame.samples.length));
    if (rmsDb > -75 || peak > Math.pow(10, -60 / 20)) throw new Error("Unexpected noise or cue bleed in the recorder feed. Stop monitoring leakage and retry.");
    let strongest = -Infinity;
    let strongestBin = 0;
    let totalPower = 0;
    frame.spectrum.forEach((db, bin) => {
      if (db !== -Infinity && !Number.isFinite(db)) throw new Error("Invalid recorder preflight spectrum.");
      totalPower += Math.pow(10, db / 10);
      if (db > strongest) { strongest = db; strongestBin = bin; }
    });
    const frequency = strongestBin * frame.sampleRate / (2 * frame.spectrum.length);
    const hum = [50, 60, 100, 120, 150, 180, 200, 240].some(hz => Math.abs(frequency - hz) <= frame.sampleRate / frame.spectrum.length);
    // Analyser FFT windowing lowers bin magnitudes relative to waveform amplitude.
    return { tonal: strongest > -100 && (hum || Math.pow(10, strongest / 10) / totalPower > .2), bin: strongestBin };
  }

  async function runPreflight(options = {}) {
    const { readFrames, assertGraph, context } = options;
    const wait = options.wait || (ms => new Promise(resolve => global.setTimeout(resolve, ms)));
    if (typeof readFrames !== "function" || typeof assertGraph !== "function" || !context) throw new Error("Recorder preflight is unavailable.");
    assertGraph();
    // Let stopped music, compressor release and deck effects drain before measuring silence.
    await wait(1200);
    const tones = new Map();
    let previousTime = context.currentTime;
    for (let index = 0; index < 8; index += 1) {
      await wait(100);
      assertGraph();
      if (context.state !== "running" || context.currentTime <= previousTime) throw new Error("Recorder preflight audio clock is not running.");
      previousTime = context.currentTime;
      const frames = readFrames();
      if (!Array.isArray(frames) || frames.length !== 2) throw new Error("Both recorder channels must pass preflight.");
      frames.forEach((frame, channel) => {
        const result = inspectQuietFrame(frame);
        const previous = tones.get(channel);
        const count = result.tonal ? (previous && Math.abs(previous.bin - result.bin) <= 1 ? previous.count + 1 : 1) : 0;
        tones.set(channel, { bin: result.bin, count });
        if (count >= 3) throw new Error("Hum or a steady test tone was detected in the recorder feed.");
      });
    }
    return true;
  }

  function evaluateRecorderGuard(inputs = {}, config = {}) {
    const settings = { ...DEFAULT_CONFIG, ...config };
    const isRecording = Boolean(inputs.isRecording);
    const cueBusActive = Boolean(inputs.cueBusActive);
    const masterBusLevel = clampLevel(inputs.masterBusLevel);
    const activeCueDecks = Array.isArray(inputs.activeCueDecks) ? inputs.activeCueDecks.slice() : [];
    const nearLimit = masterBusLevel > settings.masterLimit;
    const levelPercent = Math.round(masterBusLevel * 100);
    const bleedRisk = inputs.graphSecure !== true && isRecording && cueBusActive && nearLimit;

    if (inputs.graphSecure === false) {
      return {
        state: "triggered", isSecureToRecord: false, bleedDetected: true,
        isRecording, cueBusActive, masterBusLevel, activeCueDecks,
        title: TRIGGERED_TITLE,
        warningMessage: "Recorder routing isolation failed. Recording is blocked; reload the deck."
      };
    }

    if ("signalAudit" in inputs && (inputs.signalAudit?.clean !== true || inputs.signalAudit?.reliable !== true || inputs.signalAudit?.isolationSecure !== true)) {
      return {
        state: "triggered", isSecureToRecord: false, bleedDetected: false,
        isRecording, cueBusActive, masterBusLevel, activeCueDecks,
        title: TRIGGERED_TITLE,
        warningMessage: inputs.signalAudit?.reason || "Signal cleanup audit failed or is unavailable. Recording is blocked."
      };
    }

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
      message = "The recorder taps the post-limiter music bus only; CUE stays monitor-only. A quiet-feed isolation preflight is required before recording.";
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
  global.HaloRecorderGuard.createIsolation = createIsolation;
  global.HaloRecorderGuard.runPreflight = runPreflight;
  global.HaloRecorderGuard.inspectQuietFrame = inspectQuietFrame;
  global.HaloRecorderGuard.renderIndicator = renderRecorderGuardIndicator;
  global.useRecorderGuard = useRecorderGuard;
})(typeof window !== "undefined" ? window : globalThis);
