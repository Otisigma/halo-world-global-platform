// Living Industry Wire: members-only feed inside the Signal Network workspace.
// Rendering helpers are pure so contracts can exercise them without a browser.
export const WIRE_API_URL = "/api/industry-wire";
export const PULSE_API_URL = "/api/radio/stations";
export const WIRE_VISIBILITY = "internal_community";
export const WIRE_VISIBILITY_LABEL = "Internal · HALO community only";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

export function formatWireTime(value, locale = undefined) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date);
}

export function feedPosts(posts) {
  return (Array.isArray(posts) ? posts : [])
    .filter(post => post && post.visibility === WIRE_VISIBILITY && post.status === "published" && post.title && !Number.isNaN(Date.parse(post.created_at)))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || String(right.id).localeCompare(String(left.id)));
}

export function pickCommunityPulse(payload) {
  const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  const candidates = rooms.filter(room => room?.nowPlaying?.title);
  if (!candidates.length) return null;
  const room = [...candidates].sort((left, right) =>
    Number(right.listeners || 0) - Number(left.listeners || 0) || Number(Boolean(right.isLive)) - Number(Boolean(left.isLive))
  )[0];
  return {
    roomName: String(room.name || "HALO Radio"),
    title: String(room.nowPlaying.title),
    artist: room.isLive && room.liveName ? `Live with ${room.liveName}` : String(room.nowPlaying.artist || ""),
    listeners: Math.max(0, Number(room.listeners || 0)),
    isLive: Boolean(room.isLive),
    preview: payload?.service === "demo" || Boolean(room.demo && !room.fallbackReady)
  };
}

export function renderPulse(pulse) {
  if (!pulse) {
    return '<p class="industry-wire__muted">The room is quiet right now. <a href="/radio/">Open HALO Radio</a> and start the next session.</p>';
  }
  const listening = pulse.listeners === 1 ? "1 member listening" : `${pulse.listeners} members listening`;
  return `
    <div class="industry-wire__track">
      <p class="industry-wire__track-label">Uniting the room${pulse.preview ? " · preview rotation" : ""}</p>
      <strong>${escapeHtml(pulse.title)}</strong>
      ${pulse.artist ? `<span>${escapeHtml(pulse.artist)}</span>` : ""}
    </div>
    <dl class="industry-wire__pulse-meta">
      <div><dt>Room</dt><dd>${escapeHtml(pulse.roomName)}</dd></div>
      <div><dt>Listening</dt><dd>${escapeHtml(listening)}</dd></div>
      <div><dt>Signal</dt><dd>${pulse.isLive ? "Live now" : "On rotation"}</dd></div>
    </dl>
    <a class="signal-button" href="/radio/">Join the room</a>`;
}

export function renderWirePost(post) {
  return `
    <article class="industry-wire__post" data-wire-post="${escapeHtml(post.id)}" data-visibility="${escapeHtml(post.visibility)}">
      <header class="industry-wire__post-header">
        <span class="industry-wire__badge">${escapeHtml(WIRE_VISIBILITY_LABEL)}</span>
        <time datetime="${escapeHtml(post.created_at)}">${escapeHtml(formatWireTime(post.created_at))}</time>
      </header>
      <h4>${escapeHtml(post.title)}</h4>
      <section class="industry-wire__shift" aria-label="The industry shift">
        <p class="industry-wire__eyebrow">The Industry Shift</p>
        <p>${escapeHtml(post.summary)}</p>
      </section>
      ${post.artist_perspective ? `<blockquote class="industry-wire__take"><p class="industry-wire__eyebrow">The Artist's Take</p><p>${escapeHtml(post.artist_perspective)}</p></blockquote>` : ""}
      ${post.on_rotation ? `<p class="industry-wire__rotation"><span>On rotation</span> ${escapeHtml(post.on_rotation)}</p>` : ""}
      <footer class="industry-wire__post-footer">
        <span>${escapeHtml(post.author || "HALO Network Core")}</span>
        <span>Drop your thoughts in your Signal conversations.</span>
      </footer>
    </article>`;
}

export function renderWireFeed(posts) {
  const visible = feedPosts(posts);
  if (!visible.length) {
    return '<div class="signal-empty"><span>◎</span><h4>The wire is quiet</h4><p>New internal briefs and the artist\'s take land here first.</p></div>';
  }
  return visible.map(renderWirePost).join("");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.message || "Request failed"), { status: response.status });
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function mountIndustryWire(panel) {
  const feed = document.getElementById("industryWireFeed");
  const status = document.getElementById("industryWireStatus");
  const pulseBody = document.getElementById("industryWirePulseBody");
  const visibility = document.getElementById("industryWireVisibility");
  let loading = false;
  let loaded = false;

  async function loadPulse() {
    try { pulseBody.innerHTML = renderPulse(pickCommunityPulse(await fetchJson(PULSE_API_URL))); }
    catch { pulseBody.innerHTML = '<p class="industry-wire__muted">Live listening is unavailable right now.</p>'; }
  }

  async function loadFeed() {
    feed.setAttribute("aria-busy", "true");
    feed.innerHTML = '<div class="signal-skeleton" aria-hidden="true"></div><div class="signal-skeleton" aria-hidden="true"></div>';
    status.textContent = "";
    try {
      const payload = await fetchJson(WIRE_API_URL);
      if (payload.visibilityLabel) visibility.textContent = payload.visibilityLabel;
      feed.innerHTML = renderWireFeed(payload.posts);
      loaded = true;
    } catch (error) {
      feed.innerHTML = "";
      status.textContent = error.status === 401 ? "Sign in to Signal Network to read the Industry Wire." : error.message || "The Industry Wire is unavailable.";
    } finally {
      feed.setAttribute("aria-busy", "false");
    }
  }

  async function load() {
    if (loading) return;
    loading = true;
    try { await Promise.all([loadFeed(), loadPulse()]); }
    finally { loading = false; }
  }

  document.addEventListener("click", event => {
    if (event.target.closest('[data-signal-tab="wire"]') && !loaded) load();
  });
  document.getElementById("industryWireRefresh")?.addEventListener("click", load);
  if (!panel.hidden) load();
}

if (typeof document !== "undefined") {
  const panel = document.querySelector("[data-industry-wire]");
  if (panel) mountIndustryWire(panel);
}
