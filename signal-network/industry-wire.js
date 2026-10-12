// Living Industry Wire: members-only feed inside the Signal Network workspace.
// Rendering helpers are pure so contracts can exercise them without a browser.
export const WIRE_API_URL = "/api/industry-wire";
export const PULSE_API_URL = "/api/radio/stations";
export const SIGNAL_MESSAGES_API_URL = "/api/signal/messages";
export const SIGNAL_MESSAGE_MAX_LENGTH = 500;
const SIGNAL_TARGET_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;
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

// Wire post IDs are already target-safe; track IDs are slugs of the track title (e.g. "read-the-room").
export function signalTargetId(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (SIGNAL_TARGET_PATTERN.test(raw)) return raw;
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120).replace(/-+$/, "");
  return SIGNAL_TARGET_PATTERN.test(slug) ? slug : "";
}

export function signalMessagesUrl(targetId) {
  return `${SIGNAL_MESSAGES_API_URL}?target_id=${encodeURIComponent(targetId)}`;
}

export function formatSignalTime(value, locale = undefined) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

// Only messages bound to this exact target render beneath it, oldest first.
export function threadMessages(messages, targetId) {
  return (Array.isArray(messages) ? messages : [])
    .filter(message => message && message.target_id === targetId && message.message && !Number.isNaN(Date.parse(message.created_at)))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || String(left.id).localeCompare(String(right.id)));
}

export function renderSignalMessages(messages, targetId) {
  const visible = threadMessages(messages, targetId);
  if (!visible.length) return '<li class="signal-thread__empty">No signals yet. Drop the first word.</li>';
  return visible.map(message => `
    <li class="signal-thread__message" data-signal-message="${escapeHtml(message.id)}">
      <span class="signal-thread__who">${escapeHtml(message.user_identifier || "HALO member")}</span>
      <span class="signal-thread__text">${escapeHtml(message.message)}</span>
      <time datetime="${escapeHtml(message.created_at)}">${escapeHtml(formatSignalTime(message.created_at))}</time>
    </li>`).join("");
}

export function renderSignalThread(targetId, label) {
  const id = signalTargetId(targetId);
  if (!id) return "";
  const name = escapeHtml(label || id);
  return `
    <section class="signal-thread" id="signal-feed-${escapeHtml(id)}" data-signal-thread="${escapeHtml(id)}" aria-label="Signal thread: ${name}">
      <p class="industry-wire__eyebrow">Signal thread</p>
      <ol class="signal-thread__list" data-signal-thread-list aria-live="polite"><li class="signal-thread__empty">Tuning into the thread…</li></ol>
      <form class="signal-thread__form" data-signal-thread-form>
        <label class="signal-thread__label" for="signal-input-${escapeHtml(id)}">Drop a thought on ${name}</label>
        <input id="signal-input-${escapeHtml(id)}" name="message" type="text" maxlength="${SIGNAL_MESSAGE_MAX_LENGTH}" autocomplete="off" placeholder="A thought or a one-word reaction" required>
        <button class="signal-text-button" type="submit">Signal</button>
      </form>
      <p class="signal-thread__status" data-signal-thread-status role="status" aria-live="polite"></p>
    </section>`;
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
    trackId: signalTargetId(room.nowPlaying.title),
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
    <a class="signal-button" href="/radio/">Join the room</a>
    ${renderSignalThread(pulse.trackId, pulse.title)}`;
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
        <span>Drop your thoughts in the Signal thread below.</span>
      </footer>
      ${renderSignalThread(post.id, post.title)}
    </article>`;
}

export function renderWireFeed(posts) {
  const visible = feedPosts(posts);
  if (!visible.length) {
    return '<div class="signal-empty"><span>◎</span><h4>The wire is quiet</h4><p>New internal briefs and the artist\'s take land here first.</p></div>';
  }
  return visible.map(renderWirePost).join("");
}

async function fetchJson(url, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
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
  const observer = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      loadThread(entry.target);
    }), { rootMargin: "200px" })
    : null;

  async function loadThread(thread) {
    const targetId = thread.dataset.signalThread;
    const list = thread.querySelector("[data-signal-thread-list]");
    const status = thread.querySelector("[data-signal-thread-status]");
    try {
      const payload = await fetchJson(signalMessagesUrl(targetId));
      list.innerHTML = renderSignalMessages(payload.messages, targetId);
      status.textContent = "";
    } catch (error) {
      list.innerHTML = "";
      status.textContent = error.status === 401 ? "Sign in to Signal Network to join the thread." : "This thread is unavailable right now.";
    }
  }

  function unwatchThreads(container) {
    container.querySelectorAll("[data-signal-thread]").forEach(thread => observer?.unobserve(thread));
  }

  function watchThreads(container) {
    container.querySelectorAll("[data-signal-thread]").forEach(thread => observer ? observer.observe(thread) : loadThread(thread));
  }

  async function loadPulse() {
    unwatchThreads(pulseBody);
    try { pulseBody.innerHTML = renderPulse(pickCommunityPulse(await fetchJson(PULSE_API_URL))); }
    catch { pulseBody.innerHTML = '<p class="industry-wire__muted">Live listening is unavailable right now.</p>'; }
    watchThreads(pulseBody);
  }

  async function loadFeed() {
    feed.setAttribute("aria-busy", "true");
    unwatchThreads(feed);
    feed.innerHTML = '<div class="signal-skeleton" aria-hidden="true"></div><div class="signal-skeleton" aria-hidden="true"></div>';
    status.textContent = "";
    try {
      const payload = await fetchJson(WIRE_API_URL);
      if (payload.visibilityLabel) visibility.textContent = payload.visibilityLabel;
      feed.innerHTML = renderWireFeed(payload.posts);
      watchThreads(feed);
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
    if (!event.target.closest('[data-signal-tab="wire"]')) return;
    if (loaded) loadPulse();
    else load();
  });
  document.getElementById("industryWireRefresh")?.addEventListener("click", load);
  panel.addEventListener("submit", async event => {
    const form = event.target.closest("[data-signal-thread-form]");
    if (!form) return;
    event.preventDefault();
    const thread = form.closest("[data-signal-thread]");
    const input = form.elements.message;
    const button = form.querySelector('button[type="submit"]');
    const status = thread.querySelector("[data-signal-thread-status]");
    const message = input.value.trim();
    if (!message) return;
    button.disabled = true;
    status.textContent = "";
    try {
      await fetchJson(SIGNAL_MESSAGES_API_URL, { method: "POST", body: { target_id: thread.dataset.signalThread, message } });
      input.value = "";
      await loadThread(thread);
    } catch (error) {
      status.textContent = error.status === 401 ? "Sign in to Signal Network to join the thread." : error.message || "Your signal did not send.";
    } finally {
      button.disabled = false;
    }
  });
  if (!panel.hidden) load();
}

if (typeof document !== "undefined") {
  const panel = document.querySelector("[data-industry-wire]");
  if (panel) mountIndustryWire(panel);
}
