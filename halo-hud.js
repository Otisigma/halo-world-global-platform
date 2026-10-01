/**
 * HALO Autonomous HUD & Proactive Guide Engine
 *
 * Additive, sitewide guidance layer:
 * - `data-halo-guide="…"` on any element shows a floating guide after hover/focus hesitation.
 * - `data-halo-guide-action="copy-isrc"` (with `data-isrc`) adds a copy-to-clipboard action.
 * - `data-halo-guide-action="quick-listen"` adds a preview action that reuses the page's own
 *   play-track button (and therefore the shared window.HaloPlayer singleton).
 * - `?` toggles a global quick guide; Escape or an outside click dismisses the HUD.
 *
 * All listeners are delegated at document level, so late-loaded and re-rendered content
 * (innerHTML swaps) is covered without re-binding. The engine never cancels or halts
 * page clicks, so navigation, player and shop handlers keep working.
 */
(() => {
  "use strict";
  if (window.HaloHud) return;

  const GUIDE_SELECTOR = "[data-halo-guide]";
  const SCOPE_SELECTOR = "[data-halo-guide-scope]";
  const PLAY_SELECTOR = '[data-action="play-track"]';
  const ISRC_PATTERN = /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/;
  const QUICK_GUIDE = [
    ["Listen", "Press ▶ on any release or chart row to stream it in the HALO player bar while you keep browsing."],
    ["Vote", "Use Vote ▲ on the featured chart leader to push it up the Living Chart — one vote per listener per day."],
    ["Buy & license", "Buy links open the artist-approved destination. Licence selections are approval-gated by the artist team."],
    ["ISRC", "Hover or focus an ISRC to copy the official recording identifier in one click."],
    ["Guides", "Hover or focus anything marked for guidance and pause — HALO explains it. Press ? on a focused guide to reach its actions."],
    ["Dismiss", "Press Escape or click anywhere outside the HUD to close it."]
  ];

  const state = {
    hesitationDelay: 1200,
    timer: null,
    pending: null,
    target: null,
    mode: "closed",
    returnFocus: null,
    root: null,
    parts: null
  };
  const actions = new Map();

  function attr(element, name) {
    return element && typeof element.getAttribute === "function" ? element.getAttribute(name) || "" : "";
  }

  function closestFrom(node, selector) {
    return node && typeof node.closest === "function" ? node.closest(selector) : null;
  }

  function isEditable(element) {
    if (!element) return false;
    const tag = String(element.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    const node = el("button", className, label);
    node.setAttribute("type", "button");
    node.addEventListener("click", onClick);
    return node;
  }

  function mount() {
    if (state.root && state.root.isConnected) return state.parts;
    const root = el("aside", "halo-hud-card");
    root.id = "haloHud";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-labelledby", "haloHudBadge");
    root.setAttribute("aria-hidden", "true");
    root.hidden = true;
    const header = el("div", "halo-hud-header");
    const badge = el("span", "halo-hud-badge", "HALO GUIDE");
    badge.id = "haloHudBadge";
    const close = button("×", "halo-hud-close", () => hide({ restoreFocus: true }));
    close.setAttribute("aria-label", "Dismiss HALO guide");
    header.append(badge, close);
    const body = el("p", "halo-hud-body");
    body.id = "haloHudText";
    const list = el("ul", "halo-hud-list");
    list.hidden = true;
    const actionRow = el("div", "halo-hud-actions");
    const status = el("p", "halo-hud-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(header, body, list, actionRow, status);
    document.body.append(root);
    state.root = root;
    state.parts = { root, badge, close, body, list, actions: actionRow, status };
    return state.parts;
  }

  function setStatus(message) {
    if (state.parts) state.parts.status.textContent = message || "";
  }

  function clearPending() {
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
    state.pending = null;
  }

  function schedule(target) {
    if (!target || target === state.pending || (state.mode === "guide" && target === state.target)) return;
    clearPending();
    state.pending = target;
    state.timer = window.setTimeout(() => {
      const pending = state.pending;
      clearPending();
      if (pending && pending.isConnected !== false) show(pending);
    }, state.hesitationDelay);
  }

  function resolveTrackButton(target) {
    if (target.matches?.(PLAY_SELECTOR)) return target;
    const inside = target.querySelector?.(PLAY_SELECTOR);
    if (inside) return inside;
    const scope = closestFrom(target, SCOPE_SELECTOR);
    return scope?.querySelector?.(PLAY_SELECTOR) || null;
  }

  function normalizeIsrc(value) {
    const isrc = String(value || "").trim().toUpperCase();
    return ISRC_PATTERN.test(isrc) ? isrc : "";
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const field = el("textarea", "halo-hud-copy-buffer");
    field.value = text;
    field.setAttribute("readonly", "");
    document.body.append(field);
    field.select?.();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    field.remove?.();
    if (!copied) throw new Error("Clipboard unavailable");
  }

  actions.set("copy-isrc", target => {
    const raw = attr(target, "data-isrc").trim();
    if (!raw) return { note: "ISRC is pending for this release." };
    const isrc = normalizeIsrc(raw);
    if (!isrc) return { note: "This ISRC needs a format review before it can be copied." };
    return {
      buttons: [button(`Copy ISRC ${isrc}`, "halo-hud-btn", async () => {
        try {
          await copyText(isrc);
          setStatus(`ISRC ${isrc} copied.`);
          window.haloStats?.track?.("halo_hud_copy_isrc", { target: isrc });
        } catch {
          setStatus(`Copy blocked — select ${isrc} manually.`);
        }
      })]
    };
  });

  actions.set("quick-listen", target => {
    const playButton = resolveTrackButton(target);
    if (!playButton || playButton.disabled) return { note: "A direct preview isn't available for this release yet." };
    const title = attr(playButton, "data-title");
    return {
      buttons: [button(title ? `Quick listen · ${title}` : "Quick listen", "halo-hud-btn", () => {
        // Reuse the page's delegated play-track handler so the shared HaloPlayer singleton stays in charge.
        if (playButton.isConnected === false) {
          setStatus("This release was refreshed — press ▶ on it to listen.");
          return;
        }
        playButton.click();
        setStatus(title ? `Previewing ${title} in the HALO player.` : "Previewing in the HALO player.");
      })]
    };
  });

  function renderActions(target) {
    const { actions: row } = state.parts;
    row.replaceChildren();
    const type = attr(target, "data-halo-guide-action");
    const factory = type ? actions.get(type) : null;
    if (!factory) {
      row.hidden = true;
      return;
    }
    const result = factory(target) || {};
    const buttons = Array.isArray(result.buttons) ? result.buttons : [];
    if (buttons.length) row.append(...buttons);
    else if (result.note) row.append(el("span", "halo-hud-note", result.note));
    row.hidden = !buttons.length && !result.note;
  }

  function viewport() {
    return {
      width: window.innerWidth || document.documentElement?.clientWidth || 1024,
      height: window.innerHeight || document.documentElement?.clientHeight || 768
    };
  }

  function position() {
    const { root } = state.parts;
    if (state.mode !== "guide" || !state.target) {
      root.style.top = "";
      root.style.left = "";
      return;
    }
    const rect = state.target.getBoundingClientRect();
    const { width, height } = viewport();
    const card = root.getBoundingClientRect?.() || { width: 320, height: 160 };
    const cardWidth = card.width || 320;
    const cardHeight = card.height || 160;
    let top = rect.bottom + 10;
    if (top + cardHeight > height - 12 && rect.top - cardHeight - 10 > 12) top = rect.top - cardHeight - 10;
    const left = Math.min(Math.max(rect.left, 12), Math.max(12, width - cardWidth - 12));
    root.style.top = `${Math.max(12, Math.round(top))}px`;
    root.style.left = `${Math.round(left)}px`;
  }

  function open(mode) {
    const { root } = state.parts;
    state.mode = mode;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    root.classList.toggle("is-palette", mode === "palette");
    root.classList.add("is-visible");
    position();
  }

  function show(target) {
    const message = attr(target, "data-halo-guide").trim();
    if (!message || target.isConnected === false) return false;
    const parts = mount();
    clearPending();
    detachDescription();
    state.target = target;
    parts.badge.textContent = attr(target, "data-halo-guide-title") || "HALO GUIDE";
    parts.body.textContent = message;
    parts.list.hidden = true;
    parts.list.replaceChildren();
    setStatus("");
    renderActions(target);
    const describedBy = attr(target, "aria-describedby");
    if (!describedBy.split(/\s+/).includes("haloHudText")) {
      target.setAttribute("data-halo-hud-described", describedBy || " ");
      target.setAttribute("aria-describedby", `${describedBy} haloHudText`.trim());
    }
    open("guide");
    return true;
  }

  function detachDescription() {
    const target = state.target;
    if (!target || !target.hasAttribute?.("data-halo-hud-described")) return;
    const previous = attr(target, "data-halo-hud-described").trim();
    if (previous) target.setAttribute("aria-describedby", previous);
    else target.removeAttribute("aria-describedby");
    target.removeAttribute("data-halo-hud-described");
  }

  function openGuide() {
    const parts = mount();
    clearPending();
    detachDescription();
    state.returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    state.target = null;
    parts.badge.textContent = "HALO QUICK GUIDE";
    parts.body.textContent = "Your HALO concierge. Here's how to move around this page:";
    parts.list.replaceChildren(...QUICK_GUIDE.map(([label, copy]) => {
      const item = el("li", "halo-hud-list-item");
      item.append(el("strong", "", label), el("span", "", copy));
      return item;
    }));
    parts.list.hidden = false;
    parts.actions.replaceChildren();
    parts.actions.hidden = true;
    setStatus("");
    open("palette");
    parts.close.focus?.();
    window.haloStats?.track?.("halo_hud_quick_guide", { target: window.location?.pathname || "" });
  }

  function hide({ restoreFocus = false } = {}) {
    clearPending();
    if (!state.parts || state.mode === "closed") return;
    const { root } = state.parts;
    const focusInside = root.contains(document.activeElement);
    const returnTo = state.mode === "palette" ? state.returnFocus : state.target;
    detachDescription();
    root.classList.remove("is-visible", "is-palette");
    root.setAttribute("aria-hidden", "true");
    root.hidden = true;
    state.mode = "closed";
    state.target = null;
    state.returnFocus = null;
    if ((restoreFocus || focusInside) && returnTo && returnTo.isConnected !== false) returnTo.focus?.();
  }

  function toggleGuide() {
    if (state.mode === "palette") hide({ restoreFocus: true });
    else openGuide();
  }

  function focusActions() {
    const first = state.parts.actions.querySelector?.("button") || state.parts.close;
    first.focus?.();
  }

  document.addEventListener("mouseover", event => {
    const target = closestFrom(event.target, GUIDE_SELECTOR);
    if (target) schedule(target);
    else if (state.pending && !state.root?.contains(event.target)) clearPending();
  });

  document.addEventListener("mouseout", event => {
    const left = closestFrom(event.target, GUIDE_SELECTOR);
    if (!left || left !== state.pending) return;
    if (event.relatedTarget && left.contains(event.relatedTarget)) return;
    clearPending();
  });

  document.addEventListener("focusin", event => {
    if (state.root?.contains(event.target)) return;
    const target = closestFrom(event.target, GUIDE_SELECTOR);
    if (target) schedule(target);
    else clearPending();
  });

  document.addEventListener("focusout", event => {
    if (closestFrom(event.target, GUIDE_SELECTOR) === state.pending) clearPending();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (state.mode !== "closed") hide({ restoreFocus: true });
      else clearPending();
      return;
    }
    if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const active = document.activeElement;
    if (isEditable(active) || isEditable(event.target)) return;
    event.preventDefault();
    const focusedGuide = closestFrom(active, GUIDE_SELECTOR);
    if (focusedGuide && state.mode === "guide" && state.target === focusedGuide) {
      focusActions();
      return;
    }
    if (focusedGuide && state.mode !== "palette" && show(focusedGuide)) {
      focusActions();
      return;
    }
    toggleGuide();
  });

  document.addEventListener("click", event => {
    // Acting on a guided element is not hesitation; cancel the pending guide.
    if (state.pending && closestFrom(event.target, GUIDE_SELECTOR) === state.pending) clearPending();
    if (state.mode === "closed" || !state.root) return;
    if (state.root.contains(event.target)) return;
    hide();
  });

  const reposition = () => {
    if (state.mode !== "guide") return;
    if (!state.target || state.target.isConnected === false) hide();
    else position();
  };
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  if (typeof MutationObserver === "function") {
    // Re-renders (innerHTML swaps) can detach the active target; close instead of floating over stale content.
    new MutationObserver(() => {
      if (state.pending && state.pending.isConnected === false) clearPending();
      if (state.mode === "guide" && state.target && state.target.isConnected === false) hide();
    }).observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  window.HaloHud = {
    show,
    hide,
    openGuide,
    toggleGuide,
    registerAction(name, factory) {
      if (typeof name === "string" && name && typeof factory === "function") actions.set(name, factory);
    },
    isOpen: () => state.mode !== "closed",
    get mode() { return state.mode; },
    get target() { return state.target; },
    get hesitationDelay() { return state.hesitationDelay; },
    set hesitationDelay(value) {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) state.hesitationDelay = delay;
    }
  };
})();
