const $ = selector => document.querySelector(selector);
const uploadHelper = window.HaloUploadProgress;
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

const state = { results: [] };
const elements = {
  form: $("#musicUploadForm"),
  submitButton: $("#submitButton"),
  message: $("#formMessage"),
  musicFiles: $("#musicFiles"),
  musicFolder: $("#musicFolder"),
  musicQueue: $("#musicQueue"),
  artworkFile: $("#artworkFile"),
  resultsList: $("#resultsList"),
};

const audioUploadUi = uploadHelper.createUploadUi({
  panel: document.querySelector('[aria-labelledby="musicFilesHeading"]'),
  status: $("#audioUploadProgress"),
  track: $("#audioUploadTrack"),
  fill: $("#audioUploadTrack .upload-progress-fill"),
  idleMessage: "No music uploaded yet.",
});

const artworkUploadUi = uploadHelper.createUploadUi({
  panel: document.querySelector('[aria-labelledby="artworkHeading"]'),
  status: $("#artworkUploadProgress"),
  track: $("#artworkUploadTrack"),
  fill: $("#artworkUploadTrack .upload-progress-fill"),
  idleMessage: "No artwork uploaded yet.",
});

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function setMessage(text) {
  elements.message.textContent = text;
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
    return;
  }
  elements.musicQueue.innerHTML = files.map(file => `
    <div class="file-row">
      <span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.webkitRelativePath || "Single file")}</small></span>
      <span>${escapeHtml(formatMb(file.size))}</span>
    </div>
  `).join("");
  if (files.length === 1 && !$("#title").value.trim()) $("#title").value = files[0].name.replace(/\.[^.]+$/, "");
}

function normalizeHttpsList(rawValue) {
  return String(rawValue || "")
    .split(/\n+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use https:// links only for official and video sources.");
      return url.toString();
    });
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
        ${attentionNote}
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
  await apiJson("/api/song-catalog/artwork", {
    action: "finalize_upload",
    songId,
    uploadId,
    chunkCount,
    byteSize: file.size,
    filename: file.name,
    contentType,
  });
  artworkUploadUi.success("Cover art uploaded and attached.", true);
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
  await apiJson("/api/song-catalog/audio", {
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
  audioUploadUi.success(`${file.name} uploaded and attached.`, true);
  return `/api/song-catalog/audio?versionId=${versionId}`;
}

async function loadCatalogSong(songId) {
  const response = await apiJson("/api/song-catalog", null, "GET");
  return (response.songs || []).find(song => song.id === songId) || null;
}

async function processPackage({ artistName, title, albumTitle, genre, isrc, upc, rightsStatus, saleStatus, explicitLyrics, artworkFile, file, position, total }) {
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

  if (file) {
    const versionId = created.versionIds?.sale_master || created.versionIds?.radio_edit;
    if (!versionId) throw new Error("The intake package did not provision an audio version.");
    const uploadedAudioUrl = await uploadAudio(created.songId, versionId, file, position, total);
    if (created.versionIds?.radio_edit && created.versionIds.radio_edit !== versionId) {
      await apiJson("/api/song-catalog", {
        action: "save_version",
        songId: created.songId,
        versionId: created.versionIds.radio_edit,
        versionType: "radio_edit",
        label: "Radio edit",
        masteringStatus: "queued",
        audioUrl: uploadedAudioUrl,
        cleanLyrics: !explicitLyrics,
        saleEnabled: false,
        notes: "Mirrors the uploaded intake master until a dedicated radio edit is delivered.",
      });
    }
  }

  if (artworkFile) await uploadArtwork(created.songId, artworkFile);
  const finalStage = file ? (artworkFile ? "dreamweaver_in_progress" : "needs_assets") : "processing";
  const pipeline = finalStage === "processing"
    ? await apiJson(`/api/unified-upload?songId=${encodeURIComponent(created.songId)}`, null, "GET")
    : await apiJson("/api/unified-upload", { action: "advance_pipeline", songId: created.songId, toStage: finalStage });
  const song = await loadCatalogSong(created.songId).catch(() => null);
  const issueCount = Array.isArray(song?.metadataIssues) ? song.metadataIssues.filter(issue => issue.level === "required").length : 0;
  return {
    songId: created.songId,
    title,
    artistName,
    surfaceLabel: "Halo Music Upload",
    pipelineStatus: pipeline.pipelineStatus,
    departments: pipeline.departments,
    summary: finalStage === "dreamweaver_in_progress"
      ? "Built and routed into Dreamweaver-ready processing."
      : finalStage === "processing"
        ? "Validated and queued for Dreamweaver review while source material is gathered."
        : "Received and routed, but still waiting on cover art or missing assets.",
    needsAttention: finalStage === "needs_assets"
      ? "Needs attention: add cover art or more approved assets before the package can move deeper into the build."
      : issueCount
        ? `Needs attention: Dreamweaver review found ${issueCount} blocking item${issueCount === 1 ? "" : "s"} in the catalog package.`
        : "",
  };
}

async function handleSubmit(event) {
  event.preventDefault();
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
  audioUploadUi.idle("No music uploaded yet.");
  artworkUploadUi.idle("No artwork uploaded yet.");

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
      setMessage(`${result.title} is now ${STAGE_LABEL[result.pipelineStatus] || result.pipelineStatus}.`);
    }
    elements.form.reset();
    renderQueue();
    audioUploadUi.idle("Upload complete. Add the next intake package when ready.");
    artworkUploadUi.idle("Artwork attached where supplied.");
  } catch (error) {
    audioUploadUi.fail(error.message);
    artworkUploadUi.fail(error.message);
    setMessage(error.message);
  } finally {
    elements.submitButton.disabled = false;
  }
}

elements.musicFiles.addEventListener("change", renderQueue);
elements.musicFolder.addEventListener("change", renderQueue);
elements.form.addEventListener("submit", handleSubmit);
renderQueue();
renderResults();
