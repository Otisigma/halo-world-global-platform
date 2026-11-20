// Artist Shop theme picker. Applies one HALO room theme at the shop root so the player, living
// visualizer, shop cards, video gallery, dock and bag all change together.
//   • Free themes: hover/focus previews them, click saves the choice for this shop on this device.
//   • Premium themes and the Custom Brand Palette: preview only (nothing is saved or charged) until
//     premium access exists for the shop.
//   • ?theme=<free-theme-id> opens the shop in that mood (handy for sharing a link).
import {
  HALO_THEMES, DEFAULT_THEME_ID, CUSTOM_THEME_ID, applyHaloTheme, buildCustomTokens, getHaloTheme,
} from "/lib/halo-themes.js";

const STORAGE_KEY = "halo.theme.artist-shop";
const root = document.documentElement;
const button = document.getElementById("theme-button");
const panel = document.getElementById("theme-panel");

const storage = {
  get() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
  set(value) { try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode: keep for this visit */ } },
};

const isFree = id => HALO_THEMES[id]?.tier === "free";
const fromUrl = new URLSearchParams(location.search).get("theme");
let saved = isFree(fromUrl) ? fromUrl : isFree(storage.get()) ? storage.get() : DEFAULT_THEME_ID;
let previewing = null; // { id, customTokens } while a premium/custom look is being previewed

function show(id, options = {}) {
  return applyHaloTheme(id, { targetEl: root, ...options });
}
function restore() {
  if (previewing) show(previewing.id, { preview: true, customTokens: previewing.customTokens });
  else show(saved);
}
show(saved);

if (button && panel) {
  const list = panel.querySelector("[data-theme-list]");
  const status = panel.querySelector("[data-theme-status]");
  const notice = panel.querySelector("[data-theme-preview-notice]");
  const endPreview = panel.querySelector("[data-theme-end-preview]");
  const accentInput = panel.querySelector("#theme-custom-accent");
  const bgInput = panel.querySelector("#theme-custom-bg");
  const customButton = panel.querySelector("[data-theme-custom]");

  const swatch = theme => {
    const t = theme.tokens;
    return `<span class="theme-swatch" aria-hidden="true" style="--sw-bg:${t["--halo-bg"]};--sw-surface:${t["--halo-surface"]};--sw-accent:${t["--halo-accent"]};--sw-viz:${t["--halo-visualizer-secondary"]}"><i></i></span>`;
  };
  const option = theme => `
    <button type="button" class="theme-option" data-theme-id="${theme.id}" aria-pressed="false">
      ${swatch(theme)}
      <span class="theme-option-text">
        <strong>${theme.name}${theme.tier === "free" ? "" : ' <em class="theme-tier">Premium</em>'}</strong>
        <span>${theme.vibe}</span>
      </span>
    </button>`;
  const themes = Object.values(HALO_THEMES);
  list.innerHTML = `
    <p class="theme-group-label">Free themes</p>
    ${themes.filter(t => t.tier === "free").map(option).join("")}
    <p class="theme-group-label">Premium — preview only</p>
    ${themes.filter(t => t.tier !== "free").map(option).join("")}`;

  function sync() {
    const activeId = previewing?.id || saved;
    for (const node of list.querySelectorAll(".theme-option")) {
      node.setAttribute("aria-pressed", String(node.dataset.themeId === activeId));
    }
    customButton?.setAttribute("aria-pressed", String(activeId === CUSTOM_THEME_ID));
    notice.hidden = !previewing;
    const savedName = getHaloTheme(saved).name;
    button.querySelector("[data-theme-name]").textContent = previewing
      ? (previewing.id === CUSTOM_THEME_ID ? "Custom (preview)" : `${getHaloTheme(previewing.id).name} (preview)`)
      : savedName;
    notice.querySelector("[data-theme-saved-name]").textContent = savedName;
  }

  function choose(id) {
    if (isFree(id)) {
      saved = id;
      previewing = null;
      storage.set(id);
      show(id);
      status.textContent = `${getHaloTheme(id).name} is now this shop's theme on this device.`;
    } else {
      previewing = { id, customTokens: null };
      show(id, { preview: true });
      status.textContent = `Previewing ${getHaloTheme(id).name}. Premium themes unlock with premium shop access, so this isn't saved.`;
    }
    sync();
  }

  list.addEventListener("click", event => {
    const node = event.target.closest(".theme-option");
    if (node) choose(node.dataset.themeId);
  });
  // Live preview on hover/focus; leaving the list returns to the current look.
  const peek = event => {
    const node = event.target.closest?.(".theme-option");
    if (node) show(node.dataset.themeId, { preview: true });
  };
  list.addEventListener("pointerover", peek);
  list.addEventListener("focusin", peek);
  list.addEventListener("pointerleave", restore);
  list.addEventListener("focusout", event => { if (!list.contains(event.relatedTarget)) restore(); });

  function previewCustom() {
    const customTokens = buildCustomTokens({ accent: accentInput.value, background: bgInput.value });
    previewing = { id: CUSTOM_THEME_ID, customTokens };
    show(CUSTOM_THEME_ID, { preview: true, customTokens });
    status.textContent = "Previewing a custom brand palette. Text and accent colours were adjusted where needed to stay readable.";
    sync();
  }
  customButton?.addEventListener("click", previewCustom);
  accentInput?.addEventListener("input", () => { if (previewing?.id === CUSTOM_THEME_ID) previewCustom(); });
  bgInput?.addEventListener("input", () => { if (previewing?.id === CUSTOM_THEME_ID) previewCustom(); });

  endPreview.addEventListener("click", () => {
    previewing = null;
    show(saved);
    status.textContent = `Back to ${getHaloTheme(saved).name}.`;
    sync();
  });

  function open() {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    (list.querySelector('[aria-pressed="true"]') || list.querySelector(".theme-option"))?.focus({ preventScroll: true });
  }
  function close({ focusButton = false } = {}) {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    restore();
    if (focusButton) button.focus();
  }
  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  panel.querySelector("[data-theme-close]")?.addEventListener("click", () => close({ focusButton: true }));
  document.addEventListener("keydown", event => { if (event.key === "Escape") close({ focusButton: true }); });
  document.addEventListener("pointerdown", event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close();
  });

  sync();
}
