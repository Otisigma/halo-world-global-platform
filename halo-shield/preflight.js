import { loadPreviewCandidate } from "../lib/guard-drive-preview.js";

const byId = id => document.getElementById(id);
const fields = ["originalRequest", "intent", "requestedApproach", "expectedBehavior", "affectedSurface", "acceptanceCriteria", "constraints"];
let candidate = null;
let authorized = false;
let revision = 0;
let timer;
let pending = false;

function stopMedia() {
  clearTimeout(timer);
  const container = byId("preview-container");
  container.querySelectorAll("audio").forEach(audio => { audio.pause(); audio.removeAttribute("src"); audio.load(); });
  container.replaceChildren();
}

function clear() {
  revision++;
  authorized = false;
  candidate = null;
  stopMedia();
  for (const id of ["load-candidate", "try-iframe", "try-primary", "try-proxy"]) byId(id).disabled = true;
  fields.forEach(id => { byId(id).value = ""; });
  byId("owner-observation").value = "";
  byId("preflight-report").textContent = "Locked. Private request cleared.";
  byId("preview-report").textContent = "not tested — private preview cleared.";
}

byId("preflight-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (pending) return;
  clearTimeout(timer);
  stopMedia();
  candidate = null;
  authorized = false;
  for (const id of ["load-candidate", "try-iframe", "try-primary", "try-proxy"]) byId(id).disabled = true;
  const current = ++revision;
  pending = true;
  try {
    const response = await fetch("/api/halo-control-center", {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preflight", request: Object.fromEntries(fields.map(id => [id, byId(id).value])) })
    });
    if (!response.ok) throw new Error("Owner authorization or request validation unavailable. Sign in through the Control Center.");
    const report = await response.json();
    if (revision !== current) return;
    byId("preflight-report").textContent = JSON.stringify(report.preflight, null, 2);
    authorized = report.preflight.status !== "blocked";
    byId("load-candidate").disabled = !authorized;
  } catch (error) {
    if (revision === current) byId("preflight-report").textContent = `blocked — ${error.name === "TimeoutError" ? "Owner preflight timed out" : "Owner authorization or preflight unavailable"}`;
  } finally {
    pending = false;
  }
});

byId("load-candidate").addEventListener("click", async () => {
  if (!authorized || pending) return;
  pending = true;
  const current = ++revision;
  candidate = null;
  stopMedia();
  for (const id of ["load-candidate", "try-iframe", "try-primary", "try-proxy"]) byId(id).disabled = true;
  try {
    const result = await loadPreviewCandidate({ origin: window.location.origin });
    if (revision !== current) return;
    candidate = result.candidate;
    byId("preview-report").textContent = JSON.stringify(result.evidence, null, 2);
    for (const id of ["try-iframe", "try-primary", "try-proxy"]) byId(id).disabled = !candidate;
    timer = setTimeout(clear, 60_000);
  } finally {
    pending = false;
    byId("load-candidate").disabled = !authorized;
  }
});

for (const mode of ["iframe", "primary", "proxy"]) {
  byId(`try-${mode}`).addEventListener("click", () => {
    if (!authorized || !candidate) return;
    stopMedia();
    const current = revision;
    const media = document.createElement(mode === "iframe" ? "iframe" : "audio");
    if (mode === "iframe") {
      media.title = "Owner-reviewed direct Google Drive preview diagnostic";
      media.referrerPolicy = "no-referrer";
      media.setAttribute("sandbox", "allow-scripts allow-same-origin");
      media.setAttribute("allow", "autoplay 'none'");
      media.width = "400";
      media.height = "200";
    } else {
      media.controls = true;
      media.preload = "none";
      for (const name of ["playing", "error", "stalled"]) {
        media.addEventListener(name, () => {
          if (revision === current) byId("preview-report").textContent += `\nbrowser observation: ${mode} ${name}; not proof of audible sound.`;
        });
      }
    }
    media.src = candidate[mode];
    byId("preview-container").append(media);
    byId("preview-report").textContent += `\nIsolated browser ${mode} mounted on owner gesture; audible playback NOT verified.`;
    timer = setTimeout(clear, 60_000);
  });
}

byId("clear-preview").addEventListener("click", clear);
window.addEventListener("pagehide", clear);
document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
