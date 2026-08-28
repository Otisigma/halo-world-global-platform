const state = {
  rooms: [],
  activeRoom: "club",
  service: "preview",
  user: null,
  tracks: [],
  linkableTracks: [],
  releaseLibrary: [],
  reviewTracks: [],
  developmentReviews: [],
  canBulkUpload: false,
  canReviewTracks: false,
  managerCouncil: null,
  filter: "",
  authMode: "login",
  previewAudio: null,
  mixes: [],
  mixLibraryStatus: "loading",
  mixLibraryError: "",
  mixIndex: 0,
  mixSegmentIndex: 0,
  audioTransitioning: false,
  audioTransitionTimer: 0,
  transitionSeconds: 8,
  transitionMode: "beat",
  advancingLongPlay: false,
  advancingRotation: false,
  advancingTakeoverFallback: false,
  rotationErrorCount: 0,
  rotationIndexes: { club: 0, chill: 0, lounge: 0 },
  takeoverFallbackActive: false,
  takeoverFallbackRoom: "",
  takeoverSegmentIndex: 0,
  health: null,
  gemma: null,
  serverOffsetMs: 0,
  schedule: [],
  recentPlays: [],
  canManageSchedule: false,
  personas: [],
  personaSets: [],
  canManagePersonas: false,
  fallbackMixActive: false,
  fallbackPlayer: null,
  fallbackPlayerReady: false,
  fallbackPlayPending: false,
  youtubeLongPlayActive: false,
  youtubeLongPlayPending: false,
  youtubePlayerMode: "recovery",
  youtubeVideoId: ""
};

const roomColors = { club: "#ff4d00", chill: "#4b7cff", lounge: "#c9ff38", longplay: "#f0a6ff" };
const CHUNK_PHASE_RATIO = 0.82;
const versionRelationshipLabels = {
  full_version: "Full version of",
  remix: "Remix of",
  chilled_version: "Chilled version of",
  club_version: "Club version of",
  alternate_version: "Alternate version of"
};
const fallbackMix = {
  playlistId: "PLcmaoB9ss1YE",
  title: "Halo Artist Playlist",
  artist: "Halo Music",
  artwork: "/assets/halo-logo.webp"
};
let stationAudio = document.querySelector("#stationAudio");
let standbyAudio = document.querySelector("#standbyAudio");
const fallbackMixElement = document.querySelector("#fallbackMix");
const youtubePlayerLabel = document.querySelector("#youtubePlayerLabel");
const youtubePlayerTitle = document.querySelector("#youtubePlayerTitle");
const youtubePlayerDescription = document.querySelector("#youtubePlayerDescription");
const roomGrid = document.querySelector("#roomGrid");
const previewGrid = document.querySelector("#previewGrid");
const previewPlaybackStatus = document.querySelector("#previewPlaybackStatus");
const mainPlayButton = document.querySelector("#mainPlayButton");
const accountButton = document.querySelector("#accountButton");
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const trackEditorDialog = document.querySelector("#trackEditorDialog");
const trackEditorForm = document.querySelector("#trackEditorForm");
const signalScope = document.querySelector("#signalScope");
const scheduleGrid = document.querySelector("#scheduleGrid");
const playHistory = document.querySelector("#playHistory");
const residentGrid = document.querySelector("#residentGrid");
const residentSets = document.querySelector("#residentSets");
const residentSetsBlock = document.querySelector("#residentSetsBlock");
const stationDeskButton = document.querySelector("#stationDeskButton");
const stationDeskDialog = document.querySelector("#stationDeskDialog");
const stationDeskNotice = document.querySelector("#stationDeskNotice");
const managerCouncilForm = document.querySelector("#managerCouncilForm");
const managerCouncilOutput = document.querySelector("#managerCouncilOutput");
const rotationReview = document.querySelector("#rotationReview");
const rotationReviewList = document.querySelector("#rotationReviewList");
const showForm = document.querySelector("#showForm");
const playLogForm = document.querySelector("#playLogForm");
const artistActivityForm = document.querySelector("#artistActivityForm");
const gemmaStatus = document.querySelector("#gemmaStatus");
const gemmaPriorities = document.querySelector("#gemmaPriorities");
const gemmaRelay = document.querySelector("#gemmaRelay");
const longPlayQueue = document.querySelector("#longPlayQueue");
const mixQueueCount = document.querySelector("#mixQueueCount");
const playbackProgress = document.querySelector("#playbackProgress");
const previousMixButton = document.querySelector("#previousMixButton");
const nextMixButton = document.querySelector("#nextMixButton");
const transitionSeconds = document.querySelector("#transitionSeconds");
const transitionMode = document.querySelector("#transitionMode");
const transitionReadout = document.querySelector("#transitionReadout");
const uploadHelper = window.HaloUploadProgress;
const bulkUploadForm = document.querySelector("#bulkUploadForm");
const bulkUploadProgress = document.querySelector("#bulkUploadProgress");
const bulkFileList = document.querySelector("#bulkFileList");
const submissionForm = document.querySelector("#submissionForm");
const submissionNotice = document.querySelector("#submissionNotice");
const bulkUploadNotice = document.querySelector("#bulkUploadNotice");
const submissionUploadUi = uploadHelper.createUploadUi({ panel: submissionForm, status: submissionNotice, track: document.querySelector("#uploadProgress"), fill: document.querySelector("#uploadProgress span"), idleMessage: "Sign in before transmitting your track." });
const bulkUploadUi = uploadHelper.createUploadUi({ panel: bulkUploadForm, status: bulkUploadNotice, track: bulkUploadProgress, fill: bulkUploadProgress?.querySelector("span"), idleMessage: "Use the station desk to send a batch into rotation review." });
const submissionRelease = document.querySelector("#submissionRelease");
const submissionAudioVersion = document.querySelector("#submissionAudioVersion");
const submissionLinkedTrack = document.querySelector("#submissionLinkedTrack");
const submissionVersionRelationship = document.querySelector("#submissionVersionRelationship");
const resolveTrackButton = document.querySelector("#resolveTrackButton");
const officialSourceNotice = document.querySelector("#officialSourceNotice");
const developmentBoard = document.querySelector("#developmentBoard");
const developmentTimeline = document.querySelector("#developmentTimeline");

const developmentStageLabels = {
  discovery: "Discovery",
  testing: "Audience testing",
  emerging: "Emerging rotation",
  rotation: "Regular rotation",
  featured: "Featured rotation",
  development: "Development review",
  closed: "Current version closed"
};

