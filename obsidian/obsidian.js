import { parseTimestampedLyrics, findActiveLyricIndex } from "../lib/dreamweaver-lyrics.js";
import { readPlaylists, writePlaylists } from "../lib/personal-playlists.js";

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

export function releaseCategories(release, field = "genres") {
  const supplied = Array.isArray(release[field]) ? release[field] : [];
  const values = supplied.filter(value => typeof value === "string" && value.trim());
  if (field === "genres" && !values.length && typeof release.catalog?.genre === "string") {
    values.push(...release.catalog.genre.split(","));
  }
  const categories = new Map();
  for (const value of values) {
    for (const raw of (field === "genres" ? value.split(",") : [value])) {
      const source = raw.trim().replace(/[\s,.;:]+$/g, "").replace(/\s+/g, " ");
      if (!source) continue;
      const normalized = source.toLowerCase().replace(/[^a-z0-9&-]+/g, " ").trim().replace(/\s+/g, " ");
      const key = ["afro beat", "afro beats", "afrobeat", "afrobeats"].includes(normalized) ? "afrobeats" : normalized;
      let label = key.split(" ").map(word => word.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("-")).join(" ");
      label = label.replace(/\bDj\b/g, "DJ").replace(/\bR&b\b/gi, "R&B").replace(/\bHalo\b/g, "HALO");
      if (key === "afrobeats") label = "Afrobeats";
      if (!categories.has(key)) categories.set(key, label);
    }
  }
  return [...categories].map(([key, label]) => ({ key, label }));
}

