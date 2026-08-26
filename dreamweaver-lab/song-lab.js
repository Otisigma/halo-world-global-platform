(() => {
  const byId = id => document.getElementById(id);
  const elements = {
    form: byId("songForm"), file: byId("songFile"), title: byId("songTitle"), artist: byId("artistName"), brief: byId("creativeBrief"), lyrics: byId("lyrics"), rights: byId("rightsAttested"),
    dropZone: byId("dropZone"), dropTitle: byId("dropTitle"), dropDetail: byId("dropDetail"), analyze: byId("analyzeButton"), status: byId("formStatus"), canvas: byId("waveCanvas"), waveIdle: byId("waveIdle"),
    duration: byId("signalDuration"), audio: byId("audioPreview"), processing: byId("processing"), processingStage: byId("processingStage"), processingTitle: byId("processingTitle"), processingDetail: byId("processingDetail"),
    results: byId("results"), resultTitle: byId("resultTitle"), resultSummary: byId("resultSummary"), cover: byId("coverFrame"), visualConcept: byId("visualConcept"), visualTypography: byId("visualTypography"), visualPalette: byId("visualPalette"),
    moods: byId("moodTags"), genres: byId("genreList"), audience: byId("audienceCopy"), structures: byId("structureList"), mixes: byId("mixList"), tagline: byId("campaignTagline"), releaseCopy: byId("releaseCopy"), captions: byId("captionStack"), rollout: byId("rolloutList"), videos: byId("videoList"), limits: byId("limitsList"), confidence: byId("confidenceNote"), history: byId("historyGrid"), download: byId("downloadPackage"), toast: byId("toast"),
    artworkFile: byId("artworkFile"), artworkDropZone: byId("artworkDropZone"), artworkDropTitle: byId("artworkDropTitle"), artworkDropDetail: byId("artworkDropDetail")
  };
  const metrics = { tempo: byId("metricTempo"), key: byId("metricKey"), dynamics: byId("metricDynamics"), brightness: byId("metricBrightness"), peak: byId("metricPeak"), width: byId("metricWidth") };
  const state = { file: null, artworkFile: null, artworkObjectUrl: "", audioBuffer: null, objectUrl: "", evidence: null, project: null, pollTimer: 0, projects: [] };
  const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
  function formatTime(seconds) { const value = Math.max(0, Number(seconds || 0)); return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`; }
  function titleFromFile(name) { return name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); }
  function showToast(message) { elements.toast.textContent = message; elements.toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3200); }
  function setStatus(message, error = false) { elements.status.textContent = message; elements.status.style.color = error ? "#ff9274" : ""; }
  function list(items) { return (items || []).map(item => `<li>${escapeHtml(item)}</li>`).join(""); }
  function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
  function percentile(values, ratio) { if (!values.length) return 0; const ordered = [...values].sort((a, b) => a - b); return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))]; }

  function drawWaveform(buffer) {
    const canvas = elements.canvas;
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const middle = height / 2;
    const data = buffer.getChannelData(0);
    context.clearRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#bd9b58"); gradient.addColorStop(.45, "#f3eedf"); gradient.addColorStop(1, "#d3ff58");
    context.strokeStyle = gradient; context.lineWidth = 1.4; context.beginPath();
    const step = Math.max(1, Math.floor(data.length / width));
    for (let x = 0; x < width; x += 1) {
      let minimum = 1, maximum = -1;
      const start = x * step;
      for (let index = start; index < Math.min(data.length, start + step); index += 1) { minimum = Math.min(minimum, data[index]); maximum = Math.max(maximum, data[index]); }
      context.moveTo(x, middle + minimum * middle * .86); context.lineTo(x, middle + maximum * middle * .86);
    }
    context.stroke();
  }

  function monoSample(buffer, index) {
    let value = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) value += buffer.getChannelData(channel)[index] || 0;
    return value / buffer.numberOfChannels;
  }

  function estimateTempo(buffer) {
    const sampleRate = buffer.sampleRate;
    const hop = 1024;
    const length = Math.min(buffer.length, Math.floor(sampleRate * 180));
    const envelope = [];
    for (let start = 0; start + hop <= length; start += hop) {
      let energy = 0;
      for (let index = start; index < start + hop; index += 4) { const sample = monoSample(buffer, index); energy += sample * sample; }
      envelope.push(Math.sqrt(energy / (hop / 4)));
    }
    const onset = envelope.map((value, index) => Math.max(0, value - (envelope[index - 1] || value)));
    const frameRate = sampleRate / hop;
    let bestBpm = 0, bestScore = -1;
    for (let bpm = 60; bpm <= 190; bpm += 1) {
      const lag = Math.round(frameRate * 60 / bpm);
      let score = 0;
      for (let index = lag; index < onset.length; index += 1) score += onset[index] * onset[index - lag];
      score *= 1 + .08 * Math.cos((bpm - 112) / 78 * Math.PI);
      if (score > bestScore) { bestScore = score; bestBpm = bpm; }
    }
    return bestBpm;
  }

  function spectralEvidence(buffer) {
    const sampleRate = buffer.sampleRate;
    const fftSize = 512;
    const frames = Math.min(54, Math.max(18, Math.floor(buffer.duration / 3)));
    const chroma = Array(12).fill(0);
    let centroidTotal = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const center = Math.floor((frame + .5) / frames * Math.max(fftSize, buffer.length - fftSize));
      let magnitudeTotal = 0, weightedTotal = 0;
      for (let bin = 1; bin < fftSize / 2; bin += 1) {
        const frequency = bin * sampleRate / fftSize;
        if (frequency > 6000) break;
        let real = 0, imaginary = 0;
        for (let index = 0; index < fftSize; index += 4) {
          const sample = monoSample(buffer, Math.min(buffer.length - 1, center + index - fftSize / 2));
          const angle = 2 * Math.PI * bin * index / fftSize;
          const window = .5 - .5 * Math.cos(2 * Math.PI * index / (fftSize - 1));
          real += sample * window * Math.cos(angle); imaginary -= sample * window * Math.sin(angle);
        }
        const magnitude = Math.hypot(real, imaginary);
        magnitudeTotal += magnitude; weightedTotal += frequency * magnitude;
        if (frequency >= 55 && frequency <= 5000) {
          const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
          chroma[((midi % 12) + 12) % 12] += magnitude;
        }
      }
      centroidTotal += magnitudeTotal ? weightedTotal / magnitudeTotal : 0;
    }
    const major = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
    const minor = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
    const scores = [];
    for (let root = 0; root < 12; root += 1) {
      scores.push({ root, mode: "major", score: chroma.reduce((sum, value, index) => sum + value * major[(index - root + 12) % 12], 0) });
      scores.push({ root, mode: "minor", score: chroma.reduce((sum, value, index) => sum + value * minor[(index - root + 12) % 12], 0) });
    }
    scores.sort((a, b) => b.score - a.score);
    const confidence = scores[0]?.score ? Math.max(0, Math.min(1, (scores[0].score - scores[1].score) / scores[0].score * 5)) : 0;
    return { key: `${noteNames[scores[0]?.root || 0]} ${scores[0]?.mode || "major"}`, keyConfidence: confidence, centroid: centroidTotal / frames };
  }

  function analyzeBuffer(buffer) {
    const frameSize = 2048;
    const frameCount = Math.min(420, Math.max(32, Math.floor(buffer.length / frameSize)));
    const rmsValues = [];
    let peak = 0, crossings = 0, sampleCount = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const start = Math.floor(frame / frameCount * Math.max(1, buffer.length - frameSize));
      let sum = 0, previous = monoSample(buffer, start);
      for (let index = start; index < Math.min(buffer.length, start + frameSize); index += 2) {
        const sample = monoSample(buffer, index); sum += sample * sample; peak = Math.max(peak, Math.abs(sample));
        if ((sample >= 0) !== (previous >= 0)) crossings += 1; previous = sample; sampleCount += 1;
      }
      rmsValues.push(Math.sqrt(sum / Math.max(1, frameSize / 2)));
    }
    const averageRms = average(rmsValues);
    const quiet = Math.max(.000001, percentile(rmsValues, .1));
    const loud = Math.max(quiet, percentile(rmsValues, .9));
    let stereoWidth = 0;
    if (buffer.numberOfChannels > 1) {
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1); let side = 0, mid = 0;
      const step = Math.max(1, Math.floor(buffer.length / 200000));
      for (let index = 0; index < buffer.length; index += step) { const middle = (left[index] + right[index]) * .5; const difference = (left[index] - right[index]) * .5; mid += middle * middle; side += difference * difference; }
      stereoWidth = Math.sqrt(side / Math.max(mid, .000001));
    }
    const sections = Array.from({ length: 10 }, (_, section) => average(rmsValues.slice(Math.floor(section * rmsValues.length / 10), Math.floor((section + 1) * rmsValues.length / 10))));
    const maxSection = Math.max(...sections, .000001);
    const spectral = spectralEvidence(buffer);
    return {
      durationSeconds: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels,
      estimatedBpm: estimateTempo(buffer), estimatedKey: spectral.key, keyConfidence: spectral.keyConfidence,
      averageRms, peak, crestFactorDb: 20 * Math.log10(Math.max(peak, .000001) / Math.max(averageRms, .000001)),
      dynamicRangeDb: 20 * Math.log10(loud / quiet), stereoWidth, spectralCentroidHz: spectral.centroid,
      zeroCrossingRate: crossings / Math.max(1, sampleCount), sectionEnergy: sections.map(value => value / maxSection)
    };
  }

  function renderMetrics(evidence) {
    metrics.tempo.textContent = evidence.estimatedBpm ? String(evidence.estimatedBpm) : "—";
    metrics.key.textContent = evidence.estimatedKey || "—";
    metrics.dynamics.textContent = `${evidence.dynamicRangeDb.toFixed(1)} dB`;
    metrics.brightness.textContent = evidence.spectralCentroidHz >= 1000 ? `${(evidence.spectralCentroidHz / 1000).toFixed(1)}k Hz` : `${Math.round(evidence.spectralCentroidHz)} Hz`;
    metrics.peak.textContent = `${(20 * Math.log10(Math.max(evidence.peak, .000001))).toFixed(1)} dB`;
    metrics.width.textContent = evidence.channels < 2 ? "Mono" : evidence.stereoWidth < .18 ? "Narrow" : evidence.stereoWidth > .75 ? "Wide" : "Balanced";
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > 128 * 1024 * 1024) return setStatus("Keep the audio file under 128 MB.", true);
    state.file = file; state.evidence = null; elements.analyze.disabled = true;
    elements.dropTitle.textContent = file.name; elements.dropDetail.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · reading waveform…`;
    if (!elements.title.value) elements.title.value = titleFromFile(file.name);
    setStatus("Reading the waveform locally. The upload has not started yet.");
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      await context.close(); state.audioBuffer = buffer;
      drawWaveform(buffer); elements.waveIdle.hidden = true; elements.duration.textContent = formatTime(buffer.duration);
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl); state.objectUrl = URL.createObjectURL(file); elements.audio.src = state.objectUrl; elements.audio.hidden = false;
      await new Promise(resolve => setTimeout(resolve, 30));
      state.evidence = analyzeBuffer(buffer); renderMetrics(state.evidence);
      elements.dropDetail.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · ${formatTime(buffer.duration)} · ${buffer.numberOfChannels === 1 ? "mono" : `${buffer.numberOfChannels} channels`}`;
      elements.analyze.disabled = false; setStatus("Signal ready. Confirm your rights and build the package.");
      window.haloStats?.track("dreamweaver_song_loaded", { file_type: file.type || "unknown" });
    } catch { state.file = null; setStatus("This browser could not decode that audio file. Try a WAV, MP3, M4A, OGG, or WebM file.", true); }
  }

  function loadArtworkFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { showToast("Keep the artwork under 20 MB."); return; }
    if (!file.type.startsWith("image/")) { showToast("Choose a JPEG, PNG, or WebP image for the artwork."); return; }
    state.artworkFile = file;
    if (state.artworkObjectUrl) URL.revokeObjectURL(state.artworkObjectUrl);
    state.artworkObjectUrl = URL.createObjectURL(file);
    elements.artworkDropTitle.textContent = file.name;
    elements.artworkDropDetail.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · cover ready`;
    if (elements.artworkDropZone) elements.artworkDropZone.classList.add("has-file");
  }

  async function uploadFile(file) {
    const uploadId = crypto.randomUUID(); const chunkSize = 3.5 * 1024 * 1024; const chunkCount = Math.ceil(file.size / chunkSize);
    for (let index = 0; index < chunkCount; index += 1) {
      elements.processingStage.textContent = `SECURING AUDIO / ${index + 1} OF ${chunkCount}`;
      elements.processingDetail.textContent = "Uploading encrypted private chunks into HALO storage. Nothing is published.";
      const body = new FormData(); body.append("chunk", file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize), file.type), file.name); body.append("uploadId", uploadId); body.append("chunkIndex", String(index)); body.append("chunkCount", String(chunkCount));
      const response = await fetch("/api/dreamweaver-song-lab", { method: "POST", body, credentials: "same-origin" });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || "The private audio upload stopped early.");
    }
    return { uploadId, chunkCount };
  }

  async function pollProject(projectId) {
    clearTimeout(state.pollTimer);
    const response = await fetch(`/api/dreamweaver-song-lab?projectId=${encodeURIComponent(projectId)}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The Song Lab project could not be read.");
    state.project = data.project;
    if (data.project.status === "ready") { showProject(data.project); await loadHistory(); return; }
    if (data.project.status === "failed") throw new Error(data.project.errorMessage || "The Song Lab package stopped before completion.");
    elements.processingStage.textContent = data.project.status === "analyzing" ? "WEAVING THE RELEASE WORLD" : "ANALYSIS QUEUED";
    elements.processingDetail.textContent = data.project.status === "analyzing" ? "Dreamweaver is grounding the visual system, campaign, and release notes in the measured signal." : "The private job is saved and preparing to run.";
    state.pollTimer = setTimeout(() => pollProject(projectId).catch(handleFailure), 1800);
  }

  function handleFailure(error) { elements.processing.hidden = true; elements.analyze.disabled = false; setStatus(error.message || "Dreamweaver could not complete this package.", true); showToast(error.message || "Song Lab stopped."); }

  async function submit(event) {
    event.preventDefault();
    if (!state.file || !state.evidence) return setStatus("Choose and decode an audio file first.", true);
    if (!elements.rights.checked) return setStatus("Confirm that you may use this recording.", true);
    elements.analyze.disabled = true; elements.results.hidden = true; elements.processing.hidden = false; elements.processing.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const upload = await uploadFile(state.file);
      elements.processingStage.textContent = "STARTING DREAMWEAVER"; elements.processingDetail.textContent = "The waveform evidence and artist context are entering the private creative engine.";
      const response = await fetch("/api/dreamweaver-song-lab", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "analyze", ...upload, title: elements.title.value, artistName: elements.artist.value, creativeBrief: elements.brief.value, lyrics: elements.lyrics.value,
        rightsAttested: elements.rights.checked, fileName: state.file.name, contentType: state.file.type, byteSize: state.file.size, analysis: state.evidence
      }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || "Dreamweaver could not start the analysis.");
      state.project = data.project; window.haloStats?.track("dreamweaver_song_analysis_started", { project_id: data.project.id }); await pollProject(data.project.id);
    } catch (error) { handleFailure(error); }
  }

  function colorValue(name, index) {
    const map = { "ink black":"#0b0c09", "aged ivory":"#e9e1ce", "signal green":"#d3ff58", "burnished gold":"#bd9b58", "smoke grey":"#77776f" };
    if (/^#[0-9a-f]{6}$/i.test(name)) return name;
    return map[String(name).toLowerCase()] || ["#14150f", "#d3ff58", "#bd9b58", "#ece6d8", "#6c594a", "#8b372d"][index % 6];
  }

  function showProject(project) {
    const pack = project.creativePackage || {}; const visual = pack.visualDirection || {}; const campaign = pack.campaign || {};
    elements.processing.hidden = true; elements.results.hidden = false; elements.resultTitle.textContent = `${project.title} has a world.`; elements.resultSummary.textContent = pack.sonicSummary || "The creative package is ready.";
    elements.cover.innerHTML = project.artworkUrl ? `<img src="${escapeHtml(project.artworkUrl)}" alt="Original Dreamweaver cover artwork for ${escapeHtml(project.title)}">` : `<div class="cover-placeholder"><span>DW</span><small>CREATIVE DIRECTION READY</small></div>`;
    elements.visualConcept.textContent = visual.concept || "Original visual direction"; elements.visualTypography.textContent = visual.typography || ""; elements.visualPalette.innerHTML = (visual.palette || []).map((color, index) => `<i title="${escapeHtml(color)}" style="background:${colorValue(color, index)}"></i>`).join("");
    elements.moods.innerHTML = (pack.moodWords || []).map(item => `<i>${escapeHtml(item)}</i>`).join(""); elements.genres.innerHTML = list(pack.genreInfluences); elements.audience.textContent = pack.audience || "";
    elements.structures.innerHTML = list(pack.structureNotes); elements.mixes.innerHTML = list(pack.mixNotes); elements.tagline.textContent = campaign.tagline || ""; elements.releaseCopy.textContent = campaign.releaseCopy || "";
    elements.captions.innerHTML = (campaign.shortCaptions || []).map(item => `<button type="button" data-caption="${escapeHtml(item)}">${escapeHtml(item)}<br><small>Click to copy</small></button>`).join("");
    elements.rollout.innerHTML = list(campaign.rollout); elements.videos.innerHTML = list(campaign.videoConcepts); elements.limits.innerHTML = list(pack.factualLimits); elements.confidence.textContent = pack.confidenceNote || "";
    elements.results.scrollIntoView({ behavior: "smooth", block: "start" }); elements.analyze.disabled = false; setStatus("Package complete. Review every factual detail before publishing.");
    window.haloStats?.track("dreamweaver_song_package_ready", { project_id: project.id, model: project.model });
  }

  function projectText(project) {
    const pack = project.creativePackage || {}, visual = pack.visualDirection || {}, campaign = pack.campaign || {};
    return [`DREAMWEAVER SONG LAB — ${project.title}`, project.artistName ? `Artist: ${project.artistName}` : "", "", "SONIC SUMMARY", pack.sonicSummary, pack.confidenceNote, "", `MOOD: ${(pack.moodWords || []).join(", ")}`, `GENRE INFLUENCES: ${(pack.genreInfluences || []).join(", ")}`, "", "STRUCTURE", ...(pack.structureNotes || []).map(item => `- ${item}`), "", "MIX NOTES", ...(pack.mixNotes || []).map(item => `- ${item}`), "", "VISUAL DIRECTION", visual.concept, `Palette: ${(visual.palette || []).join(", ")}`, `Typography: ${visual.typography || ""}`, `Cover prompt: ${visual.coverPrompt || ""}`, "", "CAMPAIGN", campaign.tagline, campaign.releaseCopy, ...(campaign.shortCaptions || []).map(item => `- ${item}`), "", "ROLLOUT", ...(campaign.rollout || []).map((item, index) => `${index + 1}. ${item}`), "", "FACTUAL LIMITS", ...(pack.factualLimits || []).map(item => `- ${item}`)].filter(value => value !== undefined).join("\n");
  }

  function downloadProject() { if (!state.project) return; const blob = new Blob([projectText(state.project)], { type: "text/plain;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${state.project.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "dreamweaver"}-creative-package.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500); }

  function renderHistory() {
    elements.history.innerHTML = state.projects.length ? state.projects.map(project => `<button class="history-card" type="button" data-project-id="${escapeHtml(project.id)}"><small>${escapeHtml(project.status)} / ${new Date(project.createdAt).toLocaleDateString()}</small><strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(project.artistName || project.fileName)} · ${formatTime(project.durationSeconds)}</span></button>`).join("") : `<p class="history-empty">No saved Song Lab projects yet.</p>`;
  }

  async function loadHistory() { try { const response = await fetch("/api/dreamweaver-song-lab", { credentials: "same-origin", headers: { Accept: "application/json" } }); const data = await response.json().catch(() => ({})); if (!response.ok) return; state.projects = data.projects || []; renderHistory(); } catch {} }

  elements.file.addEventListener("change", event => loadFile(event.target.files?.[0]));
  if (elements.artworkFile) elements.artworkFile.addEventListener("change", event => loadArtworkFile(event.target.files?.[0]));
  ["dragenter", "dragover"].forEach(name => elements.dropZone.addEventListener(name, event => { event.preventDefault(); elements.dropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(name => elements.dropZone.addEventListener(name, event => { event.preventDefault(); elements.dropZone.classList.remove("dragging"); }));
  elements.dropZone.addEventListener("drop", event => { const file = event.dataTransfer?.files?.[0]; if (file) loadFile(file); });
  if (elements.artworkDropZone) {
    ["dragenter", "dragover"].forEach(name => elements.artworkDropZone.addEventListener(name, event => { event.preventDefault(); elements.artworkDropZone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach(name => elements.artworkDropZone.addEventListener(name, event => { event.preventDefault(); elements.artworkDropZone.classList.remove("dragging"); }));
    elements.artworkDropZone.addEventListener("drop", event => { const file = event.dataTransfer?.files?.[0]; if (file) loadArtworkFile(file); });
  }
  elements.form.addEventListener("submit", submit); elements.download.addEventListener("click", downloadProject);
  elements.captions.addEventListener("click", async event => { const button = event.target.closest("[data-caption]"); if (!button) return; try { await navigator.clipboard.writeText(button.dataset.caption); showToast("Caption copied."); } catch { showToast("Select the caption and copy it manually."); } });
  elements.history.addEventListener("click", event => { const project = state.projects.find(item => item.id === event.target.closest("[data-project-id]")?.dataset.projectId); if (project?.status === "ready") { state.project = project; showProject(project); } else if (project) { elements.processing.hidden = false; pollProject(project.id).catch(handleFailure); } });
  window.addEventListener("halo-identity-ready", loadHistory, { once: true }); loadHistory();
})();
