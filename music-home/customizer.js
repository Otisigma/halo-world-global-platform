import { CURATED_LOOPS, THEMES, MAX_CUSTOM_VIDEO_BYTES } from "../lib/music-home.js";

export const MODULE_LABELS = Object.freeze({
  PEARL_HALL: "Pearl Hall milestones",
  SOVEREIGN_VAULT: "Published track drops",
  SIGNAL_FEED: "Signal",
  COLLAB_BRIEFS: "Open collaboration briefs",
  CREATIVE_DNA: "Creative DNA"
});

export async function musicHomeApi(body) {
  const upload = body instanceof File;
  const response = await fetch("/api/music-home", {
    method: body ? "POST" : "GET", credentials: "same-origin",
    headers: body ? { "Content-Type": upload ? "video/mp4" : "application/json" } : {},
    ...(body ? { body: upload ? body : JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Music Home is temporarily unavailable.");
  return result;
}

function node(tag, text) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  return element;
}

function button(text, action) {
  const element = node("button", text);
  element.type = "button";
  element.className = "button button-outline";
  element.addEventListener("click", action);
  return element;
}

function label(text, input) {
  const element = node("label", text);
  element.append(input);
  return element;
}

export function moveModule(modules, type, direction) {
  const ordered = modules.map(module => ({ ...module })).sort((a, b) => a.order - b.order);
  const index = ordered.findIndex(module => module.type === type);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length || ![-1, 1].includes(direction)) return ordered;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.map((module, order) => ({ ...module, order }));
}

export function mountMusicHomeCustomizer(root) {
  let version = 0, snapshot, config, busy = false;
  const message = node("p");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  const controls = node("div");
  controls.className = "music-home-controls";

  function render() {
    controls.replaceChildren();
    const premium = snapshot.creatorPass?.entitlements?.customArtistRoom === true;
    const themes = node("select");
    themes.setAttribute("aria-label", "Music Home accent palette");
    Object.entries(THEMES).forEach(([id, theme]) => {
      const unlocked = snapshot.unlocks.themes.includes(id);
      const option = node("option", `${theme.name}${unlocked ? "" : ` — earn ${theme.requiredStems} stems${theme.requiredSplits ? " + 1 completed split" : ""}`}`);
      option.value = id;
      option.disabled = !unlocked;
      themes.append(option);
    });
    themes.value = config.theme;
    themes.addEventListener("change", () => { config.theme = themes.value; });
    controls.append(label("UI accent palette", themes));
    const backgrounds = node("select");
    backgrounds.setAttribute("aria-label", "Atmospheric background");
    const solid = node("option", "Solid Obsidian — no video");
    solid.value = "SOLID_OBSIDIAN";
    backgrounds.append(solid);
    CURATED_LOOPS.forEach(loop => {
      const unlocked = snapshot.unlocks.backgrounds.includes(loop.id);
      const option = node("option", `${loop.name}${unlocked ? "" : ` — earn ${loop.requiredStems} stems${loop.requiredSplits ? " + 1 completed split" : ""}`}`);
      option.value = loop.url;
      option.disabled = !unlocked;
      backgrounds.append(option);
    });
    if (premium && snapshot.customBackgroundUrl) {
      const custom = node("option", "Your uploaded MP4 loop");
      custom.value = snapshot.customBackgroundUrl;
      backgrounds.append(custom);
    }
    backgrounds.value = config.selectedBackgroundUrl || "SOLID_OBSIDIAN";
    backgrounds.addEventListener("change", () => {
      config.backgroundMode = backgrounds.value === "SOLID_OBSIDIAN" ? "SOLID_OBSIDIAN"
        : backgrounds.value === snapshot.customBackgroundUrl ? "CUSTOM_UPLOAD" : "CURATED_LOOP";
      config.selectedBackgroundUrl = config.backgroundMode === "SOLID_OBSIDIAN" ? "" : backgrounds.value;
    });
    controls.append(label("Atmospheric video loop", backgrounds));
    const upload = node("input");
    upload.type = "file";
    upload.accept = "video/mp4,.mp4";
    upload.disabled = !premium;
    upload.addEventListener("change", async () => {
      const file = upload.files?.[0];
      if (!file || busy) return;
      if (file.type !== "video/mp4" || file.size > MAX_CUSTOM_VIDEO_BYTES) {
        message.textContent = "Choose an MP4 no larger than 4 MiB.";
        upload.value = "";
        return;
      }
      const current = version;
      setBusy(true);
      message.textContent = "Uploading your loop…";
      try {
        const result = await musicHomeApi(file);
        if (current !== version) return;
        snapshot = result;
        config = structuredClone(result.config);
        render();
        message.textContent = "Custom loop uploaded and saved. Publish any further layout changes below.";
      } catch (error) { if (current === version) message.textContent = error.message; }
      finally { if (current === version) setBusy(false); }
    });
    controls.append(label(`Custom MP4 loop — ${premium ? "Premium · max 4 MiB" : "locked · active Premium required"}`, upload),
      node("p", "Use a short, seamless H.264 MP4 you own or have permission to display. Upload replaces your previous loop. Save layout edits before uploading."));
    const sovereign = node("input");
    sovereign.type = "checkbox";
    sovereign.checked = config.isSovereignModeActive;
    sovereign.disabled = !premium;
    sovereign.addEventListener("change", () => { config.isSovereignModeActive = sovereign.checked; });
    controls.append(label(`Sovereign Mode — hide public page chrome${premium ? "" : " (Premium)"}`, sovereign));
    const modules = node("fieldset");
    modules.append(node("legend", "Module visibility and order"));
    config.layoutModules.forEach((module, index) => {
      const row = node("div");
      row.className = "music-home-module-control";
      const visible = node("input");
      visible.type = "checkbox";
      visible.checked = module.isVisible;
      visible.addEventListener("change", () => { module.isVisible = visible.checked; });
      const up = button(`Move ${MODULE_LABELS[module.type]} up`, () => {
        config.layoutModules = moveModule(config.layoutModules, module.type, -1);
        render();
        focusMove(module.type, "up");
      });
      const down = button(`Move ${MODULE_LABELS[module.type]} down`, () => {
        config.layoutModules = moveModule(config.layoutModules, module.type, 1);
        render();
        focusMove(module.type, "down");
      });
      up.dataset.move = `${module.type}-up`;
      down.dataset.move = `${module.type}-down`;
      up.disabled = index === 0;
      down.disabled = index === config.layoutModules.length - 1;
      row.append(label(MODULE_LABELS[module.type], visible), up, down);
      modules.append(row);
    });
    controls.append(modules);
    const save = button("Publish Music Home updates", async () => {
      if (busy) return;
      const current = version;
      setBusy(true);
      try {
        const result = await musicHomeApi({ config });
        if (current !== version) return;
        snapshot = result;
        config = structuredClone(result.config);
        render();
        message.textContent = "Music Home updated. Public visibility follows your Creator Pass discovery setting.";
      } catch (error) { if (current === version) message.textContent = error.message; }
      finally { if (current === version) setBusy(false); }
    });
    const preview = node("a", "Open your Music Home");
    preview.href = `/music-home/?creator=${encodeURIComponent(config.creatorId)}`;
    preview.className = "button button-outline";
    controls.append(save, preview);
  }

  function focusMove(type, direction) {
    const control = controls.querySelector(`[data-move="${type}-${direction}"]`);
    (control?.disabled ? control.closest(".music-home-module-control").querySelector("input") : control)?.focus();
  }

  function setBusy(value) {
    busy = value;
    controls.inert = value;
    controls.setAttribute("aria-busy", String(value));
  }

  return {
    async load() {
      const current = ++version;
      busy = false;
      root.replaceChildren(message, controls);
      controls.replaceChildren();
      setBusy(true);
      message.textContent = "Loading your Music Home…";
      try {
        const result = await musicHomeApi();
        if (current !== version) return;
        snapshot = result;
        config = structuredClone(result.config);
        render();
        message.textContent = `${result.milestones.stemUploads} verified stem uploads · ${result.milestones.completedSplits} completed splits. Themes are earned, not bought.`;
      } catch (error) { if (current === version) message.textContent = error.message; }
      finally { if (current === version) setBusy(false); }
    },
    clear() {
      version++;
      snapshot = config = null;
      busy = false;
      root.replaceChildren();
      controls.replaceChildren();
    }
  };
}
