const app = document.getElementById("app");
const liveStatus = document.getElementById("liveStatus");

const DREAMWEAVE_CUES = {
  midnight: ["Origin pulse", "Undertow blend", "Reflection glide"],
  sunset: ["Golden handoff", "Terrace vocal pocket", "Warm reveal"],
  butterfly: ["Lift intro", "Feathered bassline", "Garden release"],
  electric: ["Voltage build", "Laser drop", "Neon reset"]
};

const ACCESS_TIER_ORDER = ["free", "supporter", "vip"];
const ACCESS_TIERS = {
  free: {
    label: "Free Discovery",
    summary: "Join the room, listen live, and chat with the community."
  },
  supporter: {
    label: "Supporter",
    summary: "Unlock supporter-only moments, featured sessions, and early room drops."
  },
  vip: {
    label: "VIP",
    summary: "Get private room invites, priority access, and premium event routing."
  }
};
const PREMIUM_ACTIONS = [
  {
    key: "featuredSession",
    requiredTier: "supporter",
    title: "Featured DJ session access",
    description: "Reserve supporter-only entries for highlighted DJ rooms."
  },
  {
    key: "ticketedSession",
    requiredTier: "supporter",
    title: "Ticketed room access",
    description: "Join paid live parties without leaving the Live Party Hub flow."
  },
  {
    key: "privateAfterparty",
    requiredTier: "vip",
    title: "Private afterparty invite",
    description: "Route VIP listeners into private post-show sessions."
  }
];

const state = {
  campaignSlug: new URLSearchParams(window.location.search).get("campaign") || "",
  season: (new URLSearchParams(window.location.search).get("season") || "").toLowerCase(),
  eventName: new URLSearchParams(window.location.search).get("event") || "",
  accessTier: (new URLSearchParams(window.location.search).get("tier") || "free").toLowerCase(),
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

function activeAccessTier() {
  return ACCESS_TIERS[state.accessTier] ? state.accessTier : "free";
}

function tierUnlocked(requiredTier = "free") {
  return ACCESS_TIER_ORDER.indexOf(activeAccessTier()) >= ACCESS_TIER_ORDER.indexOf(requiredTier);
}

function monetizationHooks() {
  return partyTheme().monetizationHooks && typeof partyTheme().monetizationHooks === "object"
    ? partyTheme().monetizationHooks
    : {};
}

function renderAccessTiers() {
  return ACCESS_TIER_ORDER.map(tierKey => {
    const tier = ACCESS_TIERS[tierKey];
    const active = activeAccessTier() === tierKey;
    return `<li class="access-tier-card" data-active="${active}"><p class="signal-label">${escapeHtml(tier.label)}</p><p>${escapeHtml(tier.summary)}</p></li>`;
  }).join("");
}

function renderPremiumActions() {
  const hooks = monetizationHooks();
  return PREMIUM_ACTIONS.map(action => {
    const unlocked = tierUnlocked(action.requiredTier);
    const hookValue = String(hooks[action.key] || "");
    const lockMessage = unlocked
      ? hookValue
        ? "Ready for route"
        : "Hook placeholder ready"
      : `${ACCESS_TIERS[action.requiredTier]?.label || action.requiredTier} required`;
    return `<li class="premium-item"><div class="track-meta">${escapeHtml(lockMessage)}</div><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.description)}</p><button type="button" data-action="premium" data-hook-key="${escapeHtml(action.key)}" data-required-tier="${escapeHtml(action.requiredTier)}">${unlocked ? "Open hook" : "Locked"}</button></li>`;
  }).join("");
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
    const messageId = encodeURIComponent(String(message.id ?? ""));
    const actorId = encodeURIComponent(String(message.actor_id ?? ""));
    const reactions = message.reactions && typeof message.reactions === "object"
      ? Object.entries(message.reactions).map(([emoji, total]) => `${emoji} ${Number(total || 0)}`).join(" · ")
      : "";
    return `<li class="chat-item" data-message-id="${messageId}" data-actor-id="${actorId}"><div class="chat-meta">${escapeHtml(message.display_name || "Fan")} · ${escapeHtml(formatDate(message.created_at))}</div><p>${escapeHtml(message.body || "")}</p><div class="chat-meta">${escapeHtml(reactions)}</div><div class="chat-item-actions"><button type="button" data-action="reaction" data-emoji="✨">✨</button><button type="button" data-action="reaction" data-emoji="💜">💜</button><button type="button" data-action="reaction" data-emoji="🔥">🔥</button><button type="button" data-action="reaction" data-emoji="🌊">🌊</button><button type="button" data-action="report">Report</button></div></li>`;
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

    <section class="panel access-model">
      <div class="access-model-head">
        <div>
          <p class="signal-label">Access model</p>
          <h2>Free discovery with premium room upgrades</h2>
        </div>
        <p class="track-meta">Preview tiers with <code>?tier=free|supporter|vip</code>. Current tier: <strong>${escapeHtml(ACCESS_TIERS[activeAccessTier()].label)}</strong></p>
      </div>
      <ul class="access-tier-list">${renderAccessTiers()}</ul>
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
          <p class="status-line">Room actions follow moderation policy and consent boundaries.</p>
          <h3>Dreamweave cues</h3>
          <ul class="track-list">${cues.map(cue => `<li class="track-item">${escapeHtml(cue)}</li>`).join("")}</ul>
          <h3>Premium room options</h3>
          <ul class="premium-list">${renderPremiumActions()}</ul>
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
  if (liveStatus) liveStatus.textContent = state.statusError || state.status || "";
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
    if (liveStatus) liveStatus.textContent = state.statusError;
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

    if (actionButton.dataset.action === "premium") {
      const requiredTier = actionButton.dataset.requiredTier || "free";
      if (!tierUnlocked(requiredTier)) {
        state.statusError = `${ACCESS_TIERS[requiredTier]?.label || requiredTier} unlocks this room option.`;
        state.status = "";
        render();
        return;
      }
      const hookKey = actionButton.dataset.hookKey || "";
      const hookValue = String(monetizationHooks()[hookKey] || "");
      if (hookValue.startsWith("/") || hookValue.startsWith("http://") || hookValue.startsWith("https://")) {
        window.open(hookValue, "_blank", "noopener");
        state.status = "Opening configured premium route.";
        state.statusError = "";
        render();
        return;
      }
      state.statusError = "Premium hook is not configured yet. Keep discovery open while premium routing is finalized.";
      state.status = "";
      render();
      return;
    }

    const item = actionButton.closest("[data-message-id]");
    if (!item) return;
    const messageId = decodeURIComponent(item.dataset.messageId || "");
    const actorId = decodeURIComponent(item.dataset.actorId || "");

    if (actionButton.dataset.action === "reaction") {
      await communityAction({ action: "reaction", messageId, emoji: actionButton.dataset.emoji }, "Reaction sent.");
      return;
    }

    if (actionButton.dataset.action === "report") {
      const reason = window.prompt("Add a short reason for moderation:", "Needs moderation review") || "";
      if (reason.trim()) await communityAction({ action: "report", messageId, targetId: actorId, reason: reason.trim().slice(0, 240) }, "Report submitted.");
      return;
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
