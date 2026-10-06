import { DNA_CATEGORIES, DNA_TERMS, DNA_AUDIENCES, DNA_RELATIONSHIPS,
  emptyDNA, validateDNA, projectDNA, suggestDNA, dnaFilters } from "./creative-dna.js";

function node(doc, tag, text = "") {
  const element = doc.createElement(tag);
  element.textContent = text;
  return element;
}
function select(doc, options, label, value = "") {
  const input = node(doc, "select");
  input.setAttribute("aria-label", label);
  for (const [id, name] of options) {
    const option = node(doc, "option", name);
    option.value = id;
    input.append(option);
  }
  input.value = value;
  return input;
}
function labelled(doc, label, input) {
  const wrapper = node(doc, "label", label);
  wrapper.append(input);
  return wrapper;
}
function button(doc, text, action) {
  const control = node(doc, "button", text);
  control.type = "button";
  control.addEventListener("click", action);
  return control;
}
export function renderCreativeDNA(container, items, { shared = false } = {}) {
  if (!items?.length) return;
  const doc = container.ownerDocument;
  if (shared) {
    container.append(node(doc, "p", `Shared interests: ${items.map(item => item.label).join(" · ")}`));
    return;
  }
  for (const [category, title] of Object.entries(DNA_CATEGORIES)) {
    const entries = items.filter(item => item.category === category);
    if (!entries.length) continue;
    const group = node(doc, "div");
    group.className = "dna-category";
    group.append(node(doc, "h3", title));
    const list = node(doc, "ul");
    entries.forEach(item => list.append(node(doc, "li", `${item.label}${item.relationship ? ` — ${item.relationship}` : ""}`)));
    group.append(list); container.append(group);
  }
}

export function mountDNAFilters(form) {
  const doc = form.ownerDocument, fieldset = node(doc, "fieldset");
  fieldset.className = "dna-filters";
  fieldset.append(node(doc, "legend", "Creative DNA (opt-in interests only)"));
  const category = select(doc, [["", "All categories"], ...Object.entries(DNA_CATEGORIES)], "Interest category");
  category.name = "interestCategory";
  const terms = select(doc, DNA_TERMS.filter(term => term.active).map(term => [term.id, `${DNA_CATEGORIES[term.category]}: ${term.label}`]), "Canonical interests (select one or more)");
  terms.name = "interests"; terms.multiple = true; terms.size = 4;
  // No selection means no interest filter, rather than the first canonical term.
  terms.selectedIndex = -1;
  const mode = select(doc, [["any", "Any selected interest"], ["all", "All selected interests"]], "Interest match mode", "any");
  mode.name = "interestMode";
  fieldset.append(labelled(doc, "Category", category), labelled(doc, "Interests", terms), labelled(doc, "Match", mode));
  form.append(fieldset);
  return {
    addTo(params) {
      const ids = [...terms.selectedOptions].map(option => option.value);
      params.set("interestCategory", category.value);
      params.set("interests", ids.join(","));
      params.set("interestMode", mode.value);
      dnaFilters(new URL(`https://halo.invalid/?${params}`));
      return params;
    }
  };
}

