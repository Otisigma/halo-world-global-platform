// HALO Artist Shop — AI artist persona chat (e.g. Anna Jayne).
// Appears only on storefronts whose artist has an AI persona (see /api/artist-storefront).
// The persona always discloses that it's an AI; conversations go to /api/artist-persona, which
// grounds replies in the artist's Song Catalog and remembers returning fans.
(() => {
  const API = "/api/artist-persona";
  const VISITOR_KEY = "halo_persona_visitor_v1";
  const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function visitorId() {
    try {
      let id = localStorage.getItem(VISITOR_KEY);
      if (!/^[A-Za-z0-9-]{16,64}$/.test(id || "")) {
        id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    }
  }

  const root = document.createElement("div");
  root.className = "persona";
  root.hidden = true;
  root.innerHTML = `
    <button class="persona-launch" type="button" aria-expanded="false" aria-controls="persona-panel">
      <span class="persona-launch-dot" aria-hidden="true"></span>
      <span data-persona-launch-label>Talk with the artist</span>
      <span class="ai-chip">AI</span>
    </button>
    <section class="persona-panel" id="persona-panel" role="dialog" aria-modal="false" aria-labelledby="persona-title" hidden>
      <header class="persona-head">
        <div>
          <p class="signal-tag">AI persona · Artist Shop</p>
          <h2 id="persona-title"></h2>
        </div>
        <button class="theme-close" type="button" data-persona-close aria-label="Close chat">×</button>
      </header>
      <p class="persona-disclosure" data-persona-disclosure></p>
      <div class="persona-log" data-persona-log aria-live="polite"></div>
      <div class="persona-starters" data-persona-starters></div>
      <form class="persona-form" data-persona-form>
        <label class="visually-hidden" for="persona-input">Message</label>
        <textarea id="persona-input" rows="2" maxlength="800" placeholder="Ask about the songs, the stories, what to play first…" required></textarea>
        <button class="signal-btn" type="submit">Send</button>
      </form>
      <p class="persona-status" data-persona-status role="status"></p>
    </section>`;
  document.body.appendChild(root);

  const el = {
    launch: root.querySelector(".persona-launch"),
    launchLabel: root.querySelector("[data-persona-launch-label]"),
    panel: root.querySelector(".persona-panel"),
    title: root.querySelector("#persona-title"),
    disclosure: root.querySelector("[data-persona-disclosure]"),
    log: root.querySelector("[data-persona-log]"),
    starters: root.querySelector("[data-persona-starters]"),
    form: root.querySelector("[data-persona-form]"),
    input: root.querySelector("#persona-input"),
    status: root.querySelector("[data-persona-status]"),
    close: root.querySelector("[data-persona-close]")
  };

  const state = { artist: null, persona: null, messages: [], loadedFor: "", sending: false };

  function bubble(role, text) {
    return `<div class="persona-msg persona-msg--${role === "user" ? "fan" : "artist"}">
      <span class="persona-msg-who">${role === "user" ? "You" : `${escapeHtml(state.persona?.name || "Artist")} <span class="ai-chip">AI</span>`}</span>
      <p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>
    </div>`;
  }

  function render() {
    const greeting = state.messages.length ? "" : bubble("assistant", state.persona?.greeting || "");
    el.log.innerHTML = greeting + state.messages.map(item => bubble(item.role, item.content)).join("")
      + (state.sending ? `<div class="persona-msg persona-msg--artist persona-typing" aria-label="${escapeHtml(state.persona?.name || "Artist")} is typing"><i></i><i></i><i></i></div>` : "");
    el.log.scrollTop = el.log.scrollHeight;
    const showStarters = !state.messages.length && Array.isArray(state.persona?.starters);
    el.starters.innerHTML = showStarters
      ? state.persona.starters.map(text => `<button class="signal-btn-outline" type="button" data-starter="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")
      : "";
  }

  async function loadHistory() {
    if (!state.artist || state.loadedFor === state.artist.slug) return;
    state.loadedFor = state.artist.slug;
    try {
      const response = await fetch(`${API}?artist=${encodeURIComponent(state.artist.slug)}&visitor=${encodeURIComponent(visitorId())}`, {
        credentials: "same-origin", headers: { Accept: "application/json" }
      });
      if (!response.ok) return;
      const data = await response.json();
      state.messages = Array.isArray(data.messages) ? data.messages : [];
      render();
    } catch {
      // History is a nicety; the chat still works without it.
    }
  }

  function open() {
    if (!state.persona) return;
    el.panel.hidden = false;
    el.launch.setAttribute("aria-expanded", "true");
    render();
    loadHistory();
    setTimeout(() => el.input.focus(), 30);
    window.haloStats?.track?.("artist_persona_opened", { artist: state.artist?.slug });
  }
  function close() {
    el.panel.hidden = true;
    el.launch.setAttribute("aria-expanded", "false");
  }

  async function send(text) {
    const message = String(text || "").trim();
    if (!message || state.sending || !state.artist) return;
    state.sending = true;
    state.messages.push({ role: "user", content: message });
    el.input.value = "";
    el.status.textContent = "";
    render();
    try {
      const response = await fetch(API, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ artist: state.artist.slug, visitor: visitorId(), message })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The persona couldn't answer just now.");
      state.messages.push({ role: "assistant", content: data.reply });
      window.haloStats?.track?.("artist_persona_message", { artist: state.artist.slug });
    } catch (error) {
      state.messages.pop();
      el.input.value = message;
      el.status.textContent = error.message || "The persona couldn't answer just now.";
    } finally {
      state.sending = false;
      render();
    }
  }

  el.launch.addEventListener("click", () => (el.panel.hidden ? open() : close()));
  el.close.addEventListener("click", () => { close(); el.launch.focus(); });
  el.form.addEventListener("submit", event => { event.preventDefault(); send(el.input.value); });
  el.input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(el.input.value); }
  });
  el.starters.addEventListener("click", event => {
    const button = event.target.closest("[data-starter]");
    if (button) send(button.dataset.starter);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !el.panel.hidden) { close(); el.launch.focus(); }
  });
  window.addEventListener("halo:open-persona", open);

  function applyProfile(profile) {
    const persona = profile?.persona || null;
    if (!persona) {
      close();
      root.hidden = true;
      state.artist = null;
      state.persona = null;
      return;
    }
    if (state.artist?.slug !== profile.slug) {
      state.messages = [];
      state.loadedFor = "";
    }
    state.artist = { slug: profile.slug, name: profile.name };
    state.persona = persona;
    el.title.textContent = `Talk with ${persona.name}`;
    el.launchLabel.textContent = `Talk with ${persona.name}`;
    el.disclosure.textContent = persona.disclosure;
    root.hidden = false;
    render();
  }

  window.addEventListener("halo:shop-artist-profile", event => applyProfile(event.detail?.profile));
  if (window.haloShopArtist?.profile) applyProfile(window.haloShopArtist.profile);
})();
