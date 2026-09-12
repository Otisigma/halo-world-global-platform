const app = document.getElementById("app");

const DREAMWEAVE_CUES = {
  midnight: ["Origin pulse", "Undertow blend", "Reflection glide"],
  sunset: ["Golden handoff", "Terrace vocal pocket", "Warm reveal"],
  butterfly: ["Lift intro", "Feathered bassline", "Garden release"],
  electric: ["Voltage build", "Laser drop", "Neon reset"]
};

const state = {
  campaignSlug: new URLSearchParams(window.location.search).get("campaign") || "",
  season: (new URLSearchParams(window.location.search).get("season") || "").toLowerCase(),
  eventName: new URLSearchParams(window.location.search).get("event") || "",
  view: "fan",
  campaign: null,
  community: null,
  broadcast: null,
  status: "",
  statusError: "",
  statusTimer: null
};

const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function partyTheme() {
  return state.campaign?.partyTheme || {};
}

function applyAtmosphere() {
  const theme = partyTheme();
  document.body.dataset.partyAtmosphere = theme.atmosphere || "midnight";
  document.body.dataset.partySeason = ["winter", "spring", "summer", "autumn"].includes(state.season) ? state.season : "";
  document.documentElement.style.setProperty("--party-accent", theme.accent || "#d5ef5a");
}

function buildRoomState() {
  const community = state.community || {};
  const people = Array.isArray(community.people) ? community.people : [];
  const onlineFans = people.filter(person => person.is_online).length + (community.profile?.is_online ? 1 : 0);
  return {
    onlineFans,
    messages: Array.isArray(community.messages) ? community.messages.length : 0,
    points: Number(community.roomGoal?.points || 0),
    target: Number(community.roomGoal?.target || 24),
    unlocked: Boolean(community.roomGoal?.unlocked)
  };
}

function renderTrackList() {
  const tracks = [...(state.campaign?.tracks || [])].sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0)).slice(0, 5);
  if (!tracks.length) return '<li class="track-item">No active mix board yet.</li>';
  return tracks.map((track, index) => `<li class="track-item"><div class="track-meta">#${index + 1} · ${escapeHtml(track.artist || "Unknown")}</div><strong>${escapeHtml(track.title)}</strong><div class="track-votes">${Number(track.votes || 0)} votes</div></li>`).join("");
}

function renderChat() {
  const messages = [...(state.community?.messages || [])].slice(-18).reverse();
  if (!messages.length) return '<li class="chat-item">The room is warming up. Say hello to kick it off.</li>';
  return messages.map(message => {
    const reactions = message.reactions && typeof message.reactions === "object"
      ? Object.entries(message.reactions).map(([emoji, total]) => `${emoji} ${Number(total || 0)}`).join(" · ")
      : "";
    return `<li class="chat-item" data-message-id="${message.id}" data-actor-id="${escapeHtml(message.actor_id || "")}"><div class="chat-meta">${escapeHtml(message.display_name || "Fan")} · ${escapeHtml(formatDate(message.created_at))}</div><p>${escapeHtml(message.body || "")}</p><div class="chat-meta">${escapeHtml(reactions)}</div><div class="chat-item-actions"><button type="button" data-action="reaction" data-emoji="✨">✨</button><button type="button" data-action="reaction" data-emoji="💜">💜</button><button type="button" data-action="reaction" data-emoji="🔥">🔥</button><button type="button" data-action="reaction" data-emoji="🌊">🌊</button><button type="button" data-action="report">Report</button><button type="button" data-action="mute">Mute</button></div></li>`;
  }).join("");
}