export function mountCreativeDNAEditor(container, { fetcher = (...args) => fetch(...args), onSaved = () => {} } = {}) {
  const doc = container.ownerDocument;
  let saved = emptyDNA(), draft = emptyDNA(), generation = 0, busy = false, loaded = false;
  let vocabulary = DNA_TERMS;
  const form = node(doc, "form");
  form.className = "creative-dna-editor";
  const message = node(doc, "p");
  message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
  const controls = node(doc, "fieldset");
  const enabled = node(doc, "input"); enabled.type = "checkbox";
  const discovery = node(doc, "input"); discovery.type = "checkbox";
  const audience = select(doc, DNA_AUDIENCES.map(value => [value, value]), "Maximum section audience", "private");
  controls.append(node(doc, "legend", "Display and discovery — separate choices"),
    labelled(doc, "Display Creative DNA", enabled), labelled(doc, "Maximum audience", audience),
    labelled(doc, "Allow canonical interests in discovery / shared-interest matching", discovery),
    node(doc, "p", "Private by default. Discovery never uses private items or custom labels. Manual editing and basic suggestions are always free; interests are not skill credentials."));
  const addControls = node(doc, "fieldset");
  addControls.append(node(doc, "legend", "Add interests — 24 total, 6 per category, 4 custom"));
  const category = select(doc, Object.entries(DNA_CATEGORIES), "New interest category", "sound");
  const canonical = select(doc, [], "Curated interest");
  const custom = node(doc, "input"); custom.maxLength = 48;
  custom.setAttribute("aria-label", "Custom interest (not indexed)");
  function updateTerms() {
    canonical.replaceChildren();
    vocabulary.filter(term => term.active && term.category === category.value).forEach(term => {
      const option = node(doc, "option", term.label); option.value = term.id; canonical.append(option);
    });
  }
  category.addEventListener("change", updateTerms); updateTerms();
  const items = node(doc, "fieldset"), preview = node(doc, "div");
  preview.setAttribute("aria-live", "polite");
  const previewAudience = select(doc, [["private", "Private / only you"], ["members", "Signed-in member"], ["public", "Public visitor"]], "Preview audience", "public");
  function showPreview() {
    preview.replaceChildren(node(doc, "h3", "Audience preview (unsaved draft)"),
      node(doc, "p", "Destination visibility, blocks and artist ownership can further restrict this preview."));
    const visible = previewAudience.value === "private" ? draft.items : projectDNA(draft, { viewer: previewAudience.value, vocabulary });
    renderCreativeDNA(preview, visible);
    if (!visible.length) preview.append(node(doc, "p", "No interests visible to this audience."));
  }
  function syncSettings() {
    draft.enabled = enabled.checked; draft.discovery = discovery.checked; draft.audience = audience.value;
    showPreview();
  }
  [enabled, discovery, audience].forEach(input => input.addEventListener("change", syncSettings));
  previewAudience.addEventListener("change", showPreview);
  function renderItems() {
    items.replaceChildren(node(doc, "legend", "Your interests"), node(doc, "p", `${draft.items.length}/24 assigned interests`));
    draft.items.forEach((item, index) => {
      const chip = node(doc, "div");
      chip.className = "dna-chip";
      const relation = select(doc, DNA_RELATIONSHIPS.map(value => [value, value || "No relationship"]), `${item.label}: relationship`, item.relationship);
      relation.addEventListener("change", () => { item.relationship = relation.value; showPreview(); });
      const visibility = select(doc, DNA_AUDIENCES.map(value => [value, value]), `${item.label}: item audience`, item.audience);
      visibility.addEventListener("change", () => { item.audience = visibility.value; showPreview(); });
      chip.append(node(doc, "span", `${item.label} · ${DNA_CATEGORIES[item.category]}${item.termId ? "" : " · custom / not indexed"}`),
        relation, visibility, button(doc, `Remove ${item.label}`, () => {
          draft.items.splice(index, 1); renderItems(); canonical.focus();
        }));
      items.append(chip);
    });
    showPreview();
  }
  function add(item) {
    try {
      draft = validateDNA({ ...draft, items: [...draft.items, { ...item, relationship: "", audience: "private" }] }, vocabulary);
      message.textContent = "Added to your private draft. Choose an audience and save when ready.";
      renderItems(); return true;
    } catch (error) { message.textContent = error.message; return false; }
  }
  addControls.append(labelled(doc, "Category", category), labelled(doc, "Curated term", canonical),
    button(doc, "Add curated interest", () => add({ termId: canonical.value })),
    labelled(doc, "Or a custom label (not searchable)", custom),
    button(doc, "Add custom interest", () => { if (add({ termId: null, category: category.value, label: custom.value })) custom.value = ""; }));

  const helper = node(doc, "fieldset");
  helper.append(node(doc, "legend", "Optional help organizing selected text"));
  const selectedText = node(doc, "textarea"); selectedText.maxLength = 3000; selectedText.rows = 3;
  const consent = node(doc, "input"); consent.type = "checkbox";
  const suggestions = node(doc, "div");
  helper.append(node(doc, "p", "Paste only text you choose. This basic helper matches curated aliases locally, not a live AI model. No browsing, inference, provider calls or text storage. Review each suggestion; nothing is published automatically."),
    labelled(doc, "Your selected text (up to 3,000 characters)", selectedText),
    labelled(doc, "I choose to organize this text with the local helper", consent));
  async function api(body) {
    const response = await fetcher("/api/creative-dna", {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.message || "Creative DNA unavailable."); error.status = response.status; throw error; }
    return result;
  }
  helper.append(button(doc, "Suggest interests", async () => {
    if (!consent.checked) { message.textContent = "Select your text and consent first."; return; }
    const current = generation;
    const text = selectedText.value;
    suggestions.replaceChildren();
    let candidates, method;
    try {
      const result = await api({ action: "suggest", consent: true, selectedText: text });
      candidates = result.suggestions; method = result.method;
    } catch {
      try { candidates = suggestDNA(text, vocabulary); }
      catch (error) { message.textContent = error.message; return; }
      method = "Offline fallback: identical local curated alias matching. No AI call.";
    }
    if (current !== generation) return;
    message.textContent = method;
    for (const candidate of candidates) {
      const row = node(doc, "div");
      row.append(node(doc, "span", `${candidate.label} · ${DNA_CATEGORIES[candidate.category]}`),
        button(doc, `Accept ${candidate.label}`, () => { if (add({ termId: candidate.termId })) row.remove(); }),
        button(doc, `Reject ${candidate.label}`, () => { row.remove(); message.textContent = "Suggestion rejected. Your draft is unchanged."; }));
      suggestions.append(row);
    }
    if (!candidates.length) suggestions.append(node(doc, "p", "No curated alias match. Add an interest manually; no traits have been inferred."));
  }), suggestions);
  const save = node(doc, "button", "Save Creative DNA"); save.type = "submit";
  function reset() {
    draft = structuredClone(saved); enabled.checked = draft.enabled; discovery.checked = draft.discovery;
    audience.value = draft.audience; selectedText.value = ""; consent.checked = false;
    suggestions.replaceChildren(); renderItems();
  }
  const cancel = button(doc, "Cancel changes", () => { reset(); message.textContent = "Unsaved changes discarded."; });
  const reload = button(doc, "Discard draft and reload latest", () => load());
  reload.hidden = true;
  form.append(controls, addControls, items, labelled(doc, "Preview", previewAudience), preview, helper, save, cancel, reload, message);
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !loaded) return;
    const current = generation;
    busy = true; controls.disabled = addControls.disabled = helper.disabled = items.disabled = save.disabled = cancel.disabled = true;
    try {
      syncSettings();
      const result = await api({ action: "save", dna: validateDNA(draft, vocabulary) });
      if (current !== generation) return;
      saved = result.dna; reset(); reload.hidden = true;
      message.textContent = "Creative DNA saved. Current privacy applies on all destinations.";
      await onSaved();
    } catch (error) {
      if (current !== generation) return;
      message.textContent = error.message;
      reload.hidden = error.status !== 409;
      if (error.status === 409) message.textContent += " Your draft is retained. Copy any changes you want to keep, then reload the latest revision.";
    } finally {
      if (current === generation) { busy = false; controls.disabled = addControls.disabled = helper.disabled = items.disabled = save.disabled = cancel.disabled = false; }
    }
  });
  container.append(form);
  async function load() {
    const current = ++generation;
    loaded = false; busy = false; form.hidden = false; save.disabled = true;
    message.textContent = "Loading your Creative DNA…";
    try {
      const result = await api();
      if (current !== generation) return;
      vocabulary = result.vocabulary || DNA_TERMS;
      // Retired assignments remain owner-editable for removal, never public or searchable.
      saved = validateDNA(result.dna, vocabulary.map(term => ({ ...term, active: true })));
      updateTerms(); reset(); loaded = true; save.disabled = false; reload.hidden = true;
      controls.disabled = addControls.disabled = helper.disabled = items.disabled = cancel.disabled = false;
      message.textContent = "Private defaults. Changing display never opts you into matching.";
    } catch (error) { if (current === generation) message.textContent = error.message; }
  }
  form.hidden = true;
  return { load, clear() {
    generation++; busy = false; loaded = false; saved = emptyDNA(); vocabulary = DNA_TERMS; updateTerms(); reset();
    form.hidden = true; message.textContent = "";
  } };
}
