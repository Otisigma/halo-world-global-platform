const refresh = document.getElementById("refresh");
const verification = document.getElementById("verification");
const reportWindow = document.getElementById("report-window");
const statusPanel = document.getElementById("status-panel");
const refreshLabel = document.getElementById("refresh-label");
const motionToggle = document.getElementById("motion-toggle");
let expiry;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setMotion(enabled) {
  motionToggle.setAttribute("aria-pressed", String(enabled));
  document.body.dataset.motion = enabled ? "playing" : "paused";
}

motionToggle.hidden = false;
setMotion(!reducedMotion.matches);
motionToggle.addEventListener("click", () => setMotion(motionToggle.getAttribute("aria-pressed") !== "true"));
reducedMotion.addEventListener("change", () => setMotion(!reducedMotion.matches));

function unavailable() {
  clearTimeout(expiry);
  statusPanel.dataset.state = "awaiting";
  document.getElementById("protected").textContent = "Awaiting verification";
  document.getElementById("healthy").textContent = "Awaiting verification";
  document.getElementById("blocked").textContent = "—";
  document.getElementById("isolated").textContent = "—";
  verification.textContent = "Awaiting verification. No current protection report is available.";
  reportWindow.textContent = "Counts appear only for a verified reporting window. Unavailable does not mean unprotected.";
}

async function loadStatus() {
  if (refresh.disabled) return;
  refresh.disabled = true;
  refreshLabel.textContent = "Checking status…";
  statusPanel.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/halo-shield", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Unavailable");
    const report = await response.json();
    const age = Date.now() - Date.parse(report.observedAt);
    const outcomes = report.outcomes;
    if (report.verification !== "verified" || !Number.isFinite(age) || age < 0 || age >= 300000 ||
      !Number.isFinite(Date.parse(report.windowStart)) || Date.parse(report.windowStart) > Date.parse(report.observedAt) ||
      typeof outcomes?.protected !== "boolean" || typeof outcomes?.healthy !== "boolean" ||
      !Number.isSafeInteger(outcomes?.blocked) || outcomes.blocked < 0 ||
      !Number.isSafeInteger(outcomes?.isolated) || outcomes.isolated < 0) throw new Error("Unverified");
    clearTimeout(expiry);
    document.getElementById("protected").textContent = outcomes.protected ? "Protected" : "Not confirmed";
    document.getElementById("healthy").textContent = outcomes.healthy ? "Healthy" : "Not confirmed";
    document.getElementById("blocked").textContent = outcomes.blocked.toLocaleString();
    document.getElementById("isolated").textContent = outcomes.isolated.toLocaleString();
    statusPanel.dataset.state = "verified";
    verification.textContent = "Verified protection report";
    reportWindow.textContent = `Reporting window: ${new Date(report.windowStart).toLocaleString()} — ${new Date(report.observedAt).toLocaleString()}`;
    expiry = setTimeout(unavailable, 300000 - age);
  } catch {
    unavailable();
  } finally {
    refresh.disabled = false;
    refreshLabel.textContent = "Refresh status";
    statusPanel.setAttribute("aria-busy", "false");
  }
}

refresh.addEventListener("click", loadStatus);
loadStatus();
setInterval(loadStatus, 60000);
