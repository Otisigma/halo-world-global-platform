import { normalizeHttpsList } from "/music-upload/link-validation.js";

const $ = selector => document.querySelector(selector);
let uploadHelperLoadPromise = null;
const RUNTIME_SCRIPT_SELECTOR = 'script[src*="/upload-progress.js"]';
const RUNTIME_LOAD_TIMEOUT_MS = 6000;
const RUNTIME_LOAD_ATTEMPTS = 3;
const RUNTIME_RETRY_DELAY_MS = 400;
const PERSISTENCE_CHECK_TIMEOUT_MS = 10000;
const RUNTIME_UNAVAILABLE_MESSAGE = "HALO upload runtime did not load. Refresh this page and try again.";

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logMusicUploadError(context, error) {
  if (typeof error === "undefined") {
    console.error(`[HaloMusicUpload] ${context}`);
    return;
  }
  console.error(`[HaloMusicUpload] ${context}`, error);
}

function waitForUploadRuntime(timeoutMs = RUNTIME_LOAD_TIMEOUT_MS) {
  if (window.HaloUploadProgress) return Promise.resolve(window.HaloUploadProgress);
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.HaloUploadProgress) {
        resolve(window.HaloUploadProgress);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        reject(new Error("Upload runtime failed to load."));
        return;
      }
      setTimeout(check, 80);
    };
    check();
  });
}

function injectUploadRuntimeScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Upload runtime failed to load.")), { once: true });
    document.head.append(script);
  });
}

function loadUploadHelperScript() {
  if (uploadHelperLoadPromise) return uploadHelperLoadPromise;
  uploadHelperLoadPromise = (async () => {
    for (let attempt = 0; attempt < RUNTIME_LOAD_ATTEMPTS; attempt += 1) {
      try {
        if (window.HaloUploadProgress) return window.HaloUploadProgress;
        const existingScript = document.querySelector(RUNTIME_SCRIPT_SELECTOR);
        if (existingScript && attempt === 0) {
          return await waitForUploadRuntime();
        }
        const cacheBust = `music-upload-runtime-${Date.now()}-${attempt}`;
        await injectUploadRuntimeScript(`/upload-progress.js?v=${cacheBust}`);
        return await waitForUploadRuntime();
      } catch (error) {
        if (attempt === RUNTIME_LOAD_ATTEMPTS - 1) throw error;
        await wait(RUNTIME_RETRY_DELAY_MS * (attempt + 1));
      }
    }
    throw new Error("Upload runtime failed to load.");
  })().finally(() => {
    uploadHelperLoadPromise = null;
  });
  return uploadHelperLoadPromise;
}

let uploadHelper = window.HaloUploadProgress;
if (!uploadHelper) {
  try {
    uploadHelper = await loadUploadHelperScript();
  } catch (error) {
    logMusicUploadError("Upload runtime bootstrap failed.", error);
  }
}
const AUDIO_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const ARTWORK_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;
const STAGE_LABEL = {
  uploaded: "Received",
  processing: "Validated",
  needs_assets: "Needs attention",
  dreamweaver_in_progress: "Built",
  ready_for_radio: "Routed",
  ready_for_sale: "Ready for sale",
  approved: "Approved",
  published: "Published",
};
const CONTROLLER_PHASES = [
  {
    id: "runtime",
    label: "Runtime handshake",
    detail: "HALO verifies the shared upload runtime and progress UI before submission can start.",
  },
  {
    id: "package",
    label: "Package validation",
    detail: "Metadata, rights, sale status, and route targets are assembled into one master package.",
  },
  {
    id: "transfer",
    label: "Asset transfer",
    detail: "Audio and artwork uploads go into tracked storage with visible live progress.",
  },
  {
    id: "persistence",
    label: "Persistence lock",
    detail: "HALO confirms the bytes are persisted before reporting the package as locked in.",
  },
  {
    id: "handoff",
    label: "Pipeline handoff",
    detail: "Dreamweaver and downstream departments refresh from the same master record.",
  },
];

