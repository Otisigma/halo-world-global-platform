(() => {
  "use strict";
  if (window.HaloOracle) return;

  const cards = new WeakMap();
  let activeCard = null;
  let effect = null;
  const favorites = new Set();

  function gateway(href) {
    if (typeof href !== "string" || !/^\/(?:music\/|music-upload\/|album-concierge\/|live-party\/|signal-network\/|release-kit\.html\?)/.test(href) || /[\\\u0000-\u0020]/.test(href)) return "";
    return href;
  }

  function clearClock(card) {
    if (card.clock) window.clearTimeout(card.clock);
    card.clock = null;
  }

  async function transmit(card, message) {
    const query = String(message || "").trim();
    if (!query || query.length > 1200 || card.loading) return;
    const revision = card.revision;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    card.loading = true;
    card.controller = controller;
    card.send.disabled = true;
    card.response.setAttribute("aria-busy", "true");
    card.status.textContent = "Oracle is curating your signal…";
    try {
      const response = await fetch("/api/halo-oracle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ message: query, contextTrackId: card.contextId, favoriteTrackIds: [...favorites] })
      });
      if (!response.ok) throw new Error("Oracle unavailable");
      const data = await response.json();
      if (typeof data.reply !== "string" || !Array.isArray(data.recommendations) || !Array.isArray(data.quickActions)) throw new Error("Invalid Oracle response");
      if (revision !== card.revision) return;
      clearClock(card);
      card.tick = null;
      card.reply.textContent = data.reply;
      card.selection.replaceChildren();
      for (const recommendation of data.recommendations.slice(0, 12)) {
        const href = gateway(recommendation.actionUrl);
        if (!href) continue;
        const row = el("div", "halo-oracle__selection");
        const link = el("a", "", recommendation.label);
        link.href = href;
        row.append(link, el("small", "", recommendation.type));
        const source = [...document.querySelectorAll('[data-action="play-track"][data-track-id]')]
          .find(node => node.getAttribute("data-track-id") === recommendation.id && !node.disabled);
        if (source && window.HaloPlayer) {
          const listen = el("button", "halo-hud-btn", "Listen");
          listen.type = "button";
          listen.setAttribute("aria-label", `Listen to ${recommendation.label}`);
          listen.addEventListener("click", () => {
            if (source.isConnected === false) return;
            update(card.root, source);
            card.play.click();
          });
          row.append(listen);
        }
        card.selection.append(row);
      }
      for (const item of (data.gateways || []).slice(0, 6)) {
        const href = gateway(item.actionUrl);
        if (!href) continue;
        const link = el("a", "halo-oracle__gateway", item.label);
        link.href = href;
        card.selection.append(link);
      }
      renderChips(card, data.quickActions);
      card.status.textContent = data.event ? "HOST · Verification required for exclusive access" : `${String(data.intent || "catalog").toUpperCase()} · Catalog connected`;
      card.input.value = "";
      if (data.event?.startsAt) {
        const { countdownLabel } = await import("/lib/halo-oracle-engine.js");
        if (revision !== card.revision) return;
        const tick = () => {
          clearClock(card);
          card.countdown.textContent = countdownLabel(data.event.startsAt);
          if (!card.root.hidden && Date.parse(data.event.startsAt) > Date.now()) card.clock = window.setTimeout(tick, 60000);
        };
        card.tick = tick;
        card.countdown.hidden = false;
        tick();
      } else {
        card.countdown.hidden = true;
      }
    } catch {
      if (revision === card.revision) card.status.textContent = "Oracle is temporarily offline. Your listening controls and discovery gateways are still available. Try transmitting again.";
    } finally {
      window.clearTimeout(timeout);
      if (revision === card.revision) {
        card.loading = false;
        card.controller = null;
        card.send.disabled = false;
        card.response.setAttribute("aria-busy", "false");
      }
    }
  }

  function renderChips(card, actions) {
    card.chips.replaceChildren();
    for (const action of actions.slice(0, 4)) {
      if (typeof action.query !== "string") continue;
      const chip = el("button", "halo-hud-btn halo-oracle__chip", action.label);
      chip.type = "button";
      chip.addEventListener("click", () => transmit(card, action.query));
      card.chips.append(chip);
    }
  }

  function createConfetti(canvas) {
    let context;
    try { context = canvas.getContext("2d"); } catch {}
    let particles = [];
    let frame = null;
    let started = null;
    let width = 0;
    let height = 0;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    function clear() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      particles = [];
      started = null;
      context?.clearRect(0, 0, width, height);
    }

    function resize() {
      clear();
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw(time) {
      frame = null;
      if (reducedMotion?.matches) { clear(); return; }
      if (started === null) started = time;
      const elapsed = (time - started) / 1000;
      context.clearRect(0, 0, width, height);
      if (elapsed >= 1.6) { clear(); return; }
      context.globalAlpha = 1 - elapsed / 1.6;
      for (const particle of particles) {
        context.save();
        context.translate(particle.x + particle.vx * elapsed, particle.y + particle.vy * elapsed + 250 * elapsed * elapsed);
        context.rotate(particle.spin * elapsed);
        context.fillStyle = particle.color;
        context.fillRect(-3, -5, 6, 10);
        context.restore();
      }
      frame = window.requestAnimationFrame(draw);
    }

    function burst() {
      clear();
      if (!context || reducedMotion?.matches || typeof window.requestAnimationFrame !== "function") return false;
      particles = Array.from({ length: 48 }, () => ({
        x: width / 2, y: height * 0.35,
        vx: (Math.random() - 0.5) * 650,
        vy: -100 - Math.random() * 250,
        spin: (Math.random() - 0.5) * 12,
        color: ["#d4af37", "#ebc470", "#fff0b3"][Math.floor(Math.random() * 3)]
      }));
      frame = window.requestAnimationFrame(draw);
      return true;
    }

    resize();
    window.addEventListener("resize", resize);
    return { burst, resize, destroy() { clear(); window.removeEventListener("resize", resize); } };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function attach(root) {
    if (cards.has(root)) return cards.get(root);
    root.classList.add("halo-oracle");
    const panel = el("section", "halo-oracle__track");
    panel.setAttribute("aria-label", "Oracle listening stage");
    const title = el("h3", "halo-oracle__title", "Explore the Living Chart");
    const artist = el("p", "halo-oracle__artist", "Select a signal to listen");
    const momentum = el("p", "halo-oracle__momentum", "Rolling 7-day momentum");
    const play = el("button", "halo-hud-btn halo-oracle__play", "Preview unavailable");
    play.type = "button";
    play.disabled = true;
    play.setAttribute("aria-pressed", "false");
    const links = el("nav", "halo-oracle__links");
    links.setAttribute("aria-label", "Oracle discovery and gateways");
    for (const [label, href] of [["Discover signals ↗", "/music/#chartTitle"], ["Enter Public Frequency ↗", "/signal-network/#feed"]]) {
      const link = el("a", "", label);
      link.href = href;
      links.append(link);
    }
    panel.append(title, artist, momentum, play, links);
    root.append(panel);
    const save = el("button", "halo-hud-btn halo-oracle__save", "Save signal for curation");
    save.type = "button";
    save.disabled = true;
    save.setAttribute("aria-pressed", "false");
    panel.append(save);
    const conversation = el("section", "halo-oracle__conversation");
    conversation.setAttribute("aria-label", "HALO Oracle catalog concierge");
    const status = el("p", "halo-oracle__status", "CATALOG INTELLIGENCE · Ready");
    status.setAttribute("role", "status");
    const response = el("div", "halo-oracle__response");
    response.setAttribute("aria-live", "polite");
    const reply = el("p", "halo-oracle__reply", "How should this moment feel? Find your focus, explore artist stories, curate an album, or meet the release host.");
    const countdown = el("p", "halo-oracle__countdown");
    countdown.hidden = true;
    const selection = el("div", "halo-oracle__selections");
    response.append(reply, countdown, selection);
    const chips = el("div", "halo-oracle__chips");
    const form = el("form", "halo-oracle__form");
    const label = el("label", "halo-oracle__prompt", "Tell the Oracle your mood or intent");
    const input = el("input", "halo-oracle__input");
    input.type = "text";
    input.maxLength = 1200;
    input.required = true;
    input.placeholder = "I need to lock in and focus…";
    label.append(input);
    const send = el("button", "halo-hud-btn halo-oracle__send", "Transmit");
    send.type = "submit";
    form.append(label, send);
    conversation.append(status, response, chips, form);
    root.append(conversation);
    const card = { root, title, artist, momentum, play, save, status, response, reply, countdown, selection, chips, input, send, track: null, contextId: "", revision: 0, loading: false, clock: null };
    renderChips(card, [
      { label: "Focus & vibe", query: "I need to lock in and focus" },
      { label: "Track story", query: "What inspired this track?" },
      { label: "Collector album", query: "Curate an album from my favorites" },
      { label: "Release host", query: "Show upcoming releases and early access" }
    ]);
    form.addEventListener("submit", event => { event.preventDefault(); transmit(card, input.value); });
    save.addEventListener("click", () => {
      if (!card.contextId) return;
      if (favorites.has(card.contextId)) favorites.delete(card.contextId);
      else if (favorites.size < 50) favorites.add(card.contextId);
      const saved = favorites.has(card.contextId);
      save.setAttribute("aria-pressed", String(saved));
      save.textContent = saved ? "Signal saved · Remove" : "Save signal for curation";
      status.textContent = `${favorites.size} signals saved for this visit only. Ask for a collector album to curate them.`;
    });
    play.addEventListener("click", () => {
      if (play.disabled || !card.track) return;
      effect?.burst();
    });
    cards.set(root, card);
    return card;
  }

  function update(root, source) {
    const card = attach(root);
    activeCard = card;
    const attr = name => source?.getAttribute(name) || "";
    const contextId = attr("data-track-id");
    if (card.contextId !== contextId) {
      card.revision += 1;
      card.controller?.abort();
      card.loading = false;
      card.send.disabled = false;
      card.response.setAttribute("aria-busy", "false");
      clearClock(card);
      card.tick = null;
      card.countdown.hidden = true;
      card.selection.replaceChildren();
      card.reply.textContent = "Your listening stage is ready. Ask about this track, or tell me how you want to feel.";
      card.status.textContent = "CATALOG INTELLIGENCE · Ready";
    }
    card.contextId = contextId;
    card.save.disabled = !contextId;
    card.save.setAttribute("aria-pressed", String(favorites.has(contextId)));
    card.save.textContent = favorites.has(contextId) ? "Signal saved · Remove" : "Save signal for curation";
    if (card.tick) {
      clearClock(card);
      card.clock = window.setTimeout(card.tick, 0);
    }
    card.track = source && !source.disabled && attr("data-audio-url") ? {
      id: attr("data-track-id"), title: attr("data-title"), artist: attr("data-artist"),
      src: attr("data-audio-url"), cover: attr("data-cover")
    } : null;
    card.title.textContent = attr("data-title") || "Explore the Living Chart";
    card.artist.textContent = attr("data-artist") || "Select a signal to listen";
    card.momentum.textContent = attr("data-momentum") || "Rolling 7-day momentum";
    card.play.disabled = !card.track || !window.HaloPlayer;
    for (const name of ["data-action", "data-play-track-id", "data-track-id", "data-title", "data-artist", "data-audio-url", "data-cover"]) {
      if (card.track) card.play.setAttribute(name, attr(name));
      else card.play.removeAttribute(name);
    }
    card.play.setAttribute("aria-pressed", "false");
    card.play.setAttribute("aria-label", card.track ? `Play ${card.title.textContent}` : "Preview unavailable");
    card.play.textContent = card.track ? "▶ Play" : "Preview unavailable";
    card.play.classList.remove("is-playing", "is-error");
    if (card.track) window.HaloPlayer?.syncButtons?.(root);
  }

  function init() {
    const launcher = el("button", "halo-oracle__launcher", "✦ ASK HALO ORACLE");
    launcher.type = "button";
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-label", "Open HALO Oracle listening stage");
    launcher.addEventListener("click", () => {
      if (!window.HaloHud) return;
      window.setTimeout(() => {
        window.HaloHud.openGuide();
        const root = document.body.querySelector("#haloHud");
        const card = root && cards.get(root);
        root?.classList.add("is-oracle-stage");
        const badge = root?.querySelector(".halo-hud-badge");
        if (badge) badge.textContent = "HALO ORACLE · LISTENING STAGE";
        card?.input.focus();
      }, 0);
    });
    document.body.append(launcher);
    const canvas = el("canvas", "halo-oracle__confetti");
    canvas.setAttribute("aria-hidden", "true");
    document.body.append(canvas);
    effect = createConfetti(canvas);
    window.HaloChartCelebration?.subscribeBroadcasts(() => {
      if (activeCard && !activeCard.root.hidden) effect.burst();
    });
  }

  window.HaloOracle = Object.freeze({ attach, update, createConfetti });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
