(() => {
  "use strict";
  if (window.HaloOracle) return;

  const cards = new WeakMap();
  let activeCard = null;
  let effect = null;

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
    const card = { root, title, artist, momentum, play, track: null };
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