const state = {
  results: [],
  controllerPhase: "runtime",
  controllerPhaseStatus: "active",
  controllerPhaseDetail: CONTROLLER_PHASES[0].detail,
};
const elements = {
  form: $("#musicUploadForm"),
  submitButton: $("#submitButton"),
  message: $("#formMessage"),
  musicFiles: $("#musicFiles"),
  musicFolder: $("#musicFolder"),
  musicQueue: $("#musicQueue"),
  artworkFile: $("#artworkFile"),
  resultsList: $("#resultsList"),
  runtimeStatusBadge: $("#runtimeStatusBadge"),
  runtimeStatusText: $("#runtimeStatusText"),
  runtimeAlert: $("#runtimeAlert"),
  runtimeAlertText: $("#runtimeAlertText"),
  runtimeRetryButton: $("#runtimeRetryButton"),
  queueMetric: $("#queueMetric"),
  artworkMetric: $("#artworkMetric"),
  routingMetric: $("#routingMetric"),
  intakeModeMetric: $("#intakeModeMetric"),
  controllerStageTimeline: $("#controllerStageTimeline"),
  handoffPreview: $("#handoffPreview"),
  handoffStatus: $("#handoffStatus"),
};

let audioUploadUi = null;
let artworkUploadUi = null;

function resolveUploadUiElements(trackSelector, statusSelector) {
  const track = $(trackSelector);
  return {
    panel: track?.closest(".upload-panel") || null,
    status: $(statusSelector),
    track,
    fill: track?.querySelector(".upload-progress-fill") || null,
  };
}

function validateUploadUiElements(label, resolved) {
  for (const [name, element] of Object.entries(resolved)) {
    if (element) continue;
    logMusicUploadError(`Missing ${label} upload UI element: ${name}.`);
    return false;
  }
  return true;
}

function bindUploadUi() {
  if (!uploadHelper?.createUploadUi) return false;
  const audioElements = resolveUploadUiElements("#audioUploadTrack", "#audioUploadProgress");
  const artworkElements = resolveUploadUiElements("#artworkUploadTrack", "#artworkUploadProgress");
  if (!validateUploadUiElements("audio", audioElements) || !validateUploadUiElements("artwork", artworkElements)) return false;
  audioUploadUi = uploadHelper.createUploadUi({
    panel: audioElements.panel,
    status: audioElements.status,
    track: audioElements.track,
    fill: audioElements.fill,
    idleMessage: "No music uploaded yet.",
  });
  artworkUploadUi = uploadHelper.createUploadUi({
    panel: artworkElements.panel,
    status: artworkElements.status,
    track: artworkElements.track,
    fill: artworkElements.fill,
    idleMessage: "No artwork uploaded yet.",
  });
  return Boolean(audioUploadUi && artworkUploadUi);
}

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function setMessage(text) {
  elements.message.textContent = text;
}

function setRuntimeStatus(status, text, alertText = "") {
  elements.runtimeStatusBadge.className = `runtime-badge is-${status}`;
  elements.runtimeStatusBadge.textContent = status === "online" ? "Controller online" : status === "error" ? "Controller blocked" : "Checking runtime";
  elements.runtimeStatusText.textContent = text;
  elements.runtimeAlert.hidden = !alertText;
  elements.runtimeAlertText.textContent = alertText || "The upload runtime is unavailable, so this intake surface cannot safely accept packages.";
}

function renderControllerTimeline() {
  const activeIndex = Math.max(0, CONTROLLER_PHASES.findIndex(phase => phase.id === state.controllerPhase));
  elements.controllerStageTimeline.innerHTML = CONTROLLER_PHASES.map((phase, index) => {
    let phaseClass = "";
    if (index < activeIndex || (index === activeIndex && state.controllerPhaseStatus === "complete")) phaseClass = " is-complete";
    else if (index === activeIndex && state.controllerPhaseStatus === "error") phaseClass = " is-error";
    else if (index === activeIndex) phaseClass = " is-active";
    const detail = index === activeIndex ? state.controllerPhaseDetail : phase.detail;
    return `<li class="controller-stage${phaseClass}" data-phase="${escapeHtml(phase.id)}">
      <span class="controller-stage-dot" aria-hidden="true"></span>
      <div><strong>${escapeHtml(phase.label)}</strong><small>${escapeHtml(detail)}</small></div>
    </li>`;
  }).join("");
}

