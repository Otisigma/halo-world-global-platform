(() => {
  const rooms = window.HaloGenreRooms;
  const releaseGrid = document.querySelector("#releaseGrid"), gateways = document.querySelector("#genreGateways");
  const specialists = document.querySelector("#specialistRooms"), status = document.querySelector("#status");
  const description = document.querySelector("#genreDescription"), count = document.querySelector("#releaseCount");
  const search = document.querySelector("#search"), audio = document.querySelector("#audio"), playerStatus = document.querySelector("#playerStatus");
  const fallbackArtwork = window.HaloReleaseArtwork?.DEFAULT_RELEASE_ARTWORK || "/assets/releases/halo-premium-placeholder.svg";
  const state = { releases: [], room: "all", query: "", playingId: "" };
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const approved = release => release && typeof release.id === "string" && release.id
    && release.isLiveVisible !== false && ["passed", "published"].includes(String(release.status || "").toLowerCase());
  function renderGatewayButtons() {
    const allButton = make("button", "gateway");
    allButton.type = "button"; allButton.dataset.room = "all";
    allButton.setAttribute("aria-pressed", String(state.room === "all"));
    allButton.append(make("strong", "", "All releases"), make("small", "", "Browse every approved public genre."));
    gateways.replaceChildren(allButton, ...rooms.gateways.map(room => {
      const button = make("button", "gateway");
      button.type = "button"; button.dataset.room = room.id;
      button.setAttribute("aria-pressed", String(state.room === room.id));
      const title = make("strong", "", room.label), detail = make("small", "", room.description);
      button.append(title, detail);
      return button;
    }));
    specialists.replaceChildren(...rooms.secondary.map(room => {
      const button = make("button", "", room.label); button.type = "button"; button.dataset.room = room.id;
      button.setAttribute("aria-pressed", String(state.room === room.id));
      return button;
    }));
  }
  function imageFor(release) {
    const resolved = window.HaloReleaseArtwork?.resolve(release, fallbackArtwork);
    const image = make("img"); image.loading = "lazy"; image.width = 700; image.height = 700;
    image.alt = `${release.title || "Untitled release"} cover artwork`;
    image.src = resolved?.src || fallbackArtwork;
    image.addEventListener("error", () => {
      image.src = fallbackArtwork; image.alt = `${release.title || "Untitled release"}: HALO placeholder cover`;
    }, { once: true });
    return image;
  }
  function playableSource(release) {
    const resolved = window.HaloReleaseArtwork?.resolveAudio(release, { preferPreview: true, requirePlayable: true });
    return resolved?.src || "";
  }
  function play(release) {
    const source = playableSource(release);
    if (!source) { playerStatus.textContent = "No in-page preview is approved for this release. Open its release page for other artist-provided listening links."; return; }
    if (state.playingId === release.id && !audio.paused) { audio.pause(); syncPlaybackControls(); return; }
    if (state.playingId !== release.id || audio.src !== new URL(source, window.location.origin).href) audio.src = source;
    state.playingId = release.id; syncPlaybackControls();
    playerStatus.textContent = `Loading ${release.title || "release"} by ${release.artist || "artist"}.`;
    audio.play().then(() => { playerStatus.textContent = `Playing ${release.title || "release"} by ${release.artist || "artist"}.`; syncPlaybackControls(); })
      .catch(error => { playerStatus.textContent = `Playback could not start (${error.name}). Press Play on the audio controls or open the release page.`; syncPlaybackControls(); });
  }
  function syncPlaybackControls() {
    rooms.syncPlaybackControls(releaseGrid, state.playingId, !audio.paused);
  }
  function releaseCard(release) {
    const article = make("article", "release-card"); article.dataset.releaseId = release.id;
    const art = make("div", "card-art"); art.append(imageFor(release));
    const copy = make("div", "card-copy");
    const genres = rooms.releaseGenres(release);
    const bpm = Number.isFinite(Number(release.bpm)) && Number(release.bpm) > 0 ? ` · ${Number(release.bpm)} BPM` : "";
    copy.append(make("p", "card-meta", `${genres.join(" · ") || "Independent"}${bpm}`));
    copy.append(make("h3", "", release.title || "Untitled release"), make("p", "artist-name", release.artist || "Artist"));
    if (release.releaseDate && !Number.isNaN(Date.parse(release.releaseDate))) {
      copy.append(make("p", "card-meta", new Date(release.releaseDate).getUTCFullYear()));
    }
    const details = make("details", "release-details");
    details.append(make("summary", "", "Artist & release notes"));
    const story = typeof release.pitch === "string" && release.pitch.trim() ? release.pitch.trim() : "No artist-supplied release note is available.";
    details.append(make("p", "release-note", story));
    if (typeof release.credits === "string" && release.credits.trim()) details.append(make("p", "release-note", `Credits: ${release.credits.trim()}`));
    if (typeof release.artistBio === "string" && release.artistBio.trim()) details.append(make("p", "release-note", release.artistBio.trim()));
    copy.append(details);
    const actions = make("div", "card-actions");
    const playButton = make("button", "", "▶ Play");
    playButton.type = "button"; playButton.dataset.discoveryPlay = release.id;
    playButton.setAttribute("aria-pressed", "false");
    playButton.disabled = !playableSource(release);
    playButton.setAttribute("aria-label", `Play ${release.title || "release"} by ${release.artist || "artist"}`);
    playButton.addEventListener("click", () => play(release));
    const add = make("a", "", "+ Add to Mix");
    const params = new URLSearchParams({ song: release.id, add: release.id });
    add.href = `/music/?${params.toString()}#personalPlaylistHub`;
    add.setAttribute("aria-label", `Add ${release.title || "release"} to a browser playlist`);
    const open = make("a", "", "Release page"); open.href = `/music/?song=${encodeURIComponent(release.id)}#featuredRelease`;
    actions.append(playButton, add, open); article.append(art, copy, actions); return article;
  }
  function filteredReleases() {
    return rooms.filterReleases(state.releases, state.room, state.query);
  }
  function render() {
    renderGatewayButtons();
    const room = rooms.gateways.find(item => item.id === state.room) || rooms.secondary.find(item => item.id === state.room);
    description.textContent = room?.description || "All approved public genres. Each release remains in the genres supplied with its catalog entry.";
    const releases = filteredReleases();
    count.textContent = `${releases.length} public ${releases.length === 1 ? "release" : "releases"}`;
    releaseGrid.replaceChildren(...(releases.length ? releases.map(releaseCard) : [make("p", "empty", "No approved public releases match this room and search yet.")]));
    syncPlaybackControls();
  }
  gateways.addEventListener("click", event => { const button = event.target.closest("[data-room]"); if (button) { state.room = button.dataset.room; render(); } });
  specialists.addEventListener("click", event => { const button = event.target.closest("[data-room]"); if (button) { state.room = button.dataset.room; render(); } });
  search.addEventListener("input", () => { state.query = search.value.trim().toLowerCase(); render(); });
  audio.addEventListener("play", syncPlaybackControls);
  audio.addEventListener("pause", syncPlaybackControls);
  audio.addEventListener("ended", () => { state.playingId = ""; playerStatus.textContent = "Release preview finished."; syncPlaybackControls(); });
  audio.addEventListener("error", () => { state.playingId = ""; playerStatus.textContent = "Release preview failed. No other release was started."; syncPlaybackControls(); });
  renderGatewayButtons();
  fetch("/api/release-catalog", { headers: { Accept: "application/json" } })
    .then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The public release catalog is unavailable.");
      state.releases = (Array.isArray(data.releases) ? data.releases : []).filter(approved);
      render();
    })
    .catch(error => {
      console.error("Artist discovery catalog", error.name);
      status.textContent = error.message; count.textContent = "Catalog unavailable"; releaseGrid.replaceChildren();
    });
})();
