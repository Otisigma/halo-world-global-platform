const form = document.getElementById("operator-form");
const token = document.getElementById("operator-token");
const status = document.getElementById("operator-status");
const report = document.getElementById("operator-report");
let activeRequest;

function clearReport() {
  activeRequest?.abort();
  activeRequest = null;
  token.value = "";
  report.textContent = "";
  report.hidden = true;
  status.textContent = "Locked. No telemetry loaded.";
}

document.getElementById("clear-report").addEventListener("click", clearReport);
window.addEventListener("pagehide", clearReport);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearReport();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const authorization = ["Bearer", token.value].join(" ");
  clearReport();
  const controller = new AbortController();
  activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 10000);
  status.textContent = "Checking access…";
  try {
    const response = await fetch("/api/halo-shield/internal", {
      headers: { Authorization: authorization },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Unavailable");
    const data = await response.json();
    if (activeRequest !== controller) return;
    report.textContent = JSON.stringify(data.snapshot, null, 2);
    report.hidden = false;
    status.textContent = data.snapshot ? "Private report loaded." : "No report received yet.";
  } catch {
    if (activeRequest === controller) status.textContent = "Access denied or telemetry unavailable.";
  } finally {
    clearTimeout(timeout);
    if (activeRequest === controller) activeRequest = null;
  }
});
