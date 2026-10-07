import { createDiscoveryPreferences, discoveryMatches, DISCOVERY_GENRES, normalizeTag } from "./network-discovery.js";
import { creatorQuickCards } from "./creator-quick-card.js";

export function mountDiscoveryControls({ doc = globalThis.document, root, input, pills, count, reset, clear, namespace,
  allowedTags = DISCOVERY_GENRES, onChange = () => {}, preferences = true }) {
  const storage = createDiscoveryPreferences(namespace, { allowedTags });
  const selectableTags = new Set(allowedTags.map(normalizeTag));
  const state = preferences ? storage.read() : { query: "", tags: [] };
  const previews = creatorQuickCards(doc);
  let records = [], persist = preferences;
  let pillControls = new Map();
  input.value = state.query;
  const button = (text, run, key) => {
    const item = doc.createElement("button"); item.type = "button"; item.textContent = text;
    pillControls.set(key, item);
    item.addEventListener("click", run); return item;
  };
  function renderPills() {
    const focusedKey = [...pillControls].find(([, control]) => control === doc.activeElement)?.[0];
    pillControls = new Map();
    pills.replaceChildren();
    if (state.query) pills.append(button(`Search: ${state.query} ×`, () => { state.query = ""; input.value = ""; update(); input.focus(); }, "query"));
    for (const tag of state.tags) pills.append(button(`#${tag} ×`, () => { state.tags = state.tags.filter(value => value !== tag); update(); }, `remove:${tag}`));
    const options = new Map();
    for (const record of records.filter(record => !record.allowed || record.allowed())) for (const tag of record.tags) {
      const normalized = normalizeTag(tag);
      if (selectableTags.has(normalized) && normalized.length <= 48 && !options.has(normalized) && options.size < 24) options.set(normalized, String(tag).replace(/^#/, ""));
    }
    for (const [tag, label] of options) {
      const control = button(label, () => {
        state.tags = state.tags.includes(tag) ? state.tags.filter(value => value !== tag) : [...state.tags, tag].slice(0, 12);
        update();
      }, `tag:${tag}`);
      control.setAttribute("aria-pressed", String(state.tags.includes(tag))); pills.append(control);
    }
    if (focusedKey && !doc.querySelector('dialog[open], [aria-modal="true"]')) (pillControls.get(focusedKey) || input).focus?.();
  }
  function apply() {
    previews.close();
    let shown = 0;
    for (const record of records) {
      const visible = (!record.allowed || record.allowed()) && discoveryMatches(record.text, record.tags, state);
      record.element.hidden = !visible;
      if (visible) shown++;
      else {
        if (record.element.contains(doc.activeElement) && !doc.querySelector('dialog[open], [aria-modal="true"]')) input.focus();
        for (const media of record.element.querySelectorAll("audio, video")) media.pause();
        for (const frame of record.element.querySelectorAll("iframe")) {
          if (frame.hasAttribute("src")) { frame.dataset.filteredSrc = frame.getAttribute("src"); frame.removeAttribute("src"); }
        }
      }
      if (visible) for (const frame of record.element.querySelectorAll("iframe[data-filtered-src]")) {
        frame.src = frame.dataset.filteredSrc; delete frame.dataset.filteredSrc;
      }
    }
    count.textContent = `${shown} of ${records.filter(record => !record.allowed || record.allowed()).length} loaded results · Search covers loaded results only${shown ? "" : ". No matches; reset filters or load more when available."}`;
    renderPills();
  }
  function update() { state.query = input.value.slice(0, 120); if (persist) storage.write(state); apply(); onChange(state); }
  input.addEventListener("input", update);
  clear.addEventListener("click", () => { input.value = ""; update(); input.focus(); });
  reset.addEventListener("click", () => {
    storage.reset(); state.query = ""; state.tags = []; input.value = ""; apply(); onChange(state); input.focus();
    doc.defaultView?.haloStats?.track?.("discovery_filters_reset", { context: namespace });
  });
  return {
    state, apply,
    setRecords(next) { records = next; apply(); },
    setPersistence(value) { persist = preferences && value; if (!persist) storage.cancel(); },
    clearSession() { storage.cancel(); state.query = ""; state.tags = []; input.value = ""; records = []; apply(); },
    root
  };
}
