(() => {
  const elements = {
    featured: document.querySelector("#featuredRelease"),
    merchGrid: document.querySelector("#merchGrid"),
    merchCount: document.querySelector("#merchCount"),
    merchDisclosure: document.querySelector("#merchDisclosure"),
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
  const state = { releases: [], merch: [], videos: [], query: "", genre: "all", sort: "newest", chartRoom: "all", chartSort: "signal", activeReleaseId: "", activeShopId: "" };
  const configuredFeaturedReleaseId = elements.featured?.dataset.featuredReleaseId?.trim() || "";
  const requestedReleaseId = new URLSearchParams(window.location.search).get("song")?.trim() || "";
  const fallbackArtwork = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK || "/assets/halo-app-icon-512.png";
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

  function merchPriceLabel(product) {
    if (!product) return "HALO merch";
    if (product.startingPriceMinor > 0) return `From ${money(product.startingPriceMinor, product.currency)}`;
    return "Pricing in HALO merch route";
  }

  function merchVariantLabels(product) {
    return (product?.variants || [])
      .map(variant => [variant.color, variant.size].filter(Boolean).join(" / ") || variant.label)
      .filter(Boolean)
      .slice(0, 4);
  }

  function renderMerchDisclosure(disclosure, note = "") {
    if (!elements.merchDisclosure) return;
    const label = disclosure?.label || "Affiliate + fulfilment note";
    const copy = disclosure?.detailCopy || disclosure?.shortCopy || note || "HALO keeps the storefront voice public while fulfilment routing and affiliate handling stay behind the API.";
    elements.merchDisclosure.innerHTML = `<div class="merch-disclosure"><span>${escapeHtml(label)}</span><p>${escapeHtml(copy)}</p></div>`;
  }

  function catalogState(release) {
    return release?.catalog && typeof release.catalog === "object" ? release.catalog : {};
  }

  function directAudioPreviewUrl(release) {
    const candidate = safeUrl(release?.streamUrl || "");
    if (!candidate) return "";
    try {
      const { pathname } = new URL(candidate);
      return /\.(mp3|m4a|aac|ogg|wav|flac|webm)$/i.test(pathname) ? candidate : "";
    } catch {
      return "";
    }
  }

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
    if (release.streamUrl) return "Open stream";
    return "";
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
    return window.HaloReleaseArtwork?.resolve(release, fallbackArtwork) || {
      src: safeUrl(release?.artwork, fallbackArtwork),
      fallback: fallbackArtwork
    };
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

  function rankedReleases() {
    const entries = state.releases
      .filter(release => {
        if (!release.isChartEligible) {
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
      <div class="stage-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}"><span class="stage-rank">#${position}</span></div>
      <div class="stage-copy">
        <div class="stage-kicker"><span>${escapeHtml(movement.label)}</span><span>${escapeHtml(release.genres.join(" · ") || "HALO release")}</span></div>
        <h3>${escapeHtml(release.title)}</h3><p class="stage-artist">${escapeHtml(release.artist)}</p>
        <p class="stage-story">${escapeHtml(release.pitch || "Open the full release signal and approved campaign room.")}</p>
        <div class="stage-metrics"><span><strong>${Number(activity.recentListens || 0)}</strong>Listen exits</span><span><strong>${Number(activity.recentOpens || 0)}</strong>Room opens</span><span><strong>${escapeHtml(movement.value)}</strong>Momentum</span></div>
        ${videoMarkup(video, release)}
        ${releaseActions(release)}
      </div>
    </article>`;
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
      return `<button class="chart-row${active ? " is-active" : ""}" type="button" data-chart-release="${escapeHtml(release.id)}" aria-pressed="${active}">
        <span class="chart-position">${String(index + 1).padStart(2, "0")}</span>
        <span class="chart-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="" loading="lazy" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}"></span>
        <span class="chart-track"><strong>${escapeHtml(release.title)}</strong><small>${escapeHtml(release.artist)} · ${escapeHtml(release.genres[0] || "HALO")}</small></span>
        <span class="chart-motion is-${movement.direction}"><b>${escapeHtml(movement.value)}</b><small>${escapeHtml(movement.label)}</small></span>
        <span class="chart-open" aria-hidden="true">OPEN ↗</span>
      </button>`;
    }).join("")}`;
    wireArtwork(elements.chartBoard);
    renderChartStage(releases.find(release => release.id === state.activeReleaseId), releases.findIndex(release => release.id === state.activeReleaseId) + 1);
  }


  function showToast(message) {
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
    const previewUrl = directAudioPreviewUrl(release);
    const related = relatedReleases(release);
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
        ${previewUrl ? `<div class="preview-shell" data-preview-url="${encodeURIComponent(previewUrl)}"><span>Direct preview</span><audio controls preload="none"></audio></div>` : `<div class="preview-shell"><span>Public listening</span><p>Use the listen link for the approved public destination. Direct in-page audio appears automatically when the shared catalog points to a preview-safe stream.</p></div>`}
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
        <div class="version-pill-row">${availableVersions.length ? availableVersions.map(version => `<span class="version-pill">${escapeHtml(version)}</span>`).join("") : '<span class="version-pill">Artist-controlled release path</span>'}</div>
        <div class="related-release-list">${related.length ? related.map(item => `<button class="related-release" type="button" data-select-release="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>`).join("") : '<a class="related-release related-release-link" href="/artists/">Browse HALO artist rooms</a>'}</div>
      </section>
    </div>`;
  }

  function renderMerch() {
    if (!elements.merchGrid || !elements.merchCount) return;
    const products = Array.isArray(state.merch) ? state.merch : [];
    elements.merchCount.textContent = `${products.length} ${products.length === 1 ? "merch route" : "merch routes"} live`;
    if (!products.length) {
      elements.merchGrid.innerHTML = `<div class="catalog-empty"><div><strong>Merch routing is warming up.</strong><p>The HALO storefront is ready for Printful-backed merch, but no public products are live yet.</p></div></div>`;
      return;
    }
    elements.merchGrid.innerHTML = products.map(product => {
      const variants = merchVariantLabels(product);
      return `<article class="merch-card">
        <div class="merch-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(safeUrl(product.imageUrl, fallbackArtwork))}" alt="${escapeHtml(`${product.title} HALO merch artwork`)}" loading="lazy" width="900" height="900" data-release-artwork data-artwork-fallback="${escapeHtml(fallbackArtwork)}"></div>
        <div class="merch-copy">
          <p class="merch-eyebrow">${escapeHtml(product.collectionLabel || "HALO merch")}</p>
          <div class="merch-heading"><h3>${escapeHtml(product.title)}</h3><span class="merch-price">${escapeHtml(merchPriceLabel(product))}</span></div>
          <p class="merch-artist">${escapeHtml(product.artistName || "HALO")}</p>
          <p class="merch-description">${escapeHtml(product.description || "HALO merch route")}</p>
          <div class="merch-badges">
            <span class="merch-badge">${escapeHtml(product.badge || "HALO merch")}</span>
            <span class="merch-badge merch-badge--muted">${escapeHtml(product.fulfillment?.providerLabel || "Printful fulfilment")}</span>
          </div>
          <dl class="merch-facts">
            <div><dt>Related release</dt><dd>${escapeHtml(product.associatedReleaseTitle || "HALO shop")}</dd></div>
            <div><dt>Dispatch</dt><dd>${escapeHtml(product.fulfillment?.dispatchWindow || "2–5 working days")}</dd></div>
            <div><dt>Regions</dt><dd>${escapeHtml((product.fulfillment?.regions || []).join(" · ") || "UK + international")}</dd></div>
          </dl>
          ${variants.length ? `<div class="merch-variants">${variants.map(variant => `<span class="merch-variant">${escapeHtml(variant)}</span>`).join("")}</div>` : ""}
          <p class="merch-description">${escapeHtml(product.fulfillment?.note || "")}</p>
          <div class="release-actions">
            <a class="action buy" href="${escapeHtml(safeUrl(product.purchasePath, product.purchasePath))}" target="_blank" rel="noopener" data-stat-event="open_payment" data-stat-target="${escapeHtml(product.slug)}">Shop merch <span aria-hidden="true">↗</span></a>
            ${product.associatedReleaseId ? `<button class="action tertiary" type="button" data-select-release="${escapeHtml(product.associatedReleaseId)}">Pair with song</button>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
    wireArtwork(elements.merchGrid);
  }

  function renderMerchError(message) {
    if (!elements.merchGrid || !elements.merchCount) return;
    elements.merchCount.textContent = "Merch unavailable";
    elements.merchGrid.innerHTML = `<div class="catalog-empty"><div><strong>Merch signal interrupted.</strong><p>${escapeHtml(message)}</p></div></div>`;
  }

  function releaseActions(release, options = {}) {
    const { includeCopy = false, includeSelect = false } = options;
    const listenHref = safeUrl(release.listenUrl);
    if (!listenHref) logMusicIssue("music_listen_url_missing", "Music release missing listen link", { releaseId: release.id, title: release.title });
    const listenAction = listenHref
      ? `<a class="action primary" href="${escapeHtml(listenHref)}" data-stat-event="open_catalog_release" data-stat-target="${escapeHtml(release.id)}">Listen now <span aria-hidden="true">↗</span></a>`
      : `<span class="action primary" aria-disabled="true">Listen link unavailable</span>`;
    const buyHref = safeUrl(release.purchaseUrl || release.streamUrl);
    const buyAction = buyHref
      ? `<a class="action buy" href="${escapeHtml(buyHref)}" target="_blank" rel="noopener" data-stat-event="buy_release" data-stat-target="${escapeHtml(release.id)}">${escapeHtml(buyActionLabel(release))} <span aria-hidden="true">↗</span></a>`
      : "";
    if (!buyHref && release.isChartEligible) logMusicIssue("music_purchase_url_missing", "Music release missing buy/stream link", { releaseId: release.id, title: release.title });
    return `<div class="release-actions">
      ${featuredBadge(release)}
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
      <div class="featured-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" width="1200" height="1200" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}"></div>
      <div class="featured-copy"><div>${releaseMeta(release)}<h2 data-featured-heading tabindex="-1">${escapeHtml(release.title)}</h2><p class="featured-artist">${escapeHtml(release.artist)}</p><p class="featured-pitch">${escapeHtml(release.pitch || "Open the official release signal, approved listening destination, and campaign room.")}</p>${featuredDetailMarkup(release)}</div>${releaseActions(release, { includeCopy: true })}</div>
    </article>`;
    const preview = elements.featured.querySelector("[data-preview-url]");
    if (preview?.dataset.previewUrl) {
      const audio = preview.querySelector("audio");
      if (audio) audio.src = decodeURIComponent(preview.dataset.previewUrl);
    }
    wireArtwork(elements.featured);
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
     return `<article class="release-card">
      <div class="card-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" loading="lazy" width="900" height="900" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}"><span class="card-number">${String(index + 1).padStart(2, "0")}</span></div>
     <div class="card-copy">${releaseMeta(release)}<h3>${escapeHtml(release.title)}</h3><p class="card-artist">${escapeHtml(release.artist)}</p><p class="card-availability">${escapeHtml(availability.badge)}</p>${release.pitch ? `<p class="card-pitch">${escapeHtml(release.pitch)}</p>` : ""}${releaseActions(release, { includeSelect: true })}</div>
    </article>`;
    }).join("");
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
      state.releases = Array.isArray(data.releases) ? data.releases : [];
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

  async function loadMerch() {
    try {
      const response = await fetch("/api/halo-merch", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The merch catalog could not be loaded.");
      state.merch = Array.isArray(data.products) ? data.products : [];
      renderMerch();
      renderMerchDisclosure(data.disclosure, data.note);
    } catch (error) {
      renderMerchError(error instanceof Error ? error.message : "The merch catalog could not be loaded.");
      renderMerchDisclosure(null, "HALO keeps the merch lane branded even when the provider route is unavailable.");
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

  elements.address.textContent = `${window.location.host}${shopPath().replace(/\/$/, "")}`;
  window.addEventListener("message", handleSharedCatalogFrameMessage);
  elements.catalogWorkspace?.addEventListener("toggle", () => {
    if (elements.catalogWorkspace.open) loadSharedCatalogFrame();
  });
  if (elements.catalogWorkspace?.open) loadSharedCatalogFrame();
  elements.copy.addEventListener("click", copyCatalogAddress);
  elements.share.addEventListener("click", shareCatalog);
  elements.featured.addEventListener("click", event => {
    handleReleaseActionClick(event).catch(() => showToast("That song link could not be shared yet."));
  });
  elements.merchGrid?.addEventListener("click", event => {
    handleReleaseActionClick(event).catch(() => showToast("That song link could not be opened yet."));
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
  loadMerch();
})();
