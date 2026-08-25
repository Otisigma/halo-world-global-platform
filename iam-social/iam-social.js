const state = { artist: null, artists: [], materials: [], snippets: [], sourceFilter: "all", statusFilter: "ready" };

const elements = {
  workspace: document.querySelector("#workspace"), emptyState: document.querySelector("#emptyState"), emptyTitle: document.querySelector("#emptyTitle"),
  emptyMessage: document.querySelector("#emptyMessage"), artistSelect: document.querySelector("#artistSelect"), poolStatus: document.querySelector("#poolStatus"),
  materialCount: document.querySelector("#materialCount"), snippetCount: document.querySelector("#snippetCount"), reuseCount: document.querySelector("#reuseCount"),
  sourceFilters: document.querySelector("#sourceFilters"), materialList: document.querySelector("#materialList"), snippetGrid: document.querySelector("#snippetGrid"),
  statusFilter: document.querySelector("#statusFilter"), newSnippet: document.querySelector("#newSnippet"), dialog: document.querySelector("#snippetDialog"),
  form: document.querySelector("#snippetForm"), dialogTitle: document.querySelector("#dialogTitle"), closeDialog: document.querySelector("#closeDialog"),
  snippetId: document.querySelector("#snippetId"), sourceKind: document.querySelector("#sourceKind"), sourceId: document.querySelector("#sourceId"),
  assetUrl: document.querySelector("#assetUrl"), snippetTitle: document.querySelector("#snippetTitle"), snippetHook: document.querySelector("#snippetHook"),
  snippetBody: document.querySelector("#snippetBody"), snippetTopic: document.querySelector("#snippetTopic"), snippetStatus: document.querySelector("#snippetStatus"),
  formMessage: document.querySelector("#formMessage"), toast: document.querySelector("#toast")
};

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function materialKinds() {
  return ["all", ...new Set(state.materials.map(material => material.kind))];
}

function renderSummary() {
  elements.materialCount.textContent = state.materials.length;
  elements.snippetCount.textContent = state.snippets.filter(snippet => snippet.status !== "retired").length;
  elements.reuseCount.textContent = state.snippets.reduce((total, snippet) => total + snippet.useCount, 0);
  elements.poolStatus.textContent = state.artist ? `${state.artist.artistName} is feeding ${state.materials.length} signals into the pool.` : "No artist workspace connected.";
}

function renderArtistSelect() {
  elements.artistSelect.innerHTML = state.artists.map(artist => `<option value="${escapeHtml(artist.slug)}"${artist.slug === state.artist?.slug ? " selected" : ""}>${escapeHtml(artist.artistName)}</option>`).join("");
}

function renderFilters() {
  const labels = { all: "All signals", profile: "Identity", release: "Records", activity: "Topics", video: "Moving image", campaign: "Past campaigns" };
  elements.sourceFilters.innerHTML = materialKinds().map(kind => `<button type="button" data-kind="${kind}" aria-pressed="${state.sourceFilter === kind}">${labels[kind] || kind}</button>`).join("");
}

function materialCard(material) {
  const image = material.assetUrl ? `<img src="${escapeHtml(material.assetUrl)}" alt="">` : `<div class="material-monogram">${escapeHtml(material.kind.slice(0, 2).toUpperCase())}</div>`;
  return `<article class="material-card" data-kind="${escapeHtml(material.kind)}">
    <div class="material-image">${image}<span>${escapeHtml(material.kind)}</span></div>
    <div class="material-copy"><small>${escapeHtml(material.detail)}</small><h3>${escapeHtml(material.title)}</h3><p>${escapeHtml(material.summary)}</p>
      <button type="button" data-pull="${escapeHtml(material.id)}">Pull into the pool <span>↗</span></button>
    </div>
  </article>`;
}

function renderMaterials() {
  const visible = state.materials.filter(material => state.sourceFilter === "all" || material.kind === state.sourceFilter);
  elements.materialList.innerHTML = visible.length ? visible.map(materialCard).join("") : `<div class="list-empty"><p>No material in this view yet.</p></div>`;
}

