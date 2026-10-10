import { createDreamweaverLyricsEngine } from "../lib/dreamweaver-lyrics.js";
import { createLyricInteractionRecorder } from "../lib/journey-interactions.js";

export const MAX_ALBUM_TRACKS = 12;

export function addAlbumTrack(tracks, releaseId) {
  if (tracks.some(track => track.releaseId === releaseId)) throw new Error("This track is already in your arc.");
  if (tracks.length >= MAX_ALBUM_TRACKS) throw new Error("Your arc can contain at most 12 tracks.");
  return [...tracks, { releaseId, transitionSeconds: 0 }];
}

export function moveAlbumTrack(tracks, index, direction) {
  const next = [...tracks];
  const destination = index + direction;
  if (destination < 0 || destination >= tracks.length) return next;
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function safePreviewUrl(value) {
  if (typeof value !== "string" || /[\s\\]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function createJourneyController({ doc = globalThis.document, win = globalThis.window,
  fetcher = globalThis.fetch, lyricsFactory = createDreamweaverLyricsEngine } = {}) {
  const el = id => doc.getElementById(id);
  const state = { tracks: [], sequence: [], albumId: null, playing: null, previewIndex: -1, fadeInSeconds: 0, busy: false };
  const status = message => { el("status").textContent = message; };
  const make = (tag, text, className = "") => {
    const node = doc.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action) => {
    const node = make("button", text);
    node.type = "button";
    node.addEventListener("click", () => run(action));
    return node;
  };
  async function api(query = "", body) {
    const response = await fetcher(`/api/empath-journey${query}`, {
      credentials: "same-origin",
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in through your HALO profile to vote or save." : result.message || "This action is unavailable. Please try again.");
    return result;
  }
  async function run(action) {
    if (state.busy) return;
    state.busy = true;
    try { await action(); } catch (error) { status(error.message || "Please try again."); }
    finally { state.busy = false; }
  }
  const recordLyric = createLyricInteractionRecorder({ fetcher,
    enabled: () => el("recordLyrics").checked, releaseId: () => state.playing?.id || "" });
  const lyrics = lyricsFactory({
    root: el("lyricsRoot"), list: el("lyricsList"), viewport: el("lyricsViewport"),
    audio: el("audio"), modeToggle: el("lyricsMode"), status: el("lyricsStatus"), doc, win,
    onSeek: seconds => recordLyric(seconds), onInsight: line => recordLyric(line.time ?? 0)
  });
  function play(track, index = -1, fadeInSeconds = 0) {
    if (!track) { status("This track is no longer available."); return; }
    const url = safePreviewUrl(track?.previewUrl);
    state.playing = track;
    state.previewIndex = index;
    state.fadeInSeconds = fadeInSeconds;
    const audio = el("audio");
    el("nowPlaying").textContent = `${track.title} · ${track.artist}`;
    lyrics.setSource(track.lyricsText || "");
    if (!url) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      state.previewIndex = -1;
      status("The lyric book is open. No audio preview is available for this track.");
      return;
    }
    audio.src = url;
    audio.volume = fadeInSeconds ? 0 : 1;
    Promise.resolve(audio.play()).catch(() => status("Press play to begin your preview."));
  }
  function renderSequence() {
    state.previewIndex = -1;
    state.fadeInSeconds = 0;
    el("audio").volume = 1;
    el("sequence").replaceChildren();
    state.sequence.forEach((entry, index) => {
      const track = state.tracks.find(item => item.id === entry.releaseId);
      const row = make("li", track?.title || "Track unavailable");
      const actions = make("div", "", "actions");
      actions.append(button(`Preview track ${index + 1}`, () => play(track, index)));
      const up = button("Move up", () => { state.sequence = moveAlbumTrack(state.sequence, index, -1); renderSequence(); });
      up.disabled = index === 0;
      const down = button("Move down", () => { state.sequence = moveAlbumTrack(state.sequence, index, 1); renderSequence(); });
      down.disabled = index === state.sequence.length - 1;
      actions.append(up, down, button("Remove", () => { state.sequence.splice(index, 1); renderSequence(); }));
      const label = make("label", "Transition seconds");
      const select = make("select", "");
      select.setAttribute("aria-label", `Transition after track ${index + 1}`);
      Array.from({ length: 13 }, (_, seconds) => seconds).forEach(seconds => {
        const option = make("option", String(seconds));
        option.value = String(seconds);
        select.append(option);
      });
      select.value = String(entry.transitionSeconds);
      select.addEventListener("change", () => { entry.transitionSeconds = Number(select.value); });
      label.append(select);
      row.append(actions, label);
      el("sequence").append(row);
    });
    el("trackCount").textContent = `${state.sequence.length} / 12 tracks`;
  }
  function renderTracks() {
    el("tracks").replaceChildren();
    state.tracks.forEach(track => {
      const card = make("article", "", "track");
      card.append(make("h3", track.title), make("p", track.artist),
        make("p", track.momentum === "gathering" || Number(track.momentum) > 0 ? "Community momentum · moving together" : "A new chapter to discover"));
      const actions = make("div", "", "actions");
      for (const [kind, label] of [["track", "Track"], ["remix", "Remix"], ["priority", "Tracklist priority"]]) {
        actions.append(button(`${label} vote · ${Number(track.votes?.[kind]) || 0}`, async () => {
          await api("", { action: "vote", releaseId: track.id, kind });
          await refresh();
          status("Your voice is part of the journey. One vote per choice.");
        }));
      }
      actions.append(button("Add to album", () => { state.sequence = addAlbumTrack(state.sequence, track.id); renderSequence(); }),
        button("Preview & lyrics", () => play(track)));
      card.append(actions);
      el("tracks").append(card);
    });
    if (!state.tracks.length) el("tracks").append(make("p", "The next journey polls will appear here when artists open them."));
  }
  async function refresh() {
    const result = await api();
    state.tracks = result.tracks || [];
    el("presence").textContent = result.presence === "gathering" ? "Quiet presence · listening together" : "Quiet presence · a space to breathe";
    renderTracks();
    renderSequence();
  }
  function loadAlbum(album) {
    state.previewIndex = -1;
    state.albumId = album.id;
    state.sequence = album.tracks.map(track => ({ ...track }));
    el("albumName").value = album.name;
    el("shared").checked = album.shared;
    el("shareLink").hidden = !album.shared;
    if (album.shared) el("shareLink").setAttribute("href", `/empath-journey/?album=${encodeURIComponent(album.id)}`);
    else el("shareLink").removeAttribute("href");
    renderSequence();
  }
  async function save() {
    if (!el("albumName").value.trim()) throw new Error("Give your album a name.");
    if (!state.sequence.length) throw new Error("Add at least one track to your arc.");
    const result = await api("", { action: "album", ...(state.albumId ? { id: state.albumId } : {}),
      name: el("albumName").value.trim(), tracks: state.sequence, shared: el("shared").checked });
    loadAlbum(result.album);
    status("Album saved on your profile.");
  }
  async function loadMine() {
    const result = await api("?mine=1");
    el("albums").replaceChildren();
    for (const album of result.albums || []) el("albums").append(button(album.name, () => loadAlbum(album)));
    if (!result.albums?.length) el("albums").append(make("p", "Your saved arcs will appear here."));
  }
  el("save").addEventListener("click", () => run(save));
  el("loadMine").addEventListener("click", () => run(loadMine));
  el("refresh").addEventListener("click", () => run(refresh));
  el("newAlbum").addEventListener("click", () => run(() => {
    state.albumId = null; state.sequence = []; el("albumName").value = ""; el("shared").checked = false;
    el("shareLink").hidden = true; renderSequence(); status("A new arc is ready.");
  }));
  const audio = el("audio");
  audio.addEventListener("play", () => el("journey").classList.add("is-playing"));
  audio.addEventListener("pause", () => el("journey").classList.remove("is-playing"));
  audio.addEventListener("timeupdate", () => {
    const fadeOutSeconds = state.sequence[state.previewIndex]?.transitionSeconds || 0;
    const fadeInSeconds = state.fadeInSeconds;
    if (!Number.isFinite(audio.duration)) return;
    audio.volume = Math.max(0, Math.min(1, fadeInSeconds ? audio.currentTime / fadeInSeconds : 1,
      fadeOutSeconds ? (audio.duration - audio.currentTime) / fadeOutSeconds : 1));
  });
  audio.addEventListener("ended", () => {
    el("journey").classList.remove("is-playing");
    if (state.previewIndex < 0) return;
    const next = state.previewIndex + 1;
    const fadeInSeconds = state.sequence[state.previewIndex]?.transitionSeconds || 0;
    if (next < state.sequence.length) play(state.tracks.find(track => track.id === state.sequence[next].releaseId), next, fadeInSeconds);
  });
  audio.addEventListener("error", () => status("This preview cannot be played here. Your album is still saved."));
  async function init() {
    await refresh();
    const albumId = new URL(win.location.href).searchParams.get("album");
    if (albumId) {
      const result = await api(`?album=${encodeURIComponent(albumId)}`);
      state.tracks = [...state.tracks, ...(result.tracks || []).filter(track => !state.tracks.some(item => item.id === track.id))];
      loadAlbum(result.album);
      // Shared listeners curate a copy; only the owner can edit the saved original.
      state.albumId = null;
      el("shared").checked = false;
      el("shareLink").hidden = true;
      el("shareLink").removeAttribute("href");
      status("Shared arc opened. Save to create your own copy.");
    }
  }
  return { state, init, save, refresh, loadMine, loadAlbum };
}

if (typeof document !== "undefined" && document.getElementById("journey")) {
  const controller = createJourneyController();
  controller.init().catch(() => { document.getElementById("status").textContent = "The journey is resting. Please refresh in a little while."; });
}
