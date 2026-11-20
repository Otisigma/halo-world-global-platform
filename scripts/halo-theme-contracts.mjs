// Contracts for HALO room themes: token completeness, readable contrast, premium gating,
// custom palette guard-rails, and the theme-changed event the living player listens for.
import assert from "node:assert/strict";
import {
  HALO_THEMES, THEME_TOKEN_NAMES, DEFAULT_THEME_ID, CUSTOM_THEME_ID, applyHaloTheme, buildCustomTokens,
  contrastRatio, parseHex, readVisualizerColors,
} from "../lib/halo-themes.js";

const free = Object.values(HALO_THEMES).filter(t => t.tier === "free");
const premium = Object.values(HALO_THEMES).filter(t => t.tier === "premium");
assert.equal(free.length, 5, "five free themes");
assert.equal(premium.length, 3, "three premium themes");
assert.equal(HALO_THEMES[DEFAULT_THEME_ID].tier, "free");

for (const theme of Object.values(HALO_THEMES)) {
  assert.deepEqual(Object.keys(theme.tokens).sort(), [...THEME_TOKEN_NAMES].sort(), `${theme.id} defines every token`);
  const bg = parseHex(theme.tokens["--halo-bg"]);
  const surface = parseHex(theme.tokens["--halo-surface"]);
  const text = parseHex(theme.tokens["--halo-text"]);
  const muted = parseHex(theme.tokens["--halo-muted"]);
  const accent = parseHex(theme.tokens["--halo-accent"]);
  for (const name of ["--halo-bg", "--halo-surface", "--halo-text", "--halo-muted", "--halo-accent", "--halo-visualizer-primary", "--halo-visualizer-secondary"]) {
    assert.ok(parseHex(theme.tokens[name]), `${theme.id} ${name} is hex (the WebGL stage parses it)`);
  }
  assert.ok(contrastRatio(text, bg) >= 7, `${theme.id} body text ≥ 7:1`);
  assert.ok(contrastRatio(text, surface) >= 7, `${theme.id} text on cards ≥ 7:1`);
  assert.ok(contrastRatio(muted, surface) >= 4.5, `${theme.id} muted text on cards ≥ 4.5:1`);
  assert.ok(contrastRatio(accent, bg) >= 3, `${theme.id} accent visible on background`);
  assert.ok(contrastRatio(bg, accent) >= 4.5, `${theme.id} button label (bg colour) on accent ≥ 4.5:1`);
}

// Minimal target element + event sink.
const makeTarget = () => ({ style: { values: {}, setProperty(k, v) { this.values[k] = v; } }, dataset: {} });
const events = [];
const eventTarget = { dispatchEvent: e => events.push(e) };

const target = makeTarget();
const ok = applyHaloTheme("velvet-dusk", { targetEl: target, eventTarget });
assert.equal(ok.applied, true);
assert.equal(target.style.values["--halo-accent"], HALO_THEMES["velvet-dusk"].tokens["--halo-accent"]);
assert.equal(target.dataset.haloTheme, "velvet-dusk");
assert.equal(target.dataset.haloThemeTier, "free");
assert.equal(events.at(-1).type, "halo:theme-changed");
assert.equal(events.at(-1).detail.theme.id, "velvet-dusk");

// Unknown ids fall back to the signature theme.
applyHaloTheme("nope", { targetEl: target, eventTarget });
assert.equal(target.dataset.haloTheme, DEFAULT_THEME_ID);

// Premium themes need access, or an explicit unsaved preview.
const blocked = makeTarget();
const denied = applyHaloTheme("liquid-bronze", { targetEl: blocked, eventTarget });
assert.equal(denied.applied, false);
assert.equal(denied.reason, "premium_required");
assert.deepEqual(blocked.style.values, {}, "nothing applied without access");
const preview = applyHaloTheme("liquid-bronze", { targetEl: blocked, eventTarget, preview: true });
assert.equal(preview.applied, true);
assert.equal(blocked.dataset.haloThemePreview, "true");
assert.equal(applyHaloTheme("liquid-bronze", { targetEl: blocked, eventTarget, hasPremiumAccess: true }).applied, true);
assert.equal(blocked.dataset.haloThemePreview, undefined, "preview flag cleared once applied for real");
assert.equal(applyHaloTheme(CUSTOM_THEME_ID, { targetEl: makeTarget(), eventTarget }).reason, "premium_required");

// Free themes ignore custom token overrides without access; unknown token names are dropped.
const freeTarget = makeTarget();
applyHaloTheme("signal-forest", { targetEl: freeTarget, eventTarget, customTokens: { "--halo-accent": "#ff0000" } });
assert.equal(freeTarget.style.values["--halo-accent"], HALO_THEMES["signal-forest"].tokens["--halo-accent"]);
const custom = makeTarget();
applyHaloTheme(CUSTOM_THEME_ID, { targetEl: custom, eventTarget, preview: true, customTokens: { "--halo-accent": "#ff0000", "--evil": "x" } });
assert.equal(custom.style.values["--halo-accent"], "#ff0000");
assert.equal(custom.style.values["--evil"], undefined);

// Custom brand palette keeps text readable, even for hostile picks.
for (const [accent, background] of [["#111111", "#000000"], ["#ffff00", "#ffffff"], ["#777777", "#808080"], ["#e5b84b", "#0b0b0d"], ["nonsense", "#zzz"]]) {
  const tokens = buildCustomTokens({ accent, background });
  assert.deepEqual(Object.keys(tokens).sort(), [...THEME_TOKEN_NAMES].sort());
  const bg = parseHex(tokens["--halo-bg"]);
  assert.ok(contrastRatio(parseHex(tokens["--halo-text"]), bg) >= 7, `custom ${accent}/${background} text readable`);
  assert.ok(contrastRatio(parseHex(tokens["--halo-muted"]), bg) >= 4.5, `custom ${accent}/${background} muted readable`);
  assert.ok(contrastRatio(parseHex(tokens["--halo-accent"]), bg) >= 4.5, `custom ${accent}/${background} accent readable as a button`);
}
const lightCustom = makeTarget();
applyHaloTheme(CUSTOM_THEME_ID, { targetEl: lightCustom, eventTarget, preview: true, customTokens: buildCustomTokens({ accent: "#3366cc", background: "#fafafa" }) });
assert.equal(lightCustom.dataset.haloThemeScheme, "light");

// The WebGL stage reads resolved colours; without computed styles it falls back to gold.
const colors = readVisualizerColors(null, {});
assert.deepEqual(colors.primary, parseHex(HALO_THEMES[DEFAULT_THEME_ID].tokens["--halo-visualizer-primary"]));
const styled = readVisualizerColors({}, { getComputedStyle: () => ({ getPropertyValue: name => ({
  "--halo-bg": " #f4f1ea", "--halo-visualizer-primary": "#5b7c65", "--halo-visualizer-secondary": "#b79b6a", "color-scheme": "light" })[name] || "" }) });
assert.deepEqual(styled.primary, [0x5b, 0x7c, 0x65]);
assert.equal(styled.light, true);

console.log("HALO theme contracts passed");
