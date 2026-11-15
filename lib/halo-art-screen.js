import { parseTimestampedLyrics, findActiveLyricIndex } from "./dreamweaver-lyrics.js";

const preferences = new WeakMap();

export function createArtScreen(frame, document, { toggle = true } = {}) {
  let preference = preferences.get(document);
  if (!preference) {
    preference = { enabled: true };
    preferences.set(document, preference);
  }
  const overlay = document.createElement("span");
  overlay.className = "halo-art-lyric";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  frame.classList.add("halo-art-screen");
  frame.append(overlay);
  let button, svg;
  if (toggle) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "halo-art-vignette");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const shade = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    shade.setAttribute("width", "100");
    shade.setAttribute("height", "100");
    svg.append(shade);
    frame.append(svg);
    button = document.createElement("button");
    button.type = "button";
    button.className = "halo-art-lyrics-toggle";
    button.hidden = true;
    frame.append(button);
  }
  const reducedMotion = document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let source = null, lines = [], untimed = [], timed = false, previous = "";
  let current = {};
  function refreshPreference() {
    if (button) {
      button.textContent = preference.enabled ? "Lyrics: ON" : "Lyrics: OFF";
      button.setAttribute("aria-pressed", String(preference.enabled));
      button.setAttribute("aria-label", "Artwork lyrics");
    }
    render(current);
  }
  if (button) {
    button.haloArtRefresh = refreshPreference;
    button.addEventListener("click", event => {
      event.stopPropagation();
      preference.enabled = !preference.enabled;
      refreshPreference();
      document.querySelectorAll(".halo-art-lyrics-toggle").forEach(other => {
        if (other !== button) other.haloArtRefresh?.();
      });
    });
  }
  function render({ lyricsText = "", time = 0, playing = false } = {}) {
    current = { lyricsText, time, playing };
    if (lyricsText !== source) {
      source = lyricsText;
      const parsed = parseTimestampedLyrics(lyricsText);
      lines = parsed.lines;
      timed = parsed.timed;
      untimed = timed ? [] : lines.filter(line => line.kind === "lyric");
    }
    if (button) button.hidden = !lines.some(line => line.kind === "lyric");
    let text = "";
    if (preference.enabled && playing && timed) {
      const index = findActiveLyricIndex(lines, time);
      text = index < 0 ? "" : lines[index].text;
    } else if (preference.enabled && playing && untimed.length) {
      const seconds = Number(time);
      const index = reducedMotion?.matches || !Number.isFinite(seconds) ? 0
        : Math.floor(Math.max(0, seconds) / 4.5) % untimed.length;
      text = `Lyrics · not synchronized\n${untimed[index].text}`;
    }
    frame.classList.toggle("halo-art-playing", playing);
    if (text !== previous) {
      overlay.textContent = text;
      if (text && previous) {
        overlay.style.animation = "none";
        void overlay.offsetWidth;
        overlay.style.animation = "";
      }
      previous = text;
    }
    overlay.hidden = !text;
    if (svg) svg.style.display = text ? "" : "none";
  }
  if (button) refreshPreference();
  return {
    update: render
  };
}
