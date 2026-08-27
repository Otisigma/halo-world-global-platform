(() => {
  const state = { mixes: [], videos: [], reviewCycles: [], canReview: false, reviewBreaks: [], selectedReviewCycleId: "", featuredMix: null, selectedMix: null, activeMix: null, activeMixVersion: "mastered", activeEpisode: 0, playlist: [], playlistIndex: 0, visualMixes: [], visualVideos: [], visualProjects: [], selectedVisualProjectId: "", selectedVisualSceneId: "" };
  const audio = document.querySelector("#mixAudio");
  const playerDock = document.querySelector("#playerDock");
  const heroRecord = document.querySelector("#heroRecord");
  const heroPlay = document.querySelector("#heroPlay");
  const mixRail = document.querySelector("#mixRail");
  const episodeStage = document.querySelector("#episodeStage");
  const checkoutStatus = document.querySelector("#checkoutStatus");
  const editionSelection = document.querySelector("#editionSelection");
  const editionButton = document.querySelector("#editionButton");
  const editionReadiness = document.querySelector("#editionReadiness");
  const mixUploadForm = document.querySelector("#mixUploadForm");
  const paidMixFields = document.querySelector("#paidMixFields");
  const mixUploadButton = document.querySelector("#mixUploadButton");
  const mixUploadStatus = document.querySelector("#mixUploadStatus");
  const mixUploadProgress = document.querySelector("#mixUploadProgress");
  const uploadGate = document.querySelector("#uploadGate");
  const mixLoginButton = document.querySelector("#mixLoginButton");
  const mixLoginEmail = document.querySelector("#mixLoginEmail");
  const mixLoginPassword = document.querySelector("#mixLoginPassword");
  const mixLoginStatus = document.querySelector("#mixLoginStatus");
  const qualityStatus = document.querySelector("#qualityStatus");
  const qualityQueue = document.querySelector("#qualityQueue");
  const qualityReviewForm = document.querySelector("#qualityReviewForm");
  const qualityFormStatus = document.querySelector("#qualityFormStatus");
  const reviewCycleSelect = document.querySelector("#reviewCycleSelect");
  const reviewArea = document.querySelector("#reviewArea");
  const reviewOutcome = document.querySelector("#reviewOutcome");
  const reviewScore = document.querySelector("#reviewScore");
  const breakList = document.querySelector("#breakList");
  const visualGate = document.querySelector("#visualGate");
  const visualMixForm = document.querySelector("#visualMixForm");
  const visualMixSelect = document.querySelector("#visualMixSelect");
  const visualVideoOptions = document.querySelector("#visualVideoOptions");
  const visualStudioStatus = document.querySelector("#visualStudioStatus");
  const visualBuildButton = document.querySelector("#visualBuildButton");
  const visualProjects = document.querySelector("#visualProjects");
  const visualProjectTabs = document.querySelector("#visualProjectTabs");
  const visualTimeline = document.querySelector("#visualTimeline");
  const visualRenderBrief = document.querySelector("#visualRenderBrief");
  const visualScreen = document.querySelector("#visualScreen");
  const visualScreenMedia = document.querySelector("#visualScreenMedia");
  const visualScreenLogo = document.querySelector("#visualScreenLogo");
  const dockVersionSwitch = document.querySelector("#dockVersionSwitch");
  const artworkPool = ["/assets/releases/salty.jpg", "/assets/releases/the-cold-is-lasting-longer.jpg", "/assets/releases/hit-that-beat.webp"];
  const fallbackArtwork = artworkPool[0];
  const reviewAreaLabels = { creative_intent: "Creative intent", technical_sound: "Technical sound", transitions_breaks: "Transitions & breaks", audience_programming: "Audience & programming", rights_credits: "Rights & credits", release_readiness: "Release readiness" };
  const reviewStatusLabels = { queued: "Queued", in_review: "In review", needs_context: "Needs context", ready: "Ready to decide", approved: "Approved", revise: "Revision requested", hold: "On hold" };
  const visualPackageLabels = { complete: "Complete venue package", logo: "Logo edition", hybrid: "Hybrid edition", full_visual: "Full visual edition" };
  const visualSourceLabels = { logo_motion: "Logo motion", source_video: "Source video", dreamweaver: "Dreamweaver original" };

  const escapeHtml = value => String(value || "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);

  const formatDuration = seconds => {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = Math.floor(total % 60);
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}` : `${minutes}:${String(remaining).padStart(2, "0")}`;
  };
  const formatMoney = (minor, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor || 0) / 100);

  const mixMeta = mix => {
    if (mix.source === "youtube") return "YouTube long play";
    const duration = mix.durationSeconds ? formatDuration(mix.durationSeconds) : "Full session";
    const tracks = mix.trackCount ? ` · ${mix.trackCount} ${mix.trackCount === 1 ? "track" : "tracks"}` : "";
    return `${duration}${tracks}`;
  };

  function safeArtwork(value, fallback = fallbackArtwork) {
    try {
      const url = new URL(value, location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  async function deleteMix(mixId, title = "this mix") {
    if (!window.confirm(`Delete “${title}” and its uploaded audio permanently?`)) return;
    mixUploadStatus.textContent = "Deleting mix upload…";
    try {
      const response = await fetch("/api/mixes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "delete", mixId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The mix could not be deleted.");
      mixUploadStatus.textContent = data.message || "Mix upload deleted.";
      if (state.activeMix?.id === mixId) {
        audio.pause();
        audio.removeAttribute("src");
        state.activeMix = null;
      }
      await loadData();
      await loadReviewData();
    } catch (error) {
      mixUploadStatus.textContent = error.message || "The mix could not be deleted.";
    }
  }

  function safeVisualUrl(value) {
    try {
      const url = new URL(value, location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function selectedVisualProject() {
    return state.visualProjects.find(project => project.id === state.selectedVisualProjectId) || state.visualProjects[0] || null;
  }

  function renderVisualVideoOptions() {
    if (!state.visualVideos.length) {
      visualVideoOptions.innerHTML = `<p>No source videos are attached to this membership yet. Dreamweaver can still build logo or full visual editions.</p>`;
      return;
    }
    visualVideoOptions.innerHTML = state.visualVideos.map(video => {
      const thumbnail = safeVisualUrl(video.thumbnailUrl);
      return `<label class="visual-video-option">${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="">` : `<i class="visual-video-placeholder" aria-hidden="true"></i>`}<span>${escapeHtml(video.title)}</span><input type="checkbox" name="sourceVideoId" value="${escapeHtml(video.id)}" checked></label>`;
    }).join("");
  }

  function renderVisualScene(scene, project) {
    if (!scene || !project) {
      visualScreenMedia.style.backgroundImage = "";
      visualScreenLogo.hidden = true;
      document.querySelector("#visualScreenTime").textContent = "00:00 — 60:00";
      document.querySelector("#visualScreenTitle").textContent = "Dreamweaver visual channel";
      document.querySelector("#visualScreenDirection").textContent = "Choose a saved treatment to inspect its visual movements.";
      document.querySelector("#visualScreenBadge").textContent = "STANDBY";
      return;
    }
    state.selectedVisualSceneId = scene.id;
    visualScreen.style.setProperty("--visual-primary", project.primaryColor);
    visualScreen.style.setProperty("--visual-secondary", project.secondaryColor);
    const thumbnail = safeVisualUrl(scene.thumbnailUrl);
    visualScreenMedia.style.backgroundImage = thumbnail ? `url("${thumbnail.replaceAll('"', "%22")}")` : "";
    const logoUrl = safeVisualUrl(project.logoUrl);
    visualScreenLogo.hidden = !logoUrl;
    if (logoUrl) visualScreenLogo.src = logoUrl;
    document.querySelector("#visualScreenTime").textContent = `${formatDuration(scene.startSeconds)} — ${formatDuration(scene.endSeconds)}`;
    document.querySelector("#visualScreenTitle").textContent = scene.videoTitle || scene.title;
    document.querySelector("#visualScreenDirection").textContent = scene.direction;
    document.querySelector("#visualScreenBadge").textContent = visualSourceLabels[scene.sourceType] || scene.sourceType;
    visualTimeline.querySelectorAll(".visual-scene").forEach(button => button.classList.toggle("is-active", button.dataset.sceneId === scene.id));
  }

  function renderVisualStudio() {
    visualMixSelect.innerHTML = state.visualMixes.length
      ? state.visualMixes.map(mix => `<option value="${escapeHtml(mix.id)}">${escapeHtml(mix.title)} · ${formatDuration(mix.durationSeconds || 3600)}</option>`).join("")
      : `<option value="">Upload a mix first</option>`;
    visualBuildButton.disabled = !state.visualMixes.length;
    renderVisualVideoOptions();
    visualProjects.hidden = !state.visualProjects.length;
    if (!state.visualProjects.length) {
      state.selectedVisualProjectId = "";
      state.selectedVisualSceneId = "";
      visualProjectTabs.innerHTML = "";
      visualTimeline.innerHTML = "";
      document.querySelector("#visualProjectTitle").textContent = "Visual edition";
      document.querySelector("#visualCoverage").textContent = "0:00 / 0:00";
      document.querySelector("#visualSceneCount").textContent = "0 scenes";
      document.querySelector("#visualSourceCount").textContent = "0 linked";
      visualRenderBrief.disabled = true;
      renderVisualScene(null, null);
      return;
    }
    if (!state.selectedVisualProjectId || !state.visualProjects.some(project => project.id === state.selectedVisualProjectId)) state.selectedVisualProjectId = state.visualProjects[0].id;
    const project = selectedVisualProject();
    visualProjectTabs.innerHTML = state.visualProjects.map(item => `<button class="${item.id === project.id ? "is-active" : ""}" type="button" data-visual-project="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>`).join("");
    document.querySelector("#visualProjectTitle").textContent = `${project.title} · ${visualPackageLabels[project.packageType] || project.packageType}`;
    document.querySelector("#visualCoverage").textContent = `${formatDuration(project.durationSeconds)} / ${formatDuration(project.durationSeconds)}`;
    document.querySelector("#visualSceneCount").textContent = `${project.sceneCount} ${project.sceneCount === 1 ? "scene" : "scenes"}`;
    document.querySelector("#visualSourceCount").textContent = `${project.sourceVideoCount} linked`;
    visualRenderBrief.disabled = false;
    visualRenderBrief.textContent = project.status === "render_brief_ready" ? "Download render brief" : "Prepare render brief";
    visualTimeline.innerHTML = project.scenes.map(scene => `<button class="visual-scene${scene.id === state.selectedVisualSceneId ? " is-active" : ""}" type="button" data-scene-id="${escapeHtml(scene.id)}" data-source="${escapeHtml(scene.sourceType)}"><span class="visual-scene-index"><b>${String(scene.position + 1).padStart(2, "0")}</b><i>${formatDuration(scene.startSeconds)}</i></span><strong>${escapeHtml(scene.videoTitle || scene.title)}</strong><small>${escapeHtml(scene.direction)}</small><em>${escapeHtml(visualSourceLabels[scene.sourceType] || scene.sourceType)} · ${escapeHtml(scene.transitionType.replaceAll("_", " "))}</em></button>`).join("");
    const scene = project.scenes.find(item => item.id === state.selectedVisualSceneId) || project.scenes[0];
    renderVisualScene(scene, project);
  }

  async function loadVisualStudio() {
    try {
      const response = await fetch("/api/visual-mixes", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The Visual Mix Studio is unavailable.");
      state.visualMixes = data.mixes || [];
      state.visualVideos = data.videos || [];
      state.visualProjects = data.projects || [];
      renderVisualStudio();
      visualStudioStatus.textContent = state.visualVideos.length ? `${state.visualVideos.length} published video${state.visualVideos.length === 1 ? " is" : "s are"} preloaded for the DJ mix test.` : "Add videos to your HALO gallery to preload them here.";
    } catch (error) {
      visualStudioStatus.textContent = error.message || "The Visual Mix Studio is unavailable.";
    }
  }

  async function buildVisualMix(event) {
    event.preventDefault();
    visualBuildButton.disabled = true;
    visualStudioStatus.textContent = "Dreamweaver is mapping the complete recording…";
    const fields = Object.fromEntries(new FormData(visualMixForm).entries());
    const sourceVideoIds = [...visualMixForm.querySelectorAll('input[name="sourceVideoId"]:checked')].map(input => input.value);
    try {
      const response = await fetch("/api/visual-mixes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...fields, sourceVideoIds })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Dreamweaver could not build the timeline.");
      state.selectedVisualProjectId = data.projectId;
      state.selectedVisualSceneId = "";
      visualStudioStatus.textContent = data.message;
      await loadVisualStudio();
      visualProjects.scrollIntoView({ behavior: "smooth", block: "start" });
      window.haloStats?.track("build_visual_mix_timeline", { package: fields.packageType });
    } catch (error) {
      visualStudioStatus.textContent = error.message || "Dreamweaver could not build the timeline.";
    } finally {
      visualBuildButton.disabled = !state.visualMixes.length;
    }
  }

  function downloadVisualBrief(project) {
    const brief = {
      project: {
        id: project.id,
        title: project.title,
        mixTitle: project.mixTitle,
        packageType: project.packageType,
        durationSeconds: project.durationSeconds,
        brandName: project.brandName,
        logoUrl: project.logoUrl,
        colors: [project.primaryColor, project.secondaryColor],
        visualStyle: project.visualStyle,
        creativeBrief: project.creativeBrief
      },
      scenes: project.scenes.map(scene => ({
        position: scene.position,
        startSeconds: scene.startSeconds,
        endSeconds: scene.endSeconds,
        sourceType: scene.sourceType,
        sourceVideoId: scene.sourceVideoId,
        title: scene.title,
        direction: scene.direction,
        transitionType: scene.transitionType
      }))
    };
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "visual-mix"}-render-brief.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function bindArtworkFallbacks(root = document) {
    root.querySelectorAll("img[data-mix-artwork]").forEach(image => {
      image.addEventListener("error", () => {
        if (image.getAttribute("src") !== fallbackArtwork) image.src = fallbackArtwork;
      }, { once: true });
    });
  }

  function renderFeatured() {
    const mix = state.selectedMix || state.mixes[0];
    state.featuredMix = mix || null;
    if (!mix) {
      document.querySelector("#featuredMeta").textContent = "Long Play / preparing";
      document.querySelector("#featuredTitle").textContent = "The first edition is taking shape";
      document.querySelector("#featuredCreator").textContent = "DJ HALO X";
      heroPlay.textContent = "Enter HALO Radio";
      heroPlay.disabled = false;
      return;
    }
    document.querySelector("#featuredMeta").textContent = mixMeta(mix);
    document.querySelector("#featuredTitle").textContent = mix.title;
    document.querySelector("#featuredCreator").textContent = mix.creator?.name || "DJ HALO X";
    const artwork = safeArtwork(mix.artworkUrl);
    document.querySelector("#featuredArtwork").src = artwork;
    document.querySelector("#featuredArtwork").dataset.mixArtwork = "true";
    document.querySelector("#featuredArtwork").alt = `${mix.title} artwork`;
    heroPlay.textContent = mix.source === "youtube" ? "Watch latest long play" : "Play latest mix";
    heroPlay.disabled = false;
  }

  function renderMixes() {
    if (!state.mixes.length) {
      mixRail.innerHTML = `<article class="mix-empty"><strong>The room is between sets.</strong><p>HALO Radio keeps the signal moving while the next full-length session is prepared.</p><a class="episode-link" href="/radio/">Listen to HALO Radio ↗</a></article>`;
      return;
    }
    mixRail.innerHTML = state.mixes.map((mix, index) => {
      const initials = (mix.title || "HX").split(/\s+/).slice(0, 2).map(word => word[0]).join("");
      return `<article class="mix-card">
        <div class="mix-card-index"><span>HX / ${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(mix.creator?.badge || "Long Play")}</span></div>
        <div class="mix-art"><img src="${escapeHtml(safeArtwork(mix.artworkUrl, artworkPool[index % artworkPool.length]))}" alt="${escapeHtml(`${mix.title} artwork`)}" loading="lazy" data-mix-artwork><strong>${escapeHtml(initials)}</strong></div>
        <h3>${escapeHtml(mix.title)}</h3>
        <p>${escapeHtml(mix.description || "A full-length HALO room session, left intact from first transition to final handoff.")}</p>
        ${mix.hasOriginalComparison ? `<div class="mix-version-compare"><span>Hear the difference</span><div><button type="button" data-compare-version="original" data-compare-index="${index}">Original</button><button type="button" data-compare-version="mastered" data-compare-index="${index}">Mastered remix</button></div><small>Switches at the same timestamp for a direct A/B check.</small></div>` : ""}
        <footer><span>${escapeHtml(mix.credits?.originalArtist || mix.creator?.name || "Owen Anthony")} · ${escapeHtml(mix.credits?.remixer || "DJ HALO X")}<br>${escapeHtml(mixMeta(mix))}</span><span class="mix-card-actions">${mix.salesPageUrl ? `<a href="${escapeHtml(mix.salesPageUrl)}">Sales page</a>` : ""}${mix.isOwner ? `<button class="mix-delete" type="button" data-delete-mix="${escapeHtml(mix.id)}" data-delete-title="${escapeHtml(mix.title)}">Delete</button>` : ""}<button class="mix-play" type="button" data-mix-index="${index}" aria-label="${mix.source === "youtube" ? "Watch" : "Play"} ${escapeHtml(mix.title)}"></button></span></footer>
      </article>`;
    }).join("");
    bindArtworkFallbacks(mixRail);
  }

  function renderEdition() {
    const mix = state.selectedMix;
    if (!mix || mix.source === "youtube") {
      editionSelection.hidden = true;
      editionReadiness.hidden = true;
      editionButton.disabled = false;
      editionButton.textContent = "Check edition availability";
      return;
    }
    editionSelection.hidden = false;
    editionSelection.innerHTML = `<img src="${escapeHtml(safeArtwork(mix.artworkUrl))}" alt="${escapeHtml(`${mix.title} artwork`)}" data-mix-artwork><div><span>Selected remix</span><strong>${escapeHtml(mix.title)}</strong><small>${escapeHtml(mix.credits?.originalArtist || "Owen Anthony")} · Remix by ${escapeHtml(mix.credits?.remixer || "DJ HALO X")}</small></div>`;
    bindArtworkFallbacks(editionSelection);
    if (mix.commerce?.clientSaleEnabled === false) {
      editionReadiness.hidden = true;
      editionButton.disabled = true;
      editionButton.textContent = "Stream-only edition";
      checkoutStatus.textContent = "The creator has kept this mix available as an authorized stream rather than a paid download.";
      return;
    }
    const checks = [
      ["masterApproved", "Approved master"],
      ["productInfoComplete", "Complete product information"],
      ["priceConfirmed", `Confirmed price${mix.commerce?.priceMinor ? ` · ${formatMoney(mix.commerce.priceMinor, mix.commerce.currency)}` : ""}`],
      ["rightsConfirmed", "Confirmed rights or clearances"]
    ];
    editionReadiness.hidden = false;
    editionReadiness.innerHTML = `<strong>Paid mix checklist</strong><ul>${checks.map(([key, label]) => `<li class="${mix.readiness?.[key] ? "is-ready" : "is-pending"}"><span>${mix.readiness?.[key] ? "✓" : "○"}</span>${escapeHtml(label)}</li>`).join("")}</ul>`;
    const ready = mix.salesStatus === "ready";
    editionButton.disabled = !ready;
    editionButton.textContent = ready ? "Buy this remix edition" : mix.salesStatus === "rights_review" ? "Rights review in progress" : "Mastering review queued";
    checkoutStatus.textContent = ready ? "This edition has passed the mastering and rights gate." : "The sales page is live for preparation. Checkout opens automatically after mastering, metadata, pricing, and rights approval.";
  }

  async function updateUploadAccess() {
    const user = await window.haloIdentity?.getUser?.().catch(() => null);
    uploadGate.hidden = Boolean(user);
    mixUploadForm.hidden = !user;
    if (user && !mixUploadForm.elements.remixerName.value) {
      mixUploadForm.elements.remixerName.value = user.user_metadata?.full_name || user.email?.split("@")[0] || "";
    }
    visualGate.hidden = Boolean(user);
    visualMixForm.hidden = !user;
    if (user) await Promise.all([loadReviewData(), loadVisualStudio()]);
    else {
      state.reviewCycles = [];
      state.canReview = false;
      renderQualityRoom();
      state.visualMixes = [];
      state.visualVideos = [];
      state.visualProjects = [];
      renderVisualStudio();
    }
  }

  function reviewTime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function parseReviewTime(value) {
    const parts = String(value || "").trim().split(":").map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;
    if (parts.length === 1) return Math.floor(parts[0]);
    if (parts.length === 2 && parts[1] < 60) return Math.floor(parts[0] * 60 + parts[1]);
    if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    return null;
  }

  function renderBreakList() {
    breakList.innerHTML = state.reviewBreaks.map((item, index) => `<li><b>${reviewTime(item.timestampSeconds)}</b><span>${escapeHtml(item.breakType.replaceAll("_", " "))} · ${escapeHtml(item.observation)}${item.intentUnderstood ? " · intent understood" : ""}</span><button type="button" data-remove-break="${index}" aria-label="Remove timestamp note">×</button></li>`).join("");
  }

  function selectedReviewCycle() {
    return state.reviewCycles.find(cycle => cycle.id === state.selectedReviewCycleId) || state.reviewCycles[0] || null;
  }

  function loadAreaIntoForm() {
    const cycle = selectedReviewCycle();
    const existing = cycle?.reviews?.find(review => review.area === reviewArea.value);
    qualityReviewForm.elements.outcome.value = existing?.outcome || "scored";
    qualityReviewForm.elements.score.value = existing?.score || 75;
    qualityReviewForm.elements.confidence.value = existing?.confidence || "medium";
    qualityReviewForm.elements.evidence.value = existing?.evidence || "";
    qualityReviewForm.elements.recommendation.value = existing?.recommendation || "";
    state.reviewBreaks = existing?.breaks ? existing.breaks.map(item => ({ ...item })) : [];
    reviewScore.disabled = qualityReviewForm.elements.outcome.value !== "scored";
    renderBreakList();
  }

  function renderQualityRoom() {
    qualityReviewForm.hidden = !state.canReview || !state.reviewCycles.length;
    if (!state.reviewCycles.length) {
      qualityQueue.innerHTML = `<div class="quality-empty">No uploaded mixes are attached to this account yet. New uploads enter the quality queue automatically.</div>`;
      qualityStatus.textContent = state.canReview ? "The daily review queue is clear." : "Sign in to see the review trail attached to your mixes.";
      return;
    }
    if (!state.selectedReviewCycleId || !state.reviewCycles.some(cycle => cycle.id === state.selectedReviewCycleId)) state.selectedReviewCycleId = state.reviewCycles[0].id;
    qualityStatus.textContent = state.canReview
      ? `${state.reviewCycles.filter(cycle => !["approved", "revise", "hold"].includes(cycle.status)).length} mixes need review. Passes never reduce the score.`
      : "These reviews show what the team heard, what remains uncertain, and the whole-picture decision.";
    qualityQueue.innerHTML = state.reviewCycles.map(cycle => {
      const reviews = (cycle.reviews || []).map(review => `<li><strong>${escapeHtml(reviewAreaLabels[review.area] || review.area)}</strong> · <b>${review.outcome === "scored" ? `${review.score}/100` : review.outcome === "abstain" ? "pass excluded" : "context blocker"}</b><small>${escapeHtml(review.evidence)}${review.recommendation ? ` · Next: ${escapeHtml(review.recommendation)}` : ""}</small>${(review.breaks || []).map(item => `<small>${reviewTime(item.timestampSeconds)} · ${escapeHtml(item.breakType.replaceAll("_", " "))}: ${escapeHtml(item.observation)}</small>`).join("")}</li>`).join("");
      return `<article class="quality-card${cycle.id === state.selectedReviewCycleId ? " is-selected" : ""}" data-cycle-card="${escapeHtml(cycle.id)}">
        <div class="quality-card-head"><img src="${escapeHtml(safeArtwork(cycle.artworkUrl))}" alt=""><div><span>${new Date(cycle.uploadedAt).toLocaleDateString([], { month: "short", day: "numeric" })} · cycle ${cycle.cycleNumber}</span><strong>${escapeHtml(cycle.title)}</strong><small>${escapeHtml(cycle.creatorName)}</small></div><b class="review-state" data-state="${escapeHtml(cycle.status)}">${escapeHtml(reviewStatusLabels[cycle.status] || cycle.status)}</b></div>
        ${(cycle.creatorContext?.intent || cycle.creatorContext?.context || cycle.creatorContext?.protectedMoments) ? `<div class="creator-review-context"><strong>Creator context — read before scoring</strong>${cycle.creatorContext.intent ? `<span><b>Intent:</b> ${escapeHtml(cycle.creatorContext.intent)}</span>` : ""}${cycle.creatorContext.context ? `<span><b>Background:</b> ${escapeHtml(cycle.creatorContext.context)}</span>` : ""}${cycle.creatorContext.protectedMoments ? `<span><b>Protected moments:</b> ${escapeHtml(cycle.creatorContext.protectedMoments)}</span>` : ""}</div>` : ""}
        <div class="quality-metrics"><span>${cycle.overallScore === null ? "No combined score" : `${cycle.overallScore}/100 advisory`}</span><span>${cycle.scoredAreaCount} scored</span><span>${cycle.abstainedAreaCount} passes excluded</span><span>${cycle.blockerCount} context blockers</span></div>
        ${reviews ? `<ul class="area-review-list">${reviews}</ul>` : ""}
        ${cycle.finalSummary ? `<p class="quality-final"><strong>Whole-picture decision:</strong> ${escapeHtml(cycle.finalSummary)}</p>` : ""}
        <div class="quality-card-actions"><button type="button" data-review-listen="${escapeHtml(cycle.id)}">Listen</button>${state.canReview ? `<button type="button" data-select-review="${escapeHtml(cycle.id)}">Review this mix</button>` : ""}</div>
      </article>`;
    }).join("");
    if (state.canReview) {
      reviewCycleSelect.innerHTML = state.reviewCycles.map(cycle => `<option value="${escapeHtml(cycle.id)}"${cycle.id === state.selectedReviewCycleId ? " selected" : ""}>${escapeHtml(cycle.title)} · ${escapeHtml(reviewStatusLabels[cycle.status] || cycle.status)}</option>`).join("");
      loadAreaIntoForm();
    }
  }

  async function loadReviewData() {
    try {
      const response = await fetch("/api/mix-reviews", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Mix reviews are unavailable.");
      state.reviewCycles = data.cycles || [];
      state.canReview = Boolean(data.canReview);
      renderQualityRoom();
    } catch (error) {
      qualityStatus.textContent = error.message || "Mix reviews are unavailable.";
      qualityQueue.innerHTML = "";
      qualityReviewForm.hidden = true;
    }
  }

  async function postReview(payload) {
    const response = await fetch("/api/mix-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The review could not be saved.");
    qualityFormStatus.textContent = data.message;
    await loadReviewData();
  }

  function audioDuration(file) {
    return new Promise(resolve => {
      const player = document.createElement("audio");
      const objectUrl = URL.createObjectURL(file);
      player.preload = "metadata";
      player.onloadedmetadata = () => {
        const duration = Number.isFinite(player.duration) ? Math.round(player.duration) : 0;
        URL.revokeObjectURL(objectUrl);
        resolve(duration);
      };
      player.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(0); };
      player.src = objectUrl;
    });
  }

  function audioContentType(file) {
    const contentType = String(file.type || "").split(";")[0].toLowerCase();
    const aliases = {
      "audio/mp3": "audio/mpeg",
      "audio/x-m4a": "audio/mp4",
      "audio/m4a": "audio/mp4",
      "video/mp4": "audio/mp4",
      "audio/wave": "audio/wav",
      "audio/vnd.wave": "audio/wav",
      "application/ogg": "audio/ogg"
    };
    if (aliases[contentType]) return aliases[contentType];
    if (["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/x-wav"].includes(contentType)) return contentType;
    if (/\.wav$/i.test(file.name)) return "audio/wav";
    if (/\.aac$/i.test(file.name)) return "audio/aac";
    if (/\.ogg$/i.test(file.name)) return "audio/ogg";
    if (/\.webm$/i.test(file.name)) return "audio/webm";
    if (/\.(?:m4a|mp4)$/i.test(file.name)) return "audio/mp4";
    return "audio/mpeg";
  }

  async function uploadAudioAsset(file, assetRole, onProgress = () => {}) {
    const chunkSize = 3.5 * 1024 * 1024;
    const chunkCount = Math.ceil(file.size / chunkSize);
    if (file.size > 128 * 1024 * 1024 || chunkCount > 64) throw new Error(`Keep the ${assetRole === "original" ? "original version" : "uploaded mix"} under 128 MB.`);
    const uploadId = crypto.randomUUID ? crypto.randomUUID() : `mix-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const contentType = audioContentType(file);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const body = new FormData();
      body.append("chunk", file.slice(chunkIndex * chunkSize, Math.min(file.size, (chunkIndex + 1) * chunkSize), contentType), file.name);
      body.append("uploadId", uploadId);
      body.append("assetRole", assetRole);
      body.append("chunkIndex", String(chunkIndex));
      body.append("chunkCount", String(chunkCount));
      body.append("contentType", contentType);
      mixUploadStatus.textContent = `Uploading ${assetRole === "original" ? "original" : "mastered remix"} ${chunkIndex + 1} of ${chunkCount}…`;
      const chunkResponse = await fetch("/api/mixes", { method: "POST", body, credentials: "same-origin" });
      const chunkData = await chunkResponse.json().catch(() => ({}));
      if (!chunkResponse.ok) throw new Error(chunkData.message || "The audio upload stopped early.");
      onProgress((chunkIndex + 1) / chunkCount);
    }
    return { uploadId, chunkCount, byteSize: file.size, contentType, durationSeconds: await audioDuration(file) };
  }

  async function uploadCreatorMix(event) {
    event.preventDefault();
    const file = mixUploadForm.elements.mixFile.files[0];
    const originalFile = mixUploadForm.elements.originalMixFile.files[0];
    if (!file) {
      mixUploadStatus.textContent = "Choose a mastered remix or working mix first.";
      return;
    }
    mixUploadButton.disabled = true;
    mixUploadProgress.hidden = false;
    mixUploadStatus.textContent = "Preparing the upload…";
    try {
      const masterUpload = await uploadAudioAsset(file, "master", progress => {
        const weighted = originalFile ? progress * 48 : progress * 82;
        mixUploadProgress.firstElementChild.style.width = `${weighted}%`;
      });
      const originalUpload = originalFile ? await uploadAudioAsset(originalFile, "original", progress => {
        mixUploadProgress.firstElementChild.style.width = `${48 + progress * 34}%`;
      }) : null;
      if (originalUpload) mixUploadProgress.firstElementChild.style.width = "82%";
      const fields = Object.fromEntries(new FormData(mixUploadForm).entries());
      delete fields.mixFile;
      delete fields.originalMixFile;
      const publishResponse = await fetch("/api/mixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ...fields,
          action: "publish",
          uploadSource: "creator_desk",
          sellerMode: "creator",
          clientSaleEnabled: mixUploadForm.elements.clientSaleEnabled.checked,
          rightsAttested: mixUploadForm.elements.rightsAttested.checked,
          uploadId: masterUpload.uploadId,
          chunkCount: masterUpload.chunkCount,
          byteSize: masterUpload.byteSize,
          contentType: masterUpload.contentType,
          durationSeconds: masterUpload.durationSeconds,
          originalUploadId: originalUpload?.uploadId || "",
          originalChunkCount: originalUpload?.chunkCount || 0,
          originalByteSize: originalUpload?.byteSize || 0,
          originalContentType: originalUpload?.contentType || "",
          originalDurationSeconds: originalUpload?.durationSeconds || 0,
          trackCount: 0
        })
      });
      const data = await publishResponse.json().catch(() => ({}));
      if (!publishResponse.ok) throw new Error(data.message || "The mix could not be posted.");
      mixUploadProgress.firstElementChild.style.width = "100%";
      mixUploadStatus.textContent = data.message;
      mixUploadButton.textContent = "Mix received";
      window.haloStats?.track("creator_mix_upload", { production_route: fields.productionRoute, sale_enabled: mixUploadForm.elements.clientSaleEnabled.checked });
      await loadData();
      await loadReviewData();
    } catch (error) {
      mixUploadStatus.textContent = error.message || "The mix could not be uploaded.";
      mixUploadButton.disabled = false;
    }
  }

  function syncPaidMixFields() {
    const saleEnabled = mixUploadForm.elements.clientSaleEnabled.checked && mixUploadForm.elements.visibility.value === "room";
    paidMixFields.hidden = !saleEnabled;
    mixUploadForm.elements.price.required = saleEnabled;
    mixUploadForm.elements.artworkUrl.required = saleEnabled;
    mixUploadForm.elements.description.required = saleEnabled;
    mixUploadForm.elements.description.minLength = saleEnabled ? 20 : 0;
  }

  function renderEpisodes() {
    if (!state.videos.length) {
      episodeStage.innerHTML = `<article class="episode-empty"><strong>Road to the Worlds is entering production.</strong><p>The first Inside the Mix episode appears here when it enters HALO TV. Until then, the full sets remain live in the Mix Cloud.</p><a class="episode-link" href="/halo-live.html">Enter HALO Live ↗</a></article>`;
      return;
    }
    const episode = state.videos[state.activeEpisode] || state.videos[0];
    const thumbnail = episode.thumbnailUrl || artworkPool[state.activeEpisode % artworkPool.length];
    const episodeNumber = String(state.activeEpisode + 1).padStart(2, "0");
    const thumbs = state.videos.slice(0, 3).map((video, index) => `<button class="episode-thumb" type="button" data-episode-index="${index}">
      <img src="${escapeHtml(video.thumbnailUrl || artworkPool[index % artworkPool.length])}" alt="">
      <span><span>Episode ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(video.title)}</strong></span>
    </button>`).join("");
    episodeStage.innerHTML = `<article class="episode-feature">
      <div class="episode-screen"><img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(episode.title)}"><button class="episode-play" type="button" data-open-episode aria-label="Watch ${escapeHtml(episode.title)}"></button></div>
      <div class="episode-details"><div><span>Episode ${episodeNumber} / Road to the Worlds</span><h3>${escapeHtml(episode.title)}</h3><p>${escapeHtml(episode.description || "Enter the room behind the finished performance and see why the version changed.")}</p></div><button class="episode-link" type="button" data-open-episode>Watch full episode ↗</button></div>
    </article>${state.videos.length > 1 ? `<div class="episode-thumbs">${thumbs}</div>` : ""}`;
  }

  function openEpisode() {
    const episode = state.videos[state.activeEpisode];
    if (!episode?.sourceUrl) return;
    window.open(episode.sourceUrl, "_blank", "noopener,noreferrer");
    window.haloStats?.track("open_inside_the_mix_episode", { video_id: episode.id, title: episode.title });
  }

  async function playMix(mix) {
    if (!mix) {
      window.location.href = "/radio/";
      return;
    }
    if (mix.source === "youtube" || (!mix.audioUrl && mix.videoUrl)) {
      window.open(mix.videoUrl, "_blank", "noopener,noreferrer");
      window.haloStats?.track("open_halo_x_long_play", { mix_id: mix.id, source: "youtube" });
      return;
    }
    if (!mix.audioUrl) {
      window.location.href = "/radio/";
      return;
    }
    if (state.activeMix?.id !== mix.id) {
      state.activeMix = mix;
      state.activeMixVersion = "mastered";
      state.playlist = Array.isArray(mix.playlist) ? mix.playlist : [];
      state.playlistIndex = 0;
      audio.src = state.playlist[0]?.audioUrl || mix.audioUrl;
      document.querySelector("#dockTitle").textContent = mix.title;
      document.querySelector("#dockCreator").textContent = mix.creator?.name || "DJ HALO X";
    }
    dockVersionSwitch.hidden = !mix.hasOriginalComparison;
    dockVersionSwitch.querySelectorAll("button").forEach(button => button.classList.toggle("is-active", button.dataset.dockVersion === state.activeMixVersion));
    playerDock.hidden = false;
    try {
      await audio.play();
      heroRecord.classList.add("is-playing");
      document.querySelector("#dockToggle").classList.remove("is-paused");
      window.haloStats?.track("play_halo_x_mix", { mix_id: mix.id, title: mix.title });
    } catch {
      document.querySelector("#dockCreator").textContent = "Tap play again to start the signal";
    }
  }

  async function switchMixVersion(mix, version) {
    if (!mix?.hasOriginalComparison || !["original", "mastered"].includes(version)) return;
    const nextSource = version === "original" ? mix.originalAudioUrl : mix.audioUrl;
    const sameMix = state.activeMix?.id === mix.id;
    const currentTime = sameMix && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const shouldResume = sameMix ? !audio.paused : true;
    state.activeMix = mix;
    state.activeMixVersion = version;
    state.playlist = [];
    state.playlistIndex = 0;
    audio.src = nextSource;
    audio.addEventListener("loadedmetadata", () => { audio.currentTime = Math.min(currentTime, Math.max(0, (audio.duration || currentTime) - 0.25)); }, { once: true });
    document.querySelector("#dockTitle").textContent = mix.title;
    document.querySelector("#dockCreator").textContent = `${mix.creator?.name || "DJ HALO X"} · ${version === "original" ? "Original version" : "Mastered remix"}`;
    playerDock.hidden = false;
    dockVersionSwitch.hidden = false;
    dockVersionSwitch.querySelectorAll("button").forEach(button => button.classList.toggle("is-active", button.dataset.dockVersion === version));
    if (shouldResume) await audio.play().catch(() => {});
    window.haloStats?.track("compare_mix_version", { mix_id: mix.id, version });
  }

  async function loadData() {
    const [mixResult, videoResult] = await Promise.allSettled([
      fetch("/api/mixes?limit=12&station=longplay", { headers: { Accept: "application/json" }, credentials: "same-origin" }).then(response => {
        if (!response.ok) throw new Error("Mixes unavailable");
        return response.json();
      }),
      fetch("/api/videos", { headers: { Accept: "application/json" }, credentials: "same-origin" }).then(response => {
        if (!response.ok) throw new Error("Videos unavailable");
        return response.json();
      })
    ]);
    state.mixes = mixResult.status === "fulfilled" ? mixResult.value.mixes || [] : [];
    const requestedMixId = new URLSearchParams(location.search).get("mix");
    state.selectedMix = state.mixes.find(mix => mix.id === requestedMixId) || null;
    state.videos = videoResult.status === "fulfilled" ? videoResult.value.videos || [] : [];
    renderFeatured();
    renderMixes();
    renderEpisodes();
    renderEdition();
    bindArtworkFallbacks();
  }

  heroPlay.addEventListener("click", () => playMix(state.featuredMix));
  mixRail.addEventListener("click", event => {
    const compareButton = event.target.closest("[data-compare-version]");
    if (compareButton) {
      switchMixVersion(state.mixes[Number(compareButton.dataset.compareIndex)], compareButton.dataset.compareVersion);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-mix]");
    if (deleteButton) {
      deleteMix(deleteButton.dataset.deleteMix, deleteButton.dataset.deleteTitle);
      return;
    }
    const button = event.target.closest("[data-mix-index]");
    if (button) playMix(state.mixes[Number(button.dataset.mixIndex)]);
  });
  dockVersionSwitch.addEventListener("click", event => {
    const button = event.target.closest("[data-dock-version]");
    if (button) switchMixVersion(state.activeMix, button.dataset.dockVersion);
  });
  episodeStage.addEventListener("click", event => {
    const thumb = event.target.closest("[data-episode-index]");
    if (thumb) {
      state.activeEpisode = Number(thumb.dataset.episodeIndex);
      renderEpisodes();
      return;
    }
    if (event.target.closest("[data-open-episode]")) openEpisode();
  });
  document.querySelector("#dockToggle").addEventListener("click", async event => {
    if (audio.paused) await audio.play().catch(() => {}); else audio.pause();
    event.currentTarget.classList.toggle("is-paused", audio.paused);
    event.currentTarget.setAttribute("aria-label", audio.paused ? "Play mix" : "Pause mix");
  });
  audio.addEventListener("play", () => {
    heroRecord.classList.add("is-playing");
    document.querySelector("#dockToggle").classList.remove("is-paused");
  });
  audio.addEventListener("pause", () => {
    heroRecord.classList.remove("is-playing");
    document.querySelector("#dockToggle").classList.add("is-paused");
  });
  audio.addEventListener("timeupdate", () => {
    const playlistOffset = state.playlist.slice(0, state.playlistIndex).reduce((total, item) => total + Number(item.playSeconds || 0), 0);
    const playlistDuration = state.playlist.length ? Number(state.activeMix?.durationSeconds || 0) : 0;
    const elapsed = playlistDuration ? playlistOffset + audio.currentTime : audio.currentTime;
    const duration = playlistDuration || (Number.isFinite(audio.duration) ? audio.duration : 0);
    const progress = duration ? (elapsed / duration) * 100 : 0;
    document.querySelector("#dockProgress").style.width = `${progress}%`;
    document.querySelector("#dockTime").textContent = `${formatDuration(elapsed)} / ${formatDuration(duration)}`;
  });
  audio.addEventListener("ended", async () => {
    if (!state.playlist.length || state.playlistIndex >= state.playlist.length - 1) return;
    state.playlistIndex += 1;
    audio.src = state.playlist[state.playlistIndex].audioUrl;
    await audio.play().catch(() => {});
  });
  editionButton.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Checking the edition desk…";
    checkoutStatus.textContent = "";
    try {
      const mixQuery = state.selectedMix?.id ? `?mix=${encodeURIComponent(state.selectedMix.id)}` : "";
      const response = await fetch(`/api/payment-link${mixQuery}`, { method: "POST", headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.checkoutUrl) throw new Error(data.message || "No edition is on sale right now.");
      window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
      checkoutStatus.textContent = "The secure edition checkout opened in a new tab.";
      window.haloStats?.track("open_halo_x_mix_edition_checkout", { source: "mixes_page" });
    } catch (error) {
      checkoutStatus.textContent = error.message || "No edition is on sale right now. The free stream remains open.";
    } finally {
      button.disabled = false;
      button.textContent = "Check edition availability";
    }
  });

  mixLoginButton.addEventListener("click", async () => {
    if (!mixLoginEmail.value || !mixLoginPassword.value) {
      mixLoginStatus.textContent = "Enter your HALO email and password.";
      return;
    }
    mixLoginButton.disabled = true;
    mixLoginStatus.textContent = "Opening your Mix Desk…";
    try {
      await window.haloIdentity?.login?.(mixLoginEmail.value.trim(), mixLoginPassword.value);
      mixLoginPassword.value = "";
      await updateUploadAccess();
    } catch (error) {
      mixLoginStatus.textContent = error.message || "The HALO sign-in could not be completed.";
    } finally {
      mixLoginButton.disabled = false;
    }
  });
  mixUploadForm.addEventListener("submit", uploadCreatorMix);
  mixUploadForm.addEventListener("invalid", event => {
    const label = event.target.closest("label")?.querySelector("span")?.textContent?.trim();
    mixUploadStatus.textContent = label ? `Complete “${label}” before uploading.` : "Complete the required upload details.";
  }, true);
  mixUploadForm.elements.clientSaleEnabled.addEventListener("change", syncPaidMixFields);
  mixUploadForm.elements.visibility.addEventListener("change", syncPaidMixFields);
  visualMixForm.addEventListener("submit", buildVisualMix);
  visualTimeline.addEventListener("click", event => {
    const button = event.target.closest("[data-scene-id]");
    if (!button) return;
    const project = selectedVisualProject();
    const scene = project?.scenes.find(item => item.id === button.dataset.sceneId);
    if (scene) renderVisualScene(scene, project);
  });
  visualProjectTabs.addEventListener("click", event => {
    const button = event.target.closest("[data-visual-project]");
    if (!button) return;
    state.selectedVisualProjectId = button.dataset.visualProject;
    state.selectedVisualSceneId = "";
    renderVisualStudio();
  });
  visualRenderBrief.addEventListener("click", async () => {
    const project = selectedVisualProject();
    if (!project) return;
    if (project.status === "render_brief_ready") {
      downloadVisualBrief(project);
      visualStudioStatus.textContent = "The production-ready timeline brief was downloaded.";
      return;
    }
    visualRenderBrief.disabled = true;
    visualStudioStatus.textContent = "Preparing the production handoff…";
    try {
      const response = await fetch("/api/visual-mixes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "mark_render_brief", projectId: project.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The render brief could not be prepared.");
      visualStudioStatus.textContent = data.message;
      await loadVisualStudio();
      window.haloStats?.track("prepare_visual_mix_render_brief", { package: project.packageType });
    } catch (error) {
      visualStudioStatus.textContent = error.message || "The render brief could not be prepared.";
      visualRenderBrief.disabled = false;
    }
  });
  visualScreenLogo.addEventListener("error", () => { visualScreenLogo.hidden = true; });
  syncPaidMixFields();
  qualityReviewForm.addEventListener("submit", async event => {
    event.preventDefault();
    qualityFormStatus.textContent = "Saving evidence…";
    const fields = Object.fromEntries(new FormData(qualityReviewForm).entries());
    try {
      await postReview({ ...fields, action: "save_area_review", breaks: state.reviewBreaks });
    } catch (error) {
      qualityFormStatus.textContent = error.message || "The review could not be saved.";
    }
  });
  reviewCycleSelect.addEventListener("change", () => { state.selectedReviewCycleId = reviewCycleSelect.value; renderQualityRoom(); });
  reviewArea.addEventListener("change", loadAreaIntoForm);
  reviewOutcome.addEventListener("change", () => { reviewScore.disabled = reviewOutcome.value !== "scored"; });
  document.querySelector("#addBreakObservation").addEventListener("click", () => {
    const timestampSeconds = parseReviewTime(document.querySelector("#breakTime").value);
    const observation = document.querySelector("#breakObservation").value.trim();
    if (timestampSeconds === null || !observation) {
      qualityFormStatus.textContent = "Add a valid time and describe what happens there.";
      return;
    }
    state.reviewBreaks.push({ timestampSeconds, breakType: document.querySelector("#breakType").value, severity: document.querySelector("#breakSeverity").value, observation, intentUnderstood: document.querySelector("#breakIntent").checked });
    state.reviewBreaks.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    document.querySelector("#breakObservation").value = "";
    renderBreakList();
  });
  breakList.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-break]");
    if (!button) return;
    state.reviewBreaks.splice(Number(button.dataset.removeBreak), 1);
    renderBreakList();
  });
  qualityQueue.addEventListener("click", async event => {
    const selectButton = event.target.closest("[data-select-review]");
    if (selectButton) {
      state.selectedReviewCycleId = selectButton.dataset.selectReview;
      renderQualityRoom();
      qualityReviewForm.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const listenButton = event.target.closest("[data-review-listen]");
    if (!listenButton) return;
    const cycle = state.reviewCycles.find(item => item.id === listenButton.dataset.reviewListen);
    if (!cycle) return;
    await playMix({ id: cycle.mixId, title: cycle.title, audioUrl: cycle.audioUrl, creator: { name: cycle.creatorName } });
  });
  document.querySelectorAll("[data-final-decision]").forEach(button => button.addEventListener("click", async () => {
    const summary = document.querySelector("#finalReviewSummary").value.trim();
    qualityFormStatus.textContent = "Recording the whole-picture decision…";
    try {
      await postReview({ action: "finalize_review", cycleId: state.selectedReviewCycleId, decision: button.dataset.finalDecision, summary });
    } catch (error) {
      qualityFormStatus.textContent = error.message || "The final decision could not be saved.";
    }
  }));
  window.addEventListener("halo-identity-ready", updateUploadAccess);
  updateUploadAccess();

  loadData();
})();
