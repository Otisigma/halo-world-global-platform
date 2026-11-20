// HALO Artist Shop — swappable hero header image.
// The artist (page owner) can use an uploaded image, an image link, one of their own release
// covers, or reset to the theme backdrop, then set a focal point and dim level so the hero copy
// stays readable. Each artist page keeps its own header (saved by /api/shop-header), so a
// persona's shop and the owner's own shop never share one. Visitors only see the result.
const API = "/api/shop-header";
const FOCAL_POSITIONS = { top: "50% 18%", center: "50% 50%", bottom: "50% 82%", left: "18% 50%", right: "82% 50%" };
const THEME_HEADER = { sourceType: "theme", imageUrl: "", songId: "", label: "Theme backdrop", focal: "center", scrim: 0.62 };
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const clampScrim = value => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(0.92, Math.max(0.1, num)) : 0.62;
};
function safeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  try { const url = new URL(raw); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}
const canLoad = url => new Promise(resolve => {
  const img = new Image();
  img.onload = () => resolve(true);
  img.onerror = () => resolve(false);
  img.src = url;
});

/** Paints a header state onto the hero (background layer, scrim strength, status label). */
export function createHeaderImageController({ heroEl, onChange } = {}) {
  if (!heroEl) return null;
  const bgEl = heroEl.querySelector("[data-header-bg]");
  const scrimEl = heroEl.querySelector("[data-header-scrim]");
  const statusEl = heroEl.querySelector("[data-header-status]");
  let state = { ...THEME_HEADER };

  function apply(next) {
    state = { ...state, ...next, scrim: clampScrim(next?.scrim ?? state.scrim) };
    if (!FOCAL_POSITIONS[state.focal]) state.focal = "center";
    const url = state.sourceType === "theme" ? "" : (state.imageUrl.startsWith("blob:") ? state.imageUrl : safeImageUrl(state.imageUrl));
    const source = url ? state.sourceType : "theme";
    if (bgEl) {
      bgEl.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : "";
      bgEl.style.backgroundPosition = FOCAL_POSITIONS[state.focal];
      bgEl.dataset.hasHeaderImage = String(Boolean(url));
    }
    scrimEl?.style.setProperty("--halo-scrim-opacity", String(state.scrim));
    if (statusEl) statusEl.textContent = `Header: ${url ? state.label || "Custom image" : "Theme backdrop"}`;
    heroEl.dataset.headerSource = source;
    if (typeof onChange === "function") onChange({ ...state });
  }

  return { getState: () => ({ ...state }), apply, reset: () => apply({ ...THEME_HEADER }) };
}

// ---------- Wiring ----------
const hero = document.getElementById("signal-hero");
const panel = document.getElementById("header-panel");
const controller = createHeaderImageController({ heroEl: hero });

