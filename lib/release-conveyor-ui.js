// Owner-facing status uses text-only rendering; generated copy is never inserted as HTML.
export function createReleaseConveyorConsole({ root, doc = document, fetcher = fetch }) {
  const status = root.querySelector("[data-conveyor-status]");
  const stages = root.querySelector("[data-conveyor-stages]");
  const issues = root.querySelector("[data-conveyor-issues]");
  const runButton = root.querySelector("[data-conveyor-run]");
  const refreshButton = root.querySelector("[data-conveyor-refresh]");
  const packageLink = root.querySelector("[data-conveyor-package]");
  const audioLink = root.querySelector("[data-conveyor-audio]");
  const documentsLink = root.querySelector("[data-conveyor-documents]");
  const promotionLink = root.querySelector("[data-conveyor-promotion]");
  const hum = root.querySelector("[data-conveyor-hum]");
  let selectedId = "", generation = 0, busy = false, lastState = null;
  function render(state) {
    lastState = state;
    status.textContent = state?.receipt?.ready
      ? "Release package ready for creator review and publication. No external distribution has been submitted."
      : `Conveyor: ${state?.status || "not started"}. ${state?.message || "Save metadata and upload audio, then run or retry."}`;
    stages.replaceChildren();
    issues.replaceChildren();
    for (const stage of state?.receipt?.stages || state?.stages || []) {
      const item = doc.createElement("li");
      item.textContent = `${stage.name.replaceAll("_", " ")}: ${stage.status}${stage.summary ? ` — ${stage.summary}` : ""}`;
      stages.append(item);
    }
    for (const issue of state?.receipt?.blocked || []) {
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
          body: JSON.stringify({ action: "process_submission", songId: id, humHz: Number(hum.value) }) } : {}),
      });
      const state = await response.json();
      if (ticket !== generation) return;
      if (!response.ok) {
        // A failed refresh must not leave a previous ready package visible.
        render({ status: state.status || "retryable", message: state.message || "Retry shortly." });
      } else {
        render(state);
        if (state.options && !state.busy) hum.value = String(state.options.humHz || 0);
      }
    } catch {
      if (ticket === generation) render({ status: "retryable", message: "Connection interrupted. Your song is safe; retry shortly." });
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
    if (lastState) render({ ...lastState, status: "stale", receipt: { ...lastState.receipt, ready: false } });
  });
  return {
    select(songId) {
      selectedId = songId || "";
      generation++;
      render(null);
      if (selectedId) void request();
    },
  };
}