function setControllerPhase(phase, detail, status = "active") {
  state.controllerPhase = phase;
  state.controllerPhaseStatus = status;
  state.controllerPhaseDetail = detail;
  renderControllerTimeline();
}

function renderHandoffPreview() {
  const targets = selectedRouteTargets();
  elements.handoffPreview.innerHTML = (targets.length ? targets : ["Dreamweaver review"]).map(target => `
    <span class="handoff-pill">${escapeHtml(target)}</span>
  `).join("");
  elements.handoffStatus.textContent = targets.length
    ? `HALO will keep ${targets.join(", ")} aligned to the same master package record after persistence lock-in.`
    : "No downstream targets are selected yet. HALO will default to Dreamweaver review until you choose a route.";
}

function renderIntakeMetrics() {
  const audioFiles = gatherAudioFiles();
  const artworkFile = elements.artworkFile.files?.[0] || null;
  const officialLink = $("#officialLink").value.trim();
  const videoLinks = $("#videoLinks").value.trim();
  const routeTargets = selectedRouteTargets();
  const intakeMode = audioFiles.length
    ? (officialLink || videoLinks ? "Audio + source links" : "Audio-led package")
    : officialLink || videoLinks
      ? "Metadata + source links"
      : "Metadata staging";
  elements.queueMetric.textContent = `${audioFiles.length} file${audioFiles.length === 1 ? "" : "s"} ready`;
  elements.artworkMetric.textContent = artworkFile ? `Attached · ${artworkFile.name}` : "Awaiting cover art";
  elements.routingMetric.textContent = `${routeTargets.length} department${routeTargets.length === 1 ? "" : "s"} selected`;
  elements.intakeModeMetric.textContent = intakeMode;
  renderHandoffPreview();
}

function setRuntimeUnavailable(error, message = RUNTIME_UNAVAILABLE_MESSAGE) {
  if (error) logMusicUploadError(message, error);
  elements.submitButton.disabled = true;
  elements.runtimeRetryButton.disabled = false;
  setRuntimeStatus("error", "HALO stopped the intake surface because the shared upload runtime or progress UI could not initialize.", message);
  setControllerPhase("runtime", "Runtime verification failed. Reinitialize the controller or refresh the page before attempting another submission.", "error");
  setMessage(message);
}

if (!uploadHelper) {
  setRuntimeUnavailable();
} else {
  const bound = bindUploadUi();
  if (!bound) {
    const message = "HALO upload progress UI failed to initialize. Refresh this page and try again.";
    setRuntimeUnavailable(new Error(message), message);
  } else {
    setRuntimeStatus("online", "HALO verified the shared upload runtime and progress surface. The controller is ready to build intake packages.");
    setControllerPhase("runtime", "Runtime verified. When you submit, HALO will immediately activate progress and begin package validation.", "complete");
  }
}

