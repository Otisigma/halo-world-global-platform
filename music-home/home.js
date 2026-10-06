import { CURATED_LOOPS, THEMES } from "../lib/music-home.js";
import { MODULE_LABELS } from "./customizer.js";
import { renderCreativeDNA } from "../lib/creative-dna-ui.js";

export function applySovereignMode(doc, active) {
  const sovereign = active === true;
  doc.querySelectorAll("[data-platform-chrome]").forEach(element => { element.hidden = sovereign; });
  doc.getElementById("restoreChrome").hidden = !sovereign;
}

export function shouldAutoplayBackground({ reducedMotion = false, saveData = false, hidden = false } = {}) {
  return !reducedMotion && !saveData && !hidden;
}

export function createBackgroundController(video, toggle, doc, win) {
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
  let source = "", wantsPlayback = true, generation = 0;
  const automatic = () => shouldAutoplayBackground({
    reducedMotion: motion.matches, saveData: win.navigator.connection?.saveData === true, hidden: doc.hidden
  });
  function stop() {
    generation++;
    video.pause();
    toggle.textContent = "Play background";
  }
  async function play() {
    if (!source || doc.hidden) return;
    const current = ++generation;
    if (video.getAttribute("src") !== source) video.src = source;
    try {
      await video.play();
      if (current === generation) toggle.textContent = "Pause background";
    } catch { if (current === generation) toggle.textContent = "Play background"; }
  }
  const onToggle = () => {
    if (!video.paused) { wantsPlayback = false; stop(); }
    else { wantsPlayback = true; play(); }
  };
  const onVisibility = () => {
    if (!automatic()) stop();
    else if (wantsPlayback) play();
  };
  const onError = () => {
    wantsPlayback = false;
    stop();
    toggle.textContent = "Background unavailable — retry";
    video.removeAttribute("src");
    video.load();
  };
  toggle.addEventListener("click", onToggle);
  video.addEventListener("error", onError);
  doc.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", onVisibility);
  win.navigator.connection?.addEventListener?.("change", onVisibility);
  return {
    setSource(value) {
      if (source === value) return;
      stop();
      video.removeAttribute("src");
      video.load();
      source = value;
      toggle.hidden = !source;
      wantsPlayback = true;
      if (source && automatic()) play();
    },
    destroy() {
      this.setSource("");
      toggle.removeEventListener("click", onToggle);
      video.removeEventListener("error", onError);
      doc.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onVisibility);
      win.navigator.connection?.removeEventListener?.("change", onVisibility);
    }
  };
}

function node(tag, text) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  return element;
}

function safeLink(text, href) {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || /[\\\s]/.test(href)) return node("span", text);
  const link = node("a", text);
  link.href = href;
  return link;
}

export function mountMusicHome(doc, win) {
  const creator = new URLSearchParams(win.location.search).get("creator") || "";
  const status = doc.getElementById("homeStatus");
  const restore = doc.getElementById("restoreChrome");
  const background = createBackgroundController(doc.getElementById("homeBackground"), doc.getElementById("backgroundToggle"), doc, win);
  let restored = false, inFlight = false;
  function showChrome() {
    restored = true;
    applySovereignMode(doc, false);
  }
  restore.addEventListener("click", showChrome);
  const onKey = event => { if (event.key === "Escape") showChrome(); };
  doc.addEventListener("keydown", onKey);

  function render(result) {
    const { config, profile, milestones, modules = {} } = result;
    doc.documentElement.style.setProperty("--creator-gold", THEMES[config.theme]?.accent || THEMES.GOLD.accent);
    applySovereignMode(doc, config.isSovereignModeActive && !restored);
    const ownedUrl = `/api/music-home?creator=${encodeURIComponent(config.creatorId)}&asset=background`;
    const allowedBackground = config.backgroundMode === "CURATED_LOOP"
      ? CURATED_LOOPS.some(loop => loop.url === config.selectedBackgroundUrl)
      : config.backgroundMode === "CUSTOM_UPLOAD" && config.selectedBackgroundUrl === ownedUrl;
    background.setSource(allowedBackground ? config.selectedBackgroundUrl : "");
    doc.getElementById("homeName").textContent = profile.displayName;
    doc.getElementById("homeBio").textContent = profile.bio || "";
    doc.title = `${profile.displayName} — Music Home`;
    const sections = config.layoutModules.filter(module => module.isVisible).sort((a, b) => a.order - b.order).map(module => {
      const section = node("section");
      const heading = node("h2", MODULE_LABELS[module.type]);
      heading.id = `module-${module.type}`;
      section.setAttribute("aria-labelledby", heading.id);
      section.append(heading);
      if (module.type === "PEARL_HALL") {
        section.append(node("p", `${milestones.stemUploads} verified stem uploads · ${milestones.completedSplits} completed splits`));
        section.append(node("p", config.unlockedBadges.length ? config.unlockedBadges.map(badge => badge.replaceAll("_", " ")).join(" · ") : "The next milestone starts with your first stem."));
      } else if (module.type === "CREATIVE_DNA") {
        renderCreativeDNA(section, modules.CREATIVE_DNA || []);
      } else {
        const entries = Array.isArray(modules[module.type]) ? modules[module.type] : [];
        entries.forEach(entry => {
          const article = node("article");
          article.append(node("h3", entry.title || "Creator update"));
          if (entry.description || entry.brief || entry.body) article.append(node("p", entry.description || entry.brief || entry.body));
          if (entry.url) article.append(safeLink("Explore", entry.url));
          section.append(article);
        });
        if (!entries.length) {
          section.append(node("p", module.type === "SOVEREIGN_VAULT"
            ? "No published track drops yet. Private vault assets stay private."
            : module.type === "COLLAB_BRIEFS" ? "Collaboration briefs stay in the member workspace." : "No public Signal updates yet."));
          if (module.type === "COLLAB_BRIEFS") section.append(safeLink("Sign in to explore collaboration briefs", "/creator-network/#finderTitle"));
          if (module.type === "SIGNAL_FEED") section.append(safeLink("Explore HALO Signal", "/signal-network/"));
        }
      }
      return section;
    });
    doc.getElementById("homeModules").replaceChildren(...sections);
    status.textContent = "";
  }

  async function refresh() {
    if (inFlight || doc.hidden) return;
    if (!creator || creator.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(creator)) {
      status.textContent = "Choose a creator’s Music Home from Creator Network.";
      return;
    }
    inFlight = true;
    try {
      const response = await win.fetch(`/api/music-home?creator=${encodeURIComponent(creator)}`, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "This Music Home is private or unavailable.");
      render(result);
    } catch (error) {
      applySovereignMode(doc, false);
      background.setSource("");
      doc.getElementById("homeModules").replaceChildren();
      doc.getElementById("homeName").textContent = "Music Home";
      doc.getElementById("homeBio").textContent = "";
      status.textContent = error.message;
    } finally { inFlight = false; }
  }
  refresh();
  const interval = win.setInterval(refresh, 60_000);
  const onVisibility = () => { if (!doc.hidden) refresh(); };
  doc.addEventListener("visibilitychange", onVisibility);
  return {
    refresh,
    destroy() {
      win.clearInterval(interval);
      background.destroy();
      restore.removeEventListener("click", showChrome);
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

if (typeof document !== "undefined" && document.getElementById("homeBackground")) mountMusicHome(document, window);
