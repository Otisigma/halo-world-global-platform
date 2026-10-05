(() => {
  const elements = {
    featured: document.querySelector("#featuredRelease"),
    grid: document.querySelector("#releaseGrid"),
    genres: document.querySelector("#genreFilter"),
    search: document.querySelector("#catalogSearch"),
    sort: document.querySelector("#catalogSort"),
    count: document.querySelector("#releaseCount"),
    chartBoard: document.querySelector("#chartBoard"),
    chartRooms: document.querySelector("#chartRooms"),
    chartSortButtons: document.querySelector("#chartSortButtons"),
    chartStage: document.querySelector("#chartStage"),
    address: document.querySelector("#catalogAddress"),
    copy: document.querySelector("#copyCatalog"),
    share: document.querySelector("#shareCatalog"),
    toast: document.querySelector("#catalogToast"),
    catalogWorkspace: document.querySelector("#catalogWorkspaceDetails"),
    sharedCatalogFrame: document.querySelector("#sharedCatalogFrame")
  };
  const state = { releases: [], videos: [], query: "", genre: "all", sort: "newest", chartRoom: "all", chartSort: "signal", activeReleaseId: "", activeShopId: "" };
  const configuredFeaturedReleaseId = elements.featured?.dataset.featuredReleaseId?.trim() || "";
  const requestedReleaseId = new URLSearchParams(window.location.search).get("song")?.trim() || "";
  const fallbackArtwork = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK || "/assets/releases/halo-premium-placeholder.svg";
  const fallbackArtworkBadge = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK_BADGE || "HALO placeholder cover";
  const satelliteVideoFallbackEnabled = new URLSearchParams(window.location.search).get("satellite") === "music-video-fallback";
  const chartRooms = {
    all: [],
    "hip-hop": ["hip hop", "hip-hop", "rap", "drill", "grime"],
    rnb: ["r&b", "rnb", "soul", "neo soul", "neo-soul"],
    dance: ["house", "dance", "electronic", "techno", "garage", "club"],
    gospel: ["gospel", "christian", "worship", "inspirational", "spiritual"],
    global: ["afrobeat", "afrobeats", "amapiano", "global", "reggae", "dancehall", "latin", "world"]
  };

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

  function shopPath() {
    const configuredPath = document.body?.dataset.shopPath;
    if (/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/$/i.test(configuredPath || "")) return configuredPath;
    const normalizedPath = window.location.pathname.replace(/index\.html$/i, "");
    return normalizedPath.startsWith("/music-upload") ? "/music-upload/" : "/music/";
  }

  function money(cents, currency = "USD") {
    if (cents == null || Number.isNaN(Number(cents))) return "";
    const code = String(currency || "USD").toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(Number(cents) / 100);
    } catch {
      return `${code} ${(Number(cents) / 100).toFixed(2)}`;
    }
  }

  // Only verified releases reach the public shop; "published" is the catalog's equivalent approved state.
  const APPROVED_RELEASE_STATUSES = new Set(["passed", "published"]);

  function isApprovedRelease(release) {
    return APPROVED_RELEASE_STATUSES.has(String(release?.status || "").trim().toLowerCase());
  }

  function catalogState(release) {
    return release?.catalog && typeof release.catalog === "object" ? release.catalog : {};
  }

  function storefrontState(release) {
    const storefront = release?.storefront && typeof release.storefront === "object" ? release.storefront : {};
    const fallback = String(storefront.statusLabel || "").trim().toUpperCase();
    const status = String(fallback || release?.publication?.dreamweaverStatus || release?.publication?.releaseStatus || release?.catalog?.saleStatus || "").trim().toLowerCase();
    return {
      ...storefront,
      statusLabel: ["pending", "queued", "processing", "coming_soon"].includes(status) ? "PENDING" : directAudioPreviewUrl(release) ? "READY" : "STANDBY"
    };
  }

  function resolvedAudio(release, options = {}) {
    const resolved = window.HaloReleaseArtwork?.resolveAudio(release, options);
    if (resolved) return resolved;
    const rawCandidate = String(release?.audioUrl || release?.audio_url || release?.sourceUrl || release?.previewAudio || release?.preview_audio || release?.streamUrl || "").trim();
    const candidate = rawCandidate ? safeUrl(rawCandidate) : "";
    return { src: candidate, source: candidate ? "legacy" : "", isPlayable: Boolean(candidate) };
  }

  function directAudioPreviewUrl(release) {
    return resolvedAudio(release, { preferPreview: true, requirePlayable: true }).src;
  }

  const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

  function isGoogleDriveUrl(value) {
    try {
      return GOOGLE_DRIVE_HOSTS.has(new URL(value).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  // Google Drive share links (/file/d/<id>/view, /open?id=<id>, /uc?id=<id>) point at an HTML viewer.
  // Publicly shared files can be streamed through the direct-download endpoint instead.
  function formatAudioStreamUrl(rawUrl) {
    const raw = String(rawUrl ?? "").trim();
    const url = raw ? safeUrl(raw) : "";
    if (!url || !isGoogleDriveUrl(url)) return url;
    const parsed = new URL(url);
    const fileId = parsed.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]+)/)?.[1] || parsed.searchParams.get("id") || "";
    if (!/^[\w-]{10,}$/.test(fileId)) return "";
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }

  function trackStreamUrl(release) {
    const direct = directAudioPreviewUrl(release);
    const directStream = direct ? formatAudioStreamUrl(direct) : "";
    if (directStream) return directStream;
    const resolved = resolvedAudio(release, { preferPreview: true });
    const driveCandidate = [...(resolved.candidates || []), resolved.src].find(isGoogleDriveUrl);
    return driveCandidate ? formatAudioStreamUrl(driveCandidate) : "";
  }

  function playTrackButton(release, { compact = false } = {}) {
    const audioUrl = trackStreamUrl(release);
    if (!audioUrl) return "";
    const artwork = releaseArtwork(release);
    const label = `Play ${release.title || "this release"}${release.artist ? ` by ${release.artist}` : ""}`;
    return `<button class="${compact ? "chart-play" : "action play"}" type="button" data-action="play-track" data-play-track-id="${escapeHtml(release.id)}" data-track-id="${escapeHtml(release.id)}" data-title="${escapeHtml(release.title)}" data-artist="${escapeHtml(release.artist)}" data-audio-url="${escapeHtml(audioUrl)}" data-cover="${escapeHtml(artwork.src)}"${compact ? ' data-play-compact="true"' : ""} aria-pressed="false" aria-label="${escapeHtml(label)}">${compact ? "▶" : "▶ Play"}</button>`;
  }

  class HaloGlobalPlayer {
    constructor({ onError } = {}) {
      this.audio = new Audio();
      this.audio.preload = "none";
      this.preloader = window.HaloAudioPreloader ? new window.HaloAudioPreloader(this.audio) : null;
      this.track = null;
      this.status = "idle";
      this.onError = onError;
      this.bar = null;
      this.delegatedClicks = false;
      this.audio.addEventListener("playing", () => this.setStatus("playing"));
      this.audio.addEventListener("waiting", () => { if (this.status === "playing") this.setStatus("loading"); });
      this.audio.addEventListener("pause", () => { if (this.status !== "error" && this.audio.paused) this.setStatus("paused"); });
      this.audio.addEventListener("ended", () => this.setStatus("paused"));
      this.audio.addEventListener("error", () => {
        if (this.track?.src && this.audio.src === this.track.src) this.fail("This preview could not be streamed right now.");
      });
    }

    static shared(options) {
      if (!(window.HaloPlayer instanceof HaloGlobalPlayer)) window.HaloPlayer = new HaloGlobalPlayer(options);
      return window.HaloPlayer;
    }

    mount() {
      if (this.bar?.isConnected) return this.bar;
      let bar = document.querySelector("#haloGlobalPlayerBar");
      if (!bar) {
        bar = document.createElement("section");
        bar.id = "haloGlobalPlayerBar";
        bar.className = "halo-player-bar";
        bar.hidden = true;
        bar.setAttribute("aria-label", "HALO shop player");
        bar.innerHTML = `<div class="player-track-info">
            <img id="haloPlayerCover" class="player-cover-art" alt="" data-player-cover>
            <div class="player-meta"><strong id="haloPlayerTitle" data-player-title></strong><span id="haloPlayerArtist" data-player-artist></span><small data-player-status aria-live="polite"></small></div>
          </div>
          <div class="player-controls">
            <button id="haloPlayerToggle" class="player-toggle-btn" type="button" data-player-toggle aria-label="Play">▶</button>
            <button class="player-close-btn" type="button" data-player-close aria-label="Close player">×</button>
          </div>`;
        document.body.append(bar);
      }
      this.bar = bar;
      if (bar.dataset.playerWired === "true") return bar;
      bar.dataset.playerWired = "true";
      bar.querySelector("[data-player-toggle]")?.addEventListener("click", () => this.toggle());
      bar.querySelector("[data-player-close]")?.addEventListener("click", () => this.close());
      bar.querySelector("[data-player-cover]")?.addEventListener("error", event => {
        if (!event.currentTarget.src.endsWith(fallbackArtwork)) event.currentTarget.src = fallbackArtwork;
      });
      return bar;
    }

    play(track) {
      const src = formatAudioStreamUrl(track?.src);
      if (!src) {
        this.track = track?.id ? { ...track, src: "" } : null;
        this.fail("No preview audio is available for this release yet.");
        return;
      }
      if (this.track?.id === track.id && this.track.src === src && this.status !== "error") {
        this.toggle();
        return;
      }
      this.preloader?.claim();
      this.track = { ...track, src };
      this.audio.preload = "auto";
      if (this.audio.src !== src || this.audio.error) this.audio.src = src;
      this.renderBar();
      this.resume();
      window.haloStats?.track("music_playback_start", { target: "shop_player", track: track.id });
    }

    resume() {
      if (!this.track?.src) return;
      if (this.status === "error") this.audio.src = this.track.src;
      this.setStatus("loading");
      const attempt = this.audio.play();
      attempt?.catch(error => {
        if (error?.name === "AbortError") return;
        this.fail(error?.name === "NotAllowedError" ? "Tap play again to start the preview." : "This preview could not be streamed right now.");
      });
    }

    toggle() {
      if (!this.track) return;
      if (this.status === "playing" || this.status === "loading") this.audio.pause();
      else this.resume();
    }

    close() {
      this.preloader?.clear();
      this.audio.pause();
      this.track = null;
      this.audio.removeAttribute("src");
      this.audio.load();
      this.setStatus("idle");
      if (this.bar) this.bar.hidden = true;
    }

    fail(message) {
      if (!this.track) {
        this.onError?.(message);
        return;
      }
      this.audio.pause();
      this.setStatus("error");
      this.onError?.(message, this.track);
    }

    setStatus(status) {
      this.status = status;
      this.renderBar();
      this.syncButtons();
    }

    renderBar() {
      const bar = this.mount();
      if (!this.track) return;
      bar.hidden = false;
      const cover = bar.querySelector("[data-player-cover]");
      const coverSrc = safeUrl(this.track.cover, fallbackArtwork);
      if (cover && cover.getAttribute("src") !== coverSrc) cover.src = coverSrc;
      bar.querySelector("[data-player-title]").textContent = this.track.title || "Untitled release";
      bar.querySelector("[data-player-artist]").textContent = this.track.artist || "HALO artist";
      bar.querySelector("[data-player-status]").textContent = { loading: "Loading preview…", playing: "Now playing", paused: "Paused", error: "Preview unavailable" }[this.status] || "";
      const toggle = bar.querySelector("[data-player-toggle]");
      const active = this.status === "playing" || this.status === "loading";
      toggle.textContent = active ? "❚❚" : "▶";
      toggle.setAttribute("aria-label", active ? "Pause" : "Play");
      toggle.disabled = !this.track.src;
      bar.classList.toggle("is-playing", this.status === "playing");
      bar.classList.toggle("is-error", this.status === "error");
    }

    syncButtons(root = document) {
      root.querySelectorAll("[data-play-track-id]").forEach(button => {
        const current = Boolean(this.track) && button.dataset.playTrackId === this.track.id;
        const active = current && (this.status === "playing" || this.status === "loading");
        const compact = button.dataset.playCompact === "true";
        button.classList.toggle("is-playing", active);
        button.classList.toggle("is-error", current && this.status === "error");
        button.setAttribute("aria-pressed", String(active));
        button.textContent = active ? (compact ? "❚❚" : "❚❚ Pause") : (compact ? "▶" : "▶ Play");
      });
    }
  }

  const player = HaloGlobalPlayer.shared({
    onError(message, track) {
      showToast(message);
      logMusicIssue("music_shop_player_error", "Shop player could not stream audio", { releaseId: track?.id || "", url: track?.src || "" });
    }
  });

  function availabilitySummary(release) {
    const catalog = catalogState(release);
    const rightsStatus = String(catalog.rightsStatus || "").toLowerCase();
    const saleStatus = String(catalog.saleStatus || "").toLowerCase();
    const metadataStatus = String(catalog.metadataStatus || "").toLowerCase();
    if (rightsStatus === "cleared" && saleStatus === "for_sale" && release.purchaseUrl) {
      return {
        badge: "Artist-controlled release",
        note: `Rights cleared in the shared song catalog${metadataStatus === "ready" ? " and marked release-ready" : ""}. Support opens through the artist-approved buy link.`
      };
    }
    if (rightsStatus === "cleared" && saleStatus === "coming_soon") {
      return {
        badge: "Support opens soon",
        note: "Public listening is open, while artist-controlled purchasing stays timed to the release window."
      };
    }
    if (rightsStatus && rightsStatus !== "cleared") {
      return {
        badge: "Listening open · rights review active",
        note: "Public listening can surface now, but product language stays rights-aware until ownership, samples, and splits are cleared."
      };
    }
    if (saleStatus === "not_for_sale" || !release.purchaseUrl) {
      return {
        badge: "Listening-first release",
        note: "This song is presented for public listening and sharing while direct purchase remains artist-controlled."
      };
    }
    return {
      badge: "Shared catalog source",
      note: "This public release is sourced from HALO’s shared catalog and campaign system."
    };
  }

  function buyActionLabel(release) {
    const catalog = catalogState(release);
    if (release.purchaseUrl && catalog.salePriceCents > 0) return `Buy / support · ${money(catalog.salePriceCents, catalog.currency)}`;
    if (release.purchaseUrl) return "Buy / support";
    if (resolvedAudio(release).src || release.streamUrl) return "Open stream";
    return "";
  }

  function licensingState(release) {
    const licensing = release?.licensing && typeof release.licensing === "object" ? release.licensing : {};
    const tiers = (Array.isArray(licensing.tiers) ? licensing.tiers : [])
      .filter(tier => tier && typeof tier === "object" && tier.id && tier.label);
    const versions = (Array.isArray(licensing.versions) ? licensing.versions : [])
      .filter(version => version && typeof version === "object" && version.id && version.label);
    return {
      enabled: Boolean(licensing.enabled) && tiers.length > 0,
      tiers,
      versions,
      reviewNote: String(licensing.reviewNote || ""),
      checkoutMode: String(licensing.checkoutMode || "")
    };
  }

  function licensingTierNote(tier, release) {
    if (!tier) return "";
    const price = tier.priceCents > 0 ? `${money(tier.priceCents, tier.currency)} · ` : "";
    const review = tier.requiresRightsReview
      ? "Rights review and artist approval stay required before this licence is issued."
      : "";
    const checkout = release?.purchaseUrl
      ? "Selections carry through to the artist-approved buy / support link."
      : "Selections are sent to the artist team for an approval-gated licensing reply.";
    return `${price}${tier.summary || ""} ${review} ${checkout}`.replace(/\s+/g, " ").trim();
  }

  function licensingMarkup(release) {
    const licensing = licensingState(release);
    if (!licensing.enabled) return "";
    const versionOptions = licensing.versions.length
      ? licensing.versions
      : [{ id: "master", label: "Master copy" }];
    return `<section class="shop-licensing" aria-label="Version and licence selection" data-halo-guide="Choose a version and licence tier. Commercial selections are sent to the artist team for approval before any rights are granted." data-halo-guide-title="Licensing" data-licensing-panel data-licensing-release="${escapeHtml(release.id)}">
      <span class="shop-eyebrow">Licensing</span>
      <div class="licensing-selects">
        <label>Version
          <select data-licensing-version>${versionOptions.map(version => `<option value="${escapeHtml(version.id)}">${escapeHtml(version.label)}</option>`).join("")}</select>
        </label>
        <label>Licence
          <select data-licensing-tier>${licensing.tiers.map(tier => `<option value="${escapeHtml(tier.id)}">${escapeHtml(tier.label)}${tier.priceCents > 0 ? ` · ${escapeHtml(money(tier.priceCents, tier.currency))}` : ""}</option>`).join("")}</select>
        </label>
      </div>
      <p class="licensing-note" data-licensing-note>${escapeHtml(licensingTierNote(licensing.tiers[0], release))}</p>
      <p class="licensing-review">${escapeHtml(licensing.reviewNote)}</p>
    </section>`;
  }

  function applyLicensingSelection(scope) {
    const panel = scope?.querySelector("[data-licensing-panel]");
    if (!panel) return;
    const release = state.releases.find(item => item.id === panel.dataset.licensingRelease);
    const licensing = licensingState(release);
    if (!licensing.enabled) return;
    const versionId = panel.querySelector("[data-licensing-version]")?.value || "";
    const tierId = panel.querySelector("[data-licensing-tier]")?.value || "";
    const tier = licensing.tiers.find(item => item.id === tierId) || licensing.tiers[0];
    const note = panel.querySelector("[data-licensing-note]");
    if (note) note.textContent = licensingTierNote(tier, release);
    const buyLink = scope.querySelector("a.action.buy");
    const baseHref = safeUrl(release?.purchaseUrl || "");
    if (!buyLink || !baseHref) return;
    try {
      const url = new URL(baseHref);
      if (versionId) url.searchParams.set("version", versionId);
      if (tier?.id) url.searchParams.set("license", tier.id);
      buyLink.href = url.href;
    } catch {
      /* keep the existing artist-approved link when it cannot be extended */
    }
  }

  function shareUrlForRelease(release) {
    const url = new URL(shopPath(), window.location.origin);
    url.searchParams.set("song", release.id);
    return url.toString();
  }

  function updateShopUrl(release) {
    if (!release?.id) return;
    const currentUrl = new URL(window.location.href);
    const url = new URL(window.location.href);
    url.pathname = shopPath();
    url.searchParams.set("song", release.id);
    if (`${currentUrl.pathname}${currentUrl.search}` === `${url.pathname}${url.search}`) return;
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function setHeadMeta(selector, content) {
    const node = document.head.querySelector(selector);
    if (node && content) node.setAttribute("content", content);
  }

  function updateShopHead(release) {
    if (!release) return;
    const availability = availabilitySummary(release);
    document.title = `${release.title} — ${release.artist} | HALO Shop`;
    setHeadMeta('meta[name="description"]', release.pitch || availability.note);
    setHeadMeta('meta[property="og:title"]', `${release.title} — ${release.artist} | HALO Shop`);
    setHeadMeta('meta[property="og:description"]', release.pitch || availability.note);
    setHeadMeta('meta[name="twitter:title"]', `${release.title} — ${release.artist} | HALO Shop`);
    setHeadMeta('meta[name="twitter:description"]', release.pitch || availability.note);
    const artwork = releaseArtwork(release);
    setHeadMeta('meta[property="og:image"]', artwork.src);
    setHeadMeta('meta[name="twitter:image"]', artwork.src);
  }

  const CATALOG_FRAME_MIN_HEIGHT = 960;

  function sharedCatalogFrameUrl() {
    const url = new URL("/song-catalog/", window.location.origin);
    url.searchParams.set("embed", "shop");
    url.searchParams.set("parentOrigin", window.location.origin);
    return url.toString();
  }

  function syncSharedCatalogFrameHeight(nextHeight) {
    if (!elements.sharedCatalogFrame) return;
    const safeHeight = Number(nextHeight);
    if (!Number.isFinite(safeHeight) || safeHeight < 0) return;
    elements.sharedCatalogFrame.style.height = `${Math.max(CATALOG_FRAME_MIN_HEIGHT, Math.ceil(safeHeight))}px`;
  }

  function handleSharedCatalogFrameMessage(event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== "halo-song-catalog-height") return;
    if (event.source !== elements.sharedCatalogFrame?.contentWindow) return;
    syncSharedCatalogFrameHeight(event.data.height);
  }

  function loadSharedCatalogFrame() {
    const frame = elements.sharedCatalogFrame;
    if (!frame || frame.dataset.loaded === "true") return;
    frame.src = frame.dataset.src || sharedCatalogFrameUrl();
    frame.dataset.loaded = "true";
  }

  function releaseArtwork(release) {
    const src = safeUrl(release?.artwork, fallbackArtwork);
    const fallbackSrc = safeUrl(fallbackArtwork, fallbackArtwork);
    return window.HaloReleaseArtwork?.resolve(release, fallbackArtwork) || {
      src,
      fallback: fallbackArtwork,
      source: src === fallbackSrc ? "fallback" : "legacy"
    };
  }

  function artworkAttributes(artwork) {
    return `data-artwork-source="${escapeHtml(artwork?.source || "")}" data-artwork-badge="${escapeHtml(fallbackArtworkBadge)}"`;
  }

  function wireArtwork(root) {
    window.HaloReleaseArtwork?.wire(root, fallbackArtwork);
  }

  function logMusicIssue(eventType, title, details) {
    console.warn("[HALO Music]", title, details);
    window.dispatchEvent(new CustomEvent("halo:journal-event", {
      detail: { eventType, category: "problem", targetName: title, details, immediate: true }
    }));
  }

  function formatReleaseDate(value) {
    if (!value) return "Date to be announced";
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return "Date to be announced";
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const difference = date.getTime() - todayUtc;
    const formatted = new Intl.DateTimeFormat("en", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
    }).format(date);
    if (difference === 0) return "Out today";
    return difference > 0 ? `Arrives ${formatted}` : `Released ${formatted}`;
  }

  function technicalLine(release) {
    return [release.duration, release.bpm ? `${release.bpm} BPM` : "", release.musicalKey]
      .filter(Boolean)
      .join(" · ");
  }

  function releaseStoryline(release) {
    if (release.pitch) return release.pitch;
    const availability = availabilitySummary(release);
    const genres = Array.isArray(release.genres) ? release.genres : [];
    const primaryGenre = genres[0] ? `${genres[0]} signal` : "HALO signal";
    return `${release.artist} in focus through the public shop front with a ${primaryGenre}. ${availability.note}`;
  }

  function releaseDossier(release) {
    const statusLabel = storefrontState(release).statusLabel || "STANDBY";
    return [
      { label: "Release status", value: statusLabel },
      { label: "Chart", value: release.isChartEligible ? "Chart eligible" : "Listening only" },
      release.isrc
        ? { label: "ISRC", value: release.isrc, guide: "Official ISRC recording identifier for this release. Copy it for licensing, playlist pitches, or rights paperwork.", guideAction: "copy-isrc", isrc: release.isrc }
        : { label: "ISRC", value: "Pending" },
      { label: "Support", value: release.purchaseUrl ? "Direct link live" : "Listen link live" }
    ];
  }

  function dossierItemMarkup(item) {
    const guide = item.guide
      ? ` tabindex="0" data-halo-guide="${escapeHtml(item.guide)}" data-halo-guide-title="${escapeHtml(item.label)}"${item.guideAction ? ` data-halo-guide-action="${escapeHtml(item.guideAction)}"` : ""}${item.isrc ? ` data-isrc="${escapeHtml(item.isrc)}"` : ""}`
      : "";
    return `<li${guide}><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></li>`;
  }

  function normalized(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function releaseAgeInDays(release) {
    if (!release.releaseDate) return 365;
    const released = new Date(`${release.releaseDate}T00:00:00Z`).getTime();
    if (Number.isNaN(released)) return 365;
    if (released > Date.now()) return 365;
    return Math.max(0, Math.floor((Date.now() - released) / 86_400_000));
  }

  function chartSignal(release) {
    const activity = release.chartActivity || {};
    const recent = Number(activity.recentListens || 0) * 8 + Number(activity.recentOpens || 0) * 3;
    const previous = Number(activity.previousListens || 0) * 8 + Number(activity.previousOpens || 0) * 3;
    const freshness = Math.max(0, 30 - releaseAgeInDays(release)) / 3;
    return { recent, previous, score: recent * 2 + previous + freshness };
  }

  function movementFor(release) {
    const signal = chartSignal(release);
    const difference = signal.recent - signal.previous;
    if (releaseAgeInDays(release) <= 14 && signal.previous === 0) return { label: "New", direction: "new", value: "NEW" };
    if (difference > 0) return { label: "Rising", direction: "up", value: `+${difference}` };
    if (difference < 0) return { label: "Cooling", direction: "down", value: String(difference) };
    return { label: "Holding", direction: "steady", value: "—" };
  }

  function releaseMatchesRoom(release) {
    const roomGenres = chartRooms[state.chartRoom] || [];
    if (!roomGenres.length) return true;
    const genres = release.genres.map(normalized);
    return roomGenres.some(roomGenre => genres.some(genre => genre.includes(normalized(roomGenre))));
  }

  function isChartRelease(release) {
    return release.isLiveVisible !== false
      && release.isChartEligible !== false
      && (release.inChart === true || release.releaseStatus === "PUBLISHED" || release.isChartEligible === true);
  }

  function rankedReleases() {
    const entries = state.releases
      .filter(release => {
        if (!isChartRelease(release)) {
          logMusicIssue("music_chart_eligibility_skipped", "Release skipped from chart: not chart-eligible", { releaseId: release.id, title: release.title, isCleanVersion: release.isCleanVersion });
          return false;
        }
        return releaseMatchesRoom(release);
      })
      .map(release => ({ release, signal: chartSignal(release) }));
    if (state.chartSort === "newest") {
      entries.sort((a, b) => new Date(b.release.releaseDate).getTime() - new Date(a.release.releaseDate).getTime());
    } else if (state.chartSort === "listens") {
      entries.sort((a, b) => b.signal.recent - a.signal.recent || new Date(b.release.releaseDate).getTime() - new Date(a.release.releaseDate).getTime());
    } else if (state.chartSort === "opens") {
      entries.sort((a, b) => (b.release.chartActivity?.recentOpens || 0) - (a.release.chartActivity?.recentOpens || 0) || new Date(b.release.releaseDate).getTime() - new Date(a.release.releaseDate).getTime());
    } else {
      entries.sort((a, b) => b.signal.score - a.signal.score || new Date(b.release.releaseDate).getTime() - new Date(a.release.releaseDate).getTime());
    }
    return entries.slice(0, 10).map(entry => entry.release);
  }

  function renderChartSort() {
    elements.chartSortButtons?.querySelectorAll("[data-chart-sort]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.chartSort === state.chartSort));
    });
  }

  function hasSafeMediaUrl(value) {
    return Boolean(String(value || "").trim() && safeUrl(value));
  }

  function isPlayableVideo(video) {
    if (!video) return false;
    if (video.sourceType === "youtube") return hasSafeMediaUrl(video.embedUrl);
    return hasSafeMediaUrl(video.sourceUrl);
  }

  function youtubeEmbedFromUrl(value) {
    const urlText = safeUrl(value);
    if (!urlText) return "";
    try {
      const url = new URL(urlText);
      const host = url.hostname.replace(/^www\./, "");
      const id = host === "youtu.be"
        ? url.pathname.split("/").filter(Boolean)[0]
        : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop();
      return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    } catch {
      return "";
    }
  }

  function directVideoForRelease(release) {
    const candidates = [
      release?.promoVideoUrl,
      release?.videoUrl,
      release?.catalog?.promoVideoUrl,
      release?.catalog?.videoUrl
    ].map(value => safeUrl(value)).filter(Boolean);
    for (const candidate of candidates) {
      const embedUrl = youtubeEmbedFromUrl(candidate);
      if (embedUrl) {
        return {
          id: `release-video-${release.id}`,
          title: `${release.title} promo`,
          sourceType: "youtube",
          sourceUrl: candidate,
          embedUrl,
          thumbnailUrl: releaseArtwork(release).src
        };
      }
      if (/\.(mp4|webm|mov)(?:$|[?#])/i.test(candidate) || /\/api\/videos(?:$|\?)/i.test(candidate)) {
        return {
          id: `release-video-${release.id}`,
          title: `${release.title} promo`,
          sourceType: "upload",
          sourceUrl: candidate,
          embedUrl: "",
          thumbnailUrl: releaseArtwork(release).src
        };
      }
    }
    return null;
  }

  function fallbackVideoForRelease(release) {
    if (!satelliteVideoFallbackEnabled) return null;
    return {
      id: `fallback-${release.id}`,
      sourceType: "fallback-visual",
      title: `${release.title} visual`,
      thumbnailUrl: releaseArtwork(release).src,
      isFallbackVisual: true
    };
  }

  function privacyEnhancedEmbedUrl(value) {
    const embed = safeUrl(value);
    if (!embed) return "";
    try {
      const url = new URL(embed);
      if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) url.hostname = "www.youtube-nocookie.com";
      return url.href;
    } catch {
      return embed.replace("www.youtube.com", "www.youtube-nocookie.com");
    }
  }

  function releaseMatchesVideoCandidate(release, videoItem) {
    const title = normalized(release.title);
    const artist = normalized(release.artist);
    const videoTitle = normalized(videoItem.title);
    const videoArtist = normalized(videoItem.artistName);
    return (title && (videoTitle.includes(title) || title.includes(videoTitle)))
      || (artist && videoArtist === artist && videoTitle.split(" ").some(word => word.length > 4 && title.includes(word)));
  }

  function videoForRelease(release) {
    const direct = directVideoForRelease(release);
    if (direct) return direct;
    const video = state.videos.find(videoItem => {
      if (satelliteVideoFallbackEnabled && !isPlayableVideo(videoItem)) return false;
      return releaseMatchesVideoCandidate(release, videoItem);
    });
    return video || fallbackVideoForRelease(release);
  }

  function videoMarkup(video, release) {
    if (!video) {
      return `<div class="stage-video-empty"><span>HALO TV</span><strong>Footage lane open</strong><p>When approved footage is attached to this release, it plays here without sending listeners away from the chart.</p></div>`;
    }
    const thumbnail = safeUrl(video.thumbnailUrl, releaseArtwork(release).src);
    if (video.isFallbackVisual) {
      return `<button class="stage-video-poster" type="button" data-play-chart-video="${escapeHtml(video.id)}" data-video-fallback="visual">
      <img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(`${release.title} fallback visual artwork`)}" loading="lazy">
      <span class="video-play" aria-hidden="true">▶</span><span><small>Fallback visual</small><strong>Play ${escapeHtml(release.title)} visual</strong></span>
    </button>`;
    }
    return `<button class="stage-video-poster" type="button" data-play-chart-video="${escapeHtml(video.id)}">
      <img src="${escapeHtml(thumbnail)}" alt="" loading="lazy">
      <span class="video-play" aria-hidden="true">▶</span><span><small>Watch inside the chart</small><strong>${escapeHtml(video.title)}</strong></span>
    </button>`;
  }

  function playFallbackVisual(video, poster) {
    const frame = document.createElement("div");
    frame.className = "stage-video-frame";
    frame.innerHTML = `<div class="stage-video-fallback-visual">
      <img src="${escapeHtml(safeUrl(video.thumbnailUrl, fallbackArtwork))}" alt="${escapeHtml(`${video.title} fallback visual artwork`)}" loading="eager">
      <div class="stage-video-fallback-copy"><span>HALO TV</span><strong>${escapeHtml(video.title)}</strong></div>
    </div>`;
    poster.replaceWith(frame);
  }

  function playChartVideo(videoId) {
    const releaseForFallback = satelliteVideoFallbackEnabled
      ? state.releases.find(release => `fallback-${release.id}` === videoId)
      : null;
    const matchedVideo = state.videos.find(item => item.id === videoId);
    const releaseForMatchedVideoFallback = satelliteVideoFallbackEnabled && matchedVideo && !isPlayableVideo(matchedVideo)
      ? state.releases.find(release => release.id === state.activeReleaseId)
      : null;
    const video = (satelliteVideoFallbackEnabled && matchedVideo && !isPlayableVideo(matchedVideo))
      ? fallbackVideoForRelease(releaseForMatchedVideoFallback)
      : (matchedVideo || fallbackVideoForRelease(releaseForFallback));
    const poster = elements.chartStage.querySelector("[data-play-chart-video]");
    if (!video || !poster) return;
    if (video.isFallbackVisual) {
      playFallbackVisual(video, poster);
      window.haloStats?.track("play_halo_video", { target: "fallback_visual", track: state.activeReleaseId });
      return;
    }
    const source = safeUrl(video.sourceUrl);
    const embed = privacyEnhancedEmbedUrl(video.embedUrl);
    let youtubeEmbed = `${embed}${embed.includes("?") ? "&" : "?"}autoplay=1&rel=0`;
    try {
      const embedUrl = new URL(embed);
      embedUrl.searchParams.set("autoplay", "1");
      embedUrl.searchParams.set("rel", "0");
      youtubeEmbed = embedUrl.href;
    } catch {}
    const player = video.sourceType === "youtube"
      ? `<iframe src="${escapeHtml(youtubeEmbed)}" title="${escapeHtml(video.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : `<video src="${escapeHtml(source)}" controls autoplay playsinline></video>`;
    const frame = document.createElement("div");
    frame.className = "stage-video-frame";
    frame.innerHTML = player;
    poster.replaceWith(frame);
    window.haloStats?.track("play_halo_video", { target: video.id, track: state.activeReleaseId });
  }

  function renderChartStage(release, position) {
    if (!release) return;
    const artwork = releaseArtwork(release);
    state.activeReleaseId = release.id;
    const movement = movementFor(release);
    const activity = release.chartActivity || {};
    const video = videoForRelease(release);
    elements.chartStage.innerHTML = `<article class="stage-card">
      <div class="stage-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}" ${artworkAttributes(artwork)}><span class="stage-rank">#${position}</span></div>
      <div class="stage-copy">
        <div class="stage-kicker"><span>${escapeHtml(movement.label)}</span><span>${escapeHtml(release.genres.join(" · ") || "HALO release")}</span></div>
        <h3>${escapeHtml(release.title)}</h3><p class="stage-artist">${escapeHtml(release.artist)}</p>
        <p class="stage-story">${escapeHtml(release.pitch || "Open the full release signal and approved campaign room.")}</p>
        <div class="stage-metrics"><span><strong>${Number(activity.recentListens || 0)}</strong>Listen exits</span><span><strong>${Number(activity.recentOpens || 0)}</strong>Room opens</span><span><strong>${escapeHtml(movement.value)}</strong>Momentum</span></div>
        ${videoMarkup(video, release)}
        ${releaseActions(release)}
      </div>
    </article>`;
    player.syncButtons(elements.chartStage);
    wireArtwork(elements.chartStage);
  }

  function renderChart() {
    const releases = rankedReleases();
    elements.chartRooms.querySelectorAll("[data-chart-room]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.chartRoom === state.chartRoom));
    });
    renderChartSort();
    if (!releases.length) {
      state.activeReleaseId = "";
      elements.chartBoard.innerHTML = `<div class="chart-empty"><strong>This room is waiting for its first signal.</strong><p>Tag a published release with this room’s genre and it enters the live ranking automatically.</p></div>`;
      elements.chartStage.innerHTML = `<div class="stage-empty"><span class="stage-number">0</span><p>No qualifying releases are published in this chart room yet.</p></div>`;
      return;
    }
    if (!releases.some(release => release.id === state.activeReleaseId)) state.activeReleaseId = releases[0].id;
    elements.chartBoard.innerHTML = `<div class="chart-column-labels"><span>Position</span><span>Record</span><span>7-day motion</span></div>${releases.map((release, index) => {
      const movement = movementFor(release);
      const active = release.id === state.activeReleaseId;
      const artwork = releaseArtwork(release);
      const playButton = playTrackButton(release, { compact: true });
      const chartGuide = playButton
        ? ` data-halo-guide="Open #${index + 1} in the chart stage for artwork, story and movement — or quick listen without leaving the chart." data-halo-guide-title="Living Chart" data-halo-guide-action="quick-listen"`
        : ` data-halo-guide="Open #${index + 1} in the chart stage for artwork, story, movement and the listening link." data-halo-guide-title="Living Chart"`;
      return `<div class="chart-entry${playButton ? " has-play" : ""}" data-halo-guide-scope><button class="chart-row${active ? " is-active" : ""}" type="button" data-chart-release="${escapeHtml(release.id)}" aria-pressed="${active}"${chartGuide}>
        <span class="chart-position">${String(index + 1).padStart(2, "0")}</span>
        <span class="chart-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="" loading="lazy" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}" ${artworkAttributes(artwork)}></span>
        <span class="chart-track"><strong>${escapeHtml(release.title)}</strong><small>${escapeHtml(release.artist)} · ${escapeHtml(release.genres[0] || "HALO")}</small></span>
        <span class="chart-motion is-${movement.direction}"><b>${escapeHtml(movement.value)}</b><small>${escapeHtml(movement.label)}</small></span>
        <span class="chart-open" aria-hidden="true">OPEN ↗</span>
      </button>${playButton}</div>`;
    }).join("")}`;
    player.syncButtons(elements.chartBoard);
    wireArtwork(elements.chartBoard);
    renderChartStage(releases.find(release => release.id === state.activeReleaseId), releases.findIndex(release => release.id === state.activeReleaseId) + 1);
  }


  function showToast(message) {
    if (!elements.toast) {
      window.alert(message);
      return;
    }
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
  }

  async function copyCatalogAddress() {
    const address = `${window.location.origin}${shopPath()}`;
    try {
      await navigator.clipboard.writeText(address);
      showToast("HALO shop address copied");
      elements.copy.textContent = "Address copied";
    } catch {
      window.prompt("Copy the HALO shop address", address);
    }
  }

  async function shareCatalog() {
    const shareData = {
      title: "HALO Shop",
      text: "Listen, buy, and share artist-controlled HALO songs from one public shop front.",
      url: `${window.location.origin}${shopPath()}`
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyCatalogAddress();
  }

  function selectedShopRelease() {
    return state.releases.find(release => release.id === state.activeShopId)
      || state.releases.find(candidate => candidate.id === requestedReleaseId)
      || (configuredFeaturedReleaseId ? state.releases.find(candidate => candidate.id === configuredFeaturedReleaseId) : null)
      || state.releases.find(r => r.featuredType === "week")
      || state.releases.find(r => r.featuredType === "month")
      || state.releases[0]
      || null;
  }

  function releaseMeta(release) {
    const genres = release.genres.length ? release.genres.join(" · ") : "HALO release";
    return `<div class="release-meta"><span>${escapeHtml(formatReleaseDate(release.releaseDate))}</span><span>${escapeHtml(genres)}</span>${technicalLine(release) ? `<span>${escapeHtml(technicalLine(release))}</span>` : ""}</div>`;
  }

  function featuredBadge(release) {
    if (release.featuredType === "week") return `<span class="featured-badge is-week">Song of the Week</span>`;
    if (release.featuredType === "month") return `<span class="featured-badge is-month">Song of the Month</span>`;
    return "";
  }

  function relatedReleases(release) {
    const stableArtistId = String(release.artistSlug || "").trim().toLowerCase();
    const fallbackArtistName = normalized(release.artist);
    return state.releases
      .filter(item => {
        if (item.id === release.id) return false;
        const itemArtistId = String(item.artistSlug || "").trim().toLowerCase();
        if (stableArtistId && itemArtistId) return itemArtistId === stableArtistId;
        return normalized(item.artist) === fallbackArtistName;
      })
      .slice(0, 3);
  }

  function featuredDetailMarkup(release) {
    const availability = availabilitySummary(release);
    const catalog = catalogState(release);
    const previewUrl = trackStreamUrl(release);
    const related = relatedReleases(release);
    const dossier = releaseDossier(release);
    const versionCount = Number(catalog.versionCount || release.availableVersions?.length || 0);
    const saleEnabledCount = Number(catalog.saleEnabledVersionCount || 0);
    const availableVersions = (release.availableVersions || []).filter(Boolean).slice(0, 4);
    const artistContext = related.length
      ? `Related songs by ${release.artist} stay grouped here so the artist controls one public listening and support surface.`
      : `${release.artist} stays present through HALO’s public catalog, artist rooms, and approved release destinations.`;
    return `<div class="shop-panel">
      <section class="shop-preview-card" aria-label="Listening and rights information">
        <span class="shop-eyebrow">Shop spotlight</span>
        <strong class="shop-badge">${escapeHtml(availability.badge)}</strong>
        <p class="availability-note">${escapeHtml(availability.note)}</p>
        ${previewUrl ? `<div class="preview-shell"><span>Direct preview</span><p>Press play to stream this release in the HALO player bar while you keep browsing the shop.</p></div>` : `<div class="preview-shell"><span>Public listening</span><p>Use the listen link for the approved public destination. Direct in-page audio appears automatically when the shared catalog points to a preview-safe stream.</p></div>`}
        <dl class="shop-facts">
          <div><dt>Catalog source</dt><dd>${catalog.source === "song-catalog" ? "Shared song catalog" : "Published release campaign"}</dd></div>
          <div><dt>Versions mapped</dt><dd>${versionCount || "—"}</dd></div>
          <div><dt>Sale-enabled versions</dt><dd>${saleEnabledCount || "—"}</dd></div>
        </dl>
      </section>
      <section class="shop-artist-card" aria-label="Artist context and related songs">
        <span class="shop-eyebrow">Artist context</span>
        <strong>${escapeHtml(release.artist)}</strong>
        <p>${escapeHtml(artistContext)}</p>
        <ul class="release-dossier">${dossier.map(dossierItemMarkup).join("")}</ul>
        <div class="version-pill-row">${availableVersions.length ? availableVersions.map(version => `<span class="version-pill">${escapeHtml(version)}</span>`).join("") : '<span class="version-pill">Artist-controlled release path</span>'}</div>
        <div class="related-release-list">${related.length ? related.map(item => `<button class="related-release" type="button" data-select-release="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>`).join("") : '<a class="related-release related-release-link" href="/artists/">Browse HALO artist rooms</a>'}</div>
      </section>
      ${licensingMarkup(release)}
    </div>`;
  }

  function releaseActions(release, options = {}) {
    const { includeCopy = false, includeSelect = false } = options;
    const listenHref = safeUrl(release.listenUrl);
    if (!listenHref) logMusicIssue("music_listen_url_missing", "Music release missing listen link", { releaseId: release.id, title: release.title });
    const listenAction = listenHref
      ? `<a class="action primary" href="${escapeHtml(listenHref)}" data-stat-event="open_catalog_release" data-stat-target="${escapeHtml(release.id)}">Listen now <span aria-hidden="true">↗</span></a>`
      : `<span class="action primary" aria-disabled="true">Listen link unavailable</span>`;
    const buyHref = safeUrl(release.purchaseUrl || resolvedAudio(release).src || release.streamUrl);
    const buyAction = buyHref
      ? `<a class="action buy" href="${escapeHtml(buyHref)}" target="_blank" rel="noopener" data-halo-guide="Opens the artist-approved purchase or streaming destination in a new tab, so you keep your place in the HALO shop." data-halo-guide-title="Buy" data-stat-event="buy_release" data-stat-target="${escapeHtml(release.id)}">${escapeHtml(buyActionLabel(release))} <span aria-hidden="true">↗</span></a>`
      : "";
    if (!buyHref && release.isChartEligible) logMusicIssue("music_purchase_url_missing", "Music release missing buy/stream link", { releaseId: release.id, title: release.title });
    return `<div class="release-actions">
      ${featuredBadge(release)}
      ${playTrackButton(release)}
      ${listenAction}
      ${buyAction}
      ${includeSelect ? `<button class="action tertiary" type="button" data-select-release="${escapeHtml(release.id)}">View in shop</button>` : ""}
      <button class="action tertiary" type="button" data-share-release="${escapeHtml(release.id)}">Share song</button>
      ${includeCopy ? `<button class="action tertiary" type="button" data-copy-release="${escapeHtml(release.id)}">Copy link</button>` : ""}
      <a class="action secondary" href="${escapeHtml(safeUrl(release.kitUrl))}" data-stat-event="open_release_kit" data-stat-target="${escapeHtml(release.id)}">Release room</a>
    </div>`;
  }

  function renderFeatured({ focusHeading = false } = {}) {
    const release = selectedShopRelease();
    if (configuredFeaturedReleaseId && !state.releases.some(candidate => candidate.id === configuredFeaturedReleaseId)) {
      logMusicIssue("music_featured_release_missing", "Configured featured release missing from catalog", { releaseId: configuredFeaturedReleaseId });
    }
    if (!release) {
      elements.featured.innerHTML = `<div class="catalog-empty"><div><strong>The next signal is being prepared.</strong><p>Published HALO releases appear here automatically.</p></div></div>`;
      return;
    }
    state.activeShopId = release.id;
    updateShopUrl(release);
    updateShopHead(release);
    const artwork = releaseArtwork(release);
    elements.featured.innerHTML = `<article class="featured-release">
      <div class="featured-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" width="1200" height="1200" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}" ${artworkAttributes(artwork)}></div>
      <div class="featured-copy"><div>${releaseMeta(release)}<h2 data-featured-heading tabindex="-1">${escapeHtml(release.title)}</h2><p class="featured-artist">${escapeHtml(release.artist)}</p><p class="featured-pitch">${escapeHtml(release.pitch || "Open the official release signal, approved listening destination, and campaign room.")}</p>${featuredDetailMarkup(release)}</div>${releaseActions(release, { includeCopy: true })}</div>
    </article>`;
    player.syncButtons(elements.featured);
    wireArtwork(elements.featured);
    applyLicensingSelection(elements.featured);
    if (focusHeading) elements.featured.querySelector("[data-featured-heading]")?.focus({ preventScroll: true });
  }

  function filteredReleases() {
    const query = state.query.toLowerCase();
    const filtered = state.releases.filter(release => {
      const matchesGenre = state.genre === "all" || release.genres.some(genre => genre.toLowerCase() === state.genre);
      const haystack = [release.title, release.artist, release.pitch, ...release.genres].join(" ").toLowerCase();
      return matchesGenre && (!query || haystack.includes(query));
    });
    if (state.sort === "oldest") {
      filtered.sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());
    } else if (state.sort === "az") {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    } else if (state.sort === "za") {
      filtered.sort((a, b) => b.title.localeCompare(a.title));
    } else if (state.sort === "artist") {
      filtered.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    }
    return filtered;
  }

  function renderGenres() {
    const genres = [...new Set(state.releases.flatMap(release => release.genres.map(genre => genre.trim()).filter(Boolean)))].sort();
    elements.genres.innerHTML = ["All", ...genres].map(label => {
      const value = label.toLowerCase();
      return `<button type="button" data-genre="${escapeHtml(value)}" aria-pressed="${state.genre === value}">${escapeHtml(label)}</button>`;
    }).join("");
  }

  function renderGrid() {
    const releases = filteredReleases();
    elements.count.textContent = `${state.releases.length} ${state.releases.length === 1 ? "release" : "releases"} · one link`;
    if (!releases.length) {
      elements.grid.innerHTML = `<div class="catalog-empty"><div><strong>No signal found.</strong><p>Try another title, artist, or genre to restore the full transmission.</p><button type="button" id="clearCatalogFilters">Clear filters</button></div></div>`;
      document.querySelector("#clearCatalogFilters")?.addEventListener("click", () => {
        state.query = "";
        state.genre = "all";
        elements.search.value = "";
        renderGenres();
        renderGrid();
      });
      return;
    }
    elements.grid.innerHTML = releases.map((release, index) => {
      const artwork = releaseArtwork(release);
     const availability = availabilitySummary(release);
     const dossier = releaseDossier(release).slice(0, 2);
     const cardKicker = release.featuredType === "week"
       ? "Song of the Week"
       : (release.featuredType === "month" ? "Song of the Month" : "Editorial pick");
     const cardDateLabel = release.releaseDate ? formatReleaseDate(release.releaseDate) : "";
     const cardGuide = trackStreamUrl(release)
       ? ` tabindex="0" data-halo-guide="Preview ${escapeHtml(release.title)} in the HALO player bar while you keep browsing." data-halo-guide-title="Quick listen" data-halo-guide-action="quick-listen"`
       : "";
     return `<article class="release-card" data-halo-guide-scope>
      <div class="card-art release-artwork-frame" data-artwork-frame${cardGuide}><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" loading="lazy" width="900" height="900" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}" ${artworkAttributes(artwork)}><span class="card-number">${String(index + 1).padStart(2, "0")}</span></div>
     <div class="card-copy"><p class="card-kicker"><span>${escapeHtml(cardKicker)}</span>${cardDateLabel ? `<span>${escapeHtml(cardDateLabel)}</span>` : ""}</p>${releaseMeta(release)}<h3>${escapeHtml(release.title)}</h3><p class="card-artist">${escapeHtml(release.artist)}</p><p class="card-availability">${escapeHtml(availability.badge)}</p><p class="card-pitch">${escapeHtml(releaseStoryline(release))}</p><ul class="card-facts">${dossier.map(dossierItemMarkup).join("")}</ul>${releaseActions(release, { includeSelect: true })}</div>
    </article>`;
    }).join("");
    player.syncButtons(elements.grid);
    wireArtwork(elements.grid);
  }

  function renderError(message) {
    logMusicIssue("music_catalog_error", "Music catalog load failure", { message, page: window.location.pathname });
    const markup = `<div class="catalog-empty"><div><strong>Signal interrupted.</strong><p>${escapeHtml(message)}</p><button type="button" id="retryCatalog">Try again</button></div></div>`;
    elements.featured.innerHTML = markup;
    elements.chartBoard.innerHTML = markup;
    elements.chartStage.innerHTML = `<div class="stage-empty"><span class="stage-number">!</span><p>${escapeHtml(message)}</p></div>`;
    elements.grid.innerHTML = markup;
    document.querySelectorAll("#retryCatalog").forEach(button => button.addEventListener("click", loadCatalog));
    elements.count.textContent = "Catalog unavailable";
  }

  async function loadCatalog() {
    try {
      const response = await fetch("/api/release-catalog", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The catalog could not be loaded.");
      state.releases = (Array.isArray(data.releases) ? data.releases : []).filter(isApprovedRelease);
      if (!state.activeShopId) {
        const preferredId = state.releases.some(release => release.id === requestedReleaseId)
          ? requestedReleaseId
          : (configuredFeaturedReleaseId && state.releases.some(release => release.id === configuredFeaturedReleaseId) ? configuredFeaturedReleaseId : state.releases[0]?.id || "");
        state.activeShopId = preferredId;
      }
      renderFeatured();
      renderChart();
      renderGenres();
      renderGrid();
      fetch("/api/videos", { headers: { Accept: "application/json" } })
        .then(videoResponse => videoResponse.ok ? videoResponse.json() : { videos: [] })
        .then(videoData => {
          state.videos = Array.isArray(videoData.videos) ? videoData.videos : [];
          renderChart();
        })
        .catch(() => {});
    } catch (error) {
      renderError(error instanceof Error ? error.message : "The catalog could not be loaded.");
    }
  }

  async function copyReleaseLink(releaseId) {
    const release = state.releases.find(item => item.id === releaseId);
    if (!release) return;
    const shareUrl = shareUrlForRelease(release);
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(`${release.title} link copied`);
    } catch {
      window.prompt(`Copy the link for ${release.title}`, shareUrl);
    }
  }

  async function shareRelease(releaseId) {
    const release = state.releases.find(item => item.id === releaseId);
    if (!release) return;
    const availability = availabilitySummary(release);
    const shareData = {
      title: `${release.title} — ${release.artist}`,
      text: `${release.pitch || availability.note} Listen, support, or share this artist-controlled HALO song.`,
      url: shareUrlForRelease(release)
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        showToast(`${release.title} opened in your share sheet`);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyReleaseLink(releaseId);
  }

  function focusRelease(releaseId) {
    if (!state.releases.some(release => release.id === releaseId)) return;
    state.activeShopId = releaseId;
    renderFeatured({ focusHeading: true });
    if (window.matchMedia("(max-width: 980px)").matches) {
      elements.featured.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function handleReleaseActionClick(event) {
    const selectButton = event.target.closest("[data-select-release]");
    if (selectButton) {
      focusRelease(selectButton.dataset.selectRelease);
      return;
    }
    const shareButton = event.target.closest("[data-share-release]");
    if (shareButton) {
      await shareRelease(shareButton.dataset.shareRelease);
      return;
    }
    const copyButton = event.target.closest("[data-copy-release]");
    if (copyButton) {
      await copyReleaseLink(copyButton.dataset.copyRelease);
    }
  }

  function handlePlayTrackClick(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-action="play-track"], [data-play-track-id]') : null;
    if (!button || button.disabled) return;
    event.preventDefault();
    player.play({
      id: button.dataset.trackId || button.dataset.playTrackId || "",
      title: button.dataset.title || "",
      artist: button.dataset.artist || "",
      src: button.dataset.audioUrl || "",
      cover: button.dataset.cover || ""
    });
  }

  if (!player.delegatedClicks) {
    player.delegatedClicks = true;
    document.addEventListener("click", handlePlayTrackClick);
  }
  player.mount();
  elements.address.textContent = `${window.location.host}${shopPath().replace(/\/$/, "")}`;
  window.addEventListener("message", handleSharedCatalogFrameMessage);
  elements.catalogWorkspace?.addEventListener("toggle", () => {
    if (elements.catalogWorkspace.open) loadSharedCatalogFrame();
  });
  if (elements.catalogWorkspace?.open) loadSharedCatalogFrame();
  elements.copy.addEventListener("click", copyCatalogAddress);
  elements.share.addEventListener("click", shareCatalog);
  elements.featured.addEventListener("change", event => {
    if (event.target.closest("[data-licensing-panel]")) applyLicensingSelection(elements.featured);
  });
  elements.featured.addEventListener("click", event => {
    handleReleaseActionClick(event).catch(() => showToast("That song link could not be shared yet."));
  });
  elements.grid.addEventListener("click", event => {
    handleReleaseActionClick(event).catch(() => showToast("That song link could not be shared yet."));
  });
  elements.search.addEventListener("input", event => { state.query = event.target.value.trim(); renderGrid(); });
  elements.sort?.addEventListener("change", event => { state.sort = event.target.value; renderGrid(); });
  elements.genres.addEventListener("click", event => {
    const button = event.target.closest("[data-genre]");
    if (!button) return;
    state.genre = button.dataset.genre;
    renderGenres();
    renderGrid();
  });
  elements.chartRooms.addEventListener("click", event => {
    const button = event.target.closest("[data-chart-room]");
    if (!button) return;
    state.chartRoom = button.dataset.chartRoom;
    state.activeReleaseId = "";
    renderChart();
  });
  elements.chartSortButtons?.addEventListener("click", event => {
    const button = event.target.closest("[data-chart-sort]");
    if (!button) return;
    state.chartSort = button.dataset.chartSort;
    state.activeReleaseId = "";
    renderChart();
  });
  elements.chartBoard.addEventListener("click", event => {
    const row = event.target.closest("[data-chart-release]");
    if (!row) return;
    state.activeReleaseId = row.dataset.chartRelease;
    renderChart();
    if (window.matchMedia("(max-width: 980px)").matches) elements.chartStage.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.chartStage.addEventListener("click", event => {
    const playButton = event.target.closest("[data-play-chart-video]");
    if (playButton) playChartVideo(playButton.dataset.playChartVideo);
    handleReleaseActionClick(event).catch(() => showToast("That song link could not be shared yet."));
  });
  loadCatalog();
})();
