(() => {
  if (window.__haloCompanionLoaded) return;
  window.__haloCompanionLoaded = true;

  const AGENTS = {
    nova: { name: "Nova", role: "Navigator", glyph: "✦", color: "#d8ff62" },
    sol: { name: "Sol", role: "Care guide", glyph: "☼", color: "#ffbd8a" },
    echo: { name: "Echo", role: "Community", glyph: "◉", color: "#a8d9ff" },
    muse: { name: "Muse", role: "Creator coach", glyph: "◆", color: "#eab8ff" }
  };
  const pageGuides = {
    "/": { eyebrow: "Home signal", welcome: "Welcome to HALO. I’m Nova, and the whole companion team is here to guide you, your family, or your creative journey.", prompts: ["What can I do here?", "Meet the agent team", "Show me the live experience"] },
    "/index.html": { eyebrow: "Home signal", welcome: "Welcome to HALO. I’m Nova, and the whole companion team is here to guide you, your family, or your creative journey.", prompts: ["What can I do here?", "Meet the agent team", "Show me the live experience"] },
    "/halo-live.html": { eyebrow: "Live signal", welcome: "You’re inside HALO Live. Echo can help you join the moment, connect with the room, and make the experience easy for everyone with you.", prompts: ["How do I join in?", "Help my family follow along", "What is happening live?"] },
    "/halo-x.html": { eyebrow: "Access signal", welcome: "You’re inside DJ HALO X. Nova can help activate a pass, Muse can explain saved DJ sessions, and Echo can help choose the one signal pinned to your room.", prompts: ["How do passes work?", "Help me pin my room", "Explain session recovery"] },
    "/dj-deck.html": { eyebrow: "Booth signal", welcome: "Welcome to the booth. Muse can guide your setup, workflow, and next creative move without interrupting the music.", prompts: ["Explain this DJ deck", "Help me start a set", "How does AI DJ work?"] },
    "/vip_launchpad.html": { eyebrow: "VIP signal", welcome: "You’ve reached the VIP launchpad. Nova can explain the experience, and Sol can help if access or next steps feel unclear.", prompts: ["Explain VIP access", "What happens next?", "I need help with access"] },
    "/creators/": { eyebrow: "Creator signal", welcome: "Muse here. I can help artists and creators understand the marketplace, prepare their story, and choose the right next step.", prompts: ["How does the marketplace work?", "Help me prepare my profile", "What can creators offer?"] },
    "/creators/index.html": { eyebrow: "Creator signal", welcome: "Muse here. I can help artists and creators understand the marketplace, prepare their story, and choose the right next step.", prompts: ["How does the marketplace work?", "Help me prepare my profile", "What can creators offer?"] },
    "/creators/gear-guide.html": { eyebrow: "Signal chain", welcome: "Muse here. I can help you identify the problem before considering equipment, then check the details that make a track ready for distribution.", prompts: ["Do I need new gear?", "Help me check my release", "Explain the affiliate links"] }
  };

  const state = {
    open: false,
    busy: false,
    agent: location.pathname.startsWith("/creators") || location.pathname === "/dj-deck.html" ? "muse" : location.pathname === "/halo-live.html" ? "echo" : "nova",
    sessionId: getSessionId()
  };

  function getSessionId() {
    const key = "halo-companion-journey";
    try {
      const stored = localStorage.getItem(key);
      if (/^[a-zA-Z0-9_-]{16,64}$/.test(stored || "")) return stored;
      const randomPart = crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const generated = `journey_${randomPart}`.slice(0, 64);
      localStorage.setItem(key, generated);
      return generated;
    } catch {
      return `journey_${Date.now()}_${Math.random().toString(36).slice(2)}`.slice(0, 64);
    }
  }

  function pageGuide() {
    return pageGuides[location.pathname] || pageGuides["/"];
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes halo-companion-rise{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes halo-companion-pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.18);opacity:0}}
      @keyframes halo-companion-orbit{to{transform:rotate(360deg)}}
      .halo-companion{--hc-agent:#d8ff62;position:fixed;left:18px;bottom:18px;z-index:10020;color:#f7f4ec;font-family:"DM Mono","IBM Plex Mono","Space Mono",monospace;letter-spacing:0;line-height:1.45}
      .halo-companion *{box-sizing:border-box}.halo-companion button,.halo-companion input{font:inherit}
      .halo-companion-launcher{position:relative;display:grid;grid-template-columns:46px auto;align-items:center;gap:11px;min-height:58px;padding:6px 16px 6px 6px;border:1px solid rgba(255,255,255,.22);border-radius:32px;background:rgba(9,11,10,.93);color:#fff;cursor:pointer;box-shadow:0 18px 55px rgba(0,0,0,.5);backdrop-filter:blur(18px);transition:transform .2s ease,border-color .2s ease}
      .halo-companion-launcher:hover{transform:translateY(-3px);border-color:var(--hc-agent)}.halo-companion-launcher:focus-visible,.halo-companion button:focus-visible,.halo-companion input:focus-visible{outline:2px solid var(--hc-agent);outline-offset:3px}
      .halo-companion-launcher-core{position:relative;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:var(--hc-agent);color:#090b0a;font-size:20px;box-shadow:0 0 25px color-mix(in srgb,var(--hc-agent) 40%,transparent)}
      .halo-companion-launcher-core::before{content:"";position:absolute;inset:-5px;border:1px solid var(--hc-agent);border-radius:50%;animation:halo-companion-pulse 2.8s ease-out infinite}.halo-companion-launcher-copy{display:grid;text-align:left}.halo-companion-launcher-copy strong{font-size:11px;letter-spacing:.12em;text-transform:uppercase}.halo-companion-launcher-copy span{color:#9ea49e;font-size:8px;letter-spacing:.06em;text-transform:uppercase}
      .halo-companion-panel{position:absolute;left:0;bottom:72px;display:grid;grid-template-rows:auto auto minmax(180px,1fr) auto;width:min(430px,calc(100vw - 36px));height:min(690px,calc(100vh - 108px));overflow:hidden;border:1px solid rgba(255,255,255,.18);background:#0a0c0b;box-shadow:0 30px 90px rgba(0,0,0,.66);clip-path:polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,24px 100%,0 calc(100% - 24px));animation:halo-companion-rise .28s ease-out both}.halo-companion-panel[hidden]{display:none}
      .halo-companion-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 9% 2%,color-mix(in srgb,var(--hc-agent) 20%,transparent),transparent 29%),linear-gradient(115deg,rgba(255,255,255,.025),transparent 40%)}
      .halo-companion-head{position:relative;display:grid;grid-template-columns:1fr auto;gap:18px;padding:20px 20px 15px;border-bottom:1px solid rgba(255,255,255,.1)}.halo-companion-eyebrow{display:flex;align-items:center;gap:8px;color:var(--hc-agent);font-size:8px;letter-spacing:.2em;text-transform:uppercase}.halo-companion-eyebrow::before{content:"";width:18px;height:1px;background:currentColor}.halo-companion-title{margin:7px 0 0;font-family:Georgia,"Times New Roman",serif;font-size:25px;font-weight:400;line-height:1}.halo-companion-title em{color:var(--hc-agent);font-style:italic}.halo-companion-close{align-self:start;width:32px;height:32px;border:1px solid rgba(255,255,255,.14);border-radius:50%;background:transparent;color:#d4d7d1;cursor:pointer}
      .halo-companion-roster{position:relative;display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.025)}.halo-companion-agent{display:grid;place-items:center;gap:2px;padding:11px 4px;border:0;border-right:1px solid rgba(255,255,255,.08);background:transparent;color:#777e77;cursor:pointer;transition:background .2s,color .2s}.halo-companion-agent:last-child{border-right:0}.halo-companion-agent[data-active="true"]{background:color-mix(in srgb,var(--agent-color) 11%,transparent);color:var(--agent-color)}.halo-companion-agent-glyph{font-size:15px}.halo-companion-agent strong{font-size:8px;letter-spacing:.1em;text-transform:uppercase}.halo-companion-agent span:last-child{font-size:7px;text-transform:uppercase}
      .halo-companion-feed{position:relative;display:flex;flex-direction:column;gap:13px;overflow-y:auto;padding:18px 18px 24px;scrollbar-width:thin;scrollbar-color:var(--hc-agent) #171a17}.halo-companion-message{max-width:88%;animation:halo-companion-rise .24s ease-out both}.halo-companion-message[data-role="visitor"]{align-self:flex-end}.halo-companion-message-label{margin:0 0 5px;color:#767d76;font-size:7px;letter-spacing:.14em;text-transform:uppercase}.halo-companion-message[data-role="visitor"] .halo-companion-message-label{text-align:right}.halo-companion-bubble{padding:12px 14px;border:1px solid rgba(255,255,255,.1);background:#131613;font:400 11px/1.55 "DM Mono","IBM Plex Mono",monospace;white-space:pre-wrap}.halo-companion-message[data-role="visitor"] .halo-companion-bubble{border-color:color-mix(in srgb,var(--hc-agent) 30%,transparent);background:color-mix(in srgb,var(--hc-agent) 9%,#111)}
      .halo-companion-suggestions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.halo-companion-suggestion,.halo-companion-route{border:1px solid rgba(255,255,255,.14);background:transparent;color:#d9ddd6;padding:7px 9px;font-size:8px;cursor:pointer;transition:border-color .2s,color .2s}.halo-companion-suggestion:hover,.halo-companion-route:hover{border-color:var(--hc-agent);color:var(--hc-agent)}.halo-companion-route{display:inline-flex;margin-top:9px;text-decoration:none;color:var(--hc-agent);border-color:color-mix(in srgb,var(--hc-agent) 45%,transparent)}
      .halo-companion-thinking{display:flex;align-items:center;gap:8px;color:#858c85;font-size:8px;text-transform:uppercase;letter-spacing:.12em}.halo-companion-thinking::before{content:"";width:15px;height:15px;border:1px solid rgba(255,255,255,.15);border-top-color:var(--hc-agent);border-radius:50%;animation:halo-companion-orbit .7s linear infinite}
      .halo-companion-compose{position:relative;padding:13px 14px 15px;border-top:1px solid rgba(255,255,255,.1);background:#0e110e}.halo-companion-form{display:grid;grid-template-columns:1fr 44px;gap:8px}.halo-companion-input{min-width:0;height:44px;border:1px solid rgba(255,255,255,.16);border-radius:0;background:#070908;color:#fff;padding:0 12px;font-size:10px}.halo-companion-input::placeholder{color:#656b65}.halo-companion-send{display:grid;place-items:center;border:1px solid var(--hc-agent);background:var(--hc-agent);color:#080a08;cursor:pointer;font-size:16px}.halo-companion-send:disabled{cursor:wait;opacity:.55}.halo-companion-foot{display:flex;justify-content:space-between;gap:10px;margin-top:8px;color:#666d66;font-size:7px;letter-spacing:.05em}.halo-companion-memory{color:#8fa178}.halo-companion-memory::before{content:"●";margin-right:5px;color:var(--hc-agent)}
      @media(max-width:600px){.halo-companion{left:10px;bottom:10px}.halo-companion-launcher{grid-template-columns:42px auto;min-height:52px}.halo-companion-launcher-core{width:42px;height:42px}.halo-companion-panel{bottom:64px;width:calc(100vw - 20px);height:min(690px,calc(100vh - 84px))}.halo-companion-title{font-size:22px}.halo-companion-roster{grid-template-columns:repeat(4,1fr)}.halo-companion-agent span:last-child{display:none}}
      @media(prefers-reduced-motion:reduce){.halo-companion *{animation:none!important;transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  function createShell() {
    const guide = pageGuide();
    const root = document.createElement("aside");
    root.className = "halo-companion";
    root.setAttribute("aria-label", "HALO AI companion team");
    root.innerHTML = `
      <section class="halo-companion-panel" hidden aria-label="HALO Companion conversation">
        <header class="halo-companion-head">
          <div><div class="halo-companion-eyebrow">${guide.eyebrow}</div><h2 class="halo-companion-title">Your <em>companion</em> team</h2></div>
          <button class="halo-companion-close" type="button" aria-label="Close companion">×</button>
        </header>
        <div class="halo-companion-roster" aria-label="AI specialist team"></div>
        <div class="halo-companion-feed" role="log" aria-live="polite"></div>
        <footer class="halo-companion-compose">
          <form class="halo-companion-form">
            <input class="halo-companion-input" maxlength="1000" autocomplete="off" aria-label="Ask the HALO companion team" placeholder="Tell us what you need…">
            <button class="halo-companion-send" type="submit" aria-label="Send message">↗</button>
          </form>
          <div class="halo-companion-foot"><span class="halo-companion-memory">Journey memory on</span><span>AI guidance · Human care available</span></div>
        </footer>
      </section>
      <button class="halo-companion-launcher" type="button" aria-expanded="false" aria-label="Open HALO Companion">
        <span class="halo-companion-launcher-core">${AGENTS[state.agent].glyph}</span>
        <span class="halo-companion-launcher-copy"><strong>Ask HALO</strong><span>4 companions online</span></span>
      </button>`;
    document.body.appendChild(root);
    return root;
  }

  function setAgent(agentId) {
    if (!AGENTS[agentId]) return;
    state.agent = agentId;
    root.style.setProperty("--hc-agent", AGENTS[agentId].color);
    root.querySelector(".halo-companion-launcher-core").textContent = AGENTS[agentId].glyph;
    root.querySelectorAll(".halo-companion-agent").forEach(button => {
      button.dataset.active = String(button.dataset.agent === agentId);
    });
  }

  function renderRoster() {
    const roster = root.querySelector(".halo-companion-roster");
    Object.entries(AGENTS).forEach(([id, agent]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "halo-companion-agent";
      button.dataset.agent = id;
      button.dataset.active = String(id === state.agent);
      button.style.setProperty("--agent-color", agent.color);
      button.setAttribute("aria-label", `${agent.name}, ${agent.role}`);
      button.innerHTML = `<span class="halo-companion-agent-glyph">${agent.glyph}</span><strong>${agent.name}</strong><span>${agent.role}</span>`;
      button.addEventListener("click", () => {
        setAgent(id);
        addMessage("assistant", `${agent.name} is here. ${agentIntro(id)}`, { agent: id, suggestions: specialistPrompts(id) });
      });
      roster.appendChild(button);
    });
  }

  function agentIntro(agentId) {
    return {
      nova: "I make the site and your next step feel clear.",
      sol: "I offer patient support, accessibility help, and a path to human care.",
      echo: "I help clients, families, and fans feel connected to the community.",
      muse: "I guide creators through tools, storytelling, and marketplace readiness."
    }[agentId];
  }

  function specialistPrompts(agentId) {
    return {
      nova: ["What can I do here?", "Guide me around HALO"],
      sol: ["I need a human", "Make this easier to understand"],
      echo: ["How can my family join?", "Take me to the clubhouse"],
      muse: ["Help my creator journey", "Show me the DJ tools"]
    }[agentId];
  }

  function addMessage(role, text, options = {}) {
    const feed = root.querySelector(".halo-companion-feed");
    const message = document.createElement("article");
    message.className = "halo-companion-message";
    message.dataset.role = role;
    const agent = AGENTS[options.agent || state.agent];
    const label = document.createElement("p");
    label.className = "halo-companion-message-label";
    label.textContent = role === "visitor" ? "You" : `${agent.name} · ${agent.role}`;
    const bubble = document.createElement("div");
    bubble.className = "halo-companion-bubble";
    bubble.textContent = text;
    message.append(label, bubble);

    if (options.suggestions?.length) {
      const suggestions = document.createElement("div");
      suggestions.className = "halo-companion-suggestions";
      options.suggestions.forEach(prompt => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "halo-companion-suggestion";
        button.textContent = prompt;
        button.addEventListener("click", () => sendMessage(prompt));
        suggestions.appendChild(button);
      });
      message.appendChild(suggestions);
    }
    if (options.route) {
      const link = document.createElement("a");
      link.className = "halo-companion-route";
      link.href = options.route;
      link.textContent = "Continue this journey →";
      message.appendChild(link);
    }
    feed.appendChild(message);
    feed.scrollTop = feed.scrollHeight;
  }

  function showThinking(show) {
    const feed = root.querySelector(".halo-companion-feed");
    feed.querySelector(".halo-companion-thinking")?.remove();
    if (!show) return;
    const thinking = document.createElement("div");
    thinking.className = "halo-companion-thinking";
    thinking.textContent = "Companion team is listening";
    feed.appendChild(thinking);
    feed.scrollTop = feed.scrollHeight;
  }

  async function sendMessage(rawMessage) {
    const message = String(rawMessage || "").trim();
    if (!message || state.busy) return;
    state.busy = true;
    const input = root.querySelector(".halo-companion-input");
    const send = root.querySelector(".halo-companion-send");
    input.value = "";
    send.disabled = true;
    addMessage("visitor", message);
    showThinking(true);
    window.haloStats?.track("companion_message_sent", { path: location.pathname, activeAgent: state.agent });
    try {
      const response = await fetch("/api/halo-companion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, message, path: `${location.pathname}${location.hash}`, title: document.title })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The companion team could not respond.");
      showThinking(false);
      setAgent(data.agent?.id || "nova");
      addMessage("assistant", data.reply, { agent: data.agent?.id, suggestions: data.suggestions, route: data.route });
      window.dispatchEvent(new CustomEvent("halo:journal-event", {
        detail: {
          eventType: "companion_guidance_received",
          category: "guidance",
          targetName: data.agent?.name || "HALO Companion",
          details: { agent: data.agent?.id || "nova", hasRoute: Boolean(data.route) }
        }
      }));
      if (data.careRequestCreated) addMessage("assistant", "Your note is saved for the human care team. You can keep talking with me while they review it.", { agent: "sol" });
    } catch (error) {
      showThinking(false);
      addMessage("assistant", error.message || "The companion team is reconnecting. Please try again.", { agent: "sol", suggestions: ["Try again", "I need a human"] });
    } finally {
      state.busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  function toggle(open = !state.open) {
    state.open = open;
    root.querySelector(".halo-companion-panel").hidden = !open;
    root.querySelector(".halo-companion-launcher").setAttribute("aria-expanded", String(open));
    if (open) {
      root.querySelector(".halo-companion-input").focus();
      window.haloStats?.track("companion_opened", { path: location.pathname });
    }
  }

  injectStyles();
  const root = createShell();
  renderRoster();
  setAgent(state.agent);
  const guide = pageGuide();
  addMessage("assistant", guide.welcome, { agent: state.agent, suggestions: guide.prompts });

  root.querySelector(".halo-companion-launcher").addEventListener("click", () => toggle());
  root.querySelector(".halo-companion-close").addEventListener("click", () => toggle(false));
  root.querySelector(".halo-companion-form").addEventListener("submit", event => {
    event.preventDefault();
    sendMessage(root.querySelector(".halo-companion-input").value);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.open) toggle(false);
  });
})();
