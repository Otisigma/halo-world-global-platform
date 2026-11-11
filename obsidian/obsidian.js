import { parseTimestampedLyrics, findActiveLyricIndex } from "../lib/dreamweaver-lyrics.js";

export function eligibleReleases(data) {
  if (!Array.isArray(data?.releases)) throw new Error("The catalog response is invalid.");
  return data.releases.filter(release => release && typeof release.id === "string" && release.id.trim()
    && release.isLiveVisible !== false && ["published", "passed"].includes(String(release.status || "").trim().toLowerCase()));
}

export function safeDestination(value, origin) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, origin);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function createGateway({ document, window, fetcher }) {
  const get = id => document.getElementById(id);
  const audio = get("audio"), status = get("status"), tracks = get("tracks");
  const previous = get("previous"), next = get("next"), retry = get("retry"), share = get("share"), loop = get("loop");
  const destination = get("destination"), releaseLink = get("releaseLink"), art = get("artwork");
  const state = { releases: [], index: -1, generation: 0, filter: "all" };
  const filterBox = get("vaultFilters"), gridStatus = get("gridStatus");
  let cardNodes = [], isPlaying = false;
  const loadNote = get("loadNote"), continueNext = get("continueNext"), shareMoment = get("shareMoment");
  let pendingStart = 0, warmed = "", warmer = null;
  const loadNoteText = loadNote.textContent;
  let lyrics = [], lyricNodes = [], activeLyric = -1;
  const telemetry = window.HaloListeningTelemetry?.bindAudio(audio, () => state.releases[state.index]?.id);
  const selected = () => state.releases[state.index];
  const setStatus = value => { status.textContent = value; };
  const setPlaying = value => {
    isPlaying = value;
    get("pulse").classList.toggle("playing", value);
    for (const { button, action, index } of cardNodes) {
      button.classList.toggle("active-playing", value && index === state.index);
      action.textContent = index === state.index ? (value ? "PLAYING" : "SELECTED") : "SELECT RELEASE";
    }
  };
  const playable = release => {
    const resolved = window.HaloReleaseArtwork.resolvePreviewAudio(release);
    return resolved.isPlayable && Boolean(safeDestination(resolved.src, window.location.origin));
  };
  const genresFor = release => Array.isArray(release.genres)
    ? release.genres.filter(genre => typeof genre === "string" && genre.trim()).map(genre => genre.trim()) : [];

  function renderFilters() {
    const genres = [...new Set(state.releases.flatMap(genresFor))].sort();
    const filters = [["all", "Published vault"], ["playable", "In-page audio"], ...genres.map(genre => [`genre:${genre}`, genre])];
    filterBox.replaceChildren(...filters.map(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(state.filter === id));
      button.addEventListener("click", () => {
        state.filter = id;
        // Keep filter controls stable so keyboard focus survives a grid update.
        for (const node of filterBox.children) node.setAttribute("aria-pressed", String(node === button));
        renderTracks();
      });
      return button;
    }));
  }

  function updateLyrics() {
    const index = findActiveLyricIndex(lyrics, audio.currentTime);
    if (index === activeLyric) return;
    if (lyricNodes[activeLyric]) lyricNodes[activeLyric].classList.toggle("is-current", false);
    if (lyricNodes[index]) lyricNodes[index].classList.toggle("is-current", true);
    activeLyric = index;
  }

  function renderLyrics(source) {
    const parsed = parseTimestampedLyrics(source);
    lyrics = parsed.lines;
    activeLyric = -1;
    get("lyrics").hidden = !lyrics.length;
    get("lyricsStatus").textContent = parsed.timed
      ? "Timed lines follow playback. Untimed lines are shown without synchronization."
      : "Lyrics are not timestamped; read at your own pace.";
    lyricNodes = lyrics.map(line => {
      const item = document.createElement("li");
      item.textContent = line.text;
      return item;
    });
    get("lyricsLines").replaceChildren(...lyricNodes);
    updateLyrics();
  }

  function renderTracks() {
    cardNodes = [];
    tracks.replaceChildren(...state.releases.flatMap((release, index) => {
      if (state.filter === "playable" && !playable(release)) return [];
      if (state.filter.startsWith("genre:") && !genresFor(release).includes(state.filter.slice(6))) return [];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "track";
      button.setAttribute("aria-pressed", String(index === state.index));
      const label = document.createElement("span");
      const title = document.createElement("strong");
      const artist = document.createElement("small");
      const action = document.createElement("span");
      const image = document.createElement("img");
      image.src = safeDestination(window.HaloReleaseArtwork.resolve(release).src, window.location.origin) || "/assets/releases/halo-premium-placeholder.svg";
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => {
        if (image.getAttribute("src") !== "/assets/releases/halo-premium-placeholder.svg") image.src = "/assets/releases/halo-premium-placeholder.svg";
      });
      const availability = document.createElement("small");
      availability.textContent = playable(release) ? "In-page audio available" : "Catalog links only";
      title.textContent = release.title || "Untitled release";
      artist.textContent = release.artist || "Artist";
      label.append(title, artist, availability);
      button.append(image, label, action);
      button.addEventListener("click", () => select(index));
      cardNodes.push({ button, action, index });
      return button;
    }));
    setPlaying(isPlaying);
    gridStatus.textContent = cardNodes.length
      ? `${cardNodes.length} of ${state.releases.length} releases shown. Select a release, then press play.`
      : "No releases match this filter. Choose another vault.";
  }

  function parseStart(value) {
    const seconds = Number(value);
    return value !== null && value !== "" && Number.isFinite(seconds) && seconds > 0 && seconds < 86_400 ? Math.floor(seconds) : 0;
  }

  function nextPlayableIndex() {
    for (let step = 1; step < state.releases.length; step += 1) {
      const candidate = (state.index + step) % state.releases.length;
      const resolved = window.HaloReleaseArtwork.resolvePreviewAudio(state.releases[candidate]);
      if (resolved.isPlayable && safeDestination(resolved.src, window.location.origin)) return { candidate, src: resolved.src };
    }
    return null;
  }

  function warmNext() {
    if (!continueNext.checked || audio.loop || !window.Audio || !Number.isFinite(audio.duration) || audio.duration <= 0
      || audio.currentTime / audio.duration < 0.6) return;
    const upcoming = nextPlayableIndex();
    if (!upcoming || upcoming.src === warmed) return;
    warmed = upcoming.src;
    warmer = new window.Audio();
    warmer.preload = "auto";
    warmer.src = upcoming.src;
  }

  function showBuffered() {
    if (loadNote.hidden || !Number.isFinite(audio.duration) || audio.duration <= 0 || !audio.buffered?.length) return;
    const percent = Math.min(100, Math.round(audio.buffered.end(audio.buffered.length - 1) / audio.duration * 100));
    loadNote.textContent = `${loadNoteText} Buffered ${percent}%.`;
  }

  const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  function select(index, startAt = 0) {
    if (!state.releases[index]) return;
    telemetry?.reset();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlaying(false);
    loadNote.hidden = true;
    loadNote.textContent = loadNoteText;
    if (warmer) { warmer.removeAttribute("src"); warmer = null; }
    warmed = "";
    pendingStart = startAt;
    state.index = index;
    const release = selected();
    renderLyrics(release.dreamweaverPayload?.lyricsText);
    const resolved = window.HaloReleaseArtwork.resolvePreviewAudio(release);
    const artwork = window.HaloReleaseArtwork.resolve(release);
    art.src = safeDestination(artwork.src, window.location.origin) || "/assets/releases/halo-premium-placeholder.svg";
    art.alt = artwork.source === "fallback" ? "HALO placeholder cover" : `${release.title || "Release"} cover artwork`;
    get("selectedTitle").textContent = release.title || "Untitled release";
    get("artist").textContent = release.artist || "Artist";
    get("position").textContent = `${index + 1} / ${state.releases.length}`;
    previous.disabled = next.disabled = state.releases.length < 2;
    share.disabled = shareMoment.disabled = false;
    releaseLink.href = `/music/?song=${encodeURIComponent(release.id)}`;
    releaseLink.textContent = "Explore this release ↗";
    const link = safeDestination(release.distributionUrl, window.location.origin) || safeDestination(release.purchaseUrl, window.location.origin);
    destination.hidden = !link;
    if (link) destination.href = link;
    else destination.removeAttribute("href");
    if (resolved.isPlayable && safeDestination(resolved.src, window.location.origin)) {
      audio.src = resolved.src;
      audio.hidden = false;
      loop.disabled = false;
      setStatus(startAt ? `Press play to start at ${clock(startAt)}.` : "Press play to listen.");
    } else {
      audio.hidden = true;
      loop.disabled = true;
      setStatus("In-page audio is unavailable for this release. Explore its approved links.");
    }
    renderTracks();
    const url = new URL(window.location.href);
    url.searchParams.set("song", release.id);
    url.searchParams.delete("t");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function load() {
    const ticket = ++state.generation;
    retry.hidden = true;
    audio.pause();
    telemetry?.reset();
    audio.removeAttribute("src");
    audio.load();
    audio.hidden = true;
    setPlaying(false);
    state.releases = [];
    state.filter = "all";
    filterBox.replaceChildren();
    gridStatus.textContent = "";
    cardNodes = [];
    state.index = -1;
    renderLyrics("");
    tracks.replaceChildren();
    previous.disabled = next.disabled = true;
    share.disabled = shareMoment.disabled = true;
    loop.disabled = true;
    loadNote.hidden = true;
    destination.hidden = true;
    destination.removeAttribute("href");
    releaseLink.href = "/music/";
    releaseLink.textContent = "Explore the catalog ↗";
    art.src = "/assets/releases/halo-premium-placeholder.svg";
    art.alt = "HALO placeholder cover";
    get("count").textContent = "Loading…";
    get("selectedTitle").textContent = "Loading releases…";
    get("artist").textContent = "";
    get("position").textContent = "—";
    setStatus("Connecting to the public catalog…");
    try {
      const response = await fetcher("/api/release-catalog", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("The public catalog could not be loaded.");
      const releases = eligibleReleases(await response.json());
      if (ticket !== state.generation) return;
      state.releases = releases;
      renderFilters();
      get("count").textContent = `${releases.length} public ${releases.length === 1 ? "release" : "releases"}`;
      if (!releases.length) {
        get("selectedTitle").textContent = "No public releases yet";
        setStatus("The catalog is connected but has no public releases to show.");
        return;
      }
      const requested = new URL(window.location.href).searchParams.get("song");
      const index = releases.findIndex(release => release.id === requested);
      if (requested && index < 0) {
        get("selectedTitle").textContent = "Release unavailable";
        setStatus("This release is not in the current public catalog. Choose another below.");
        renderTracks();
        return;
      }
      select(index < 0 ? 0 : index, parseStart(new URL(window.location.href).searchParams.get("t")));
    } catch (error) {
      if (ticket !== state.generation) return;
      console.error("Obsidian catalog unavailable", error);
      get("selectedTitle").textContent = "Catalog unavailable";
      get("count").textContent = "Unavailable";
      setStatus("The catalog could not be loaded. Please try again.");
      retry.hidden = false;
    }
  }

  previous.addEventListener("click", () => select((state.index - 1 + state.releases.length) % state.releases.length));
  next.addEventListener("click", () => select((state.index + 1) % state.releases.length));
  loop.addEventListener("change", () => { audio.loop = loop.checked; });
  share.addEventListener("click", async () => {
    if (!selected()) return;
    try {
      await window.navigator.clipboard.writeText(window.location.href);
      setStatus("Release link copied.");
    } catch {
      setStatus("Could not copy. Select and copy the address from your browser.");
    }
  });
  shareMoment.addEventListener("click", async () => {
    if (!selected()) return;
    const url = new URL(window.location.href);
    const moment = Math.floor(audio.currentTime || 0);
    if (moment > 0) url.searchParams.set("t", String(moment));
    else url.searchParams.delete("t");
    try {
      await window.navigator.clipboard.writeText(url.href);
      setStatus(moment > 0 ? `Link to ${clock(moment)} copied.` : "Release link copied.");
    } catch {
      setStatus("Could not copy. Select and copy the address from your browser.");
    }
  });
  retry.addEventListener("click", load);
  audio.addEventListener("loadstart", () => { if (audio.getAttribute("src")) loadNote.hidden = false; });
  audio.addEventListener("canplay", () => { loadNote.hidden = true; });
  audio.addEventListener("progress", showBuffered);
  audio.addEventListener("loadedmetadata", () => {
    if (pendingStart && (!Number.isFinite(audio.duration) || pendingStart < audio.duration)) audio.currentTime = pendingStart;
    pendingStart = 0;
  });
  audio.addEventListener("ended", () => {
    if (!continueNext.checked || audio.loop || state.releases.length < 2) return;
    const upcoming = nextPlayableIndex();
    if (!upcoming) return;
    select(upcoming.candidate);
    Promise.resolve(audio.play()).catch(() => setStatus("Next release is ready. Press play to continue."));
  });
  audio.addEventListener("playing", () => { loadNote.hidden = true; setPlaying(true); setStatus("Playing."); });
  audio.addEventListener("timeupdate", () => { updateLyrics(); warmNext(); });
  audio.addEventListener("seeked", updateLyrics);
  audio.addEventListener("waiting", () => { loadNote.hidden = false; setPlaying(false); setStatus("Buffering…"); });
  audio.addEventListener("pause", () => { setPlaying(false); if (selected() && !audio.error) setStatus(audio.ended ? "Playback ended." : "Paused."); });
  audio.addEventListener("error", () => { loadNote.hidden = true; setPlaying(false); if (selected()) setStatus("Audio could not be played. Try again or explore the release link."); });
  art.addEventListener("error", () => {
    if (art.getAttribute("src") !== "/assets/releases/halo-premium-placeholder.svg") {
      art.src = "/assets/releases/halo-premium-placeholder.svg";
      art.alt = "HALO placeholder cover";
    }
  });
  return { load, select, state };
}

if (typeof document !== "undefined" && document.getElementById("tracks")) {
  void createGateway({ document, window, fetcher: fetch }).load();
}
