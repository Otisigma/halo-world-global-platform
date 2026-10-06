((root) => {
  const MAX_ALERTS = 50;
  const alerts = new Map();
  const listeners = new Set();

  function notify() {
    const snapshot = list();
    listeners.forEach(listener => {
      try { listener(snapshot); } catch {}
    });
    root.dispatchEvent?.(new CustomEvent("halo:maintenance-alerts", { detail: snapshot }));
  }

  function normalize(alert = {}) {
    const id = String(alert.id || `${alert.category || "maintenance"}:${alert.title || "alert"}`).slice(0, 180);
    return {
      id,
      title: String(alert.title || "Maintenance alert").slice(0, 160),
      message: String(alert.message || "").slice(0, 600),
      category: String(alert.category || "maintenance").slice(0, 80),
      severity: ["critical", "warning", "info"].includes(alert.severity) ? alert.severity : "warning",
      retryable: alert.retryable === true,
      fingerprint: String(alert.fingerprint || "").slice(0, 240),
      updatedAt: new Date().toISOString()
    };
  }

  function upsert(alert) {
    const value = normalize(alert);
    alerts.delete(value.id);
    alerts.set(value.id, value);
    while (alerts.size > MAX_ALERTS) alerts.delete(alerts.keys().next().value);
    notify();
    return value;
  }

  function remove(id) {
    const changed = alerts.delete(String(id));
    if (changed) notify();
    return changed;
  }

  function clear() {
    if (!alerts.size) return;
    alerts.clear();
    notify();
  }

  function list() {
    return [...alerts.values()].reverse();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(list());
    return () => listeners.delete(listener);
  }

  root.HaloAlertStore = Object.freeze({ MAX_ALERTS, upsert, remove, clear, list, subscribe });

  root.addEventListener?.("error", event => {
    if (event.target !== root) return;
    const message = String(event.message || "Unknown JavaScript error");
    upsert({ id: `runtime:${message}`, title: "Runtime error", message, category: "runtime", severity: "critical" });
  });
  root.addEventListener?.("unhandledrejection", event => {
    const message = String(event.reason?.message || event.reason || "Unhandled promise rejection");
    upsert({ id: `rejection:${message}`, title: "Unhandled promise rejection", message, category: "runtime", severity: "critical" });
  });
  root.addEventListener?.("offline", () => upsert({
    id: "network:offline", title: "Network unavailable", message: "Browser is offline; maintenance reports may not reach the server.",
    category: "network", severity: "warning", retryable: true
  }));
  root.addEventListener?.("online", () => remove("network:offline"));
})(typeof window !== "undefined" ? window : globalThis);