function renderPins() {
  const pins = state.community?.roomPins || [];
  const media = state.community?.roomMedia || [];
  const pinItems = pins.slice(0, 4).map(pin => `<li class="pin-item"><div class="track-meta">${escapeHtml(pin.display_name || "Host")}</div><strong>${escapeHtml(pin.title || "Pinned room note")}</strong><p>${escapeHtml(pin.body || "")}</p>${pin.destination_url ? `<a href="${escapeHtml(pin.destination_url)}" target="_blank" rel="noopener">${escapeHtml(pin.cta_label || "Open")}</a>` : ""}</li>`);
  const mediaItems = media.slice(0, 3).map(item => `<li class="pin-item"><div class="track-meta">Room media</div><strong>${escapeHtml(item.title || "Vote post")}</strong><p>${escapeHtml(item.description || "")}</p>${item.video_url ? `<a href="${escapeHtml(item.video_url)}" target="_blank" rel="noopener">Play source</a>` : ""}</li>`);
  const all = [...pinItems, ...mediaItems];
  return all.length ? all.join("") : '<li class="pin-item">No pinned moments yet.</li>';
}

function renderDestinations() {
  const destinations = state.broadcast?.destinations || [];
  if (!destinations.length) return '<li class="dist-item">Distribution relay is not configured yet.</li>';
  return destinations.map(destination => `<li class="dist-item"><strong>${escapeHtml(destination)}</strong><div class="track-meta">Optional relay destination</div></li>`).join("");
}

function render() {
  applyAtmosphere();
  const campaign = state.campaign;
  const room = buildRoomState();
  const theme = partyTheme();
  const cues = DREAMWEAVE_CUES[theme.atmosphere || "midnight"] || DREAMWEAVE_CUES.midnight;

  app.innerHTML = `
    <section class="party-hero">
      <div class="hero-grid">
        <div>
          <p class="signal-label">Dreamweave Live Party Venue</p>
          <h1>${escapeHtml(campaign?.title || "HALO Live Party Room")}</h1>
          <p>${escapeHtml(campaign?.subtitle || "DJ-hosted room for live questions, fan chat, and continuous mix energy.")}</p>
          <p>${escapeHtml(theme.roomNote || "The internal room is the main venue. External streams stay optional.")}</p>
          <div class="hero-chips">
            <span class="hero-chip">Host: ${escapeHtml(campaign?.hostPersonaId || "halo")}</span>
            <span class="hero-chip">Atmosphere: ${escapeHtml(theme.atmosphere || "midnight")}</span>
            ${state.eventName ? `<span class="hero-chip">Event: ${escapeHtml(state.eventName)}</span>` : ""}
            ${state.season ? `<span class="hero-chip">Season: ${escapeHtml(state.season)}</span>` : ""}
          </div>
        </div>
        <div class="panel hero-stat">
          <p class="signal-label">Room state</p>
          <strong>${room.onlineFans}</strong>
          <small>fans online now</small>
          <p>${room.messages} active messages · ${room.points}/${room.target} unlock points ${room.unlocked ? "(Unlocked)" : ""}</p>
          <p>Voting closes: ${escapeHtml(formatDate(campaign?.endsAt) || "TBA")}</p>
        </div>
      </div>
    </section>

    <div class="view-toggle" aria-label="Live party views">
      <button type="button" data-view="fan" aria-pressed="${state.view === "fan"}">Fan Floor</button>
      <button type="button" data-view="dj" aria-pressed="${state.view === "dj"}">DJ Booth</button>
    </div>

    <section class="party-view" data-panel="fan" ${state.view === "fan" ? "" : "hidden"}>
      <div class="view-grid">
        <article class="panel">
          <p class="signal-label">Live room chat</p>
          <h2>Ask the DJ. Keep the party moving.</h2>
          <ul class="chat-list">${renderChat()}</ul>
        </article>
        <article class="panel">
          <p class="signal-label">Room actions</p>
          <h3>Post your question</h3>
          <form class="chat-form" id="chatForm">
            <textarea name="body" maxlength="320" placeholder="Drop a question, shout, or track request."></textarea>
            <div class="quick-actions"><button type="submit">Send to room</button></div>
          </form>
          <p class="status-line ${state.statusError ? "error" : ""}">${escapeHtml(state.statusError || state.status || "")}</p>
          <h3>Dreamweave cues</h3>
          <ul class="track-list">${cues.map(cue => `<li class="track-item">${escapeHtml(cue)}</li>`).join("")}</ul>
          <h3>Pinned moments</h3>
          <ul class="pin-list">${renderPins()}</ul>
        </article>
      </div>
    </section>

    <section class="party-view" data-panel="dj" ${state.view === "dj" ? "" : "hidden"}>
      <div class="view-grid">
        <article class="panel">
          <p class="signal-label">Current mix board</p>
          <h2>What the room is selecting now</h2>
          <ul class="track-list">${renderTrackList()}</ul>
        </article>
        <article class="panel">
          <p class="signal-label">Distribution (optional)</p>
          <h3>External relay destinations</h3>
          <ul class="dist-list">${renderDestinations()}</ul>
          <p><a href="/halo-live.html">Open broadcast control center</a></p>
          <p><a href="/BROADCAST_SETUP.md" target="_blank" rel="noopener">Distribution setup notes</a></p>
          <p class="track-meta">Internal room remains primary. External platforms are optional relay targets.</p>
        </article>
      </div>
    </section>
  `;
}

