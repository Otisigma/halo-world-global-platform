export function initializeDreamweaverUploadPanel({ disclosure, frame, status }) {
  if (!disclosure || !frame || !status) return;
  let loaded = false;
  const host = frame.ownerDocument?.defaultView;
  const stages = new Set(["standby", "checking", "uploading", "finalizing", "building", "ready", "paused", "waiting", "pausing"]);
  const onProgress = event => {
    if (!loaded || event.origin !== host.location.origin || event.source !== frame.contentWindow
      || event.data?.type !== "halo:song-lab-progress" || !stages.has(event.data.stage)
      || !Number.isFinite(event.data.percent) || event.data.percent < 0 || event.data.percent > 100) return;
    const { stage, percent } = event.data;
    status.textContent = stage === "uploading" ? `Song Lab private upload: ${Math.floor(percent)}%.`
      : stage === "ready" ? "Song Lab private package ready. This does not approve a catalog master or publication."
      : `Song Lab private workflow: ${stage}. Catalog playback readiness is separate.`;
  };
  host?.addEventListener("message", onProgress);
  frame.addEventListener("load", () => {
    if (!loaded) return;
    status.textContent = "Song Lab opened. Complete sign-in or verification if prompted; uploads remain private until you explicitly start analysis.";
  });
  function load() {
    if (!disclosure.open || loaded) return;
    loaded = true;
    status.textContent = "Loading Dreamweaver Song Lab. If it does not appear, use Open full Dreamweaver Song Lab.";
    frame.hidden = false;
    frame.src = "/dreamweaver-lab/";
  }
  disclosure.addEventListener("toggle", load);
  return {
    dispose() { host?.removeEventListener("message", onProgress); },
    show() {
      if (loaded) return;
      disclosure.open = true;
      load();
    },
    reset() {
      if (!loaded) return;
      loaded = false;
      disclosure.open = false;
      frame.removeAttribute("src");
      frame.hidden = true;
      status.textContent = "Sign in and expand to load Dreamweaver Song Lab.";
    },
  };
}
