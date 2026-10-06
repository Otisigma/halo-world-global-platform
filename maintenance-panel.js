(() => {
  const store = window.HaloAlertStore;
  if (!store) return;

  const escapeHTML = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);

  function mount() {
    const trigger = document.querySelector("#maintenanceDock");
    if (!trigger || document.querySelector("#maintenancePanel")) return;
    const panel = document.createElement("section");
    panel.id = "maintenancePanel";
    panel.className = "maintenance-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "maintenancePanelTitle");
    panel.innerHTML = `<div class="maintenance-panel__head"><h2 id="maintenancePanelTitle">Maintenance alerts</h2><button type="button" data-panel-close aria-label="Close maintenance alerts">×</button></div><div class="maintenance-panel__actions"><span data-alert-summary>0 alerts</span><button type="button" data-clear-alerts>Clear all</button></div><div class="maintenance-panel__list" aria-live="polite"></div>`;
    document.body.append(panel);
    trigger.setAttribute("aria-controls", panel.id);
    trigger.setAttribute("aria-expanded", "false");

    const list = panel.querySelector(".maintenance-panel__list");
    function render(alerts) {
      const count = trigger.querySelector("#maintenanceDockCount");
      if (count) count.textContent = `${alerts.length} alert${alerts.length === 1 ? "" : "s"}`;
      trigger.setAttribute("aria-label", `Show maintenance alerts, ${alerts.length} active`);
      panel.querySelector("[data-alert-summary]").textContent = `${alerts.length} active alert${alerts.length === 1 ? "" : "s"}`;
      list.innerHTML = alerts.length ? alerts.map(alert => `<article class="maintenance-alert" data-severity="${escapeHTML(alert.severity)}"><div><strong>${escapeHTML(alert.title)}</strong><p>${escapeHTML(alert.message)}</p><small>${escapeHTML(alert.category)} · ${escapeHTML(new Date(alert.updatedAt).toLocaleTimeString())}</small></div>${alert.retryable ? `<button type="button" data-alert-retry="${escapeHTML(alert.id)}">Retry</button>` : ""}</article>`).join("") : `<p class="maintenance-panel__empty">No active maintenance alerts.</p>`;
    }

    store.subscribe(render);
    trigger.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      trigger.setAttribute("aria-expanded", String(!panel.hidden));
    });
    panel.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.matches("[data-panel-close]")) {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      }
      if (button.matches("[data-clear-alerts]")) store.clear();
      if (button.matches("[data-alert-retry]")) {
        const alert = store.list().find(item => item.id === button.dataset.alertRetry);
        window.dispatchEvent(new CustomEvent("halo:maintenance-retry", { detail: alert || null }));
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
