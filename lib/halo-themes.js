// HALO room themes. A theme is a set of --halo-* CSS custom properties applied once at a shop/room
// root; the audio player, living visualizer, shop cards, video gallery, dock and bag all read them.
// Browser-safe ES module with no DOM access at import time, so it can also be tested in Node.

export const DEFAULT_THEME_ID = "obsidian-gold";

export const THEME_TOKEN_NAMES = [
  "--halo-bg", "--halo-surface", "--halo-text", "--halo-muted", "--halo-accent", "--halo-accent-soft",
  "--halo-visualizer-primary", "--halo-visualizer-secondary", "--halo-border",
];

export const HALO_THEMES = {
  // --- Free themes (every artist and shop) ---
  "obsidian-gold": {
    id: "obsidian-gold", name: "Obsidian Gold", tier: "free", scheme: "dark",
    vibe: "Dark luxury, warm signal, late-night studio focus.",
    fits: "Core HALO releases, house and afro cuts, high-contrast studio showcases.",
    tokens: {
      "--halo-bg": "#0b0b0d", "--halo-surface": "#141418", "--halo-text": "#f5f2eb", "--halo-muted": "#a6a095",
      "--halo-accent": "#e5b84b", "--halo-accent-soft": "rgba(229, 184, 75, 0.16)",
      "--halo-visualizer-primary": "#f5c84c", "--halo-visualizer-secondary": "#9e6b18",
      "--halo-border": "rgba(229, 184, 75, 0.28)",
    },
  },
  "quiet-dawn": {
    id: "quiet-dawn", name: "Quiet Dawn", tier: "free", scheme: "light",
    vibe: "Organic, calm, unhurried acoustic space.",
    fits: "Acoustic and indie sets.",
    tokens: {
      "--halo-bg": "#f4f1ea", "--halo-surface": "#eae5da", "--halo-text": "#1e221f", "--halo-muted": "#5a615b",
      "--halo-accent": "#4f6f59", "--halo-accent-soft": "rgba(79, 111, 89, 0.14)",
      "--halo-visualizer-primary": "#5b7c65", "--halo-visualizer-secondary": "#b79b6a",
      "--halo-border": "rgba(30, 34, 31, 0.16)",
    },
  },
  "midnight-slate": {
    id: "midnight-slate", name: "Midnight Slate", tier: "free", scheme: "dark",
    vibe: "Crisp, minimal, analytical, club-ready clarity.",
    fits: "Deep and tech house, DJ mixes, stripped-back catalog views.",
    tokens: {
      "--halo-bg": "#0d1117", "--halo-surface": "#161c24", "--halo-text": "#e6edf3", "--halo-muted": "#8b949e",
      "--halo-accent": "#58a6ff", "--halo-accent-soft": "rgba(88, 166, 255, 0.16)",
      "--halo-visualizer-primary": "#79c0ff", "--halo-visualizer-secondary": "#2f5d8a",
      "--halo-border": "rgba(139, 148, 158, 0.24)",
    },
  },
  "velvet-dusk": {
    id: "velvet-dusk", name: "Velvet Dusk", tier: "free", scheme: "dark",
    vibe: "Moody, intimate, emotional after-hours energy.",
    fits: "Late-night R&B and soul, ballads, intimate listening rooms.",
    tokens: {
      "--halo-bg": "#140d16", "--halo-surface": "#201423", "--halo-text": "#f7eef8", "--halo-muted": "#b59eb8",
      "--halo-accent": "#d977a6", "--halo-accent-soft": "rgba(217, 119, 166, 0.18)",
      "--halo-visualizer-primary": "#f08ec0", "--halo-visualizer-secondary": "#7d385c",
      "--halo-border": "rgba(217, 119, 166, 0.28)",
    },
  },
  "signal-forest": {
    id: "signal-forest", name: "Signal Forest", tier: "free", scheme: "dark",
    vibe: "Grounded, natural, off-grid sanctuary.",
    fits: "Private shops, slow-burn tracks, calm listening sessions.",
    tokens: {
      "--halo-bg": "#0b1310", "--halo-surface": "#121f1a", "--halo-text": "#edf3ef", "--halo-muted": "#93a89e",
      "--halo-accent": "#52a878", "--halo-accent-soft": "rgba(82, 168, 120, 0.16)",
      "--halo-visualizer-primary": "#68c490", "--halo-visualizer-secondary": "#2a5c41",
      "--halo-border": "rgba(82, 168, 120, 0.25)",
    },
  },

  // --- Premium themes (unlockable / tiered / founding editions) ---
  "liquid-bronze": {
    id: "liquid-bronze", name: "Liquid Bronze & Copper", tier: "premium", scheme: "dark",
    vibe: "Metallic copper and bronze with a warm ember pulse.",
    fits: "VIP drops, limited editions, flagship artist shops.",
    tokens: {
      "--halo-bg": "#100c0a", "--halo-surface": "#1b1410", "--halo-text": "#faf2ea", "--halo-muted": "#b89f8c",
      "--halo-accent": "#d47a42", "--halo-accent-soft": "rgba(212, 122, 66, 0.18)",
      "--halo-visualizer-primary": "#eb9257", "--halo-visualizer-secondary": "#7a3e1c",
      "--halo-border": "rgba(212, 122, 66, 0.32)",
    },
  },
  "ultraviolet-signal": {
    id: "ultraviolet-signal", name: "Sub-Zero Ultraviolet", tier: "premium", scheme: "dark",
    vibe: "Electric violet and cyan over pitch black.",
    fits: "High-energy DJ sets, remixes, club rooms.",
    tokens: {
      "--halo-bg": "#07070d", "--halo-surface": "#10101d", "--halo-text": "#f4f3ff", "--halo-muted": "#9d9bc4",
      "--halo-accent": "#9b6bff", "--halo-accent-soft": "rgba(155, 107, 255, 0.2)",
      "--halo-visualizer-primary": "#b48cff", "--halo-visualizer-secondary": "#38e8e1",
      "--halo-border": "rgba(155, 107, 255, 0.34)",
    },
  },
  "nocturne-amber": {
    id: "nocturne-amber", name: "Nocturne Amber Reel", tier: "premium", scheme: "dark",
    vibe: "Warm cinema amber with a soft glow.",
    fits: "Visual stories, video-heavy shops, narrative releases.",
    tokens: {
      "--halo-bg": "#110d08", "--halo-surface": "#1c150d", "--halo-text": "#f8f0e3", "--halo-muted": "#b8a58b",
      "--halo-accent": "#e08e26", "--halo-accent-soft": "rgba(224, 142, 38, 0.18)",
      "--halo-visualizer-primary": "#f5a638", "--halo-visualizer-secondary": "#8c4a0e",
      "--halo-border": "rgba(224, 142, 38, 0.3)",
    },
  },
};

