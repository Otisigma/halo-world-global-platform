import { CURATED_LOOPS } from "./music-home.js";

export const DEFAULT_CINEMA_LOOP = CURATED_LOOPS.find(loop => loop.requiredStems === 0 && loop.requiredSplits === 0);

export function createDreamweaverCinema({ audio, video, container, toggle, status, document, window }) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let enabled = true, failed = false, pending = false, epoch = 0;
  const allowed = () => enabled && !failed && !motion.matches && !document.hidden
    && !document.documentElement.classList.contains("halo-safe-space-mode")
    && !audio.paused && !audio.ended && Boolean(video.getAttribute("src")) && !video.hidden;
  function stop() {
    epoch++;
    pending = false;
    video.pause();
    container.classList.remove("is-cinema-playing");
  }
  function sync() {
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.textContent = enabled ? "Turn video backdrop off" : "Turn video backdrop on";
    if (!allowed()) { stop(); return; }
    if (pending || !video.paused) return;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    pending = true;
    const request = ++epoch;
    Promise.resolve(video.play()).then(() => {
      if (request !== epoch) {
        if (!allowed()) video.pause();
        return;
      }
      pending = false;
      if (!allowed()) { stop(); return; }
      container.classList.add("is-cinema-playing");
      status.textContent = "Video backdrop playing silently with the song.";
    }).catch(error => {
      if (request !== epoch) return;
      failed = true;
      stop();
      status.textContent = "Video backdrop unavailable. The song and artwork remain available.";
      console.warn("Dreamweaver video backdrop could not play:", error?.name || "media error");
    });
  }
  const reset = () => { failed = false; stop(); };
  const fault = () => {
    failed = true; stop();
    status.textContent = "Video backdrop unavailable. The song and artwork remain available.";
  };
  const change = () => {
    enabled = !enabled;
    failed = false;
    sync();
    if (!enabled) status.textContent = "Video backdrop off. Artwork stays in focus.";
  };
  const listeners = [
    [audio, "playing", sync], [audio, "pause", stop], [audio, "ended", stop],
    [audio, "waiting", stop], [audio, "error", stop],
    [video, "loadeddata", sync], [video, "emptied", reset], [video, "error", fault],
    [toggle, "click", change], [document, "visibilitychange", sync], [motion, "change", sync]
  ];
  listeners.forEach(([target, event, handler]) => target.addEventListener(event, handler));
  const observer = new window.MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  sync();
  return {
    sync,
    destroy() {
      stop(); observer.disconnect();
      listeners.forEach(([target, event, handler]) => target.removeEventListener(event, handler));
    }
  };
}
