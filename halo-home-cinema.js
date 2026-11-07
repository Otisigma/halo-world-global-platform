import { createDreamweaverCinema, DEFAULT_CINEMA_LOOP } from "./lib/dreamweaver-cinema.js";

function mountHomepageCinema() {
  const audio = document.getElementById("dreamweaver-homepage-preview");
  const video = document.getElementById("haloHomepageVideoBackdrop");
  const toggle = document.getElementById("haloHomepageCinemaToggle");
  const container = video?.parentElement;
  const status = document.getElementById("haloHomepageCinemaStatus");
  if (!audio || !video || !toggle || !container || !status) return;

  video.src = DEFAULT_CINEMA_LOOP.url;
  createDreamweaverCinema({ audio, video, container, toggle, status, document, window });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountHomepageCinema, { once: true });
} else {
  mountHomepageCinema();
}
