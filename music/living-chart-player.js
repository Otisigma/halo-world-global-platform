import { createLivingVisualizer } from "../obsidian/living-visualizer.js";

export function createChartPlayer({ document, window, player, root, getReleases, getVisible, getSelected, trackFor, select, notify }) {
  const audio = player.audio;
  root.innerHTML = `<div class="chart-portal" data-chart-field aria-hidden="true">
    <svg viewBox="0 0 400 150" focusable="false"><ellipse class="portal-bass" cx="200" cy="75" rx="140" ry="48"/><ellipse class="portal-treble" cx="200" cy="75" rx="88" ry="62"/><path d="M25 75H375M200 12V138"/></svg>
    <span>HALO / ENTER THE SIGNAL</span></div>
    <p class="chart-player-status" data-chart-player-status role="status">Choose a release, then press Play.</p>
    <div class="chart-transport-buttons">
      <button type="button" data-chart-command="previous">Previous</button>
      <button type="button" data-chart-command="toggle">Play selection</button>
      <button type="button" data-chart-command="next">Next</button>
      <button type="button" data-chart-command="queue">Play this view</button>
      <button type="button" data-chart-command="stop">Stop queue</button>
    </div>
    <label class="chart-seek-label">Seek playing track <input data-chart-seek type="range" min="0" max="1000" value="0" step="1" disabled></label>
    <p class="chart-clock" data-chart-clock>0:00 / 0:00</p>
    <div class="chart-transport-buttons">
      <button type="button" data-chart-command="moment">Share playing moment</button>
      <button type="button" data-chart-visualizer aria-pressed="false">Enable audio visualizer</button>
      <button type="button" data-chart-command="vote">Vote for selection</button>
    </div>
    <p data-chart-visualizer-status class="chart-control-note" role="status">Visualizer is off. No microphone is used.</p>
    <p data-chart-vote-status class="chart-control-note" role="status">Votes use the existing daily network-identity limit; they are not verified listener identities.</p>
    <details class="chart-queue"><summary>Listening queue <span data-chart-queue-count>0</span></summary><ol data-chart-queue-list></ol></details>`;
  const find = selector => root.querySelector(selector);
  const status = find("[data-chart-player-status]");
  const seek = find("[data-chart-seek]");
  const clock = find("[data-chart-clock]");
  const command = name => find(`[data-chart-command="${name}"]`);
  const voteStatus = find("[data-chart-vote-status]");
  const vote = command("vote");
  const visualizer = createLivingVisualizer({
    audio, button: find("[data-chart-visualizer]"), status: find("[data-chart-visualizer-status]"),
    field: find("[data-chart-field]"), window, document
  });
  let queue = [], index = -1, active = false, starting = false, voting = false, lastTrackId = null;
  const voted = new Map();
  const votedToday = id => voted.get(id) === new Date().toISOString().slice(0, 10);
  const formatTime = seconds => {
    const total = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  function renderQueue() {
    const list = find("[data-chart-queue-list]");
    const focused = list.contains(document.activeElement);
    list.replaceChildren();
    queue.forEach((id, position) => {
      const release = getReleases().find(item => item.id === id);
      if (!release) return;
      const row = document.createElement("li"), button = document.createElement("button");
      button.type = "button";
      button.textContent = `${release.title} — ${release.artist}${position === index ? " · current" : ""}`;
      if (position === index) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => start(position));
      row.append(button);
      list.append(row);
      if (focused && position === index) button.focus();
    });
    find("[data-chart-queue-count]").textContent = String(queue.length);
    command("stop").disabled = !active;
  }
  function stop(message) {
    active = false;
    renderQueue();
    if (message) status.textContent = message;
  }
  function sync() {
    const selected = getSelected();
    const current = player.track;
    const same = selected?.id === current?.id;
    const busy = same && ["playing", "loading"].includes(player.status);
    command("toggle").textContent = busy ? "Pause selection" : "Play selection";
    command("toggle").disabled = !selected || !trackFor(selected).src;
    command("moment").disabled = !current || !Number.isFinite(audio.currentTime);
    vote.disabled = voting || !selected || selected.isChartEligible === false || selected.status !== "published" || votedToday(selected.id);
    vote.textContent = selected ? `${votedToday(selected.id) ? "Voted today" : "Vote for selection"} · ${selected.votes || 0}` : "Vote for selection";
    const duration = audio.duration, time = audio.currentTime;
    const trackChanged = lastTrackId !== current?.id;
    seek.disabled = !current || !Number.isFinite(duration) || duration <= 0;
    if (document.activeElement !== seek || trackChanged) seek.value = seek.disabled ? "0" : String(Math.round(Math.min(1, Math.max(0, time / duration)) * 1000));
    seek.setAttribute("aria-valuetext", `${formatTime(time)} of ${formatTime(duration)}`);
    clock.textContent = `${formatTime(time)} / ${formatTime(duration)}${current ? ` · ${current.title}` : ""}`;
    root.classList.toggle("is-playing", player.status === "playing");
    if (trackChanged) {
      visualizer.reset();
      lastTrackId = current?.id;
    }
  }
  function start(position) {
    const release = getReleases().find(item => item.id === queue[position]);
    if (!release || !trackFor(release).src) {
      stop("That queue entry is no longer available. Rebuild the queue from this view.");
      return;
    }
    index = position;
    active = true;
    starting = true;
    window.dispatchEvent(new window.CustomEvent("halo:discovery-queue-start"));
    select(release.id);
    const track = trackFor(release);
    if (player.track?.id === track.id && player.track?.src === track.src) {
      audio.currentTime = 0;
      if (!["playing", "loading"].includes(player.status)) player.resume();
    } else player.play(track);
    starting = false;
    status.textContent = `Queue ${index + 1} of ${queue.length}: ${release.title}.`;
    renderQueue();
    sync();
  }
  function playView() {
    queue = getVisible().filter(release => trackFor(release).src).map(release => release.id);
    if (!queue.length) {
      stop("No direct audio is available in this view. Try an artist-approved listening link.");
      return;
    }
    start(0);
  }
  function step(direction, automatic = false) {
    if (!active) {
      if (automatic) return;
      queue = getVisible().filter(release => trackFor(release).src).map(release => release.id);
      index = queue.indexOf(player.track?.id || getSelected()?.id);
    }
    const next = index + direction;
    if (!queue.length || next < 0 || next >= queue.length) {
      stop(automatic ? "Queue complete." : "No further playable release in this view.");
      return;
    }
    start(next);
  }
  async function submitVote() {
    const selected = getSelected();
    if (!selected || vote.disabled) return;
    const id = selected.id;
    voting = true;
    sync();
    voteStatus.textContent = "Submitting vote…";
    try {
      const response = await window.fetch("/api/catalog/vote", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ releaseId: id }), signal: AbortSignal.timeout(10000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The vote could not be recorded.");
      if (!Number.isSafeInteger(data.votes) || data.votes < 0 || data.success !== true) throw new Error("The vote service returned an invalid response.");
      const release = getReleases().find(item => item.id === id);
      if (release) release.votes = data.votes;
      voted.set(id, new Date().toISOString().slice(0, 10));
      voteStatus.textContent = `${selected.title}: ${data.alreadyVoted ? "already voted today" : "vote counted"}. Refresh the chart when ready to see the latest order.`;
    } catch (error) {
      console.error("Living Chart vote failed", error);
      voteStatus.textContent = error instanceof Error ? error.message : "The vote could not be recorded. Try again.";
    } finally {
      voting = false;
      sync();
    }
  }
  root.addEventListener("click", event => {
    const action = event.target.closest("[data-chart-command]")?.dataset.chartCommand;
    if (action === "queue") playView();
    else if (action === "stop") stop("Queue stopped. Current audio is unchanged.");
    else if (action === "next") step(1);
    else if (action === "previous") step(-1);
    else if (action === "toggle") {
      const selected = getSelected();
      if (selected) {
        if (selected.id !== player.track?.id) {
          stop();
          window.dispatchEvent(new window.CustomEvent("halo:discovery-queue-start"));
        }
        player.play(trackFor(selected));
      }
    } else if (action === "vote") void submitVote();
    else if (action === "moment") {
      const url = new URL("/obsidian/", window.location.origin);
      url.searchParams.set("song", player.track.id);
      url.searchParams.set("t", String(Math.floor(Math.max(0, audio.currentTime))));
      if (window.navigator.clipboard?.writeText) {
        window.navigator.clipboard.writeText(url.href).then(() => notify("Playing moment link copied."))
          .catch(error => { console.error("Moment sharing failed", error); notify("Could not copy the moment link. Check clipboard permission and try again."); });
      } else {
        window.prompt("Copy the playing moment link", url.href);
      }
    }
    sync();
  });
  seek.addEventListener("input", () => {
    if (!seek.disabled) audio.currentTime = Number(seek.value) / 1000 * audio.duration;
    sync();
  });
  for (const event of ["playing", "pause", "waiting", "loadedmetadata", "durationchange", "timeupdate", "seeked", "error", "emptied"]) audio.addEventListener(event, sync);
  audio.addEventListener("ended", () => {
    if (active && queue[index] === player.track?.id) step(1, true);
    sync();
  });
  audio.addEventListener("error", () => stop("Audio could not play. Queue stopped; try another release or approved listening link."));
  audio.addEventListener("playing", () => {
    if (!active && player.track) status.textContent = `Now playing: ${player.track.title}. Selection and playing track may differ while browsing.`;
  });
  window.addEventListener("halo:trackchange", event => {
    if (!starting) stop();
    if (event.detail?.id) select(event.detail.id);
    sync();
  });
  for (const event of ["halo:chart-queue-start", "halo:personal-queue-start"]) window.addEventListener(event, () => stop());
  document.addEventListener("click", event => {
    if (event.target.closest("[data-play-track-id]")) stop();
  });
  renderQueue();
  sync();
  return { sync, playView, stop };
}