export function createGateway({ document, window, fetcher }) {
  const get = id => document.getElementById(id);
  const audio = get("audio"), status = get("status"), tracks = get("tracks");
  const previous = get("previous"), next = get("next"), retry = get("retry"), share = get("share"), loop = get("loop");
  const destination = get("destination"), releaseLink = get("releaseLink"), art = get("artwork");
  const state = { releases: [], index: -1, generation: 0, filter: "all", playlists: [], queue: null };
  const quickFilters = get("quickFilters"), genreFilters = get("genreFilters"), versionFilters = get("versionFilters"), gridStatus = get("gridStatus");
  let cardNodes = [], isPlaying = false;
  const loadNote = get("loadNote"), continueNext = get("continueNext"), shareMoment = get("shareMoment");
  const playlistForm = get("createPlaylistForm"), playlistName = get("newPlaylistName");
  const playlistStatus = get("playlistStatus"), userPlaylists = get("userPlaylists");
  const addToPlaylist = get("addToPlaylist"), addToPlaylistButton = get("addToPlaylistButton");
  const playlistPlayerStatus = get("playlistPlayerStatus");
  const reportPlaylist = message => {
    playlistStatus.textContent = message;
    playlistPlayerStatus.textContent = message;
  };
  let pendingStart = 0, warmed = "", warmer = null;
  const loadNoteText = loadNote.textContent;
  let lyrics = [], lyricNodes = [], activeLyric = -1;
  const telemetry = window.HaloListeningTelemetry?.bindAudio(audio, () => state.releases[state.index]?.id);
  const selected = () => state.releases[state.index];
  const setStatus = value => { status.textContent = value; };
  let playlistStorage;
  try {
    playlistStorage = window.localStorage;
    state.playlists = readPlaylists(playlistStorage);
  } catch (error) {
    playlistStorage = null;
    console.error("Obsidian playlists unavailable", error);
    reportPlaylist("Saved playlists could not be accessed in this browser. Catalog playback is still available.");
  }
  const persistPlaylists = playlists => {
    try {
      writePlaylists(playlistStorage, playlists);
      state.playlists = playlists;
      if (state.queue) {
        const updatedQueue = playlists.find(playlist => playlist.id === state.queue.playlistId);
        state.queue = updatedQueue ? { playlistId: updatedQueue.id, releaseIds: updatedQueue.releaseIds } : null;
      }
      renderPlaylists();
      return true;
    } catch (error) {
      console.error("Obsidian playlist save failed", error);
      reportPlaylist("Could not save your playlist in this browser. Check available storage and try again.");
      return false;
    }
  };
  const playlistReleases = playlist => playlist.releaseIds
    .map(id => state.releases.find(release => release.id === id)).filter(Boolean);

  function renderPlaylists() {
    const chosen = addToPlaylist.value;
    addToPlaylist.replaceChildren();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = state.playlists.length ? "Choose a playlist" : "Create a playlist first";
    addToPlaylist.append(emptyOption);
    for (const playlist of state.playlists) {
      const option = document.createElement("option");
      option.value = playlist.id;
      option.textContent = playlist.name;
      addToPlaylist.append(option);
    }
    addToPlaylist.disabled = !playlistStorage || !state.playlists.length || !selected();
    addToPlaylistButton.disabled = addToPlaylist.disabled;
    playlistForm.querySelector('button[type="submit"]').disabled = !playlistStorage;
    userPlaylists.replaceChildren(...state.playlists.map(playlist => {
      const section = document.createElement("section");
      section.className = "user-playlist";
      section.dataset.playlistId = playlist.id;
      const heading = document.createElement("h3");
      heading.textContent = playlist.name;
      const releases = playlistReleases(playlist);
      const count = document.createElement("p");
      count.textContent = `${releases.length} ${releases.length === 1 ? "release" : "releases"}`;
      const actions = document.createElement("div");
      actions.className = "user-playlist-actions";
      const queue = document.createElement("button");
      queue.type = "button";
      queue.textContent = "Play mix";
      queue.disabled = !releases.length;
      queue.addEventListener("click", () => startPlaylist(playlist.id));
      const removePlaylist = document.createElement("button");
      removePlaylist.type = "button";
      removePlaylist.textContent = "Delete playlist";
      removePlaylist.addEventListener("click", () => {
        if (persistPlaylists(state.playlists.filter(item => item.id !== playlist.id))) {
          reportPlaylist(`Deleted “${playlist.name}”.`);
        }
      });
      actions.append(queue, removePlaylist);
      const list = document.createElement("ol");
      for (const release of releases) {
        const item = document.createElement("li");
        const title = document.createElement("span");
        title.textContent = `${release.title || "Untitled release"} · ${release.artist || "Artist"}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${release.title || "release"} from ${playlist.name}`);
        remove.addEventListener("click", () => {
          const updated = state.playlists.map(entry => entry.id === playlist.id
            ? { ...entry, releaseIds: entry.releaseIds.filter(id => id !== release.id) } : entry);
          if (persistPlaylists(updated)) reportPlaylist(`Removed “${release.title || "release"}”.`);
        });
        item.append(title, remove);
        list.append(item);
      }
      section.append(heading, count, actions, list);
      return section;
    }));
    addToPlaylist.value = state.playlists.some(playlist => playlist.id === chosen)
      ? chosen : state.playlists.length === 1 ? state.playlists[0].id : "";
    if (selected()) {
      previous.disabled = state.queue ? !nextPlayableIndex(-1) : state.releases.length < 2;
      next.disabled = state.queue ? !nextPlayableIndex() : state.releases.length < 2;
    }
  }

  async function startPlaylist(id) {
    const playlist = state.playlists.find(item => item.id === id);
    if (!playlist) return;
    const indices = playlist.releaseIds.map(releaseId => state.releases.findIndex(release => release.id === releaseId))
      .filter(index => index >= 0);
    const firstPlayable = indices.find(index => playable(state.releases[index]));
    if (firstPlayable === undefined) {
      reportPlaylist("This playlist has no releases with in-page audio available.");
      return;
    }
    const queue = { playlistId: id, releaseIds: playlist.releaseIds };
    state.queue = queue;
    select(firstPlayable, 0, { preserveQueue: true });
    reportPlaylist(`Starting “${playlist.name}”…`);
    audio.scrollIntoView({ block: "center", behavior: "instant" });
    audio.focus({ preventScroll: true });
    try {
      await audio.play();
      if (state.queue === queue && state.index === firstPlayable) {
        reportPlaylist(`“${playlist.name}” is playing. Use the player controls to pause or skip.`);
      }
    } catch (error) {
      if (state.queue === queue && state.index === firstPlayable) {
        console.error("Obsidian playlist playback could not start", error);
        reportPlaylist(`“${playlist.name}” is queued, but playback could not start. Press play in the audio player or try another release.`);
        setStatus("Audio could not start. Press play to retry or explore the release link.");
      }
    }
  }

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
  const matchesFilter = (release, id) => {
    if (id === "all") return true;
    if (id === "playable") return playable(release);
    if (id === "uncategorized") return !releaseCategories(release).length;
    if (id.startsWith("genre:")) return releaseCategories(release).some(category => category.key === id.slice(6));
    if (id.startsWith("version:")) return releaseCategories(release, "availableVersions").some(category => category.key === id.slice(8));
    return false;
  };
  const updateFilterSummaries = () => {
    const activeGenre = [...genreFilters.children].find(button => button.dataset.filter === state.filter);
    const activeVersion = [...versionFilters.children].find(button => button.dataset.filter === state.filter);
    get("genreFilterSummary").textContent = `Genres (${genreFilters.children.length})${activeGenre ? ` · ${activeGenre.dataset.label}` : ""}`;
    get("versionFilterSummary").textContent = `Versions (${versionFilters.children.length})${activeVersion ? ` · ${activeVersion.dataset.label}` : ""}`;
  };

  function renderFilters() {
    const categories = field => {
      const unique = new Map();
      for (const release of state.releases) {
        for (const category of releaseCategories(release, field)) {
          const item = unique.get(category.key) || { label: category.label, count: 0 };
          item.count += 1;
          unique.set(category.key, item);
        }
      }
      return [...unique].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));
    };
    const makeButtons = (container, filters) => {
      container.replaceChildren(...filters.map(([id, label, count]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.filter = id;
        button.dataset.label = label;
        button.textContent = `${label} (${count})`;
        button.setAttribute("aria-pressed", String(state.filter === id));
        button.addEventListener("click", () => {
          state.filter = id;
          for (const group of [quickFilters, genreFilters, versionFilters]) {
            for (const node of group.children) node.setAttribute("aria-pressed", String(node.dataset.filter === id));
          }
          updateFilterSummaries();
          renderTracks();
        });
        return button;
      }));
    };
    const countFor = id => state.releases.filter(release => matchesFilter(release, id)).length;
    makeButtons(quickFilters, [
      ["all", "All Releases", state.releases.length],
      ["playable", "In-page audio", countFor("playable")]
    ]);
    const genres = categories("genres");
    if (state.releases.some(release => !releaseCategories(release).length)) {
      genres.push(["uncategorized", { label: "Genre not supplied", count: countFor("uncategorized") }]);
    }
    makeButtons(genreFilters, genres.map(([key, category]) => [
      key === "uncategorized" ? key : `genre:${key}`, category.label, category.count
    ]));
    const versions = categories("availableVersions");
    makeButtons(versionFilters, versions.map(([key, category]) => [`version:${key}`, category.label, category.count]));
    for (const group of [quickFilters, genreFilters, versionFilters]) {
      for (const button of group.children) button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter));
    }
    updateFilterSummaries();
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
      if (!matchesFilter(release, state.filter)) return [];
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
      const badges = document.createElement("span");
      badges.className = "genre-badges";
      const categories = releaseCategories(release);
      for (const category of categories.length ? categories : [{ label: "Genre not supplied" }]) {
        const badge = document.createElement("span");
        badge.className = "genre-badge";
        badge.textContent = category.label;
        badges.append(badge);
      }
      const versions = document.createElement("small");
      const versionLabels = releaseCategories(release, "availableVersions").map(category => category.label);
      versions.textContent = versionLabels.length ? `Catalog versions: ${versionLabels.join(" / ")}` : "";
      const description = document.createElement("small");
      description.textContent = typeof release.pitch === "string" ? release.pitch.trim() : "";
      title.textContent = release.title || "Untitled release";
      artist.textContent = release.artist || "Artist";
      label.append(title, artist, badges, availability, versions, description);
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

  function nextPlayableIndex(direction = 1) {
    const queue = state.queue?.releaseIds || state.releases.map(release => release.id);
    const current = queue.indexOf(state.releases[state.index]?.id);
    if (current < 0 || !queue.length) return null;
    for (let step = 1; step < queue.length; step += 1) {
      const candidateId = queue[(current + direction * step + queue.length * step) % queue.length];
      const candidate = state.releases.findIndex(release => release.id === candidateId);
      if (candidate < 0) continue;
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

  function select(index, startAt = 0, { preserveQueue = false } = {}) {
    if (!state.releases[index]) return;
    if (!preserveQueue) state.queue = null;
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
    previous.disabled = state.queue ? !nextPlayableIndex(-1) : state.releases.length < 2;
    next.disabled = state.queue ? !nextPlayableIndex() : state.releases.length < 2;
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
    renderPlaylists();
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
    state.queue = null;
    quickFilters.replaceChildren();
    genreFilters.replaceChildren();
    versionFilters.replaceChildren();
    get("genreFilterSummary").textContent = "Browse genres";
    get("versionFilterSummary").textContent = "Browse release versions";
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
      renderPlaylists();
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

  previous.addEventListener("click", () => {
    const queued = state.queue && nextPlayableIndex(-1);
    if (state.queue && !queued) return;
    select(queued ? queued.candidate : (state.index - 1 + state.releases.length) % state.releases.length, 0, { preserveQueue: Boolean(queued) });
  });
  next.addEventListener("click", () => {
    const queued = state.queue && nextPlayableIndex();
    if (state.queue && !queued) return;
    select(queued ? queued.candidate : (state.index + 1) % state.releases.length, 0, { preserveQueue: Boolean(queued) });
  });
  playlistForm.addEventListener("submit", event => {
    event.preventDefault();
    const name = playlistName.value.trim();
    if (!name || name.length > 80) {
      reportPlaylist("Enter a playlist name between 1 and 80 characters.");
      playlistName.focus();
      return;
    }
    if (state.playlists.some(playlist => playlist.name.toLowerCase() === name.toLowerCase())) {
      reportPlaylist("A playlist with that name already exists.");
      return;
    }
    const id = window.crypto?.randomUUID?.() || `playlist-${Date.now()}-${state.playlists.length}`;
    if (persistPlaylists([...state.playlists, { id, name, releaseIds: [] }])) {
      playlistName.value = "";
      addToPlaylist.value = id;
      reportPlaylist(`Created “${name}”. Select a release, then choose Add release.`);
    }
  });
  addToPlaylistButton.addEventListener("click", () => {
    const release = selected();
    const playlist = state.playlists.find(item => item.id === addToPlaylist.value);
    if (!release || !playlist) {
      reportPlaylist("Choose a playlist and release first.");
      return;
    }
    if (playlist.releaseIds.includes(release.id)) {
      reportPlaylist("That release is already in this playlist.");
      return;
    }
    const updated = state.playlists.map(item => item.id === playlist.id
      ? { ...item, releaseIds: [...item.releaseIds, release.id] } : item);
    if (persistPlaylists(updated)) reportPlaylist(`Added “${release.title || "release"}” to “${playlist.name}”.`);
  });
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
    select(upcoming.candidate, 0, { preserveQueue: Boolean(state.queue) });
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
  renderPlaylists();
  return { load, select, state };
}

if (typeof document !== "undefined" && document.getElementById("tracks")) {
  void createGateway({ document, window, fetcher: fetch }).load();
}
