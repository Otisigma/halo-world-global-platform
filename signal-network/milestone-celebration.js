const STORAGE_KEY = "halo-radio-celebrations-v1";
const FALLBACK_ARTWORK = "/assets/releases/halo-premium-placeholder.svg";
const MAX_SEEN = 200;

export function eligibleMilestone(snapshot) {
  const event = snapshot?.milestone;
  return ["PUBLIC", "INNER_CIRCLE", "COLLABORATOR_VAULT"].includes(snapshot?.visibility)
    && event?.kind === "reviewed-radio-rotation"
    && typeof event.releaseId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.releaseId)
    && event.releaseId.length <= 96
    && typeof event.title === "string" && Boolean(event.title.trim())
    && typeof event.artist === "string" && Boolean(event.artist.trim())
    && typeof event.reachedAt === "string" && Number.isFinite(Date.parse(event.reachedAt))
    && Date.parse(event.reachedAt) <= Date.now() ? event : null;
}

export function safeCelebrationArtwork(value) {
  if (typeof value !== "string") return FALLBACK_ARTWORK;
  try {
    const url = new URL(value, "https://halo.invalid");
    if (url.username || url.password || value.startsWith("//")) return FALLBACK_ARTWORK;
    if (value.startsWith("/") && url.origin === "https://halo.invalid") return value;
    return url.protocol === "https:" ? url.href : FALLBACK_ARTWORK;
  } catch { return FALLBACK_ARTWORK; }
}

export async function shareMilestone(event, { navigator, origin }) {
  const url = new URL(`/music/?song=${encodeURIComponent(event.releaseId)}`, origin).href;
  const payload = {
    title: `${event.title} — ${event.artist}`,
    text: `${event.title} by ${event.artist} reached reviewed radio rotation on HALO.`,
    url
  };
  if (typeof navigator.share === "function") {
    try { await navigator.share(payload); return { message: "Share sheet opened." }; }
    catch (error) { if (error.name === "AbortError") return { message: "Sharing cancelled." }; }
  }
  try {
    await navigator.clipboard.writeText(`${payload.text}\n${url}`);
    return { message: "Public track link copied. Nothing was posted." };
  } catch { return { message: "Copy unavailable. Select and copy the public link below.", url }; }
}

