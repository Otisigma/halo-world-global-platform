(function (global) {
  "use strict";

  // HALO audio routing guard.
  // Separates the live/master mix path from background processing (stem analysis, transition
  // kit preparation, AI audio work, meters). Utility nodes may only feed other utility nodes or a
  // muted, terminal utility bus that has no outputs, so they cannot reach the speakers, the
  // master bus or the recording destination. Jobs that do not need live output should render in
  // an OfflineAudioContext, which cannot connect to a live context at all.

  class AudioRoutingLeakError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = "AudioRoutingLeakError";
      this.details = details;
    }
  }

  function isAudioNode(target) {
    return Boolean(target) && typeof target.connect === "function";
  }

  function offlineContextClass() {
    return global.OfflineAudioContext || global.webkitOfflineAudioContext || null;
  }

  function createOfflineProcessingContext(options = {}) {
    const OfflineContextClass = offlineContextClass();
    if (!OfflineContextClass) throw new Error("This browser does not support offline audio processing.");
    const numberOfChannels = Math.max(1, Math.floor(Number(options.numberOfChannels) || 2));
    const length = Math.floor(Number(options.length));
    const sampleRate = Number(options.sampleRate) || 44100;
    if (!Number.isFinite(length) || length < 1) throw new RangeError("Offline processing needs a positive frame length.");
    // Positional arguments keep older WebKit offline contexts working.
    return new OfflineContextClass(numberOfChannels, length, sampleRate);
  }

  function startRendering(context) {
    const rendering = context.startRendering();
    if (rendering && typeof rendering.then === "function") return rendering;
    return new Promise(resolve => {
      context.oncomplete = event => resolve(event.renderedBuffer);
    });
  }

  // Renders `audioBuffer` through an optional processing chain entirely in memory.
  // `build(offlineContext, source)` may return the last node of the chain; it must belong to the
  // offline context, otherwise the job is refused before anything is started.
  function renderOffline(audioBuffer, build) {
    if (!audioBuffer || !Number(audioBuffer.length)) return Promise.reject(new TypeError("renderOffline needs an AudioBuffer."));
    let context;
    try {
      context = createOfflineProcessingContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
        sampleRate: audioBuffer.sampleRate
      });
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      const output = (typeof build === "function" && build(context, source)) || source;
      if (!isAudioNode(output) || (output.context && output.context !== context)) {
        throw new AudioRoutingLeakError("Offline processing must stay inside its OfflineAudioContext.", { type: "offline-escape" });
      }
      output.connect(context.destination);
      source.start(0);
    } catch (error) {
      return Promise.reject(error);
    }
    return startRendering(context);
  }

  function createAudioRoutingGuard(context, options = {}) {
    if (!context || typeof context.createGain !== "function") throw new TypeError("The audio routing guard needs an AudioContext.");
    const strict = options.strict !== false;
    const onViolation = typeof options.onViolation === "function" ? options.onViolation : null;

    const liveBus = options.liveBus || context.createGain();
    if (!options.liveBus) liveBus.connect(context.destination);

    const protectedNodes = new Set([context.destination, liveBus, ...(options.protectedNodes || [])].filter(Boolean));
    const liveNodes = new WeakSet();
    const utilityNodes = new Set();
    const utilityEdges = new Map();
    const guardedConnects = new WeakMap();
    const violations = [];

    const utilityBus = context.createGain();

    function isLive(node) {
      return Boolean(node) && (protectedNodes.has(node) || liveNodes.has(node));
    }

    function isUtility(node) {
      return Boolean(node) && utilityNodes.has(node);
    }

    function describe(target) {
      if (!target) return "nothing";
      if (target === context.destination) return "speaker output";
      if (target === liveBus) return "live master bus";
      if (protectedNodes.has(target)) return "master/recording path";
      if (liveNodes.has(target)) return "live mix node";
      if (!isAudioNode(target)) return "AudioParam";
      return "unguarded node";
    }

    function report(type, message, details = {}) {
      const violation = { type, message, ...details };
      violations.push(violation);
      if (onViolation) {
        try { onViolation(violation); } catch {}
      } else if (global.console && typeof global.console.warn === "function") {
        global.console.warn(`[HALO audio routing] ${message}`);
      }
      if (strict) throw new AudioRoutingLeakError(message, violation);
      return violation;
    }

    function muteUtilityBus() {
      utilityBus.gain.value = 0;
    }

    function guardOutputs(node) {
      if (guardedConnects.has(node)) return;
      const nativeConnect = node.connect;
      const nativeDisconnect = node.disconnect;
      const guardedConnect = function (target, ...rest) {
        if (!isUtility(node)) return nativeConnect.call(node, target, ...rest);
        if (node === utilityBus || !isAudioNode(target) || !isUtility(target)) {
          report("utility-leak", `Blocked background audio from reaching the ${describe(target)}.`, { target: describe(target) });
          return target;
        }
        const result = nativeConnect.call(node, target, ...rest);
        if (!utilityEdges.has(node)) utilityEdges.set(node, new Set());
        utilityEdges.get(node).add(target);
        return result;
      };
      node.connect = guardedConnect;
      if (typeof nativeDisconnect === "function") {
        node.disconnect = function (...args) {
          if (!args.length) utilityEdges.delete(node);
          else if (args[0] && typeof args[0] === "object") utilityEdges.get(node)?.delete(args[0]);
          return nativeDisconnect.apply(node, args);
        };
      }
      guardedConnects.set(node, guardedConnect);
    }

    function markUtility(node) {
      if (!isAudioNode(node)) {
        report("invalid-node", "Only audio nodes can join the utility bus.");
        return false;
      }
      if (isLive(node)) {
        report("live-node-demoted", `The ${describe(node)} cannot be reused for background processing.`, { target: describe(node) });
        return false;
      }
      utilityNodes.add(node);
      guardOutputs(node);
      return true;
    }

    utilityNodes.add(utilityBus);
    guardOutputs(utilityBus);
    muteUtilityBus();

    function connectUtility(node, target = utilityBus) {
      if (!isUtility(target)) {
        report("utility-leak", `Blocked background audio from reaching the ${describe(target)}.`, { target: describe(target) });
        return node;
      }
      if (!markUtility(node)) return node;
      muteUtilityBus();
      node.connect(target);
      return node;
    }

    function connectLive(node, target = liveBus, ...rest) {
      if (!isAudioNode(node)) {
        report("invalid-node", "Only audio nodes can join the live mix.");
        return node;
      }
      if (isUtility(node)) {
        report("utility-leak", `Blocked a background processing node from joining the ${describe(target)}.`, { target: describe(target) });
        return node;
      }
      if (!target || isUtility(target)) {
        report("live-misroute", "Live audio must route to the live mix, not the utility bus.", { target: describe(target) });
        return node;
      }
      liveNodes.add(node);
      if (isAudioNode(target)) liveNodes.add(target);
      node.connect(target, ...rest);
      return node;
    }

    // Read-only analysis tap: live audio may feed a utility node (meter/analyser), never the reverse.
    function tap(liveNode, utilityNode) {
      if (!isUtility(utilityNode)) connectUtility(utilityNode);
      if (!isUtility(utilityNode)) return utilityNode;
      if (isUtility(liveNode)) return connectUtility(liveNode, utilityNode);
      liveNode.connect(utilityNode);
      return utilityNode;
    }

    function release(node) {
      if (!node || node === utilityBus) return;
      try { node.disconnect(); } catch {}
      utilityNodes.delete(node);
      utilityEdges.delete(node);
      liveNodes.delete(node);
    }

    function assertNoUtilityLeak() {
      const leaks = [];
      if (utilityBus.gain.value !== 0) {
        leaks.push({ type: "utility-bus-unmuted", message: "The utility bus was unmuted." });
        muteUtilityBus();
      }
      if (utilityEdges.get(utilityBus)?.size) leaks.push({ type: "utility-bus-connected", message: "The utility bus has an output connection." });
      for (const node of utilityNodes) {
        if (node.connect !== guardedConnects.get(node)) {
          leaks.push({ type: "guard-bypassed", message: "A background processing node lost its routing guard." });
        }
        for (const target of utilityEdges.get(node) || []) {
          if (!isUtility(target) || isLive(target)) {
            leaks.push({ type: "utility-leak", message: `Background audio reaches the ${describe(target)}.`, target: describe(target) });
          }
        }
        if (isLive(node)) leaks.push({ type: "utility-leak", message: `The ${describe(node)} is also tagged as background processing.` });
      }
      const result = { ok: leaks.length === 0, leaks, utilityNodeCount: utilityNodes.size };
      if (!result.ok) {
        violations.push(...leaks);
        if (onViolation) leaks.forEach(leak => { try { onViolation(leak); } catch {} });
        if (strict) throw new AudioRoutingLeakError(leaks[0].message, result);
      }
      return result;
    }

    return {
      context,
      liveBus,
      utilityBus,
      strict,
      violations,
      connectLive,
      connectUtility,
      tap,
      release,
      isUtility,
      isLive,
      assertNoUtilityLeak,
      createOfflineProcessingContext,
      renderOffline
    };
  }

  global.HaloAudioRoutingGuard = Object.freeze({
    create: createAudioRoutingGuard,
    createOfflineProcessingContext,
    renderOffline,
    AudioRoutingLeakError
  });
})(typeof window !== "undefined" ? window : globalThis);
