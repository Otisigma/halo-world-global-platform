const STATES = new Set(["detected", "recovery_available", "recovered", "unresolved", "disabled"]);
const KINDS = new Set(["binding", "transport", "autoplay", "canvas", "canonical", "runtime"]);
const MAX_EVENTS = 40;
const MAX_DELIVERIES = 16;

export function sentinelSource(value, origin) {
  try {
    const url = new URL(value, origin);
    if (!value || url.username || url.password) return "";
    if (url.protocol === "blob:") return url.origin === origin ? url.href : "";
    if (url.protocol === "https:" || (url.origin === origin && url.protocol === "http:")) return url.href;
  } catch { /* Invalid sources are reported by the caller. */ }
  return "";
}

export function createSentinel({
  window, document, fetch = globalThis.fetch, onUpdate = () => {},
  clock = () => Date.now()
}) {
  const origin = window.location.origin;
  const page = window.location.pathname.startsWith("/dreamweaver/") ? "/dreamweaver/" : "/album-concierge/";
  const events = [];
  const dedupe = new Map();
  const controllers = new Map();
  const pending = new Set();
  const deliveryAttempts = new WeakMap();
  const cleanups = [];
  let deliveryWindow = clock();
  let enabled = true, deliveries = 0, checking = false, disposed = false;

  function record(kind, state, target = "player") {
    if (!KINDS.has(kind) || !STATES.has(state)) throw new Error("Invalid Sentinel event");
    const signature = `${page}|${kind}|${target}|${state}`;
    if (dedupe.has(signature) && clock() - dedupe.get(signature) < 60000) return;
    dedupe.set(signature, clock());
    const event = {
      kind, state, target, page, signature,
      severity: ["canonical", "autoplay"].includes(kind) ? "warning" : "critical",
      timestamp: new Date(clock()).toISOString(), delivery: "queued"
    };
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    publish();
    void deliver(event);
  }

  function publish() {
    onUpdate({ enabled, events: events.map(event => ({ ...event })) });
  }

  async function deliver(event) {
    if (clock() - deliveryWindow >= 60000) {
      deliveryWindow = clock();
      deliveries = 0;
    }
    if (event.delivery === "sending" || event.delivery === "stored" || deliveries >= MAX_DELIVERIES
      || (deliveryAttempts.get(event) || 0) >= 3 || disposed) return;
    deliveries++;
    deliveryAttempts.set(event, (deliveryAttempts.get(event) || 0) + 1);
    event.delivery = "sending";
    try {
      const response = await fetch("/api/sentinel/events", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: event.kind, state: event.state, target: event.target, page }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`Sentinel ledger returned ${response.status}`);
      const result = await response.json();
      if (result.stored !== true) throw new Error("Sentinel ledger did not acknowledge storage");
      event.delivery = "stored";
    } catch (error) {
      event.delivery = "failed";
      window.console.error("HALO Sentinel audit delivery failed", error instanceof Error ? error.message : "unknown error");
    }
    publish();
  }

  function listen(target, name, listener) {
    target.addEventListener(name, listener);
    cleanups.push(() => target.removeEventListener(name, listener));
  }

  function bind({ audio, expectedSource, onUnavailable, onBlocked, target = "player", recoverOnError = true }) {
    if (!audio || controllers.has(audio)) return;
    if (!["player", "showcase"].includes(target)) throw new Error("Invalid Sentinel media target");
    const controller = { audio, expectedSource, onUnavailable, onBlocked, target, failedSource: "", recoveries: new Set() };
    controllers.set(audio, controller);
    listen(audio, "error", () => {
      if (enabled && audio.getAttribute("src")) fail(controller, "transport", recoverOnError);
    });
    listen(audio, "playing", () => {
      if (!enabled) return;
      for (const kind of controller.recoveries) record(kind, "recovered", target);
      controller.failedSource = "";
      controller.recoveries.clear();
    });
  }

  function fail(controller, kind, repair = true) {
    const source = controller.audio.getAttribute("src") || "";
    if (controller.failedSource === source && source) return;
    controller.failedSource = source;
    controller.recoveries.add(kind);
    record(kind, "detected", controller.target);
    try {
      if (repair) controller.onUnavailable?.();
      record(kind, "recovery_available", controller.target);
    } catch (error) {
      record(kind, "unresolved", controller.target);
      window.console.error("HALO Sentinel recovery failed", error instanceof Error ? error.message : "unknown error");
    }
  }

  function blocked(audio) {
    if (!enabled) return;
    const controller = controllers.get(audio);
    if (!controller) return;
    record("autoplay", "detected", controller.target);
    try { controller.onBlocked?.(); } catch (error) {
      record("autoplay", "unresolved", controller.target);
      window.console.error("HALO Sentinel sound recovery failed", error instanceof Error ? error.message : "unknown error");
      return;
    }
    controller.recoveries.add("autoplay");
    record("autoplay", "recovery_available", controller.target);
  }

  function mediaReadiness(audio, signal, timeoutMs = 12000) {
    if (audio.error) return Promise.resolve(false);
    if (Number(audio.readyState) >= 1) return Promise.resolve(true);
    // Data-saving players defer loading until a gesture; the element's own error event covers that later load.
    if (audio.preload === "none" && audio.networkState !== 2) return Promise.resolve(null);
    return new Promise(resolve => {
      const finish = value => {
        window.clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", ready);
        audio.removeEventListener("error", failed);
        signal.removeEventListener("abort", failed);
        resolve(value);
      };
      const ready = () => finish(true);
      const failed = () => finish(false);
      const timer = window.setTimeout(failed, timeoutMs);
      audio.addEventListener("loadedmetadata", ready);
      audio.addEventListener("error", failed);
      signal.addEventListener("abort", failed);
    });
  }

  async function preflight(audio, value, { recover = true } = {}) {
    delete audio.dataset.sentinelTransport;
    const source = sentinelSource(value, origin);
    if (!enabled || source.startsWith("blob:")) return { ok: true, checked: false };
    const controller = controllers.get(audio);
    if (!controller) throw new Error("Sentinel media must be registered before preflight");
    controller.failedSource = "";
    if (!source) {
      fail(controller, "binding", recover);
      return { ok: false };
    }
    const abort = new AbortController();
    pending.add(abort);
    const current = () => sentinelSource(audio.getAttribute("src"), origin) === source;
    let response;
    try {
      try {
        response = await fetch(source, {
          method: "HEAD", mode: "cors", credentials: new URL(source).origin === origin ? "same-origin" : "omit",
          redirect: "follow", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)])
        });
      } catch (error) {
        // An opaque network failure is often a CORS-less signed storage redirect that <audio> may still play natively.
        if (error?.name !== "TypeError" || !enabled || !current()) throw error;
        const ready = await mediaReadiness(audio, abort.signal);
        if (!enabled || !current()) return { ok: false, stale: true };
        if (ready === null) return { ok: true, checked: false };
        if (!ready) throw new Error("The browser could not load the selected audio");
        audio.dataset.sentinelTransport = "element-verified";
        return { ok: true, checked: true };
      }
      if (!enabled || !current()) return { ok: false, stale: true };
      if (![200, 206].includes(response.status) || !/^audio\//i.test(response.headers.get("content-type") || "")) {
        throw new Error("Stream preflight did not return audio headers");
      }
      if (audio.error) throw new Error("The browser rejected the selected audio");
      audio.dataset.sentinelTransport = "headers-verified";
      return { ok: true, checked: true };
    } catch (error) {
      if (!enabled || !current()) return { ok: false, stale: true };
      window.console.warn("HALO Sentinel stream preflight failed", error instanceof Error ? error.message : "unknown error");
      fail(controller, "transport", recover);
      return { ok: false, status: response?.status || 0 };
    } finally {
      pending.delete(abort);
    }
  }

  function checkBindings() {
    if (!enabled || checking) return;
    checking = true;
    try {
      for (const event of events) if (["queued", "failed"].includes(event.delivery)) void deliver(event);
      for (const controller of controllers.values()) {
        if (controller.audio.getAttribute("src")) continue;
        const selected = controller.expectedSource();
        const source = sentinelSource(selected, origin);
        if (selected && !source) record("binding", "unresolved", controller.target);
        if (!source || source.startsWith("blob:")) continue;
        record("binding", "detected", controller.target);
        controller.audio.src = source;
        controller.audio.load();
        controller.recoveries.add("binding");
        record("binding", "recovery_available", controller.target);
        void preflight(controller.audio, source);
      }
      for (const link of document.querySelectorAll("[data-sentinel-canonical]")) {
        let expected, actual;
        try {
          expected = new URL(link.dataset.sentinelCanonical, origin);
          actual = new URL(link.getAttribute("href") || "", origin);
        } catch {
          record("canonical", "unresolved", "canonical");
          continue;
        }
        if (expected.origin !== origin || !["/dreamweaver/", "/album-concierge/"].includes(expected.pathname)
          || expected.search || expected.hash) continue;
        if (actual.origin !== origin || actual.pathname.replace(/\/$/, "") !== expected.pathname.replace(/\/$/, "")) {
          record("canonical", "unresolved", "canonical");
          continue;
        }
        if (actual.pathname === expected.pathname) continue;
        record("canonical", "detected", "canonical");
        actual.pathname = expected.pathname;
        link.href = actual.href;
        record("canonical", "recovered", "canonical");
      }
    } catch (error) {
      record("runtime", "unresolved", "runtime");
      window.console.error("HALO Sentinel binding inspection failed", error instanceof Error ? error.message : "unknown error");
    } finally {
      checking = false;
    }
  }

  function canvasContext(canvas) {
    let context = null;
    try { context = canvas?.getContext("2d"); } catch (error) {
      window.console.warn("HALO Sentinel canvas unavailable", error instanceof Error ? error.message : "unknown error");
    }
    if (!context && enabled) record("canvas", "unresolved", "canvas");
    return context;
  }

  function setEnabled(value) {
    enabled = Boolean(value) && !disposed;
    if (!enabled) for (const abort of pending) abort.abort();
    publish();
  }

  listen(window, "unhandledrejection", () => {
    if (enabled) record("runtime", "unresolved", "runtime");
    // Unknown promises cannot safely be attributed to audio or suppressed.
  });
  listen(window, "error", event => {
    if (enabled && event.target === window) record("runtime", "unresolved", "runtime");
  });
  listen(window, "online", () => {
    for (const event of events) if (event.delivery === "failed") void deliver(event);
  });
  const timer = window.setInterval(checkBindings, 15000);
  const observer = new window.MutationObserver(checkBindings);
  observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["src", "href"] });
  function dispose() {
    setEnabled(false);
    disposed = true;
    observer.disconnect();
    window.clearInterval(timer);
    cleanups.forEach(cleanup => cleanup());
    controllers.clear();
  }
  return { bind, blocked, preflight, checkBindings, canvasContext, setEnabled, dispose,
    snapshot: () => ({ enabled, events: events.map(event => ({ ...event })) }) };
}
