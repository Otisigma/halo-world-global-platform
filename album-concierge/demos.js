export const conceptTemplates = [
  {
    id: "midnight", title: "Midnight Resonance LP", category: "Club concept", palette: "club",
    theme: "A city after dark: tension gives way to connection, then a quiet journey home.",
    artwork: "Obsidian and brushed gold, concentric grooves, and a distant skyline. The geometric cover shown here is a local design sketch, not commissioned artwork.",
    dedication: "For the people who find a little light on the late-night dance floor.",
    tracks: [
      ["City Wakes", 300, "Atmospheric opening with a slow-building pulse"],
      ["Gold in the Static", 330, "Warm bass and bright, restrained percussion"],
      ["Afterimage", 285, "A reflective vocal-led pause"],
      ["Under the Surface", 315, "Deep groove with an expanding texture"],
      ["Midnight Resonance", 360, "The imagined peak-time centerpiece"],
      ["No Scorekeeping", 270, "Space for a softer emotional turn"],
      ["Last Light Underground", 345, "A final rush of movement"],
      ["First Train Home", 315, "Gentle closing textures"]
    ]
  },
  {
    id: "quiet", title: "Quiet Heart Sessions", category: "Acoustic session", palette: "acoustic",
    theme: "Small rooms, honest conversations, and the courage to begin again.",
    artwork: "Muted ink blue, soft window light, and fine concentric lines like ripples on water. This local geometric sketch suggests a mood rather than a finished photography commission.",
    dedication: "For anyone learning to hear their own voice again.",
    tracks: [
      ["Window Light", 240, "A delicate guitar-led invitation"],
      ["Words Left Unsaid", 270, "An intimate imagined vocal arrangement"],
      ["Room for Two", 300, "Warm harmonies and unhurried storytelling"],
      ["Soft Edges", 285, "A stripped-back moment of acceptance"],
      ["Quiet Heart", 330, "The emotional centerpiece"],
      ["Begin Again", 255, "A hopeful, open-ended close"]
    ]
  }
];

export function plannedDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function createConceptDemos(root, { document = globalThis.document } = {}) {
  const layout = root.querySelector("[data-demo-layout]");
  const status = root.querySelector("[data-demo-status]");
  const buttons = [...root.querySelectorAll("[data-demo-template]")];
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function load(id, moveFocus = false) {
    const template = conceptTemplates.find(item => item.id === id);
    if (!template) throw new Error("Unknown album concept template");
    const cover = element("div", undefined, `ac-demo-cover ac-demo-cover-${template.palette}`);
    cover.setAttribute("aria-hidden", "true");
    cover.append(element("span", "Fictional concept"), element("strong", template.title));
    const details = element("div");
    const heading = element("h4", template.title);
    heading.tabIndex = -1;
    const total = template.tracks.reduce((sum, [, seconds]) => sum + seconds, 0);
    details.append(heading, element("p", template.theme),
      element("small", `${template.tracks.length} track ideas / ${plannedDuration(total)} planned runtime - no recordings`));
    const tracks = element("ol", undefined, "ac-demo-tracklist");
    tracks.append(...template.tracks.map(([title, seconds, mood]) => {
      const row = element("li");
      row.append(element("strong", title), element("span", `${plannedDuration(seconds)} planned`), element("p", mood));
      return row;
    }));
    details.append(element("h5", "Illustrative tracklist"), tracks,
      element("h5", "Artwork direction"), element("p", template.artwork),
      element("h5", "Liner note"), element("blockquote", template.dedication));
    layout.replaceChildren(cover, details);
    layout.hidden = false;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.demoTemplate === id));
    status.textContent = `${template.title} example loaded. Fictional layout only; nothing saved, purchased, or played.`;
    if (moveFocus) {
      heading.focus({ preventScroll: true });
      layout.scrollIntoView({ block: "nearest", behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }
  for (const button of buttons) button.addEventListener("click", () => load(button.dataset.demoTemplate, true));
  load("midnight");
  return { load };
}

if (typeof document !== "undefined") {
  const root = document.querySelector("[data-concierge-demos]");
  if (root) createConceptDemos(root);
}
