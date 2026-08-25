(() => {
  const endpoint = "/api/when-the-world-goes-dark/pulse";
  const signalColors = {
    stay: "#ff7b37",
    rise: "#ffc46a",
    remember: "#91d7d2",
    return: "#f4efe6"
  };
  const state = { total: 0, recent: [], distribution: {}, selected: "", busy: false };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const elements = {
    canvas: document.getElementById("signalField"),
    count: document.getElementById("pulseCount"),
    status: document.getElementById("networkStatus"),
    core: document.getElementById("networkCore"),
    buttons: [...document.querySelectorAll("[data-signal]")],
    share: document.getElementById("shareSignal"),
    shareNotice: document.getElementById("shareNotice")
  };

  function listenerKey() {
    const storageKey = "halo_world_dark_listener";
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing) return existing;
      const created = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(storageKey, created);
      return created;
    } catch {
      return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    }
  }

  function pluralLights(total) {
    return `${total.toLocaleString()} ${total === 1 ? "light is" : "lights are"} still on.`;
  }

  function render(data) {
    state.total = Number(data.total || 0);
    state.recent = Array.isArray(data.recent) ? data.recent : [];
    state.distribution = data.distribution || {};
    elements.count.textContent = state.total.toLocaleString();
    if (!state.selected) elements.status.textContent = state.total ? pluralLights(state.total) : "Be the first light in the network.";

    const maximum = Math.max(1, ...Object.values(state.distribution).map(Number));
    Object.entries(state.distribution).forEach(([signal, value]) => {
      const label = signal[0].toUpperCase() + signal.slice(1);
      const bar = document.getElementById(`bar${label}`);
      const output = document.getElementById(`value${label}`);
      if (bar) bar.style.width = `${Math.max(2, Number(value) / maximum * 100)}%`;
      if (output) output.textContent = Number(value).toLocaleString();
    });
    drawField();
  }

  async function loadNetwork() {
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("offline");
      render(await response.json());
    } catch {
      elements.count.textContent = "∞";
      elements.status.textContent = "The signal exists even while the counter is quiet.";
    }
  }

  async function sendPulse(signal) {
    if (state.busy || state.selected) return;
    state.busy = true;
    elements.buttons.forEach(button => { button.disabled = true; });
    elements.status.textContent = "Sending your light…";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ signal, listenerKey: listenerKey() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The pulse did not land.");
      state.selected = data.signal || signal;
      elements.buttons.forEach(button => button.classList.toggle("is-selected", button.dataset.signal === state.selected));
      elements.status.textContent = data.message;
      elements.core.classList.add("is-lit");
      render(data);
      elements.status.textContent = data.message;
      flash(signalColors[state.selected]);
    } catch (error) {
      elements.status.textContent = error.message || "The network is quiet. Try again.";
      elements.buttons.forEach(button => { button.disabled = false; });
    } finally {
      state.busy = false;
    }
  }

  async function shareSignal() {
    const shareData = {
      title: "When The World Goes Dark — The Last Light Network",
      text: "Leave one light in Owen Anthony's Last Light Network, then enter the song.",
      url: window.location.href
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        elements.shareNotice.textContent = "Signal sent.";
      } else {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        elements.shareNotice.textContent = "Signal link copied.";
      }
    } catch (error) {
      if (error?.name !== "AbortError") elements.shareNotice.textContent = "Copy this page address to carry the signal.";
    }
  }

  let field;
  function setupField() {
    if (!elements.canvas || reducedMotion) return;
    const context = elements.canvas.getContext("2d");
    if (!context) return;
    field = { context, width: 0, height: 0, particles: [], flare: 0, color: signalColors.stay };
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      field.width = window.innerWidth;
      field.height = window.innerHeight;
      elements.canvas.width = field.width * ratio;
      elements.canvas.height = field.height * ratio;
      elements.canvas.style.width = `${field.width}px`;
      elements.canvas.style.height = `${field.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      createParticles();
    };
    window.addEventListener("resize", resize, { passive: true });
    resize();
    requestAnimationFrame(animateField);
  }

  function createParticles() {
    if (!field) return;
    const count = Math.min(110, Math.max(34, Math.floor(field.width / 14)));
    field.particles = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * field.width,
      y: Math.random() * field.height,
      radius: Math.random() * 1.4 + .25,
      alpha: Math.random() * .55 + .12,
      speed: Math.random() * .08 + .015,
      signal: state.recent[index % Math.max(1, state.recent.length)]?.signal || Object.keys(signalColors)[index % 4]
    }));
  }

  function drawField() {
    if (field) createParticles();
  }

  function flash(color) {
    if (!field || reducedMotion) return;
    field.flare = 1;
    field.color = color || signalColors.stay;
  }

  function animateField() {
    if (!field) return;
    const { context, width, height } = field;
    context.clearRect(0, 0, width, height);
    field.particles.forEach(particle => {
      particle.y -= particle.speed;
      if (particle.y < -4) { particle.y = height + 4; particle.x = Math.random() * width; }
      context.beginPath();
      context.fillStyle = signalColors[particle.signal] || signalColors.stay;
      context.globalAlpha = particle.alpha;
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fill();
    });
    if (field.flare > .01) {
      const radius = (1 - field.flare) * Math.max(width, height) * .75;
      context.globalAlpha = field.flare * .45;
      context.strokeStyle = field.color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      context.stroke();
      field.flare *= .965;
    }
    context.globalAlpha = 1;
    requestAnimationFrame(animateField);
  }

  elements.buttons.forEach(button => button.addEventListener("click", () => sendPulse(button.dataset.signal)));
  elements.share?.addEventListener("click", shareSignal);
  setupField();
  loadNetwork();
})();
