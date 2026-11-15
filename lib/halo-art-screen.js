import { parseTimestampedLyrics, findActiveLyricIndex } from "./dreamweaver-lyrics.js";

export function createArtScreen(frame, document) {
  const overlay = document.createElement("span");
  overlay.className = "halo-art-lyric";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  frame.classList.add("halo-art-screen");
  frame.append(overlay);
  const reducedMotion = document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let source = null, lines = [], untimed = [], timed = false, previous = "";
  return {
    update({ lyricsText = "", time = 0, playing = false } = {}) {
      if (lyricsText !== source) {
        source = lyricsText;
        const parsed = parseTimestampedLyrics(lyricsText);
        lines = parsed.lines;
        timed = parsed.timed;
        untimed = timed ? [] : lines.filter(line => line.kind === "lyric");
      }
      let text = "";
      if (playing && timed) {
        const index = findActiveLyricIndex(lines, time);
        text = index < 0 ? "" : lines[index].text;
      } else if (playing && untimed.length) {
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
    }
  };
}
