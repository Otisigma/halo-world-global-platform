import { RELEASE_STAGES } from "./release-conveyor-stages.js";

// Owner-facing status uses text-only rendering; generated copy is never inserted as HTML.
export function createReleaseConveyorConsole({ root, doc = document, fetcher = fetch, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const status = root.querySelector("[data-conveyor-status]");
  const stages = root.querySelector("[data-conveyor-stages]");
  const progress = root.querySelector("[data-conveyor-progress]");
  const progressBar = root.querySelector("[data-conveyor-progress-bar]");
  const percentText = root.querySelector("[data-conveyor-percent-text]");
  const currentStep = root.querySelector("[data-conveyor-current-step]");
  const badge = root.querySelector("[data-conveyor-status-badge]");
  const issues = root.querySelector("[data-conveyor-issues]");
  const runButton = root.querySelector("[data-conveyor-run]");
  const refreshButton = root.querySelector("[data-conveyor-refresh]");
  const packageLink = root.querySelector("[data-conveyor-package]");
  const audioLink = root.querySelector("[data-conveyor-audio]");
  const documentsLink = root.querySelector("[data-conveyor-documents]");
  const promotionLink = root.querySelector("[data-conveyor-promotion]");
  const hum = root.querySelector("[data-conveyor-hum]");
  let selectedId = "", generation = 0, revision = 0, busy = false, lastState = null, timer, paused = false;
  function scheduleRefresh() {
    clearTimer(timer);
    if (selectedId && !paused) timer = setTimer(refreshProgress, 2000);
  }
  async function refreshProgress() {
    const id = selectedId, ticket = generation, version = revision;
    try {
      const response = await fetcher(`/api/release-conveyor?songId=${encodeURIComponent(id)}`, { credentials: "same-origin" });
      const state = await response.json();
      if (ticket !== generation || version !== revision) return;
      render(response.ok ? state : { status: "retryable", message: state.message || "Retry shortly." });
      if (response.ok && state.options && !state.busy && !busy) hum.value = String(state.options.humHz || 0);
    } catch {
      if (ticket === generation && version === revision) render({ status: "retryable", message: "Connection interrupted. Your song is safe; retry shortly." });
    } finally {
      if (ticket === generation) scheduleRefresh();
    }
  }
  function render(state) {
    lastState = state;
    status.textContent = state?.receipt?.ready
      ? "Release package ready for creator review and publication. No external distribution has been submitted."
      : `Conveyor: ${state?.status || "not started"}. ${state?.message || "Save metadata and upload audio; processing starts automatically."}${state?.receipt?.nextRetryAt ? ` Automatic retry after ${state.receipt.nextRetryAt}.` : ""}`;
    stages.replaceChildren();
    issues.replaceChildren();
    const source = state?.receipt?.stages || state?.stages;
    const pipeline = RELEASE_STAGES.map(name => {
      const stage = state?.status !== "stale" && Array.isArray(source) ? source.find(item => item?.name === name) : null;
      const stageStatus = ["passed", "repaired"].includes(stage?.status) ? "passed"
        : ["blocked", "failed"].includes(stage?.status) ? "blocked" : "pending";
      return { ...stage, name, status: stageStatus, repaired: stage?.status === "repaired" };
    });
    const passed = pipeline.filter(stage => stage.status === "passed").length;
    const percent = Math.round(passed / pipeline.length * 100);
    const active = pipeline.find(stage => stage.status !== "passed");
    progress.setAttribute("aria-valuenow", String(percent));
    progressBar.style.width = `${percent}%`;
    percentText.textContent = `${percent}% Completed (${passed}/${pipeline.length} stages)`;
    currentStep.textContent = `Active Dept: ${!selectedId ? "Select a song" : state?.status === "stale" ? "Awaiting rerun"
      : active ? `${active.name.replaceAll("_", " ").toUpperCase()} (${active.status})` : "Complete"}`;
    const blocked = pipeline.some(stage => stage.status === "blocked") || ["blocked", "escalated"].includes(state?.status);
    badge.textContent = state?.status === "stale" ? "NEEDS RERUN" : blocked ? "ESCALATED / BLOCKED"
      : state?.receipt?.ready && passed === pipeline.length ? "FULLY CLEARED"
        : state?.status === "retryable" ? "RETRY SCHEDULED" : state?.status === "processing" || state?.busy ? "PROCESSING" : "PENDING";
    badge.setAttribute("data-state", state?.status === "stale" ? "pending" : blocked ? "blocked"
      : state?.receipt?.ready && passed === pipeline.length ? "passed" : "pending");
    for (const stage of pipeline) {
      const item = doc.createElement("li");
      item.setAttribute("data-state", stage.status);
      const symbol = stage.status === "passed" ? "✔" : stage.status === "blocked" ? "✖" : "•";
      item.textContent = `${symbol} ${stage.name.replaceAll("_", " ")}: ${stage.status}${stage.repaired ? " (repaired)" : ""}${stage.summary || stage.detail ? ` — ${stage.summary || stage.detail}` : ""}`;
      stages.append(item);
    }
    for (const issue of [...(state?.receipt?.blocked || []), ...(state?.watchdog?.findings || [])]) {
      const item = doc.createElement("li");
      item.textContent = `${issue.field}: ${issue.message}`;
      issues.append(item);
    }
    packageLink.hidden = !state?.receipt?.ready;
    documentsLink.hidden = !state?.receipt?.ready;
    promotionLink.hidden = !state?.receipt?.ready;
    audioLink.hidden = state?.status === "stale" || !state?.package?.audio?.downloadUrl;
    packageLink.href = `/api/release-conveyor?songId=${encodeURIComponent(selectedId)}&artifact=package`;
    audioLink.href = `/api/release-conveyor?songId=${encodeURIComponent(selectedId)}&artifact=audio`;
    documentsLink.href = `/api/release-conveyor?songId=${encodeURIComponent(selectedId)}&artifact=documents`;
    promotionLink.href = `/api/release-conveyor?songId=${encodeURIComponent(selectedId)}&artifact=promotion`;
  }
  async function request(process = false) {
    const id = selectedId, ticket = generation;
    if (!id || busy) return;
    revision++;
    paused = false;
    scheduleRefresh();
    busy = true;
    runButton.disabled = true;
    refreshButton.disabled = true;
    hum.disabled = true;
    root.setAttribute("aria-busy", "true");
    if (process) status.textContent = "Processing intake → audio → rights → Council → packaging → release handoff…";
    try {
      const response = await fetcher(process ? "/api/release-conveyor" : `/api/release-conveyor?songId=${encodeURIComponent(id)}`, {
        credentials: "same-origin",
        ...(process ? { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process_submission", songId: id, humHz: hum.value === "both" ? "both" : Number(hum.value) }) } : {}),
      });
      const state = await response.json();
      if (ticket !== generation) return;
      revision++;
      if (!response.ok) {
        // A failed refresh must not leave a previous ready package visible.
        render({ status: state.status || "retryable", message: state.message || "Retry shortly." });
      } else {
        render(state);
        if (state.options && !state.busy) hum.value = String(state.options.humHz || 0);
      }
    } catch {
      if (ticket === generation) {
        revision++;
        render({ status: "retryable", message: "Connection interrupted. Your song is safe; retry shortly." });
      }
    } finally {
      busy = false;
      runButton.disabled = !selectedId;
      refreshButton.disabled = !selectedId;
      hum.disabled = false;
      root.setAttribute("aria-busy", "false");
      if (ticket !== generation && selectedId) void request();
    }
  }
  runButton.addEventListener("click", () => request(true));
  refreshButton.addEventListener("click", () => request());
  hum.addEventListener("change", () => {
    revision++;
    paused = true;
    clearTimer(timer);
    if (lastState) render({ ...lastState, status: "stale", receipt: { ...lastState.receipt, ready: false } });
  });
  return {
    select(songId) {
      selectedId = songId || "";
      generation++;
      paused = false;
      clearTimer(timer);
      render(null);
      if (selectedId) void request();
    },
    dispose() {
      selectedId = "";
      generation++;
      clearTimer(timer);
    },
  };
}
