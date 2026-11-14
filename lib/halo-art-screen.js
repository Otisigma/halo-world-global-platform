import { parseTimestampedLyrics, findActiveLyricIndex } from "./dreamweaver-lyrics.js";

export function createArtScreen(frame, document) {
  const overlay = document.createElement("span");
  overlay.className = "halo-art-lyric";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  frame.classList.add("halo-art-screen");
  frame.append(overlay);
  let source = null, lines = [], previous = "";
  return {
    update({ lyricsText = "", time = 0, playing = false } = {}) {
      if (lyricsText !== source) {
        source = lyricsText;
        lines = parseTimestampedLyrics(lyricsText).lines;
      }
      const index = playing ? findActiveLyricIndex(lines, time) : -1;
      const text = index < 0 ? "" : lines[index].text;
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