async function loadCampaign() {
  if (!state.campaignSlug) {
    state.campaign = null;
    return;
  }
  const response = await fetch(`/api/fan-campaigns?slug=${encodeURIComponent(state.campaignSlug)}`, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Live campaign could not load");
  state.campaign = data.campaign || null;
}

async function loadCommunity() {
  const response = await fetch("/api/community", { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Room community could not load");
  state.community = data;
}

async function loadBroadcast() {
  const response = await fetch("/api/broadcast-control", { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  state.broadcast = response.ok ? data : { destinations: [] };
}

async function refresh() {
  state.statusError = "";
  try {
    await Promise.all([loadCampaign(), loadCommunity(), loadBroadcast()]);
    render();
  } catch (error) {
    state.statusError = error.message || "Live room is temporarily unavailable.";
    render();
  }
}

async function communityAction(payload, notice = "") {
  state.statusError = "";
  const response = await fetch("/api/community", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    state.statusError = data.message || "That room action did not land.";
    render();
    return false;
  }
  state.community = data;
  state.status = notice;
  window.clearTimeout(state.statusTimer);
  state.statusTimer = window.setTimeout(() => {
    state.status = "";
    state.statusTimer = null;
    render();
  }, 2400);
  render();
  return true;
}

function bindEvents() {
  app.addEventListener("click", async event => {
    const viewButton = event.target.closest("button[data-view]");
    if (viewButton) {
      state.view = viewButton.dataset.view === "dj" ? "dj" : "fan";
      render();
      return;
    }

    const actionButton = event.target.closest("button[data-action]");
    if (!actionButton) return;
    const item = actionButton.closest("[data-message-id]");
    if (!item) return;
    const messageId = Number(item.dataset.messageId);
    const actorId = item.dataset.actorId;

    if (actionButton.dataset.action === "reaction") {
      await communityAction({ action: "reaction", messageId, emoji: actionButton.dataset.emoji }, "Reaction sent.");
      return;
    }

    if (actionButton.dataset.action === "report") {
      const reason = window.prompt("Add a short reason for moderation:", "Needs moderation review") || "";
      if (reason.trim()) await communityAction({ action: "report", messageId, targetId: actorId, reason: reason.trim().slice(0, 240) }, "Report submitted.");
      return;
    }

    if (actionButton.dataset.action === "mute") {
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(actorId || "")) {
        state.statusError = "That room member can not be muted right now.";
        render();
        return;
      }
      await communityAction({ action: "control", kind: "mute", targetId: actorId }, "Member muted for your room view.");
    }
  });

  app.addEventListener("submit", async event => {
    const form = event.target.closest("#chatForm");
    if (!form) return;
    event.preventDefault();
    const body = String(new FormData(form).get("body") || "").trim();
    if (!body) return;
    const sent = await communityAction({ action: "message", body }, "Message sent to the room.");
    if (sent) form.reset();
  });
}

bindEvents();
await refresh();
window.setInterval(() => {
  void refresh();
}, 20000);
