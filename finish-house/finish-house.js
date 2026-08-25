const checklistKeys = ["masterOwned", "publishingControlled", "splitsConfirmed", "samplesCleared", "metadataComplete", "stemsAvailable", "instrumentalReady", "cleanVersionReady"];
const emptyProject = () => ({
  id: "", releaseProjectId: "", artistName: "", trackTitle: "", intendedUse: "streaming", masteringStatus: "brief",
  masteringBrief: { mixUrl: "", referenceTracks: "", sonicDirection: "", mixNotes: "", deadline: "" },
  requestedDeliverables: ["streaming_master"], licensingChecklist: {}, licensingStatus: "preparing",
  licensingDestination: "halo_house", submissionNotes: ""
});

const elements = Object.fromEntries([
  "accountButton", "newProjectButton", "projectList", "readinessPercent", "readinessBar", "readinessMessage", "finishDesk", "emptyState", "finishForm",
  "artistName", "trackTitle", "intendedUse", "saveButton", "masteringStatus", "mixUrl", "referenceTracks", "sonicDirection", "mixNotes", "deadline",
  "requestMasterButton", "licensingStatus", "licensingDestination", "submissionNotes", "copyBriefButton", "partnerPortalLink", "partnerNote", "saveStatus",
  "projectDialog", "projectForm", "releaseProjectId", "newArtistName", "newTrackTitle", "newIntendedUse", "projectMessage",
  "identityDialog", "identityForm", "identityTitle", "identityIntro", "identityNameField", "identityName", "identityEmail", "identityPassword", "identityMessage", "identitySubmit"
].map(id => [id, document.getElementById(id)]));