async function ensureUploadRuntime() {
  if (uploadHelper?.uploadChunkedFile && audioUploadUi && artworkUploadUi) return uploadHelper;
  setRuntimeStatus("pending", "HALO is re-checking the shared upload runtime and progress surface before accepting new packages.");
  try {
    uploadHelper = await loadUploadHelperScript();
  } catch (error) {
    setRuntimeUnavailable(error);
    throw new Error(RUNTIME_UNAVAILABLE_MESSAGE, { cause: error });
  }
  if (!uploadHelper || !bindUploadUi()) {
    const message = "HALO upload progress UI failed to initialize. Refresh this page and try again.";
    setRuntimeUnavailable(undefined, message);
    throw new Error(message);
  }
  elements.submitButton.disabled = false;
  elements.runtimeRetryButton.disabled = false;
  setRuntimeStatus("online", "HALO verified the shared upload runtime and progress surface. The controller is ready to build intake packages.");
  setControllerPhase("runtime", "Runtime verified. When you submit, HALO will immediately activate progress and begin package validation.", "complete");
  return uploadHelper;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PERSISTENCE_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("HALO could not confirm persisted assets in time. Please retry.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function stageChip(stage) {
  const label = STAGE_LABEL[stage] || String(stage || "uploaded").replaceAll("_", " ");
  return `<span class="stage-chip stage-${escapeHtml(stage || "uploaded")}">${escapeHtml(label)}</span>`;
}

function selectedRouteTargets() {
  return [...elements.form.querySelectorAll('input[name="routeTargets"]:checked')].map(input => input.value);
}

function fileKey(file) {
  return [file.name, file.size, file.webkitRelativePath || ""].join("::");
}

function gatherAudioFiles() {
  const picked = [...(elements.musicFiles.files || []), ...(elements.musicFolder.files || [])];
  const seen = new Set();
  return picked.filter(file => {
    const key = fileKey(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatMb(bytes) {
  return `${Math.max(1, Math.round((Number(bytes) || 0) / 1024 / 1024))} MB`;
}

function renderQueue() {
  const files = gatherAudioFiles();
  if (!files.length) {
    elements.musicQueue.innerHTML = `<p class="file-list-empty">No audio files selected yet. Link-only intake is allowed if you provide title, artist, and source links.</p>`;
    renderIntakeMetrics();
    return;
  }
  elements.musicQueue.innerHTML = files.map(file => `
    <div class="file-row">
      <span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.webkitRelativePath || "Single file")}</small></span>
      <span>${escapeHtml(formatMb(file.size))}</span>
    </div>
  `).join("");
  if (files.length === 1 && !$("#title").value.trim()) $("#title").value = files[0].name.replace(/\.[^.]+$/, "");
  renderIntakeMetrics();
}

function buildNotes(baseTitle, audioFile) {
  const officialLink = $("#officialLink").value.trim();
  const videoLinks = $("#videoLinks").value.trim();
  const routeTargets = selectedRouteTargets();
  const operatorNotes = $("#notes").value.trim();
  const lines = [
    "Halo Music Upload intake",
    `Title context: ${baseTitle}`,
    `Route targets: ${routeTargets.length ? routeTargets.join(", ") : "Dreamweaver review"}`,
  ];
  if (audioFile) lines.push(`Source file: ${audioFile.webkitRelativePath || audioFile.name}`);
  if (officialLink) lines.push(`Official link: ${officialLink}`);
  if (videoLinks) lines.push(`Video links:\n${videoLinks}`);
  if (operatorNotes) lines.push(`Notes:\n${operatorNotes}`);
  lines.push("Built from the Halo Music Upload intake hub for downstream Dreamweaver and department routing.");
  return lines.join("\n\n").slice(0, 4000);
}

function renderResults() {
  if (!state.results.length) {
    elements.resultsList.innerHTML = `
      <article class="result-card is-empty">
        <strong>No packages submitted yet.</strong>
        <p>Your built/processed feedback will appear here after each upload enters the pipeline.</p>
      </article>
    `;
    return;
  }
  elements.resultsList.innerHTML = state.results.map(result => {
    const routeGrid = Object.entries(result.departments || {}).map(([name, department]) => `
      <span class="route-pill">
        <small>${escapeHtml(name)}</small>
        <strong>${escapeHtml(department.label || "Pending")}</strong>
      </span>
    `).join("");
    const attentionNote = result.needsAttention
      ? `<p class="result-note needs-attention">${escapeHtml(result.needsAttention)}</p>`
      : `<p class="result-note">${escapeHtml(result.summary)}</p>`;
    const nextStepNote = result.nextStep ? `<p class="result-next-step">${escapeHtml(result.nextStep)}</p>` : "";
    return `
      <article class="result-card">
        <div class="result-topline">
          <div><span class="result-state-label">Package</span><strong>${escapeHtml(result.title)}</strong></div>
          ${stageChip(result.pipelineStatus)}
        </div>
        <div class="result-meta">
          <span>${escapeHtml(result.artistName)}</span>
          <span>${escapeHtml(result.surfaceLabel)}</span>
        </div>
        <div class="result-receipt">
          <p><span>Master record</span><strong>${escapeHtml(result.songId)}</strong></p>
          <p><span>Locked assets</span><strong>${escapeHtml(result.lockedAssets)}</strong></p>
          <p><span>Pipeline handoff</span><strong>${escapeHtml(result.handoffLabel)}</strong></p>
        </div>
        ${attentionNote}
        ${nextStepNote}
        <div class="route-grid">${routeGrid}</div>
      </article>
    `;
  }).join("");
}

function normalizeAudioType(file) {
  const aliases = {
    "audio/mp3": "audio/mpeg",
    "audio/x-mp3": "audio/mpeg",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "video/mp4": "audio/mp4",
    "audio/x-aac": "audio/aac",
    "application/ogg": "audio/ogg",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/x-flac": "audio/flac",
    "application/x-flac": "audio/flac",
  };
  if (aliases[file.type]) return aliases[file.type];
  if (file.type?.startsWith("audio/")) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", webm: "audio/webm", wav: "audio/wav", flac: "audio/flac" }[ext] || "";
}

function normalizeArtworkType(file) {
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file.type;
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[file.name.split(".").pop()?.toLowerCase() || ""] || "";
}

function audioDuration(file) {
  return new Promise(resolve => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const finish = value => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? Math.round(value) : 0);
    };
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => finish(audio.duration), { once: true });
    audio.addEventListener("error", () => finish(0), { once: true });
    audio.src = url;
  });
}

async function apiJson(url, payload, method = "POST") {
  const response = await fetch(url, payload ? {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  } : {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({ message: "Response could not be read" }));
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}

async function confirmPersistedAsset(url, label) {
  const headResponse = await fetchWithTimeout(url, {
    method: "HEAD",
    credentials: "same-origin",
    headers: { Accept: "*/*" },
  });
  if (headResponse.ok) {
    const sizeHeader = headResponse.headers.get("content-length");
    if (sizeHeader != null && sizeHeader !== "") {
      const size = Number(sizeHeader);
      if (!Number.isFinite(size) || size < 1) throw new Error(`HALO could not confirm persisted ${label}. Please retry.`);
    }
    return;
  }
  if (![405, 501].includes(headResponse.status)) throw new Error(`HALO could not confirm persisted ${label}. Please retry.`);
  const getResponse = await fetchWithTimeout(url, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "*/*", Range: "bytes=0-0" },
  });
  if (!getResponse.ok) throw new Error(`HALO could not confirm persisted ${label}. Please retry.`);
  const rangeHeader = getResponse.headers.get("content-range") || "";
  if (rangeHeader) {
    const total = Number(rangeHeader.split("/").pop() || "0");
    if (!Number.isFinite(total) || total < 1) throw new Error(`HALO could not confirm persisted ${label}. Please retry.`);
  }
}

