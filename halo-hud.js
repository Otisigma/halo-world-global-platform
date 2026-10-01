/**
 * Halo Guid — HALO's proactive guidance layer
 *
 * Additive, sitewide guidance layer:
 * - `data-halo-guide="…"` on any element shows a floating guide after hover/focus hesitation.
 * - `data-halo-guide-action="copy-isrc"` (with `data-isrc`) adds a copy-to-clipboard action.
 * - `data-halo-guide-action="quick-listen"` adds a preview action that reuses the page's own
 *   play-track button (and therefore the shared window.HaloPlayer singleton).
 * - `?` toggles the Halo Guid quick-guide spotlight that also lists this page's titled guides
 *   (`data-halo-guide-title`) as jump targets; Escape or an outside click dismisses the HUD.
 * - The quick guide has a search field that filters those jump targets plus the HUD actions
 *   available on the page (listen, vote, copy ISRC, compare tiers, vault status via
 *   `data-halo-vault-status`). Arrow keys move the selection, Enter activates it.
 * - `HaloGuid.registerAction(name, factory)` adds future action variants;
 *   `HaloGuid.computePlacement()` is the shared viewport-safe placement helper.
 *
 * All listeners are delegated at document level, so late-loaded and re-rendered content
 * (innerHTML swaps) is covered without re-binding. The engine never cancels or halts
 * page clicks, so navigation, player and shop handlers keep working.
 */
