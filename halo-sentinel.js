import { createSentinel } from "./lib/halo-sentinel.js";

const panel = document.createElement("details");
panel.id = "halo-sentinel-console";
panel.className = "halo-sentinel";
const summary = document.createElement("summary");
summary.textContent = "HALO Sentinel / Watching";
const status = document.createElement("p");
status.id = "site-status";
status.setAttribute("role", "status");
status.textContent = "WATCHING / no playback verified";
const banner = document.createElement("p");
banner.setAttribute("aria-live", "polite");
const toggle = document.createElement("button");
toggle.type = "button";
toggle.textContent = "Pause runtime repairs";
const audit = document.createElement("ol");
const ledger = document.createElement("a");
ledger.href = "/halo-ledger/?category=system_event";
ledger.textContent = "Open platform ledger (sign in)";
panel.append(summary, status, banner, toggle, audit, ledger);
document.body.append(panel);

window.HaloSentinel = createSentinel({
  window, document,
  onUpdate({ enabled, events }) {
    const last = events.at(-1);
    const active = events.filter(event => ["detected", "recovery_available", "unresolved"].includes(event.state)
      && !events.some(later => later.kind === event.kind && later.target === event.target && later.state === "recovered"
        && later.timestamp >= event.timestamp));
    const attention = active.length > 0;
    status.textContent = !enabled ? "PAUSED / runtime repairs disabled"
      : active.some(event => event.state === "unresolved") ? "ATTENTION / unresolved fault requires review"
        : attention ? "SELF-HEALING ACTIVE / recovery controls available" : "WATCHING / no playback verified";
    summary.textContent = `HALO Sentinel / ${!enabled ? "Paused" : attention ? "Attention" : "Watching"}`;
    banner.textContent = last?.state === "recovery_available"
      ? "Recovery controls are available. Tap Play with sound, retry Preview, or choose a local file where offered."
      : last?.state === "unresolved" ? "A fault still needs attention. Inspect the audit trail; no source fix has been applied." : "";
    toggle.textContent = enabled ? "Pause runtime repairs" : "Resume runtime repairs";
    toggle.setAttribute("aria-pressed", String(!enabled));
    audit.replaceChildren(...events.slice(-12).map(event => {
      const row = document.createElement("li");
      row.textContent = `${event.timestamp} / ${event.severity} / ${event.kind}: ${event.state} / ledger ${event.delivery}`;
      return row;
    }));
  }
});
toggle.addEventListener("click", () => window.HaloSentinel.setEnabled(!window.HaloSentinel.snapshot().enabled));
window.addEventListener("pagehide", event => { if (!event.persisted) window.HaloSentinel.dispose(); });
