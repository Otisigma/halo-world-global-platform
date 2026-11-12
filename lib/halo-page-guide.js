import { pageHelp } from "./halo-guide-content.js";

const CONTROL_SELECTOR = "button, a[href], input:not([type=hidden]), select, textarea, summary, audio[controls], video[controls], [role=button], [data-halo-guide]";
const EXCLUDED = "#haloCompanion, #haloHud, .halo-access-panel, .halo-access-launcher, .halo-access-dock, .halo-qa-panel, .halo-qa-launcher";

export function controlLabel(node, document) {
  const text = value => String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
  const referenced = (node.getAttribute("aria-labelledby") || "").split(/\s+/)
    .map(id => document.getElementById(id)?.textContent || "").join(" ").trim();
  return text(node.getAttribute("aria-label") || referenced
    || [...(node.labels || [])].map(label => label.textContent).join(" ")
    || node.getAttribute("data-halo-guide-title") || node.getAttribute("title")
    || (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) ? "" : node.textContent)
    || node.getAttribute("placeholder") || node.tagName.toLowerCase());
}

export function visibleControl(node, window) {
  if (!node.isConnected || node.closest(EXCLUDED) || node.closest("[hidden], [inert], [aria-hidden=true]")) return false;
  const closedDetails = node.closest("details:not([open])");
  if (closedDetails && node !== closedDetails.querySelector("summary")) return false;
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
}

export function controlHelp(node, help) {
  const authored = node.closest("[data-halo-guide]");
  let explanation = authored?.getAttribute("data-halo-guide") || "";
  if (!explanation) {
    for (const [selector, [, copy]] of Object.entries(help.controls)) {
      if (node.closest(selector)) { explanation = copy; break; }
    }
  }
  if (!explanation) {
    if (node.tagName === "A") explanation = "This is a navigation link. Follow it only when you choose to leave or open a destination.";
    else if (node.tagName === "SUMMARY") explanation = "Opens or closes the details in this section.";
    else if (node.tagName === "SELECT") explanation = "Choose from the options supplied by this page. Read the nearby instructions before changing it.";
    else if (node.tagName === "INPUT" && node.type === "file") explanation = "Choose a file from your device. Selecting a file is not proof that it has been uploaded or saved.";
    else if (node.tagName === "INPUT" && ["checkbox", "radio"].includes(node.type)) explanation = "Changes this option. Read the adjacent instructions and confirmation to understand its effect.";
    else if (["INPUT", "TEXTAREA"].includes(node.tagName)) explanation = "Enter the information requested by this field. The guide does not read or send its value.";
    else if (["AUDIO", "VIDEO"].includes(node.tagName)) explanation = "Use the browser's media controls to play, pause, seek, or adjust volume yourself.";
    else explanation = "Detailed guidance has not been authored for this control yet. Read its label and surrounding instructions before using it; the guide cannot confirm its outcome.";
  }
  return `${explanation.slice(0, 1200)}${node.disabled || node.getAttribute("aria-disabled") === "true" ? " This control is currently unavailable; check the page's requirements." : ""}`;
}