export const CUSTOM_THEME_ID = "custom-brand";

// ---------- Colour helpers ----------
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(value) {
  const match = HEX.exec(String(value || "").trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}

const toHex = rgb => `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, amount) => a.map((v, i) => v + (b[i] - v) * amount);
const rgba = (rgb, alpha) => `rgba(${rgb.map(Math.round).join(", ")}, ${alpha})`;

export function luminance(rgb) {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Builds a full token set from an artist's accent and background colours (Custom Brand Palette).
 * Text, muted text and the accent are nudged until they stay readable on the chosen background:
 * body text ≥ 7:1, muted text ≥ 4.5:1, accent ≥ 4.5:1 (it also backs button labels). Mid-tone
 * backgrounds are shifted lighter or darker when no text colour could be readable on them.
 */
export function buildCustomTokens({ accent, background } = {}) {
  let bg = parseHex(background) || parseHex(HALO_THEMES[DEFAULT_THEME_ID].tokens["--halo-bg"]);
  let acc = parseHex(accent) || parseHex(HALO_THEMES[DEFAULT_THEME_ID].tokens["--halo-accent"]);
  const light = contrastRatio([24, 24, 26], bg) > contrastRatio([246, 243, 236], bg);
  const ink = light ? [24, 24, 26] : [246, 243, 236];
  // Mid-tone backgrounds can't carry readable text, so push them lighter/darker until they can.
  const away = light ? [255, 255, 255] : [0, 0, 0];
  for (let i = 0; i < 20 && contrastRatio(ink, bg) < 8; i += 1) bg = mix(bg, away, 0.12);
  const text = mix(ink, acc, 0.06);
  let muted = mix(ink, bg, 0.38);
  for (let i = 0; i < 20 && contrastRatio(muted, bg) < 4.5; i += 1) muted = mix(muted, ink, 0.15);
  for (let i = 0; i < 20 && contrastRatio(acc, bg) < 4.5; i += 1) acc = mix(acc, ink, 0.12);
  const surface = mix(bg, ink, 0.05);
  return {
    "--halo-bg": toHex(bg),
    "--halo-surface": toHex(surface),
    "--halo-text": toHex(text),
    "--halo-muted": toHex(muted),
    "--halo-accent": toHex(acc),
    "--halo-accent-soft": rgba(acc, light ? 0.14 : 0.16),
    "--halo-visualizer-primary": toHex(acc),
    "--halo-visualizer-secondary": toHex(mix(acc, bg, 0.55)),
    "--halo-border": rgba(light ? ink : acc, light ? 0.16 : 0.28),
  };
}

/** Returns the theme record for an id, falling back to Obsidian Gold. */
export function getHaloTheme(themeId) {
  return HALO_THEMES[themeId] || HALO_THEMES[DEFAULT_THEME_ID];
}

/**
 * Applies a theme to a target container (shop root, player wrapper, or documentElement) so the
 * player, visualizer, cards and video gallery all inherit the same tokens.
 * Premium themes need hasPremiumAccess, or preview: true (a temporary, unsaved look).
 * customTokens are only honoured for the custom brand palette or when premium access is granted.
 */
export function applyHaloTheme(themeId, {
  targetEl = globalThis.document?.documentElement,
  hasPremiumAccess = false,
  preview = false,
  customTokens = null,
  eventTarget = globalThis.window,
} = {}) {
  if (!targetEl?.style) return { applied: false, reason: "no_target" };
  const isCustom = themeId === CUSTOM_THEME_ID;
  const base = isCustom ? { ...HALO_THEMES[DEFAULT_THEME_ID], id: CUSTOM_THEME_ID, name: "Custom Brand Palette", tier: "pro" }
    : getHaloTheme(themeId);
  if (base.tier !== "free" && !hasPremiumAccess && !preview) {
    return { applied: false, reason: "premium_required", fallback: HALO_THEMES[DEFAULT_THEME_ID] };
  }
  const tokens = { ...base.tokens };
  if (customTokens && (isCustom || hasPremiumAccess || preview)) {
    for (const name of THEME_TOKEN_NAMES) if (customTokens[name]) tokens[name] = String(customTokens[name]);
  }
  for (const [cssVar, value] of Object.entries(tokens)) targetEl.style.setProperty(cssVar, value);
  const scheme = isCustom ? (luminance(parseHex(tokens["--halo-bg"]) || [0, 0, 0]) > 0.4 ? "light" : "dark") : base.scheme;
  targetEl.style.setProperty("color-scheme", scheme);
  if (targetEl.dataset) {
    targetEl.dataset.haloTheme = base.id;
    targetEl.dataset.haloThemeTier = base.tier;
    targetEl.dataset.haloThemeScheme = scheme;
    if (preview) targetEl.dataset.haloThemePreview = "true"; else delete targetEl.dataset.haloThemePreview;
  }
  const theme = { ...base, scheme };
  if (eventTarget?.dispatchEvent && typeof globalThis.CustomEvent === "function") {
    eventTarget.dispatchEvent(new CustomEvent("halo:theme-changed", { detail: { theme, tokens, target: targetEl, preview } }));
  }
  return { applied: true, theme, tokens, preview };
}

/** Reads the resolved visualizer colours from an element (for WebGL, which can't read CSS). */
export function readVisualizerColors(element, win = globalThis.window) {
  const fallback = HALO_THEMES[DEFAULT_THEME_ID].tokens;
  const style = element && win?.getComputedStyle ? win.getComputedStyle(element) : null;
  const read = name => parseHex(style?.getPropertyValue(name)) || parseHex(fallback[name]);
  return {
    bg: read("--halo-bg"),
    primary: read("--halo-visualizer-primary"),
    secondary: read("--halo-visualizer-secondary"),
    light: style?.getPropertyValue("color-scheme")?.trim() === "light"
      || (parseHex(style?.getPropertyValue("--halo-bg")) ? luminance(read("--halo-bg")) > 0.4 : false),
  };
}
