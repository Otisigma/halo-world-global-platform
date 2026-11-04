import { createLocalUploadVault, resumeAudioUpload, requestUploadJson } from "./resumable-upload.js";

(() => {
  const byId = id => document.getElementById(id);
  const elements = {
    form: byId("songForm"), file: byId("songFile"), title: byId("songTitle"), artist: byId("artistName"), brief: byId("creativeBrief"), lyrics: byId("lyrics"), rights: byId("rightsAttested"),
    dropZone: byId("dropZone"), dropTitle: byId("dropTitle"), dropDetail: byId("dropDetail"), analyze: byId("analyzeButton"), status: byId("formStatus"), canvas: byId("waveCanvas"), waveIdle: byId("waveIdle"),
    duration: byId("signalDuration"), audio: byId("audioPreview"), processing: byId("processing"), processingStage: byId("processingStage"), processingTitle: byId("processingTitle"), processingDetail: byId("processingDetail"),
    results: byId("results"), resultTitle: byId("resultTitle"), resultSummary: byId("resultSummary"), cover: byId("coverFrame"), visualConcept: byId("visualConcept"), visualTypography: byId("visualTypography"), visualPalette: byId("visualPalette"),
    moods: byId("moodTags"), genres: byId("genreList"), audience: byId("audienceCopy"), structures: byId("structureList"), mixes: byId("mixList"), tagline: byId("campaignTagline"), releaseCopy: byId("releaseCopy"), captions: byId("captionStack"), rollout: byId("rolloutList"), videos: byId("videoList"), limits: byId("limitsList"), confidence: byId("confidenceNote"), history: byId("historyGrid"), download: byId("downloadPackage"), toast: byId("toast")
  };
  const metrics = { tempo: byId("metricTempo"), key: byId("metricKey"), dynamics: byId("metricDynamics"), brightness: byId("metricBrightness"), peak: byId("metricPeak"), width: byId("metricWidth") };
  const state = { file: null, audioBuffer: null, objectUrl: "", evidence: null, project: null, pollTimer: 0, projects: [] };
  const vault = createLocalUploadVault();
  const recovery = byId("uploadRecovery"), recoveryStatus = byId("uploadRecoveryStatus");
  const resumeButton = byId("resumeUploadButton"), discardButton = byId("discardUploadButton"), progress = byId("uploadProgress");
  const sessionKey = "halo-song-lab-upload-session";
  let uploadSession = null, backupSaved = false, busy = false, loading = false, saveQueue = Promise.resolve();
  function draft() { return { title: elements.title.value, artist: elements.artist.value, brief: elements.brief.value, lyrics: elements.lyrics.value }; }
  function recoveryMessage(message, resumable = false) {
    recovery.hidden = false; recoveryStatus.textContent = message;
    resumeButton.hidden = !resumable; resumeButton.disabled = busy || loading;
    discardButton.disabled = busy || loading;
  }
  function saveSession() {
    if (!backupSaved || !uploadSession) return Promise.resolve();
    const snapshot = { ...uploadSession, draft: draft(), evidence: state.evidence, updatedAt: Date.now() };
    const write = saveQueue.then(() => vault.saveSession(snapshot));
    saveQueue = write.catch(error => {
      backupSaved = false;
      recoveryMessage(`Local progress could not be saved: ${error.message}. Keep this tab open and your original file.`);
    });
    return write;
  }
  function setBusy(value) {
    busy = value; elements.file.disabled = value || loading; elements.analyze.disabled = value || loading || !state.evidence || !uploadSession;
    resumeButton.disabled = value || loading; discardButton.disabled = value || loading;
    for (const element of [elements.title, elements.artist, elements.brief, elements.lyrics, elements.rights]) element.disabled = value;
  }
  async function clearBackup() {
    if (!uploadSession) return;
    await saveQueue;
    await vault.remove(uploadSession.id);
    sessionStorage.removeItem(sessionKey);
    backupSaved = false; uploadSession = null; recovery.hidden = true;
  }
  const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const uploadTrustStorageKey = "halo-dreamweaver-upload-trust";
  const uploadTrustTtlMs = 15 * 60 * 1000;
  const approvedTrustRoutes = new Set(["/dreamweaver/", "/dreamweaver/index.html", "/dreamweaver-lab/", "/dreamweaver-lab/index.html"]);

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
  function formatTime(seconds) { const value = Math.max(0, Number(seconds || 0)); return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`; }
  function titleFromFile(name) { return name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); }
  function showToast(message) { elements.toast.textContent = message; elements.toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3200); }
  function setStatus(message, error = false) { elements.status.textContent = message; elements.status.style.color = error ? "#ff9274" : ""; }
  function list(items) { return (items || []).map(item => `<li>${escapeHtml(item)}</li>`).join(""); }
  function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
  function percentile(values, ratio) { if (!values.length) return 0; const ordered = [...values].sort((a, b) => a - b); return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))]; }

  function normalizeTrustRoute(value) {
    const route = String(value || "").trim();
    if (!route) return "";
    if (route === "/dreamweaver") return "/dreamweaver/";
    if (route === "/dreamweaver-lab") return "/dreamweaver-lab/";
    return route;
  }

  function sameOriginTrustRoute(value) {
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin ? normalizeTrustRoute(url.pathname) : "";
    } catch {
      return "";
    }
  }

  function readUploadTrust() {
    try {
      const trust = JSON.parse(sessionStorage.getItem(uploadTrustStorageKey) || "null");
      if (!trust || trust.flow !== "artist-upload") return null;
      const route = normalizeTrustRoute(trust.route);
      const issuedAt = Number(trust.issuedAt);
      if (!approvedTrustRoutes.has(route) || !Number.isFinite(issuedAt) || Date.now() - issuedAt > uploadTrustTtlMs) {
        sessionStorage.removeItem(uploadTrustStorageKey);
        return null;
      }
      return { flow: "artist-upload", route, issuedAt, reason: String(trust.reason || "") };
    } catch {
      return null;
    }
  }

  function writeUploadTrust(route, reason = "entry") {
    const normalizedRoute = approvedTrustRoutes.has(normalizeTrustRoute(route)) ? normalizeTrustRoute(route) : "/dreamweaver/";
    const trust = { flow: "artist-upload", route: normalizedRoute, reason, issuedAt: Date.now() };
    try { sessionStorage.setItem(uploadTrustStorageKey, JSON.stringify(trust)); } catch {}
    return trust;
  }

  function refreshUploadTrust(reason = "continue") {
    const existing = readUploadTrust();
    return existing ? writeUploadTrust(existing.route, reason) : null;
  }

  function bootstrapUploadTrust() {
    const params = new URLSearchParams(location.search);
    if (params.get("flow") === "artist-upload") {
      const trust = writeUploadTrust(sameOriginTrustRoute(document.referrer) || "/dreamweaver/", params.get("verified") === "1" ? "verified" : "entry");
      setStatus(params.get("verified") === "1" ? "Dreamweaver verified this upload path. Continue with your private song intake." : "Dreamweaver opened Song Lab as your trusted upload path.");
      return trust;
    }
    return refreshUploadTrust();
  }

  function trustedUploadHeaders(headers = {}) {
    const trust = readUploadTrust();
    if (!trust) return headers;
    return {
      ...headers,
      "X-Halo-Dreamweaver-Flow": trust.flow,
      "X-Halo-Dreamweaver-Route": trust.route,
      "X-Halo-Dreamweaver-Issued-At": String(trust.issuedAt)
    };
  }

  function throwApiError(data, fallbackMessage) {
    const message = data?.message || fallbackMessage;
    if (data?.trustState === "challenge" && data.challengeRoute) {
      const detail = `${message} Continue in Dreamweaver to verify this upload.`;
      setStatus(detail, true);
      showToast(detail);
      if (window.confirm(`${message}\n\nContinue in Dreamweaver to verify this upload?`)) location.href = data.challengeRoute;
      throw new Error(detail);
    }
    throw new Error(message);
  }

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

  async function loadFile(file, restored = false) {
    if (!file) return;
    if (busy || loading) return;
    if (!file.size || file.size > 128 * 1024 * 1024) return setStatus("Choose a non-empty audio file up to 128 MB.", true);
    if (!restored && uploadSession && !window.confirm("Replace this upload and discard its local backup?")) return;
    loading = true; setBusy(false);
    state.file = file; state.evidence = null; elements.analyze.disabled = true;
    state.audioBuffer = null; elements.audio.pause(); elements.audio.removeAttribute("src"); elements.audio.load(); elements.audio.hidden = true;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = ""; elements.waveIdle.hidden = false;
    elements.dropTitle.textContent = file.name; elements.dropDetail.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · reading waveform…`;
    if (!elements.title.value) elements.title.value = titleFromFile(file.name);
    setStatus("Reading the waveform locally. The upload has not started yet.");
    if (!restored) {
      const previous = uploadSession;
      uploadSession = { id: crypto.randomUUID(), fileName: file.name, contentType: file.type, lastModified: file.lastModified, byteSize: file.size, draft: draft(), acknowledged: [], createdAt: Date.now(), ownerId: "" };
      backupSaved = false;
      recoveryMessage("Saving the original audio in this browser...");
      try {
        await saveQueue;
        await vault.saveFile(uploadSession, file);
        sessionStorage.setItem(sessionKey, uploadSession.id);
        backupSaved = true;
        recoveryMessage("Original audio saved locally. Upload will start only when you submit.");
        if (previous) await vault.remove(previous.id);
      } catch (error) {
        recoveryMessage(`Local backup unavailable: ${error.message}. Upload can continue in this tab, but reload recovery is not guaranteed.`);
      }
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      let buffer;
      try { buffer = await context.decodeAudioData(await file.arrayBuffer()); }
      finally { await context.close(); }
      state.audioBuffer = buffer;
      drawWaveform(buffer); elements.waveIdle.hidden = true; elements.duration.textContent = formatTime(buffer.duration);
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl); state.objectUrl = URL.createObjectURL(file); elements.audio.src = state.objectUrl; elements.audio.hidden = false;
      await new Promise(resolve => setTimeout(resolve, 30));
      state.evidence = analyzeBuffer(buffer); renderMetrics(state.evidence);
      elements.dropDetail.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · ${formatTime(buffer.duration)} · ${buffer.numberOfChannels === 1 ? "mono" : `${buffer.numberOfChannels} channels`}`;
      if (backupSaved) await saveSession().catch(error => setStatus(error.message, true));
      setStatus("Signal ready. Confirm your rights and build the package.");
      window.haloStats?.track("dreamweaver_song_loaded", { file_type: file.type || "unknown" });
    } catch { setStatus("This browser could not decode that audio file. Your local backup, if saved, has not been deleted. Try a supported file or browser.", true); }
    finally { loading = false; setBusy(false); }
  }

  async function uploadFile(file) {
    progress.hidden = false;
    return resumeAudioUpload({
      file, session: uploadSession, headers: () => trustedUploadHeaders(),
      onProgress(percent) {
        progress.value = percent;
        elements.processingStage.textContent = `SECURING AUDIO / ${Math.floor(percent)}%`;
        elements.processingDetail.textContent = "Sending verified private chunks. Nothing is published.";
      },
      onRetry({ attempt, retries, chunkIndex, chunkCount }) {
        elements.processingStage.textContent = `RETRY ${attempt}/${retries} / CHUNK ${chunkIndex + 1}/${chunkCount}`;
        elements.processingDetail.textContent = "Connection interrupted. Retrying this chunk; confirmed chunks are retained.";
      },
      async onAcknowledged(index) {
        uploadSession.acknowledged = [...new Set([...uploadSession.acknowledged, index])];
        await saveSession().catch(error => setStatus(`Upload continues, but local progress backup failed: ${error.message}`, true));
      },
    });
  }

  async function pollProject(projectId) {
    clearTimeout(state.pollTimer);
    const response = await fetch(`/api/dreamweaver-song-lab?projectId=${encodeURIComponent(projectId)}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The Song Lab project could not be read.");
    state.project = data.project;
    if (data.project.status === "ready") {
      showProject(data.project);
      if (uploadSession?.projectId === data.project.id) await clearBackup().catch(error => recoveryMessage(`Package ready, but local cleanup failed: ${error.message}. Use Discard local backup.`));
      setBusy(false); await loadHistory(); return;
    }
    if (data.project.status === "failed") throw new Error(data.project.errorMessage || "The Song Lab package stopped before completion.");
    elements.processingStage.textContent = data.project.status === "analyzing" ? "WEAVING THE RELEASE WORLD" : "ANALYSIS QUEUED";
    elements.processingDetail.textContent = data.project.status === "analyzing" ? "Dreamweaver is grounding the visual system, campaign, and release notes in the measured signal." : "The private job is saved and preparing to run.";
    state.pollTimer = setTimeout(() => pollProject(projectId).catch(handleFailure), 1800);
  }

  function handleFailure(error) {
    setBusy(false);
    elements.processing.dataset.uploadState = "paused";
    elements.processingStage.textContent = "PAUSED / WAITING";
    elements.processingDetail.textContent = error.message || "Dreamweaver could not complete this package.";
    setStatus(error.message || "Dreamweaver could not complete this package.", true); showToast(error.message || "Song Lab stopped.");
    if (uploadSession && state.file) recoveryMessage(uploadSession.projectId
      ? "The private project is saved on the server. Resume to check its status; no audio re-upload is needed."
      : backupSaved ? "Upload interrupted. We saved your progress locally - resume upload?"
      : "Upload interrupted. This tab still has your file, but durable local backup is unavailable. Resume before closing it.", true);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || loading) return;
    if (!uploadSession || !state.file || !state.evidence) return setStatus("Choose and decode an audio file first.", true);
    if (!elements.rights.checked) return setStatus("Confirm that you may use this recording.", true);
    setBusy(true); elements.processing.dataset.uploadState = "uploading"; resumeButton.hidden = true; elements.results.hidden = true; elements.processing.hidden = false; elements.processing.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const identityResponse = await fetch("/api/dreamweaver-song-lab", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!identityResponse.ok) throw new Error("Song Lab could not verify the current account. Your upload is retained.");
      const identity = await identityResponse.json();
      if (!identity.uploadOwnerId) throw new Error("Sign in before resuming private audio.");
      if (uploadSession.ownerId && uploadSession.ownerId !== identity.uploadOwnerId) throw new Error("Sign in with the account that started this upload, or discard its local backup.");
      uploadSession.ownerId = identity.uploadOwnerId;
      await saveSession().catch(error => setStatus(error.message, true));
      if (uploadSession.projectId) { await pollProject(uploadSession.projectId); return; }
      const upload = await uploadFile(state.file);
      elements.processingStage.textContent = "STARTING DREAMWEAVER"; elements.processingDetail.textContent = "The waveform evidence and artist context are entering the private creative engine.";
      const data = upload.project ? { project: upload.project } : await requestUploadJson({
        action: "analyze", ...upload, title: elements.title.value, artistName: elements.artist.value, creativeBrief: elements.brief.value, lyrics: elements.lyrics.value,
        rightsAttested: elements.rights.checked, fileName: state.file.name, contentType: state.file.type, byteSize: state.file.size, analysis: state.evidence
      }, trustedUploadHeaders());
      uploadSession.projectId = data.project.id;
      await saveSession().catch(error => setStatus(error.message, true));
      state.project = data.project; window.haloStats?.track("dreamweaver_song_analysis_started", { project_id: data.project.id }); await pollProject(data.project.id);
    } catch (error) {
      if (error.data?.trustState === "challenge") {
        try { throwApiError(error.data, error.message); } catch (challenge) { handleFailure(challenge); }
      } else handleFailure(error);
    }
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

  async function restoreBackup() {
    try {
      let id = sessionStorage.getItem(sessionKey);
      if (!id) {
        const response = await fetch("/api/dreamweaver-song-lab", { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!response.ok) return;
        const identity = await response.json();
        if (!identity.uploadOwnerId) return;
        const sessions = await vault.listSessions();
        id = sessions.filter(session => session.ownerId === identity.uploadOwnerId)
          .sort((left, right) => (right.updatedAt || right.createdAt) - (left.updatedAt || left.createdAt))[0]?.id;
        if (!id) return;
      }
      const saved = await vault.read(id);
      if (!saved || uploadSession || state.file) return;
      if (saved.session.ownerId) {
        const response = await fetch("/api/dreamweaver-song-lab", { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Sign in with the original account to restore this upload.");
        const identity = await response.json();
        if (identity.uploadOwnerId !== saved.session.ownerId) throw new Error("Sign in with the original account and reload to restore this upload.");
      }
      if (uploadSession || state.file || busy || loading) return;
      sessionStorage.setItem(sessionKey, id);
      uploadSession = saved.session; backupSaved = true;
      for (const [key, value] of Object.entries(saved.session.draft || {})) if (elements[key]) elements[key].value = value;
      elements.rights.checked = false;
      const file = new File([saved.file], saved.session.fileName, { type: saved.session.contentType, lastModified: saved.session.lastModified });
      state.file = file;
      if (saved.session.evidence) {
        state.evidence = saved.session.evidence;
        renderMetrics(state.evidence); elements.duration.textContent = formatTime(state.evidence.durationSeconds);
        state.objectUrl = URL.createObjectURL(file); elements.audio.src = state.objectUrl; elements.audio.hidden = false;
        elements.dropTitle.textContent = file.name; elements.dropDetail.textContent = "Restored original audio and saved measurements.";
        setBusy(false);
      } else await loadFile(file, true);
      recoveryMessage("Upload interrupted. We saved your progress locally - resume upload? Confirm your recording permission again.", true);
    } catch (error) {
      recoveryMessage(`Local recovery could not be opened: ${error.message}. Keep your original audio file.`);
    }
  }

  bootstrapUploadTrust();
  resumeButton.addEventListener("click", () => elements.form.requestSubmit());
  discardButton.addEventListener("click", async () => {
    if (busy || loading || !window.confirm("Delete the local audio backup and draft from this browser? Existing private server chunks and saved projects are not deleted.")) return;
    try {
      if (!uploadSession) {
        const id = sessionStorage.getItem(sessionKey);
        if (id) { await vault.remove(id); sessionStorage.removeItem(sessionKey); }
        recovery.hidden = true;
        return;
      }
      await clearBackup();
      clearTimeout(state.pollTimer);
      state.file = null; state.evidence = null;
      elements.file.value = ""; elements.audio.pause(); elements.audio.removeAttribute("src"); elements.audio.load(); elements.audio.hidden = true;
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = ""; progress.hidden = true; elements.processing.hidden = true; elements.rights.checked = false;
      elements.dropTitle.textContent = "Choose a WAV or audio file"; elements.dropDetail.textContent = "Drop it here - private - up to 128 MB";
      setBusy(false); setStatus("Local backup discarded. Your original file and saved projects are unchanged.");
    } catch (error) { recoveryMessage(`Local backup could not be discarded: ${error.message}.`); }
  });
  for (const element of [elements.title, elements.artist, elements.brief, elements.lyrics]) element.addEventListener("input", () => {
    void saveSession().catch(error => setStatus(`Local draft backup failed: ${error.message}`, true));
  });
  window.addEventListener("beforeunload", event => {
    if (busy || loading) { event.preventDefault(); event.returnValue = ""; }
  });
  window.addEventListener("online", () => {
    if (!busy && uploadSession && state.file && !resumeButton.hidden) recoveryMessage("Connection restored. Confirm recording permission and choose Resume Upload to continue.", true);
  });
  void restoreBackup();
  elements.file.addEventListener("change", event => loadFile(event.target.files?.[0]));
  ["dragenter", "dragover"].forEach(name => elements.dropZone.addEventListener(name, event => { event.preventDefault(); elements.dropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(name => elements.dropZone.addEventListener(name, event => { event.preventDefault(); elements.dropZone.classList.remove("dragging"); }));
  elements.dropZone.addEventListener("drop", event => { const file = event.dataTransfer?.files?.[0]; if (file) loadFile(file); });
  elements.form.addEventListener("submit", submit); elements.download.addEventListener("click", downloadProject);
  elements.captions.addEventListener("click", async event => { const button = event.target.closest("[data-caption]"); if (!button) return; try { await navigator.clipboard.writeText(button.dataset.caption); showToast("Caption copied."); } catch { showToast("Select the caption and copy it manually."); } });
  elements.history.addEventListener("click", event => { const project = state.projects.find(item => item.id === event.target.closest("[data-project-id]")?.dataset.projectId); if (project?.status === "ready") { state.project = project; showProject(project); } else if (project) { elements.processing.hidden = false; pollProject(project.id).catch(handleFailure); } });
  window.addEventListener("halo-identity-ready", loadHistory, { once: true }); loadHistory();
})();