async function uploadArtwork(songId, file) {
  const contentType = normalizeArtworkType(file);
  if (!contentType) throw new Error("Choose a JPEG, PNG, or WebP image file for cover art.");
  if (file.size > MAX_ARTWORK_BYTES) throw new Error("Cover art uploads are limited to 20 MB.");
  const uploadId = crypto.randomUUID();
  artworkUploadUi.start(`Uploading 0% · ${file.name}`);
  const { chunkCount } = await uploadHelper.uploadChunkedFile({
    url: "/api/song-catalog/artwork",
    file,
    chunkSize: ARTWORK_CHUNK_BYTES,
    buildBody({ chunkIndex, chunkCount, start, end }) {
      const form = new FormData();
      form.append("songId", songId);
      form.append("uploadId", uploadId);
      form.append("chunkIndex", String(chunkIndex));
      form.append("chunkCount", String(chunkCount));
      form.append("byteSize", String(file.size));
      form.append("filename", file.name);
      form.append("contentType", contentType);
      form.append("chunk", file.slice(start, end, contentType), file.name);
      return form;
    },
    onProgress(percent) {
      artworkUploadUi.progress(percent, `Uploading ${Math.round(percent)}% · ${file.name}`);
    },
  });
  artworkUploadUi.progress(100, "Finishing artwork upload…");
  const finalized = await apiJson("/api/song-catalog/artwork", {
    action: "finalize_upload",
    songId,
    uploadId,
    chunkCount,
    byteSize: file.size,
    filename: file.name,
    contentType,
  });
  const artworkUrl = finalized.artwork_url || finalized.artworkUrl;
  if (!finalized.persisted || !finalized.lockedIn || !artworkUrl) throw new Error("HALO could not confirm cover art persistence. Please retry.");
  await confirmPersistedAsset(artworkUrl, "cover art");
  artworkUploadUi.success("Cover art locked into HALO storage.", true);
  return artworkUrl;
}

