(() => {
  if (window.HaloUploadIndicator) return;

  const indicator = document.createElement("aside");
  indicator.className = "halo-upload-indicator";
  indicator.hidden = true;
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  indicator.innerHTML = `
    <span class="halo-upload-indicator__mark" aria-hidden="true">↑</span>
    <span class="halo-upload-indicator__copy">
      <strong data-upload-title>Song upload</strong>
      <span data-upload-message>Uploading</span>
      <progress data-upload-progress max="100" value="0"></progress>
    </span>`;
  document.body.append(indicator);

  const title = indicator.querySelector("[data-upload-title]");
  const message = indicator.querySelector("[data-upload-message]");
  const progress = indicator.querySelector("[data-upload-progress]");
  const seenEvents = new Map();
  let hideTimer = 0;

  function cleanText(value, limit = 120) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
  }

  function render(detail) {
    if (!detail || !["uploading", "finalizing", "completed", "failed"].includes(detail.state)) return;
    const eventId = cleanText(detail.eventId, 80);
    const sequence = Number(detail.sequence) || 0;
    if (eventId && sequence <= (seenEvents.get(eventId) || 0)) return;
    if (eventId) {
      seenEvents.set(eventId, sequence);
      if (seenEvents.size > 16) seenEvents.delete(seenEvents.keys().next().value);
    }

    clearTimeout(hideTimer);
    const titleText = cleanText(detail.title);
    if (!titleText) return;
    indicator.hidden = false;
    indicator.dataset.state = detail.state;
    title.textContent = titleText;
    if (detail.state === "uploading") {
      const percent = Math.max(0, Math.min(100, Number(detail.percent) || 0));
      progress.hidden = false;
      progress.value = percent;
      message.textContent = `Uploading · ${Math.round(percent)}%`;
      return;
    }
    if (detail.state === "finalizing") {
      progress.hidden = false;
      progress.removeAttribute("value");
      message.textContent = "Upload complete · saving and checking readiness";
      return;
    }

    progress.hidden = true;
    message.textContent = detail.state === "completed" ? "Upload complete" : "Upload paused · check Song Catalog to resume";
    if (detail.state === "completed") {
      hideTimer = setTimeout(() => { indicator.hidden = true; }, 5000);
    }
  }

  window.addEventListener("halo:upload-progress", event => render(event.detail));
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("halo-catalog-upload-v1");
    channel.addEventListener("message", event => render(event.data));
  }
  window.HaloUploadIndicator = Object.freeze({ render });
})();
