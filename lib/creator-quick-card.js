const managers = new WeakMap();
let nextId = 0;
export function sameOriginCreatorLink(value, origin = globalThis.location?.origin || "https://halo.invalid") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "";
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.username && !url.password ? `${url.pathname}${url.search}${url.hash}` : "";
  } catch { return ""; }
}
export function creatorPreviewModel(creator, source = "directory") {
  const sample = source === "sample";
  const memberId = source === "feed" ? creator.memberId : creator.member_id;
  const slug = creator.artist_slug;
  const id = sample ? creator.id : memberId || (slug ? `artist:${slug}` : "");
  return {
    id: id ? `${sample ? "sample" : "real"}:${id}` : "",
    name: creator.authorName || creator.display_name || creator.displayName || "Creator",
    handle: creator.handle || "", bio: creator.bio || "",
    status: sample ? `${creator.availability || "Availability unavailable"} · sample only`
      : source === "feed" ? "Profile status unavailable" : creator.curated ? "HALO-curated directory entry · not a member account"
        : creator.premium_verified === true ? "Verified Premium · subscription, not identity verification" : "Opt-in Creator Pass",
    disclosure: sample ? "Illustrative sample creator. Demo actions do not change real relationships."
      : "Relationships are not inferred from names. Add to Circle is not available in this release.",
    links: slug ? [{ label: "Artist room + follows", href: `/artists/${encodeURIComponent(slug)}/` }]
      : sample ? [] : [{ label: "Explore opt-in Creator Passes", href: "/creator-network/#publicDirectory" },
        ...(source === "feed" && memberId ? [{ label: "Open collaboration workspace", href: "/signal-network/#command-center" }] : [])],
    sample
  };
}

export function creatorQuickCards(doc = globalThis.document) {
  if (!doc?.body || !doc.addEventListener) return { attach() {}, close() {} };
  if (managers.has(doc)) return managers.get(doc);
  const win = doc.defaultView || globalThis.window;
  const panel = doc.createElement("section");
  panel.id = `creator-quick-card-${++nextId}`;
  panel.className = "creator-quick-card";
  panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Creator quick card");
  doc.body.append(panel);
  let active, hideTimer, suppressFocus = false;
  const node = (tag, text) => { const item = doc.createElement(tag); item.textContent = text; return item; };
  const modalOpen = () => Boolean(doc.querySelector('dialog[open], [aria-modal="true"]'));
  function close(restore = false) {
    clearTimeout(hideTimer);
    const opener = active?.trigger;
    opener?.setAttribute("aria-expanded", "false");
    active = null; panel.hidden = true; panel.replaceChildren();
    if (restore && opener?.isConnected && !opener.closest("[hidden]") && !modalOpen()) {
      suppressFocus = true; opener.focus(); suppressFocus = false;
    }
  }
  function position() {
    if (!active) return;
    if (!active.trigger.isConnected || active.trigger.closest("[hidden]") || modalOpen()) { close(); return; }
    const rect = active.trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const width = win.innerWidth, height = win.innerHeight;
    if (rect.bottom < 0 || rect.top > height) { close(); return; }
    panel.style.left = `${Math.max(8, Math.min(rect.left, width - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 8, height - bounds.height - 8))}px`;
  }
  function open(trigger, model, actions, focus) {
    clearTimeout(hideTimer);
    if (suppressFocus || modalOpen() || trigger.closest("[hidden]")) return;
    if (active?.trigger !== trigger) {
      close();
      active = { trigger };
      const dismiss = node("button", "Close creator card"); dismiss.type = "button";
      dismiss.addEventListener("click", () => close(true));
      const title = node("h3", model.name); title.id = `${panel.id}-title`;
      panel.setAttribute("aria-labelledby", title.id);
      panel.append(dismiss, title, node("p", model.handle ? `@${String(model.handle).replace(/^@+/, "")}` : "Handle unavailable"),
        node("p", model.bio || "Bio unavailable in this view."), node("p", model.status), node("p", model.disclosure));
      for (const item of model.links || []) {
        const href = sameOriginCreatorLink(item.href, win.location.origin);
        if (!href) continue;
        const link = node("a", item.label); link.href = href; panel.append(link);
      }
      // Actions are supplied by each adapter, never generated from a guessed identity.
      for (const action of actions || []) {
        const control = node("button", typeof action.label === "function" ? action.label() : action.label); control.type = "button";
        control.addEventListener("click", () => { close(); action.run(trigger); });
        panel.append(control);
      }
      panel.hidden = false; trigger.setAttribute("aria-expanded", "true");
      position();
      win.haloStats?.track?.("creator_preview_open", { context: model.sample ? "sample" : "real" });
    }
    if (focus) panel.querySelector("button")?.focus();
  }
  function scheduleClose() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (panel.contains(doc.activeElement) || active?.trigger === doc.activeElement) return;
      close();
    }, 180);
  }
  panel.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  panel.addEventListener("pointerleave", scheduleClose);
  panel.addEventListener("focusin", () => clearTimeout(hideTimer));
  panel.addEventListener("focusout", event => { if (!panel.contains(event.relatedTarget)) scheduleClose(); });
  doc.addEventListener("keydown", event => {
    if (active && event.key === "Escape" && !event.defaultPrevented && !modalOpen()) {
      event.preventDefault(); close(true);
    }
  });
  doc.addEventListener("click", event => {
    if (active && !panel.contains(event.target) && !active.trigger.contains(event.target)) close();
  });
  doc.addEventListener("focusin", () => { if (modalOpen()) close(); });
  win.addEventListener("resize", position);
  win.addEventListener("scroll", position, true);
  const manager = {
    close,
    attach(trigger, model, actions = []) {
      trigger.setAttribute("aria-haspopup", "dialog"); trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-controls", panel.id);
      trigger.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") open(trigger, model, actions, false); });
      trigger.addEventListener("pointerleave", scheduleClose);
      trigger.addEventListener("focus", () => open(trigger, model, actions, false));
      trigger.addEventListener("blur", event => { if (!panel.contains(event.relatedTarget)) scheduleClose(); });
      trigger.addEventListener("click", () => open(trigger, model, actions, true));
    }
  };
  managers.set(doc, manager);
  return manager;
}
