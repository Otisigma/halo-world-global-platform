(() => {
  const chapters = [
    {
      number: "01",
      label: "Origin",
      kicker: "An artist story in motion",
      title: "The signal begins slowly.",
      copy: "A patient opening for music that leaves room for atmosphere. Dreamweaver begins with distance, texture, and the feeling that something is approaching before the rhythm fully arrives.",
      note: "Treat the first movement as an invitation rather than an announcement. Let the artwork breathe and allow the mix to establish its own scale.",
      source: "The Cold Is Lasting Longer — Owen Anthony / HALO featured release artwork.",
      image: "/assets/releases/the-cold-is-lasting-longer.jpg",
      wash: "linear-gradient(125deg, rgba(26,45,49,.7), rgba(71,28,16,.42) 62%, rgba(6,8,8,.9))",
      start: 0
    },
    {
      number: "02",
      label: "Undertow",
      kicker: "Pressure under the surface",
      title: "Every still room has a current.",
      copy: "The second movement pulls closer. Repetition becomes tension; small changes matter. The visual world narrows around the music until the listener can feel the floor moving underneath it.",
      note: "Use tighter crops, darker movement, and more visible rhythm. This chapter is where a background experience starts becoming a journey.",
      source: "Quicksand — Owen Anthony / artist-room artwork.",
      image: "/assets/artists/owen-anthony-quicksand.jpg",
      wash: "linear-gradient(120deg, rgba(53,25,13,.82), rgba(91,65,37,.35) 48%, rgba(13,12,10,.9))",
      start: .18
    },
    {
      number: "03",
      label: "Reflection",
      kicker: "The room turns transparent",
      title: "What looks fragile can carry weight.",
      copy: "At the centre of the set, Dreamweaver changes the pace of looking. Reflections, negative space, and suspended detail create a visual pause without stopping the musical movement.",
      note: "This is the emotional hinge. It should feel spacious enough for a personal story, an artist voice note, or an important lyric fragment once approved.",
      source: "Glass House — Owen Anthony / artist-room artwork.",
      image: "/assets/artists/owen-anthony-glass-house.webp",
      wash: "linear-gradient(118deg, rgba(9,21,28,.7), rgba(30,67,72,.3) 50%, rgba(7,8,9,.92))",
      start: .39
    },
    {
      number: "04",
      label: "Release",
      kicker: "The body answers back",
      title: "Then the colour breaks through.",
      copy: "The fourth movement gives the experience its physical release. The pictures become bolder, the cuts can become quicker, and the show moves from private reflection into collective energy.",
      note: "This chapter proves that the format can live at home, in a party, or on a large screen. Motion should answer the mix without becoming a generic visualizer.",
      source: "Hit That Beat — Owen Anthony / release artwork.",
      image: "/assets/releases/hit-that-beat.webp",
      wash: "linear-gradient(130deg, rgba(103,20,42,.48), rgba(230,89,29,.34) 48%, rgba(18,10,10,.88))",
      start: .61
    },
    {
      number: "05",
      label: "Open signal",
      kicker: "The story continues outside the frame",
      title: "A mix ends. A world stays open.",
      copy: "The closing movement returns the listener to HALO with the artist, contributors, and wider catalog still visible. The experience becomes a doorway rather than a file that simply finishes.",
      note: "End with accurate credits, acknowledgements, and a clear next path: replay, enter the artist room, hear the releases, or commission another Dreamweaver edition.",
      source: "HALO artist world / first Dreamweaver edition.",
      image: "/assets/halo-logo.webp",
      wash: "radial-gradient(circle at 60% 42%, rgba(213,242,99,.2), transparent 22%), linear-gradient(120deg, rgba(8,11,9,.6), rgba(49,37,20,.42), rgba(7,8,7,.95))",
      start: .82
    }
  ];

  const elements = {
    satellite: document.getElementById("dreamweaverSatellite"),
    unlockForm: document.getElementById("dreamweaverUnlockForm"),
    unlockStatus: document.getElementById("dreamweaverUnlockStatus"),
    reward: document.getElementById("dreamweaverReward"),
    rewardCopy: document.getElementById("dreamweaverRewardCopy"),
    startDreamweaverShow: document.getElementById("startDreamweaverShow"),
    spotifyLink: document.getElementById("dreamweaverSpotifyLink"),
    appleLink: document.getElementById("dreamweaverAppleLink"),
    youtubeLink: document.getElementById("dreamweaverYouTubeLink"),
    shell: document.getElementById("showShell"),
    loading: document.getElementById("loadingShow"),
    stage: document.getElementById("showStage"),
    empty: document.getElementById("emptyShow"),
    emptyMessage: document.getElementById("emptyMessage"),
    audio: document.getElementById("showAudio"),
    visualStack: document.getElementById("visualStack"),
    chapterList: document.getElementById("chapterList"),
    progressMarkers: document.getElementById("progressMarkers"),
    chapterNumber: document.getElementById("chapterNumber"),
    storyKicker: document.getElementById("storyKicker"),
    storyTitle: document.getElementById("storyTitle"),
    storyCopy: document.getElementById("storyCopy"),
    mixTitle: document.getElementById("mixTitle"),
    mixCreator: document.getElementById("mixCreator"),
    playButton: document.getElementById("playButton"),
    progress: document.getElementById("showProgress"),
    elapsed: document.getElementById("elapsedTime"),
    duration: document.getElementById("durationTime"),
    chapterTime: document.getElementById("chapterTime"),
    muteButton: document.getElementById("muteButton"),
    fullScreenButton: document.getElementById("fullScreenButton"),
    shareShow: document.getElementById("shareShow"),
    makeCampaign: document.getElementById("makeCampaign"),
    campaignStudio: document.getElementById("campaignStudio"),
    closeCampaign: document.getElementById("closeCampaign"),
    campaignForm: document.getElementById("campaignForm"),
    generateCampaign: document.getElementById("generateCampaign"),
    campaignYoutubeUrl: document.getElementById("campaignYoutubeUrl"),
    campaignAdvanced: document.getElementById("campaignAdvanced"),
    clipStart: document.getElementById("clipStart"),
    clipStartTime: document.getElementById("clipStartTime"),
    clipEndTime: document.getElementById("clipEndTime"),
    campaignGoal: document.getElementById("campaignGoal"),
    campaignHeadline: document.getElementById("campaignHeadline"),
    footageSelector: document.getElementById("footageSelector"),
    campaignCanvas: document.getElementById("campaignCanvas"),
    previewMovement: document.getElementById("previewMovement"),
    renderClip: document.getElementById("renderClip"),
    downloadClip: document.getElementById("downloadClip"),
    downloadCover: document.getElementById("downloadCover"),
    renderCurtain: document.getElementById("renderCurtain"),
    renderProgress: document.getElementById("renderProgress"),
    renderProgressDetail: document.getElementById("renderProgressDetail"),
    renderProgressMeter: document.getElementById("renderProgressMeter"),
    renderProgressBar: document.getElementById("renderProgressBar"),
    renderStatus: document.getElementById("renderStatus"),
    renderStatusTitle: document.getElementById("renderStatusTitle"),
    renderStatusDetail: document.getElementById("renderStatusDetail"),
    packageEmpty: document.getElementById("packageEmpty"),
    packageResults: document.getElementById("packageResults"),
    campaignBuildActivity: document.getElementById("campaignBuildActivity"),
    campaignBuildPercent: document.getElementById("campaignBuildPercent"),
    campaignBuildTitle: document.getElementById("campaignBuildTitle"),
    campaignBuildDetail: document.getElementById("campaignBuildDetail"),
    campaignBuildMeter: document.getElementById("campaignBuildMeter"),
    campaignBuildBar: document.getElementById("campaignBuildBar"),
    campaignBuildStages: document.getElementById("campaignBuildStages"),
    packageTitle: document.getElementById("packageTitle"),
    packageIdea: document.getElementById("packageIdea"),
    platformPackages: document.getElementById("platformPackages"),
    downloadPackage: document.getElementById("downloadPackage"),
    reviewCampaign: document.getElementById("reviewCampaign"),
    campaignScore: document.getElementById("campaignScore"),
    campaignScoreValue: document.getElementById("campaignScoreValue"),
    campaignScoreGrade: document.getElementById("campaignScoreGrade"),
    campaignScoreSummary: document.getElementById("campaignScoreSummary"),
    campaignRecommendations: document.getElementById("campaignRecommendations"),
    campaignHistory: document.getElementById("campaignHistory"),
    openStory: document.getElementById("openStory"),
    closeStory: document.getElementById("closeStory"),
    drawer: document.getElementById("storyDrawer"),
    drawerKicker: document.getElementById("drawerKicker"),
    drawerTitle: document.getElementById("drawerTitle"),
    drawerLead: document.getElementById("drawerLead"),
    drawerNote: document.getElementById("drawerNote"),
    drawerSource: document.getElementById("drawerSource"),
    archiveReel: document.getElementById("archiveReel"),
    retry: document.getElementById("retryShow"),
    toast: document.getElementById("toast")
  };

  const unlockStorageKey = "halo:dreamweaver-unlock";
  const unlockPlatforms = {
    spotify: {
      label: "Spotify",
      href: query => `https://open.spotify.com/search/${encodeURIComponent(query)}`
    },
    apple_music: {
      label: "Apple Music",
      href: query => `https://music.apple.com/us/search?term=${encodeURIComponent(query)}`
    },
    youtube: {
      label: "YouTube",
      href: query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    }
  };

  const state = {
    mix: null,
    unlock: readStoredUnlock(),
    activeChapter: 0,
    duration: 0,
    videos: [],
    idleTimer: 0,
    campaign: null,
    campaigns: [],
    activePlatform: "tiktok",
    images: new Map(),
    mediaPlayers: new Map(),
    renderedClip: null,
    renderCurtainTimer: 0,
    campaignJob: null,
    campaignJobTimer: 0,
    buildPreviewFrame: 0,
    buildPreviewStartedAt: 0,
    trackedProgress: new Set(),
    startPlaybackAfterLoad: false,
    sessionToken: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function readStoredUnlock() {
    try {
      const parsed = JSON.parse(localStorage.getItem(unlockStorageKey) || "null");
      if (!parsed || typeof parsed !== "object") return null;
      const email = String(parsed.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
      return {
        firstName: String(parsed.firstName || "").trim().slice(0, 80),
        email,
        favoritePlatform: unlockPlatforms[String(parsed.favoritePlatform || "")] ? String(parsed.favoritePlatform) : "spotify"
      };
    } catch {
      return null;
    }
  }

  function rememberUnlock(unlock) {
    try {
      localStorage.setItem(unlockStorageKey, JSON.stringify(unlock));
    } catch {}
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remainder = safe % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function isSatelliteFlow() {
    const params = new URLSearchParams(location.search);
    if (campaignIdFromUrl() || params.get("experience") === "studio") return false;
    const hasMix = Boolean(params.get("mix"));
    if (!hasMix) return true;
    return params.get("satellite") === "dreamweaver";
  }

  function rewardSearchQuery() {
    return `${state.mix?.title || "Dreamweaver"} ${state.mix?.creator?.name || "Owen Anthony"}`.trim();
  }

  function setUnlockStatus(message = "", tone = "") {
    if (!elements.unlockStatus) return;
    elements.unlockStatus.textContent = message;
    elements.unlockStatus.className = "satellite-status";
    if (tone) elements.unlockStatus.classList.add(`is-${tone}`);
  }

  function updatePlatformLinks() {
    const query = rewardSearchQuery();
    if (elements.spotifyLink) elements.spotifyLink.href = unlockPlatforms.spotify.href(query);
    if (elements.appleLink) elements.appleLink.href = unlockPlatforms.apple_music.href(query);
    if (elements.youtubeLink) elements.youtubeLink.href = unlockPlatforms.youtube.href(query);
  }

  function renderRewardState() {
    if (!elements.rewardCopy) return;
    const firstName = state.unlock?.firstName || "You";
    const platform = unlockPlatforms[state.unlock?.favoritePlatform || "spotify"]?.label || "your streaming app";
    elements.rewardCopy.textContent = `${firstName}, your concierge doorway is open. Start the full Dreamweaver experience below, then continue on ${platform}, Spotify, Apple Music, or YouTube when you are ready.`;
    updatePlatformLinks();
  }

  function renderSatelliteState() {
    const satelliteFlow = isSatelliteFlow();
    if (!satelliteFlow) {
      if (elements.satellite) elements.satellite.hidden = true;
      if (elements.reward) elements.reward.hidden = true;
      elements.shell.hidden = false;
      return;
    }
    if (elements.satellite) elements.satellite.hidden = Boolean(state.unlock);
    if (elements.reward) elements.reward.hidden = !state.unlock;
    elements.shell.hidden = !state.unlock;
    if (state.unlock) renderRewardState();
  }

  async function unlockDreamweaver(event) {
    event.preventDefault();
    if (!elements.unlockForm?.reportValidity()) {
      setUnlockStatus("Add your email and accept the unlock terms before continuing.", "error");
      return;
    }
    const submitButton = elements.unlockForm.querySelector("button[type='submit']");
    const data = new FormData(elements.unlockForm);
    const payload = {
      firstName: String(data.get("firstName") || "").trim(),
      email: String(data.get("email") || "").trim(),
      favoritePlatform: String(data.get("favoritePlatform") || "spotify"),
      company: String(data.get("company") || "").trim(),
      consent: data.get("consent") === "on"
    };
    submitButton.disabled = true;
    submitButton.querySelector("span").textContent = "Unlocking Dreamweaver…";
    setUnlockStatus("Saving your unlock and preparing the listening room.");
    try {
      const response = await fetch("/api/dreamweaver-fan-signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Dreamweaver could not unlock the experience right now.");
      state.unlock = {
        firstName: payload.firstName,
        email: payload.email.trim().toLowerCase(),
        favoritePlatform: unlockPlatforms[payload.favoritePlatform] ? payload.favoritePlatform : "spotify"
      };
      rememberUnlock(state.unlock);
      renderSatelliteState();
      setUnlockStatus(result.message || "Dreamweaver unlocked your release doorway.", "success");
      await loadShow();
      elements.shell.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setUnlockStatus(error instanceof Error ? error.message : "Dreamweaver could not unlock the experience right now.", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.querySelector("span").textContent = "Unlock the full Dreamweaver doorway";
    }
  }

  async function startUnlockedShow() {
    state.startPlaybackAfterLoad = true;
    if (elements.shell.hidden) {
      renderSatelliteState();
      await loadShow();
    } else if (elements.audio.paused) {
      try { await elements.audio.play(); } catch {}
      state.startPlaybackAfterLoad = false;
    }
    elements.shell.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("show"), 2600);
  }

  function setRenderStatus(status, title, detail) {
    elements.renderStatus.dataset.state = status;
    elements.renderStatusTitle.textContent = title;
    elements.renderStatusDetail.textContent = detail;
  }

  function setRenderProgress(progress, title, detail) {
    const percent = Math.max(0, Math.min(100, Math.round(progress)));
    elements.renderProgress.textContent = title;
    elements.renderProgressDetail.textContent = detail;
    elements.renderProgressBar.style.width = `${percent}%`;
    elements.renderProgressMeter.setAttribute("aria-valuenow", String(percent));
  }

  function resetRenderedClip() {
    window.clearTimeout(state.renderCurtainTimer);
    state.renderCurtainTimer = 0;
    state.renderedClip = null;
    elements.downloadClip.disabled = true;
    setRenderStatus("idle", "Film not created yet", "Create the film first. Download unlocks only after a complete video file is ready.");
  }

  function buildExperience() {
    elements.visualStack.innerHTML = chapters.map((chapter, index) => `<div class="visual-layer ${index === 0 ? "active" : ""}" data-visual="${index}" style="--visual-image:url('${chapter.image}');--visual-wash:${chapter.wash}"></div>`).join("");
    elements.chapterList.innerHTML = chapters.map((chapter, index) => `<button class="chapter-button ${index === 0 ? "active" : ""}" type="button" data-chapter="${index}" aria-label="Open movement ${chapter.number}: ${escapeHtml(chapter.label)}"><span>${chapter.number}</span><strong>${escapeHtml(chapter.label)}</strong></button>`).join("");
    elements.progressMarkers.innerHTML = chapters.slice(1).map(chapter => `<i style="left:${chapter.start * 100}%"></i>`).join("");
    elements.chapterList.querySelectorAll("[data-chapter]").forEach(button => button.addEventListener("click", () => activateChapter(Number(button.dataset.chapter), true)));
    activateChapter(0, false);
  }

  function activateChapter(index, seek) {
    const nextIndex = Math.max(0, Math.min(chapters.length - 1, index));
    const chapter = chapters[nextIndex];
    state.activeChapter = nextIndex;
    document.querySelectorAll(".visual-layer").forEach((layer, layerIndex) => layer.classList.toggle("active", layerIndex === nextIndex));
    document.querySelectorAll(".chapter-button").forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === nextIndex));
    elements.chapterNumber.textContent = chapter.number;
    elements.storyKicker.textContent = chapter.kicker;
    elements.storyTitle.textContent = chapter.title;
    elements.storyCopy.textContent = chapter.copy;
    elements.chapterTime.textContent = `Movement ${chapter.number} / ${chapter.label}`;
    elements.drawerKicker.textContent = `Movement ${chapter.number} / ${chapter.label}`;
    elements.drawerTitle.textContent = chapter.title;
    elements.drawerLead.textContent = chapter.copy;
    elements.drawerNote.textContent = chapter.note;
    elements.drawerSource.textContent = chapter.source;
    if (seek && state.duration) {
      elements.audio.currentTime = chapter.start * state.duration;
      updateProgress();
    }
    window.haloStats?.track("dreamweaver_chapter", { chapter: chapter.label.toLowerCase(), mix_id: state.mix?.id || "" });
  }

  function currentChapterIndex() {
    if (!state.duration) return 0;
    const ratio = elements.audio.currentTime / state.duration;
    for (let index = chapters.length - 1; index >= 0; index -= 1) if (ratio >= chapters[index].start) return index;
    return 0;
  }

  function updateProgress() {
    const duration = state.duration || elements.audio.duration || 0;
    const current = elements.audio.currentTime || 0;
    const ratio = duration ? current / duration : 0;
    elements.progress.value = String(Math.round(ratio * 1000));
    elements.progress.style.setProperty("--progress", `${ratio * 100}%`);
    elements.elapsed.textContent = formatTime(current);
    elements.duration.textContent = formatTime(duration);
    const chapterIndex = currentChapterIndex();
    if (chapterIndex !== state.activeChapter) activateChapter(chapterIndex, false);
    if (campaignIdFromUrl() && duration) {
      [[.25, "mix_25"], [.5, "mix_50"], [.75, "mix_75"]].forEach(([threshold, eventKind]) => {
        if (ratio >= threshold && !state.trackedProgress.has(eventKind)) {
          state.trackedProgress.add(eventKind);
          trackCampaignEvent(eventKind, new URLSearchParams(location.search).get("source") || "halo");
        }
      });
    }
  }

  async function togglePlayback() {
    if (!state.mix) return;
    if (elements.audio.paused) {
      try {
        await elements.audio.play();
      } catch {
        showToast("Press play again to start the audio experience.");
      }
    } else elements.audio.pause();
  }

  function setMode(mode) {
    const normalized = ["watch", "room", "explore"].includes(mode) ? mode : "watch";
    document.body.classList.toggle("mode-room", normalized === "room");
    document.body.classList.toggle("mode-explore", normalized === "explore");
    document.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === normalized)));
    elements.drawer.classList.toggle("open", normalized === "explore");
    elements.drawer.setAttribute("aria-hidden", String(normalized !== "explore"));
    resetIdle();
    window.haloStats?.track("dreamweaver_mode", { mode: normalized });
  }

  function openStory() {
    elements.drawer.classList.add("open");
    elements.drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("mode-explore");
    document.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === "explore")));
    elements.closeStory.focus();
  }

  function closeStory() {
    elements.drawer.classList.remove("open");
    elements.drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mode-explore");
    document.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === "watch")));
    elements.openStory.focus();
  }

  function resetIdle() {
    document.body.classList.remove("idle");
    window.clearTimeout(state.idleTimer);
    if (document.body.classList.contains("mode-room") && !elements.audio.paused) state.idleTimer = window.setTimeout(() => document.body.classList.add("idle"), 3200);
  }

  function campaignIdFromUrl() {
    const value = new URLSearchParams(location.search).get("campaign") || "";
    return /^[0-9a-f-]{36}$/i.test(value) ? value : "";
  }

  function selectedDuration() {
    return Number(elements.campaignForm.querySelector('input[name="clipDuration"]:checked')?.value || 30);
  }

  function selectedTemplate() {
    return elements.campaignForm.querySelector('input[name="template"]:checked')?.value || "hook";
  }

  function selectedVisualTreatment() {
    return elements.campaignForm.querySelector('input[name="visualTreatment"]:checked')?.value || "archive_reel";
  }

  function selectedSourceVideos() {
    const selectedIds = new Set([...elements.footageSelector.querySelectorAll('input[name="sourceVideo"]:checked')].map(input => input.value));
    return state.videos.filter(video => selectedIds.has(video.id));
  }

  function chapterForTime(seconds) {
    const ratio = state.duration ? Math.max(0, Math.min(1, seconds / state.duration)) : 0;
    for (let index = chapters.length - 1; index >= 0; index -= 1) if (ratio >= chapters[index].start) return { chapter: chapters[index], index };
    return { chapter: chapters[0], index: 0 };
  }

  function wrapCanvasText(context, text, maxWidth, maxLines = 3) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length === maxLines - 1) break;
      } else line = next;
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
  }

  function loadImage(source) {
    if (state.images.has(source)) return Promise.resolve(state.images.get(source));
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => { state.images.set(source, image); resolve(image); };
      image.onerror = () => resolve(null);
      image.src = source;
    });
  }

  async function preloadCampaignImages() {
    await Promise.all([
      ...chapters.map(chapter => loadImage(chapter.image)),
      ...state.videos.map(video => video.thumbnailUrl).filter(Boolean).map(loadImage)
    ]);
  }

  function drawCoverImage(context, image, width, height, movement = 0) {
    if (!image?.naturalWidth) return;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * (1.05 + movement * .025);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const driftX = Math.sin(movement * Math.PI * 2) * width * .025;
    const driftY = Math.cos(movement * Math.PI) * height * .018;
    context.drawImage(image, (width - drawWidth) / 2 + driftX, (height - drawHeight) / 2 + driftY, drawWidth, drawHeight);
  }

  function drawMediaCrop(context, media, x, y, width, height, movement = 0) {
    const mediaWidth = media?.videoWidth || media?.naturalWidth || 0;
    const mediaHeight = media?.videoHeight || media?.naturalHeight || 0;
    if (!mediaWidth || !mediaHeight) return false;
    const scale = Math.max(width / mediaWidth, height / mediaHeight) * (1.02 + movement * .018);
    const drawWidth = mediaWidth * scale;
    const drawHeight = mediaHeight * scale;
    context.drawImage(media, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    return true;
  }

  function campaignMediaFor(video) {
    if (video?.sourceType !== "upload") return null;
    const player = state.mediaPlayers.get(video?.id);
    if (player?.readyState >= 2) return player;
    return state.images.get(video?.thumbnailUrl) || null;
  }

  function drawCampaignMedia(context, width, height, progress, fallbackImage) {
    const videos = selectedSourceVideos();
    if (!videos.length) return drawCoverImage(context, fallbackImage, width, height, progress);
    const treatment = selectedVisualTreatment();
    if (treatment === "collage") {
      drawCoverImage(context, fallbackImage, width, height, progress);
      const panelWidth = width * .64;
      const panelHeight = height * .54;
      const panels = [
        { x: -width * .08, y: -height * .02 },
        { x: width * .43, y: height * .2 },
        { x: width * .04, y: height * .53 }
      ];
      panels.forEach((panel, index) => {
        const video = videos[(Math.floor(progress * Math.max(1, videos.length)) + index) % videos.length];
        context.save();
        context.globalAlpha = index === 1 ? .68 : .86;
        context.beginPath();
        context.rect(panel.x, panel.y, panelWidth, panelHeight);
        context.clip();
        drawMediaCrop(context, campaignMediaFor(video), panel.x, panel.y, panelWidth, panelHeight, progress);
        context.restore();
      });
      return;
    }
    const index = treatment === "section" ? 0 : Math.min(videos.length - 1, Math.floor(progress * videos.length));
    if (!drawMediaCrop(context, campaignMediaFor(videos[index]), 0, 0, width, height, progress)) {
      drawCoverImage(context, fallbackImage, width, height, progress);
    }
  }

  async function prepareCampaignVideos() {
    const uploadedVideos = selectedSourceVideos().filter(video => video.sourceType === "upload" && video.sourceUrl);
    await Promise.all(uploadedVideos.map(video => new Promise(resolve => {
      let player = state.mediaPlayers.get(video.id);
      if (!player) {
        player = document.createElement("video");
        player.muted = true;
        player.playsInline = true;
        player.preload = "auto";
        player.src = video.sourceUrl;
        state.mediaPlayers.set(video.id, player);
      }
      if (player.readyState >= 2) return resolve();
      const done = () => resolve();
      player.addEventListener("loadeddata", done, { once: true });
      player.addEventListener("error", done, { once: true });
      window.setTimeout(done, 4000);
      player.load();
    })));
    await Promise.all(uploadedVideos.map(video => state.mediaPlayers.get(video.id)?.play().catch(() => {})));
  }

  function stopCampaignVideos() {
    state.mediaPlayers.forEach(player => player.pause());
  }

  function drawCampaignFrame(progress = 0) {
    const canvas = elements.campaignCanvas;
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const start = Number(elements.clipStart.value || 0);
    const duration = selectedDuration();
    const absoluteTime = start + progress * duration;
    const { chapter, index } = chapterForTime(absoluteTime);
    const image = state.images.get(chapter.image);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#10100c";
    context.fillRect(0, 0, width, height);
    context.save();
    context.globalAlpha = .78;
    drawCampaignMedia(context, width, height, progress, image);
    context.restore();

    const upperWash = context.createLinearGradient(0, 0, width, height);
    upperWash.addColorStop(0, "rgba(8,11,9,.2)");
    upperWash.addColorStop(.48, "rgba(8,9,7,.12)");
    upperWash.addColorStop(1, "rgba(6,7,5,.9)");
    context.fillStyle = upperWash;
    context.fillRect(0, 0, width, height);
    const bottomWash = context.createLinearGradient(0, height * .42, 0, height);
    bottomWash.addColorStop(0, "rgba(4,5,4,0)");
    bottomWash.addColorStop(1, "rgba(4,5,4,.96)");
    context.fillStyle = bottomWash;
    context.fillRect(0, height * .38, width, height * .62);

    context.strokeStyle = "rgba(240,235,217,.32)";
    context.lineWidth = 2;
    context.strokeRect(58, 58, width - 116, height - 116);
    context.fillStyle = "#c7ee48";
    context.font = "500 28px IBM Plex Mono, monospace";
    context.letterSpacing = "5px";
    context.fillText(`DREAMWEAVER / MOVEMENT ${chapter.number}`, 88, 122);
    context.fillStyle = "rgba(240,235,217,.76)";
    context.font = "500 25px IBM Plex Mono, monospace";
    context.fillText(state.mix?.creator?.name?.toUpperCase?.() || "HALO ARTIST", 88, 164);

    context.textAlign = "right";
    context.fillStyle = "rgba(240,235,217,.92)";
    context.font = "500 74px Cormorant Garamond, serif";
    context.fillText("DW", width - 88, 142);
    context.font = "500 20px IBM Plex Mono, monospace";
    context.fillText("VERTICAL EDITION", width - 88, 176);
    context.textAlign = "left";

    const packageHook = state.campaign?.package?.primaryHook;
    const template = selectedTemplate();
    const fallbackHook = template === "story" ? chapter.title : template === "invitation" ? "A mix ends. A world stays open." : chapter.kicker;
    const hook = elements.campaignHeadline.value.trim() || packageHook || fallbackHook;
    context.fillStyle = "#f0ebd9";
    context.font = "600 116px Cormorant Garamond, serif";
    const hookLines = wrapCanvasText(context, hook, width - 176, 4);
    hookLines.forEach((line, lineIndex) => context.fillText(line, 88, 1110 + lineIndex * 104));

    const titleY = 1110 + hookLines.length * 104 + 52;
    context.fillStyle = "rgba(240,235,217,.72)";
    context.font = "500 27px IBM Plex Mono, monospace";
    wrapCanvasText(context, state.mix?.title || "HALO Dreamweaver mix", width - 176, 2).forEach((line, lineIndex) => context.fillText(line.toUpperCase(), 88, titleY + lineIndex * 42));

    context.fillStyle = "#c7ee48";
    context.fillRect(88, height - 185, Math.max(8, (width - 176) * progress), 4);
    context.fillStyle = "rgba(240,235,217,.26)";
    context.fillRect(88 + (width - 176) * progress, height - 185, (width - 176) * (1 - progress), 4);
    context.fillStyle = "#f0ebd9";
    context.font = "500 24px IBM Plex Mono, monospace";
    context.fillText(state.campaign?.package?.callToAction || "ENTER THE FULL SHOW ON HALO", 88, height - 118);
    context.textAlign = "right";
    context.fillText(`${formatTime(absoluteTime)} / ${duration} SEC`, width - 88, height - 118);
    context.textAlign = "left";
    elements.previewMovement.textContent = `Movement ${chapter.number} / ${chapter.label}`;
    return index;
  }

  function updateClipTiming() {
    resetRenderedClip();
    const duration = selectedDuration();
    const maxStart = Math.max(0, Math.floor((state.duration || 0) - duration));
    elements.clipStart.max = String(maxStart);
    const start = Math.min(maxStart, Number(elements.clipStart.value || 0));
    elements.clipStart.value = String(start);
    elements.clipStartTime.textContent = formatTime(start);
    elements.clipEndTime.textContent = `to ${formatTime(start + duration)}`;
    drawCampaignFrame(0);
  }

  async function trackCampaignEvent(eventKind, platform = "halo", variant = "primary", campaignId = state.campaign?.id || campaignIdFromUrl()) {
    if (!campaignId) return;
    fetch("/api/dreamweaver-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ action: "track", campaignId, eventKind, platform, variant, sessionToken: state.sessionToken })
    }).catch(() => {});
  }

  function platformPostText(platform, card = elements.platformPackages.querySelector(`[data-platform-card="${platform}"]`)) {
    if (!card || !state.campaign) return "";
    const field = name => card.querySelector(`[data-package-field="${name}"]`)?.value.trim() || "";
    return [field("title"), field("caption"), field("hashtags"), field("description"), `Pinned comment: ${field("pinnedComment")}`, `Alt text: ${field("altText")}`, `${location.origin}${state.campaign.destinationUrl}&source=${platform}`].filter(Boolean).join("\n\n");
  }

  function renderPlatformPackages() {
    const platforms = state.campaign?.package?.platforms || {};
    elements.platformPackages.innerHTML = Object.entries(platforms).map(([platform, item]) => `
      <article class="platform-card ${platform === state.activePlatform ? "active" : ""}" data-platform-card="${escapeHtml(platform)}">
        <label class="platform-field"><span>Title <button type="button" data-copy-field="title">Copy</button></span><textarea data-package-field="title">${escapeHtml(item.title)}</textarea></label>
        <label class="platform-field"><span>Caption <button type="button" data-copy-field="caption">Copy</button></span><textarea data-package-field="caption">${escapeHtml(item.caption)}</textarea></label>
        <label class="platform-field"><span>Hashtags <button type="button" data-copy-field="hashtags">Copy</button></span><textarea data-package-field="hashtags">${escapeHtml((item.hashtags || []).join(" "))}</textarea></label>
        <label class="platform-field"><span>Description <button type="button" data-copy-field="description">Copy</button></span><textarea data-package-field="description">${escapeHtml(item.description)}</textarea></label>
        <label class="platform-field"><span>Pinned comment <button type="button" data-copy-field="pinnedComment">Copy</button></span><textarea data-package-field="pinnedComment">${escapeHtml(item.pinnedComment)}</textarea></label>
        <label class="platform-field"><span>Alt text <button type="button" data-copy-field="altText">Copy</button></span><textarea data-package-field="altText">${escapeHtml(item.altText)}</textarea></label>
        <p class="platform-note">${escapeHtml(item.postingNote)} The tracked destination is <strong>${escapeHtml(state.campaign.destinationUrl)}&amp;source=${escapeHtml(platform)}</strong>.</p>
        <div class="platform-footer"><button type="button" data-copy-platform="${escapeHtml(platform)}">Copy complete post</button><button type="button" data-publish-ready="${escapeHtml(platform)}">Mark ready to publish</button></div>
      </article>`).join("");
  }

  function renderCampaignScore() {
    const review = state.campaign?.recommendations;
    if (!review?.reviewedAt) {
      elements.campaignScore.hidden = true;
      return;
    }
    elements.campaignScore.hidden = false;
    elements.campaignScoreValue.textContent = String(review.score || 0);
    elements.campaignScoreGrade.textContent = review.grade || "Starting";
    elements.campaignScoreSummary.textContent = review.summary || "The campaign is collecting its first signals.";
    elements.campaignRecommendations.innerHTML = (review.recommendations || []).map(item => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function renderCampaignHistory() {
    elements.campaignHistory.innerHTML = state.campaigns.length ? state.campaigns.slice(0, 5).map(campaign => `
      <button class="history-signal" type="button" data-open-campaign="${escapeHtml(campaign.id)}"><span><strong>${escapeHtml(campaign.title)}</strong><br>${escapeHtml(campaign.template)} / ${campaign.clipDurationSeconds} sec</span><span>${campaign.performanceScore || 0}/100</span></button>`).join("") : "";
  }

  const buildStageOrder = ["gathering", "planning", "writing", "packaging", "ready"];
  const buildStageCopy = {
    queued: ["Opening the cutting room.", "The request is saved. Dreamweaver is starting the background campaign build."],
    gathering: ["Loading the source world.", "Dreamweaver is reading the YouTube signal and gathering approved HALO gallery records."],
    planning: ["Planning the creative cut.", "Choosing archive sections, collage rhythm, and the route into the full show."],
    writing: ["Writing the campaign signal.", "Gemma is shaping distinct TikTok, Instagram, and YouTube packages from verified facts."],
    packaging: ["Assembling every handoff.", "The shot plan, rights reminder, tracked destination, and platform copy are being joined."],
    ready: ["The campaign package is ready.", "The completed campaign is opening now."],
    failed: ["The campaign build stopped.", "No material was published. Start the build again when you are ready."]
  };

  function stopBuildPreview() {
    cancelAnimationFrame(state.buildPreviewFrame);
    state.buildPreviewFrame = 0;
  }

  function startBuildPreview() {
    stopBuildPreview();
    state.buildPreviewStartedAt = performance.now();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return drawCampaignFrame(.12);
    const frame = now => {
      const progress = ((now - state.buildPreviewStartedAt) % 7000) / 7000;
      drawCampaignFrame(progress);
      state.buildPreviewFrame = requestAnimationFrame(frame);
    };
    state.buildPreviewFrame = requestAnimationFrame(frame);
  }

  function showCampaignJob(job) {
    state.campaignJob = job;
    if (job.request?.youtubeSource?.url && !elements.campaignYoutubeUrl.value) elements.campaignYoutubeUrl.value = job.request.youtubeSource.url;
    elements.packageEmpty.hidden = true;
    elements.packageResults.hidden = true;
    elements.campaignBuildActivity.hidden = false;
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    const copy = buildStageCopy[job.stage] || buildStageCopy.queued;
    elements.campaignBuildPercent.textContent = `${progress}%`;
    elements.campaignBuildTitle.textContent = copy[0];
    elements.campaignBuildDetail.textContent = job.status === "failed" && job.errorMessage ? `${copy[1]} ${job.errorMessage}` : copy[1];
    elements.campaignBuildBar.style.width = `${progress}%`;
    elements.campaignBuildMeter.setAttribute("aria-valuenow", String(progress));
    const activeIndex = buildStageOrder.indexOf(job.stage);
    elements.campaignBuildStages.querySelectorAll("[data-build-stage]").forEach((item, index) => {
      item.classList.toggle("complete", activeIndex > index || job.stage === "ready");
      item.classList.toggle("active", activeIndex === index && job.status !== "failed");
    });
    if (job.status === "queued" || job.status === "working") {
      if (elements.campaignStudio.classList.contains("open") && !state.buildPreviewFrame) startBuildPreview();
    } else {
      stopBuildPreview();
    }
  }

  function scheduleCampaignJobPoll(jobId, delay = 1200) {
    window.clearTimeout(state.campaignJobTimer);
    state.campaignJobTimer = window.setTimeout(() => pollCampaignJob(jobId), delay);
  }

  async function pollCampaignJob(jobId) {
    try {
      const response = await fetch(`/api/dreamweaver-campaigns?jobId=${encodeURIComponent(jobId)}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The campaign build could not be read.");
      showCampaignJob(data.job);
      if (data.job.status === "ready" && data.job.campaign) {
        state.campaigns = [data.job.campaign, ...state.campaigns.filter(item => item.id !== data.job.campaign.id)];
        showCampaign(data.job.campaign);
        renderCampaignHistory();
        window.haloStats?.track("dreamweaver_campaign_generated", { mix_id: state.mix.id, campaign_id: data.job.campaign.id });
        showToast(data.job.usedFallback ? "Campaign completed with HALO's grounded fallback copy." : "Dreamweaver completed the campaign in the background.");
        return;
      }
      if (data.job.status === "failed") return;
      scheduleCampaignJobPoll(jobId);
    } catch (error) {
      showToast(error.message || "Dreamweaver is reconnecting to the campaign build.");
      scheduleCampaignJobPoll(jobId, 3000);
    }
  }

  function showCampaign(campaign) {
    state.campaign = campaign;
    state.campaignJob = null;
    window.clearTimeout(state.campaignJobTimer);
    stopBuildPreview();
    resetRenderedClip();
    elements.campaignBuildActivity.hidden = true;
    elements.packageEmpty.hidden = true;
    elements.packageResults.hidden = false;
    elements.packageTitle.textContent = campaign.package?.campaignTitle || campaign.title;
    elements.packageIdea.textContent = campaign.package?.campaignIdea || "A short doorway into the complete Dreamweaver show.";
    elements.clipStart.value = String(campaign.clipStartSeconds || 0);
    const durationInput = elements.campaignForm.querySelector(`input[name="clipDuration"][value="${campaign.clipDurationSeconds}"]`);
    if (durationInput) durationInput.checked = true;
    const templateInput = elements.campaignForm.querySelector(`input[name="template"][value="${campaign.template}"]`);
    if (templateInput) templateInput.checked = true;
    const productionPlan = campaign.package?.productionPlan || {};
    if (productionPlan.youtubeSource?.url) elements.campaignYoutubeUrl.value = productionPlan.youtubeSource.url;
    const treatmentInput = elements.campaignForm.querySelector(`input[name="visualTreatment"][value="${productionPlan.visualTreatment || "archive_reel"}"]`);
    if (treatmentInput) treatmentInput.checked = true;
    const sourceIds = new Set((productionPlan.sourceVideos || []).map(video => video.id));
    elements.footageSelector.querySelectorAll('input[name="sourceVideo"]').forEach(input => { input.checked = sourceIds.has(input.value); });
    elements.campaignGoal.value = campaign.goal || "full_mix_starts";
    elements.renderClip.disabled = false;
    renderPlatformPackages();
    renderCampaignScore();
    updateClipTiming();
  }

  async function loadCampaigns() {
    if (!state.mix) return;
    try {
      const response = await fetch(`/api/dreamweaver-campaigns?mixId=${encodeURIComponent(state.mix.id)}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      state.campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
      renderCampaignHistory();
      const activeJob = Array.isArray(data.jobs) ? data.jobs[0] : null;
      if (activeJob) {
        showCampaignJob(activeJob);
        scheduleCampaignJobPoll(activeJob.id, 100);
      }
    } catch {}
  }

  async function openCampaignStudio() {
    if (!state.mix) return showToast("Open a playable mix before creating a campaign.");
    elements.audio.pause();
    elements.campaignStudio.classList.add("open");
    elements.campaignStudio.setAttribute("aria-hidden", "false");
    document.body.classList.add("campaign-open");
    const suggested = Math.max(0, Math.min(state.duration - selectedDuration(), elements.audio.currentTime || chapters[state.activeChapter].start * state.duration));
    elements.clipStart.value = String(Math.floor(suggested));
    await preloadCampaignImages();
    await loadCampaigns();
    updateClipTiming();
    window.haloStats?.track("open_dreamweaver_campaign_studio", { mix_id: state.mix.id });
    elements.closeCampaign.focus();
  }

  function closeCampaignStudio() {
    stopBuildPreview();
    elements.campaignStudio.classList.remove("open");
    elements.campaignStudio.setAttribute("aria-hidden", "true");
    document.body.classList.remove("campaign-open");
    elements.makeCampaign.focus();
  }

  async function generateCampaign(event) {
    event.preventDefault();
    if (!state.mix) return;
    const youtubeUrl = elements.campaignYoutubeUrl.value.trim();
    if (!youtubeUrl) return elements.campaignYoutubeUrl.focus();
    elements.generateCampaign.disabled = true;
    elements.generateCampaign.querySelector("strong").textContent = "Dreamweaver is gathering everything…";
    try {
      const response = await fetch("/api/dreamweaver-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "start",
          mixId: state.mix.id,
          youtubeUrl,
          clipStartSeconds: Number(elements.clipStart.value || 0),
          clipDurationSeconds: selectedDuration(),
          template: selectedTemplate(),
          visualTreatment: selectedVisualTreatment(),
          goal: elements.campaignGoal.value,
          headline: elements.campaignHeadline.value.trim(),
          sourceVideoIds: elements.campaignAdvanced.open ? selectedSourceVideos().map(video => video.id) : []
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The campaign package could not be created.");
      showCampaignJob(data.job);
      scheduleCampaignJobPoll(data.job.id, 500);
      showToast("One-click build started. Dreamweaver is gathering your YouTube signal and HALO gallery.");
    } catch (error) {
      showToast(error.message || "Dreamweaver could not create the campaign.");
    } finally {
      elements.generateCampaign.disabled = false;
      elements.generateCampaign.querySelector("strong").textContent = "Load it. Shape it. Send it.";
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slug(value) {
    return String(value || "dreamweaver").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "dreamweaver";
  }

  function downloadCover() {
    drawCampaignFrame(0);
    elements.campaignCanvas.toBlob(blob => {
      if (blob) downloadBlob(blob, `${slug(state.mix?.title)}-dreamweaver-cover.png`);
    }, "image/png");
  }

  function downloadCampaignPackage() {
    if (!state.campaign) return;
    const lines = [
      state.campaign.package.campaignTitle,
      state.campaign.package.campaignIdea,
      `Tracked destination: ${location.origin}${state.campaign.destinationUrl}`,
      ...Object.keys(state.campaign.package.platforms || {}).flatMap(platform => [`\n=== ${platform.toUpperCase()} ===\n`, platformPostText(platform)]),
      "\n=== RIGHTS CHECK ===\n",
      ...(state.campaign.package.rightsChecklist || []).map(item => `- ${item}`)
    ];
    downloadBlob(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }), `${slug(state.campaign.title)}-campaign-package.txt`);
    trackCampaignEvent("downloaded");
    showToast("Complete campaign package downloaded.");
  }

  async function renderVerticalClip() {
    if (!state.campaign || !state.mix || elements.renderClip.disabled) return;
    if (!window.MediaRecorder || !elements.campaignCanvas.captureStream) {
      setRenderStatus("error", "Film creation is not supported", "Use a current Chrome, Edge, Firefox, or Safari browser, or download the cover and campaign package instead.");
      return showToast("This browser cannot render video. Download the cover and campaign package instead.");
    }
    resetRenderedClip();
    elements.renderClip.disabled = true;
    elements.renderClip.textContent = "Creating film…";
    elements.renderCurtain.hidden = false;
    elements.renderCurtain.setAttribute("aria-busy", "true");
    setRenderProgress(0, "Preparing the selected passage…", "Loading audio and painting the first video frame.");
    setRenderStatus("working", "Creating your film", "Preparing audio and video. Progress appears over the preview.");
    let audioContext;
    let exportAudio;
    let stream;
    try {
      exportAudio = new Audio();
      exportAudio.preload = "auto";
      exportAudio.src = state.mix.audioUrl;
      await new Promise((resolve, reject) => {
        exportAudio.addEventListener("loadedmetadata", resolve, { once: true });
        exportAudio.addEventListener("error", () => reject(new Error("The mix audio could not be prepared for rendering.")), { once: true });
      });
      const start = Number(elements.clipStart.value || 0);
      const duration = selectedDuration();
      exportAudio.currentTime = start;
      await new Promise(resolve => exportAudio.addEventListener("seeked", resolve, { once: true }));
      await prepareCampaignVideos();
      drawCampaignFrame(0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
      const source = audioContext.createMediaElementSource(exportAudio);
      const audioDestination = audioContext.createMediaStreamDestination();
      source.connect(audioDestination);
      stream = elements.campaignCanvas.captureStream(30);
      audioDestination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      const mimeType = ["video/mp4;codecs=h264,aac", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(type => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 7_000_000 } : { videoBitsPerSecond: 7_000_000 });
      const chunks = [];
      recorder.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
      const stopped = new Promise(resolve => recorder.addEventListener("stop", resolve, { once: true }));
      recorder.start(1000);
      await exportAudio.play();
      const startedAt = performance.now();
      await new Promise(resolve => {
        const frame = () => {
          const elapsed = Math.min(duration, Math.max(0, exportAudio.currentTime - start || (performance.now() - startedAt) / 1000));
          const progress = Math.min(1, elapsed / duration);
          drawCampaignFrame(progress);
          const percent = Math.round(progress * 100);
          setRenderProgress(percent, `Creating film — ${percent}%`, `${Math.max(0, Math.ceil(duration - elapsed))} seconds of the selected passage remaining.`);
          setRenderStatus("working", `Creating your film — ${percent}%`, "Keep this page open. Download stays locked until the complete file passes its readiness check.");
          if (progress >= 1 || exportAudio.ended) return resolve();
          requestAnimationFrame(frame);
        };
        frame();
      });
      exportAudio.pause();
      recorder.stop();
      await stopped;
      const type = recorder.mimeType || mimeType || "video/webm";
      const extension = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type });
      if (blob.size < 1024) throw new Error("The browser returned an empty film. Nothing was downloaded; please create it again.");
      state.renderedClip = {
        blob,
        filename: `${slug(state.mix.title)}-dreamweaver-${selectedTemplate()}-${selectedDuration()}s.${extension}`
      };
      elements.downloadClip.disabled = false;
      setRenderProgress(100, "Film ready", "The complete video file passed its readiness check.");
      setRenderStatus("ready", "Film ready to download", `${selectedDuration()}-second ${extension.toUpperCase()} created successfully. Press Download film when you are ready.`);
      await trackCampaignEvent("rendered");
      showToast("Film created successfully. Download film is now ready.");
    } catch (error) {
      state.renderedClip = null;
      elements.downloadClip.disabled = true;
      setRenderStatus("error", "Film was not created", error.message || "The browser could not finish the video file. Please try again.");
      showToast(error.message || "The vertical clip could not be rendered in this browser.");
    } finally {
      exportAudio?.pause();
      stopCampaignVideos();
      stream?.getTracks().forEach(track => track.stop());
      audioContext?.close().catch(() => {});
      elements.renderCurtain.setAttribute("aria-busy", "false");
      state.renderCurtainTimer = window.setTimeout(() => {
        elements.renderCurtain.hidden = true;
        state.renderCurtainTimer = 0;
      }, state.renderedClip ? 900 : 0);
      elements.renderClip.disabled = !state.campaign;
      elements.renderClip.textContent = state.renderedClip ? "Create film again" : "Create vertical film";
      drawCampaignFrame(0);
    }
  }

  function downloadRenderedClip() {
    if (!state.renderedClip?.blob?.size) {
      setRenderStatus("error", "No finished film to download", "Create the film and wait for the ready confirmation before downloading.");
      return showToast("Create the film before downloading it.");
    }
    downloadBlob(state.renderedClip.blob, state.renderedClip.filename);
    setRenderStatus("ready", "Film download started", `${state.renderedClip.filename} is being saved to your device.`);
    showToast("Finished film download started.");
  }

  async function reviewCampaign() {
    if (!state.campaign) return;
    elements.reviewCampaign.disabled = true;
    try {
      const response = await fetch("/api/dreamweaver-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "review", campaignId: state.campaign.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The campaign review could not be completed.");
      state.campaigns = state.campaigns.map(item => item.id === data.campaign.id ? data.campaign : item);
      showCampaign(data.campaign);
      renderCampaignHistory();
      showToast("Gemma reviewed the campaign evidence.");
    } catch (error) {
      showToast(error.message || "Gemma could not review this campaign.");
    } finally {
      elements.reviewCampaign.disabled = false;
    }
  }

  async function loadVideos() {
    try {
      const response = await fetch("/api/videos?artistSlug=owen-anthony", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      state.videos = Array.isArray(data.videos) ? data.videos.slice(0, 8) : [];
      renderFootageSelector();
      renderArchive();
    } catch {}
  }

  function renderFootageSelector() {
    if (!state.videos.length) {
      elements.footageSelector.innerHTML = '<p class="footage-empty">No published HALO video records are connected yet. Dreamweaver uses the approved chapter artwork instead.</p>';
      return;
    }
    elements.footageSelector.innerHTML = state.videos.map((video, index) => `
      <label class="footage-card">
        <input type="checkbox" name="sourceVideo" value="${escapeHtml(video.id)}" ${index < 4 ? "checked" : ""}>
        <img src="${escapeHtml(video.thumbnailUrl || "/assets/halo-logo-mark.webp")}" alt="">
        <span>${escapeHtml(video.title)}<small>${video.sourceType === "upload" ? "Film source" : "Reference only"}</small></span>
      </label>`).join("");
  }

  function renderArchive() {
    if (!state.videos.length) {
      elements.archiveReel.innerHTML = `<a class="archive-card" href="/artists/owen-anthony"><img src="/assets/releases/the-cold-is-lasting-longer.jpg" alt=""><span>Enter Owen Anthony's connected artist room</span></a><a class="archive-card" href="/radio/"><img src="/assets/artists/owen-anthony-glass-house.webp" alt=""><span>Continue into the HALO radio signal</span></a>`;
      return;
    }
    elements.archiveReel.innerHTML = state.videos.map(video => `<a class="archive-card" href="${escapeHtml(video.sourceUrl || video.embedUrl || "/artists/owen-anthony")}" ${video.sourceType === "youtube" ? 'target="_blank" rel="noopener noreferrer"' : ""}><img src="${escapeHtml(video.thumbnailUrl || "/assets/halo-logo-mark.webp")}" alt=""><span>${escapeHtml(video.title)}</span></a>`).join("");
  }

  function showEmpty(message) {
    elements.shell.hidden = false;
    elements.loading.hidden = true;
    elements.stage.hidden = true;
    elements.empty.hidden = false;
    elements.emptyMessage.textContent = message;
    elements.shell.setAttribute("aria-busy", "false");
  }

  async function loadShow() {
    elements.shell.hidden = false;
    elements.loading.hidden = false;
    elements.stage.hidden = true;
    elements.empty.hidden = true;
    elements.shell.setAttribute("aria-busy", "true");
    try {
      const requestedMix = new URLSearchParams(location.search).get("mix") || "";
      const response = await fetch("/api/mixes?limit=100", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The Mix Desk library could not be read.");
      const playable = (data.mixes || []).filter(mix => mix.audioUrl && mix.source !== "youtube");
      const mix = playable.find(item => item.id === requestedMix) || playable[0];
      if (!mix) return showEmpty("No playable audio mix is available yet. Post the existing set to the HALO room or sign in to open a private mix.");
      state.mix = mix;
      state.duration = Number(mix.durationSeconds || 0);
      elements.audio.src = mix.audioUrl;
      elements.mixTitle.textContent = mix.title || "Untitled HALO mix";
      elements.mixCreator.textContent = `${mix.creator?.name || "Owen Anthony"} / ${mix.trackCount || "DJ"} ${mix.trackCount === 1 ? "track" : "tracks"}`;
      elements.duration.textContent = formatTime(state.duration);
      document.title = `${mix.title || "Dreamweaver Show"} — HALO`;
      const currentParams = new URLSearchParams(location.search);
      currentParams.set("mix", mix.id);
      history.replaceState(null, "", `/dreamweaver/?${currentParams.toString()}`);
      elements.loading.hidden = true;
      elements.stage.hidden = false;
      elements.shell.setAttribute("aria-busy", "false");
      updatePlatformLinks();
      await loadVideos();
      if (campaignIdFromUrl() && !state.trackedProgress.has("landing")) {
        state.trackedProgress.add("landing");
        trackCampaignEvent("landing", currentParams.get("source") || "halo");
      }
      window.haloStats?.track("open_dreamweaver_show", { mix_id: mix.id, mix_title: mix.title || "" });
      if (state.startPlaybackAfterLoad) {
        state.startPlaybackAfterLoad = false;
        try { await elements.audio.play(); } catch {}
      }
    } catch (error) {
      state.startPlaybackAfterLoad = false;
      showEmpty(error.message || "Dreamweaver could not open the mix right now.");
    }
  }

  async function initializeDreamweaver() {
   renderSatelliteState();
   updatePlatformLinks();
   if (isSatelliteFlow() && !state.unlock) {
     elements.shell.setAttribute("aria-busy", "false");
     return;
   }
   await loadShow();
  }

  buildExperience();
  renderFootageSelector();
  renderArchive();
  elements.playButton.addEventListener("click", togglePlayback);
  elements.progress.addEventListener("input", () => {
    if (!state.duration) return;
    elements.audio.currentTime = Number(elements.progress.value) / 1000 * state.duration;
    updateProgress();
  });
  elements.audio.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(elements.audio.duration)) state.duration = elements.audio.duration;
    updateProgress();
  });
  elements.audio.addEventListener("timeupdate", updateProgress);
  elements.audio.addEventListener("play", () => {
    document.body.classList.add("is-playing");
    elements.playButton.setAttribute("aria-label", "Pause show");
    resetIdle();
    if (campaignIdFromUrl() && !state.trackedProgress.has("show_play")) {
      state.trackedProgress.add("show_play");
      trackCampaignEvent("show_play", new URLSearchParams(location.search).get("source") || "halo");
    }
  });
  elements.audio.addEventListener("pause", () => { document.body.classList.remove("is-playing"); elements.playButton.setAttribute("aria-label", "Play show"); document.body.classList.remove("idle"); });
  elements.audio.addEventListener("ended", () => {
    activateChapter(chapters.length - 1, false);
    if (campaignIdFromUrl() && !state.trackedProgress.has("mix_complete")) {
      state.trackedProgress.add("mix_complete");
      trackCampaignEvent("mix_complete", new URLSearchParams(location.search).get("source") || "halo");
    }
  });
  elements.audio.addEventListener("error", () => showToast("The mix audio is unavailable. The visual edition remains open."));
  elements.muteButton.addEventListener("click", () => { elements.audio.muted = !elements.audio.muted; elements.muteButton.setAttribute("aria-label", elements.audio.muted ? "Unmute show" : "Mute show"); showToast(elements.audio.muted ? "Show muted" : "Sound restored"); });
  elements.fullScreenButton.addEventListener("click", async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await elements.stage.requestFullscreen(); } catch { showToast("Full screen is not available in this browser."); } });
  elements.shareShow.addEventListener("click", async () => { const shareData = { title: document.title, text: "Enter this HALO Dreamweaver visual mix experience.", url: location.href }; try { if (navigator.share) await navigator.share(shareData); else { await navigator.clipboard.writeText(location.href); showToast("Dreamweaver show link copied."); } } catch {} });
  elements.makeCampaign.addEventListener("click", openCampaignStudio);
  elements.closeCampaign.addEventListener("click", closeCampaignStudio);
  elements.campaignForm.addEventListener("submit", generateCampaign);
  elements.campaignForm.addEventListener("input", updateClipTiming);
  elements.renderClip.addEventListener("click", renderVerticalClip);
  elements.downloadClip.addEventListener("click", downloadRenderedClip);
  elements.downloadCover.addEventListener("click", downloadCover);
  elements.downloadPackage.addEventListener("click", downloadCampaignPackage);
  elements.reviewCampaign.addEventListener("click", reviewCampaign);
  elements.unlockForm?.addEventListener("submit", unlockDreamweaver);
  elements.startDreamweaverShow?.addEventListener("click", startUnlockedShow);
  document.querySelectorAll("[data-platform-tab]").forEach(button => button.addEventListener("click", () => {
    state.activePlatform = button.dataset.platformTab;
    document.querySelectorAll("[data-platform-tab]").forEach(tab => tab.setAttribute("aria-selected", String(tab === button)));
    elements.platformPackages.querySelectorAll("[data-platform-card]").forEach(card => card.classList.toggle("active", card.dataset.platformCard === state.activePlatform));
  }));
  elements.platformPackages.addEventListener("click", async event => {
    const card = event.target.closest("[data-platform-card]");
    if (!card) return;
    const platform = card.dataset.platformCard;
    const fieldButton = event.target.closest("[data-copy-field]");
    const platformButton = event.target.closest("[data-copy-platform]");
    const readyButton = event.target.closest("[data-publish-ready]");
    try {
      if (fieldButton) {
        const value = card.querySelector(`[data-package-field="${fieldButton.dataset.copyField}"]`)?.value || "";
        await navigator.clipboard.writeText(value);
        trackCampaignEvent("copied", platform, fieldButton.dataset.copyField);
        showToast(`${fieldButton.dataset.copyField} copied for ${platform}.`);
      } else if (platformButton) {
        await navigator.clipboard.writeText(platformPostText(platform, card));
        trackCampaignEvent("copied", platform, "complete");
        showToast(`Complete ${platform} post copied.`);
      } else if (readyButton) {
        trackCampaignEvent("publish_ready", platform);
        readyButton.textContent = "Ready / recorded";
        showToast(`${platform} package marked ready to publish.`);
      }
    } catch {
      showToast("Copying is unavailable. Select the text manually.");
    }
  });
  elements.campaignHistory.addEventListener("click", event => {
    const button = event.target.closest("[data-open-campaign]");
    const campaign = state.campaigns.find(item => item.id === button?.dataset.openCampaign);
    if (campaign) showCampaign(campaign);
  });
  elements.openStory.addEventListener("click", openStory);
  elements.closeStory.addEventListener("click", closeStory);
  elements.retry.addEventListener("click", loadShow);
  document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.mode)));
  ["mousemove", "pointerdown", "touchstart", "keydown"].forEach(eventName => document.addEventListener(eventName, resetIdle, { passive: true }));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && elements.campaignStudio.classList.contains("open")) return closeCampaignStudio();
    if (event.key === "Escape" && elements.drawer.classList.contains("open")) closeStory();
    if (event.code === "Space" && !["INPUT", "BUTTON", "A"].includes(document.activeElement?.tagName)) { event.preventDefault(); togglePlayback(); }
    if (event.key === "ArrowRight") activateChapter(state.activeChapter + 1, true);
    if (event.key === "ArrowLeft") activateChapter(state.activeChapter - 1, true);
  });
  initializeDreamweaver();
})();