const state = { identity: null, authenticated: false, viewer: null, projects: [], releaseProjects: [], current: null, authMode: "signup" };

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function api(payload) {
  const response = await fetch("/api/finish-house", payload ? {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  } : { credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Finish House could not complete that action");
  return body;
}

function setStatus(message, isError = false) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.style.color = isError ? "#a42e1e" : "";
}

function collectProject() {
  const deliverables = [...document.querySelectorAll('[name="deliverable"]:checked')].map(input => input.value);
  const licensingChecklist = Object.fromEntries(checklistKeys.map(key => [key, Boolean(document.querySelector(`[name="licensingCheck"][value="${key}"]`)?.checked)]));
  return {
    ...state.current,
    artistName: elements.artistName.value.trim(), trackTitle: elements.trackTitle.value.trim(), intendedUse: elements.intendedUse.value,
    masteringStatus: elements.masteringStatus.value,
    masteringBrief: { mixUrl: elements.mixUrl.value.trim(), referenceTracks: elements.referenceTracks.value.trim(), sonicDirection: elements.sonicDirection.value.trim(), mixNotes: elements.mixNotes.value.trim(), deadline: elements.deadline.value },
    requestedDeliverables: deliverables.length ? deliverables : ["streaming_master"], licensingChecklist,
    licensingStatus: elements.licensingStatus.value, licensingDestination: elements.licensingDestination.value, submissionNotes: elements.submissionNotes.value.trim()
  };
}

function readiness(project) {
  if (!project) return 0;
  const checklistScore = checklistKeys.filter(key => project.licensingChecklist?.[key]).length;
  const masterScore = project.masteringStatus === "approved" ? 1 : 0;
  const packageScore = project.requestedDeliverables?.includes("instrumental") ? 1 : 0;
  return Math.round(((checklistScore + masterScore + packageScore) / 10) * 100);
}

function updateReadiness(project = collectProject()) {
  const percent = readiness(project);
  elements.readinessPercent.textContent = `${percent}%`;
  elements.readinessBar.style.width = `${percent}%`;
  elements.readinessMessage.textContent = percent === 100 ? "Package ready for a licensing handoff." : percent >= 70 ? "Close. Resolve the remaining ownership or version details." : "Complete the master and clearance checklist before pitching.";
}

function updatePartner() {
  const destination = elements.licensingDestination.value;
  const partner = destination === "disco" ? {
    href: "https://www.disco.ac/", label: "Open DISCO", note: "DISCO is an independent third-party music platform. Review its current terms, fees, access, and submission requirements before sharing music."
  } : destination === "halo_house" ? {
    href: "/outreach.html", label: "Open HALO review", note: "HALO review prepares an opportunity conversation. It does not guarantee a pitch, placement, fee, or release."
  } : {
    href: "/outreach.html", label: "Prepare with Outreach", note: "The Outreach Desk helps organise a targeted handoff. Confirm the recipient accepts unsolicited music before sending files."
  };
  elements.partnerPortalLink.href = partner.href;
  elements.partnerPortalLink.textContent = partner.label;
  elements.partnerPortalLink.target = destination === "disco" ? "_blank" : "";
  elements.partnerPortalLink.rel = destination === "disco" ? "noopener noreferrer" : "";
  elements.partnerNote.textContent = partner.note;
}

function renderProjects() {
  elements.projectList.innerHTML = state.projects.length ? state.projects.map(project => `<button class="project-button${project.id === state.current?.id ? " is-active" : ""}" type="button" data-project-id="${escapeHtml(project.id)}"><span>${escapeHtml(project.artistName || "Unnamed artist")}</span><strong>${escapeHtml(project.trackTitle || "Untitled track")}</strong></button>`).join("") : "<p>No saved tracks yet.</p>";
}

function renderReleaseOptions() {
  elements.releaseProjectId.innerHTML = `<option value="">Start without a release project</option>${state.releaseProjects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.projectName)}${project.mixRoomComplete ? " — mix ready" : ""}</option>`).join("")}`;
}

function renderCurrent() {
  renderProjects();
  const project = state.current;
  elements.emptyState.hidden = Boolean(project);
  elements.finishForm.hidden = !project;
  if (!project) {
    elements.readinessPercent.textContent = "0%";
    elements.readinessBar.style.width = "0%";
    return;
  }
  elements.artistName.value = project.artistName || "";
  elements.trackTitle.value = project.trackTitle || "";
  elements.intendedUse.value = project.intendedUse || "streaming";
  elements.masteringStatus.value = project.masteringStatus || "brief";
  elements.mixUrl.value = project.masteringBrief?.mixUrl || "";
  elements.referenceTracks.value = project.masteringBrief?.referenceTracks || "";
  elements.sonicDirection.value = project.masteringBrief?.sonicDirection || "";
  elements.mixNotes.value = project.masteringBrief?.mixNotes || "";
  elements.deadline.value = project.masteringBrief?.deadline || "";
  document.querySelectorAll('[name="deliverable"]').forEach(input => { input.checked = project.requestedDeliverables?.includes(input.value); });
  document.querySelectorAll('[name="licensingCheck"]').forEach(input => { input.checked = project.licensingChecklist?.[input.value] === true; });
  elements.licensingStatus.value = project.licensingStatus || "preparing";
  elements.licensingDestination.value = project.licensingDestination || "halo_house";
  elements.submissionNotes.value = project.submissionNotes || "";
  updateReadiness(project);
  updatePartner();
  setStatus(`Last saved ${new Date(project.updatedAt || Date.now()).toLocaleString()}.`);
}

function openIdentity(mode = "signup") {
  state.authMode = mode;
  elements.identityNameField.hidden = mode !== "signup";
  elements.identityName.required = mode === "signup";
  elements.identityPassword.autocomplete = mode === "signup" ? "new-password" : "current-password";
  elements.identityTitle.textContent = mode === "signup" ? "Join HALO." : "Welcome back.";
  elements.identityIntro.textContent = mode === "signup" ? "Create a membership to save private finishing briefs and reopen them on any device." : "Sign in to continue finishing your tracks.";
  elements.identitySubmit.textContent = mode === "signup" ? "Join and continue" : "Sign in";
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.authMode === mode)));
  elements.identityMessage.textContent = "";
  elements.identityDialog.showModal();
}

function openProjectDialog() {
  if (!state.authenticated) return openIdentity("signup");
  renderReleaseOptions();
  elements.projectMessage.textContent = "";
  elements.projectForm.reset();
  elements.projectDialog.showModal();
}

async function loadWorkspace(preferredId = "") {
  try {
    const body = await api();
    state.authenticated = body.authenticated;
    state.viewer = body.viewer || null;
    state.projects = body.projects || [];
    state.releaseProjects = body.releaseProjects || [];
    state.current = state.projects.find(project => project.id === preferredId) || state.projects[0] || null;
    elements.accountButton.textContent = state.authenticated ? (state.viewer?.name || "My account") : "Join / sign in";
    renderReleaseOptions();
    renderCurrent();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function saveCurrent() {
  if (!state.authenticated) return openIdentity("signup");
  if (!state.current?.id) return;
  elements.saveButton.disabled = true;
  setStatus("Saving the finish package…");
  try {
    const project = collectProject();
    const body = await api({ action: "save", projectId: project.id, ...project });
    state.projects = state.projects.map(item => item.id === body.project.id ? body.project : item);
    state.current = body.project;
    renderCurrent();
    setStatus(body.message);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.saveButton.disabled = false;
  }
}

function licensingBrief() {
  const project = collectProject();
  const confirmed = checklistKeys.filter(key => project.licensingChecklist[key]).length;
  return [
    "HALO FINISH HOUSE — LICENSING BRIEF",
    `Artist: ${project.artistName || "Not supplied"}`,
    `Track: ${project.trackTitle || "Not supplied"}`,
    `Primary use: ${project.intendedUse}`,
    `Master status: ${project.masteringStatus}`,
    `Available deliverables: ${project.requestedDeliverables.join(", ")}`,
    `Rights checklist: ${confirmed}/${checklistKeys.length} confirmed`,
    `Pitch notes: ${project.submissionNotes || "Not supplied"}`,
    "",
    "This brief records artist-supplied information. Recipients should complete their own clearance and contracting process."
  ].join("\n");
}

elements.newProjectButton.addEventListener("click", openProjectDialog);
document.querySelectorAll("[data-open-project]").forEach(button => button.addEventListener("click", openProjectDialog));
document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
elements.projectList.addEventListener("click", event => {
  const button = event.target.closest("[data-project-id]");
  if (!button) return;
  state.current = state.projects.find(project => project.id === button.dataset.projectId) || null;
  renderCurrent();
});
elements.finishForm.addEventListener("submit", event => { event.preventDefault(); saveCurrent(); });
elements.finishForm.addEventListener("change", () => { state.current = collectProject(); updateReadiness(state.current); updatePartner(); setStatus("Changes are ready to save."); });
elements.requestMasterButton.addEventListener("click", async () => { elements.masteringStatus.value = "requested"; state.current = collectProject(); await saveCurrent(); });
elements.copyBriefButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(licensingBrief());
    elements.copyBriefButton.textContent = "Brief copied";
    setTimeout(() => { elements.copyBriefButton.textContent = "Copy licensing brief"; }, 1800);
  } catch {
    setStatus("Your browser blocked clipboard access. Save the project and copy the fields manually.", true);
  }
});
elements.licensingDestination.addEventListener("change", updatePartner);
elements.projectForm.addEventListener("submit", async event => {
  event.preventDefault();
  elements.projectMessage.textContent = "Opening Finish House…";
  try {
    const body = await api({ action: "create", releaseProjectId: elements.releaseProjectId.value, artistName: elements.newArtistName.value, trackTitle: elements.newTrackTitle.value, intendedUse: elements.newIntendedUse.value });
    const existingIndex = state.projects.findIndex(project => project.id === body.project.id);
    if (existingIndex >= 0) state.projects[existingIndex] = body.project;
    else state.projects.unshift(body.project);
    state.current = body.project;
    elements.projectDialog.close();
    renderCurrent();
  } catch (error) {
    elements.projectMessage.textContent = error.message;
  }
});
document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => openIdentity(button.dataset.authMode)));
elements.identityForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.identity) return;
  elements.identitySubmit.disabled = true;
  elements.identityMessage.textContent = "";
  try {
    let user;
    if (state.authMode === "signup") {
      user = await state.identity.signup(elements.identityEmail.value.trim(), elements.identityPassword.value, { full_name: elements.identityName.value.trim() });
      if (!user?.token) {
        elements.identityMessage.textContent = "Check your email to confirm your membership, then return to sign in.";
        return;
      }
    } else {
      user = await state.identity.login(elements.identityEmail.value.trim(), elements.identityPassword.value);
    }
    elements.identityDialog.close();
    await loadWorkspace();
    openProjectDialog();
  } catch (error) {
    elements.identityMessage.textContent = error.message || "Membership could not be completed.";
  } finally {
    elements.identitySubmit.disabled = false;
  }
});
elements.accountButton.addEventListener("click", async () => {
  if (state.authenticated && state.identity) {
    await state.identity.logout();
    state.authenticated = false;
    state.projects = [];
    state.releaseProjects = [];
    state.current = null;
    renderCurrent();
    elements.accountButton.textContent = "Join / sign in";
  } else openIdentity("login");
});
window.addEventListener("halo-identity-ready", event => {
  state.identity = event.detail;
  state.identity.getUser().then(() => loadWorkspace());
});
setTimeout(() => { if (!state.identity) loadWorkspace(); }, 1200);
