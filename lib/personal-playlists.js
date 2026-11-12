import { playlistWorld } from "./playlist-world.js";

export const PLAYLIST_STORAGE_KEY = "halo_obsidian_playlists_v1";

export function validatePlaylists(playlists) {
  if (!Array.isArray(playlists) || playlists.some(item => !item || typeof item.id !== "string"
    || typeof item.name !== "string" || !Array.isArray(item.releaseIds)
    || item.releaseIds.some(id => typeof id !== "string"))) {
    throw new Error("Saved playlist data has an invalid format.");
  }
  for (const item of playlists) if (item.world !== undefined) playlistWorld(item.world);
  return playlists;
}

export function readPlaylists(storage) {
  const saved = storage.getItem(PLAYLIST_STORAGE_KEY);
  return saved === null ? [] : validatePlaylists(JSON.parse(saved));
}

export function writePlaylists(storage, playlists) {
  storage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(validatePlaylists(playlists)));
}

export function playlistName(value, playlists, exceptId = "") {
  const name = String(value || "").trim();
  if (!name || name.length > 80) throw new Error("Enter a playlist name between 1 and 80 characters.");
  if (playlists.some(item => item.id !== exceptId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A playlist with that name already exists.");
  }
  return name;
}

export function publicPlaylistReleases(playlist, releases) {
  return [...new Set(playlist.releaseIds)].map(id => releases.find(release => release.id === id
    && release.isLiveVisible !== false
    && ["published", "passed"].includes(String(release.status || "").trim().toLowerCase()))).filter(Boolean);
}

export function movePlaylistRelease(playlist, releaseId, direction) {
  const releaseIds = [...playlist.releaseIds];
  const index = releaseIds.indexOf(releaseId);
  const target = index + direction;
  if (![1, -1].includes(direction) || index < 0 || target < 0 || target >= releaseIds.length) {
    throw new Error("That song cannot move any further in this playlist.");
  }
  [releaseIds[index], releaseIds[target]] = [releaseIds[target], releaseIds[index]];
  return { ...playlist, releaseIds };
}

export function curatorMilestone(releases) {
  const artists = new Set(releases.map(release => release.artist?.trim().toLowerCase()).filter(Boolean)).size;
  if (releases.length >= 10 && artists >= 3) return "Level 3 / World selector";
  if (releases.length >= 5) return "Level 2 / Journey builder";
  if (releases.length >= 1) return "Level 1 / First spark";
  return "Start your first spark";
}

export function albumInspiration(playlist, releases) {
  const available = publicPlaylistReleases(playlist, releases);
  if (!available.length) throw new Error("This playlist has no currently available public songs.");
  const tracklist = available.map((release, index) =>
    `${index + 1}. ${release.title || "Untitled release"} - ${release.artist || "Artist"}`).join("\n");
  const brief = `Album inspiration: ${playlist.name}\n\nPublic listening references, in my chosen order:\n${tracklist}\n\nCreate an original album concept inspired by this journey, not copies of these recordings. These references do not grant remix, sampling, publishing or distribution rights.`;
  if (brief.length > 4000) throw new Error("This playlist is too long for the album story. Use a shorter inspiration playlist.");
  return brief;
}

export function createPlaylistQueue({ player, getPlaylist, getReleases, trackFor, repeat, report, onStart, isAllowed }) {
  let activeId = "";
  const stop = () => { activeId = ""; };
  const playable = playlist => publicPlaylistReleases(playlist, getReleases()).filter(release =>
    trackFor(release).src && (!isAllowed || isAllowed(release, playlist)));
  function start(id) {
    const playlist = getPlaylist(id);
    const first = playlist && playable(playlist)[0];
    if (!first) {
      report("This playlist has no songs with an in-page preview available.");
      return false;
    }
    onStart();
    activeId = id;
    const track = trackFor(first);
    if (player.track?.id === track.id && player.track.src === track.src) {
      player.audio.currentTime = 0;
      if (!["playing", "loading"].includes(player.status)) player.play(track);
    } else {
      player.play(track);
    }
    report(`Playing "${playlist.name}". Songs without previews are skipped.`);
    return true;
  }
  function handleEnded() {
    if (!activeId) return;
    const playlist = getPlaylist(activeId);
    const releases = playlist ? playable(playlist) : [];
    const index = releases.findIndex(release => release.id === player.track?.id);
    if (index < 0) {
      stop();
      report("Playlist continuation stopped because the current song is no longer available.");
      return;
    }
    const next = releases[index + 1] || (repeat() ? releases[0] : null);
    if (!next) {
      stop();
      report(`Finished "${playlist.name}". Choose another journey or play it again.`);
      return;
    }
    // The singleton toggles when given the same track; replay must explicitly rewind.
    if (next.id === player.track.id) player.audio.currentTime = 0;
    player.play(trackFor(next));
  }
  function step(direction) {
    const playlist = getPlaylist(activeId);
    if (!playlist || ![1, -1].includes(direction)) { report("Start a playlist before choosing another song."); return; }
    const releases = playable(playlist);
    const index = releases.findIndex(release => release.id === player.track?.id);
    if (index < 0) { stop(); report("The current song is no longer in this playable queue."); return; }
    const next = releases[index + direction] || (repeat() ? direction > 0 ? releases[0] : releases.at(-1) : null);
    if (!next || next.id === player.track?.id) { report("There is no other song in that direction."); return; }
    player.play(trackFor(next));
  }
  player.audio.addEventListener("ended", handleEnded);
  return { start, stop, step, handleEnded, get activeId() { return activeId; } };
}
