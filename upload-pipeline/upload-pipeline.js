const state = {
  items: [],
  department: "all",
  authenticated: false,
  activeSongId: "",
  activeSongTitle: "",
};

const $ = selector => document.querySelector(selector);

const elements = {
  board: $("#pipelineBoard"),
  loading: $("#pipelineLoading"),
  empty: $("#pipelineEmpty"),
  shell: $("#pipelineShell"),
  stageDialog: $("#stageDialog"),
  stageForm: $("#stageForm"),
  stageSelect: $("#stageSelect"),
  stageMessage: $("#stageMessage"),
  stageSubmitButton: $("#stageSubmitButton"),
  stageCloseButton: $("#stageCloseButton"),
  stageDialogSongName: $("#stageDialogSongName"),
};

const escapeHtml = value =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STAGE_LABEL = {
  uploaded: "Uploaded",
  processing: "Processing",
  needs_assets: "Needs Assets",
  dreamweaver_in_progress: "Dream Weaver",
  ready_for_radio: "Ready for Radio",
  ready_for_sale: "Ready for Sale",
  approved: "Approved",
  published: "Published",
};

const STAGE_CSS_CLASS = {
  uploaded: "stage-uploaded",
  processing: "stage-processing",
  needs_assets: "stage-needs_assets",
  dreamweaver_in_progress: "stage-dreamweaver_in_progress",
  ready_for_radio: "stage-ready_for_radio",
  ready_for_sale: "stage-ready_for_sale",
  approved: "stage-approved",
  published: "stage-published",
};

async function api(payload) {
  const options = payload
    ? { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) }
    : { credentials: "same-origin", headers: { Accept: "application/json" } };
  const response = await fetch(`/api/upload-pipeline?department=${encodeURIComponent(state.department)}`, options);
  const data = await response.json().catch(() => ({ message: "Response could not be read" }));
  if (!response.ok) throw new Error(data.message || "Pipeline request failed");
  return data;
}

async function loadPipeline() {
  elements.shell.setAttribute("aria-busy", "true");
  elements.loading.hidden = false;
  elements.empty.hidden = true;
  try {
    const data = await api();
    state.authenticated = Boolean(data.authenticated);
    state.items = data.items || [];
    render();
  } catch (error) {
    elements.loading.hidden = false;
    elements.loading.textContent = error.message;
  } finally {
    elements.shell.setAttribute("aria-busy", "false");
  }
}

function stageChip(stage) {
  const label = STAGE_LABEL[stage] || stage;
  const cls = STAGE_CSS_CLASS[stage] || "stage-uploaded";
  return `<span class="stage-chip ${escapeHtml(cls)}">${escapeHtml(label)}</span>`;
}

function renderItem(item) {
  const artHtml = item.artworkUrl
    ? `<img class="pipeline-item-art" src="${escapeHtml(item.artworkUrl)}" alt="" loading="lazy">`
    : `<span class="pipeline-item-art-placeholder" aria-hidden="true">♪</span>`;

  const radioHtml = item.radioTracks.length
    ? `<span class="radio-linked">● Radio linked (${item.radioTracks.length})</span>`
    : `<span>No radio link</span>`;

  const updatedAgo = item.pipelineUpdatedAt
    ? `Stage updated ${new Date(item.pipelineUpdatedAt).toLocaleDateString()}`
    : "";

  return `
    <article class="pipeline-item" data-song-id="${escapeHtml(item.id)}">
      ${artHtml}
      <div class="pipeline-item-meta">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.artistName)}${item.albumTitle ? ` · ${escapeHtml(item.albumTitle)}` : ""}${item.genre ? ` · ${escapeHtml(item.genre)}` : ""}</small>
        <small>${updatedAgo}</small>
      </div>
      <div class="pipeline-item-radio">${radioHtml}</div>
      <div class="pipeline-item-actions">
        ${stageChip(item.pipelineStatus)}
        <button class="move-stage-button" type="button" data-song-id="${escapeHtml(item.id)}" data-song-title="${escapeHtml(item.title)}" data-current-stage="${escapeHtml(item.pipelineStatus)}">Move stage</button>
      </div>
    </article>`;
}

function render() {
  elements.loading.hidden = true;
  if (!state.authenticated) {
    elements.loading.hidden = false;
  elements.loading.textContent = "Sign in to view the upload pipeline.";
  elements.board.querySelectorAll(".pipeline-item").forEach(el => el.remove());
    return;
  }
  if (!state.items.length) {
    elements.empty.hidden = false;
    elements.board.querySelectorAll(".pipeline-item").forEach(el => el.remove());
    return;
  }
  elements.empty.hidden = true;
  elements.board.innerHTML = state.items.map(renderItem).join("");
}

function openStageDialog(songId, songTitle, currentStage) {
  state.activeSongId = songId;
  state.activeSongTitle = songTitle;
  elements.stageDialogSongName.textContent = songTitle;
  elements.stageSelect.value = currentStage;
  elements.stageMessage.textContent = "";
  elements.stageSubmitButton.disabled = false;
  elements.stageSubmitButton.textContent = "Move stage";
  elements.stageDialog.showModal();
}

async function handleStageSubmit(event) {
  event.preventDefault();
  const stage = elements.stageSelect.value;
  if (!stage || !state.activeSongId) return;
  elements.stageSubmitButton.disabled = true;
  elements.stageSubmitButton.textContent = "Saving…";
  elements.stageMessage.textContent = "";
  try {
    const data = await api({ action: "set_stage", songId: state.activeSongId, stage });
    elements.stageMessage.textContent = data.message;
    const item = state.items.find(i => i.id === state.activeSongId);
    if (item) {
      item.pipelineStatus = stage;
      item.pipelineUpdatedAt = new Date().toISOString();
    }
    render();
    setTimeout(() => elements.stageDialog.close(), 700);
  } catch (error) {
    elements.stageMessage.textContent = error.message;
    elements.stageSubmitButton.disabled = false;
    elements.stageSubmitButton.textContent = "Move stage";
  }
}

// Event delegation for dynamic pipeline items.
elements.board.addEventListener("click", event => {
  const button = event.target.closest(".move-stage-button");
  if (!button) return;
  openStageDialog(button.dataset.songId, button.dataset.songTitle, button.dataset.currentStage);
});

// Department tab switching.
document.querySelectorAll(".dept-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".dept-tab").forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    state.department = tab.dataset.dept;
    loadPipeline();
  });
});

elements.stageForm.addEventListener("submit", handleStageSubmit);
elements.stageCloseButton.addEventListener("click", () => elements.stageDialog.close());

// Listen for Netlify Identity auth events to reload when the user signs in.
window.addEventListener("identity:login", loadPipeline);
window.addEventListener("identity:logout", () => {
  state.authenticated = false;
  state.items = [];
  elements.loading.hidden = false;
  elements.loading.textContent = "Sign in to view the upload pipeline.";
  elements.empty.hidden = true;
  elements.board.querySelectorAll(".pipeline-item").forEach(el => el.remove());
});

loadPipeline();