(() => {
  "use strict";
  if (window.HaloGuid || window.HaloHud) {
    const existing = window.HaloGuid || window.HaloHud;
    window.HaloGuid = existing;
    window.HaloHud = existing;
    return;
  }

  const GUIDE_SELECTOR = "[data-halo-guide]";
  const SCOPE_SELECTOR = "[data-halo-guide-scope]";
  const PLAY_SELECTOR = '[data-action="play-track"]';
  const ISRC_PATTERN = /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/;
  const JUMP_LIMIT = 6;
  const COMMANDS = [
    {
      id: "listen",
      keywords: "listen play preview stream quick track",
      find: () => findVisible(PLAY_SELECTOR, node => !node.disabled),
      label: node => (attr(node, "data-title") ? `Listen · ${attr(node, "data-title")}` : "Listen"),
      run: node => {
        hide();
        node.click();
      }
    },
    {
      id: "vote",
      keywords: "vote signal +1 chart leader rotation",
      find: () => findVisible("[data-featured-vote]", node => !node.disabled),
      label: () => "Vote for the chart leader",
      run: node => {
        hide();
        node.click();
      }
    },
    {
      id: "copy-isrc",
      keywords: "copy isrc recording identifier code",
      find: () => findVisible("[data-isrc]", node => normalizeIsrc(attr(node, "data-isrc"))),
      label: node => `Copy ISRC ${normalizeIsrc(attr(node, "data-isrc"))}`,
      run: async node => {
        const isrc = normalizeIsrc(attr(node, "data-isrc"));
        try {
          await copyText(isrc);
          setStatus(`ISRC ${isrc} copied.`);
          window.haloStats?.track?.("halo_hud_copy_isrc", { target: isrc });
        } catch {
          setStatus(`Copy blocked — select ${isrc} manually.`);
        }
      }
    },
    {
      id: "compare-tiers",
      keywords: "compare tiers licence license licensing buy commercial sync personal",
      find: () => findVisible("[data-licensing-panel]"),
      label: () => "Compare licence tiers",
      run: node => jumpTo(node)
    },
    {
      id: "vault-status",
      keywords: "vault status master upload drive stems",
      find: () => findVisible("[data-halo-vault-status]"),
      label: () => "Vault status",
      run: node => jumpTo(node)
    }
  ];
  const QUICK_GUIDE = [
    ["Listen", "Press ▶ on any release or chart row to stream it in the HALO player bar while you keep browsing."],
    ["Vote", "Use Vote ▲ on the featured chart leader to push it up the Living Chart — one vote per listener per day."],
    ["Buy & license", "Buy links open the artist-approved destination. Licence selections are approval-gated by the artist team."],
    ["ISRC", "Pause on or focus an ISRC to copy the official recording identifier in one click."],
    ["Halo Guid", "Pause on an element marked for Halo Guid to see its guidance. Press ? while focused to open its available action."],
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
    parts: null,
    guides: [],
    commands: [],
    items: [],
    active: -1
  };
  let optionId = 0;
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
    const badge = el("span", "halo-hud-badge", "HALO GUID");
    badge.id = "haloHudBadge";
    const close = button("×", "halo-hud-close", () => hide({ restoreFocus: true }));
    close.setAttribute("aria-label", "Dismiss Halo Guid");
    header.append(badge, close);
    const body = el("p", "halo-hud-body");
    body.id = "haloHudText";
    const list = el("ul", "halo-hud-list");
    list.hidden = true;
    const actionRow = el("div", "halo-hud-actions");
    const searchRow = el("div", "halo-hud-search");
    searchRow.hidden = true;
    const search = el("input", "halo-hud-search-input");
    search.id = "haloHudSearch";
    search.setAttribute("type", "text");
    search.setAttribute("role", "combobox");
    search.setAttribute("aria-autocomplete", "list");
    search.setAttribute("aria-controls", "haloHudResults");
    search.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-label", "Search Halo Guid and page actions");
    search.setAttribute("placeholder", "Search Halo Guid & actions…");
    search.setAttribute("autocomplete", "off");
    search.setAttribute("spellcheck", "false");
    search.addEventListener("input", () => renderResults());
    search.addEventListener("keydown", onSearchKey);
    searchRow.append(search);
    const results = el("div", "halo-hud-results");
    results.id = "haloHudResults";
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", "Halo Guid results");
    results.hidden = true;
    const jumps = el("div", "halo-hud-jumps");
    jumps.setAttribute("role", "group");
    jumps.setAttribute("aria-label", "Guides on this page");
    jumps.hidden = true;
    const commands = el("div", "halo-hud-commands");
    commands.setAttribute("role", "group");
    commands.setAttribute("aria-label", "Halo Guid actions");
    commands.hidden = true;
    results.append(jumps, commands);
    const empty = el("p", "halo-hud-empty");
    empty.hidden = true;
    const status = el("p", "halo-hud-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(header, searchRow, body, list, actionRow, results, empty, status);
    document.body.append(root);
    state.root = root;
    state.parts = { root, badge, close, body, list, actions: actionRow, searchRow, search, results, jumps, commands, empty, status };
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

  // Pure placement helper: prefer below the target, flip above when it fits better,
  // and always clamp the card fully inside the viewport (with a safe margin).
  function computePlacement(rect, card, view, { gap = 10, margin = 12 } = {}) {
    const cardWidth = Number(card?.width) || 320;
    const cardHeight = Number(card?.height) || 160;
    const width = Number(view?.width) || 1024;
    const height = Number(view?.height) || 768;
    const below = rect.bottom + gap;
    const above = rect.top - cardHeight - gap;
    const fitsBelow = below + cardHeight <= height - margin;
    const fitsAbove = above >= margin;
    const placement = !fitsBelow && fitsAbove ? "above" : "below";
    const clamp = (value, max) => Math.round(Math.min(Math.max(value, margin), Math.max(margin, max)));
    return {
      placement,
      top: clamp(placement === "above" ? above : below, height - cardHeight - margin),
      left: clamp(rect.left, width - cardWidth - margin)
    };
  }

  function position() {
    const { root } = state.parts;
    if (state.mode !== "guide" || !state.target) {
      root.style.top = "";
      root.style.left = "";
      root.removeAttribute("data-placement");
      return;
    }
    const card = root.getBoundingClientRect?.() || {};
    const { top, left, placement } = computePlacement(state.target.getBoundingClientRect(), card, viewport());
    root.style.top = `${top}px`;
    root.style.left = `${left}px`;
    root.setAttribute("data-placement", placement);
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
    const title = attr(target, "data-halo-guide-title").trim();
    parts.badge.textContent = title ? `HALO GUID · ${title}` : "HALO GUID";
    parts.body.textContent = message;
    parts.list.hidden = true;
    parts.list.replaceChildren();
    resetSearch(parts);
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

  function pageGuides() {
    const seen = new Set();
    const found = [];
    for (const node of document.querySelectorAll?.(GUIDE_SELECTOR) || []) {
      const title = attr(node, "data-halo-guide-title").trim();
      if (!title || seen.has(title) || node.isConnected === false) continue;
      if (!isVisible(node)) continue;
      seen.add(title);
      found.push([title, node]);
    }
    return found;
  }

  function jumpTo(target) {
    hide();
    // Defer until the jump click has finished bubbling, so the outside-click handler
    // never sees the freshly opened guide.
    window.setTimeout(() => {
      if (!target || target.isConnected === false) return;
      target.scrollIntoView?.({ block: "center", behavior: "smooth" });
      if (show(target)) {
        target.focus?.({ preventScroll: true });
        window.haloStats?.track?.("halo_hud_jump", { target: attr(target, "data-halo-guide-title") });
      }
    }, 0);
  }

  function isVisible(node) {
    return Boolean(node) && node.isConnected !== false && !state.root?.contains(node) && !closestFrom(node, "[hidden]");
  }

  function findVisible(selector, accept = () => true) {
    for (const node of document.querySelectorAll?.(selector) || []) {
      if (isVisible(node) && accept(node)) return node;
    }
    return null;
  }

  function availableCommands() {
    const found = [];
    for (const command of COMMANDS) {
      const target = command.find();
      if (target) found.push({ command, target, label: command.label(target) });
    }
    return found;
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function wordsOf(text) {
    return text.split(/[^a-z0-9+#]+/).filter(Boolean);
  }

  function isSubsequence(query, text) {
    let index = 0;
    for (const char of text) {
      if (char === query[index]) index += 1;
      if (index === query.length) return true;
    }
    return false;
  }

  // Ranks a candidate: 4 = label prefix, 3 = word prefixes, 2 = substring, 1 = keyword or fuzzy hit, 0 = no match.
  function matchScore(query, label, extra = "") {
    if (!query) return 1;
    const text = normalize(label);
    if (text.startsWith(query)) return 4;
    const words = wordsOf(text);
    const tokens = query.split(" ");
    const prefixed = pool => tokens.every(token => pool.some(word => word.startsWith(token)));
    if (prefixed(words)) return 3;
    if (text.includes(query)) return 2;
    if (prefixed(words.concat(wordsOf(normalize(extra))))) return 1;
    return query.length >= 2 && isSubsequence(query.replace(/ /g, ""), text.replace(/ /g, "")) ? 1 : 0;
  }

  function rank(entries, query) {
    return entries
      .map((entry, index) => ({ entry, index, score: matchScore(query, entry.label, entry.extra) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, JUMP_LIMIT)
      .map(({ entry, score }) => ({ ...entry, score }));
  }

  function option(label, className, onClick) {
    const node = button(label, className, onClick);
    optionId += 1;
    node.id = `haloHudOption${optionId}`;
    node.setAttribute("role", "option");
    node.setAttribute("tabindex", "-1");
    node.setAttribute("aria-selected", "false");
    return node;
  }

  function renderGroup(container, heading, entries) {
    container.replaceChildren();
    container.hidden = !entries.length;
    if (!entries.length) return [];
    const label = el("span", "halo-hud-jumps-label", heading);
    label.setAttribute("aria-hidden", "true");
    const buttons = entries.map(entry => entry.render());
    container.append(label, ...buttons);
    return buttons;
  }

  function renderResults() {
    const parts = state.parts;
    const raw = String(parts.search.value || "");
    const query = normalize(raw);
    const guides = rank(state.guides.map(([title, target]) => ({
      label: title,
      extra: attr(target, "data-halo-guide"),
      render: () => option(title, "halo-hud-jump", () => jumpTo(target))
    })), query);
    const commands = rank(state.commands.map(({ command, target, label }) => ({
      label,
      extra: command.keywords,
      render: () => option(label, "halo-hud-jump halo-hud-command", () => runCommand(command, target))
    })), query);
    const items = [
      ...renderGroup(parts.jumps, "On this page", guides),
      ...renderGroup(parts.commands, "Halo Guid actions", commands)
    ];
    const scores = guides.concat(commands).map(entry => entry.score);
    state.items = items;
    parts.results.hidden = !items.length;
    parts.search.setAttribute("aria-expanded", String(items.length > 0));
    parts.list.hidden = Boolean(query);
    parts.empty.hidden = !(query && !items.length);
    parts.empty.textContent = parts.empty.hidden ? "" : `No guides or actions match “${raw.trim()}”. Try listen, vote, ISRC or licence.`;
    // Preselect the strongest match across both groups so Enter runs what the user most likely meant.
    state.active = query && items.length ? scores.indexOf(Math.max(...scores)) : -1;
    updateActive();
  }

  function updateActive() {
    const { search } = state.parts;
    state.items.forEach((item, index) => {
      const on = index === state.active;
      item.classList.toggle("is-active", on);
      item.setAttribute("aria-selected", String(on));
    });
    const current = state.items[state.active];
    if (current) {
      search.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView?.({ block: "nearest" });
    } else {
      search.removeAttribute("aria-activedescendant");
    }
  }

  function onSearchKey(event) {
    if (event.isComposing) return;
    const count = state.items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!count) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      state.active = state.active < 0 ? (step > 0 ? 0 : count - 1) : (state.active + step + count) % count;
      updateActive();
    } else if (event.key === "Enter") {
      const current = state.items[state.active];
      if (!current) return;
      event.preventDefault();
      current.click();
    }
  }

  function runCommand(command, target) {
    if (!target || target.isConnected === false) {
      setStatus("That action is no longer available — the page was refreshed.");
      return;
    }
    window.haloStats?.track?.("halo_hud_command", { target: command.id });
    command.run(target);
  }

  function resetSearch(parts) {
    parts.search.value = "";
    parts.search.removeAttribute("aria-activedescendant");
    parts.search.setAttribute("aria-expanded", "false");
    parts.searchRow.hidden = true;
    parts.results.hidden = true;
    parts.jumps.hidden = true;
    parts.jumps.replaceChildren();
    parts.commands.hidden = true;
    parts.commands.replaceChildren();
    parts.empty.hidden = true;
    parts.empty.textContent = "";
    state.guides = [];
    state.commands = [];
    state.items = [];
    state.active = -1;
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
    parts.badge.textContent = "HALO GUID · QUICK GUIDE";
    parts.body.textContent = "Halo Guid is your on-page concierge. Here's how to move around this page:";
    parts.list.replaceChildren(...QUICK_GUIDE.map(([label, copy]) => {
      const item = el("li", "halo-hud-list-item");
      item.append(el("strong", "", label), el("span", "", copy));
      return item;
    }));
    parts.list.hidden = false;
    parts.actions.replaceChildren();
    parts.actions.hidden = true;
    resetSearch(parts);
    parts.searchRow.hidden = false;
    state.guides = pageGuides();
    state.commands = availableCommands();
    renderResults();
    setStatus("");
    open("palette");
    parts.search.focus?.();
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
    // An empty quick-guide search keeps `?` as the spotlight toggle; once typing starts it is just text.
    const emptySearch = state.mode === "palette" && active === state.parts?.search && !active.value;
    if (!emptySearch && (isEditable(active) || isEditable(event.target))) return;
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

  const api = {
    show,
    hide,
    openGuide,
    computePlacement,
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
  window.HaloGuid = api;
  window.HaloHud = api;
})();