export function mountPageGuide({ root, document, window, onHighlight = () => {} }) {
  const container = root.querySelector(".halo-companion-page-guide");
  const create = (tag, text = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const button = (text, run) => {
    const node = create("button", text);
    node.type = "button";
    node.addEventListener("click", run);
    return node;
  };
  const helpTitle = create("h3");
  const overview = create("p");
  overview.className = "halo-page-guide-overview";
  const searchLabel = create("label", "Find a button or field");
  searchLabel.className = "halo-page-guide-search-label";
  const search = create("input");
  search.type = "search";
  search.id = "haloPageGuideSearch";
  searchLabel.htmlFor = search.id;
  search.placeholder = "Search controls on this page";
  const status = create("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const explanation = create("p");
  explanation.id = "haloPageGuideExplanation";
  explanation.setAttribute("role", "status");
  const results = create("div");
  results.className = "halo-page-guide-results";
  let active = null, oldDescription = null, steps = [], step = -1;
  const clearHighlight = () => {
    if (active) {
      active.classList.remove("halo-guide-highlight");
      if (oldDescription === null) active.removeAttribute("aria-describedby");
      else active.setAttribute("aria-describedby", oldDescription);
    }
    active = null;
    root.haloGuideTarget = null;
    root.classList.remove("halo-companion-walking");
    onHighlight();
  };
  const stop = () => {
    clearHighlight();
    steps = [];
    step = -1;
    explanation.textContent = "";
    back.disabled = forward.disabled = end.disabled = true;
  };
  const show = node => {
    clearHighlight();
    if (!visibleControl(node, window)) {
      explanation.textContent = "That control is no longer visible. Refresh controls to inspect the current page.";
      return;
    }
    active = node;
    root.haloGuideTarget = node;
    oldDescription = node.getAttribute("aria-describedby");
    node.setAttribute("aria-describedby", `${oldDescription || ""} ${explanation.id}`.trim());
    node.classList.add("halo-guide-highlight");
    root.classList.add("halo-companion-walking");
    end.disabled = false;
    node.scrollIntoView({ block: "center", behavior: "instant" });
    explanation.textContent = `${controlLabel(node, document)}: ${controlHelp(node, pageHelp(window.location.pathname))}`;
    onHighlight();
  };
  const controls = () => [...document.querySelectorAll(CONTROL_SELECTOR)].filter(node => visibleControl(node, window));
  const updateStep = () => {
    if (!steps[step]) return stop();
    show(steps[step]);
    status.textContent = `Walkthrough ${step + 1} of ${steps.length}. The guide explains only; use the page control yourself.`;
    back.disabled = step === 0;
    forward.disabled = step === steps.length - 1;
    end.disabled = false;
  };
  const back = button("Previous step", () => { step--; updateStep(); });
  const forward = button("Next step", () => { step++; updateStep(); });
  const end = button("End walkthrough", stop);
  back.disabled = forward.disabled = end.disabled = true;
  const tour = button("Walk me through this page", () => {
    stop();
    steps = controls();
    step = 0;
    if (!steps.length) {
      status.textContent = "No visible controls to walk through yet. Try Refresh controls after the page loads.";
      return;
    }
    updateStep();
    explanation.tabIndex = -1;
    explanation.focus({ preventScroll: true });
  });
  tour.className = "halo-page-guide-tour";
  function refresh() {
    const help = pageHelp(window.location.pathname);
    helpTitle.textContent = help.title;
    overview.textContent = help.overview;
    const query = search.value.trim().toLowerCase();
    const found = controls().filter(node => controlLabel(node, document).toLowerCase().includes(query));
    results.replaceChildren(...found.map(node => button(controlLabel(node, document), () => { stop(); show(node); })));
    status.textContent = found.length ? `${found.length} visible controls. Choose one for help.` : "No matching visible controls. Open the relevant section, then refresh.";
    if (active && !visibleControl(active, window)) stop();
  }
  container.append(helpTitle, overview, tour, searchLabel, search, button("Refresh controls", refresh), status,
    results, explanation, back, forward, end);
  search.addEventListener("input", refresh);
  container.closest("details").addEventListener("toggle", () => {
    if (container.closest("details").open) refresh();
    else stop();
  });
  const onEscape = event => {
    if (event.key === "Escape" && active) { stop(); event.preventDefault(); }
  };
  document.addEventListener("keydown", onEscape);
  window.addEventListener("popstate", () => { stop(); refresh(); });
  window.addEventListener("scroll", () => { if (active) onHighlight(); }, true);
  const observer = new window.MutationObserver(() => {
    if (active && !visibleControl(active, window)) {
      stop();
      status.textContent = "The highlighted control changed. Refresh controls to continue.";
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open", "aria-hidden"] });
  refresh();
  return { refresh, stop };
}
