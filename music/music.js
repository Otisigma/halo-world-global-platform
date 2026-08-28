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
    toast: document.querySelector("#catalogToast")
  };
  const state = { releases: [], videos: [], query: "", genre: "all", sort: "newest", chartRoom: "all", chartSort: "signal", activeReleaseId: "" };
  const fallbackArtwork = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK || "/assets/halo-app-icon-512.png";
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

  function videoForRelease(release) {
    const title = normalized(release.title);
    const artist = normalized(release.artist);
    return state.videos.find(video => {
      const videoTitle = normalized(video.title);
      const videoArtist = normalized(video.artistName);
      return (title && (videoTitle.includes(title) || title.includes(videoTitle)))
        || (artist && videoArtist === artist && videoTitle.split(" ").some(word => word.length > 4 && title.includes(word)));
    });
  }

  function videoMarkup(video, release) {
    if (!video) {
      return `<div class="stage-video-empty"><span>HALO TV</span><strong>Footage lane open</strong><p>When approved footage is attached to this release, it plays here without sending listeners away from the chart.</p></div>`;
    }
    const thumbnail = safeUrl(video.thumbnailUrl, releaseArtwork(release).src);
    return `<button class="stage-video-poster" type="button" data-play-chart-video="${escapeHtml(video.id)}">
      <img src="${escapeHtml(thumbnail)}" alt="" loading="lazy">
      <span class="video-play" aria-hidden="true">▶</span><span><small>Watch inside the chart</small><strong>${escapeHtml(video.title)}</strong></span>
    </button>`;
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

  function playChartVideo(videoId) {
    const video = state.videos.find(item => item.id === videoId);
    const poster = elements.chartStage.querySelector("[data-play-chart-video]");
    if (!video || !poster) return;
    const source = safeUrl(video.sourceUrl);
    const embed = safeUrl(video.embedUrl).replace("www.youtube.com", "www.youtube-nocookie.com");
    const player = video.sourceType === "youtube"
      ? `<iframe src="${escapeHtml(embed)}?autoplay=1&amp;rel=0" title="${escapeHtml(video.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : `<video src="${escapeHtml(source)}" controls autoplay playsinline></video>`;
    const frame = document.createElement("div");
    frame.className = "stage-video-frame";
    frame.innerHTML = player;
    poster.replaceWith(frame);
    window.haloStats?.track("play_halo_video", { target: video.id, track: state.activeReleaseId });
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
  }

  async function copyCatalogAddress() {
    const address = `${window.location.origin}/music/`;
    try {
      await navigator.clipboard.writeText(address);
      showToast("HALO music address copied");
      elements.copy.textContent = "Address copied";
    } catch {
      window.prompt("Copy the HALO music address", address);
    }
  }

  async function shareCatalog() {
    const shareData = {
      title: "HALO Music",
      text: "Every official HALO release in one place.",
      url: `${window.location.origin}/music/`
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

  function releaseMeta(release) {
    const genres = release.genres.length ? release.genres.join(" · ") : "HALO release";
    return `<div class="release-meta"><span>${escapeHtml(formatReleaseDate(release.releaseDate))}</span><span>${escapeHtml(genres)}</span>${technicalLine(release) ? `<span>${escapeHtml(technicalLine(release))}</span>` : ""}</div>`;
  }

  function featuredBadge(release) {
    if (release.featuredType === "week") return `<span class="featured-badge is-week">Song of the Week</span>`;
    if (release.featuredType === "month") return `<span class="featured-badge is-month">Song of the Month</span>`;
    return "";
  }

  function releaseActions(release) {
    const listenHref = safeUrl(release.listenUrl);
    if (!listenHref) logMusicIssue("music_listen_url_missing", "Music release missing listen link", { releaseId: release.id, title: release.title });
    const listenAction = listenHref
      ? `<a class="action primary" href="${escapeHtml(listenHref)}" data-stat-event="open_catalog_release" data-stat-target="${escapeHtml(release.id)}">Listen now <span aria-hidden="true">↗</span></a>`
      : `<span class="action primary" aria-disabled="true">Listen link unavailable</span>`;
    const buyHref = safeUrl(release.purchaseUrl || release.streamUrl);
    const buyAction = buyHref
      ? `<a class="action buy" href="${escapeHtml(buyHref)}" target="_blank" rel="noopener" data-stat-event="buy_release" data-stat-target="${escapeHtml(release.id)}">Buy / Stream <span aria-hidden="true">↗</span></a>`
      : "";
    if (!buyHref && release.isChartEligible) logMusicIssue("music_purchase_url_missing", "Music release missing buy/stream link", { releaseId: release.id, title: release.title });
    return `<div class="release-actions">
      ${featuredBadge(release)}
      ${listenAction}
      ${buyAction}
      <a class="action secondary" href="${escapeHtml(safeUrl(release.kitUrl))}" data-stat-event="open_release_kit" data-stat-target="${escapeHtml(release.id)}">Release room</a>
    </div>`;
  }

  function renderFeatured() {
    const release = state.releases.find(r => r.featuredType === "week")
      || state.releases.find(r => r.featuredType === "month")
      || state.releases[0];
    if (!release) {
      elements.featured.innerHTML = `<div class="catalog-empty"><div><strong>The next signal is being prepared.</strong><p>Published HALO releases appear here automatically.</p></div></div>`;
      return;
    }
    const artwork = releaseArtwork(release);
    elements.featured.innerHTML = `<article class="featured-release">
      <div class="featured-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" width="1200" height="1200" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}"></div>
      <div class="featured-copy"><div>${releaseMeta(release)}<h2>${escapeHtml(release.title)}</h2><p class="featured-artist">${escapeHtml(release.artist)}</p><p class="featured-pitch">${escapeHtml(release.pitch || "Open the official release signal, approved listening destination, and campaign room.")}</p></div>${releaseActions(release)}</div>
    </article>`;
    wireArtwork(elements.featured);
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
      return `<article class="release-card">
      <div class="card-art release-artwork-frame" data-artwork-frame><img class="release-artwork-image" src="${escapeHtml(artwork.src)}" alt="${escapeHtml(`${release.title} cover artwork`)}" loading="lazy" width="900" height="900" data-release-artwork data-artwork-fallback="${escapeHtml(artwork.fallback)}"><span class="card-number">${String(index + 1).padStart(2, "0")}</span></div>
      <div class="card-copy">${releaseMeta(release)}<h3>${escapeHtml(release.title)}</h3><p class="card-artist">${escapeHtml(release.artist)}</p>${release.pitch ? `<p class="card-pitch">${escapeHtml(release.pitch)}</p>` : ""}${releaseActions(release)}</div>
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

  elements.address.textContent = `${window.location.host}/music`;
  elements.copy.addEventListener("click", copyCatalogAddress);
  elements.share.addEventListener("click", shareCatalog);
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
  });
  loadCatalog();
})();