async function uploadAudio(songId, versionId, file, position, total) {
  const contentType = normalizeAudioType(file);
  if (!contentType) throw new Error("Choose an MP3, M4A, AAC, OGG, WebM, WAV, or FLAC audio file.");
  if (file.size > MAX_AUDIO_BYTES) throw new Error("Music uploads are limited to 128 MB per file.");
  const uploadId = crypto.randomUUID();
  audioUploadUi.start(`Uploading ${position} of ${total} · ${file.name}`);
  const { chunkCount } = await uploadHelper.uploadChunkedFile({
    url: "/api/song-catalog/audio",
    file,
    chunkSize: AUDIO_CHUNK_BYTES,
    buildBody({ chunkIndex, chunkCount, start, end }) {
      const form = new FormData();
      form.append("songId", songId);
      form.append("versionId", versionId);
      form.append("uploadId", uploadId);
      form.append("chunkIndex", String(chunkIndex));
      form.append("chunkCount", String(chunkCount));
      form.append("byteSize", String(file.size));
      form.append("filename", file.name);
      form.append("contentType", contentType);
      form.append("chunk", file.slice(start, end, contentType), file.name);
      return form;
    },
    onProgress(percent) {
      audioUploadUi.progress(percent, `Uploading ${position} of ${total} · ${Math.round(percent)}% · ${file.name}`);
    },
  });
  audioUploadUi.progress(100, `Finishing ${file.name}…`);
  const finalized = await apiJson("/api/song-catalog/audio", {
    action: "finalize_upload",
    songId,
    versionId,
    uploadId,
    chunkCount,
    byteSize: file.size,
    filename: file.name,
    contentType,
    durationSeconds: await audioDuration(file),
  });
  if (!finalized.persisted || !finalized.lockedIn || !finalized.audioUrl) throw new Error(`HALO could not confirm persistence for ${file.name}. Please retry.`);
  await confirmPersistedAsset(finalized.audioUrl, "audio");
  audioUploadUi.success(`${file.name} is locked into HALO storage.`, true);
  return finalized.audioUrl;
}

async function loadCatalogSong(songId) {
  const response = await apiJson("/api/song-catalog", null, "GET");
  return (response.songs || []).find(song => song.id === songId) || null;
}

