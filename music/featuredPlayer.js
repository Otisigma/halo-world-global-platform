(() => {
  const CHART_ENDPOINT = "/api/catalog/chart?sort=signal";
  const VOTE_ENDPOINT = "/api/catalog/vote";
  const QUEUE_PREVIEW_LIMIT = 5;
  // Mirrors the shop's approved-release gate in music.js; "published" is the catalog's approved state.
  const APPROVED_RELEASE_STATUSES = new Set(["passed", "published"]);
  const AUDIO_API_PATHS = new Set(["/api/song-catalog/audio", "/api/mixes/audio", "/api/radio/audio", "/api/stem-vault/audio"]);
  const LANDING_PAGE_HOSTS = ["distrokid.com", "hyperfollow.com", "linktr.ee", "ffm.to", "lnk.to", "found.ee"];
  const fallbackArtwork = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK || "/assets/releases/halo-premium-placeholder.svg";
  const fallbackArtworkBadge = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK_BADGE || "HALO placeholder cover";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function safeUrl(value, fallback = "") {
    try {
      const url = new URL(value, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  function isApprovedRelease(release) {
    return APPROVED_RELEASE_STATUSES.has(String(release?.status || "").trim().toLowerCase());
  }

  // Only direct media assets can feed the HTML audio element; pre-save/smart-link pages never can.
  function isStreamableAudioUrl(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return false;
    let url;
    try {
      url = new URL(raw, window.location.origin);
    } catch {
      return false;
    }
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (LANDING_PAGE_HOSTS.some(landing => host === landing || host.endsWith(`.${landing}`))) return false;
    if (host === "drive.google.com") return url.pathname === "/uc" && /^[\w-]{10,}$/.test(url.searchParams.get("id") || "");
    return /\.(mp3|m4a|m4b|aac|ogg|oga|wav|flac|webm)(?:$|[?#])/i.test(`${url.pathname}${url.search}`)
      || AUDIO_API_PATHS.has(url.pathname);
  }

  function approvedChartReleases(releases) {
    return (Array.isArray(releases) ? releases : []).filter(release => release?.id && isApprovedRelease(release));
  }

  function buildQueue(releases) {
    return approvedChartReleases(releases).filter(release => isStreamableAudioUrl(release.audioUrl));
  }

  function nextQueueIndex(index, length) {
    if (!Number.isInteger(length) || length < 2) return -1;
    return (Number(index) + 1 + length) % length;
  }

  function trackFor(release) {
    return {
      id: String(release?.id || ""),
      title: release?.title || "",
      artist: release?.artist || "",
      src: safeUrl(release?.audioUrl),
      cover: safeUrl(release?.artwork, fallbackArtwork)
    };
  }

  function playButtonMarkup(release, queueIndex, { compact = false, playerReady = true } = {}) {
    const track = trackFor(release);
    const label = `Play ${track.title || "this release"}${track.artist ? ` by ${track.artist}` : ""}`;
    if (!track.src || !playerReady) {
      return compact ? "" : `<button class="action play" type="button" disabled aria-disabled="true">Player unavailable</button>`;
    }
    return `<button class="${compact ? "chart-play" : "action play"}" type="button" data-action="play-track" data-play-track-id="${escapeHtml(track.id)}" data-track-id="${escapeHtml(track.id)}" data-title="${escapeHtml(track.title)}" data-artist="${escapeHtml(track.artist)}" data-audio-url="${escapeHtml(track.src)}" data-cover="${escapeHtml(track.cover)}" data-queue-index="${queueIndex}"${compact ? ' data-play-compact="true"' : ""} aria-pressed="false" aria-label="${escapeHtml(label)}">${compact ? "▶" : "▶ Play"}</button>`;
  }

  function heroMarkup({ releases = [], queue = buildQueue(releases), activeIndex = -1, playerReady = true } = {}) {
    const hero = approvedChartReleases(releases)[0];
    if (!hero) return "";
    const heroIndex = queue.findIndex(release => release.id === hero.id);
    const artworkSrc = safeUrl(hero.artwork, fallbackArtwork);
    const votes = Number(hero.votes || 0);
    const listenHref = safeUrl(hero.listenUrl);
    const upNext = queue.filter(release => release.id !== hero.id).slice(0, QUEUE_PREVIEW_LIMIT);
    const playAction = heroIndex >= 0
      ? playButtonMarkup(hero, heroIndex, { playerReady })
      : `<span class="action play" aria-disabled="true">Direct preview coming soon</span>`;
    const listenAction = listenHref
      ? `<a class="action primary" href="${escapeHtml(listenHref)}">Listen now <span aria-hidden="true">↗</span></a>`
      : "";
    return `<div class="featured-hero-card">
      <div class="featured-hero-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artworkSrc)}" alt="${escapeHtml(`${hero.title} cover artwork`)}" data-release-artwork data-artwork-fallback="${escapeHtml(fallbackArtwork)}" data-artwork-badge="${escapeHtml(fallbackArtworkBadge)}"><span class="featured-hero-rank">#${escapeHtml(hero.rank || 1)}</span></div>
      <div class="featured-hero-copy" data-halo-guide-scope>
        <p class="featured-hero-kicker" tabindex="0" data-halo-guide="This release leads the Living Chart on live fan signals — listens, votes and release-room opens. Quick listen without leaving the page." data-halo-guide-title="#${escapeHtml(hero.rank || 1)} Fan voted" data-halo-guide-action="quick-listen"><span class="featured-hero-pulse" aria-hidden="true"></span><span>Chart leader · Signal score</span><span data-featured-hero-votes>${votes} ${votes === 1 ? "vote" : "votes"}</span></p>
        <h2 class="featured-hero-title">${escapeHtml(hero.title)}</h2>
        <p class="featured-hero-artist">${escapeHtml(hero.artist)}</p>
        <div class="featured-hero-actions">
          ${playAction}
          ${listenAction}
          <button class="action tertiary" type="button" data-featured-vote="${escapeHtml(hero.id)}" data-halo-guide="One vote per listener per day pushes this release up the Living Chart and toward #1 rotation." data-halo-guide-title="Vote">Vote ▲</button>
        </div>
        <p class="featured-hero-status" data-featured-hero-status role="status" aria-live="polite">${queue.length > 1 && playerReady ? "Press play and the chart keeps playing in order." : ""}</p>
      </div>
      ${upNext.length ? `<div class="featured-queue-shell"><span class="featured-queue-label">Up next on the chart</span><ol class="featured-queue">${upNext.map(release => {
        const index = queue.indexOf(release);
        return `<li class="featured-queue-item${index === activeIndex ? " is-current" : ""}"><span class="featured-queue-rank">${escapeHtml(String(release.rank || index + 1).padStart(2, "0"))}</span><span class="featured-queue-track"><strong>${escapeHtml(release.title)}</strong><small>${escapeHtml(release.artist)}</small></span>${playButtonMarkup(release, index, { compact: true, playerReady })}</li>`;
      }).join("")}</ol></div>` : ""}
    </div>`;
  }

  // Drives auto-advance through the shared HaloGlobalPlayer; never creates its own audio element.
  function createQueueController(player, getQueue, { onAdvance } = {}) {
    let index = -1;
    let active = false;
    function start(queueIndex) {
      const queue = getQueue();
      if (!Number.isInteger(queueIndex) || !queue[queueIndex]) return;
      index = queueIndex;
      active = true;
    }
    function stop() {
      active = false;
    }
    function handleEnded() {
      const queue = getQueue();
      if (!active || !queue[index] || player.track?.id !== queue[index].id) {
        active = false;
        return null;
      }
      const next = nextQueueIndex(index, queue.length);
      if (next < 0) {
        active = false;
        return null;
      }
      index = next;
      player.play(trackFor(queue[next]));
      onAdvance?.(queue[next], next);
      return queue[next];
    }
    player?.audio?.addEventListener?.("ended", handleEnded);
    return {
      start,
      stop,
      handleEnded,
      get index() { return index; },
      get active() { return active; }
    };
  }

  window.HaloFeaturedPlayer = Object.freeze({
    CHART_ENDPOINT,
    VOTE_ENDPOINT,
    isApprovedRelease,
    isStreamableAudioUrl,
    buildQueue,
    nextQueueIndex,
    trackFor,
    heroMarkup,
    createQueueController
  });

  const container = document.querySelector("#featuredRelease");
  if (!container) return;

  const state = { releases: [], queue: [], controller: null };
  const hero = document.createElement("section");
  hero.className = "featured-hero";
  hero.dataset.featuredHero = "";
  hero.setAttribute("aria-label", "Chart leader and queue");
  hero.hidden = true;

  function sharedPlayer() {
    const player = window.HaloPlayer;
    return player && typeof player.play === "function" && player.audio ? player : null;
  }

  function mountHero() {
    if (hero.hidden) return;
    if (container.firstElementChild !== hero) container.prepend(hero);
  }

  function render() {
    const player = sharedPlayer();
    const markup = heroMarkup({
      releases: state.releases,
      queue: state.queue,
      activeIndex: state.controller?.active ? state.controller.index : -1,
      playerReady: Boolean(player)
    });
    hero.hidden = !markup;
    hero.innerHTML = markup;
    if (!markup) {
      hero.remove();
      return;
    }
    mountHero();
    window.HaloReleaseArtwork?.wire(hero, fallbackArtwork);
    player?.syncButtons?.(hero);
  }

  function setStatus(message) {
    const status = hero.querySelector("[data-featured-hero-status]");
    if (status) status.textContent = message;
  }

  function logIssue(eventType, title, details) {
    console.warn("[HALO Music]", title, details);
    window.dispatchEvent(new CustomEvent("halo:journal-event", {
      detail: { eventType, category: "problem", targetName: title, details, immediate: true }
    }));
  }

  async function vote(button) {
    const releaseId = button.dataset.featuredVote;
    button.disabled = true;
    try {
      const response = await fetch(VOTE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ releaseId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Your vote could not be recorded.");
      const release = state.releases.find(item => item.id === releaseId);
      if (release) release.votes = Number(data.votes || 0);
      const counter = hero.querySelector("[data-featured-hero-votes]");
      if (counter) counter.textContent = `${Number(data.votes || 0)} ${Number(data.votes) === 1 ? "vote" : "votes"}`;
      setStatus(data.alreadyVoted ? "You already boosted this release today." : "Vote counted. Thanks for moving the chart.");
    } catch (error) {
      button.disabled = false;
      setStatus(error instanceof Error ? error.message : "Your vote could not be recorded.");
    }
  }

  hero.addEventListener("click", event => {
    const voteButton = event.target instanceof Element ? event.target.closest("[data-featured-vote]") : null;
    if (voteButton) {
      vote(voteButton);
      return;
    }
    const playButton = event.target instanceof Element ? event.target.closest("[data-queue-index]") : null;
    // The document-level delegated handler in music.js performs playback; this only arms auto-advance.
    if (playButton && state.controller) state.controller.start(Number(playButton.dataset.queueIndex));
  });

  // music.js re-renders #featuredRelease wholesale; keep the hero mounted at the top.
  new MutationObserver(mountHero).observe(container, { childList: true });

  async function loadChart() {
    try {
      const response = await fetch(CHART_ENDPOINT, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The chart could not be loaded.");
      state.releases = approvedChartReleases(data.releases);
      state.queue = buildQueue(state.releases);
    } catch (error) {
      state.releases = [];
      state.queue = [];
      logIssue("music_featured_chart_unavailable", "Featured chart hero could not load", { message: error instanceof Error ? error.message : "unknown error" });
    }
    const player = sharedPlayer();
    if (player && !state.controller) {
      state.controller = createQueueController(player, () => state.queue, { onAdvance: render });
    } else if (!player && state.queue.length) {
      logIssue("music_featured_player_unavailable", "Featured chart hero could not reach the HALO player", { page: window.location.pathname });
    }
    render();
    // A new Living Chart leader triggers the #1 celebration and Public Frequency broadcast once.
    window.HaloChartCelebration?.maybeCelebrate(state.releases[0]);
  }

  loadChart();
})();
