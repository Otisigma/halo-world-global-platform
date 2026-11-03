import { constellationPreviewUrl } from "../../lib/constellation-media.js";

export function realConstellationSvg(tracks) {
  if (!Array.isArray(tracks) || tracks.length > 12) throw new Error("Choose up to 12 real-song stars");
  const escape = value => String(value).replace(/[<>&"']/g, char => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
  })[char]);
  const points = tracks.map((track, index) => {
    const angle = (index * 360 / Math.max(3, tracks.length) - 90) * Math.PI / 180;
    return { ...track, x: Math.round(320 + Math.cos(angle) * 205), y: Math.round(320 + Math.sin(angle) * 205) };
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" role="img" aria-labelledby="real-map-title">
    <title id="real-map-title">${escape(tracks.length ? `${tracks.length} selected public releases: ${tracks.map(t => `${t.title} by ${t.artist}`).join("; ")}` : "Select public releases to build your real-song constellation")}</title>
    <rect width="640" height="640" rx="20" fill="#080d19"/>
    <circle cx="320" cy="320" r="205" fill="none" stroke="#304056" stroke-dasharray="4 12"/>
    <polyline points="${points.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#b6a0ff" stroke-width="2"/>
    ${points.map((p, index) => `<g><circle cx="${p.x}" cy="${p.y}" r="22" fill="#10242d" stroke="#99f2d4"/>
      <text x="${p.x}" y="${p.y + 5}" fill="#99f2d4" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16">${index + 1}</text>
      <text x="${p.x}" y="${p.y + 43}" fill="#edf5f2" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12">${escape(p.title.slice(0, 24))}${p.title.length > 24 ? "..." : ""}</text></g>`).join("")}
    <text x="320" y="312" fill="#edf5f2" text-anchor="middle" font-family="Georgia,serif" font-size="24">YOUR HALO JOURNEY</text>
    <text x="320" y="342" fill="#99f2d4" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12">PUBLIC RELEASES / ARTIST OWNED</text>
    <text x="320" y="608" fill="#aebbd0" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12">Visual sequence only / no audio analysis / no ownership transfer</text></svg>`;
}

export function createRealSongStars(root, { document = globalThis.document, fetch = globalThis.fetch } = {}) {
  const map = root.querySelector("[data-real-map]");
  const list = root.querySelector("[data-real-stars]");
  const selectedList = root.querySelector("[data-real-selected]");
  const audio = root.querySelector("[data-real-audio]");
  const status = root.querySelector("[data-real-status]");
  if (!map || !list || !selectedList || !audio || !status) throw new Error("Real-song satellite controls are missing");
  let tracks = [], selected = [], generation = 0, pending = null;
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  function stop() {
    generation++;
    pending?.abort();
    pending = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  function reset() {
    stop();
    tracks = [];
    selected = [];
    list.replaceChildren();
    selectedList.replaceChildren();
    map.innerHTML = realConstellationSvg([]);
    status.textContent = "Connect the invited preview to see public songs. Playback never earns points.";
  }
  function redraw() {
    const chosen = selected.map(id => tracks.find(track => track.id === id)).filter(Boolean);
    map.innerHTML = realConstellationSvg(chosen);
    selectedList.replaceChildren(...chosen.map((track, index) => {
      const item = element("li", `${index + 1}. ${track.title} - ${track.artist}`);
      for (const [name, step] of [["Earlier", -1], ["Later", 1]]) {
        const button = element("button", name);
        button.type = "button";
        button.disabled = index + step < 0 || index + step >= selected.length;
        button.setAttribute("aria-label", `${name}: ${track.title}`);
        button.addEventListener("click", () => {
          const next = index + step;
          [selected[index], selected[next]] = [selected[next], selected[index]];
          redraw();
          const replacement = Array.from(selectedList.querySelectorAll("button"))
            .find(node => node.getAttribute("aria-label") === `${name}: ${track.title}` && !node.disabled);
          (replacement || list.querySelector(`[data-real-star="${track.id}"]`))?.focus();
        });
        item.append(button);
      }
      return item;
    }));
    for (const button of list.querySelectorAll("[data-real-star]")) {
      button.setAttribute("aria-pressed", String(selected.includes(button.dataset.realStar)));
      button.disabled = selected.length >= 12 && !selected.includes(button.dataset.realStar);
    }
  }
  async function play(track) {
    stop();
    const current = generation;
    pending = new AbortController();
    status.textContent = `Checking public preview for ${track.title}...`;
    try {
      const response = await fetch(`/api/fan-curations/preview?releaseId=${encodeURIComponent(track.id)}`, {
        credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.any([pending.signal, AbortSignal.timeout(12000)])
      });
      const result = await response.json();
      if (current !== generation) return;
      if (!response.ok) throw new Error(result.message || "Preview unavailable.");
      const source = constellationPreviewUrl(result.audioUrl);
      if (result.id !== track.id || !source) throw new Error("No approved public audio source was returned.");
      audio.src = source;
      await audio.play();
      if (current !== generation) return;
      status.textContent = `Playing ${result.title} - ${result.artist}. No points or verified streams are recorded.`;
    } catch (error) {
      if (current !== generation) return;
      stop();
      status.textContent = error.name === "NotAllowedError" ? "Playback was blocked. Tap Preview again to start."
        : error.message || "Preview could not be played. Visit the existing shop for listening options.";
    }
  }
  function render(releases) {
    stop();
    tracks = releases;
    selected = selected.filter(id => tracks.some(track => track.id === id));
    list.replaceChildren(...tracks.map(track => {
      const article = element("article"), button = element("button", `${track.title} - ${track.artist}`);
      button.type = "button";
      button.dataset.realStar = track.id;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        selected = selected.includes(track.id) ? selected.filter(id => id !== track.id) : [...selected, track.id];
        redraw();
      });
      article.append(button);
      const preview = element("button", track.previewAvailable ? "Preview" : "In-page preview unavailable");
      preview.type = "button";
      preview.disabled = !track.previewAvailable;
      preview.setAttribute("aria-label", `Preview: ${track.title} by ${track.artist}`);
      preview.addEventListener("click", () => play(track));
      const shop = element("a", "View song / purchase options");
      shop.href = `/music/?song=${encodeURIComponent(track.id)}`;
      article.append(preview, shop);
      return article;
    }));
    redraw();
    status.textContent = tracks.length ? "Choose stars to shape the journey. Press Preview to play; no autoplay or playback rewards."
      : "No public releases are available in this preview database.";
  }
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    stop();
    status.textContent = "Audio could not be loaded. Use the existing shop for listening options.";
  });
  audio.addEventListener("ended", () => {
    if (audio.getAttribute("src")) status.textContent = "Preview finished. No points or verified streams were recorded.";
  });
  audio.addEventListener("pause", () => {
    if (audio.getAttribute("src") && !audio.ended) status.textContent = "Preview paused. No points changed.";
  });
  audio.addEventListener("playing", () => {
    if (audio.getAttribute("src")) status.textContent = "Public preview playing. Credits are shown on its song star. No playback rewards.";
  });
  root.querySelector("[data-real-stop]").addEventListener("click", () => {
    stop();
    status.textContent = "Playback stopped. No points changed.";
  });
  reset();
  return { render, reset, stop };
}