async function processPackage({ artistName, title, albumTitle, genre, isrc, upc, rightsStatus, saleStatus, explicitLyrics, artworkFile, file, position, total }) {
  setControllerPhase("package", `Creating the master package for ${title} and validating metadata, rights, and route targets.`);
  const notes = buildNotes(title, file);
  const created = await apiJson("/api/unified-upload", {
    action: "create_project",
    title,
    artistName,
    albumTitle,
    genre,
    isrc,
    upc,
    rightsStatus,
    saleStatus,
    explicitLyrics,
    notes,
    surface: "music_upload",
  });
  setMessage(`Received ${title}. Validating the handoff package…`);
  await apiJson("/api/unified-upload", { action: "advance_pipeline", songId: created.songId, toStage: "processing" });
  await apiJson("/api/song-catalog", {
    action: "save_song",
    songId: created.songId,
    artistName,
    title,
    albumTitle,
    genre,
    isrc,
    upc,
    rightsStatus,
    saleStatus,
    explicitLyrics,
    notes,
  });
  setControllerPhase(
    "transfer",
    file || artworkFile
      ? "Uploading source assets into the tracked HALO package with live transfer progress."
      : "No source files were attached, so HALO is preparing a metadata-first intake package.",
  );
  if (file) {
    const versionId = created.versionIds?.sale_master || created.versionIds?.radio_edit;
    if (!versionId) throw new Error("The intake package did not provision an audio version.");
    await uploadAudio(created.songId, versionId, file, position, total);
  }

  if (artworkFile) await uploadArtwork(created.songId, artworkFile);
  setControllerPhase("persistence", "HALO is confirming persisted bytes and storage lock-in before routing the package.");
  const finalStage = file && artworkFile ? "dreamweaver_in_progress" : "needs_assets";
  setControllerPhase(
    "handoff",
    finalStage === "dreamweaver_in_progress"
      ? "HALO is handing the locked package into Dreamweaver build processing and downstream department views."
      : "HALO is saving the package in Needs attention until the remaining source assets arrive.",
  );
  const pipeline = await apiJson("/api/unified-upload", { action: "advance_pipeline", songId: created.songId, toStage: finalStage });
  const song = await loadCatalogSong(created.songId).catch(() => null);
  const issueCount = Array.isArray(song?.metadataIssues) ? song.metadataIssues.filter(issue => issue.level === "required").length : 0;
  return {
    songId: created.songId,
    title,
    artistName,
    surfaceLabel: "Halo Music Upload",
    pipelineStatus: pipeline.pipelineStatus,
    departments: pipeline.departments,
    lockedAssets: file && artworkFile ? "Audio + artwork locked" : file ? "Audio locked · artwork pending" : artworkFile ? "Artwork locked · audio pending" : "Metadata package only",
    handoffLabel: finalStage === "dreamweaver_in_progress" ? "Dreamweaver build active" : "Needs attention queue",
    summary: finalStage === "dreamweaver_in_progress"
      ? "Audio/artwork persisted and locked. Package moved into Dreamweaver build processing."
      : file
        ? "Audio persisted and locked. Waiting on cover art or missing assets."
        : "Metadata routed. Add audio/artwork to lock source assets into HALO.",
    needsAttention: finalStage === "needs_assets"
      ? file
        ? "Needs attention: add cover art or more approved assets before the package can move deeper into the build."
        : "Needs attention: add audio or cover art when the source assets are ready so the package can move from intake review into the build."
      : issueCount
        ? `Needs attention: Dreamweaver review found ${issueCount} blocking item${issueCount === 1 ? "" : "s"} in the catalog package.`
        : "",
    nextStep: finalStage === "dreamweaver_in_progress"
      ? "Next: Dreamweaver now processes this locked package. You can close this page or upload another song."
      : "Next: Upload remaining assets. This package is saved; remove or replace files only if needed.",
  };
}

