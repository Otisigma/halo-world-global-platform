import { contentAllowed, playlistWorld } from "../lib/playlist-world.js";
import { mountPlaylistWorldEditor } from "./playlist-world-editor.js";

export function createPlaylistClient(fetcher) {
  let generation = 0;
  return {
    reset() { generation++; },
    async request(query = "", body) {
      const ticket = generation;
      const response = await fetcher(`/api/playlists${query}`, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Account playlist service is unavailable. Use the Netlify environment with the reviewed playlist migration applied.");
      const data = await response.json();
      if (ticket !== generation) throw new Error("Account changed. Refresh before retrying; the earlier action may have completed.");
      if (!response.ok) throw new Error(data.message || "Account playlist request failed.");
      return data;
    }
  };
}

export function mountCloudPlaylists({ document, window, root, getReleases, studio, player, trackFor, fetcher = fetch }) {
  const section = document.createElement("section"); section.className = "playlist-cloud";
  section.innerHTML = `<h3>Your account / Shared listening worlds</h3>
    <p>Browser playlists stay local until you choose Save to account. Account playlists sync across your signed-in devices. Sharing is off by default. A listening link lets anyone with that link see the title, cover URL, dedication, chapters and public songs.</p>
    <button type="button" data-connect-playlists>Connect HALO account</button>
    <button type="button" data-disconnect-playlists hidden>Sign out</button>
    <form data-playlist-login hidden><label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Sign in</button><a href="/album-concierge/?purpose=self">Create a HALO account</a></form>
    <button type="button" data-refresh-cloud hidden>Refresh account playlists (discards unsaved editor changes)</button>
    <button type="button" data-join-playlist hidden>Accept this single-use collaborator invitation</button>
    <p data-cloud-status role="status" aria-live="polite"></p><p data-cloud-rewards></p>
    <div data-cloud-library></div><div data-shared-world></div>
    <p>Listening rooms are opt-in: the host publishes the current public song, pause state and playback time while broadcasting. Following a room polls that state every 5 seconds. No participant list, private audio, verified listens or playback-based points are collected here.</p>
    <button type="button" data-stop-room>Stop following / broadcasting</button>`;
  const roomControl = document.createElement("label"); roomControl.textContent = "Room content filter";
  const roomContent = document.createElement("select");
  for (const [value, text] of [["exclude-explicit", "Exclude explicit (unknown ratings allowed)"], ["clean-only", "Only catalog-labelled clean"], ["all", "Allow all ratings"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = text; roomContent.append(option);
  }
  roomContent.value = "exclude-explicit"; roomControl.append(roomContent); section.append(roomControl);
  root.append(section);
  const find = selector => section.querySelector(selector);
  const status = find("[data-cloud-status]"), library = find("[data-cloud-library]");
  const client = createPlaylistClient(fetcher);
  const params = new URL(window.location.href).searchParams;
  const invite = params.get("playlistInvite"), share = params.get("world");
  let identity, user, accountRows = [], refreshSequence = 0, authSequence = 0, roomTimer = null, roomSession = null, roomPending = null;
  const report = message => { status.textContent = message; };
  const fail = error => { console.error("Account playlist operation", error.name); report(error.message); };
  const element = (tag, text) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
  };
  const button = (text, callback) => {
    const node = element("button", text); node.type = "button";
    node.addEventListener("click", async () => {
      node.disabled = true;
      try { await callback(); } catch (error) { fail(error); }
      finally { node.disabled = false; }
    });
    return node;
  };
  function stopRoom() {
    if (roomTimer !== null) window.clearInterval(roomTimer);
    roomTimer = null; roomSession = null;
  }
  function accountChanged(next) {
    authSequence++;
    client.reset(); refreshSequence++;
    user = next || null; accountRows = [];
    library.replaceChildren(); find("[data-cloud-rewards]").textContent = "";
    stopRoom(); studio.stop();
    find("[data-playlist-login]").hidden = Boolean(user);
    find("[data-connect-playlists]").hidden = Boolean(user);
    find("[data-disconnect-playlists]").hidden = !user;
    find("[data-refresh-cloud]").hidden = !user;
    find("[data-join-playlist]").hidden = !user || !/^[a-f0-9]{64}$/.test(invite || "");
    report(user ? "Connected. Load or save account playlists explicitly." : "Signed out. Account playlists and room state cleared; your browser-local playlists remain.");
  }
  async function connect() {
    if (!identity) {
      if (!window.haloIdentity) await import("/identity.js");
      identity = window.haloIdentity;
      if (!identity) throw new Error("HALO membership is unavailable.");
      identity.onAuthChange((_event, next) => accountChanged(next));
    }
    const ticket = authSequence;
    const next = await identity.getUser();
    if (ticket !== authSequence) return;
    accountChanged(next);
    if (next) await refresh();
  }
  async function refresh() {
    if (!user) throw new Error("Connect and sign in before loading account playlists.");
    const ticket = ++refreshSequence;
    const data = await client.request();
    if (ticket !== refreshSequence || !user) return;
    accountRows = data.playlists;
    renderRewards(data.rewards);
    library.replaceChildren(...accountRows.map(playlist => {
      const entry = element("article"); entry.className = "playlist-cloud-entry";
      entry.append(element("h4", `${playlist.name} / ${playlist.role}`),
        button("Open account playlist", () => open(playlist.id)));
      return entry;
    }));
    report("Account playlists refreshed.");
  }
  function renderRewards(rewards) {
    find("[data-cloud-rewards]").textContent = rewards.enabled
      ? `${rewards.points} member points / ${rewards.tier.label}. Curator bonuses: 25 points for 5 songs and 50 for 10, each once per account lifetime, from at least 3 other artists.`
      : "Real member rewards are off. Enable them explicitly in Track Drops; listening never grants playlist points.";
  }
  const update = playlist => client.request("", {
    action: "update", id: playlist.id, revision: playlist.revision,
    name: playlist.name, releaseIds: playlist.releaseIds, world: playlistWorld(playlist.world)
  });
  async function open(id) {
    const data = await client.request(`?id=${encodeURIComponent(id)}`);
    const target = library.querySelector(`[data-open-playlist="${id}"]`) || element("article");
    target.dataset.openPlaylist = id; target.className = "playlist-world";
    target.replaceChildren();
    if (!target.isConnected) library.append(target);
    renderDetail(target, data.playlist);
  }
  function linkField(target, token, kind) {
    const output = element("div");
    output.setAttribute(kind === "invite" ? "data-invite-link" : "data-share-link", "");
    const label = element("label", kind === "invite" ? "Single-use invite / expires in 7 days" : "Unlisted listening link / previous link revoked");
    const input = element("input");
    input.readOnly = true;
    input.value = new URL(`/music/?${kind === "invite" ? "playlistInvite" : "world"}=${token}`, window.location.origin).href;
    label.append(input);
    output.append(label, button("Copy this link", async () => {
      try { await window.navigator.clipboard.writeText(input.value); report("Link copied. Share it only with your intended audience."); }
      catch { input.focus(); input.select(); report("Clipboard unavailable. Copy the selected link manually."); }
    })); target.append(output);
  }
  async function performRoomTick() {
    const session = roomSession;
    if (!session || document.hidden) return;
    try {
      if (session.hosting) {
        const track = player.track;
        if (!track || !session.ids.includes(track.id) || studio.mixer.running) {
          await client.request("", { action: "room", id: session.id, state: null });
          if (roomSession === session) { stopRoom(); report("Broadcast ended: the original player left this playlist."); }
          return;
        }
        await client.request("", { action: "room", id: session.id,
          state: { releaseId: track.id, seconds: player.audio.currentTime || 0, playing: !player.audio.paused } });
        return;
      }
      const data = await client.request(session.query);
      if (roomSession !== session) return;
      const room = data.playlist.room;
      if (!room || Date.now() - Date.parse(room.at) > 20_000) {
        player.audio.pause(); report("The host's broadcast ended or is stale. No stale room audio will start."); return;
      }
      const release = getReleases().find(item => item.id === room.releaseId);
      if (!release || !trackFor(release).src) { report("The host song has no public in-page preview here."); return; }
      if (!contentAllowed(release, roomContent.value)) { player.audio.pause(); report("The host song is excluded by your room content filter."); return; }
      if (!room.playing) { player.audio.pause(); report("The host is paused. No new song is started."); return; }
      if (player.track?.id !== release.id) player.play(trackFor(release));
      else if (room.playing && player.audio.paused) player.resume();
      if (!room.playing) player.audio.pause();
      const seek = () => {
        if (roomSession !== session || player.track?.id !== release.id) return;
        const elapsed = room.playing ? Math.max(0, (Date.now() - Date.parse(room.at)) / 1000) : 0;
        if (Number.isFinite(player.audio.duration)) {
          const target = Math.min(Math.max(0, player.audio.duration - .1), room.seconds + elapsed);
          if (Math.abs(player.audio.currentTime - target) > 1.5) player.audio.currentTime = target;
        }
      };
      if (player.audio.readyState >= 1) seek();
      else player.audio.addEventListener("loadedmetadata", seek, { once: true });
      report(`Following the host: ${release.title}. Playback may require another tap on the player on this device.`);
    } catch (error) {
      if (roomSession === session) { stopRoom(); if (!session.hosting) player.audio.pause(); }
      throw error;
    }
    function followTick() {
      if (roomPending) return roomPending;
      roomPending = performRoomTick().finally(() => { roomPending = null; });
      return roomPending;
    }
  }
  function startFollow(query) {
    stopRoom(); studio.stop(); player.close();
    window.dispatchEvent(new window.CustomEvent("halo:personal-queue-start"));
    roomSession = { query: query.replace(/^\?(?:id|share)=/, "?room="), hosting: false };
    followTick().catch(fail); roomTimer = window.setInterval(() => followTick().catch(fail), 5000);
  }
  function renderDetail(target, playlist, query = `?id=${playlist.id}`) {
    const canEdit = ["owner", "editor"].includes(playlist.role), owner = playlist.role === "owner";
    target.append(element("h3", playlist.name));
    const actions = element("div"); actions.className = "playlist-world-actions";
    actions.append(button("Play this world", () => { stopRoom(); return studio.playExternal(playlist); }));
    actions.append(button("Keep a browser copy / choose my own controls", () => studio.importPublic(playlist)));
    if (!owner) actions.append(button("Follow this host (original playback)", () => startFollow(query)));
    target.append(actions);
    if (canEdit) {
      const rename = element("form"), input = element("input");
      const label = element("label", "Account playlist name"); input.value = playlist.name; input.maxLength = 80; input.required = true;
      label.append(input); rename.append(label, element("button", "Rename"));
      rename.addEventListener("submit", async event => {
        event.preventDefault();
        try { await update({ ...playlist, name: input.value }); report("Account playlist renamed."); await open(playlist.id); }
        catch (error) { fail(error); }
      }); target.append(rename);
    }
    const list = element("ol");
    playlist.tracks.forEach((track, index) => {
      const row = element("li", track.available ? `${track.title} - ${track.artist}` : "Song unavailable in the current public catalog");
      if (canEdit) for (const [text, direction] of [["Move up", -1], ["Move down", 1], ["Remove", 0]]) {
        if (direction && (index + direction < 0 || index + direction >= playlist.releaseIds.length)) continue;
        row.append(button(`${text}: ${track.title || "unavailable song"}`, async () => {
          const ids = [...playlist.releaseIds];
          if (direction) [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
          else ids.splice(index, 1);
          await update({ ...playlist, releaseIds: ids, world: { ...playlist.world, chapters: playlist.world.chapters.filter(chapter => ids.includes(chapter.releaseId)) } });
          report("Saved account playlist order."); await open(playlist.id);
        }));
      }
      list.append(row);
    });
    target.append(list);
    mountPlaylistWorldEditor({
      document, window, root: target, playlist, getReleases, canEdit, report,
      save: async next => { await update(next); report("Account world saved."); await open(playlist.id); }
    });
    if (playlist.role !== "listener") {
      const suggestions = element("section");
      suggestions.append(element("h4", "Vote on the next song / host decides"));
      const form = element("form"), selector = element("select"), label = element("label", "Suggest a public song");
      for (const release of getReleases()) {
        const option = element("option", `${release.title} - ${release.artist}`); option.value = release.id; selector.append(option);
      }
      label.append(selector); form.append(label, element("button", "Suggest"));
      form.addEventListener("submit", async event => {
        event.preventDefault();
        try { await client.request("", { action: "suggest", id: playlist.id, releaseId: selector.value }); report("Suggestion saved."); await open(playlist.id); }
        catch (error) { fail(error); }
      }); suggestions.append(form);
      for (const item of playlist.suggestions) {
        const row = element("p", `${item.title} - ${item.artist} / ${item.votes} votes`);
        if (!item.voted) row.append(button("Vote for this song", async () => {
          await client.request("", { action: "vote", id: playlist.id, suggestionId: item.id }); await open(playlist.id);
        }));
        if (canEdit) for (const approve of [true, false]) row.append(button(approve ? "Approve" : "Reject", async () => {
          await client.request("", { action: "moderate", id: playlist.id, suggestionId: item.id, approve }); await open(playlist.id);
        }));
        suggestions.append(row);
      }
      target.append(suggestions);
    }
    if (owner) {
      const sharing = element("section"); sharing.append(element("h4", "Owner controls / private unless you share"));
      sharing.append(button("Create / rotate unlisted listening link", async () => {
        const data = await client.request("", { action: "share", id: playlist.id, enabled: true });
        sharing.querySelectorAll("[data-share-link]").forEach(node => node.remove()); linkField(sharing, data.token, "share");
        report("Unlisted sharing enabled. Anyone with the new link can see this world's public-safe content.");
      }), button("Disable listening link", async () => {
        await client.request("", { action: "share", id: playlist.id, enabled: false }); await open(playlist.id); report("All listening links for this world are revoked.");
      }));
      for (const role of ["contributor", "editor"]) sharing.append(button(`Invite ${role} / single use`, async () => {
        const data = await client.request("", { action: "invite", id: playlist.id, role }); linkField(sharing, data.token, "invite");
      }));
      for (const member of playlist.collaborators) sharing.append(button(`Remove ${member.name} (${member.role}) and revoke outstanding invitations`, async () => {
        await client.request("", { action: "revoke", id: playlist.id, memberId: member.id }); await open(playlist.id);
      }));
      sharing.append(button("Broadcast original player / listening room", async () => {
        if (!player.track || !playlist.releaseIds.includes(player.track.id) || studio.mixer.running) throw new Error("Start this world in original playback first. Mixed decks cannot publish a single synchronized playhead.");
        stopRoom(); roomSession = { hosting: true, id: playlist.id, ids: playlist.releaseIds };
        await roomPending;
        await followTick();
        if (!roomSession?.hosting) return;
        roomTimer = window.setInterval(() => followTick().catch(fail), 5000); report("Broadcasting the current public song and playhead. Stop broadcasting when finished.");
      }), button("Claim verified curator milestones", async () => {
        const data = await client.request("", { action: "reward", id: playlist.id });
        const message = data.points ? `+${data.points} verified curator points committed. No listening points or recording rights awarded.` : "These curator milestones were already earned. No additional points awarded.";
        report(message);
        try { renderRewards((await client.request()).rewards); report(message); }
        catch (error) { report(`${message} Balance refresh failed: ${error.message}`); }
      }), button("Delete account playlist", async () => {
        await client.request("", { action: "delete", id: playlist.id }); stopRoom(); studio.stop(); await refresh(); report("Account playlist deleted. Earned milestones cannot be farmed by recreating it.");
      })); target.append(sharing);
    } else if (playlist.role !== "listener") {
      target.append(button("Leave this collaboration", async () => {
        await client.request("", { action: "leave", id: playlist.id }); stopRoom(); studio.stop(); await refresh();
      }));
    }
  }
  find("[data-connect-playlists]").addEventListener("click", () => connect().catch(fail));
  find("[data-disconnect-playlists]").addEventListener("click", async () => {
    try { await identity.logout(); accountChanged(null); } catch (error) { fail(error); }
  });
  find("[data-playlist-login]").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const next = await identity.login(form.elements.email.value.trim(), form.elements.password.value);
      form.reset(); accountChanged(next); await refresh();
    } catch (error) { fail(error); }
  });
  find("[data-refresh-cloud]").addEventListener("click", () => refresh().catch(fail));
  find("[data-join-playlist]").addEventListener("click", async () => {
    try {
      await client.request("", { action: "join", token: invite });
      find("[data-join-playlist]").hidden = true;
      const url = new URL(window.location.href); url.searchParams.delete("playlistInvite");
      window.history.replaceState(null, "", url); await refresh();
    } catch (error) { fail(error); }
  });
  find("[data-stop-room]").addEventListener("click", async () => {
    const session = roomSession; stopRoom();
    if (session?.hosting) {
      try { await roomPending; await client.request("", { action: "room", id: session.id, state: null }); } catch (error) { fail(error); return; }
    } else if (session) player.audio.pause();
    report("Listening-room following / broadcasting stopped.");
  });
  for (const event of ["halo:chart-queue-start", "halo:discovery-queue-start"]) window.addEventListener(event, stopRoom);
  document.addEventListener("click", event => {
    if (roomSession && !roomSession.hosting && (event.target.closest("[data-play-track-id], [data-player-close]")
      || (event.target.closest("[data-player-toggle]") && player.audio.paused))) stopRoom();
  });
  roomContent.addEventListener("change", () => { if (roomSession && !roomSession.hosting) followTick().catch(fail); });
  window.addEventListener("pagehide", () => { stopRoom(); client.reset(); });
  async function loadShared() {
    if (!share) return;
    try {
      const data = await client.request(`?share=${encodeURIComponent(share)}`);
      const target = find("[data-shared-world]"); target.replaceChildren(); renderDetail(target, data.playlist, `?share=${share}`);
      target.scrollIntoView({ block: "start", behavior: "auto" });
    } catch (error) { fail(error); }
  }
  loadShared();
  return {
    async saveLocal(playlist) {
      if (!user) { report("Connect and sign in before saving this browser playlist to your account."); return; }
      try {
        const data = await client.request();
        const existing = data.playlists.find(item => item.sourceId === playlist.id && item.role === "owner");
        if (existing) {
          await update({ ...playlist, id: existing.id, revision: existing.revision });
        } else {
          await client.request("", { action: "create", sourceId: playlist.id, name: playlist.name,
            releaseIds: playlist.releaseIds, world: playlistWorld(playlist.world) });
        }
        report("Saved to your account. Refresh on another signed-in device to load this version.");
        try { await refresh(); report("Saved to your account. Refresh on another signed-in device to load this version."); }
        catch (error) { report(`Save committed, but the account list could not refresh: ${error.message}`); }
      } catch (error) { fail(error); }
    },
    renderShared: loadShared
  };
}