function feedbackTotal(snippet) {
  return Object.values(snippet.feedback || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function snippetCard(snippet) {
  return `<article class="snippet-card">
    <div class="snippet-meta"><span>${escapeHtml(snippet.topic || snippet.sourceKind)}</span><small>Used ${snippet.useCount} ${snippet.useCount === 1 ? "time" : "times"}</small></div>
    <h3>${escapeHtml(snippet.title)}</h3>
    ${snippet.hook ? `<blockquote>${escapeHtml(snippet.hook)}</blockquote>` : ""}
    <p>${escapeHtml(snippet.body)}</p>
    <div class="snippet-actions">
      <button type="button" data-copy="${snippet.id}">Copy</button>
      <button type="button" data-feedback="worked" data-id="${snippet.id}">Worked</button>
      <button type="button" data-feedback="needs_change" data-id="${snippet.id}">Needs shaping</button>
      <button type="button" data-edit="${snippet.id}" aria-label="Edit ${escapeHtml(snippet.title)}">Edit</button>
    </div>
    <small class="feedback-line">${feedbackTotal(snippet)} feedback signals · ${escapeHtml(snippet.sourceKind)} source</small>
  </article>`;
}

function renderSnippets() {
  const visible = state.snippets.filter(snippet => state.statusFilter === "all" || snippet.status === state.statusFilter);
  elements.snippetGrid.innerHTML = visible.length ? visible.map(snippetCard).join("") : `<div class="pool-empty"><span>THE FIRST THOUGHT STARTS THE FLOW</span><h3>Pull a source signal into the pool.</h3><p>Shape it once, then reuse it across releases, archive moments, and future campaigns.</p></div>`;
}

function render() {
  renderArtistSelect();
  renderSummary();
  renderFilters();
  renderMaterials();
  renderSnippets();
}

function openForm(material = null, snippet = null) {
  elements.form.reset();
  elements.formMessage.textContent = "";
  elements.snippetId.value = snippet?.id || "";
  elements.sourceKind.value = snippet?.sourceKind || material?.kind || "topic";
  elements.sourceId.value = snippet?.sourceId || material?.id || "";
  elements.assetUrl.value = snippet?.assetUrl || material?.assetUrl || "";
  elements.snippetTitle.value = snippet?.title || material?.title || "";
  elements.snippetHook.value = snippet?.hook || "";
  elements.snippetBody.value = snippet?.body || material?.summary || "";
  elements.snippetTopic.value = snippet?.topic || (material?.kind === "release" ? "release" : "");
  elements.snippetStatus.value = snippet?.status || "ready";
  elements.dialogTitle.textContent = snippet ? "Shape this thought again." : material ? "Turn this signal into language." : "Add to the living pool.";
  elements.dialog.showModal();
  window.setTimeout(() => elements.snippetTitle.focus(), 50);
}

async function loadWorkspace(artistSlug = "") {
  const query = artistSlug ? `?artist=${encodeURIComponent(artistSlug)}` : "";
  elements.poolStatus.textContent = "Reading the connected artist archive…";
  const response = await fetch(`/api/iam-social${query}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || "The social pool could not open"), { status: response.status });
  state.artist = data.artist;
  state.artists = data.artists || [];
  state.materials = data.materials || [];
  state.snippets = data.snippets || [];
  elements.emptyState.hidden = Boolean(state.artist);
  elements.workspace.hidden = !state.artist;
  if (!state.artist) {
    elements.emptyTitle.textContent = "Connect an artist room first.";
    elements.emptyMessage.textContent = "I AM Social uses a managed artist room as the source of truth for the living material pool.";
  }
  render();
}

async function postAction(payload) {
  const response = await fetch("/api/iam-social", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin",
    body: JSON.stringify({ ...payload, artistSlug: state.artist.slug })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "The pool could not save that change");
  state.artist = data.artist;
  state.artists = data.artists || state.artists;
  state.materials = data.materials || state.materials;
  state.snippets = data.snippets || [];
  render();
}

elements.sourceFilters.addEventListener("click", event => {
  const button = event.target.closest("[data-kind]");
  if (!button) return;
  state.sourceFilter = button.dataset.kind;
  renderFilters();
  renderMaterials();
});

elements.materialList.addEventListener("click", event => {
  const button = event.target.closest("[data-pull]");
  const material = state.materials.find(item => item.id === button?.dataset.pull);
  if (material) openForm(material);
});

elements.snippetGrid.addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit]");
  if (editButton) return openForm(null, state.snippets.find(snippet => snippet.id === editButton.dataset.edit));
  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    const snippet = state.snippets.find(item => item.id === copyButton.dataset.copy);
    if (!snippet) return;
    await navigator.clipboard.writeText([snippet.hook, snippet.body].filter(Boolean).join("\n\n"));
    await postAction({ action: "feedback", snippetId: snippet.id, signal: "reused", note: "Copied from I AM Social" });
    showToast("Copied and added to the feedback loop.");
    return;
  }
  const feedbackButton = event.target.closest("[data-feedback]");
  if (!feedbackButton) return;
  await postAction({ action: "feedback", snippetId: feedbackButton.dataset.id, signal: feedbackButton.dataset.feedback });
  showToast(feedbackButton.dataset.feedback === "worked" ? "Success signal recorded." : "Shaping note recorded.");
});

elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  elements.formMessage.textContent = "Saving this thought…";
  try {
    await postAction({
      action: elements.snippetId.value ? "update" : "create", snippetId: elements.snippetId.value,
      sourceKind: elements.sourceKind.value, sourceId: elements.sourceId.value, assetUrl: elements.assetUrl.value,
      title: elements.snippetTitle.value, hook: elements.snippetHook.value, body: elements.snippetBody.value,
      topic: elements.snippetTopic.value, status: elements.snippetStatus.value
    });
    elements.dialog.close();
    showToast("The living pool remembers this thought.");
  } catch (error) {
    elements.formMessage.textContent = error.message;
  }
});

elements.newSnippet.addEventListener("click", () => state.artist ? openForm() : showToast("Connect an artist workspace first."));
elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.statusFilter.addEventListener("change", () => { state.statusFilter = elements.statusFilter.value; renderSnippets(); });
elements.artistSelect.addEventListener("change", () => loadWorkspace(elements.artistSelect.value).catch(showLoadError));

function showLoadError(error) {
  elements.workspace.hidden = true;
  elements.emptyState.hidden = false;
  elements.emptyTitle.textContent = error.status === 401 ? "Sign in to open the artist memory." : "The social connection paused.";
  elements.emptyMessage.textContent = error.message;
  elements.poolStatus.textContent = "Connection waiting.";
}

loadWorkspace().then(() => window.haloStats?.track("open_iam_social", { artist_slug: state.artist?.slug || "" })).catch(showLoadError);
