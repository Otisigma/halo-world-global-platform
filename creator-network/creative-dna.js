import { DNA_DIMENSIONS, DNA_LIMITS } from "../lib/creative-dna.js";

export const DIMENSIONS = DNA_DIMENSIONS;
export const TEXT_LIMITS = Object.fromEntries(
  ["creativeStatement", "creativeGoals", "workflowNotes"].map(name => [name, DNA_LIMITS[name]])
);

export function element(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

export async function dnaRequest(query = "", body, signal) {
  const response = await fetch(`/api/creator-network${query}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", signal,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || "Creative DNA is unavailable. Please try again.");
    error.status = response.status;
    error.fields = data.errors || data.fieldErrors;
    throw error;
  }
  return data;
}

function button(text, handler) {
  const control = element("button", text);
  control.type = "button";
  control.className = "button button-outline";
  control.addEventListener("click", handler);
  return control;
}

export function localSuggestions(statement, terms, selected = []) {
  const text = statement.toLocaleLowerCase();
  return terms.filter(term => !selected.includes(term.id) &&
    [term.label, term.key?.replaceAll("_", " "), ...(term.aliases || [])]
      .some(word => word && text.includes(word.toLocaleLowerCase())));
}

export function mountTagEditor(root, { terms = [], selected = [], cap = DNA_LIMITS.perDimension, onChange = () => {} } = {}) {
  let ids = [...new Set(selected)].filter(id => terms.some(term => term.id === id));
  const selects = new Map();
  root.replaceChildren();
  const groups = new Map();
  const notice = element("p");
  notice.setAttribute("role", "status");
  for (const [dimension, label] of Object.entries(DIMENSIONS)) {
    const group = element("fieldset"), legend = element("legend", label);
    const chips = element("div"), select = element("select"), selectLabel = element("label", `Add ${label.toLowerCase()}`);
    chips.className = "dna-chips";
    selectLabel.append(select);
    group.append(legend, chips, selectLabel);
    root.append(group);
    groups.set(dimension, { chips, legend });
    selects.set(dimension, select);
    select.addEventListener("change", () => {
      const id = select.value;
      if (id) add(id);
    });
  }
  root.append(notice);
  function render() {
    for (const [dimension, { chips, legend }] of groups) {
      const chosen = terms.filter(term => term.dimension === dimension && ids.includes(term.id));
      legend.textContent = `${DIMENSIONS[dimension]} · ${chosen.length}/${cap}`;
      chips.replaceChildren(...chosen.map(term => {
        const chip = button(`${term.label} ×`, () => {
          ids = ids.filter(id => id !== term.id);
          render();
          onChange([...ids]);
          selects.get(dimension).focus();
        });
        chip.setAttribute("aria-label", `Remove ${term.label}`);
        return chip;
      }));
      const select = selects.get(dimension);
      select.replaceChildren(element("option", chosen.length >= cap ? "Tag limit reached" : "Choose a tag"));
      for (const term of terms.filter(term => term.dimension === dimension && !ids.includes(term.id))) {
        const option = element("option", term.label);
        option.value = term.id;
        select.append(option);
      }
      select.disabled = chosen.length >= cap;
    }
  }
  function add(id) {
    const term = terms.find(item => item.id === id);
    if (!term || ids.includes(id)) return false;
    if (ids.filter(value => terms.find(item => item.id === value)?.dimension === term.dimension).length >= cap) {
      notice.textContent = `Choose at most ${cap} ${DIMENSIONS[term.dimension].toLowerCase()} tags.`;
      return false;
    }
    ids.push(id);
    notice.textContent = "";
    render();
    onChange([...ids]);
    return true;
  }
  render();
  return { add, values: () => [...ids] };
}

export function renderDNASummary(root, dna = {}, terms = []) {
  root.replaceChildren();
  if (dna.creativeStatement) root.append(element("p", dna.creativeStatement));
  if (dna.creativeGoals) root.append(element("p", dna.creativeGoals));
  for (const [dimension, label] of Object.entries(DIMENSIONS)) {
    const selected = terms.filter(term => term.dimension === dimension && (dna.termIds || []).includes(term.id));
    if (!selected.length) continue;
    const group = element("section"), chips = element("div");
    chips.className = "dna-chips";
    group.append(element("h4", label), chips);
    selected.forEach(term => {
      const chip = element("span", term.label);
      chip.className = "dna-chip";
      chips.append(chip);
    });
    root.append(group);
  }
}

function modal(title, description) {
  const dialog = element("dialog");
  dialog.className = "dna-dialog";
  const id = `dna-dialog-${++modal.sequence}`;
  const heading = element("h2", title), help = element("p", description);
  heading.id = `${id}-title`;
  help.id = `${id}-description`;
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.setAttribute("aria-describedby", help.id);
  dialog.append(heading, help);
  document.body.append(dialog);
  let opener;
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    if (opener?.isConnected) opener.focus();
  });
  return {
    dialog,
    open() { opener = document.activeElement; dialog.showModal(); },
    close() { if (dialog.open) dialog.close(); }
  };
}
modal.sequence = 0;

export function mountCreativeDNAEditor(root, { request = dnaRequest, confirmDiscard = () => window.confirm("Discard unsaved Creative DNA changes?") } = {}) {
  if (!root) return { load() {}, clear() {} };
  const summary = element("div"), status = element("p");
  status.setAttribute("role", "status");
  const tune = button("Tune Creative DNA", open);
  tune.disabled = true;
  root.replaceChildren(tune, status, summary);
  let record, generation = 0, controller, dirty = false, saving = false, tags;
  const shell = modal("Tune Creative DNA", "Only what you explicitly enter is used. Workflow notes always stay private. No Signal or private project import.");
  const form = element("form"), fields = {}, errors = {}, suggestions = element("div");
  for (const [name, label] of Object.entries({
    creativeStatement: "Creative statement", creativeGoals: "Creative goals", workflowNotes: "Workflow notes (private)"
  })) {
    const wrapper = element("label", label), input = element("textarea"), count = element("span"), error = element("span");
    input.name = name;
    input.maxLength = TEXT_LIMITS[name];
    error.id = `dna-error-${name}`;
    count.id = `dna-count-${name}`;
    input.setAttribute("aria-describedby", `${count.id} ${error.id}`);
    error.className = "dna-error";
    wrapper.append(input, count, error);
    form.append(wrapper);
    fields[name] = input;
    errors[name] = error;
    input.addEventListener("input", () => {
      dirty = true;
      count.textContent = `${input.value.length}/${TEXT_LIMITS[name]}`;
      if (name === "creativeStatement") suggest();
    });
    input.updateCount = () => { count.textContent = `${input.value.length}/${TEXT_LIMITS[name]}`; };
  }
  const visibilityLabel = element("label", "Visibility"), visibility = element("select"), preview = element("p");
  for (const [value, label] of [["private", "Private — only you"], ["members", "Members — signed-in creators"], ["public", "Public — anyone"]]) {
    const option = element("option", label);
    option.value = value;
    visibility.append(option);
  }
  visibilityLabel.append(visibility);
  const tagRoot = element("div"), feedback = element("p");
  feedback.setAttribute("role", "status");
  const save = element("button", "Save Creative DNA");
  save.type = "submit";
  save.className = "button button-gold";
  const cancel = button("Cancel", cancelEdit);
  const reload = button("Reload saved version (discard edits)", () => {
    if (dirty && !confirmDiscard()) return;
    dirty = false;
    shell.close();
    load();
  });
  reload.hidden = true;
  form.append(visibilityLabel, preview, tagRoot, element("h3", "Local vocabulary suggestions — not AI analysis"), suggestions, feedback, save, cancel, reload);
  shell.dialog.append(form);
  function visibilityPreview() {
    preview.textContent = visibility.value === "public"
      ? (record?.profile?.discoverable ? "Preview: public statement, goals and tags. Workflow notes remain private." : "Public DNA requires public discovery on your saved Creator Pass.")
      : `${visibility.value === "members" ? "Signed-in creators" : "Only you"} can see statement, goals and tags. Workflow notes remain private.`;
  }
  visibility.addEventListener("change", () => { dirty = true; visibilityPreview(); });
  shell.dialog.addEventListener("cancel", event => { event.preventDefault(); cancelEdit(); });
  function cancelEdit() {
    if (dirty && !confirmDiscard()) return;
    dirty = false;
    generation++;
    controller?.abort();
    saving = false;
    save.disabled = false;
    shell.close();
  }
  function suggest() {
    suggestions.replaceChildren(...localSuggestions(fields.creativeStatement.value, record?.terms || [], tags?.values()).map(term =>
      button(`Accept ${term.label}`, () => { tags.add(term.id); suggest(); })));
  }
  function open() {
    if (!record?.profile || saving) return;
    const dna = record.dna || {};
    for (const [name, input] of Object.entries(fields)) {
      input.value = dna[name] || "";
      input.updateCount();
      errors[name].textContent = "";
      input.removeAttribute("aria-invalid");
    }
    visibility.value = dna.visibility || "private";
    tags = mountTagEditor(tagRoot, { terms: record.terms, selected: dna.termIds, onChange() { dirty = true; suggest(); } });
    feedback.textContent = "";
    reload.hidden = true;
    dirty = false;
    suggest();
    visibilityPreview();
    shell.open();
    fields.creativeStatement.focus();
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    if (visibility.value === "public" && !record.profile.discoverable) {
      feedback.textContent = "Save your Creator Pass with public discovery enabled first.";
      visibility.focus();
      return;
    }
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    saving = true;
    save.disabled = true;
    feedback.textContent = "Saving…";
    const body = { action: "save_dna", visibility: visibility.value, expectedRevision: record.dna?.revision ?? 0, termIds: tags.values() };
    for (const [name, input] of Object.entries(fields)) body[name] = input.value;
    try {
      const result = await request("", body, controller.signal);
      if (version !== generation) return;
      record.dna = result.dna;
      dirty = Object.entries(fields).some(([name, input]) => input.value !== body[name]) ||
        visibility.value !== body.visibility || JSON.stringify(tags.values()) !== JSON.stringify(body.termIds);
      renderDNASummary(summary, record.dna, record.terms);
      status.textContent = result.message || "Creative DNA saved.";
      if (dirty) feedback.textContent = "Submitted version saved. Your newer edits are retained; save again to publish them.";
      else shell.close();
    } catch (error) {
      if (version !== generation) return;
      feedback.textContent = error.status === 409
        ? "A newer version was saved elsewhere. Your edits are retained. Reload the saved version to resolve the conflict."
        : error.message;
      reload.hidden = error.status !== 409;
      for (const [name, node] of Object.entries(errors)) {
        const message = error.fields?.[name];
        node.textContent = message ? String(message) : "";
        fields[name].setAttribute("aria-invalid", message ? "true" : "false");
      }
    } finally {
      if (version === generation) { saving = false; save.disabled = false; }
    }
  });
  async function load() {
    if (saving) return;
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    status.textContent = "Loading Creative DNA…";
    try {
      const data = await request("?view=dna", undefined, controller.signal);
      if (version !== generation) return;
      const preserveEdits = dirty;
      if (preserveEdits && record) record.profile = data.profile;
      else record = data;
      tune.disabled = !data.profile;
      status.textContent = preserveEdits ? "Your unsaved edits are retained."
        : data.profile ? "Choose what to share." : "Save your Creator Pass first to tune Creative DNA.";
      renderDNASummary(summary, data.dna || {}, data.terms);
      if (preserveEdits) visibilityPreview();
    } catch (error) {
      if (version === generation) status.textContent = error.message;
    }
  }
  return {
    load,
    clear() {
      generation++;
      controller?.abort();
      record = null;
      dirty = false;
      saving = false;
      save.disabled = false;
      tune.disabled = true;
      shell.close();
      summary.replaceChildren();
      tagRoot.replaceChildren();
      suggestions.replaceChildren();
      for (const input of Object.values(fields)) input.value = "";
      for (const error of Object.values(errors)) error.textContent = "";
      visibility.value = "private";
      preview.textContent = "";
      feedback.textContent = "";
      status.textContent = "";
    }
  };
}

export function safeReleaseURL(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === window.location.origin)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function mountDNAVisitor({ request = dnaRequest, signedIn = () => false, onClose = () => {} } = {}) {
  const shell = modal("Creator profile", "Creative DNA shared by this creator. Collaboration does not grant rights or private media access.");
  const content = element("div"), notice = element("p");
  notice.setAttribute("role", "status");
  shell.dialog.append(content, notice, button("Close profile", () => shell.close()));
  let generation = 0, controller;
  shell.dialog.addEventListener("close", () => {
    // Native close events are queued: an old close must not cancel a reopened profile.
    if (shell.dialog.open) return;
    generation++;
    controller?.abort();
    content.replaceChildren();
    onClose();
  });
  async function open(id, terms = []) {
    clear();
    const version = ++generation;
    controller = new AbortController();
    notice.textContent = "Loading profile…";
    shell.open();
    try {
      const data = await request(`?view=dna_profile&profile=${encodeURIComponent(id)}`, undefined, controller.signal);
      if (version !== generation) return;
      const profile = data.profile;
      if (!profile) throw new Error("This shared profile is unavailable.");
      content.append(element("h3", profile.displayName), element("p", profile.bio));
      content.append(element("p", [...(profile.roles || []), ...(profile.genres || []), ...(profile.languages || [])].join(" · ")));
      if (profile.bpmMin && profile.bpmMax) content.append(element("p", `${profile.bpmMin}–${profile.bpmMax} BPM`));
      const summary = element("div");
      renderDNASummary(summary, profile.dna, data.terms || terms);
      content.append(summary);
      if (profile.premiumVerified === true) content.append(element("p", "✓ Verified Premium — active Creator Pass, not identity or rights verification."));
      if (profile.artistSlug && /^[a-zA-Z0-9_-]+$/.test(profile.artistSlug)) {
        const link = element("a", "Visit artist room");
        link.href = `/artists/${encodeURIComponent(profile.artistSlug)}/`;
        content.append(link);
      }
      content.append(element("h4", "Published releases"));
      for (const release of data.releases || []) {
        const url = safeReleaseURL(release.url);
        if (!url) continue;
        const link = element("a", release.title || "Published release");
        link.href = url;
        link.rel = "noopener noreferrer";
        content.append(link);
      }
      if (!signedIn()) {
        const link = element("a", "Sign in to collaborate");
        link.href = "/creator-network/#locked";
        content.append(link);
      } else if (profile.canInvite === true && data.projects?.length) {
        const label = element("label", "Your open project"), select = element("select");
        for (const project of data.projects) {
          const option = element("option", project.title);
          option.value = project.id;
          select.append(option);
        }
        label.append(select);
        const invite = button("Invite to project", async () => {
          invite.disabled = true;
          try {
            const result = await request("", { action: "invite", projectId: select.value, publicProfileId: profile.publicProfileId }, controller.signal);
            if (version === generation) notice.textContent = result.message || "Project invitation recorded. No message or media was sent automatically.";
          } catch (error) {
            if (version === generation) notice.textContent = error.message;
          } finally { if (version === generation) invite.disabled = false; }
        });
        content.append(label, invite);
      } else content.append(element("p", "No eligible invitation is available. Create an open project in your workspace to collaborate."));
      notice.textContent = "";
    } catch (error) {
      if (version === generation) notice.textContent = error.message;
    }
  }
  function clear() {
    generation++;
    controller?.abort();
    shell.close();
    content.replaceChildren();
    notice.textContent = "";
  }
  return { open, clear };
}
