import { createFanCurationDesk } from "./fan-curations.js";

export const IMAGINED_TRACKS = Object.freeze([
  { id: "amber-horizon", title: "Amber Horizon", note: "Imagined opening / warm light" },
  { id: "glass-current", title: "Glass Current", note: "Imagined movement / silver water" },
  { id: "velvet-orbit", title: "Velvet Orbit", note: "Imagined turn / violet night" },
  { id: "paper-moon", title: "Paper Moon", note: "Imagined pause / quiet glow" },
  { id: "neon-garden", title: "Neon Garden", note: "Imagined lift / electric green" },
  { id: "afterglow-tide", title: "Afterglow Tide", note: "Imagined close / blue dawn" }
].map(Object.freeze));
const PALETTES = Object.freeze({
  aurora: { star: "#99f2d4", route: "#b6a0ff", background: "#080d19" },
  ember: { star: "#ffd18b", route: "#ff9caf", background: "#160c19" },
  ocean: { star: "#b0e4ff", route: "#cdd4ff", background: "#070f20" }
});
const escapeXml = value => String(value).replace(/[<>&"']/g, char => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
})[char]);
const position = index => {
  const angle = (index * 60 - 90) * Math.PI / 180;
  return { x: Math.round(320 + Math.cos(angle) * 205), y: Math.round(320 + Math.sin(angle) * 205) };
};

export function constellationSvg(ids, title, palette = "aurora") {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length
    || ids.some(id => !IMAGINED_TRACKS.some(track => track.id === id))) throw new Error("Choose different imagined stars");
  if (typeof title !== "string" || title.length > 80 || !Object.hasOwn(PALETTES, palette)) throw new Error("Choose a valid map title and palette");
  const colors = PALETTES[palette];
  const stars = ids.map(id => {
    const index = IMAGINED_TRACKS.findIndex(track => track.id === id);
    return { ...IMAGINED_TRACKS[index], ...position(index) };
  });
  const route = stars.map(star => `${star.x},${star.y}`).join(" ");
  const dots = Array.from({ length: 40 }, (_, index) => `<circle cx="${20 + (index * 97) % 600}" cy="${25 + (index * 131) % 580}" r="1" fill="#7d91aa" opacity=".45"/>`).join("");
  const nodes = stars.map((star, index) => `<g><circle cx="${star.x}" cy="${star.y}" r="23" fill="${colors.background}" stroke="${colors.star}" stroke-width="2"/>
    <text x="${star.x}" y="${star.y + 5}" text-anchor="middle" fill="${colors.star}" font-family="system-ui,sans-serif" font-size="16">${index + 1}</text>
    <text x="${star.x}" y="${star.y + 44}" text-anchor="middle" fill="#edf5f2" font-family="system-ui,sans-serif" font-size="14">${escapeXml(star.title)}</text></g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" role="img" aria-labelledby="map-svg-title">
    <title id="map-svg-title">${escapeXml(title || "Untitled constellation")} - ${stars.length} fictional track concepts in chosen order</title>
    <rect width="640" height="640" rx="20" fill="${colors.background}"/>${dots}
    <circle cx="320" cy="320" r="205" fill="none" stroke="#304056" stroke-dasharray="4 12"/>
    <circle cx="320" cy="320" r="140" fill="none" stroke="#304056"/>
    <polyline points="${route}" fill="none" stroke="${colors.route}" stroke-width="2.5" stroke-linejoin="round"/>
    ${nodes}<text x="320" y="307" fill="#edf5f2" text-anchor="middle" font-family="Georgia,serif" font-size="22">HALO</text>
    <text x="320" y="334" fill="${colors.star}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12">CONSTELLATION / LOCAL SKETCH</text>
    <text x="320" y="590" fill="#edf5f2" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" textLength="${Math.max(1, Math.min(540, (title || "Untitled constellation").length * 8))}" lengthAdjust="spacingAndGlyphs">${escapeXml(title || "Untitled constellation")}</text>
    <text x="320" y="615" fill="#aebbd0" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10">Fictional track concepts / no audio / no real points / no ownership grant</text></svg>`;
}

