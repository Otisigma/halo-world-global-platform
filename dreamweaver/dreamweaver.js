(() => {
  const chapters = [
    {
      number: "I",
      label: "The Hook",
      kicker: "Act I / Emotional origin",
      title: "Before the chorus, there was a reason to stay.",
      copy: "Dreamweaver opens with the feeling that started the song: quiet tension, held breath, and the sense that the artist is letting a private thought become public one frame at a time.",
      note: "Keep the first act intimate. This is the emotional origin story, so the visuals should feel patient, human, and close enough for listeners to trust the room.",
      source: "Dreamweaver Song Lobby / emotional origin artwork direction.",
      image: "/assets/releases/the-cold-is-lasting-longer.jpg",
      wash: "linear-gradient(125deg, rgba(26,45,49,.7), rgba(71,28,16,.42) 62%, rgba(6,8,8,.9))",
      start: 0
    },
    {
      number: "II",
      label: "Lyric Break",
      kicker: "Act II / Editorial typography",
      title: "The lines hit harder when the room makes space for them.",
      copy: "The lobby slows down long enough for lyric fragments to land like diary margins: not a wall of text, but a few precise phrases that let listeners feel the ache, the promise, and the afterglow.",
      note: "Treat the type like a close-up. This act is about lyrical emphasis, Dreamweaver commentary, and keeping every word legible enough to feel intentional.",
      source: "Dreamweaver Song Lobby / featured lyric break.",
      image: "/assets/artists/owen-anthony-quicksand.jpg",
      wash: "linear-gradient(120deg, rgba(53,25,13,.82), rgba(91,65,37,.35) 48%, rgba(13,12,10,.9))",
      start: .26
    },
    {
      number: "III",
      label: "Sonic World",
      kicker: "Act III / Mood and setting",
      title: "Now the atmosphere tells listeners how to enter the song.",
      copy: "Dreamweaver turns the production into a lived-in world: low-end pressure, suspended keys, midnight air, and the kind of environment that sounds best when the listener gives it a room of its own.",
      note: "Describe mood, instrumentation, and listening environment in human language. This act should guide the ear without drifting into technical mix talk.",
      source: "Dreamweaver Song Lobby / sonic world treatment.",
      image: "/assets/artists/owen-anthony-glass-house.webp",
      wash: "linear-gradient(118deg, rgba(9,21,28,.7), rgba(30,67,72,.3) 50%, rgba(7,8,9,.92))",
      start: .54
    },
    {
      number: "IV",
      label: "Open Door",
      kicker: "Act IV / Unlock and action",
      title: "The story opens outward without dropping the mood.",
      copy: "By the end of the lobby, listeners know where to go next: start the full experience, move into streaming, or step quietly into the creator deck without crowding the fan-first presentation.",
      note: "End with a clear doorway. The final act should unlock action while keeping the main room centered on general listeners instead of production controls.",
      source: "Dreamweaver Song Lobby / unlock pathway direction.",
      image: "/assets/releases/hit-that-beat.webp",
      wash: "linear-gradient(130deg, rgba(103,20,42,.48), rgba(230,89,29,.34) 48%, rgba(18,10,10,.88))",
      start: .78
    }
  ];

  const featuredTrack = Object.freeze({
    title: "Blessed",
    artist: "Owen Anthony",
    url: "https://distrokid.com/hyperfollow/owenanthony/blessed"
  });
  const uploadTrustStorageKey = "halo-dreamweaver-upload-trust";
  const approvedUploadReturnPaths = new Set(["/dreamweaver-lab/", "/dreamweaver-lab/index.html"]);
  const MIX_LIBRARY_TIMEOUT_MS = 12000;
  const RELEASE_CONTEXT_TIMEOUT_MS = 8000;
  const VIDEO_LIBRARY_TIMEOUT_MS = 8000;
  const AUDIO_BOOTSTRAP_TIMEOUT_MS = 15000;
  const MAX_AUDIO_FEEDBACK_RECORDS = 24;
  const SATELLITE_AGENT_REFRESH_MS = 45_000;
  const DREAMWEAVER_RELEASE_FALLBACK_ARTWORK = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK || "/assets/releases/halo-premium-placeholder.svg";
  const audioFeedbackStorageKey = "halo:dreamweaver-audio-feedback";

  const elements = {
    songLabLink: document.getElementById("dreamweaverSongLabLink"),
    satellite: document.getElementById("dreamweaverSatellite"),
    unlockForm: document.getElementById("dreamweaverUnlockForm"),
    unlockStatus: document.getElementById("dreamweaverUnlockStatus"),
    reward: document.getElementById("dreamweaverReward"),
    rewardCopy: document.getElementById("dreamweaverRewardCopy"),
    startDreamweaverShow: document.getElementById("startDreamweaverShow"),
    spotifyLink: document.getElementById("dreamweaverSpotifyLink"),
    appleLink: document.getElementById("dreamweaverAppleLink"),
    youtubeLink: document.getElementById("dreamweaverYouTubeLink"),
    sourceLink: document.getElementById("dreamweaverSourceLink"),
    lobbyArtwork: document.getElementById("lobbyArtwork"),
    lobbyArtworkCaption: document.getElementById("lobbyArtworkCaption"),
    heroReelPlayer: document.getElementById("heroReelPlayer"),
    heroReelFallback: document.getElementById("heroReelFallback"),
    heroReelStatus: document.getElementById("heroReelStatus"),
    songLobbyMakeCampaign: document.getElementById("songLobbyMakeCampaign"),
    creatorGatewayLink: document.getElementById("dreamweaverCreatorGateway"),
    shell: document.getElementById("showShell"),
    loading: document.getElementById("loadingShow"),
    loadingPhase: document.getElementById("loadingPhase"),
    loadingMeterBar: document.getElementById("loadingMeterBar"),
    loadingProgress: document.getElementById("loadingProgress"),
    loadingSubtitle: document.getElementById("loadingSubtitle"),
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
    releasePanel: document.getElementById("releasePanel"),
    releasePanelKicker: document.getElementById("releasePanelKicker"),
    releaseTitle: document.getElementById("releaseTitle"),
    releaseSubtitle: document.getElementById("releaseSubtitle"),
    releaseArtwork: document.getElementById("releaseArtwork"),
    releaseFacts: document.getElementById("releaseFacts"),
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
    release: null,
    releasePlaybackState: "loading",
    publishedSongId: resolveSongContextId(),
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
    audioFeedbackQueue: [],
    audioFeedbackFingerprints: new Set(),
    audioFeedbackFlushPromise: null,
    satelliteAgentLoop: { timer: 0, loopId: "", updateIntervalMs: SATELLITE_AGENT_REFRESH_MS, lastUpdatedAt: "", lastError: "" },
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

  function cleanText(value, limit = 120) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
  }

  function cleanSongId(value) {
    const songId = cleanText(value, 60).toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(songId) ? songId : "";
  }

  function readAudioFeedbackQueue() {
    try {
      const parsed = JSON.parse(localStorage.getItem(audioFeedbackStorageKey) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(entry => ({
          id: cleanText(entry?.id, 120),
          kind: cleanText(entry?.kind, 60),
          severity: cleanText(entry?.severity, 24) || "medium",
          title: cleanText(entry?.title, 180),
          details: cleanText(entry?.details, 1200),
          pagePath: cleanText(entry?.pagePath, 320) || "/dreamweaver/",
          mixId: cleanText(entry?.mixId, 120),
          songId: cleanSongId(entry?.songId),
          fingerprint: cleanText(entry?.fingerprint, 500),
          createdAt: cleanText(entry?.createdAt, 80),
          lastAttemptAt: cleanText(entry?.lastAttemptAt, 80),
          deliveryStatus: cleanText(entry?.deliveryStatus, 24) || "queued",
          metadata: entry?.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {}
        }))
        .filter(entry => entry.fingerprint && entry.title);
    } catch {
      return [];
    }
  }

  function writeAudioFeedbackQueue(records) {
    try {
      localStorage.setItem(audioFeedbackStorageKey, JSON.stringify(records.slice(0, MAX_AUDIO_FEEDBACK_RECORDS)));
    } catch {}
  }

  function hydrateAudioFeedbackQueue() {
    state.audioFeedbackQueue = readAudioFeedbackQueue();
    state.audioFeedbackFingerprints = new Set(state.audioFeedbackQueue.map(entry => entry.fingerprint));
  }

  function patchAudioFeedbackRecord(fingerprint, patch = {}) {
    if (!fingerprint) return;
    state.audioFeedbackQueue = state.audioFeedbackQueue.map(entry => entry.fingerprint === fingerprint ? { ...entry, ...patch } : entry);
    writeAudioFeedbackQueue(state.audioFeedbackQueue);
  }

  function queueAudioFeedbackIncident(kind, {
    severity = "medium",
    title = "Dreamweaver audio issue detected",
    details = "Dreamweaver detected an audio issue while bootstrapping playback.",
    mix = state.mix,
    metadata = {},
    fingerprint = ""
  } = {}) {
    const normalizedFingerprint = cleanText(
      fingerprint || [
        kind,
        cleanText(mix?.id, 120),
        cleanSongId(state.publishedSongId),
        cleanText(location.pathname, 160),
        cleanText(details, 240)
      ].join("|"),
      500
    );
    if (!normalizedFingerprint || state.audioFeedbackFingerprints.has(normalizedFingerprint)) return null;

    const incident = {
      id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: cleanText(kind, 60),
      severity: cleanText(severity, 24) || "medium",
      title: cleanText(title, 180),
      details: cleanText(details, 1200),
      pagePath: cleanText(`${location.pathname}${location.search}`, 320) || "/dreamweaver/",
      mixId: cleanText(mix?.id, 120),
      songId: cleanSongId(state.publishedSongId),
      fingerprint: normalizedFingerprint,
      createdAt: new Date().toISOString(),
      lastAttemptAt: "",
      deliveryStatus: "queued",
      metadata: {
        mixTitle: cleanText(mix?.title, 160),
        mixSource: cleanText(mix?.source, 60) || "audio",
        muted: Boolean(elements.audio?.muted),
        volume: Number.isFinite(elements.audio?.volume) ? Number(elements.audio.volume) : 1,
        sessionToken: cleanText(state.sessionToken, 120),
        ...metadata
      }
    };

    state.audioFeedbackFingerprints.add(normalizedFingerprint);
    state.audioFeedbackQueue = [incident, ...state.audioFeedbackQueue].slice(0, MAX_AUDIO_FEEDBACK_RECORDS);
    writeAudioFeedbackQueue(state.audioFeedbackQueue);
    window.dispatchEvent(new CustomEvent("halo:journal-event", {
      detail: {
        eventType: "qa_issue",
        category: "problem",
        targetName: "dreamweaver-audio",
        details: {
          kind: incident.kind,
          severity: incident.severity,
          mixId: incident.mixId || null,
          deliveryStatus: incident.deliveryStatus
        },
        immediate: true
      }
    }));
    void flushQueuedAudioFeedback();
    return incident;
  }

  async function sendAudioFeedbackIncident(incident) {
    if (!incident?.fingerprint) return;
    const nextAttemptAt = new Date().toISOString();
    patchAudioFeedbackRecord(incident.fingerprint, { lastAttemptAt: nextAttemptAt, deliveryStatus: "sending" });
    try {
      const response = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          source: "browser",
          category: "dreamweaver-audio",
          severity: incident.severity,
          title: incident.title,
          details: incident.details,
          pagePath: incident.pagePath || location.pathname,
          fingerprint: incident.fingerprint,
          metadata: incident.metadata
        })
      });
      if (!response.ok) throw new Error(`Issue endpoint returned ${response.status}`);
      patchAudioFeedbackRecord(incident.fingerprint, { deliveryStatus: "sent" });
    } catch {
      patchAudioFeedbackRecord(incident.fingerprint, { deliveryStatus: "queued" });
    }
  }

  async function flushQueuedAudioFeedback() {
    if (state.audioFeedbackFlushPromise) return state.audioFeedbackFlushPromise;
    state.audioFeedbackFlushPromise = (async () => {
      const flushStartedAt = Date.now();
      const seenFingerprints = new Set();
      try {
        const pending = [];
        for (const entry of state.audioFeedbackQueue) {
          if (
            entry.deliveryStatus === "sent"
            || seenFingerprints.has(entry.fingerprint)
            || (
              entry.lastAttemptAt
              && !Number.isNaN(Date.parse(entry.lastAttemptAt))
              && Date.parse(entry.lastAttemptAt) >= flushStartedAt
            )
          ) {
            continue;
          }
          seenFingerprints.add(entry.fingerprint);
          pending.push(entry);
        }
        for (const incident of pending) {
          await sendAudioFeedbackIncident(incident);
        }
      } finally {
        state.audioFeedbackFlushPromise = null;
      }
    })();
    return state.audioFeedbackFlushPromise;
  }

  function songIdFromSatellitePath(pathname = location.pathname) {
    const match = String(pathname || "").match(/^\/dreamweaver\/satellite\/([0-9a-f-]{36})\/?$/i);
    return cleanSongId(match?.[1] || "");
  }

  function resolveSongContextId() {
    const params = new URLSearchParams(location.search);
    return cleanSongId(params.get("song")) || songIdFromSatellitePath();
  }

  function isSatellitePath() {
    return Boolean(songIdFromSatellitePath());
  }

  function releaseDateLabel(value) {
    const text = cleanText(value, 120);
    if (!text) return "";
    const direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return "";
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }

  function safeMediaUrl(value) {
    const text = cleanText(value, 1200);
    if (!text) return "";
    try {
      const url = new URL(text, location.origin);
      if (!/^https?:$/.test(url.protocol)) return "";
      if (url.protocol === "http:" && url.origin !== location.origin) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function preferredHeroVideo() {
    return state.videos.find(video => safeMediaUrl(video?.embedUrl)) || state.videos.find(video => safeMediaUrl(video?.sourceUrl)) || null;
  }

  async function fetchJsonWithTimeout(url, { timeoutMs = 8000, timeoutMessage = "Request timed out.", ...options } = {}) {
    const supportsAbortController = typeof AbortController === "function";
    const controller = supportsAbortController ? new AbortController() : null;
    const timeoutId = window.setTimeout(() => controller?.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {})
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(timeoutMessage);
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function isPlayablePrimaryMix(mix) {
    const source = cleanText(mix?.source, 60).toLowerCase();
    return Boolean(cleanText(mix?.audioUrl, 1200)) && source !== "youtube";
  }

  function resolvePrimaryPlaybackMix(mixes = [], requestedMixId = "") {
    const requested = cleanText(requestedMixId, 120);
    const library = Array.isArray(mixes) ? mixes : [];
    const requestedEntry = requested ? library.find(item => cleanText(item?.id, 120) === requested) : null;
    if (isPlayablePrimaryMix(requestedEntry)) return requestedEntry;

    if (requestedEntry && !cleanText(requestedEntry.audioUrl, 1200)) {
      queueAudioFeedbackIncident("missing_audio", {
        severity: "high",
        title: "Dreamweaver primary mix is missing audio",
        details: `The requested mix ${requestedEntry.id || requested} does not have a playable audio source.`,
        mix: requestedEntry,
        metadata: { requestedMixId: requested, failureState: "missing_audio" }
      });
    } else if (requestedEntry && !isPlayablePrimaryMix(requestedEntry)) {
      queueAudioFeedbackIncident("non_playable_audio", {
        severity: "medium",
        title: "Dreamweaver requested mix is not directly playable",
        details: `The requested mix ${requestedEntry.id || requested} resolves to a non-audio source and cannot bootstrap the primary player.`,
        mix: requestedEntry,
        metadata: { requestedMixId: requested, failureState: "non_playable_audio", source: requestedEntry.source }
      });
    }

    if (requested && requestedEntry) return null;
    return library.find(isPlayablePrimaryMix) || null;
  }

  function describeAudioElementFailure() {
    const code = Number(elements.audio?.error?.code || 0);
    if (code === 1) return "The audio bootstrap was interrupted before Dreamweaver could start playback.";
    if (code === 2) return "The linked audio file could not be downloaded.";
    if (code === 3) return "The linked audio file appears corrupted or could not be decoded.";
    if (code === 4) return "The linked audio format is not supported for Dreamweaver playback.";
    return "Dreamweaver could not prepare the linked audio for playback.";
  }

  async function awaitPrimaryPlaybackReadiness() {
    if (elements.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return { ok: true, state: "ready" };
    return new Promise(resolve => {
      let settled = false;
      let metadataConfirmed = elements.audio.readyState >= HTMLMediaElement.HAVE_METADATA;
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        elements.audio.removeEventListener("loadedmetadata", handleMetadata);
        elements.audio.removeEventListener("loadeddata", handleReady);
        elements.audio.removeEventListener("canplay", handleReady);
        elements.audio.removeEventListener("canplaythrough", handleReady);
        elements.audio.removeEventListener("error", handleError);
      };
      const settle = result => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const handleMetadata = () => {
        metadataConfirmed = true;
        if (elements.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) handleReady();
      };
      const handleReady = () => settle({ ok: true, state: "ready" });
      const handleError = () => settle({ ok: false, state: "error", detail: describeAudioElementFailure() });
      const timeoutId = window.setTimeout(() => {
        if (metadataConfirmed || elements.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
          settle({ ok: true, state: "metadata-ready" });
          return;
        }
        settle({ ok: false, state: "timeout", detail: "Dreamweaver waited too long for the linked audio to become playable." });
      }, AUDIO_BOOTSTRAP_TIMEOUT_MS);
      elements.audio.addEventListener("loadedmetadata", handleMetadata, { once: true });
      elements.audio.addEventListener("loadeddata", handleReady, { once: true });
      elements.audio.addEventListener("canplay", handleReady, { once: true });
      elements.audio.addEventListener("canplaythrough", handleReady, { once: true });
      elements.audio.addEventListener("error", handleError, { once: true });
    });
  }

  async function bootstrapPrimaryPlayback(mix) {
    if (!mix?.audioUrl) {
      queueAudioFeedbackIncident("missing_audio", {
        severity: "high",
        title: "Dreamweaver could not find primary audio",
        details: "The selected Dreamweaver mix does not expose a primary audio URL for playback bootstrap.",
        mix,
        metadata: { failureState: "missing_audio" }
      });
      throw new Error("The selected Dreamweaver mix is missing its primary audio source.");
    }

    setLoadingProgress(58, "Bootstrapping primary playback", "Dreamweaver is loading the linked song first so sound can start before the wider loop hydrates.");
    state.mix = mix;
    state.duration = Number(mix.durationSeconds || 0);
    elements.audio.pause();
    elements.audio.currentTime = 0;
    elements.audio.src = mix.audioUrl;
    elements.audio.load?.();

    if (elements.audio.muted || Number(elements.audio.volume) === 0) {
      queueAudioFeedbackIncident("muted_audio", {
        severity: "medium",
        title: "Dreamweaver primary audio initialized muted",
        details: "The Dreamweaver player was muted while preparing the first linked song for playback.",
        mix,
        metadata: { failureState: "muted_audio" }
      });
    }

    const readiness = await awaitPrimaryPlaybackReadiness();
    if (!readiness.ok) {
      queueAudioFeedbackIncident(readiness.state === "error" && Number(elements.audio?.error?.code || 0) === 3 ? "corrupted_audio" : "non_playable_audio", {
        severity: "high",
        title: "Dreamweaver primary audio could not be prepared",
        details: readiness.detail || describeAudioElementFailure(),
        mix,
        metadata: { failureState: readiness.state === "error" && Number(elements.audio?.error?.code || 0) === 3 ? "corrupted_audio" : "non_playable_audio" }
      });
      throw new Error(readiness.detail || "The linked Dreamweaver audio could not be prepared.");
    }

    try {
      await elements.audio.play();
      return { started: true };
    } catch (error) {
      queueAudioFeedbackIncident("non_playable_audio", {
        severity: "medium",
        title: "Dreamweaver primary audio could not start",
        details: cleanText(error instanceof Error ? error.message : "Playback was blocked before Dreamweaver could start the linked song.", 1200, "Playback was blocked before Dreamweaver could start the linked song."),
        mix,
        metadata: { failureState: "non_playable_audio", reason: "play-rejected" }
      });
      showToast("Press play again to start the audio experience.");
      return { started: false };
    }
  }

  async function hydrateDreamweaverLoopContent() {
    setLoadingProgress(82, "Hydrating the Dreamweaver loop", "Stories, release context, and the wider loop are loading after the primary song bootstrap.");
    await loadReleaseContext();
    updatePlatformLinks();
    await loadVideos();
  }

  function releaseArtwork(release = {}) {
    const fallback = safeMediaUrl(DREAMWEAVER_RELEASE_FALLBACK_ARTWORK) || DREAMWEAVER_RELEASE_FALLBACK_ARTWORK;
    const resolved = window.HaloReleaseArtwork?.resolve(release, fallback);
    if (resolved) return resolved;
    const src = safeMediaUrl(release.artwork || release.artworkOverride || release.importedArtwork || release.catalog?.artworkUrl, fallback);
    return {
      src,
      fallback,
      source: src === fallback ? "fallback" : "legacy"
    };
  }

  function releaseStateLabel(status) {
    if (status === "loading") return "Loading signal";
    if (status === "playing") return "Playing now";
    if (status === "ready") return "Ready";
    if (status === "unavailable") return "Unavailable";
    return "Paused";
  }

  function releaseStateDetail(status, title, artist) {
    const releaseLine = [title, artist].filter(Boolean).join(" — ");
    if (status === "loading") return "Dreamweaver is preparing the audio and release context.";
    if (status === "playing") return releaseLine ? `${releaseLine} is live across the Dreamweaver lobby.` : "Live playback is active across the Dreamweaver lobby.";
    if (status === "ready") return releaseLine ? `${releaseLine} is ready. Press play to move through the four-act listening arc.` : "Audio is ready. Press play to move through the four-act listening arc.";
    if (status === "unavailable") return "Audio is currently unavailable, but release context is still on stage.";
    return "Playback is paused. Resume when you are ready.";
  }

  function renderSongLobbyHero() {
    const title = cleanText(state.release?.title || state.mix?.title || featuredTrack.title);
    const artist = cleanText(state.release?.artist || state.mix?.creator?.name || featuredTrack.artist);
    const artwork = releaseArtwork(state.release || {});
    if (elements.lobbyArtwork) {
      elements.lobbyArtwork.src = artwork.src || chapters[0].image;
      elements.lobbyArtwork.dataset.artworkFallback = artwork.fallback;
      elements.lobbyArtwork.dataset.artworkSource = artwork.source || "";
      elements.lobbyArtwork.alt = `${title || "Dreamweaver"} artwork${artist ? ` by ${artist}` : ""}`;
      const lobbyFrame = elements.lobbyArtwork.closest("[data-artwork-frame]");
      if (lobbyFrame) window.HaloReleaseArtwork?.wire(lobbyFrame, DREAMWEAVER_RELEASE_FALLBACK_ARTWORK);
    }
    if (elements.lobbyArtworkCaption) elements.lobbyArtworkCaption.textContent = artist ? `${title} — ${artist}` : title || "Dreamweaver lobby artwork";

    const heroVideo = preferredHeroVideo();
    const embedUrl = safeMediaUrl(heroVideo?.embedUrl);
    const sourceUrl = safeMediaUrl(heroVideo?.sourceUrl) || "/radio/";
    const reelLabel = cleanText(heroVideo?.title || `${title} short reel preview`, 120);
    if (embedUrl && elements.heroReelPlayer) {
      const connector = embedUrl.includes("?") ? "&" : "?";
      const nextSrc = `${embedUrl}${connector}rel=0&modestbranding=1`;
      if (elements.heroReelPlayer.src !== nextSrc) elements.heroReelPlayer.src = nextSrc;
      elements.heroReelPlayer.hidden = false;
      if (elements.heroReelFallback) elements.heroReelFallback.hidden = true;
      if (elements.heroReelStatus) elements.heroReelStatus.textContent = `${reelLabel} is setting the tone for the lobby.`;
      return;
    }
    if (elements.heroReelPlayer) {
      elements.heroReelPlayer.hidden = true;
      if (elements.heroReelPlayer.getAttribute("src") !== "about:blank") elements.heroReelPlayer.src = "about:blank";
    }
    if (elements.heroReelFallback) {
      elements.heroReelFallback.hidden = false;
      elements.heroReelFallback.href = sourceUrl;
      elements.heroReelFallback.textContent = heroVideo ? `Open ${reelLabel} ↗` : "Open the HALO reel signal ↗";
    }
    if (elements.heroReelStatus) elements.heroReelStatus.textContent = heroVideo ? `${reelLabel} is available as a direct reel link.` : "Dreamweaver is holding the artwork in focus until a connected short reel is available.";
  }

  function renderReleasePanel() {
    if (!elements.releasePanel) return;
    const release = state.release || {};
    const catalog = release.catalog || {};
    const mixTitle = cleanText(state.mix?.title || "");
    const mixArtist = cleanText(state.mix?.creator?.name || featuredTrack.artist);
    const title = cleanText(release.title || mixTitle || featuredTrack.title);
    const artist = cleanText(release.artist || mixArtist || featuredTrack.artist);
    const genres = Array.isArray(release.genres)
      ? release.genres.filter(Boolean).map(value => cleanText(value, 60))
      : [];
    const genre = genres[0] || "";
    const catalogGenre = cleanText(String(catalog.genre || "").split(",")[0] || "", 60);
    const bpm = Number(release.bpm) > 0 ? String(Number(release.bpm)) : "";
    const musicalKey = cleanText(release.musicalKey, 20);
    const duration = state.duration ? formatTime(state.duration) : cleanText(release.duration, 24);
    const releaseInfo = cleanText(release.releaseDate || releaseDateLabel(release.publication?.lastReconciledAt) || state.publishedSongId, 40);
    const publication = release.publication || {};
    const status = cleanText(publication.dreamweaverStatus || publication.releaseStatus || catalog.saleStatus, 40);
    const album = cleanText(release.albumTitle || release.collectionTitle || catalog.albumTitle || "", 120);
    const artwork = releaseArtwork(release);
    const rows = [
      ["Artist", artist],
      ["Album", album],
      ["Genre", genre || catalogGenre],
      ["BPM", bpm],
      ["Key", musicalKey],
      ["Duration", duration],
      ["Release", releaseInfo],
      ["Status", status]
    ].filter(([, value]) => value);

    elements.releasePanelKicker.textContent = `Now playing / ${releaseStateLabel(state.releasePlaybackState)}`;
    elements.releaseTitle.textContent = title || "Dreamweaver show";
    elements.releaseSubtitle.textContent = releaseStateDetail(state.releasePlaybackState, title, artist);
    elements.releaseFacts.innerHTML = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
    elements.releasePanel.dataset.state = state.releasePlaybackState;

    elements.releaseArtwork.src = artwork.src;
    elements.releaseArtwork.dataset.artworkFallback = artwork.fallback;
    elements.releaseArtwork.dataset.artworkSource = artwork.source || "";
    elements.releaseArtwork.alt = `${title || "Dreamweaver show"} cover artwork`;
    window.HaloReleaseArtwork?.wire(elements.releasePanel, DREAMWEAVER_RELEASE_FALLBACK_ARTWORK);
    renderSongLobbyHero();
  }

  function setReleasePlaybackState(nextState) {
    state.releasePlaybackState = nextState;
    renderReleasePanel();
  }

  function setLoadingProgress(percent = 0, phase = "", subtitle = "") {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    if (elements.loadingMeterBar) elements.loadingMeterBar.style.width = `${safePercent}%`;
    if (elements.loadingProgress) {
      elements.loadingProgress.setAttribute("aria-valuenow", String(Math.round(safePercent)));
      if (phase) elements.loadingProgress.setAttribute("aria-valuetext", `${phase} (${Math.round(safePercent)}%)`);
    }
    if (elements.loadingPhase && phase) elements.loadingPhase.textContent = phase;
    if (elements.loadingSubtitle && subtitle) elements.loadingSubtitle.textContent = subtitle;
  }

  async function loadReleaseContext({ keepCurrentOnFailure = false } = {}) {
    const songContextId = resolveSongContextId();
    if (songContextId) state.publishedSongId = songContextId;
    if (!state.publishedSongId) {
      state.release = null;
      renderReleasePanel();
      return;
    }
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/release-catalog", {
        timeoutMs: RELEASE_CONTEXT_TIMEOUT_MS,
        timeoutMessage: "Dreamweaver timed out while loading release context.",
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(payload.message || "Release catalog unavailable");
      const releases = Array.isArray(payload.releases) ? payload.releases : [];
      const normalizedSongId = String(state.publishedSongId || "").toLowerCase();
      const release = releases.find((item) => {
        const releaseId = String(item.id || "").toLowerCase();
        const catalogSongId = String(item.catalog?.songId || "").toLowerCase();
        return releaseId === normalizedSongId || catalogSongId === normalizedSongId;
      }) || null;
      if (release) {
        state.release = release;
        state.publishedSongId = cleanSongId(release.id) || state.publishedSongId;
      } else if (!keepCurrentOnFailure) {
        state.release = null;
      }
    } catch {
      if (!keepCurrentOnFailure) state.release = null;
    }
    renderReleasePanel();
  }

  function isSatelliteFlow() {
    const params = new URLSearchParams(location.search);
    if (isSatellitePath()) return true;
    if (campaignIdFromUrl() || params.get("experience") === "studio") return false;
    const hasMix = Boolean(params.get("mix"));
    if (!hasMix) return true;
    return params.get("satellite") === "dreamweaver";
  }

  function rewardSearchQuery() {
    return `${state.mix?.title || featuredTrack.title} ${state.mix?.creator?.name || featuredTrack.artist}`.trim();
  }

  function publishedSongShareUrl() {
    const songId = cleanSongId(state.release?.id) || cleanSongId(state.publishedSongId);
    if (!songId) return "";
    const url = new URL("/music/", location.origin);
    url.searchParams.set("song", songId);
    return url.toString();
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
    if (elements.sourceLink) {
      const publishedSongUrl = publishedSongShareUrl();
      if (publishedSongUrl) {
        elements.sourceLink.href = publishedSongUrl;
        elements.sourceLink.setAttribute("aria-label", "Open this published HALO song");
        const title = cleanText(state.release?.title || state.mix?.title || featuredTrack.title);
        const artist = cleanText(state.release?.artist || state.mix?.creator?.name || featuredTrack.artist);
        elements.sourceLink.textContent = `${title} — ${artist} ↗`;
      } else {
        elements.sourceLink.href = featuredTrack.url;
        elements.sourceLink.setAttribute("aria-label", `Open ${featuredTrack.title} by ${featuredTrack.artist} on DistroKid HyperFollow`);
        elements.sourceLink.textContent = `${featuredTrack.title} — ${featuredTrack.artist} ↗`;
      }
      elements.sourceLink.dataset.haloPlayerTitle = cleanText(state.release?.title || state.mix?.title || featuredTrack.title);
      elements.sourceLink.dataset.haloPlayerArtist = cleanText(state.release?.artist || state.mix?.creator?.name || featuredTrack.artist);
      elements.sourceLink.dataset.haloPlayerAlbum = cleanText(state.release?.albumTitle || state.release?.collectionTitle || state.release?.catalog?.albumTitle || "");
      elements.sourceLink.dataset.haloPlayerGenre = Array.isArray(state.release?.genres) && state.release.genres.length
        ? cleanText(state.release.genres[0] || "", 80)
        : cleanText(String(state.release?.catalog?.genre || "").split(",")[0] || "", 80);
      elements.sourceLink.dataset.haloPlayerBpm = Number(state.release?.bpm) > 0 ? String(Number(state.release.bpm)) : "";
      elements.sourceLink.dataset.haloPlayerKey = cleanText(state.release?.musicalKey || "", 20);
      elements.sourceLink.dataset.haloPlayerDuration = state.duration ? formatTime(state.duration) : cleanText(state.release?.duration || "", 24);
      elements.sourceLink.dataset.haloPlayerRelease = cleanText(state.release?.releaseDate || releaseDateLabel(state.release?.publication?.lastReconciledAt) || state.publishedSongId, 40);
      elements.sourceLink.dataset.haloPlayerStatus = cleanText(state.release?.publication?.dreamweaverStatus || state.release?.publication?.releaseStatus || state.release?.catalog?.saleStatus || "", 40);
      elements.sourceLink.dataset.haloPlayerArtwork = safeMediaUrl(state.release?.artwork || state.release?.artworkOverride || state.release?.importedArtwork || state.release?.catalog?.artworkUrl);
      delete elements.sourceLink.dataset.haloPlayer;
    }
  }

  function renderRewardState() {
    if (!elements.rewardCopy) return;
    const firstName = state.unlock?.firstName || "You";
    const platform = unlockPlatforms[state.unlock?.favoritePlatform || "spotify"]?.label || "your streaming app";
    elements.rewardCopy.textContent = `${firstName}, your song lobby is open. Start the full Dreamweaver experience below, then continue on ${platform}, Spotify, Apple Music, or YouTube when you are ready.`;
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

  function satelliteAgentLoopId(songId) {
    const managerId = cleanText(state.release?.dreamweaverPage?.manager?.id || "", 160);
    if (managerId) return managerId;
    const id = cleanSongId(songId);
    return id ? `dreamweaver-satellite-${id}` : "";
  }

  function stopSatelliteAgentLoop() {
    window.clearInterval(state.satelliteAgentLoop.timer);
    state.satelliteAgentLoop.timer = 0;
  }

  function startSatelliteAgentLoop() {
    stopSatelliteAgentLoop();
    const songId = cleanSongId(state.publishedSongId) || songIdFromSatellitePath();
    if (!songId) return;
    const manager = state.release?.dreamweaverPage?.manager || null;
    state.satelliteAgentLoop.loopId = satelliteAgentLoopId(songId);
    state.satelliteAgentLoop.updateIntervalMs = Number(manager?.intervalMs) > 0
      ? Number(manager.intervalMs)
      : SATELLITE_AGENT_REFRESH_MS;
    state.satelliteAgentLoop.lastError = "";
    state.satelliteAgentLoop.timer = window.setInterval(async () => {
      try {
        await loadReleaseContext({ keepCurrentOnFailure: true });
        state.satelliteAgentLoop.lastUpdatedAt = new Date().toISOString();
      } catch (error) {
        state.satelliteAgentLoop.lastError = error instanceof Error ? error.message : "Satellite update unavailable";
      }
    }, state.satelliteAgentLoop.updateIntervalMs);
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
    submitButton.querySelector("span").textContent = "Unlocking the lobby…";
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
      submitButton.querySelector("span").textContent = "Unlock full streaming access";
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

  function normalizeUploadPath(value) {
    const route = String(value || "").trim();
    if (!route) return "";
    if (route === "/dreamweaver") return "/dreamweaver/";
    if (route === "/dreamweaver-lab") return "/dreamweaver-lab/";
    return route;
  }

  function safeUploadReturnPath(value) {
    try {
      const url = new URL(value || "/dreamweaver-lab/", location.origin);
      if (url.origin !== location.origin) return "/dreamweaver-lab/";
      const path = normalizeUploadPath(url.pathname);
      return approvedUploadReturnPaths.has(path) ? path : "/dreamweaver-lab/";
    } catch {
      return "/dreamweaver-lab/";
    }
  }

  function storeUploadTrust(reason = "entry") {
    const trust = { flow: "artist-upload", route: "/dreamweaver/", reason, issuedAt: Date.now() };
    try { sessionStorage.setItem(uploadTrustStorageKey, JSON.stringify(trust)); } catch {}
    return trust;
  }

  function openSongLabUpload(reason = "entry", returnPath = "/dreamweaver-lab/") {
    storeUploadTrust(reason);
    const target = new URL(safeUploadReturnPath(returnPath), location.origin);
    target.searchParams.set("flow", "artist-upload");
    if (reason === "verified") target.searchParams.set("verified", "1");
    location.assign(`${target.pathname}${target.search}`);
  }

  function resumeUploadVerification() {
    const params = new URLSearchParams(location.search);
    if (params.get("upload") !== "verify") return false;
    openSongLabUpload("verified", params.get("returnTo") || "/dreamweaver-lab/");
    return true;
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
    elements.chapterList.innerHTML = chapters.map((chapter, index) => `<button class="chapter-button ${index === 0 ? "active" : ""}" type="button" data-chapter="${index}" aria-label="Open act ${chapter.number}: ${escapeHtml(chapter.label)}"><span>${chapter.number}</span><strong>${escapeHtml(chapter.label)}</strong></button>`).join("");
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
    elements.chapterTime.textContent = `Act ${chapter.number} / ${chapter.label}`;
    elements.drawerKicker.textContent = `Act ${chapter.number} / ${chapter.label}`;
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
    if (!state.mix) {
      if (isSatelliteFlow()) {
        if (!state.unlock) {
          document.getElementById("storyActIV")?.scrollIntoView({ behavior: "smooth", block: "start" });
          setUnlockStatus("Unlock the song lobby first, then Dreamweaver can open the reel generator.");
          return;
        }
        elements.creatorGatewayLink?.scrollIntoView({ behavior: "smooth", block: "center" });
        elements.creatorGatewayLink?.focus({ preventScroll: true });
        showToast("Creator tools live behind the DJ Deck gateway while this public lobby stays listener-first.");
        return;
      }
      return showToast("Open a playable mix before creating a campaign.");
    }
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
      const { response, payload } = await fetchJsonWithTimeout("/api/videos?artistSlug=owen-anthony", {
        timeoutMs: VIDEO_LIBRARY_TIMEOUT_MS,
        timeoutMessage: "Dreamweaver timed out while loading connected videos.",
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      });
      if (!response.ok) return;
      state.videos = Array.isArray(payload.videos) ? payload.videos.slice(0, 8) : [];
      renderFootageSelector();
      renderArchive();
      renderSongLobbyHero();
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
        <img src="${escapeHtml(video.thumbnailUrl || "/assets/halo-logo-mark.webp")}" alt="${escapeHtml(video.title || "Dreamweaver source video")} thumbnail">
        <span>${escapeHtml(video.title)}<small>${video.sourceType === "upload" ? "Film source" : "Reference only"}</small></span>
      </label>`).join("");
  }

  function renderArchive() {
    if (!state.videos.length) {
      elements.archiveReel.innerHTML = `<a class="archive-card" href="/artists/"><img src="/assets/releases/the-cold-is-lasting-longer.jpg" alt="Enter Owen Anthony's connected artist room"><span>Enter Owen Anthony's connected artist room</span></a><a class="archive-card" href="/radio/"><img src="/assets/artists/owen-anthony-glass-house.webp" alt="Continue into the HALO radio signal"><span>Continue into the HALO radio signal</span></a>`;
      renderSongLobbyHero();
      return;
    }
    elements.archiveReel.innerHTML = state.videos.map(video => `<a class="archive-card" href="${escapeHtml(video.sourceUrl || video.embedUrl || "/artists/")}" ${video.sourceType === "youtube" ? 'target="_blank" rel="noopener noreferrer"' : ""}><img src="${escapeHtml(video.thumbnailUrl || "/assets/halo-logo-mark.webp")}" alt="${escapeHtml(video.title || "Dreamweaver archive video")} thumbnail"><span>${escapeHtml(video.title)}</span></a>`).join("");
    renderSongLobbyHero();
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
    setReleasePlaybackState("loading");
    setLoadingProgress(8, "Calibrating Dreamweaver stage", "Dreamweaver is staging this edition with artwork, metadata, and the four-act lobby in sync.");
    document.body.classList.remove("show-ready");
    elements.shell.hidden = false;
    elements.loading.hidden = false;
    elements.loading.setAttribute("aria-hidden", "false");
    elements.stage.hidden = true;
    elements.empty.hidden = true;
    elements.shell.setAttribute("aria-busy", "true");
    try {
      const requestedMix = new URLSearchParams(location.search).get("mix") || "";
      const { response, payload: data } = await fetchJsonWithTimeout("/api/mixes?limit=100", {
        timeoutMs: MIX_LIBRARY_TIMEOUT_MS,
        timeoutMessage: "Dreamweaver timed out while loading the mix library. Please try again.",
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(data.message || "The Dreamweaver mix library could not be read.");
      const mix = resolvePrimaryPlaybackMix(data.mixes || [], requestedMix);
      if (!mix) {
        queueAudioFeedbackIncident("missing_audio", {
          severity: "high",
          title: "Dreamweaver has no playable primary audio",
          details: "Dreamweaver could not resolve a playable linked song from the current hub request.",
          metadata: { requestedMixId: cleanText(requestedMix, 120), failureState: "missing_audio" }
        });
        return showEmpty("No playable audio mix is available yet. Post the existing set to the HALO room or sign in to open a private mix.");
      }
      setLoadingProgress(34, "Selecting tonight’s signal", "A published Dreamweaver mix has been selected and the room is shifting to match its pace.");
      elements.mixTitle.textContent = mix.title || "Untitled HALO mix";
      elements.mixCreator.textContent = `${mix.creator?.name || "Owen Anthony"} / ${mix.trackCount || "DJ"} ${mix.trackCount === 1 ? "track" : "tracks"}`;
      elements.duration.textContent = formatTime(Number(mix.durationSeconds || 0));
      document.title = `${mix.title || "Dreamweaver Show"} — HALO`;
      const currentParams = new URLSearchParams(location.search);
      currentParams.set("mix", mix.id);
      if (state.publishedSongId) currentParams.set("song", state.publishedSongId);
      if (isSatellitePath()) history.replaceState(null, "", `${location.pathname}?${currentParams.toString()}`);
      else history.replaceState(null, "", `/dreamweaver/?${currentParams.toString()}`);
      const playbackBootstrap = await bootstrapPrimaryPlayback(mix);
      await hydrateDreamweaverLoopContent();
      if (!playbackBootstrap?.started || elements.audio.paused || elements.audio.ended) setReleasePlaybackState("ready");
      setLoadingProgress(100, "Dreamweaver is ready", "Press play and move through the full four-act cinematic edition.");
      elements.loading.setAttribute("aria-hidden", "true");
      elements.stage.hidden = false;
      window.requestAnimationFrame(() => document.body.classList.add("show-ready"));
      elements.loading.hidden = true;
      elements.shell.setAttribute("aria-busy", "false");
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
      setReleasePlaybackState("unavailable");
      showEmpty(error.message || "Dreamweaver could not open the mix right now.");
    }
  }

  async function initializeDreamweaver() {
    hydrateAudioFeedbackQueue();
    void flushQueuedAudioFeedback();
    renderSatelliteState();
    updatePlatformLinks();
    const satelliteFlow = isSatelliteFlow();
    if (satelliteFlow) startSatelliteAgentLoop();
    else stopSatelliteAgentLoop();
    if (satelliteFlow && !state.unlock) {
      await Promise.all([
        loadReleaseContext({ keepCurrentOnFailure: true }),
        loadVideos()
      ]);
      elements.shell.setAttribute("aria-busy", "false");
      return;
    }
    await loadShow();
  }

  if (resumeUploadVerification()) return;
  elements.songLabLink?.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openSongLabUpload();
  });
  buildExperience();
  renderReleasePanel();
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
    renderReleasePanel();
    if (state.releasePlaybackState === "loading") setReleasePlaybackState("ready");
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
    setReleasePlaybackState("playing");
  });
  elements.audio.addEventListener("pause", () => {
    document.body.classList.remove("is-playing");
    elements.playButton.setAttribute("aria-label", "Play show");
    document.body.classList.remove("idle");
    if (!elements.audio.ended) setReleasePlaybackState("paused");
  });
  elements.audio.addEventListener("ended", () => {
    activateChapter(chapters.length - 1, false);
    if (campaignIdFromUrl() && !state.trackedProgress.has("mix_complete")) {
      state.trackedProgress.add("mix_complete");
      trackCampaignEvent("mix_complete", new URLSearchParams(location.search).get("source") || "halo");
    }
    setReleasePlaybackState("ready");
  });
  elements.audio.addEventListener("error", () => {
    queueAudioFeedbackIncident(Number(elements.audio?.error?.code || 0) === 3 ? "corrupted_audio" : "non_playable_audio", {
      severity: "high",
      title: "Dreamweaver audio playback failed",
      details: describeAudioElementFailure(),
      metadata: { failureState: Number(elements.audio?.error?.code || 0) === 3 ? "corrupted_audio" : "non_playable_audio" }
    });
    setReleasePlaybackState("unavailable");
    showToast("The mix audio is unavailable. The visual edition remains open.");
  });
  elements.muteButton.addEventListener("click", () => { elements.audio.muted = !elements.audio.muted; elements.muteButton.setAttribute("aria-label", elements.audio.muted ? "Unmute show" : "Mute show"); showToast(elements.audio.muted ? "Show muted" : "Sound restored"); });
  window.addEventListener("online", () => { void flushQueuedAudioFeedback(); });
  elements.fullScreenButton.addEventListener("click", async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await elements.stage.requestFullscreen(); } catch { showToast("Full screen is not available in this browser."); } });
  elements.shareShow.addEventListener("click", async () => {
    const publishedSongUrl = publishedSongShareUrl();
    const shareData = publishedSongUrl
      ? { title: document.title, text: "Open this published HALO song.", url: publishedSongUrl }
      : { title: document.title, text: "Enter this HALO Dreamweaver visual mix experience.", url: location.href };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        showToast(publishedSongUrl ? "Published song link copied." : "Dreamweaver show link copied.");
      }
    } catch {}
  });
  elements.makeCampaign.addEventListener("click", openCampaignStudio);
  elements.songLobbyMakeCampaign?.addEventListener("click", openCampaignStudio);
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
  window.addEventListener("beforeunload", stopSatelliteAgentLoop);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && elements.campaignStudio.classList.contains("open")) return closeCampaignStudio();
    if (event.key === "Escape" && elements.drawer.classList.contains("open")) closeStory();
    if (event.code === "Space" && !["INPUT", "BUTTON", "A"].includes(document.activeElement?.tagName)) { event.preventDefault(); togglePlayback(); }
    if (event.key === "ArrowRight") activateChapter(state.activeChapter + 1, true);
    if (event.key === "ArrowLeft") activateChapter(state.activeChapter - 1, true);
  });
  initializeDreamweaver();
})();
