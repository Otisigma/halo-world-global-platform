import {
  PLAYLIST_STORAGE_KEY, readPlaylists, writePlaylists, playlistName, publicPlaylistReleases,
  movePlaylistRelease, curatorMilestone, createPlaylistQueue
} from "../lib/personal-playlists.js";
import { playlistWorld, contentAllowed } from "../lib/playlist-world.js";
import { mountPlaylistWorldEditor } from "./playlist-world-editor.js";
import { createPlaylistMixer } from "./playlist-mixer.js";
import { mountCloudPlaylists } from "./playlist-cloud.js";

export function createPlaylistStudio({ document, window, root, getReleases, player, trackFor, notify }) {
  root.innerHTML = `<header><p class="section-index">Your listening world</p>
    <h2 id="playlistStudioTitle">Make a playlist. Build a journey.</h2>
    <p>Press + on any song to save it. Name your world, shape its order and stay for the next song.</p></header>
    <p>Browser playlists are shared with your Obsidian Gateway and stay local unless you explicitly save to your HALO account. No audio downloads.</p>
    <form data-create-playlist class="playlist-name-form">
      <label>New playlist name<input name="name" maxlength="80" required placeholder="Night drive, Dream state..." autocomplete="off"></label>
      <button type="submit">Create playlist</button>
    </form>
    <div class="playlist-session-controls">
      <label><input type="checkbox" data-repeat-playlist> Repeat my playlist</label>
      <button type="button" data-stop-playlist>Stop playlist continuation</button>
      <button type="button" data-playlist-previous>Previous song</button>
      <button type="button" data-playlist-next>Next song</button>
      <label>Volume<input type="range" min="0" max="100" value="100" data-playlist-volume></label>
      <label><input type="checkbox" data-playlist-mute> Mute</label>
    </div>
    <p data-playlist-status role="status" aria-live="polite"></p>
    <div class="playlist-mix-controls"><p data-mix-track role="status" aria-live="polite"></p>
      <button type="button" data-mix-toggle>Pause / resume mixed playback</button>
      <button type="button" data-stop-mix>Stop mixed playback</button></div>
    <div data-playlist-library></div>
    <aside class="playlist-level-up"><h3>Take your world further</h3>
      <p>Open a song in Dreamweaver, propose an explainable catalog journey in Shape this world, bring references to Album Builder, or use DJ Deck for hands-on mixing. Mix styles use real crossfades and optional bounded tempo adjustment; they do not perform beat-phase alignment or render a mix file.</p>
      <a href="/dreamweaver/">Explore Dreamweaver set requests</a>
      <a href="/dj-deck.html">Open DJ Deck</a>
      <a href="/track-drops/">Manage fan rewards and consent</a>
      <p>Curator levels below are browser-local milestones, not HP, spendable points, prizes or listening rewards. Real rewards keep their existing eligibility rules.</p>
    </aside>
    <dialog data-playlist-dialog aria-labelledby="playlistDialogTitle">
      <form data-save-song>
        <h2 id="playlistDialogTitle">Add to playlist</h2><p data-playlist-song></p>
        <label>Playlist<select name="playlist"></select></label>
        <label data-new-playlist-label>Name your new playlist<input name="name" maxlength="80" autocomplete="off"></label>
        <p data-dialog-status role="status" aria-live="polite"></p>
        <div class="playlist-dialog-actions"><button type="submit">Add song</button><button type="button" data-close-playlist>Cancel</button></div>
      </form>
    </dialog>`;
  const find = selector => root.querySelector(selector);
  const status = find("[data-playlist-status]");
  const dialog = find("[data-playlist-dialog]");
  const songForm = find("[data-save-song]");
  const createForm = find("[data-create-playlist]");
  const library = find("[data-playlist-library]");
  let playlists = [], pendingId = "", lastChosen = "", opener = null, available = true, externalPlaylist = null, cloud;
  const report = message => { status.textContent = message; };
  const error = cause => {
    console.error("Playlist studio", cause);
    report(cause.message || "Your playlists could not be saved in this browser.");
    find("[data-dialog-status]").textContent = status.textContent;
  };
  const queue = createPlaylistQueue({
    player, getPlaylist: id => playlists.find(item => item.id === id) || (externalPlaylist?.id === id ? externalPlaylist : null), getReleases, trackFor,
    isAllowed: (release, playlist) => contentAllowed(release, playlistWorld(playlist.world).preferences.content),
    repeat: () => find("[data-repeat-playlist]").checked, report,
    onStart: () => { mixer.stop(); window.dispatchEvent(new window.CustomEvent("halo:personal-queue-start")); }
  });
  const mixer = createPlaylistMixer({
    window, player, report,
    onTrack: track => { find("[data-mix-track]").textContent = `Mixed playback: ${track.title} - ${track.artist}`; }
  });
  const stop = () => { queue.stop(); mixer.stop(); find("[data-mix-track]").textContent = ""; };
  async function startPlayback(playlist) {
    stop();
    const preferences = playlistWorld(playlist.world).preferences;
    if (preferences.transitions === "original" && !preferences.normalize) {
      queue.start(playlist.id); return;
    }
    const tracks = publicPlaylistReleases(playlist, getReleases())
      .filter(release => contentAllowed(release, preferences.content) && trackFor(release).src)
      .map(release => ({ ...trackFor(release), bpm: release.bpm }));
    const started = await mixer.start(tracks, { ...preferences, repeat: find("[data-repeat-playlist]").checked });
    if (!started && mixer.fallbackAllowed) {
      queue.start(playlist.id);
      report("Mix mode unavailable for this browser or external stream. Original playback selected explicitly as the safe fallback.");
    }
  }
  function read() {
    try {
      playlists = readPlaylists(window.localStorage);
      available = true;
    } catch (cause) {
      available = false;
      queue.stop();
      error(new Error(`Saved playlists could not be accessed in this browser: ${cause.message}`));
    }
    createForm.querySelector('button[type="submit"]').disabled = !available;
    document.querySelectorAll("[data-add-playlist]").forEach(button => { button.disabled = !available; });
    return available;
  }
  function save(next, message) {
    next = next.map(item => {
      if (!item.world) return item;
      const world = playlistWorld(item.world);
      return { ...item, world: { ...world, chapters: world.chapters.filter(chapter => item.releaseIds.includes(chapter.releaseId)) } };
    });
    try {
      writePlaylists(window.localStorage, next);
    } catch (cause) {
      error(new Error(`Could not save your playlist. Check browser storage and try again: ${cause.message}`));
      return false;
    }
    playlists = next;
    if (queue.activeId && !playlists.some(item => item.id === queue.activeId) && queue.activeId !== externalPlaylist?.id) queue.stop();
    const focused = document.activeElement;
    const world = focused?.closest(".playlist-world");
    const row = focused?.closest("li");
    const focusTarget = world ? {
      id: world.dataset.playlistId, releaseId: row?.dataset.releaseId, text: focused.textContent,
      rename: focused.tagName === "INPUT"
    } : null;
    render();
    if (focusTarget) {
      const section = [...library.children].find(item => item.dataset.playlistId === focusTarget.id);
      const container = focusTarget.releaseId
        ? [...(section?.querySelectorAll("li") || [])].find(item => item.dataset.releaseId === focusTarget.releaseId) : section;
      const target = focusTarget.rename ? container?.querySelector("input")
        : [...(container?.querySelectorAll("button") || [])].find(item => item.textContent === focusTarget.text && !item.disabled);
      (target || section?.querySelector("input") || createForm.elements.name).focus();
    }
    report(message);
    notify?.(message);
    return true;
  }
  const newId = () => window.crypto.randomUUID();
  const button = (label, action, disabled = false) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.disabled = disabled;
    node.addEventListener("click", action);
    return node;
  };
  const updatePlaylist = (id, transform, message) => {
    if (!read()) return;
    try {
      if (!playlists.some(item => item.id === id)) throw new Error("That playlist was removed. Refresh your selection.");
      save(playlists.map(item => item.id === id ? transform(item) : item), message);
    } catch (cause) { error(cause); }
  };
  function render() {
    if (!read()) return;
    if (queue.activeId && !playlists.some(item => item.id === queue.activeId) && queue.activeId !== externalPlaylist?.id) queue.stop();
    library.replaceChildren(...playlists.map(playlist => {
      const section = document.createElement("article");
      section.className = "playlist-world";
      section.dataset.playlistId = playlist.id;
      const releases = publicPlaylistReleases(playlist, getReleases());
      const heading = document.createElement("h3");
      heading.textContent = playlist.name;
      const badge = document.createElement("p");
      badge.className = "playlist-milestone";
      badge.textContent = `${curatorMilestone(releases)} / ${releases.length} available songs`;
      const hint = document.createElement("p");
      hint.textContent = "Collect 5 songs for Journey builder; 10 songs from at least 3 artists for World selector.";
      const rename = document.createElement("form");
      rename.className = "playlist-name-form";
      const label = document.createElement("label");
      label.textContent = "Playlist name";
      const input = document.createElement("input");
      input.value = playlist.name;
      input.maxLength = 80;
      input.required = true;
      label.append(input);
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Rename";
      rename.append(label, submit);
      rename.addEventListener("submit", event => {
        event.preventDefault();
        updatePlaylist(playlist.id, item => ({ ...item, name: playlistName(input.value, playlists, item.id) }), "Playlist renamed.");
      });
      const actions = document.createElement("div");
      actions.className = "playlist-world-actions";
      actions.append(
        button("Play playlist", () => { if (read()) startPlayback(playlist).catch(error); }, !releases.some(release => trackFor(release).src)),
        button("Delete playlist", () => {
          if (read()) save(playlists.filter(item => item.id !== playlist.id), `Deleted "${playlist.name}".`);
        })
      );
      if (releases.length) {
        const album = document.createElement("a");
        album.href = `/album-concierge/?purpose=project&playlist=${encodeURIComponent(playlist.id)}`;
        album.textContent = "Inspire an album";
        actions.append(album);
      }
      const list = document.createElement("ol");
      for (const [index, id] of playlist.releaseIds.entries()) {
        const release = releases.find(item => item.id === id);
        const item = document.createElement("li");
        item.dataset.releaseId = id;
        const title = document.createElement("span");
        const chapter = playlistWorld(playlist.world).chapters.find(item => item.releaseId === id);
        title.textContent = release ? `${chapter?.label ? `${chapter.label} / ` : ""}${release.title || "Untitled"} - ${release.artist || "Artist"}` : "Song unavailable in the current public catalog";
        const controls = document.createElement("div");
        controls.append(
          button("Move up", () => updatePlaylist(playlist.id, entry => movePlaylistRelease(entry, id, -1), "Song moved up."), index === 0),
          button("Move down", () => updatePlaylist(playlist.id, entry => movePlaylistRelease(entry, id, 1), "Song moved down."), index === playlist.releaseIds.length - 1),
          button("Remove", () => updatePlaylist(playlist.id, entry => ({ ...entry, releaseIds: entry.releaseIds.filter(value => value !== id) }), "Song removed."))
        );
        for (const control of controls.children) control.setAttribute("aria-label", `${control.textContent}: ${release?.title || "unavailable song"}`);
        if (release) {
          const dream = document.createElement("a");
          dream.href = `/dreamweaver/?song=${encodeURIComponent(release.id)}`;
          dream.textContent = "Dreamweaver";
          dream.setAttribute("aria-label", `Open ${release.title || "song"} in Dreamweaver`);
          controls.append(dream);
        }
        item.append(title, controls);
        list.append(item);
      }
      section.append(heading, badge, hint, rename, actions, list);
      actions.append(button("Save to account (replaces your previously saved account version)", () => cloud?.saveLocal(playlist)));
      mountPlaylistWorldEditor({
        document, window, root: section, playlist, getReleases, report,
        save: next => {
          if (!read()) throw new Error("Could not read the playlist. Check browser storage and try again.");
          if (!playlists.some(item => item.id === playlist.id)) throw new Error("That playlist was removed. Refresh your selection.");
          if (!save(playlists.map(item => item.id === playlist.id ? next : item), "Playlist world saved. Press Play to use its listening controls.")) {
            throw new Error("Could not save your playlist. Check browser storage and try again.");
          }
        }
      });
      return section;
    }));
    if (!playlists.length) {
      const empty = document.createElement("p");
      empty.textContent = "Your world starts with one song. Press + on a song card or create a playlist above.";
      library.append(empty);
    }
  }
  function open(releaseId, trigger) {
    if (!read()) return;
    const release = getReleases().find(item => item.id === releaseId);
    if (!release || !publicPlaylistReleases({ releaseIds: [releaseId] }, [release]).length) {
      report("That song is not available in the current public catalog.");
      return;
    }
    pendingId = releaseId;
    opener = trigger;
    find("[data-playlist-song]").textContent = `${release.title || "Untitled"} - ${release.artist || "Artist"}`;
    find("[data-dialog-status]").textContent = "";
    songForm.reset();
    const select = songForm.elements.playlist;
    select.replaceChildren(...[{ id: "", name: "Create a new playlist" }, ...playlists].map(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      return option;
    }));
    select.value = playlists.some(item => item.id === lastChosen) ? lastChosen : playlists[0]?.id || "";
    updateNameField();
    dialog.showModal();
    (select.value ? select : songForm.elements.name).focus();
  }
  function updateNameField() {
    const isNew = !songForm.elements.playlist.value;
    find("[data-new-playlist-label]").hidden = !isNew;
    songForm.elements.name.required = isNew;
  }
  songForm.elements.playlist.addEventListener("change", updateNameField);
  find("[data-close-playlist]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { pendingId = ""; if (opener?.isConnected) opener.focus(); });
  songForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!read()) return;
    try {
      if (!publicPlaylistReleases({ releaseIds: [pendingId] }, getReleases()).length) throw new Error("This song is no longer available.");
      let playlist = playlists.find(item => item.id === songForm.elements.playlist.value);
      if (songForm.elements.playlist.value && !playlist) throw new Error("That playlist was removed. Cancel and choose again.");
      if (!playlist) playlist = { id: newId(), name: playlistName(songForm.elements.name.value, playlists), releaseIds: [] };
      if (playlist.releaseIds.includes(pendingId)) throw new Error("That song is already in this playlist.");
      const updated = { ...playlist, releaseIds: [...playlist.releaseIds, pendingId] };
      const next = playlists.some(item => item.id === playlist.id)
        ? playlists.map(item => item.id === playlist.id ? updated : item) : [...playlists, updated];
      if (save(next, `Added song to "${playlist.name}".`)) {
        lastChosen = playlist.id;
        dialog.close();
      }
    } catch (cause) { error(cause); }
  });
  createForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!read()) return;
    try {
      const name = playlistName(createForm.elements.name.value, playlists);
      if (save([...playlists, { id: newId(), name, releaseIds: [] }], `Created "${name}". Press + on a song to add it.`)) createForm.reset();
    } catch (cause) { error(cause); }
  });
  find("[data-stop-playlist]").addEventListener("click", () => {
    queue.stop();
    mixer.stopContinuation();
    report("Playlist continuation stopped. The current song can keep playing.");
  });
  for (const event of ["halo:chart-queue-start", "halo:discovery-queue-start"]) window.addEventListener(event, stop);
  document.addEventListener("click", event => {
    const add = event.target.closest("[data-add-playlist]");
    if (add && !add.disabled) open(add.dataset.addPlaylist, add);
    if (event.target.closest("[data-play-track-id], [data-player-close]")) stop();
  });
  window.addEventListener("halo:trackchange", event => {
    if (!event.detail) queue.stop();
  });
  window.addEventListener("storage", event => {
    if (event.key === PLAYLIST_STORAGE_KEY || event.key === null) render();
  });
  find("[data-mix-toggle]").addEventListener("click", () => mixer.toggle().catch(error));
  const volume = find("[data-playlist-volume]"), mute = find("[data-playlist-mute]");
  volume.value = String(Math.round((player.audio.volume ?? 1) * 100));
  mute.checked = Boolean(player.audio.muted);
  for (const control of [volume, mute]) control.addEventListener("input", () => {
    try {
      const value = Number(volume.value) / 100;
      mixer.setVolume(value, mute.checked);
      player.audio.volume = value; player.audio.muted = mute.checked;
    } catch (cause) { error(cause); }
  });
  for (const [selector, direction] of [["[data-playlist-previous]", -1], ["[data-playlist-next]", 1]]) {
    find(selector).addEventListener("click", () => {
      if (mixer.running) mixer.skip(direction).catch(error);
      else queue.step(direction);
    });
  }
  find("[data-stop-mix]").addEventListener("click", () => { stop(); report("Mixed playback stopped."); });
  find("[data-repeat-playlist]").addEventListener("change", () => {
    if (mixer.running) report("Press Play again to apply the changed repeat setting to mixed playback.");
  });
  const api = {
    render, open, queue, mixer, stop,
    playExternal: playlist => {
      externalPlaylist = { ...playlist, id: `cloud-${playlist.id}` };
      return startPlayback(externalPlaylist);
    },
    importPublic: playlist => {
      if (!read()) return;
      try {
        const base = playlist.name.slice(0, 60);
        let name = base, count = 1;
        while (playlists.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${base} (${++count})`;
        const ids = publicPlaylistReleases(playlist, getReleases()).map(item => item.id);
        save([...playlists, { id: newId(), name, releaseIds: ids, world: { ...playlist.world, chapters: playlist.world.chapters.filter(chapter => ids.includes(chapter.releaseId)) } }], "Saved a public-reference copy in this browser. No audio or rights copied.");
      } catch (cause) { error(cause); }
    }
  };
  cloud = mountCloudPlaylists({ document, window, root, getReleases, studio: api, player, trackFor });
  render();
  return api;
}
