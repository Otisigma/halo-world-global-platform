const state = {
  items: [],
  department: "all",
  authenticated: false,
  authState: "pending",
  identity: null,
  identityResolved: false,
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
  storyCopy: $("#pipelineStoryCopy"),
  storySignal: $("#pipelineStorySignal"),
  timeline: $("#pipelineTimeline"),
  trackTitle: $("#pipelineTrackTitle"),
  trackMeta: $("#pipelineTrackMeta"),
  trustSignal: $("#pipelineTrustSignal"),
  guidanceCopy: $("#pipelineGuidanceCopy"),
  counts: $("#pipelineCounts"),
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

const STAGE_ORDER = [
  "uploaded",
  "processing",
  "needs_assets",
  "dreamweaver_in_progress",
  "ready_for_radio",
  "ready_for_sale",
  "approved",
  "published",
];

const STAGE_GUIDANCE = {
  uploaded: "Package created. Confirm source details and route ownership before deeper processing.",
  processing: "Validation is active. Keep metadata complete and rights status current for handoff confidence.",
  needs_assets: "Action needed: add missing audio/artwork so the pipeline can keep moving without lock delays.",
  dreamweaver_in_progress: "Dream Weaver is assembling downstream presentation and contextual rollout assets.",
  ready_for_radio: "Ready for radio programming sync and on-air placement decisions.",
  ready_for_sale: "Prepare buy/stream links and release timing so commerce can publish cleanly.",
  approved: "Approved by reviewers. Final publication checks and scheduling are next.",
  published: "Published and fan-facing. Monitor engagement and keep follow-up campaigns aligned.",
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

function clearPipelineItems() {
  elements.board.querySelectorAll(".pipeline-item").forEach(el => el.remove());
}

function setLoadingMessage(message) {
  elements.loading.hidden = false;
  elements.loading.textContent = message;
}

function setPendingAuthState(message = "Checking HALO session…") {
  state.authenticated = false;
  state.authState = "pending";
  state.items = [];
  elements.empty.hidden = true;
  clearPipelineItems();
  setLoadingMessage(message);
  renderInsights();
}

function setSignedOutState(message = "Sign in to view the upload pipeline.") {
  state.authenticated = false;
  state.authState = "unauthenticated";
  state.items = [];
  elements.empty.hidden = true;
  clearPipelineItems();
  setLoadingMessage(message);
  renderInsights();
}

async function api(payload) {
  const options = payload
    ? { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) }
    : { credentials: "same-origin", headers: { Accept: "application/json" } };
  const response = await fetch(`/api/upload-pipeline?department=${encodeURIComponent(state.department)}`, options);
  const data = await response.json().catch(() => ({ message: "Response could not be read" }));
  if (!response.ok) {
    const error = new Error(data.message || "Pipeline request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadPipeline() {
  elements.shell.setAttribute("aria-busy", "true");
  setLoadingMessage(state.identityResolved ? "Loading pipeline…" : "Checking HALO session…");
  elements.empty.hidden = true;
  try {
    const data = await api();
    state.authenticated = Boolean(data.authenticated);
    state.authState = state.authenticated ? "authenticated" : (state.identityResolved ? "unauthenticated" : "pending");
    state.items = state.authenticated ? (data.items || []) : [];
    render();
  } catch (error) {
    if (error.status === 401 && !state.identityResolved) {
      setPendingAuthState();
      return;
    }
    if (error.status === 401) {
      setSignedOutState(error.message);
      return;
    }
    setLoadingMessage(error.message);
    renderInsights();
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
  if (state.authState === "pending") {
    elements.empty.hidden = true;
    clearPipelineItems();
    renderInsights();
    return;
  }
  elements.loading.hidden = true;
  if (!state.authenticated) {
    setLoadingMessage("Sign in to view the upload pipeline.");
    clearPipelineItems();
    renderInsights();
    return;
  }
  if (!state.items.length) {
    elements.empty.hidden = false;
    clearPipelineItems();
    renderInsights();
    return;
  }
  elements.empty.hidden = true;
  elements.board.innerHTML = state.items.map(renderItem).join("");
  renderInsights();
}

function nextStage(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0 || index >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[index + 1];
}

function latestByUpdatedAt(items) {
  return [...items].sort((a, b) => {
    const aTs = Date.parse(a.pipelineUpdatedAt || "") || 0;
    const bTs = Date.parse(b.pipelineUpdatedAt || "") || 0;
    return bTs - aTs;
  })[0] || null;
}

function renderTimeline(stage) {
  elements.timeline.innerHTML = STAGE_ORDER.map(step => {
    const isActive = step === stage;
    const isComplete = STAGE_ORDER.indexOf(step) <= STAGE_ORDER.indexOf(stage);
    return `<li class="timeline-step${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}">
      <span class="timeline-dot" aria-hidden="true"></span>
      <span>${escapeHtml(STAGE_LABEL[step] || step)}</span>
    </li>`;
  }).join("");
}

function renderCounts(items) {
  const counts = STAGE_ORDER.map(stage => ({
    stage,
    count: items.filter(item => item.pipelineStatus === stage).length,
  })).filter(item => item.count > 0);
  if (!counts.length) {
    elements.counts.innerHTML = "<li>No staged packages yet.</li>";
    return;
  }
  elements.counts.innerHTML = counts.map(item => `<li><span>${escapeHtml(STAGE_LABEL[item.stage] || item.stage)}</span><strong>${item.count}</strong></li>`).join("");
}

function renderInsights() {
  if (state.authState === "pending") {
    elements.storyCopy.textContent = "HALO is checking your membership session before loading live pipeline data.";
    elements.storySignal.className = "story-signal";
    elements.trackTitle.textContent = "Checking sign-in state";
    elements.trackMeta.textContent = "Stay on this page while authentication hydrates and the pipeline reconnects.";
    elements.trustSignal.textContent = "Trust signal: waiting for confirmed session hydration.";
    elements.guidanceCopy.textContent = "Once your session is confirmed, HALO will load the active board without redirecting you away.";
    renderTimeline("uploaded");
    renderCounts([]);
    return;
  }
  if (!state.authenticated) {
    elements.storyCopy.textContent = "Sign in to activate live stage storytelling, counts, and guided next steps.";
    elements.storySignal.className = "story-signal";
    elements.trackTitle.textContent = "Sign in required";
    elements.trackMeta.textContent = "Authentication unlocks the active song board and department guidance.";
    elements.trustSignal.textContent = "Trust signal: awaiting authenticated pipeline data.";
    elements.guidanceCopy.textContent = "After sign in, use each department tab to review exactly what needs action.";
    renderTimeline("uploaded");
    renderCounts([]);
    return;
  }
  if (!state.items.length) {
    elements.storyCopy.textContent = "No active songs yet. The board is ready for a new upload package from Music Upload or Song Catalog.";
    elements.storySignal.className = "story-signal";
    elements.trackTitle.textContent = "No active package yet";
    elements.trackMeta.textContent = "Once uploaded, HALO will stream status updates here and guide each next stage.";
    elements.trustSignal.textContent = "Trust signal: no persistence confirmations yet.";
    elements.guidanceCopy.textContent = "Start in Music Upload, then return here to guide stage-by-stage progression.";
    renderTimeline("uploaded");
    renderCounts([]);
    return;
  }
  const current = latestByUpdatedAt(state.items);
  const stage = current?.pipelineStatus || "uploaded";
  const next = nextStage(stage);
  const updated = current?.pipelineUpdatedAt ? new Date(current.pipelineUpdatedAt).toLocaleString() : "just now";
  const linkedCount = Number(current?.radioTracks?.length || 0);
  const trustMessage = stage === "published" || stage === "dreamweaver_in_progress" || stage === "ready_for_radio"
    ? "Trust signal: persistence-confirmed package is moving through the shared pipeline."
    : "Trust signal: wait for persistence-confirmed assets before final lock-in.";
  elements.storyCopy.textContent = STAGE_GUIDANCE[stage] || "HALO is tracking this package in the unified pipeline.";
  elements.storySignal.className = `story-signal stage-${stage}`;
  elements.trackTitle.textContent = current?.title || "Untitled package";
  elements.trackMeta.textContent = `${current?.artistName || "Unknown artist"} · ${updated} · ${linkedCount} radio link${linkedCount === 1 ? "" : "s"}`;
  elements.trustSignal.textContent = trustMessage;
  elements.guidanceCopy.textContent = next
    ? `Next recommended stage: ${STAGE_LABEL[next] || next}. Confirm assets/metadata, then move the stage when ready.`
    : "This package is at the final stage. Monitor fan-facing performance and downstream actions.";
  renderTimeline(stage);
  renderCounts(state.items);
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

async function connectIdentity(identity) {
  if (!identity || state.identity) return;
  state.identity = identity;
  const user = await identity.getUser().catch(() => null);
  state.identityResolved = true;
  if (user) await loadPipeline();
  else setSignedOutState();
  identity.onAuthChange((_event, changedUser) => {
    state.identityResolved = true;
    if (changedUser) loadPipeline();
    else setSignedOutState();
  });
}

window.addEventListener("halo-identity-ready", event => connectIdentity(event.detail), { once: true });
if (window.haloIdentity) connectIdentity(window.haloIdentity);
setPendingAuthState();
loadPipeline();