if (hero && panel && controller) {
  const q = selector => panel.querySelector(selector);
  const el = {
    ownerBar: hero.querySelector("[data-header-owner]"), edit: hero.querySelector("[data-header-edit]"),
    close: q("[data-header-close]"), artist: q("[data-header-artist]"), status: q("[data-header-panel-status]"),
    file: q("[data-header-file]"), url: q("[data-header-url]"), applyUrl: q("[data-header-apply-url]"),
    cover: q("[data-header-cover]"), coverEmpty: q("[data-header-cover-empty]"),
    focal: q("[data-header-focal]"), scrim: q("[data-header-scrim-range]"), reset: q("[data-header-reset]")
  };
  let artist = null;
  let saved = { ...THEME_HEADER };
  let canEdit = false;
  let busy = false;
  let loadToken = 0;
  let scrimTimer = 0;

  const say = message => { el.status.textContent = message; };

  function syncControls() {
    el.focal.value = saved.focal;
    el.scrim.value = String(saved.scrim);
    el.cover.value = saved.sourceType === "album_cover" ? saved.songId : "";
    if (saved.sourceType === "url") el.url.value = saved.imageUrl;
  }

  function renderCovers(releases = []) {
    el.cover.innerHTML = '<option value="">Pick an album / song cover…</option>';
    releases.forEach(release => {
      const option = document.createElement("option");
      option.value = release.id;
      option.textContent = `${release.title}${release.album && release.album !== release.title ? ` (${release.album})` : ""}${release.artist ? ` — ${release.artist}` : ""}`;
      el.cover.appendChild(option);
    });
    el.cover.disabled = !releases.length;
    el.coverEmpty.hidden = Boolean(releases.length);
  }

  function useResponse(body) {
    saved = { ...THEME_HEADER, ...(body?.header || {}) };
    controller.apply(saved);
    canEdit = Boolean(body?.canEdit);
    el.ownerBar.hidden = !canEdit;
    if (!canEdit) closePanel();
    if (canEdit) {
      el.artist.textContent = body.artist?.artistName ? ` for ${body.artist.artistName}` : "";
      renderCovers(body.releases || []);
      syncControls();
    }
  }

  async function load(slug) {
    const token = ++loadToken;
    artist = slug || null;
    if (!artist) { useResponse(null); return; }
    try {
      const response = await fetch(`${API}?artist=${encodeURIComponent(artist)}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      if (token === loadToken) useResponse(body);
    } catch {
      if (token === loadToken) useResponse(null);
    }
  }

  async function send(payload, { preview, success } = {}) {
    if (!artist || !canEdit) return;
    if (busy) { setTimeout(() => send(payload, { preview, success }), 400); return; }
    busy = true;
    panel.setAttribute("aria-busy", "true");
    if (preview) controller.apply(preview);
    say("Saving…");
    try {
      const isForm = payload instanceof FormData;
      if (isForm) payload.set("artist", artist);
      const response = await fetch(API, {
        method: "POST",
        credentials: "same-origin",
        headers: isForm ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: isForm ? payload : JSON.stringify({ ...payload, artist })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "The header couldn't be saved");
      useResponse(body);
      say(success || "Header saved");
    } catch (error) {
      controller.apply(saved);
      syncControls();
      say(error instanceof Error ? error.message : "The header couldn't be saved");
    } finally {
      busy = false;
      panel.removeAttribute("aria-busy");
    }
  }

  function framing() {
    return { focal: el.focal.value, scrim: clampScrim(el.scrim.value) };
  }

  function openPanel() {
    panel.hidden = false;
    el.edit.setAttribute("aria-expanded", "true");
    syncControls();
    say("");
    el.close.focus();
  }
  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    el.edit.setAttribute("aria-expanded", "false");
  }

  el.edit.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()));
  el.close.addEventListener("click", () => { closePanel(); el.edit.focus(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { closePanel(); el.edit.focus(); }
  });

  el.file.addEventListener("change", async () => {
    const file = el.file.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { say("Upload a JPEG, PNG or WebP image"); el.file.value = ""; return; }
    if (file.size > MAX_UPLOAD_BYTES) { say("Header images must be 4 MB or smaller"); el.file.value = ""; return; }
    const previewUrl = URL.createObjectURL(file);
    const form = new FormData();
    form.set("image", file);
    const { focal, scrim } = framing();
    form.set("focal", focal);
    form.set("scrim", String(scrim));
    await send(form, { preview: { sourceType: "upload", imageUrl: previewUrl, label: `Upload: ${file.name}`, focal, scrim }, success: "Uploaded and saved as the header" });
    URL.revokeObjectURL(previewUrl);
    el.file.value = "";
  });

  el.applyUrl.addEventListener("click", async () => {
    const url = safeImageUrl(el.url.value);
    if (!url) { say("Paste an https:// image link"); return; }
    say("Checking the image…");
    if (!(await canLoad(url))) { say("That link didn't load as an image"); return; }
    await send({ action: "url", url, ...framing() }, { preview: { sourceType: "url", imageUrl: url, label: "Custom image URL", ...framing() } });
  });
  el.url.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); el.applyUrl.click(); } });

  el.cover.addEventListener("change", () => {
    if (!el.cover.value) return;
    send({ action: "cover", songId: el.cover.value, ...framing() }, { success: "Release cover is now the header" });
  });

  el.focal.addEventListener("change", () => {
    send({ action: "frame", ...framing() }, { preview: framing(), success: "Focal point saved" });
  });
  el.scrim.addEventListener("input", () => {
    controller.apply({ scrim: clampScrim(el.scrim.value) });
    clearTimeout(scrimTimer);
    scrimTimer = setTimeout(() => send({ action: "frame", ...framing() }, { success: "Dim level saved" }), 450);
  });
  panel.querySelectorAll("[data-header-scrim-preset]").forEach(button => button.addEventListener("click", () => {
    el.scrim.value = button.dataset.headerScrimPreset;
    clearTimeout(scrimTimer);
    send({ action: "frame", ...framing() }, { preview: framing(), success: "Dim level saved" });
  }));

  el.reset.addEventListener("click", () => {
    el.file.value = "";
    el.url.value = "";
    el.cover.value = "";
    send({ action: "theme", ...framing() }, { preview: { ...THEME_HEADER, ...framing() }, success: "Back to the theme backdrop" });
  });

  // The video gallery resolves which artist shop is showing (?artist=, the owner's switcher, or
  // their first page) and announces it; the header follows the same artist.
  window.addEventListener("halo:shop-artist", event => {
    const slug = String(event.detail?.slug || "");
    if (slug !== artist || event.detail?.reload) load(slug);
  });
  window.haloShopHeader = controller;
}