async function handleRuntimeRetry() {
  elements.runtimeRetryButton.disabled = true;
  setMessage("Reinitializing the HALO upload controller…");
  try {
    await ensureUploadRuntime();
    setMessage("HALO upload controller restored. You can submit the intake package now.");
  } catch (error) {
    setMessage(error.message);
  } finally {
    elements.runtimeRetryButton.disabled = false;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  try {
    await ensureUploadRuntime();
  } catch (error) {
    setMessage(error.message);
    return;
  }
  const audioFiles = gatherAudioFiles();
  const artworkFile = elements.artworkFile.files?.[0] || null;
  const artistName = $("#artistName").value.trim();
  const title = $("#title").value.trim();
  const albumTitle = $("#albumTitle").value.trim();
  const genre = $("#genre").value.trim();
  const isrc = $("#isrc").value.trim();
  const upc = $("#upc").value.trim();
  const rightsStatus = $("#rightsStatus").value;
  const saleStatus = $("#saleStatus").value;
  const explicitLyrics = $("#explicitLyrics").checked;
  try {
    if (!artistName) throw new Error("Add the artist name before submitting the intake package.");
    if (!audioFiles.length && !title) throw new Error("Add a song title when sending a link-only or metadata-only intake package.");
    if (!audioFiles.length) {
      const officialLink = $("#officialLink").value.trim();
      const videoLinks = normalizeHttpsList($("#videoLinks").value);
      if (!officialLink && !videoLinks.length) throw new Error("Add music files, or provide an official link or video link so HALO has source material to route.");
    }
    if ($("#officialLink").value.trim()) normalizeHttpsList($("#officialLink").value);
    normalizeHttpsList($("#videoLinks").value);
  } catch (error) {
    setMessage(error.message);
    return;
  }

  elements.submitButton.disabled = true;
  state.results = [];
  renderResults();
  setMessage("Submitting your Halo Music Upload package…");
  setControllerPhase("package", "HALO is assembling the master package and validating every selected intake field.");
  if (audioFiles.length) {
    audioUploadUi.start(`Preparing ${audioFiles.length === 1 ? "music upload" : `music upload 1 of ${audioFiles.length}`}…`);
  } else {
    audioUploadUi.idle("No music uploaded yet.");
  }
  if (artworkFile) {
    artworkUploadUi.start(audioFiles.length ? "Artwork upload queued after music lock-in…" : "Preparing cover art upload…");
  } else {
    artworkUploadUi.idle("No artwork uploaded yet.");
  }

  try {
    const jobs = audioFiles.length ? audioFiles.map(file => ({
      file,
      title: audioFiles.length === 1 && title ? title : file.name.replace(/\.[^.]+$/, ""),
    })) : [{ file: null, title }];

    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const result = await processPackage({
        artistName,
        title: job.title,
        albumTitle,
        genre,
        isrc,
        upc,
        rightsStatus,
        saleStatus,
        explicitLyrics,
        artworkFile,
        file: job.file,
        position: index + 1,
        total: jobs.length,
      });
      state.results = [result, ...state.results];
      renderResults();
    }
    elements.form.reset();
    renderQueue();
    setControllerPhase("handoff", "Pipeline handoff complete. The package is saved, visible, and ready for the next intake run.", "complete");
    audioUploadUi.idle("Upload complete. Add the next intake package when ready.");
    artworkUploadUi.idle("Artwork attached where supplied.");
    setMessage(`Upload complete: ${jobs.length} package${jobs.length === 1 ? "" : "s"} saved. Files marked locked-in are persisted in HALO and should be removed only if needed.`);
  } catch (error) {
    setControllerPhase(state.controllerPhase, error.message, "error");
    audioUploadUi.fail(error.message);
    artworkUploadUi.fail(error.message);
    setMessage(error.message);
  } finally {
    elements.submitButton.disabled = false;
  }
}

elements.musicFiles.addEventListener("change", renderQueue);
elements.musicFolder.addEventListener("change", renderQueue);
elements.artworkFile.addEventListener("change", renderIntakeMetrics);
elements.form.querySelectorAll('input[name="routeTargets"], #officialLink, #videoLinks').forEach(element => {
  element.addEventListener("change", renderIntakeMetrics);
  element.addEventListener("input", renderIntakeMetrics);
});
elements.runtimeRetryButton.addEventListener("click", handleRuntimeRetry);
elements.form.addEventListener("submit", handleSubmit);
renderControllerTimeline();
renderQueue();
renderResults();
renderIntakeMetrics();
