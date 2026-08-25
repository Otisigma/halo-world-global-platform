(() => {
  const audioPattern = /\.(?:mp3|m4a|aac|ogg|oga|wav|flac|webm)(?:$|[?#])/i;
  const variantKey = "halo_listening_preview_variant";
  const variants = Object.freeze({ quick_15: 15, sample_30: 30, full_listen: 0 });
  let active = null;
  let youtubePlayer = null;
  let youtubeReadyPromise = null;
  let progressTimer = 0;
  let opener = null;
  let playbackGeneration = 0;

  function track(eventName, metadata = {}) {
    window.haloStats?.track(eventName, metadata);
  }

  function previewVariant() {
    try {
      const stored = localStorage.getItem(variantKey);
      if (stored && Object.hasOwn(variants, stored)) return stored;
      const names = Object.keys(variants);
      const selected = names[Math.floor(Math.random() * names.length)];
      localStorage.setItem(variantKey, selected);
      return selected;
    } catch {
      return "sample_30";
    }
  }

  function youtubeMedia(url) {
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be" && host !== "music.youtube.com") return null;

    let videoId = "";
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
    else if (/^\/(?:shorts|embed)\//.test(url.pathname)) videoId = url.pathname.split("/")[2] || "";

    const playlistId = url.searchParams.get("list") || "";
    if (!videoId && !playlistId) return null;
    if (videoId && !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) return null;
    if (playlistId && !/^[a-zA-Z0-9_-]{8,80}$/.test(playlistId)) return null;

    return { type: "youtube", platform: "youtube", videoId, playlistId };
  }

  function mediaFromLink(link) {
    if (!link?.href || link.dataset.haloPlayer === "off" || link.hasAttribute("download")) return null;
    let url;
    try {
      url = new URL(link.href, window.location.href);
    } catch {
      return null;
    }

    const youtube = youtubeMedia(url);
    if (youtube) return { ...youtube, url: url.href };
    if (link.dataset.haloPlayer === "audio" || audioPattern.test(url.pathname + url.search)) {
      return { type: "audio", platform: "audio", url: url.href };
    }
    return null;
  }

  function titleFor(link) {
    return (link.dataset.haloPlayerTitle || link.getAttribute("aria-label") || link.textContent || "HALO music")
      .replace(/\s+/g, " ")
      .replace(/(?:PLAY HERE|↗)/gi, "")
      .trim()
      .slice(0, 120) || "HALO music";
  }

  function buildRoom() {
    const room = document.createElement("section");
    room.className = "halo-listening-room";
    room.hidden = true;
    room.setAttribute("role", "dialog");
    room.setAttribute("aria-modal", "true");
    room.setAttribute("aria-labelledby", "haloListeningTitle");
    room.innerHTML = `
      <button class="halo-listening-room__shade" type="button" data-halo-close aria-label="Close listening room"></button>
      <div class="halo-listening-room__panel">
        <header class="halo-listening-room__rail">
          <span class="halo-listening-room__mark" aria-hidden="true">H▶</span>
          <div>
            <p class="halo-listening-room__eyebrow">HALO listening room</p>
            <h2 class="halo-listening-room__title" id="haloListeningTitle">Now playing</h2>
            <p class="halo-listening-room__source" data-halo-source>Playing here without leaving HALO</p>
          </div>
          <button class="halo-listening-room__close" type="button" data-halo-close aria-label="Close player">×</button>
        </header>
        <div class="halo-listening-room__stage" data-halo-stage></div>
        <div class="halo-listening-room__gate" data-halo-gate hidden>
          <strong>You found the signal.</strong>
          <p>Keep listening here, or open the original source whenever you choose.</p>
          <button class="halo-listening-room__button" type="button" data-halo-continue>Keep listening</button>
          <a class="halo-listening-room__external" data-halo-external target="_blank" rel="noopener noreferrer">Open original source ↗</a>
        </div>
        <footer class="halo-listening-room__actions">
          <span class="halo-listening-room__source" data-halo-test-copy></span>
          <a class="halo-listening-room__external" data-halo-external target="_blank" rel="noopener noreferrer">Open original source ↗</a>
        </footer>
      </div>`;
    document.body.append(room);
    room.addEventListener("click", event => {
      if (event.target.closest("[data-halo-close]")) closeRoom("button");
      if (event.target.closest("[data-halo-continue]")) continueListening();
      if (event.target.closest("[data-halo-external]")) {
        track("music_external_open", metadata(Math.round(currentSeconds())));
      }
    });
    return room;
  }

  const room = buildRoom();
  const stage = room.querySelector("[data-halo-stage]");
  const gate = room.querySelector("[data-halo-gate]");
  const externalLinks = room.querySelectorAll("[data-halo-external]");
  const title = room.querySelector("#haloListeningTitle");
  const source = room.querySelector("[data-halo-source]");
  const testCopy = room.querySelector("[data-halo-test-copy]");

  function metadata(seconds = 0, position = 0) {
    if (!active) return {};
    return {
      target: active.title,
      platform: active.media.platform,
      source_type: active.media.type,
      variant: active.variant,
      seconds,
      position
    };
  }

  function currentSeconds() {
    if (!active) return 0;
    if (active.media.type === "audio") return active.audio?.currentTime || 0;
    if (youtubePlayer?.getCurrentTime) return youtubePlayer.getCurrentTime() || 0;
    return 0;
  }

  function durationSeconds() {
    if (!active) return 0;
    if (active.media.type === "audio") return active.audio?.duration || 0;
    if (youtubePlayer?.getDuration) return youtubePlayer.getDuration() || 0;
    return 0;
  }

  function pausePlayback() {
    if (!active) return;
    if (active.media.type === "audio") active.audio?.pause();
    else youtubePlayer?.pauseVideo?.();
  }

  function playPlayback() {
    if (!active) return;
    if (active.media.type === "audio") active.audio?.play().catch(() => {});
    else youtubePlayer?.playVideo?.();
  }

  function stopPlayback() {
    window.clearInterval(progressTimer);
    progressTimer = 0;
    if (active?.media.type === "audio") {
      active.audio?.pause();
      active.audio?.removeAttribute("src");
    }
    if (youtubePlayer?.destroy) youtubePlayer.destroy();
    youtubePlayer = null;
    stage.replaceChildren();
  }

  function reachedPreviewLimit() {
    if (!active || active.previewReached || active.previewSeconds === 0) return false;
    if (currentSeconds() < active.previewSeconds) return false;
    active.previewReached = true;
    pausePlayback();
    gate.hidden = false;
    track("music_preview_reached", metadata(active.previewSeconds));
    return true;
  }

  function recordProgress() {
    if (!active || reachedPreviewLimit()) return;
    const duration = durationSeconds();
    if (!duration) return;
    const percent = Math.floor((currentSeconds() / duration) * 100);
    for (const milestone of [25, 50, 75]) {
      if (percent >= milestone && !active.milestones.has(milestone)) {
        active.milestones.add(milestone);
        track("music_playback_milestone", metadata(Math.round(currentSeconds()), milestone));
      }
    }
  }

  function startedPlayback() {
    if (!active || active.started) return;
    active.started = true;
    track("music_playback_start", metadata());
    if (!progressTimer) progressTimer = window.setInterval(recordProgress, 1000);
  }

  function completedPlayback() {
    if (!active || active.completed) return;
    active.completed = true;
    track("music_playback_complete", metadata(Math.round(currentSeconds()), 100));
  }

  function continueListening() {
    if (!active) return;
    gate.hidden = true;
    track("music_preview_continue", metadata(Math.round(currentSeconds())));
    playPlayback();
  }

  function ensureYoutubeApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (youtubeReadyPromise) return youtubeReadyPromise;
    youtubeReadyPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.id = "haloYoutubeIframeApi";
      script.onerror = () => reject(new Error("YouTube player unavailable"));
      document.head.append(script);
    });
    return youtubeReadyPromise;
  }

  async function mountYoutube(media, generation) {
    stage.className = "halo-listening-room__stage halo-listening-room__video";
    const playerNode = document.createElement("div");
    playerNode.id = `haloYoutubePlayer_${Date.now()}`;
    stage.append(playerNode);
    try {
      await ensureYoutubeApi();
      if (!active || generation !== playbackGeneration) return;
      const playerVars = { autoplay: 1, playsinline: 1, rel: 0 };
      if (media.playlistId) {
        playerVars.listType = "playlist";
        playerVars.list = media.playlistId;
      }
      youtubePlayer = new window.YT.Player(playerNode.id, {
        host: "https://www.youtube-nocookie.com",
        videoId: media.videoId || undefined,
        playerVars,
        events: {
          onReady: event => event.target.playVideo(),
          onStateChange: event => {
            if (event.data === window.YT.PlayerState.PLAYING) startedPlayback();
            if (event.data === window.YT.PlayerState.ENDED) completedPlayback();
          }
        }
      });
    } catch {
      source.textContent = "The embedded player could not load. The original source remains available below.";
    }
  }

  function mountAudio(media) {
    stage.className = "halo-listening-room__stage halo-listening-room__audio";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = true;
    audio.preload = "metadata";
    audio.src = media.url;
    audio.addEventListener("play", startedPlayback);
    audio.addEventListener("ended", completedPlayback);
    stage.append(audio);
    active.audio = audio;
  }

  function openRoom(link, media) {
    if (active) closeRoom("replace", false);
    opener = link;
    const variant = link.dataset.haloPreviewVariant && Object.hasOwn(variants, link.dataset.haloPreviewVariant)
      ? link.dataset.haloPreviewVariant
      : previewVariant();
    active = {
      media,
      title: titleFor(link),
      variant,
      previewSeconds: variants[variant],
      previewReached: false,
      started: false,
      completed: false,
      milestones: new Set(),
      audio: null
    };
    title.textContent = active.title;
    source.textContent = media.type === "youtube" ? "YouTube playback, kept inside HALO" : "Audio playback, kept inside HALO";
    testCopy.textContent = active.previewSeconds ? `${active.previewSeconds}-second preview test` : "Full-listen test";
    for (const externalLink of externalLinks) externalLink.href = media.url;
    gate.hidden = true;
    room.hidden = false;
    document.body.classList.add("halo-listening-room-open");
    room.querySelector("[data-halo-close]").focus();
    track("music_player_open", metadata());
    const generation = ++playbackGeneration;
    if (media.type === "youtube") mountYoutube(media, generation);
    else mountAudio(media);
  }

  function closeRoom(reason = "close", restoreFocus = true) {
    if (!active) return;
    playbackGeneration += 1;
    track("music_player_close", { ...metadata(Math.round(currentSeconds())), action: reason });
    stopPlayback();
    active = null;
    gate.hidden = true;
    room.hidden = true;
    document.body.classList.remove("halo-listening-room-open");
    if (restoreFocus) opener?.focus?.();
    opener = null;
  }

  function decorateLinks(root = document) {
    const links = root.matches?.("a[href]") ? [root] : root.querySelectorAll?.("a[href]") || [];
    for (const link of links) {
      if (mediaFromLink(link)) {
        link.dataset.haloListen = "ready";
        if (!link.title) link.title = "Play on this page";
      }
    }
  }

  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    const media = mediaFromLink(link);
    if (!media) return;
    event.preventDefault();
    openRoom(link, media);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && active) closeRoom("escape");
  });

  decorateLinks();
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) decorateLinks(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
