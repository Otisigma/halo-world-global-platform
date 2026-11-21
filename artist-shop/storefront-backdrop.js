// HALO Artist Shop — looping video backdrop controller.
// Starts the muted loop only when motion is welcome, and pauses it while the tab is hidden or the
// visitor turns on reduced motion, so it never costs battery or data in the background.
(() => {
  const layer = document.querySelector("[data-storefront-backdrop]");
  const video = layer?.querySelector("video");
  if (!layer || !video) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const source = video.dataset.src;

  const pause = () => { video.pause(); layer.dataset.state = "paused"; };
  const play = () => {
    if (motion.matches || document.hidden) return pause();
    if (!video.src && source) { video.src = source; }
    video.muted = true;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(pause);
    layer.dataset.state = "playing";
  };

  document.addEventListener("visibilitychange", play);
  motion.addEventListener?.("change", play);
  play();
})();