const scoreLabels = {
  songwriting: "Songwriting",
  lyrics: "Lyrics",
  vocals: "Vocals",
  production: "Production",
  mix: "Mix / master",
  originality: "Originality",
  audienceFit: "Audience fit",
  openingImpact: "Opening impact"
};

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function artworkSeed(track) {
  return `${track.title || ""}|${track.artist || ""}|${track.room || ""}`
    .split("")
    .reduce((seed, character) => ((seed * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
}

function generatedArtworkMarkup(track) {
  const longPlay = Number(track.durationSeconds || 0) >= 20 * 60;
  const seed = artworkSeed(track);
  const angle = 18 + (seed % 126);
  const accent = roomColors[track.room] || roomColors.club;
  const secondary = `hsl(${seed % 360} 42% 34%)`;
  const initials = String(track.title || "HALO")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0])
    .join("")
    .toUpperCase();
  const format = longPlay ? "Long play" : "Original signal";
  return `<div class="preview-artwork preview-artwork-generated${longPlay ? " is-long-play" : ""}" role="img" aria-label="Generated ${escapeHtml(format.toLowerCase())} cover for ${escapeHtml(track.title)}" style="--cover-accent:${accent};--cover-secondary:${secondary};--cover-angle:${angle}deg;--cover-counter-angle:${-angle}deg">
    <span>${escapeHtml(format)}</span>
    <strong>${escapeHtml(initials || "H")}</strong>
    <small>${escapeHtml(track.artist || "HALO artist")}</small>
  </div>`;
}

function formatDuration(seconds, fallback = "Preview") {
  if (!seconds) return fallback;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(Math.floor(seconds % 60)).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

function formatScheduleDate(value) {
  const date = new Date(value);
  return {
    day: date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    time: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  };
}

function selectedRelease() {
  return state.releaseLibrary.find(release => release.id === submissionRelease.value) || null;
}

function updateSubmissionAudioSource() {
  const useSavedVersion = Boolean(submissionAudioVersion.value);
  document.querySelector("#dropZone").classList.toggle("is-disabled", useSavedVersion);
  document.querySelector("#trackFile").disabled = useSavedVersion;
  document.querySelector("#submissionVersionTypeField").hidden = useSavedVersion;
  document.querySelector("#submissionVersionLabelField").hidden = useSavedVersion;
  document.querySelector("#fileLabel").textContent = useSavedVersion ? "Using saved HALO audio" : "Drop a track or choose a file";
  document.querySelector("#fileHelp").textContent = useSavedVersion ? "No second upload is needed for this release version." : "MP3, M4A, AAC, OGG, WAV or FLAC · 128 MB maximum";
}

function renderSubmissionAudioVersions() {
  const release = selectedRelease();
  const selectedVersionId = submissionAudioVersion.value;
  const versions = release?.audioVersions || [];
  submissionAudioVersion.innerHTML = `<option value="">Upload a new audio version</option>${versions
    .map(version => `<option value="${escapeHtml(version.id)}">Reuse ${escapeHtml(version.label)}${version.sourceFilename ? ` · ${escapeHtml(version.sourceFilename)}` : ""}</option>`)
    .join("")}`;
  submissionAudioVersion.value = versions.some(version => version.id === selectedVersionId) ? selectedVersionId : "";
  updateSubmissionAudioSource();
}

function renderSubmissionLibrary() {
  const selectedReleaseId = submissionRelease.value;
  submissionRelease.innerHTML = `<option value="">New standalone radio song</option>${state.releaseLibrary
    .map(release => `<option value="${escapeHtml(release.id)}">${escapeHtml(release.title)} · ${escapeHtml(release.artist)}</option>`)
    .join("")}`;
  submissionRelease.value = state.releaseLibrary.some(release => release.id === selectedReleaseId) ? selectedReleaseId : "";

  const linkedTrackId = submissionLinkedTrack.value;
  submissionLinkedTrack.innerHTML = `<option value="">No connected radio version</option>${state.linkableTracks
    .map(track => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.title)} · ${escapeHtml(track.artist)} · ${escapeHtml(track.room)} room</option>`)
    .join("")}`;
  submissionLinkedTrack.value = state.linkableTracks.some(track => track.id === linkedTrackId) ? linkedTrackId : "";
  submissionVersionRelationship.disabled = !submissionLinkedTrack.value;
  renderSubmissionAudioVersions();
}

function applySelectedRelease() {
  const release = selectedRelease();
  renderSubmissionAudioVersions();
  if (!release) return;
  submissionForm.elements.title.value = release.title || "";
  submissionForm.elements.artist.value = release.artist || "";
  if (release.officialUrl) submissionForm.elements.sourceUrl.value = release.officialUrl;
  officialSourceNotice.textContent = `${release.title} is connected. Choose saved audio or upload a new version for the selected room.`;
}

async function resolveOfficialTrack() {
  const url = submissionForm.elements.sourceUrl.value.trim();
  if (!url) {
    officialSourceNotice.textContent = "Paste an official song link first.";
    submissionForm.elements.sourceUrl.focus();
    return;
  }
  resolveTrackButton.disabled = true;
  officialSourceNotice.textContent = "Reading the official song page…";
  try {
    const response = await fetch("/api/resolve-track", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ url })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The official song could not be loaded");
    submissionForm.elements.title.value = data.title || submissionForm.elements.title.value;
    submissionForm.elements.artist.value = data.artist || submissionForm.elements.artist.value;
    submissionForm.elements.sourceUrl.value = data.sourceUrl || url;
    officialSourceNotice.textContent = `${data.platform} connected. The official title and artist are loaded; now choose saved audio or upload your authorized file.`;
  } catch (error) {
    officialSourceNotice.textContent = error instanceof Error ? error.message : "The official song could not be loaded.";
  } finally {
    resolveTrackButton.disabled = false;
  }
}

function renderSchedule() {
  stationDeskButton.hidden = !state.canManageSchedule && !state.canReviewTracks;
  if (!state.schedule.length) {
    scheduleGrid.innerHTML = `<p class="empty-state">The programme grid is being prepared.</p>`;
  } else {
    scheduleGrid.innerHTML = state.schedule.map((show, index) => {
      const date = formatScheduleDate(show.startsAt);
      const color = roomColors[show.room] || roomColors.club;
      return `<article class="schedule-card ${index === 0 ? "is-next" : ""}" style="--show-color:${color}">
        <div class="schedule-card-top"><span>${escapeHtml(date.day)} · ${escapeHtml(show.room)} room</span><i></i></div>
        <div>
          <span class="schedule-card-time">${escapeHtml(date.time)} · ${show.durationMinutes} min</span>
          <h3>${escapeHtml(show.title)}</h3>
          <p>${escapeHtml(show.description)}</p>
          <div class="schedule-card-host"><span>${escapeHtml(show.hostName || "HALO Radio Team")}</span><small>${escapeHtml(show.showType)}${show.status !== "published" ? ` · ${escapeHtml(show.status)}` : ""}</small></div>
        </div>
        <div class="schedule-actions">
          <button class="schedule-follow ${show.subscribed ? "active" : ""}" type="button" data-show-follow="${escapeHtml(show.id)}">${show.subscribed ? "Following show" : "Follow this show"}</button>
          ${state.canManageSchedule ? `<button class="schedule-edit" type="button" data-show-edit="${escapeHtml(show.id)}">Edit programme</button>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  if (!state.recentPlays.length) {
    playHistory.innerHTML = `<p class="empty-state">The first verified station plays appear here.</p>`;
    return;
  }
  playHistory.innerHTML = state.recentPlays.slice(0, 6).map(play => {
    const destination = play.artistSlug ? `/artists/${encodeURIComponent(play.artistSlug)}` : play.releaseUrl;
    const date = new Date(play.startedAt);
    const content = `<span>${escapeHtml(play.room)} / ${escapeHtml(date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span><div><strong>${escapeHtml(play.title)}</strong><small>${escapeHtml(play.artistName)} · ${escapeHtml(play.source)}</small></div><i>↗</i>`;
    return destination
      ? `<a class="play-history-item" href="${escapeHtml(destination)}"${destination.startsWith("/") ? "" : ' target="_blank" rel="noopener"'} style="--play-color:${roomColors[play.room] || roomColors.club}">${content}</a>`
      : `<div class="play-history-item" style="--play-color:${roomColors[play.room] || roomColors.club}">${content}</div>`;
  }).join("");
}

async function loadSchedule() {
  try {
    const response = await fetch("/api/radio/schedule", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) throw new Error("Schedule unavailable");
    const data = await response.json();
    state.schedule = data.shows || [];
    state.recentPlays = data.recentPlays || [];
    state.canManageSchedule = Boolean(data.canManage);
    renderSchedule();
  } catch {
    scheduleGrid.innerHTML = `<p class="empty-state">The weekly programme is temporarily off-air.</p>`;
  }
}

async function stationAction(payload, form) {
  const submit = form?.querySelector("button[type=submit]");
  if (submit) submit.disabled = true;
  stationDeskNotice.textContent = "Updating the station system…";
  try {
    const response = await fetch("/api/radio/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The station action could not be completed");
    state.schedule = data.shows || state.schedule;
    state.recentPlays = data.recentPlays || state.recentPlays;
    state.canManageSchedule = Boolean(data.canManage);
    stationDeskNotice.textContent = data.message || "Station system updated.";
    renderSchedule();
    return data;
  } catch (error) {
    stationDeskNotice.textContent = error instanceof Error ? error.message : "The station system is unavailable.";
    throw error;
  } finally {
    if (submit) submit.disabled = false;
  }
}

const managerRoleNames = {
  programme: "Programme Director",
  audience: "Audience Strategist",
  artist: "Artist Development Lead",
  systems: "Broadcast Systems Manager",
  growth: "Growth Partnerships Lead"
};

function renderManagerCouncil(council) {
  state.managerCouncil = council;
  managerCouncilOutput.setAttribute("aria-busy", "false");
  if (!council) {
    managerCouncilOutput.innerHTML = `<div class="manager-council-empty"><strong>No council plan yet.</strong><p>Convene the managers when the station has new evidence to review.</p></div>`;
    return;
  }
  const managerCards = council.managers.map(manager => `<article class="manager-card" data-manager="${escapeHtml(manager.key)}">
    <div><span>${escapeHtml(manager.name)}</span><small>${escapeHtml(manager.title)}</small></div>
    <strong>${escapeHtml(manager.opportunity)}</strong>
    <p>${escapeHtml(manager.assessment)}</p>
    <em>Watch: ${escapeHtml(manager.watchMetric)}</em>
  </article>`).join("");
  const actions = council.actions.map(action => `<article class="manager-action" data-status="${escapeHtml(action.status)}">
    <div class="manager-action-top"><span>${escapeHtml(managerRoleNames[action.managerKey] || action.managerKey)}</span><i>${escapeHtml(action.priority)} · ${escapeHtml(action.effort)}</i></div>
    <strong>${escapeHtml(action.title)}</strong>
    <p>${escapeHtml(action.rationale)}</p>
    <small>Measure: ${escapeHtml(action.expectedMetric)}</small>
    <div class="manager-action-controls">
      <span>${escapeHtml(action.status)}</span>
      ${action.status === "proposed" ? `<button type="button" data-manager-decision="approved" data-manager-action-id="${escapeHtml(action.id)}">Approve</button><button type="button" data-manager-decision="rejected" data-manager-action-id="${escapeHtml(action.id)}">Reject</button>` : ""}
      ${action.status === "approved" ? `<button type="button" data-manager-decision="completed" data-manager-action-id="${escapeHtml(action.id)}">Mark complete</button>` : ""}
    </div>
  </article>`).join("");
  managerCouncilOutput.innerHTML = `<div class="manager-verdict">
      <span>${escapeHtml(council.horizonDays)}-day operating plan${council.usedFallback ? " · evidence fallback" : ""}</span>
      <h3>${escapeHtml(council.verdict)}</h3>
      <p>${escapeHtml(council.summary)}</p>
    </div>
    <div class="manager-roster">${managerCards}</div>
    <div class="manager-action-heading"><strong>Approval queue</strong><span>${council.actions.filter(action => action.status === "proposed").length} awaiting decision</span></div>
    <div class="manager-actions">${actions || '<p class="empty-state">The council did not propose an action.</p>'}</div>
    <div class="manager-council-footnotes"><div><strong>Experiments</strong><ul>${council.experiments.map(item => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No experiment proposed.</li>"}</ul></div><div><strong>Risks</strong><ul>${council.risks.map(item => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No risk recorded.</li>"}</ul></div></div>`;
}

async function loadManagerCouncil() {
  if (!state.canManageSchedule) return;
  managerCouncilOutput.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/radio/manager-council", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The manager council is unavailable");
    renderManagerCouncil(data.council);
  } catch (error) {
    managerCouncilOutput.setAttribute("aria-busy", "false");
    managerCouncilOutput.innerHTML = `<div class="manager-council-empty is-error"><strong>The council room could not open.</strong><p>${escapeHtml(error instanceof Error ? error.message : "The manager council is unavailable.")}</p></div>`;
  }
}

async function runManagerCouncil(event) {
  event.preventDefault();
  const submit = managerCouncilForm.querySelector("button[type=submit]");
  const payload = Object.fromEntries(new FormData(managerCouncilForm).entries());
  submit.disabled = true;
  managerCouncilOutput.setAttribute("aria-busy", "true");
  managerCouncilOutput.innerHTML = `<div class="manager-council-loading"><span></span><span></span><span></span><strong>Five managers are reading the same station evidence.</strong></div>`;
  stationDeskNotice.textContent = "The station manager council is building one coordinated operating plan…";
  try {
    const response = await fetch("/api/radio/manager-council", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "run_council", ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The manager council could not complete its plan");
    renderManagerCouncil(data.council);
    stationDeskNotice.textContent = "The manager council delivered a plan. Every proposed move is waiting for human approval.";
  } catch (error) {
    managerCouncilOutput.setAttribute("aria-busy", "false");
    managerCouncilOutput.innerHTML = `<div class="manager-council-empty is-error"><strong>The council did not complete.</strong><p>${escapeHtml(error instanceof Error ? error.message : "The manager council is unavailable.")}</p></div>`;
    stationDeskNotice.textContent = error instanceof Error ? error.message : "The manager council is unavailable.";
  } finally {
    submit.disabled = false;
  }
}

async function decideManagerAction(button) {
  const status = button.dataset.managerDecision;
  const actionId = button.dataset.managerActionId;
  if (!status || !actionId) return;
  const verb = status === "approved" ? "approve" : status === "rejected" ? "reject" : "complete";
  if (!window.confirm(`Confirm that you want to ${verb} this manager proposal?`)) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/radio/manager-council", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "decide_action", actionId, status })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The manager decision could not be saved");
    state.managerCouncil.actions = state.managerCouncil.actions.map(action => action.id === actionId ? data.action : action);
    renderManagerCouncil(state.managerCouncil);
    stationDeskNotice.textContent = `Manager proposal marked ${status}.`;
  } catch (error) {
    button.disabled = false;
    stationDeskNotice.textContent = error instanceof Error ? error.message : "The manager decision could not be saved.";
  }
}

// The capability ladder, in the order a resident earns it. Each entry is a thing the resident is
// allowed to do on air, so a level reads as authority rather than as a score.
const residentCapabilities = [
  { key: "buildsOwnRunningOrder", label: "Builds its own running order" },
  { key: "speaks", label: "Speaks between records" },
  { key: "writesOwnTalkBreaks", label: "Writes its own talk breaks" },
  { key: "takesRequests", label: "Takes requests" },
  { key: "proposesProgramming", label: "Proposes programming" },
  { key: "playsOutsideHomeRoom", label: "Plays outside its home room" }
];

function renderResidents() {
  if (!residentGrid) return;

  if (!state.personas.length) {
    residentGrid.innerHTML = `<p class="empty-state">The resident roster is being prepared.</p>`;
  } else {
    residentGrid.innerHTML = state.personas.map(persona => {
      const color = persona.accentColor || roomColors[persona.homeRoom] || roomColors.club;
      const evaluation = persona.latestEvaluation;
      const slot = persona.nextSlot;
      const when = slot ? formatScheduleDate(slot.plannedFor) : null;
      const ladder = residentCapabilities.map(capability => {
        const earned = Boolean(persona.capabilities?.[capability.key]);
        return `<li class="resident-capability ${earned ? "earned" : "locked"}">${escapeHtml(capability.label)}</li>`;
      }).join("");
      const next = persona.nextLevel
        ? `<p class="resident-next">Level ${persona.nextLevel.level}, ${escapeHtml(persona.nextLevel.title)}: ${persona.nextLevel.experienceNeeded} more experience${persona.nextLevel.craftNeeded > 0 ? ` and ${persona.nextLevel.craftNeeded} more points of craft` : ", craft already met"}. Unlocks ${escapeHtml(persona.nextLevel.unlocks)}.</p>`
        : `<p class="resident-next">At the top of the ladder, held only while the evidence holds.</p>`;

      return `
        <article class="resident-card" style="--resident-color:${escapeHtml(color)}">
          <header class="resident-card-head">
            <div>
              <h3>${escapeHtml(persona.name)}</h3>
              <p class="resident-lane">${escapeHtml(persona.lane)} · ${escapeHtml(persona.homeRoom)} · ${persona.bpmMin}–${persona.bpmMax} BPM</p>
            </div>
            <div class="resident-level" aria-label="Level ${persona.level}, ${escapeHtml(persona.levelTitle)}">
              <span class="resident-level-number">${persona.level}</span>
              <span class="resident-level-title">${escapeHtml(persona.levelTitle)}</span>
            </div>
          </header>
          <p class="resident-tagline">${escapeHtml(persona.tagline)}</p>
          <p class="resident-signature">${escapeHtml(persona.signatureMove)}</p>
          <dl class="resident-metrics">
            <div><dt>Craft</dt><dd>${Math.round(persona.craftScore)}</dd></div>
            <div><dt>Reach</dt><dd>${Math.round(persona.reachScore)}</dd></div>
            <div><dt>Experience</dt><dd>${persona.experience}</dd></div>
            <div><dt>Sets aired</dt><dd>${persona.setsAired}</dd></div>
          </dl>
          <ul class="resident-ladder">${ladder}</ul>
          ${next}
          ${evaluation
            ? `<p class="resident-evidence">${evaluation.measured
                ? `Last measured ${escapeHtml(evaluation.evaluatedOn)} across ${evaluation.setsAired} aired ${evaluation.setsAired === 1 ? "set" : "sets"}: ${Math.round(evaluation.listenerMinutes)} listener minutes, ${Math.round(evaluation.retention * 100)}% stayed through.`
                : `No aired sets in the last window, so the level is holding on older evidence.`}</p>`
            : ""}
          ${when ? `<p class="resident-next-slot">Next on air ${escapeHtml(when.day)} at ${escapeHtml(when.time)}${slot.title ? ` · ${escapeHtml(slot.title)}` : ""}</p>` : ""}
          ${persona.status !== "resident" ? `<p class="resident-status">${escapeHtml(persona.status)}</p>` : ""}
        </article>
      `;
    }).join("");
  }

  if (!residentSetsBlock || !residentSets) return;
  const sets = state.personaSets.filter(set => state.canManagePersonas || ["approved", "aired"].includes(set.status));
  residentSetsBlock.hidden = !sets.length;
  if (!sets.length) {
    residentSets.innerHTML = "";
    return;
  }

  residentSets.innerHTML = sets.slice(0, 8).map(set => {
    const persona = state.personas.find(entry => entry.id === set.personaId);
    const when = formatScheduleDate(set.plannedFor);
    const color = persona?.accentColor || roomColors[set.room] || roomColors.club;
    const order = set.tracks.slice(0, 12).map(track => `
      <li>
        <span class="resident-track-title">${escapeHtml(track.title)}</span>
        <span class="resident-track-artist">${escapeHtml(track.artistName)}</span>
        ${track.transitionIn ? `<span class="resident-track-transition">${escapeHtml(track.transitionIn.style)} · ${track.transitionIn.bars} bars</span>` : `<span class="resident-track-transition">opens the set</span>`}
      </li>
    `).join("");
    const talk = set.talkBreaks.map(line => `<li>${escapeHtml(line.text)}</li>`).join("");

    return `
      <article class="resident-set" style="--resident-color:${escapeHtml(color)}">
        <header>
          <h4>${escapeHtml(persona?.name || set.personaId)} · ${escapeHtml(when.day)} ${escapeHtml(when.time)}</h4>
          <span class="resident-set-status" data-status="${escapeHtml(set.status)}">${escapeHtml(set.status)}</span>
        </header>
        <p class="resident-set-meta">${escapeHtml(set.room)} · ${set.durationMinutes} minutes · ${set.tracks.length} records · ${escapeHtml(set.energyArc)} arc${set.usedFallback ? " · written from templates" : ""}</p>
        <ol class="resident-track-list">${order}</ol>
        ${talk ? `<ul class="resident-talk">${talk}</ul>` : `<p class="resident-talk-empty">Silent set. This resident has not earned the microphone yet.</p>`}
        ${set.talkLinesDropped ? `<p class="resident-talk-dropped">${set.talkLinesDropped} written ${set.talkLinesDropped === 1 ? "line was" : "lines were"} dropped for citing nothing verifiable.</p>` : ""}
        ${state.canManagePersonas ? `
          <div class="resident-set-actions">
            ${set.status === "planned" ? `<button type="button" data-persona-approve="${escapeHtml(set.id)}">Approve for air</button>` : ""}
            ${set.status === "approved" ? `<button type="button" data-persona-air="${escapeHtml(set.id)}">Mark as aired</button>` : ""}
            ${["planned", "approved"].includes(set.status) ? `<button type="button" class="ghost" data-persona-skip="${escapeHtml(set.id)}">Skip</button>` : ""}
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

function applyPersonaDashboard(dashboard) {
  if (!dashboard) return;
  state.personas = dashboard.personas || [];
  state.personaSets = dashboard.sets || [];
  state.canManagePersonas = Boolean(dashboard.canManage);
  renderResidents();
}

async function loadResidents() {
  if (!residentGrid) return;
  try {
    const response = await fetch("/api/radio/personas", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) throw new Error("Residents unavailable");
    applyPersonaDashboard(await response.json());
  } catch {
    residentGrid.innerHTML = `<p class="empty-state">The resident roster is temporarily unavailable.</p>`;
  }
}

async function personaAction(payload, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/radio/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The resident action could not be completed");
    applyPersonaDashboard(data.dashboard);
    return data;
  } finally {
    if (button) button.disabled = false;
  }
}

function renderGemma(data) {
  state.gemma = data;
  const assessment = data.assessment;
  const health = data.health;
  const stateName = assessment?.state || (health?.status === "live" ? "stable" : health?.status === "standby" ? "waiting" : "attention");
  const headline = assessment?.headline || (health?.summary ? `Station state: ${health.status}` : "Gemma is waiting for station evidence");
  const summary = assessment?.summary || health?.summary || "Run a fresh verification to inspect the radio stack.";
  const priorities = assessment?.priorities?.length
    ? assessment.priorities
    : [(data.configured ? "The protected update relay is ready." : "Connect the protected operator relay before remote updates are enabled.")];
  gemmaStatus.dataset.state = stateName;
  gemmaStatus.querySelector("strong").textContent = headline;
  gemmaStatus.querySelector("p").textContent = summary;
  gemmaPriorities.innerHTML = priorities.map(item => `<li>${escapeHtml(item)}</li>`).join("");
  gemmaRelay.textContent = data.configured
    ? "Protected relay connected · owner approval remains required"
    : "Observation active · protected update relay not connected";
}

async function loadGemmaStatus() {
  if (!state.canManageSchedule) return;
  try {
    const response = await fetch("/api/radio/gemma", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Gemma's operator desk is unavailable");
    renderGemma(data);
  } catch (error) {
    gemmaStatus.dataset.state = "attention";
    gemmaStatus.querySelector("strong").textContent = "Gemma could not open the operator channel";
    gemmaStatus.querySelector("p").textContent = error instanceof Error ? error.message : "The operator channel is unavailable.";
  }
}

async function runGemmaAction(action) {
  const buttons = [...document.querySelectorAll("[data-gemma-action]")];
  if (action === "watchtower_update" && !window.confirm("Approve Gemma to request an AzuraCast update check now?")) return;
  buttons.forEach(button => { button.disabled = true; });
  stationDeskNotice.textContent = action === "watchtower_update" ? "Sending the approved update check through Gemma's protected relay…" : "Gemma is reading the latest station evidence…";
  try {
    const response = await fetch("/api/radio/gemma", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, approved: action === "watchtower_update" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Gemma could not complete the operator action");
    renderGemma(data);
    stationDeskNotice.textContent = data.message || (action === "assess" ? "Gemma completed the station assessment." : "Gemma completed the operator action.");
  } catch (error) {
    stationDeskNotice.textContent = error instanceof Error ? error.message : "Gemma's operator channel is unavailable.";
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function editShow(showId) {
  const show = state.schedule.find(item => item.id === showId);
  if (!show || !state.canManageSchedule) return;
  Object.entries({
    id: show.id,
    title: show.title,
    room: show.room,
    showType: show.showType,
    dayOfWeek: String(show.dayOfWeek),
    startTimeUtc: show.startTimeUtc,
    durationMinutes: String(show.durationMinutes),
    status: show.status,
    hostName: show.hostName,
    producerName: show.producerName,
    artistSlug: show.artistSlug,
    artworkUrl: show.artworkUrl,
    description: show.description
  }).forEach(([name, value]) => {
    const field = showForm.elements.namedItem(name);
    if (field) field.value = value || "";
  });
  stationDeskNotice.textContent = `Editing ${show.title}.`;
  if (!stationDeskDialog.open) stationDeskDialog.showModal();
  showForm.elements.title.focus();
}

async function submitDeskForm(event, action) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.action = action;
  if (payload.startsAt) payload.startsAt = new Date(payload.startsAt).toISOString();
  await stationAction(payload, form);
  if (action !== "save_show") form.reset();
}

function activeRoom() {
  return state.rooms.find(room => room.id === state.activeRoom) || state.rooms[0];
}

function activeRoomHealth() {
  return state.health?.rooms?.find(room => room.id === state.activeRoom) || null;
}

function currentMix() {
  return state.mixes[state.mixIndex] || null;
}

function takeoverMix() {
  return state.mixes.find(mix => mix.stationFallback || mix.id === "preview-pool-60-minute-mix") || null;
}

function mixSegment(mix, index = 0) {
  if (mix?.videoId) return null;
  return mix?.playlist?.[index] || (mix ? {
    audioUrl: mix.audioUrl,
    playSeconds: mix.durationSeconds || 0
  } : null);
}

function currentMixSegment() {
  return mixSegment(currentMix(), state.mixSegmentIndex);
}

function takeoverMixSegment() {
  return mixSegment(takeoverMix(), state.takeoverSegmentIndex);
}

function mixElapsed(mix, segmentIndex) {
  if (!mix?.playlist?.length) return stationAudio.currentTime || 0;
  return mix.playlist.slice(0, segmentIndex).reduce((total, segment) => total + Number(segment.playSeconds || 0), 0)
    + Math.min(stationAudio.currentTime || 0, Number(mixSegment(mix, segmentIndex)?.playSeconds || 0));
}

function currentMixElapsed() {
  if (currentMix()?.videoId && state.youtubeLongPlayActive && state.fallbackPlayerReady) {
    return Number(state.fallbackPlayer.getCurrentTime?.() || 0);
  }
  return mixElapsed(currentMix(), state.mixSegmentIndex);
}

function audioSourceMatches(audio, source) {
  return Boolean(source && audio.getAttribute("src") === source);
}

function currentPlaybackBpm() {
  if (state.takeoverFallbackActive) return Number(takeoverMixSegment()?.bpm || takeoverMix()?.bpm || 0);
  if (state.activeRoom === "longplay") return Number(currentMixSegment()?.bpm || currentMix()?.bpm || 0);
  const room = activeRoom();
  return Number(!room?.streamUrl ? rotationTrack(room)?.bpm || 0 : 0);
}

function nextSeamlessTarget() {
  if (state.takeoverFallbackActive) {
    const mix = takeoverMix();
    const playlist = mix?.playlist || [];
    if (state.takeoverSegmentIndex + 1 < playlist.length) {
      const nextIndex = state.takeoverSegmentIndex + 1;
      const segment = mixSegment(mix, nextIndex);
      return segment?.audioUrl ? {
        source: segment.audioUrl,
        bpm: Number(segment.bpm || mix?.bpm || 0),
        commit() { state.takeoverSegmentIndex = nextIndex; }
      } : null;
    }
    const room = activeRoom();
    const track = room?.rotation?.[0];
    return track?.audioUrl ? {
      source: track.audioUrl,
      bpm: Number(track.bpm || 0),
      commit() {
        state.takeoverFallbackActive = false;
        state.takeoverFallbackRoom = "";
        state.takeoverSegmentIndex = 0;
        state.rotationIndexes[room.id] = 0;
      }
    } : null;
  }

  if (state.activeRoom === "longplay") {
    const mix = currentMix();
    const playlist = mix?.playlist || [];
    if (state.mixSegmentIndex + 1 < playlist.length) {
      const nextIndex = state.mixSegmentIndex + 1;
      const segment = mixSegment(mix, nextIndex);
      return segment?.audioUrl ? {
        source: segment.audioUrl,
        bpm: Number(segment.bpm || mix?.bpm || 0),
        commit() { state.mixSegmentIndex = nextIndex; }
      } : null;
    }
    if (!state.mixes.length) return null;
    const nextIndex = (state.mixIndex + 1) % state.mixes.length;
    const nextMix = state.mixes[nextIndex];
    const segment = mixSegment(nextMix, 0);
    return !nextMix?.videoId && segment?.audioUrl ? {
      source: segment.audioUrl,
      bpm: Number(segment.bpm || nextMix?.bpm || 0),
      commit() {
        state.mixIndex = nextIndex;
        state.mixSegmentIndex = 0;
        syncLongPlayRoom();
      }
    } : null;
  }

  const room = activeRoom();
  if (room?.streamUrl || !room?.rotation?.length) return null;
  const nextIndex = rotationIndex(room) + 1;
  if (nextIndex < room.rotation.length) {
    const track = room.rotation[nextIndex];
    return {
      source: track.audioUrl,
      bpm: Number(track.bpm || 0),
      commit() { state.rotationIndexes[room.id] = nextIndex; }
    };
  }
  const mix = takeoverMix();
  const segment = mixSegment(mix, 0);
  return segment?.audioUrl ? {
    source: segment.audioUrl,
    bpm: Number(segment.bpm || mix?.bpm || 0),
    commit() {
      state.takeoverFallbackActive = true;
      state.takeoverFallbackRoom = room.id;
      state.takeoverSegmentIndex = 0;
    }
  } : null;
}

function prepareStandbyAudio() {
  if (state.audioTransitioning) return;
  const target = nextSeamlessTarget();
  if (!target?.source || audioSourceMatches(stationAudio, target.source)) return;
  if (!audioSourceMatches(standbyAudio, target.source)) {
    standbyAudio.pause();
    standbyAudio.src = target.source;
    standbyAudio.preload = "auto";
    standbyAudio.load();
  }
  standbyAudio.volume = 0;
  standbyAudio.playbackRate = 1;
}

function cancelAudioTransition() {
  if (state.audioTransitionTimer) window.clearTimeout(state.audioTransitionTimer);
  state.audioTransitionTimer = 0;
  state.audioTransitioning = false;
  document.querySelector(".transition-lab")?.classList.remove("is-mixing");
  standbyAudio.pause();
  standbyAudio.volume = 1;
  standbyAudio.playbackRate = 1;
  stationAudio.volume = 1;
  stationAudio.playbackRate = 1;
}

function tempoMatchRate(outgoingBpm, incomingBpm) {
  if (state.transitionMode !== "beat" || !outgoingBpm || !incomingBpm) return 1;
  return Math.min(1.06, Math.max(.94, outgoingBpm / incomingBpm));
}

async function startSeamlessTransition() {
  if (state.audioTransitioning) return false;
  const target = nextSeamlessTarget();
  if (!target?.source) return false;
  state.audioTransitioning = true;
  const outgoing = stationAudio;
  const incoming = standbyAudio;
  const blendSeconds = Math.max(0, Number(state.transitionSeconds || 0));
  if (!audioSourceMatches(incoming, target.source)) {
    incoming.src = target.source;
    incoming.preload = "auto";
    incoming.load();
  }
  incoming.volume = blendSeconds ? 0 : 1;
  incoming.playbackRate = tempoMatchRate(currentPlaybackBpm(), target.bpm);
  incoming.preservesPitch = true;
  try { incoming.currentTime = 0; } catch {}
  try {
    await incoming.play();
  } catch {
    state.audioTransitioning = false;
    incoming.volume = 1;
    incoming.playbackRate = 1;
    return false;
  }

  stationAudio = incoming;
  standbyAudio = outgoing;
  target.commit();
  state.rotationErrorCount = 0;
  renderConsole();
  document.querySelector(".transition-lab")?.classList.add("is-mixing");
  transitionReadout.textContent = blendSeconds ? `Mixing ${blendSeconds} seconds · no dead air` : "Instant cut · no dead air";

  const startedAt = performance.now();
  const finish = () => {
    standbyAudio.pause();
    try { standbyAudio.currentTime = 0; } catch {}
    standbyAudio.volume = 1;
    standbyAudio.playbackRate = 1;
    stationAudio.volume = 1;
    stationAudio.playbackRate = 1;
    state.audioTransitionTimer = 0;
    state.audioTransitioning = false;
    document.querySelector(".transition-lab")?.classList.remove("is-mixing");
    updateTransitionReadout();
    prepareStandbyAudio();
  };
  if (!blendSeconds) {
    finish();
    return true;
  }
  const drawFade = timestamp => {
    const progress = Math.min(1, (timestamp - startedAt) / (blendSeconds * 1000));
    standbyAudio.volume = Math.cos(progress * Math.PI / 2);
    stationAudio.volume = Math.sin(progress * Math.PI / 2);
    stationAudio.playbackRate += (1 - stationAudio.playbackRate) * Math.min(1, progress * .08);
    if (progress >= 1) finish();
    else state.audioTransitionTimer = window.setTimeout(() => drawFade(performance.now()), 40);
  };
  state.audioTransitionTimer = window.setTimeout(() => drawFade(performance.now()), 40);
  return true;
}

function maybeStartSeamlessTransition(totalSeconds) {
  const blendSeconds = Number(state.transitionSeconds || 0);
  if (!blendSeconds || state.audioTransitioning || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return;
  const remaining = totalSeconds - stationAudio.currentTime;
  if (remaining > 0 && remaining <= Math.min(blendSeconds, totalSeconds * .45)) startSeamlessTransition();
}

function updateTransitionReadout() {
  const seconds = Number(state.transitionSeconds || 0);
  transitionReadout.textContent = seconds ? `${seconds} second${seconds === 1 ? "" : "s"} · no dead air` : "Instant cut · no dead air";
}

function longPlayRoom() {
  const mix = currentMix();
  const next = state.mixes.length ? state.mixes[(state.mixIndex + 1) % state.mixes.length] : null;
  const fallbackTitle = state.mixLibraryStatus === "loading"
    ? "Long-play library loading"
    : state.mixLibraryStatus === "error"
      ? "Long-play library needs a retry"
      : "No full-length mixes yet";
  return {
    id: "longplay",
    name: "Long Play",
    frequency: "04",
    strapline: "Uninterrupted DJ journeys",
    description: "Full-length HALO mixes, creator sessions and deep listens without the short-form cutoff.",
    ready: Boolean(mix),
    demo: false,
    longPlay: true,
    streamUrl: mix?.audioUrl || "",
    listeners: 0,
    isLive: false,
    nowPlaying: {
      title: mix?.title || fallbackTitle,
      artist: mix?.creator?.name || "HALO selectors",
      artwork: mix?.creator?.avatar || "",
      elapsed: state.activeRoom === "longplay" ? currentMixElapsed() : 0,
      duration: mix?.videoId && state.youtubeLongPlayActive
        ? Number(state.fallbackPlayer?.getDuration?.() || 0)
        : mix?.durationSeconds || stationAudio.duration || 0
    },
    next: {
      title: next?.title || "More full-length sessions",
      artist: next?.creator?.name || "HALO mix cloud"
    },
    library: { rotation: state.mixes.length, preview: 0 }
  };
}

function syncLongPlayRoom() {
  state.rooms = [...state.rooms.filter(room => room.id !== "longplay"), longPlayRoom()];
}

function renderLongPlayQueue() {
  const loading = state.mixLibraryStatus === "loading";
  mixQueueCount.textContent = loading ? "READING" : state.mixLibraryStatus === "error" ? "RETRY" : `${state.mixes.length} ${state.mixes.length === 1 ? "SESSION" : "SESSIONS"}`;
  longPlayQueue.setAttribute("aria-busy", String(loading));
  previousMixButton.disabled = state.mixes.length < 2;
  nextMixButton.disabled = state.mixes.length < 2;
  if (loading) {
    longPlayQueue.innerHTML = `<div class="mix-loading-state" role="status"><span>Reading the long-play library</span><div class="mix-loading-graph" aria-hidden="true">${"<i></i>".repeat(12)}</div><small>Connecting to the mix cloud</small></div>`;
    return;
  }
  if (state.mixLibraryStatus === "error") {
    longPlayQueue.innerHTML = `<div class="mix-loading-state" role="status"><span>The mix cloud did not answer</span><small>${escapeHtml(state.mixLibraryError || "Check the signal and try again")}</small><button class="mix-retry-button" type="button" data-retry-mixes>Retry library</button></div>`;
    return;
  }
  if (!state.mixes.length) {
    longPlayQueue.innerHTML = `<p>No full-length mixes are available yet. Open the DJ deck and record the first session.</p>`;
    return;
  }
  longPlayQueue.innerHTML = state.mixes.map((mix, index) => `
    <button class="mix-queue-item ${state.activeRoom === "longplay" && index === state.mixIndex ? "active" : ""}" type="button" data-mix-index="${index}" aria-label="Play ${escapeHtml(mix.title)} by ${escapeHtml(mix.creator.name)}">
      <span class="mix-queue-number">${index === state.mixIndex && state.activeRoom === "longplay" && (youtubeLongPlayPlaying() || !stationAudio.paused) ? "Ⅱ" : String(index + 1).padStart(2, "0")}</span>
      <span class="mix-queue-copy"><strong>${escapeHtml(mix.title)}</strong><small>${escapeHtml(mix.creator.name)} · ${mix.videoId ? "YouTube Long Play" : `${mix.trackCount || "DJ"} ${mix.trackCount === 1 ? "track" : "tracks"} · ${mix.playCount} plays`}</small></span>
      <span class="mix-queue-time">${escapeHtml(formatDuration(mix.durationSeconds, "Long play"))}</span>
    </button>
  `).join("");
}

function renderRooms() {
  roomGrid.innerHTML = state.rooms.map(room => {
    const health = state.health?.rooms?.find(item => item.id === room.id);
    const status = room.longPlay
      ? room.ready ? `${state.mixes.length} full-length ${state.mixes.length === 1 ? "mix" : "mixes"} · always on` : "Waiting for the first full-length mix"
      : health?.reachable ? `Signal verified · ${room.listeners} connected` : room.rotation?.length ? `${room.rotation.length} station ${room.rotation.length === 1 ? "track" : "tracks"} ready` : room.ready ? "Signal check in progress" : "HALO listening-party mix ready";
    return `
    <button class="room-card ${room.id === state.activeRoom ? "active" : ""}" type="button" data-room="${room.id}" style="--room-color:${roomColors[room.id]}">
      <span class="room-number"><span>Frequency ${escapeHtml(room.frequency)}</span><i></i></span>
      <h3>${escapeHtml(room.name)}</h3>
      <p>${escapeHtml(room.description)}</p>
      <span class="room-meta"><span>${escapeHtml(room.strapline)}</span><strong>${escapeHtml(status)}</strong></span>
    </button>
  `;
  }).join("");
}

function rotationIndex(room) {
  const queueLength = room?.rotation?.length || 0;
  if (!queueLength) return 0;
  return (state.rotationIndexes[room.id] || 0) % queueLength;
}

function rotationTrack(room, offset = 0) {
  const queue = room?.rotation || [];
  if (!queue.length) return null;
  return queue[(rotationIndex(room) + offset + queue.length) % queue.length];
}

function displayedTrack(room) {
  if (!room?.streamUrl && rotationTrack(room)) {
    const track = rotationTrack(room);
    return { ...track, elapsed: stationAudio.currentTime || 0, artwork: "" };
  }
  return room.nowPlaying;
}

function renderConsole() {
  const room = activeRoom();
  if (!room) return;
  const fallbackActive = state.fallbackMixActive;
  const youtubeLongPlayActive = state.youtubeLongPlayActive && room.longPlay;
  const takeover = state.takeoverFallbackActive ? takeoverMix() : null;
  const takeoverActive = Boolean(takeover);
  const nowPlaying = fallbackActive ? fallbackMix : takeoverActive ? {
    title: takeover.title,
    artist: takeover.creator?.name || "DJ HALO X",
    artwork: takeover.creator?.avatar || "",
    elapsed: mixElapsed(takeover, state.takeoverSegmentIndex),
    duration: takeover.durationSeconds || 0
  } : displayedTrack(room);
  const nextRotation = !room.streamUrl ? rotationTrack(room, 1) : null;
  document.body.dataset.room = room.id;
  document.querySelector("#activeRoomLabel").textContent = `${room.name} / Frequency ${room.frequency}`;
  document.querySelector("#trackTitle").textContent = nowPlaying.title;
  document.querySelector("#trackArtist").textContent = fallbackActive ? nowPlaying.artist : room.isLive && room.liveName ? `Live with ${room.liveName}` : nowPlaying.artist;
  document.querySelector("#listenerCount").textContent = fallbackActive ? "HALO recovery signal" : takeoverActive ? "DJ HALO X station fallback" : room.longPlay ? `${state.mixes.length} sessions in rotation` : room.rotation?.length && !room.streamUrl ? `${room.rotation.length} tracks in rotation` : `${room.listeners} connected`;
  document.querySelector("#nextTrack").textContent = fallbackActive ? "Next song in the Halo playlist" : takeoverActive ? "Returns to the newest room upload" : nextRotation ? `${nextRotation.artist} — ${nextRotation.title}` : `${room.next.artist} — ${room.next.title}`;
  const health = activeRoomHealth();
  document.querySelector("#signalStatus").textContent = fallbackActive
    ? fallbackMixPlaying() ? "HALO listening-party fallback playing" : "HALO listening-party fallback ready"
    : takeoverActive
      ? stationAudio.paused ? "DJ HALO X takeover fallback paused" : "DJ HALO X takeover fallback playing"
    : room.longPlay
    ? state.mixLibraryStatus === "loading"
      ? "Reading the Long Play library"
      : state.mixLibraryStatus === "error"
        ? "Long Play could not load · retry below"
        : !room.ready
          ? "Long Play is waiting for the first mix"
          : youtubeLongPlayActive
            ? youtubeLongPlayPlaying() ? "YouTube Long Play transmission playing" : "YouTube Long Play paused"
          : stationAudio.paused
            ? "Long Play queue ready"
            : "Full-length mix transmission playing"
    : !room.streamUrl && rotationTrack(room) ? stationAudio.paused ? "Station rotation ready" : "Halo catalog rotation playing" : health?.reachable ? (room.isLive ? "Live creator broadcast verified" : "Automated signal verified") : room.ready ? "Signal verification needs attention" : "HALO listening-party fallback ready";
  document.querySelector("#serviceName").textContent = fallbackActive ? "YouTube playlist rotation" : youtubeLongPlayActive ? "YouTube Long Play" : takeoverActive ? "HALO Mix Cloud" : room.longPlay ? "HALO Mix Cloud" : state.service === "azuracast" ? "AzuraCast" : state.service === "direct" ? "Direct stream" : "HALO mix fallback";
  document.querySelector("#programmingMode").textContent = fallbackActive ? "Continuous artist playlist" : youtubeLongPlayActive ? "Alternating Long Play rotation" : takeoverActive ? "60-minute station takeover" : room.longPlay ? "Continuous DJ mix rotation" : !room.streamUrl && rotationTrack(room) ? "Database track rotation" : "Community review";
  const artwork = document.querySelector("#artwork");
  artwork.style.backgroundImage = nowPlaying.artwork ? `linear-gradient(rgba(0,0,0,.12), rgba(0,0,0,.2)), url("${encodeURI(nowPlaying.artwork)}")` : "";
  document.querySelector("#artworkLetter").hidden = Boolean(nowPlaying.artwork);
  const progress = fallbackActive ? fallbackMixProgress() : nowPlaying.duration ? Math.min(100, Number(nowPlaying.elapsed || 0) / nowPlaying.duration * 100) : 0;
  const progressIsIndeterminate = room.longPlay && state.mixLibraryStatus === "loading";
  playbackProgress.classList.toggle("is-indeterminate", progressIsIndeterminate);
  playbackProgress.toggleAttribute("aria-valuenow", !progressIsIndeterminate);
  playbackProgress.toggleAttribute("aria-valuetext", progressIsIndeterminate);
  if (progressIsIndeterminate) playbackProgress.setAttribute("aria-valuetext", "Reading the Long Play library");
  else playbackProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
  document.querySelector("#trackProgress").style.width = `${progress}%`;
  renderRooms();
  renderLongPlayQueue();
}

function fallbackMixPlaying() {
  return Boolean(state.fallbackMixActive && state.fallbackPlayerReady && state.fallbackPlayer?.getPlayerState?.() === 1);
}

function youtubeLongPlayPlaying() {
  return Boolean(state.youtubeLongPlayActive && state.fallbackPlayerReady && state.fallbackPlayer?.getPlayerState?.() === 1);
}

function fallbackMixProgress() {
  if (!state.fallbackPlayerReady) return 0;
  const duration = Number(state.fallbackPlayer?.getDuration?.() || 0);
  const elapsed = Number(state.fallbackPlayer?.getCurrentTime?.() || 0);
  return duration ? Math.min(100, elapsed / duration * 100) : 0;
}

function syncFallbackShell() {
  const mix = currentMix();
  fallbackMixElement.hidden = !state.fallbackMixActive && !state.youtubeLongPlayActive;
  youtubePlayerLabel.textContent = state.youtubeLongPlayActive ? "Frequency 04 / YouTube Long Play" : "HALO artist rotation / YouTube";
  youtubePlayerTitle.textContent = state.youtubeLongPlayActive ? mix?.title || "YouTube Long Play" : "Continuous Halo Playlist";
  youtubePlayerDescription.textContent = state.youtubeLongPlayActive
    ? `${mix?.creator?.name || "HALO selector"} joins the alternating Long Play queue.`
    : "The playlist keeps the station moving while more artists join the rotation.";
}

function refreshFallbackMetadata() {
  const video = state.fallbackPlayer?.getVideoData?.();
  if (!video?.video_id || state.youtubeLongPlayActive) return;
  fallbackMix.title = video.title || "Halo Artist Playlist";
  fallbackMix.artist = video.author || "Halo Music";
  fallbackMix.artwork = `https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`;
}

function handleFallbackStateChange(event) {
  refreshFallbackMetadata();
  renderConsole();
  syncPlayState();
  if (state.youtubeLongPlayActive && event?.data === window.YT?.PlayerState?.ENDED) advanceLongPlay();
}

function initializeFallbackPlayer() {
  if (!window.YT?.Player || state.fallbackPlayer) return;
  state.fallbackPlayer = new window.YT.Player("fallbackVideo", {
    playerVars: {
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      listType: "playlist",
      list: fallbackMix.playlistId,
      loop: 1
    },
    events: {
      onReady: () => {
        state.fallbackPlayerReady = true;
        state.fallbackPlayer.setLoop(state.youtubePlayerMode === "recovery");
        refreshFallbackMetadata();
        if (state.youtubeLongPlayPending && currentMix()?.videoId) {
          state.youtubeLongPlayPending = false;
          state.youtubePlayerMode = "longplay";
          state.youtubeVideoId = currentMix().videoId;
          state.fallbackPlayer.loadVideoById(currentMix().videoId);
        } else if (state.fallbackPlayPending) {
          state.fallbackPlayPending = false;
          state.fallbackPlayer.playVideo();
        }
      },
      onStateChange: handleFallbackStateChange,
      onError: () => {
        document.querySelector("#signalStatus").textContent = "Open the HALO artist playlist on YouTube";
      }
    }
  });
}

function loadFallbackPlayer() {
  if (window.YT?.Player) return initializeFallbackPlayer();
  if (document.querySelector("#youtubeIframeApi")) return;
  window.onYouTubeIframeAPIReady = initializeFallbackPlayer;
  const script = document.createElement("script");
  script.id = "youtubeIframeApi";
  script.src = "https://www.youtube.com/iframe_api";
  document.head.append(script);
}

function stopFallbackMix() {
  if (state.fallbackPlayerReady && !state.youtubeLongPlayActive) state.fallbackPlayer.pauseVideo();
  state.fallbackPlayPending = false;
  state.fallbackMixActive = false;
  syncFallbackShell();
}

function stopYouTubeLongPlay() {
  if (state.fallbackPlayerReady && !state.fallbackMixActive) state.fallbackPlayer.pauseVideo();
  state.youtubeLongPlayPending = false;
  state.youtubeLongPlayActive = false;
  syncFallbackShell();
}

function stopTakeoverFallback() {
  state.takeoverFallbackActive = false;
  state.takeoverFallbackRoom = "";
  state.takeoverSegmentIndex = 0;
}

async function playFallbackMix() {
  const wasPlaying = fallbackMixPlaying();
  cancelAudioTransition();
  stationAudio.pause();
  if (state.previewAudio) state.previewAudio.pause();
  stopTakeoverFallback();
  stopYouTubeLongPlay();
  state.fallbackMixActive = true;
  syncFallbackShell();
  renderConsole();
  if (wasPlaying) {
    state.fallbackPlayer.pauseVideo();
    return;
  }
  if (state.fallbackPlayerReady) {
    if (state.youtubePlayerMode !== "recovery") {
      state.youtubePlayerMode = "recovery";
      state.youtubeVideoId = "";
      state.fallbackPlayer.loadPlaylist({ listType: "playlist", list: fallbackMix.playlistId, index: 0 });
      state.fallbackPlayer.setLoop(true);
    } else state.fallbackPlayer.playVideo();
  }
  else {
    state.fallbackPlayPending = true;
    loadFallbackPlayer();
  }
}

async function playTakeoverFallback(roomId = activeRoom()?.id, forcePlay = false) {
  const mix = takeoverMix();
  if (!mix) return playFallbackMix();
  const continuing = state.takeoverFallbackActive && state.takeoverFallbackRoom === roomId;
  cancelAudioTransition();
  if (!continuing) state.takeoverSegmentIndex = 0;
  state.takeoverFallbackActive = true;
  state.takeoverFallbackRoom = roomId || "";
  const segment = takeoverMixSegment();
  if (!segment?.audioUrl) return playFallbackMix();
  const sameSegment = stationAudio.getAttribute("src") === segment.audioUrl;
  stopYouTubeLongPlay();
  stopFallbackMix();
  if (state.previewAudio) state.previewAudio.pause();
  if (!sameSegment) {
    stationAudio.src = segment.audioUrl;
    stationAudio.load();
  }
  renderConsole();
  if (sameSegment && !stationAudio.paused && !forcePlay) {
    stationAudio.pause();
    return;
  }
  try {
    await stationAudio.play();
    prepareStandbyAudio();
  } catch {
    document.querySelector("#signalStatus").textContent = "Tap play again to start the DJ HALO X takeover";
  }
}

async function advanceTakeoverFallback() {
  if (state.advancingTakeoverFallback || !state.takeoverFallbackActive) return;
  state.advancingTakeoverFallback = true;
  try {
    if (await startSeamlessTransition()) return;
    const mix = takeoverMix();
    const playlist = mix?.playlist || [];
    if (state.takeoverSegmentIndex + 1 < playlist.length) {
      state.takeoverSegmentIndex += 1;
      const segment = takeoverMixSegment();
      stationAudio.src = segment.audioUrl;
      stationAudio.load();
      await stationAudio.play();
      renderConsole();
      return;
    }
    const fallbackRoom = state.takeoverFallbackRoom;
    stopTakeoverFallback();
    const room = activeRoom();
    if (room?.id === fallbackRoom && !room.streamUrl && room.rotation?.length) await playRotation(0, true);
    else await playCurrentRoom();
  } finally {
    state.advancingTakeoverFallback = false;
  }
}

function healthCopy(status) {
  if (status === "live") return "Station live and verified";
  if (status === "degraded") return "Station needs attention";
  if (status === "standby") return "Systems ready / stream pending";
  if (status === "offline") return "Station monitor offline";
  return "Verifying the network";
}

function renderHealth() {
  const health = state.health;
  if (!health) return;
  const watch = document.querySelector("#signalWatch");
  watch.dataset.health = health.status;
  document.body.dataset.radioHealth = health.status;
  document.querySelector("#healthStatus").textContent = healthCopy(health.status);
  document.querySelector("#healthSummary").textContent = health.summary;
  document.querySelector("#healthScore").textContent = `${health.score}/100`;
  document.querySelector("#lastVerified").textContent = `Verified ${new Date(health.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  document.querySelector("#agentRail").innerHTML = (health.agents || []).map(agent => `
    <article data-status="${escapeHtml(agent.status)}">
      <span aria-hidden="true"></span>
      <div><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.role)} · ${escapeHtml(agent.status)}</small></div>
    </article>
  `).join("");
  renderConsole();
}

async function loadHealth() {
  try {
    const response = await fetch("/api/radio/health", { headers: { Accept: "application/json" } });
    const health = await response.json();
    if (!health?.checkedAt || !health?.serverTime) throw new Error("Health response was incomplete");
    state.health = health;
    state.serverOffsetMs = Date.parse(health.serverTime) - Date.now();
    renderHealth();
  } catch {
    state.health = {
      status: "offline",
      score: 0,
      checkedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      summary: "The station monitor could not complete its latest check.",
      rooms: [],
      agents: [
        { name: "Signal Agent", role: "Stream reachability", status: "attention" },
        { name: "Clock Agent", role: "Time and freshness", status: "attention" },
        { name: "Data Agent", role: "Station metadata", status: "attention" },
        { name: "Recovery Agent", role: "Maintenance escalation", status: "attention" }
      ]
    };
    renderHealth();
  }
}

function updateNetworkClock() {
  document.querySelector("#networkTime").textContent = new Date(Date.now() + state.serverOffsetMs).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function drawSignalScope(timestamp = 0) {
  if (!signalScope) return;
  const bounds = signalScope.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  if (signalScope.width !== width || signalScope.height !== height) {
    signalScope.width = width;
    signalScope.height = height;
  }
  const context = signalScope.getContext("2d");
  const health = state.health?.status || "checking";
  const playing = state.fallbackMixActive ? fallbackMixPlaying() : state.youtubeLongPlayActive ? youtubeLongPlayPlaying() : !stationAudio.paused && Boolean(stationAudio.src);
  const amplitude = health === "live" ? (playing ? 0.82 : 0.42) : health === "degraded" ? 0.18 : 0.035;
  const roomColor = roomColors[state.activeRoom] || roomColors.club;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "rgba(255,255,255,.08)";
  context.lineWidth = scale;
  for (let row = 1; row < 4; row += 1) {
    const y = height * row / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.strokeStyle = roomColor;
  context.lineWidth = Math.max(2, scale * 1.4);
  context.beginPath();
  for (let x = 0; x <= width; x += Math.max(2, scale * 2)) {
    const progress = x / width;
    const motion = timestamp / 820;
    const carrier = Math.sin(progress * 38 + motion) * 0.55 + Math.sin(progress * 83 - motion * 1.7) * 0.24 + Math.sin(progress * 17 + motion * 0.45) * 0.21;
    const envelope = 0.35 + Math.sin(progress * Math.PI) * 0.65;
    const y = height / 2 + carrier * envelope * height * amplitude * 0.42;
    if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(drawSignalScope);
}

async function loadStations({ preservePlayback = true } = {}) {
  try {
    const response = await fetch("/api/radio/stations", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Signal unavailable");
    const data = await response.json();
    state.rooms = data.rooms || [];
    state.service = data.service || "preview";
    syncLongPlayRoom();
    if (!state.rooms.some(room => room.id === state.activeRoom)) state.activeRoom = state.rooms[0]?.id || "club";
    renderConsole();
    if (!preservePlayback && !stationAudio.paused) playCurrentRoom();
  } catch {
    document.querySelector("#signalStatus").textContent = "Station data temporarily unavailable";
  }
}

async function loadMixes() {
  const activeMixId = currentMix()?.id;
  state.mixLibraryStatus = "loading";
  state.mixLibraryError = "";
  syncLongPlayRoom();
  renderConsole();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("/api/mixes?limit=100&station=longplay", { headers: { Accept: "application/json" }, credentials: "same-origin", signal: controller.signal });
    if (!response.ok) throw new Error("Mix library unavailable");
    const data = await response.json();
    state.mixes = data.mixes || [];
    state.mixLibraryStatus = "ready";
    const preservedIndex = state.mixes.findIndex(mix => mix.id === activeMixId);
    state.mixIndex = preservedIndex >= 0 ? preservedIndex : Math.min(state.mixIndex, Math.max(0, state.mixes.length - 1));
    state.mixSegmentIndex = Math.min(state.mixSegmentIndex, Math.max(0, (currentMix()?.playlist?.length || 1) - 1));
    if (state.activeRoom === "longplay" && stationAudio.getAttribute("src") && stationAudio.getAttribute("src") !== currentMixSegment()?.audioUrl) {
      stationAudio.pause();
      stationAudio.removeAttribute("src");
      stationAudio.load();
    }
    syncLongPlayRoom();
    renderConsole();
  } catch (error) {
    state.mixLibraryStatus = "error";
    state.mixLibraryError = error?.name === "AbortError" ? "The request took too long" : "The library is temporarily unavailable";
    syncLongPlayRoom();
    renderConsole();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function selectRoom(roomId) {
  if (!state.rooms.some(room => room.id === roomId)) return;
  if (roomId !== state.activeRoom) noteListenerSkip();
  const wasPlaying = fallbackMixPlaying() || youtubeLongPlayPlaying() || (!stationAudio.paused && stationAudio.src);
  state.activeRoom = roomId;
  renderConsole();
  if (wasPlaying) await playCurrentRoom();
}

async function playLongPlay(index = state.mixIndex, forcePlay = false) {
  if (!state.mixes.length) {
    return playFallbackMix();
  }
  const normalizedIndex = (index + state.mixes.length) % state.mixes.length;
  cancelAudioTransition();
  if (normalizedIndex !== state.mixIndex) state.mixSegmentIndex = 0;
  const mix = state.mixes[normalizedIndex];
  state.mixIndex = normalizedIndex;
  if (mix.videoId) return playYouTubeLongPlay(mix, forcePlay);
  const segment = currentMixSegment();
  const sameMix = stationAudio.getAttribute("src") === segment?.audioUrl;
  state.activeRoom = "longplay";
  stopTakeoverFallback();
  stopYouTubeLongPlay();
  stopFallbackMix();
  syncLongPlayRoom();
  renderConsole();
  if (sameMix && !stationAudio.paused && !forcePlay) {
    stationAudio.pause();
    return;
  }
  if (state.previewAudio) state.previewAudio.pause();
  if (!sameMix) {
    stationAudio.src = segment.audioUrl;
    stationAudio.load();
  }
  try {
    await stationAudio.play();
    state.rotationErrorCount = 0;
    prepareStandbyAudio();
  } catch {
    document.querySelector("#signalStatus").textContent = "Tap play again to start this full-length mix";
  }
}

async function playYouTubeLongPlay(mix, forcePlay = false) {
  const sameVideo = state.youtubePlayerMode === "longplay" && state.youtubeVideoId === mix.videoId;
  state.activeRoom = "longplay";
  cancelAudioTransition();
  stationAudio.pause();
  if (state.previewAudio) state.previewAudio.pause();
  stopTakeoverFallback();
  state.fallbackMixActive = false;
  state.fallbackPlayPending = false;
  state.youtubeLongPlayActive = true;
  syncLongPlayRoom();
  syncFallbackShell();
  renderConsole();
  if (sameVideo && youtubeLongPlayPlaying() && !forcePlay) {
    state.fallbackPlayer.pauseVideo();
    return;
  }
  if (state.fallbackPlayerReady) {
    state.youtubePlayerMode = "longplay";
    state.youtubeVideoId = mix.videoId;
    state.fallbackPlayer.setLoop(false);
    if (sameVideo) state.fallbackPlayer.playVideo();
    else state.fallbackPlayer.loadVideoById(mix.videoId);
  } else {
    state.youtubeLongPlayPending = true;
    loadFallbackPlayer();
  }
}

async function playRotation(index = rotationIndex(activeRoom()), forcePlay = false) {
  const room = activeRoom();
  const queue = room?.rotation || [];
  if (!room || !queue.length) return playFallbackMix();
  cancelAudioTransition();
  const normalizedIndex = (index + queue.length) % queue.length;
  state.rotationIndexes[room.id] = normalizedIndex;
  const track = queue[normalizedIndex];
  const sameTrack = stationAudio.getAttribute("src") === track.audioUrl;
  stopTakeoverFallback();
  stopYouTubeLongPlay();
  stopFallbackMix();
  renderConsole();
  if (sameTrack && !stationAudio.paused && !forcePlay) {
    stationAudio.pause();
    return;
  }
  if (state.previewAudio) state.previewAudio.pause();
  if (!sameTrack) {
    stationAudio.src = track.audioUrl;
    stationAudio.load();
  }
  try {
    await stationAudio.play();
    prepareStandbyAudio();
  } catch {
    document.querySelector("#signalStatus").textContent = "Tap play again to start the station rotation";
  }
}

async function advanceRotation() {
  const room = activeRoom();
  if (state.advancingRotation || !room?.rotation?.length) return playFallbackMix();
  state.advancingRotation = true;
  try {
    if (await startSeamlessTransition()) return;
    if (rotationIndex(room) >= room.rotation.length - 1) await playTakeoverFallback(room.id, true);
    else await playRotation(rotationIndex(room) + 1, true);
  } finally {
    state.advancingRotation = false;
  }
}

async function stepLongPlay(direction) {
  if (!state.mixes.length) return;
  noteListenerSkip();
  await playLongPlay(state.mixIndex + direction, true);
}

async function advanceLongPlay() {
  if (state.advancingLongPlay || state.activeRoom !== "longplay") return;
  state.advancingLongPlay = true;
  try {
    if (await startSeamlessTransition()) return;
    const playlist = currentMix()?.playlist || [];
    if (state.mixSegmentIndex + 1 < playlist.length) {
      state.mixSegmentIndex += 1;
      stationAudio.src = currentMixSegment().audioUrl;
      stationAudio.load();
      await stationAudio.play();
      renderConsole();
      return;
    }
    state.mixSegmentIndex = 0;
    await playLongPlay(state.mixes.length > 1 ? state.mixIndex + 1 : state.mixIndex, true);
    if (state.mixes.length === 1) stationAudio.currentTime = 0;
  } finally {
    state.advancingLongPlay = false;
  }
}

async function playCurrentRoom() {
  const room = activeRoom();
  if (room?.longPlay) return playLongPlay();
  if (!room?.streamUrl) {
    if (room?.rotation?.length) return playRotation();
    return playFallbackMix();
  }
  cancelAudioTransition();
  stopTakeoverFallback();
  stopYouTubeLongPlay();
  stopFallbackMix();
  renderConsole();
  const sameStream = stationAudio.getAttribute("src") === room.streamUrl;
  if (!sameStream) {
    stationAudio.src = room.streamUrl;
    stationAudio.load();
  }
  if (!sameStream || stationAudio.paused) {
    if (state.previewAudio) state.previewAudio.pause();
    try { await stationAudio.play(); } catch { document.querySelector("#signalStatus").textContent = "Tap play again to start the stream"; }
  } else {
    stationAudio.pause();
  }
}

function toggleCurrentPlayback() {
  if (state.fallbackMixActive) return playFallbackMix();
  if (state.youtubeLongPlayActive) return playLongPlay(state.mixIndex);
  if (state.takeoverFallbackActive) return playTakeoverFallback(state.takeoverFallbackRoom);
  return playCurrentRoom();
}

function syncPlayState() {
  const playing = state.fallbackMixActive ? fallbackMixPlaying() : state.youtubeLongPlayActive ? youtubeLongPlayPlaying() : !stationAudio.paused;
  document.body.classList.toggle("is-playing", playing);
  mainPlayButton.querySelector("span").textContent = playing ? "Ⅱ" : "▶";
  mainPlayButton.setAttribute("aria-label", playing ? "Pause Halo Radio" : "Play Halo Radio");
  if (state.fallbackMixActive) {
    document.querySelector("#signalStatus").textContent = playing ? "HALO listening-party fallback playing" : "HALO listening-party fallback paused";
  } else if (state.youtubeLongPlayActive) {
    document.querySelector("#signalStatus").textContent = playing ? "YouTube Long Play transmission playing" : "YouTube Long Play paused";
    renderLongPlayQueue();
  } else if (state.takeoverFallbackActive) {
    document.querySelector("#signalStatus").textContent = playing ? "DJ HALO X takeover fallback playing" : "DJ HALO X takeover fallback paused";
  } else if (state.activeRoom === "longplay") {
    document.querySelector("#signalStatus").textContent = playing ? "Full-length mix transmission playing" : "Long Play queue paused";
    renderLongPlayQueue();
  } else if (!activeRoom()?.streamUrl && activeRoom()?.rotation?.length) {
    document.querySelector("#signalStatus").textContent = playing ? "Halo catalog rotation playing" : "Station rotation paused";
  }
  sampleListening();
}

const HEARTBEAT_MS = 45_000;
const LISTEN_SAMPLE_MS = 5_000;
const SKIP_THRESHOLD_SECONDS = 30;
const listening = {
  active: false,
  signature: "",
  descriptor: null,
  startedAt: 0,
  pendingMs: 0,
  lastSampleAt: Date.now(),
  lastBeatAt: 0
};

function pollWhenVisible(task, intervalMs) {
  return setInterval(() => {
    if (document.visibilityState !== "visible") return;
    task();
  }, intervalMs);
}

function isListening() {
  return fallbackMixPlaying() || youtubeLongPlayPlaying() || Boolean(!stationAudio.paused && stationAudio.getAttribute("src"));
}

function listeningDescriptor() {
  if (youtubeLongPlayPlaying()) {
    const mix = currentMix();
    return { room: "longplay", station: "YouTube Long Play", track: mix?.title || "", artist: mix?.creator?.name || "" };
  }
  if (fallbackMixPlaying()) {
    return { room: "recovery", station: "recovery mix", track: fallbackMix.title, artist: fallbackMix.artist };
  }
  if (state.takeoverFallbackActive) {
    const mix = takeoverMix();
    return { room: state.takeoverFallbackRoom || "recovery", station: "DJ HALO X takeover", track: mix?.title || "", artist: mix?.creator?.name || "DJ HALO X" };
  }
  if (state.activeRoom === "longplay") {
    const mix = currentMix();
    return { room: "longplay", station: "long play", track: mix?.title || "", artist: mix?.creator?.name || "" };
  }
  const room = activeRoom();
  const latestPlay = state.recentPlays[0];
  return {
    room: room?.id || state.activeRoom || "",
    station: room?.name || "",
    track: latestPlay?.title || "",
    artist: latestPlay?.artistName || ""
  };
}

function listeningPayload(descriptor, extra = {}) {
  const payload = { room: descriptor.room, station: descriptor.station, ...extra };
  if (descriptor.track) payload.track = descriptor.track;
  if (descriptor.artist) payload.artist = descriptor.artist;
  return payload;
}

function flushListenedSeconds(descriptor) {
  const seconds = Math.floor(listening.pendingMs / 1000);
  if (seconds < 1) return;
  listening.pendingMs -= seconds * 1000;
  window.haloStats?.track("radio_heartbeat", listeningPayload(descriptor, { seconds }));
}

function endListeningSession(now) {
  if (!listening.active) return;
  const descriptor = listening.descriptor || listeningDescriptor();
  flushListenedSeconds(descriptor);
  window.haloStats?.track("radio_tune_out", listeningPayload(descriptor, {
    position: Math.round((now - listening.startedAt) / 1000)
  }));
  listening.active = false;
  listening.pendingMs = 0;
}

/**
 * A deliberate listener action that abandons what is playing. Called from the room switch
 * and the long-play step controls only. A live station rotating to its next track is not a
 * skip, so track changes detected during sampling never emit one.
 */
function noteListenerSkip() {
  if (!listening.active) return;
  const heldSeconds = Math.round((Date.now() - listening.startedAt) / 1000);
  if (heldSeconds >= SKIP_THRESHOLD_SECONDS) return;
  window.haloStats?.track("radio_skip", listeningPayload(listening.descriptor || listeningDescriptor(), {
    seconds: heldSeconds
  }));
}

function sampleListening() {
  const now = Date.now();
  const elapsed = Math.min(Math.max(now - listening.lastSampleAt, 0), 60_000);
  listening.lastSampleAt = now;
  if (listening.active) listening.pendingMs += elapsed;

  const active = isListening();
  const descriptor = listeningDescriptor();
  const signature = `${descriptor.room}|${descriptor.track}|${descriptor.artist}`;

  if (active && !listening.active) {
    listening.active = true;
    listening.signature = signature;
    listening.descriptor = descriptor;
    listening.startedAt = now;
    listening.lastBeatAt = now;
    listening.pendingMs = 0;
    window.haloStats?.track("radio_tune_in", listeningPayload(descriptor));
    return;
  }

  if (!active) {
    endListeningSession(now);
    return;
  }

  // Close out the previous track's minutes so listening is attributed to what was actually on.
  if (signature !== listening.signature) {
    flushListenedSeconds(listening.descriptor || descriptor);
    listening.signature = signature;
    listening.descriptor = descriptor;
    listening.startedAt = now;
  }

  if (now - listening.lastBeatAt >= HEARTBEAT_MS) {
    listening.lastBeatAt = now;
    flushListenedSeconds(listening.descriptor || descriptor);
  }
}

function updatePlaybackProgress() {
  if (state.youtubeLongPlayActive) {
    const progress = fallbackMixProgress();
    playbackProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
    document.querySelector("#trackProgress").style.width = `${progress}%`;
    return;
  }
  if (state.fallbackMixActive) {
    const progress = fallbackMixProgress();
    playbackProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
    document.querySelector("#trackProgress").style.width = `${progress}%`;
    return;
  }
  if (state.takeoverFallbackActive) {
    const mix = takeoverMix();
    const duration = Number(mix?.durationSeconds || 0);
    const progress = duration ? Math.min(100, mixElapsed(mix, state.takeoverSegmentIndex) / duration * 100) : 0;
    playbackProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
    document.querySelector("#trackProgress").style.width = `${progress}%`;
    const playSeconds = Number(takeoverMixSegment()?.playSeconds || 0);
    maybeStartSeamlessTransition(playSeconds || (Number.isFinite(stationAudio.duration) ? stationAudio.duration : 0));
    if (playSeconds > 0 && stationAudio.currentTime >= playSeconds) advanceTakeoverFallback();
    return;
  }
  const room = activeRoom();
  if (room && !room.streamUrl && rotationTrack(room)) {
    const duration = Number(rotationTrack(room).duration || (Number.isFinite(stationAudio.duration) ? stationAudio.duration : 0));
    const progress = duration ? Math.min(100, stationAudio.currentTime / duration * 100) : 0;
    playbackProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
    document.querySelector("#trackProgress").style.width = `${progress}%`;
    maybeStartSeamlessTransition(duration);
    return;
  }
  if (state.activeRoom !== "longplay") return;
  const mix = currentMix();
  const duration = mix?.durationSeconds || (Number.isFinite(stationAudio.duration) ? stationAudio.duration : 0);
  const progress = duration ? Math.min(100, currentMixElapsed() / duration * 100) : 0;
  playbackProgress.classList.remove("is-indeterminate");
  playbackProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
  document.querySelector("#trackProgress").style.width = `${progress}%`;
  const playSeconds = Number(currentMixSegment()?.playSeconds || 0);
  maybeStartSeamlessTransition(playSeconds || (Number.isFinite(stationAudio.duration) ? stationAudio.duration : 0));
  if (playSeconds > 0 && stationAudio.currentTime >= playSeconds) advanceLongPlay();
}

function renderTracks() {
  if (!state.tracks.length) {
    previewGrid.innerHTML = `<p class="empty-state">The first creator transmission is waiting. Submit a track and open the signal.</p>`;
    return;
  }
  previewGrid.innerHTML = state.tracks.map(track => `
    <article class="preview-card" style="--card-color:${roomColors[track.room] || roomColors.club}">
      <div class="preview-card-top"><span>${escapeHtml(track.room)} room</span><span>${escapeHtml(formatDuration(track.durationSeconds))} · ${track.playCount} plays</span></div>
      <div class="preview-card-body">
        ${track.artworkUrl ? `<img class="preview-artwork" src="${escapeHtml(track.artworkUrl)}" alt="${escapeHtml(`${track.title} cover artwork`)}" data-track-artwork="${escapeHtml(track.id)}" loading="lazy">` : generatedArtworkMarkup(track)}
        <div>
          <h3>${escapeHtml(track.title)}</h3>
          <p class="preview-artist">${escapeHtml(track.artist)} · submitted by ${escapeHtml(track.creator.name)}</p>
          ${track.linkedTrack ? `<p class="preview-version-link"><span>${escapeHtml(versionRelationshipLabels[track.versionRelationship] || "Another version of")}</span> <strong>${escapeHtml(track.linkedTrack.title)}</strong> · ${escapeHtml(track.linkedTrack.room)} room</p>` : ""}
          ${track.description ? `<p class="preview-description">${escapeHtml(track.description)}</p>` : ""}
          <div class="preview-tags">${track.spotlightMonth ? `<span class="spotlight-tag">Song of the month</span>` : ""}${track.genre ? `<span>${escapeHtml(track.genre)}</span>` : ""}${track.bpm ? `<span>${track.bpm} BPM</span>` : ""}${track.key ? `<span>${escapeHtml(track.key)}</span>` : ""}${track.energy ? `<span>Energy ${track.energy}/10</span>` : ""}${(track.moods || []).slice(0, 3).map(mood => `<span>${escapeHtml(mood)}</span>`).join("")}${track.analysisStatus === "complete" ? `<span>AI cataloged</span>` : ""}${track.status === "rotation" ? `<span>In rotation</span>` : ""}${track.status === "held" ? `<span>Passed for later</span>` : ""}${track.status === "rejected" ? `<span>Not selected</span>` : ""}</div>
          ${track.sourceUrl ? `<a class="official-track-link" href="${escapeHtml(track.sourceUrl)}" target="_blank" rel="noopener">Open official song <span>↗</span></a>` : ""}
          ${track.isOwner ? `<button class="manage-upload-button" type="button" data-edit-track="${track.id}">Edit or delete upload</button>` : ""}
        </div>
      </div>
      <div class="preview-controls">
        <button class="preview-play" type="button" data-preview="${escapeHtml(track.audioUrl)}" aria-label="Play ${escapeHtml(track.title)}">▶</button>
        <span class="score-block"><strong data-score="${track.id}">${track.score > 0 ? "+" : ""}${track.score}</strong><small>community signal</small></span>
        <span class="vote-buttons">
          <button class="${track.myVote === 1 ? "active" : ""}" type="button" data-vote="1" data-track="${track.id}" aria-label="Vote up">↑</button>
          <button class="${track.myVote === -1 ? "active" : ""}" type="button" data-vote="-1" data-track="${track.id}" aria-label="Vote down">↓</button>
        </span>
      </div>
    </article>
  `).join("");
  previewGrid.querySelectorAll(".preview-artwork[src]").forEach(image => image.addEventListener("error", event => {
    const track = state.tracks.find(item => item.id === event.currentTarget.dataset.trackArtwork);
    event.currentTarget.outerHTML = generatedArtworkMarkup(track || { title: "HALO", artist: "HALO artist", room: "club", durationSeconds: 0 });
  }, { once: true }));
}

function renderRotationReview() {
  rotationReview.hidden = !state.canReviewTracks;
  stationDeskButton.hidden = !state.canManageSchedule && !state.canReviewTracks;
  if (!state.canReviewTracks) return;
  if (!state.reviewTracks.length) {
    rotationReviewList.innerHTML = `<p class="empty-state">No submitted records are waiting in the catalog.</p>`;
    return;
  }
  rotationReviewList.innerHTML = state.reviewTracks.map(track => `
    <article class="rotation-review-card" data-review-card="${escapeHtml(track.id)}">
      <button class="review-play" type="button" data-review-preview="${escapeHtml(track.audioUrl)}" aria-label="Play ${escapeHtml(track.title)}">▶</button>
      <div class="review-track-copy">
        <div class="review-track-heading"><span>${escapeHtml(developmentStageLabels[track.developmentStage] || track.status)} · ${escapeHtml(track.room)} · round ${track.reviewRound + 1}</span>${track.spotlightMonth ? `<b>Song of the month</b>` : ""}</div>
        <strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.artist)} · ${escapeHtml(track.creator.name)}</small>
        ${track.linkedTrack ? `<p class="review-version-link"><b>${escapeHtml(versionRelationshipLabels[track.versionRelationship] || "Another version of")}</b> ${escapeHtml(track.linkedTrack.title)} · ${escapeHtml(track.linkedTrack.room)} room</p>` : ""}
        <p>${escapeHtml(track.aiSummary || track.description || "No AI catalog note was produced. Listen and decide from the record itself.")}</p>
        <div class="review-evidence"><span>Community ${track.score > 0 ? "+" : ""}${track.score}</span><span>AI fit ${track.aiScore === null ? "not scored" : `${Math.round(track.aiScore)}/100`}</span><span>${escapeHtml(formatDuration(track.durationSeconds))}</span></div>
        <button class="coaching-draft-button" type="button" data-coaching-draft="${escapeHtml(track.id)}">Draft coaching with the AI team</button>
        <label>Decision summary<textarea data-artist-message maxlength="1200" rows="3" placeholder="Explain why this decision helps the artist move forward">${escapeHtml(track.artistMessage)}</textarea></label>
        <div class="development-scorecard">${Object.entries(scoreLabels).map(([key, label]) => `<label>${escapeHtml(label)}<select data-score-key="${key}"><option value="">Not scored</option>${Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}/10</option>`).join("")}</select></label>`).join("")}</div>
        <div class="coaching-fields">
          <label>Strengths<textarea data-coaching-list="strengths" rows="3" placeholder="One strength per line"></textarea></label>
          <label>Highest-impact priorities<textarea data-coaching-list="priorities" rows="3" placeholder="One priority per line"></textarea></label>
          <label>Next steps<textarea data-coaching-list="nextSteps" rows="3" placeholder="One practical action per line"></textarea></label>
        </div>
        <label>Private review note<input data-review-note maxlength="500" value="${escapeHtml(track.reviewNote)}" placeholder="Why this choice was made"></label>
      </div>
      <div class="review-actions">
        <button type="button" data-review-decision="rotation" data-track="${escapeHtml(track.id)}">Add to rotation</button>
        <button type="button" class="spotlight" data-review-decision="spotlight" data-track="${escapeHtml(track.id)}">Song of the month</button>
        <button type="button" data-review-decision="preview" data-track="${escapeHtml(track.id)}">Keep in preview</button>
        <button type="button" data-review-decision="pass" data-track="${escapeHtml(track.id)}">Pass for later</button>
        <button type="button" data-review-decision="reject" data-track="${escapeHtml(track.id)}">Reject</button>
        <button type="button" class="danger" data-review-decision="delete" data-track="${escapeHtml(track.id)}">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderDevelopmentBoard() {
  const reviews = state.developmentReviews.filter(review => state.tracks.some(track => track.id === review.trackId && track.isOwner));
  developmentBoard.hidden = !reviews.length;
  if (!reviews.length) {
    developmentTimeline.innerHTML = "";
    return;
  }
  developmentTimeline.innerHTML = reviews.map(review => {
    const scores = Object.entries(review.scorecard || {});
    return `<article class="development-review-card">
      <div class="development-review-top"><span>${escapeHtml(developmentStageLabels[review.developmentStage] || review.developmentStage)}</span><time datetime="${escapeHtml(review.createdAt)}">${new Date(review.createdAt).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}</time></div>
      <h4>${escapeHtml(review.title)}</h4><p class="development-review-artist">${escapeHtml(review.artist)}</p>
      ${review.summary ? `<p class="development-summary">${escapeHtml(review.summary)}</p>` : ""}
      ${scores.length ? `<div class="development-scores">${scores.map(([key, value]) => `<span><b>${escapeHtml(scoreLabels[key] || key)}</b>${escapeHtml(value)}/10</span>`).join("")}</div>` : ""}
      <div class="development-guidance">
        ${review.strengths.length ? `<div><strong>Keep</strong><ul>${review.strengths.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        ${review.priorities.length ? `<div><strong>Focus</strong><ul>${review.priorities.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        ${review.nextSteps.length ? `<div><strong>Next</strong><ul>${review.nextSteps.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      </div>
    </article>`;
  }).join("");
}

async function loadTracks() {
  try {
    const query = state.filter ? `?room=${encodeURIComponent(state.filter)}` : "";
    const response = await fetch(`/api/radio/submissions${query}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Pool unavailable");
    const data = await response.json();
    state.tracks = data.tracks || [];
    state.linkableTracks = data.linkableTracks || [];
    state.releaseLibrary = data.releaseLibrary || [];
    state.reviewTracks = data.reviewTracks || [];
    state.developmentReviews = data.developmentReviews || [];
    state.canBulkUpload = Boolean(data.canBulkUpload);
    state.canReviewTracks = Boolean(data.canReviewTracks);
    bulkUploadForm.hidden = !state.canBulkUpload;
    renderSubmissionLibrary();
    renderTracks();
    renderRotationReview();
    renderDevelopmentBoard();
  } catch {
    state.canBulkUpload = false;
    state.canReviewTracks = false;
    state.reviewTracks = [];
    bulkUploadForm.hidden = true;
    renderRotationReview();
    previewGrid.innerHTML = `<p class="empty-state">The preview pool is temporarily off-air.</p>`;
  }
}

async function reviewTrack(button) {
  const card = button.closest("[data-review-card]");
  const decision = button.dataset.reviewDecision;
  const destructive = ["reject", "delete"].includes(decision);
  if (destructive && !window.confirm(decision === "delete" ? "Delete this track and its stored audio permanently?" : "Reject this track and remove it from public review?")) return;
  button.disabled = true;
  stationDeskNotice.textContent = "Saving the rotation decision…";
  try {
    const response = await fetch("/api/radio/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "review",
        trackId: button.dataset.track,
        decision,
        artistMessage: card?.querySelector("[data-artist-message]")?.value || "",
        reviewNote: card?.querySelector("[data-review-note]")?.value || "",
        strengths: linesFrom(card?.querySelector('[data-coaching-list="strengths"]')?.value),
        priorities: linesFrom(card?.querySelector('[data-coaching-list="priorities"]')?.value),
        nextSteps: linesFrom(card?.querySelector('[data-coaching-list="nextSteps"]')?.value),
        scorecard: Object.fromEntries([...card?.querySelectorAll("[data-score-key]") || []].filter(input => input.value).map(input => [input.dataset.scoreKey, Number(input.value)]))
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The rotation decision could not be saved");
    stationDeskNotice.textContent = data.message;
    await loadTracks();
  } catch (error) {
    stationDeskNotice.textContent = error instanceof Error ? error.message : "The rotation decision could not be saved.";
  } finally {
    button.disabled = false;
  }
}

function linesFrom(value) {
  return String(value || "").split(/\n+/).map(item => item.trim()).filter(Boolean).slice(0, 3);
}

async function draftDevelopmentCoaching(button) {
  const card = button.closest("[data-review-card]");
  button.disabled = true;
  stationDeskNotice.textContent = "The AI team is drafting grounded coaching for human review…";
  try {
    const response = await fetch("/api/radio/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "draftDevelopmentCoaching", trackId: button.dataset.coachingDraft })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The coaching draft could not be generated");
    card.querySelector("[data-artist-message]").value = data.summary || "";
    for (const key of ["strengths", "priorities", "nextSteps"]) {
      card.querySelector(`[data-coaching-list="${key}"]`).value = (data[key] || []).join("\n");
    }
    stationDeskNotice.textContent = "Coaching drafted. Listen, score the craft, and edit every word before sending.";
  } catch (error) {
    stationDeskNotice.textContent = error instanceof Error ? error.message : "The coaching draft could not be generated.";
  } finally {
    button.disabled = false;
  }
}

async function castVote(trackId, vote) {
  if (!state.user) return openAuth();
  const response = await fetch("/api/radio/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action: "vote", trackId, vote })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Your vote could not be counted");
  const track = state.tracks.find(item => item.id === trackId);
  if (track) Object.assign(track, { myVote: data.myVote, votesUp: data.votesUp, votesDown: data.votesDown, score: data.score });
  renderTracks();
}

function openTrackEditor(trackId) {
  const track = state.tracks.find(item => item.id === trackId && item.isOwner);
  if (!track) return;
  trackEditorForm.elements.trackId.value = track.id;
  trackEditorForm.elements.title.value = track.title || "";
  trackEditorForm.elements.artist.value = track.artist || "";
  trackEditorForm.elements.room.value = track.room || "club";
  trackEditorForm.elements.genre.value = track.genre || "";
  trackEditorForm.elements.bpm.value = track.bpm || "";
  trackEditorForm.elements.key.value = track.key || "";
  trackEditorForm.elements.description.value = track.description || "";
  const linkedTrackSelect = trackEditorForm.elements.linkedTrackId;
  linkedTrackSelect.innerHTML = `<option value="">No connected version</option>${state.linkableTracks
    .filter(item => item.id !== track.id)
    .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} · ${escapeHtml(item.artist)} · ${escapeHtml(item.room)} room</option>`)
    .join("")}`;
  linkedTrackSelect.value = track.linkedTrackId || "";
  trackEditorForm.elements.versionRelationship.value = track.versionRelationship || "alternate_version";
  trackEditorForm.elements.versionRelationship.disabled = !linkedTrackSelect.value;
  document.querySelector("#trackEditorNotice").textContent = "Update the public card and connect another playable version without replacing either audio file.";
  trackEditorDialog.showModal();
  trackEditorForm.elements.title.focus();
}

async function saveTrackEdits(event) {
  event.preventDefault();
  const notice = document.querySelector("#trackEditorNotice");
  const payload = Object.fromEntries(new FormData(trackEditorForm).entries());
  notice.textContent = "Saving upload details…";
  const response = await fetch("/api/radio/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action: "update", ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    notice.textContent = data.message || "The upload could not be updated.";
    return;
  }
  await loadTracks();
  trackEditorDialog.close();
  document.querySelector("#submissionNotice").textContent = data.message || "Upload details updated.";
}

async function deleteTrackUpload() {
  const trackId = trackEditorForm.elements.trackId.value;
  const track = state.tracks.find(item => item.id === trackId && item.isOwner);
  if (!track || !window.confirm(`Delete “${track.title}” and its uploaded audio permanently?`)) return;
  const notice = document.querySelector("#trackEditorNotice");
  notice.textContent = "Deleting upload and audio…";
  const response = await fetch("/api/radio/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action: "delete", trackId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    notice.textContent = data.message || "The upload could not be deleted.";
    return;
  }
  if (state.previewAudio) {
    state.previewAudio.pause();
    state.previewAudio = null;
  }
  trackEditorDialog.close();
  await loadTracks();
  document.querySelector("#submissionNotice").textContent = data.message || "Upload deleted.";
}

function reportAudioHealth(status, message) {
  window.__haloAudioHealth = { status, message, checkedAt: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent("halo:audio-state", { detail: window.__haloAudioHealth }));
  if (previewPlaybackStatus) {
    previewPlaybackStatus.dataset.state = status;
    previewPlaybackStatus.textContent = message;
  }
}

async function playPreview(button) {
  const url = button.dataset.preview || button.dataset.reviewPreview;
  if (!url) return;
  if (state.previewAudio?.src.endsWith(url) && !state.previewAudio.paused) {
    state.previewAudio.pause();
    button.textContent = "▶";
    reportAudioHealth("ready", "Preview paused. Press Listen to resume the audio check.");
    return;
  }
  stationAudio.pause();
  if (state.previewAudio) state.previewAudio.pause();
  document.querySelectorAll(".preview-play, .review-play").forEach(item => { item.textContent = "▶"; });
  const trackName = button.getAttribute("aria-label")?.replace(/^Play\s+/i, "") || "this track";
  button.disabled = true;
  reportAudioHealth("checking", `Checking ${trackName} before playback…`);
  try {
    const response = await fetch(url, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`Audio service returned ${response.status}`);
    if (!String(response.headers.get("content-type") || "").startsWith("audio/")) throw new Error("Audio service returned an invalid media type");
  } catch (error) {
    button.disabled = false;
    button.textContent = "▶";
    reportAudioHealth("error", `${trackName} could not pass the audio check. Please retry or report the upload for review.`);
    console.error("HALO preview preflight failed", error instanceof Error ? error.message : "unknown error");
    return;
  }
  state.previewAudio = new Audio(url);
  state.previewAudio.preload = "auto";
  state.previewAudio.addEventListener("playing", () => {
    button.disabled = false;
    button.textContent = "Ⅱ";
    reportAudioHealth("playing", `${trackName} is playing. Audio check passed.`);
  }, { once: true });
  state.previewAudio.addEventListener("ended", () => {
    button.textContent = "▶";
    reportAudioHealth("ready", `${trackName} finished playing. Audio check passed.`);
  }, { once: true });
  state.previewAudio.addEventListener("error", () => {
    button.disabled = false;
    button.textContent = "▶";
    reportAudioHealth("error", `${trackName} loaded but the browser could not decode or play it. Check the uploaded audio format.`);
  }, { once: true });
  try {
    await state.previewAudio.play();
  } catch (error) {
    button.disabled = false;
    button.textContent = "▶";
    reportAudioHealth("error", `${trackName} is ready, but playback was blocked. Press Listen again or check the browser sound controls.`);
    console.error("HALO preview playback failed", error instanceof Error ? error.message : "unknown error");
  }
}

function openAuth() {
  if (state.user) return;
  authDialog.showModal();
  authForm.elements.email.focus();
}

function updateAuthUi() {
  accountButton.textContent = state.user ? (state.user.name || state.user.email || "Member") : "Sign in";
  document.querySelector("#submissionNotice").textContent = state.user ? "Ready to send your track into community review." : "Sign in before transmitting your track.";
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  document.querySelector("#authTitle").textContent = signup ? "JOIN THE SIGNAL." : "SIGN IN TO THE SIGNAL.";
  document.querySelector("#authSubmit").childNodes[0].textContent = signup ? "Create account " : "Sign in ";
  document.querySelector("#authSwitch").textContent = signup ? "Already a member? Sign in" : "New here? Create an account";
  authForm.elements.password.autocomplete = signup ? "new-password" : "current-password";
  document.querySelector("#authNotice").textContent = "";
}

async function handleAuth(event) {
  event.preventDefault();
  const identity = window.haloIdentity;
  if (!identity) return;
  const email = authForm.elements.email.value.trim();
  const password = authForm.elements.password.value;
  const notice = document.querySelector("#authNotice");
  notice.textContent = state.authMode === "signup" ? "Creating your membership…" : "Opening the signal…";
  try {
    state.user = state.authMode === "signup" ? await identity.signup(email, password) : await identity.login(email, password);
    notice.textContent = state.authMode === "signup" && !state.user?.emailVerified ? "Check your email to confirm your Halo membership." : "Connected.";
    updateAuthUi();
    await loadTracks();
    await loadSchedule();
    await loadMixes();
    if (state.user?.emailVerified || state.authMode === "login") authDialog.close();
  } catch (error) {
    notice.textContent = error instanceof Error ? error.message : "Halo membership is unavailable right now.";
  }
}

function audioDuration(file) {
  return new Promise(resolve => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => { const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0; URL.revokeObjectURL(url); resolve(duration); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    audio.src = url;
  });
}

function audioContentType(file) {
  const contentTypes = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac"
  };
  const aliases = {
    "audio/mp3": "audio/mpeg",
    "audio/x-mp3": "audio/mpeg",
    "audio/mpeg3": "audio/mpeg",
    "audio/x-mpeg-3": "audio/mpeg",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "audio/x-aac": "audio/aac",
    "application/ogg": "audio/ogg",
    "audio/vorbis": "audio/ogg",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/x-flac": "audio/flac",
    "application/x-flac": "audio/flac"
  };
  const reportedType = String(file.type || "").split(";")[0].toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return aliases[reportedType] || contentTypes[extension] || reportedType;
}

function validateAudioFile(file) {
  if (!file) throw new Error("Choose at least one audio file.");
  if (file.size > 128 * 1024 * 1024) throw new Error(`${file.name} is larger than 128 MB.`);
  const contentType = audioContentType(file);
  if (!contentType.startsWith("audio/")) throw new Error(`${file.name} is not a supported audio file.`);
  return contentType;
}

async function uploadRadioFile(file, fields, onProgress = () => {}) {
  const contentType = validateAudioFile(file);
  const chunkSize = 3 * 1024 * 1024;
  const uploadId = crypto.randomUUID ? crypto.randomUUID() : `radio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { chunkCount } = await uploadHelper.uploadChunkedFile({
    url: "/api/radio/submissions",
    file,
    chunkSize,
    retryDelays: [700, 1400],
    buildBody({ chunkIndex, chunkCount, start, end }) {
      const body = new FormData();
      body.append("chunk", file.slice(start, end, contentType), file.name);
      body.append("uploadId", uploadId);
      body.append("chunkIndex", String(chunkIndex));
      body.append("chunkCount", String(chunkCount));
      body.append("contentType", contentType);
      return body;
    },
    onProgress(percent) {
      onProgress(percent * CHUNK_PHASE_RATIO / 100);
    }
  });
  const durationSeconds = await audioDuration(file);
  const payload = {
    ...fields,
    action: "publish",
    uploadId,
    chunkCount,
    byteSize: file.size,
    contentType,
    fileName: file.name,
    durationSeconds
  };
  const response = await fetch("/api/radio/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Track cataloging failed for ${file.name}`);
  onProgress(1);
  return data;
}

async function uploadRequest(body) {
  return uploadHelper.sendFormDataWithRetry("/api/radio/submissions", body, { retryDelays: [700, 1400] });
}

async function submitTrack(event) {
  event.preventDefault();
  if (!state.user) return openAuth();
  const form = event.currentTarget;
  const file = form.elements.trackFile.files[0];
  const savedAudioVersionId = form.elements.audioVersionId.value;
  if (!file && !savedAudioVersionId) {
    submissionNotice.textContent = "Choose an audio file or reuse a saved version from a past HALO song.";
    return;
  }
  if (savedAudioVersionId && !form.elements.releaseId.value) {
    submissionNotice.textContent = "Choose the past HALO song that owns this saved audio version.";
    return;
  }
  if (savedAudioVersionId) {
    form.querySelector("button[type=submit]").disabled = true;
    submissionUploadUi.start("Connecting the saved audio to this room…");
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      delete payload.trackFile;
      payload.action = "submitReleaseVersion";
      payload.rightsConfirmed = form.elements.rightsConfirmed.checked;
      const response = await fetch("/api/radio/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Saved audio submission failed");
      submissionUploadUi.success(data.message, false);
      form.reset();
      officialSourceNotice.textContent = "The official link can load the next song’s title and artist.";
      await loadTracks();
      document.querySelector("#preview").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      submissionUploadUi.fail(error instanceof Error ? error.message : "The saved audio could not be submitted.");
    } finally {
      form.querySelector("button[type=submit]").disabled = false;
      setTimeout(() => submissionUploadUi.idle(state.user ? "Ready to send your track into community review." : "Sign in before transmitting your track."), 1800);
    }
    return;
  }
  if (file.size > 128 * 1024 * 1024) { submissionNotice.textContent = "Choose an audio file smaller than 128 MB."; return; }
  const contentType = audioContentType(file);
  if (!contentType.startsWith("audio/")) { submissionNotice.textContent = "Choose an MP3, M4A, AAC, OGG, WAV, or FLAC audio file."; return; }
  const uploadId = crypto.randomUUID ? crypto.randomUUID() : `radio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  form.querySelector("button[type=submit]").disabled = true;
  submissionUploadUi.start(`Transmitting audio 0% · ${file.name}`);
  try {
    const { chunkCount } = await uploadHelper.uploadChunkedFile({
      url: "/api/radio/submissions",
      file,
      chunkSize: 3 * 1024 * 1024,
      retryDelays: [700, 1400],
      buildBody({ chunkIndex, chunkCount, start, end }) {
        const body = new FormData();
        body.append("chunk", file.slice(start, end, contentType), file.name);
        body.append("uploadId", uploadId);
        body.append("chunkIndex", String(chunkIndex));
        body.append("chunkCount", String(chunkCount));
        body.append("contentType", contentType);
        return body;
      },
      onProgress(percent) {
        submissionUploadUi.progress(percent * CHUNK_PHASE_RATIO, `Transmitting audio ${Math.round(percent)}% · ${file.name}`);
      }
    });
    const durationSeconds = await audioDuration(file);
    const payload = Object.fromEntries(new FormData(form).entries());
    delete payload.trackFile;
    payload.action = "publish";
    payload.uploadId = uploadId;
    payload.chunkCount = chunkCount;
    payload.byteSize = file.size;
    payload.contentType = contentType;
    payload.fileName = file.name;
    payload.durationSeconds = durationSeconds;
    payload.rightsConfirmed = form.elements.rightsConfirmed.checked;
    submissionUploadUi.progress(92, "Saving the upload to Halo Radio…");
    const response = await fetch("/api/radio/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Track submission failed");
    submissionUploadUi.success(data.message, true);
    form.reset();
    document.querySelector("#fileLabel").textContent = "Drop a track or choose a file";
    officialSourceNotice.textContent = "The official link can load the next song’s title and artist.";
    await loadTracks();
    document.querySelector("#preview").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    submissionUploadUi.fail(error instanceof Error ? error.message : "The track could not be transmitted.");
  } finally {
    form.querySelector("button[type=submit]").disabled = false;
    setTimeout(() => submissionUploadUi.idle(state.user ? "Ready to send your track into community review." : "Sign in before transmitting your track."), 1800);
  }
}

function renderBulkFiles(files, statuses = []) {
  bulkFileList.hidden = !files.length;
  bulkFileList.innerHTML = files.map((file, index) => {
    const status = statuses[index] || { label: "Ready", state: "ready" };
    return `<div><strong>${escapeHtml(file.name)}</strong><span data-status="${escapeHtml(status.state)}">${escapeHtml(status.label)}</span></div>`;
  }).join("");
}

async function submitBulkTracks(event) {
  event.preventDefault();
  if (!state.user) return openAuth();
  if (!state.canBulkUpload) return;
  const form = event.currentTarget;
  const files = [...form.elements.trackFiles.files].slice(0, 25);
  const submitButton = form.querySelector("button[type=submit]");
  if (!files.length) return;
  const statuses = files.map(() => ({ label: "Waiting", state: "ready" }));
  renderBulkFiles(files, statuses);
  submitButton.disabled = true;
  bulkUploadUi.start(`Processing 0 of ${files.length} uploads…`);
  let completed = 0;
  let failed = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      statuses[index] = { label: "Uploading and cataloging…", state: "working" };
      renderBulkFiles(files, statuses);
      bulkUploadUi.progress((index / files.length) * 100, `Processing ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const result = await uploadRadioFile(file, {
          ownerBulk: true,
          directToRotation: form.elements.directToRotation.checked,
          rightsConfirmed: form.elements.rightsConfirmed.checked,
          artist: form.elements.artist.value.trim(),
          room: form.elements.room.value
        }, fileProgress => {
          bulkUploadUi.progress((index + fileProgress) / files.length * 100, `Processing ${index + 1} of ${files.length}: ${file.name}`);
        });
        completed += 1;
        statuses[index] = { label: result.track?.analysisStatus === "fallback" ? "On station · tag fallback" : "On station · AI cataloged", state: "complete" };
      } catch (error) {
        failed += 1;
        statuses[index] = { label: error instanceof Error ? error.message : "Upload failed", state: "error" };
      }
      renderBulkFiles(files, statuses);
    }
    bulkUploadUi[failed ? "fail" : "success"](failed ? `${completed} tracks completed and ${failed} need attention.` : `${completed} tracks are cataloged and ready on Halo Radio.`, true);
    if (!failed) {
      form.reset();
      document.querySelector("#bulkFileLabel").textContent = "Drop an album, EP, or track batch";
    }
    await Promise.all([loadTracks(), loadStations()]);
    if (completed) document.querySelector("#preview").scrollIntoView({ behavior: "smooth" });
  } finally {
    submitButton.disabled = false;
    setTimeout(() => bulkUploadUi.idle("Use the station desk to send a batch into rotation review."), 2200);
  }
}

roomGrid.addEventListener("click", event => {
  const card = event.target.closest("[data-room]");
  if (card) selectRoom(card.dataset.room);
});
document.querySelectorAll("[data-action=play-current]").forEach(button => button.addEventListener("click", toggleCurrentPlayback));
mainPlayButton.addEventListener("click", toggleCurrentPlayback);
previousMixButton.addEventListener("click", () => stepLongPlay(-1));
nextMixButton.addEventListener("click", () => stepLongPlay(1));
transitionSeconds.addEventListener("input", () => {
  state.transitionSeconds = Number(transitionSeconds.value || 0);
  updateTransitionReadout();
});
transitionMode.addEventListener("change", () => {
  state.transitionMode = transitionMode.value === "clean" ? "clean" : "beat";
});

function handleDeckPlay(event) {
  if (event.currentTarget === stationAudio) syncPlayState();
}

function handleDeckPause(event) {
  if (event.currentTarget !== stationAudio) return;
  if (state.audioTransitioning) cancelAudioTransition();
  syncPlayState();
}

function handleDeckTimeUpdate(event) {
  if (event.currentTarget === stationAudio) updatePlaybackProgress();
}

function handleDeckEnded(event) {
  if (event.currentTarget !== stationAudio || state.audioTransitioning) return;
  if (state.takeoverFallbackActive) advanceTakeoverFallback();
  else if (state.activeRoom === "longplay") advanceLongPlay();
  else if (!activeRoom()?.streamUrl && activeRoom()?.rotation?.length) advanceRotation();
  else playFallbackMix();
}

function handleDeckError(event) {
  if (event.currentTarget !== stationAudio) return;
  const room = activeRoom();
  if (state.takeoverFallbackActive) {
    state.rotationErrorCount = 0;
    playFallbackMix();
  } else if (!state.fallbackMixActive && !room?.streamUrl && room?.rotation?.length && state.rotationErrorCount < room.rotation.length - 1) {
    state.rotationErrorCount += 1;
    advanceRotation();
  } else {
    state.rotationErrorCount = 0;
    playFallbackMix();
  }
}

[stationAudio, standbyAudio].forEach(audio => {
  audio.addEventListener("play", handleDeckPlay);
  audio.addEventListener("pause", handleDeckPause);
  audio.addEventListener("timeupdate", handleDeckTimeUpdate);
  audio.addEventListener("loadedmetadata", event => {
    if (event.currentTarget === stationAudio) updatePlaybackProgress();
  });
  audio.addEventListener("ended", handleDeckEnded);
  audio.addEventListener("error", handleDeckError);
});
updateTransitionReadout();
longPlayQueue.addEventListener("click", event => {
  const retryButton = event.target.closest("[data-retry-mixes]");
  const item = event.target.closest("[data-mix-index]");
  if (retryButton) return loadMixes();
  if (item) playLongPlay(Number(item.dataset.mixIndex));
});
previewGrid.addEventListener("click", event => {
  const previewButton = event.target.closest("[data-preview]");
  const voteButton = event.target.closest("[data-vote]");
  const editButton = event.target.closest("[data-edit-track]");
  if (previewButton) playPreview(previewButton);
  if (voteButton) castVote(voteButton.dataset.track, Number(voteButton.dataset.vote)).catch(error => { document.querySelector("#submissionNotice").textContent = error.message; });
  if (editButton) openTrackEditor(editButton.dataset.editTrack);
});
rotationReviewList.addEventListener("click", event => {
  const playButton = event.target.closest("[data-review-preview]");
  const decisionButton = event.target.closest("[data-review-decision]");
  const coachingButton = event.target.closest("[data-coaching-draft]");
  if (playButton) playPreview(playButton);
  if (decisionButton) reviewTrack(decisionButton);
  if (coachingButton) draftDevelopmentCoaching(coachingButton);
});
scheduleGrid.addEventListener("click", event => {
  const followButton = event.target.closest("[data-show-follow]");
  const editButton = event.target.closest("[data-show-edit]");
  if (editButton) editShow(editButton.dataset.showEdit);
  if (!followButton) return;
  if (!state.user) return openAuth();
  const show = state.schedule.find(item => item.id === followButton.dataset.showFollow);
  stationAction({ action: "subscribe", showId: followButton.dataset.showFollow, subscribed: !show?.subscribed }).catch(() => {});
});
residentSets?.addEventListener("click", event => {
  const approveButton = event.target.closest("[data-persona-approve]");
  const airButton = event.target.closest("[data-persona-air]");
  const skipButton = event.target.closest("[data-persona-skip]");
  if (approveButton) {
    personaAction({ action: "approve_set", setId: approveButton.dataset.personaApprove }, approveButton).catch(() => {});
  }
  if (airButton) {
    personaAction({ action: "mark_aired", setId: airButton.dataset.personaAir }, airButton).catch(() => {});
  }
  if (skipButton) {
    personaAction({ action: "update_set", setId: skipButton.dataset.personaSkip, status: "skipped" }, skipButton).catch(() => {});
  }
});
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("active", item === button));
  loadTracks();
}));
accountButton.addEventListener("click", async () => {
  if (!state.user) return openAuth();
  await window.haloIdentity?.logout();
  state.user = null;
  updateAuthUi();
  loadTracks();
  loadSchedule();
  loadResidents();
  loadMixes();
});
document.querySelector("[data-action=close-auth]").addEventListener("click", () => authDialog.close());
document.querySelector("[data-action=close-track-editor]").addEventListener("click", () => trackEditorDialog.close());
document.querySelector("[data-action=delete-track]").addEventListener("click", deleteTrackUpload);
trackEditorForm.elements.linkedTrackId.addEventListener("change", event => {
  trackEditorForm.elements.versionRelationship.disabled = !event.currentTarget.value;
});
document.querySelector("[data-action=close-station-desk]").addEventListener("click", () => stationDeskDialog.close());
stationDeskButton.addEventListener("click", () => {
  stationDeskNotice.textContent = "Build the grid, record each spin, and connect every broadcast to an artist room.";
  stationDeskDialog.showModal();
  loadManagerCouncil();
  loadGemmaStatus();
});
managerCouncilForm.addEventListener("submit", runManagerCouncil);
managerCouncilOutput.addEventListener("click", event => {
  const button = event.target.closest("[data-manager-decision]");
  if (button) decideManagerAction(button);
});
document.querySelectorAll("[data-gemma-action]").forEach(button => button.addEventListener("click", () => runGemmaAction(button.dataset.gemmaAction)));
document.querySelector("#authSwitch").addEventListener("click", () => setAuthMode(state.authMode === "login" ? "signup" : "login"));
authForm.addEventListener("submit", handleAuth);
trackEditorForm.addEventListener("submit", saveTrackEdits);
submissionForm.addEventListener("submit", submitTrack);
bulkUploadForm.addEventListener("submit", submitBulkTracks);
showForm.addEventListener("submit", event => submitDeskForm(event, "save_show").catch(() => {}));
playLogForm.addEventListener("submit", event => submitDeskForm(event, "log_play").catch(() => {}));
artistActivityForm.addEventListener("submit", event => submitDeskForm(event, "save_activity").catch(() => {}));
const fileInput = document.querySelector("#trackFile");
fileInput.addEventListener("change", () => { document.querySelector("#fileLabel").textContent = fileInput.files[0]?.name || "Drop a track or choose a file"; });
submissionRelease.addEventListener("change", applySelectedRelease);
submissionAudioVersion.addEventListener("change", updateSubmissionAudioSource);
submissionLinkedTrack.addEventListener("change", () => {
  submissionVersionRelationship.disabled = !submissionLinkedTrack.value;
});
resolveTrackButton.addEventListener("click", resolveOfficialTrack);
const dropZone = document.querySelector("#dropZone");
["dragenter", "dragover"].forEach(name => dropZone.addEventListener(name, () => dropZone.classList.add("dragging")));
["dragleave", "drop"].forEach(name => dropZone.addEventListener(name, () => dropZone.classList.remove("dragging")));
const bulkFileInput = document.querySelector("#bulkTrackFiles");
const bulkDropZone = document.querySelector("#bulkDropZone");
bulkFileInput.addEventListener("change", () => {
  const files = [...bulkFileInput.files];
  const limitedFiles = files.slice(0, 25);
  document.querySelector("#bulkFileLabel").textContent = files.length ? `${limitedFiles.length} track${limitedFiles.length === 1 ? "" : "s"} selected${files.length > 25 ? " · first 25 upload" : ""}` : "Drop an album, EP, or track batch";
  renderBulkFiles(limitedFiles);
});
["dragenter", "dragover"].forEach(name => bulkDropZone.addEventListener(name, () => bulkDropZone.classList.add("dragging")));
["dragleave", "drop"].forEach(name => bulkDropZone.addEventListener(name, () => bulkDropZone.classList.remove("dragging")));

async function initializeIdentity() {
  if (!window.haloIdentity) return;
  try { state.user = await window.haloIdentity.getUser(); } catch { state.user = null; }
  updateAuthUi();
  loadTracks();
  loadSchedule();
  loadResidents();
  loadMixes();
}

window.addEventListener("halo-identity-ready", initializeIdentity, { once: true });
if (window.haloIdentity) initializeIdentity();
loadStations();
loadMixes();
loadHealth();
loadTracks();
loadSchedule();
loadResidents();
loadFallbackPlayer();
setInterval(sampleListening, LISTEN_SAMPLE_MS);
// Only the network polls are gated on visibility. The clock and progress timers stay live:
// updatePlaybackProgress advances long-play segments, which must keep working in a hidden tab.
pollWhenVisible(() => loadStations(), 15_000);
pollWhenVisible(loadHealth, 30_000);
setInterval(updateNetworkClock, 1_000);
setInterval(updatePlaybackProgress, 500);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  loadStations();
  loadHealth();
});
window.addEventListener("pagehide", () => {
  sampleListening();
  endListeningSession(Date.now());
});
updateNetworkClock();
requestAnimationFrame(drawSignalScope);