export function createConstellationDemo(document) {
  const choices = document.querySelector("[data-demo-tracks]");
  const journey = document.querySelector("[data-journey]");
  const sky = document.querySelector("[data-sky]");
  const title = document.querySelector("[data-map-title]");
  const palette = document.querySelector("[data-palette]");
  const count = document.querySelector("[data-map-count]");
  const status = document.querySelector("[data-demo-status]");
  const exportButton = document.querySelector("[data-export]");
  let selected = [];
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    return element;
  };
  function render() {
    const svg = sky.querySelector("svg");
    // The SVG is generated only from allowlisted IDs, fixed colors and escaped text.
    svg.outerHTML = constellationSvg(selected, title.value.slice(0, 80), palette.value);
    sky.dataset.palette = palette.value;
    count.textContent = `${selected.length} stars / local sketch`;
    exportButton.disabled = selected.length < 3;
    for (const button of choices.querySelectorAll("button")) button.setAttribute("aria-pressed", String(selected.includes(button.dataset.star)));
    journey.replaceChildren(...selected.map((id, index) => {
      const track = IMAGINED_TRACKS.find(track => track.id === id);
      const item = node("li", track.title), controls = node("div");
      for (const [label, action, disabled] of [["Earlier", "earlier", index === 0], ["Later", "later", index === selected.length - 1], ["Remove", "remove", false]]) {
        const button = node("button", label);
        button.type = "button";
        button.dataset.action = action;
        button.dataset.star = id;
        button.disabled = disabled;
        button.setAttribute("aria-label", `${label}: ${track.title}`);
        controls.append(button);
      }
      item.append(controls);
      return item;
    }));
    status.textContent = selected.length >= 3 ? "Your local star map is ready to export. No account rewards are earned or spent."
      : `${3 - selected.length} more imagined ${selected.length === 2 ? "track" : "tracks"} needed to export. No real points involved.`;
  }
  choices.replaceChildren(...IMAGINED_TRACKS.map(track => {
    const button = node("button", track.title);
    button.type = "button";
    button.dataset.star = track.id;
    button.setAttribute("aria-pressed", "false");
    button.append(node("small", track.note));
    return button;
  }));
  choices.addEventListener("click", event => {
    const button = event.target.closest("[data-star]");
    if (!button || !choices.contains(button)) return;
    const id = button.dataset.star;
    selected = selected.includes(id) ? selected.filter(star => star !== id) : [...selected, id];
    render();
  });
  journey.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled || !journey.contains(button)) return;
    const index = selected.indexOf(button.dataset.star), action = button.dataset.action;
    if (index < 0) return;
    if (action === "remove") selected.splice(index, 1);
    else {
      const next = index + (action === "earlier" ? -1 : 1);
      if (next < 0 || next >= selected.length) return;
      [selected[index], selected[next]] = [selected[next], selected[index]];
    }
    render();
    const replacement = Array.from(journey.querySelectorAll("button")).find(node => node.dataset.star === button.dataset.star && node.dataset.action === action);
    (replacement && !replacement.disabled ? replacement : choices.querySelector(`[data-star="${button.dataset.star}"]`))?.focus();
  });
  title.addEventListener("input", render);
  palette.addEventListener("change", render);
  document.querySelector("[data-clear]").addEventListener("click", () => {
    selected = [];
    title.value = "My midnight constellation";
    palette.value = "aurora";
    render();
    status.textContent = "Sketch cleared. Nothing was saved to an account or server.";
  });
  exportButton.addEventListener("click", () => {
    if (selected.length < 3) return;
    const url = URL.createObjectURL(new Blob([constellationSvg(selected, title.value.slice(0, 80), palette.value)], { type: "image/svg+xml" }));
    const anchor = node("a");
    anchor.href = url;
    anchor.download = "halo-constellation-local-sketch.svg";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Local star map exported. No data uploaded and no real points changed.";
  });
  render();
  return { selection: () => [...selected] };
}

if (typeof document !== "undefined" && document.querySelector("[data-demo-tracks]")) {
  createConstellationDemo(document);
  const button = document.querySelector("[data-open-pilot]");
  const status = document.querySelector("[data-pilot-status]");
  const root = document.querySelector("[data-fan-curation-desk]");
  const desk = createFanCurationDesk(root);
  let identity, unsubscribe, revision = 0;
  document.querySelector("[data-close-pilot]").addEventListener("click", () => {
    revision++;
    unsubscribe?.();
    desk.reset();
    root.hidden = true;
    button.disabled = false;
    status.textContent = "Pilot view disconnected. Server records are not deleted; the local sketch is separate.";
    button.focus();
  });
  button.addEventListener("click", async () => {
    const current = ++revision;
    button.disabled = true;
    status.textContent = "Checking preview availability...";
    try {
      // Check the disabled gate before importing Identity or opening account-linked UI.
      const response = await fetch("/api/fan-curations", {
        credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000)
      });
      if (current !== revision) return;
      if (![200, 401].includes(response.status)) {
        const result = await response.json();
        throw new Error(result.message || "Preview unavailable; no access assumed.");
      }
      identity ??= await import("https://esm.sh/@netlify/identity@1.2.0");
      if (current !== revision) return;
      const user = await identity.getUser();
      if (current !== revision) return;
      if (!user?.id) throw new Error("Sign in with your invited HALO account on the existing account screen, then return here.");
      unsubscribe?.();
      unsubscribe = identity.onAuthChange(() => {
        revision++;
        desk.reset();
        root.hidden = true;
        button.disabled = false;
        status.textContent = "Account changed. Check invited access again.";
      });
      root.hidden = false;
      if (!await desk.refresh()) { root.hidden = true; throw new Error("Could not verify pilot access. The local demo remains separate."); }
      status.textContent = "Invited preview connected. Changes below use the preview database, never demo stars.";
      root.scrollIntoView({ block: "start" });
    } catch (error) {
      if (current !== revision) return;
      desk.reset();
      root.hidden = true;
      status.textContent = error.message || "Preview access could not be verified.";
    } finally {
      if (current === revision) button.disabled = false;
    }
  });
}