export function createMilestoneCelebration(root, { document, window }) {
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const navigator = window.navigator || {};
  const privateBrowser = () => navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  const read = () => {
    try {
      if (privateBrowser()) return null;
      const state = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{"enabled":false,"seen":[]}');
      return typeof state.enabled === "boolean" && Array.isArray(state.seen)
        && state.seen.length <= MAX_SEEN && state.seen.every(key => typeof key === "string") ? state : null;
    } catch { return null; }
  };
  const save = state => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch { return false; }
  };
  const label = node("label");
  const preference = node("input"); preference.type = "checkbox";
  label.append(preference, node("span", " Celebrate reviewed radio milestones once in this browser (saves a local preference and public event keys)."));
  const notice = node("p"); notice.setAttribute("role", "status");
  const dialog = node("section");
  dialog.className = "milestone-celebration";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "false");
  dialog.setAttribute("aria-label", "HALO reviewed radio milestone celebration");
  dialog.hidden = true;
  const confetti = node("div"); confetti.className = "milestone-confetti"; confetti.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 16; i++) {
    const piece = node("i");
    piece.style.setProperty("--piece", i);
    confetti.append(piece);
  }
  const badge = node("p", "✦ Reviewed radio rotation"); badge.className = "milestone-badge";
  const heading = node("h3", "A new chapter. A real milestone.");
  const artwork = node("img"); artwork.alt = ""; artwork.width = artwork.height = 144; artwork.referrerPolicy = "no-referrer";
  artwork.addEventListener("error", () => { if (artwork.getAttribute("src") !== FALLBACK_ARTWORK) artwork.src = FALLBACK_ARTWORK; });
  const track = node("p"); track.className = "milestone-track";
  const detail = node("p", "Selected for reviewed radio rotation on HALO. This is a radio milestone, not a #1 chart ranking.");
  const share = node("button", "Share public track"); share.type = "button";
  const dismiss = node("button", "Dismiss celebration"); dismiss.type = "button";
  dismiss.className = "milestone-dismiss";
  const shareStatus = node("p"); shareStatus.setAttribute("role", "status");
  const linkLabel = node("label", "Public track link");
  const link = node("input"); link.type = "url"; link.readOnly = true;
  linkLabel.append(link); linkLabel.hidden = true;
  dialog.append(dismiss, confetti, badge, heading, artwork, track, detail, share, shareStatus, linkLabel);
  root.append(label, notice, dialog);
  let snapshot = null, active = null, returnFocus = null, effectTimer, epoch = 0;
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  function stopEffect() {
    window.clearTimeout(effectTimer);
    confetti.hidden = true;
  }
  function close() {
    epoch++;
    stopEffect();
    const focusedInside = dialog.contains(document.activeElement);
    dialog.hidden = true;
    active = null;
    share.disabled = false;
    shareStatus.textContent = "";
    link.value = ""; linkLabel.hidden = true;
    if (focusedInside) (returnFocus?.isConnected ? returnFocus : preference).focus({ preventScroll: true });
    document.removeEventListener("keydown", keydown);
  }
  function keydown(event) { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); } }
  function update(data) {
    snapshot = data;
    const state = read();
    preference.disabled = !state;
    preference.checked = state?.enabled === true;
    notice.textContent = !state ? "Automatic celebrations are off: browser privacy settings or local storage prevent saving your choice." : "";
    const event = eligibleMilestone(data);
    if (!event || !state?.enabled || document.hidden) { close(); return; }
    const key = `${event.releaseId}:${event.reachedAt}`;
    if (active && `${active.releaseId}:${active.reachedAt}` === key) return;
    close();
    if (state.seen.includes(key)) return;
    if (state.seen.length >= MAX_SEEN) {
      notice.textContent = "Automatic celebration history is full. Verified milestones remain available in the room.";
      return;
    }
    // Persist before presentation; failed storage must never cause a refresh loop.
    if (!save({ enabled: true, seen: [...state.seen, key] })) {
      preference.disabled = true;
      notice.textContent = "Celebration could not be saved; automatic presentation is off.";
      return;
    }
    active = { releaseId: event.releaseId, reachedAt: event.reachedAt, title: event.title, artist: event.artist };
    returnFocus = document.activeElement;
    track.textContent = `${event.title} — ${event.artist}`;
    artwork.src = safeCelebrationArtwork(event.artwork);
    dialog.hidden = false;
    confetti.hidden = motion?.matches !== false || document.documentElement?.classList.contains("halo-safe-space-mode");
    if (!confetti.hidden) effectTimer = window.setTimeout(stopEffect, 2400);
    notice.textContent = `${event.title} reached reviewed radio rotation. Celebration available below; press Escape to dismiss.`;
    document.addEventListener("keydown", keydown);
  }
  const change = () => {
    const state = read();
    if (!state || !save({ ...state, enabled: preference.checked })) { preference.checked = false; close(); return; }
    update(snapshot);
  };
  const storage = event => { if (event.key === STORAGE_KEY || event.key === null) { close(); update(snapshot); } };
  const reduceMotion = () => { if (motion.matches) stopEffect(); };
  share.addEventListener("click", async () => {
    if (!active || share.disabled) return;
    const current = epoch;
    share.disabled = true;
    const result = await shareMilestone(active, { navigator, origin: window.location.origin });
    if (epoch !== current || !active) return;
    shareStatus.textContent = result.message;
    linkLabel.hidden = !result.url;
    link.value = result.url || "";
    if (result.url) { link.focus(); link.select(); }
    share.disabled = false;
  });
  preference.addEventListener("change", change);
  dismiss.addEventListener("click", close);
  motion?.addEventListener?.("change", reduceMotion);
  window.addEventListener("storage", storage);
  update(null);
  return {
    update,
    reset() { snapshot = null; close(); },
    destroy() {
      close();
      preference.removeEventListener("change", change);
      motion?.removeEventListener?.("change", reduceMotion);
      window.removeEventListener("storage", storage);
      label.remove(); notice.remove(); dialog.remove();
    }
  };
}
