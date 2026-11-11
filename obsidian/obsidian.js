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
  const state = { releases: [], index: -1, generation: 0 };
  let lyrics = [], lyricNodes = [], activeLyric = -1;
  const telemetry = window.HaloListeningTelemetry?.bindAudio(audio, () => state.releases[state.index]?.id);
  const selected = () => state.releases[state.index];
  const setStatus = value => { status.textContent = value; };
  const setPlaying = value => get("pulse").classList.toggle("playing", value);

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
    tracks.replaceChildren(...state.releases.map((release, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "track";
      button.setAttribute("aria-pressed", String(index === state.index));
      const label = document.createElement("span");
      const title = document.createElement("strong");
      const artist = document.createElement("small");
      const action = document.createElement("span");
      title.textContent = release.title || "Untitled release";
      artist.textContent = release.artist || "Artist";
      action.textContent = index === state.index ? "SELECTED" : "SELECT →";
      label.append(title, artist);
      button.append(label, action);
      button.addEventListener("click", () => select(index));
      return button;
    }));
  }

  function select(index) {
    if (!state.releases[index]) return;
    telemetry?.reset();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlaying(false);
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
    share.disabled = false;
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
      setStatus("Press play to listen.");
    } else {
      audio.hidden = true;
      loop.disabled = true;
      setStatus("In-page audio is unavailable for this release. Explore its approved links.");
    }
    renderTracks();
    const url = new URL(window.location.href);
    url.searchParams.set("song", release.id);
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
    state.index = -1;
    renderLyrics("");
    tracks.replaceChildren();
    previous.disabled = next.disabled = true;
    share.disabled = true;
    loop.disabled = true;
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
      select(index < 0 ? 0 : index);
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
  retry.addEventListener("click", load);
  audio.addEventListener("playing", () => { setPlaying(true); setStatus("Playing."); });
  audio.addEventListener("timeupdate", updateLyrics);
  audio.addEventListener("seeked", updateLyrics);
  audio.addEventListener("waiting", () => { setPlaying(false); setStatus("Buffering…"); });
  audio.addEventListener("pause", () => { setPlaying(false); if (selected() && !audio.error) setStatus(audio.ended ? "Playback ended." : "Paused."); });
  audio.addEventListener("error", () => { setPlaying(false); if (selected()) setStatus("Audio could not be played. Try again or explore the release link."); });
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
