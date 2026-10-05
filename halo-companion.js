(() => {
  if (typeof window === "undefined" || typeof document === "undefined" || window.__haloCompanionLoaded) return;
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
  const SETTINGS_KEY = "halo-companion-settings.v1";
  const JOURNEY_STATE_KEY = "halo-artist-journey-state.v1";
  const DISMISSED_KEY = "halo-companion-dismissed.v1";
  const DEFAULT_SETTINGS = {
    voiceEnabled: false,
    voiceStyle: "steady",
    voiceLocale: "auto",
    guidanceDetail: "detailed",
    promptMode: "proactive",
    guidanceScope: "full-site"
  };

  const state = {
    open: false,
    busy: false,
    agent: location.pathname.startsWith("/creators") || location.pathname === "/dj-deck.html" ? "muse" : location.pathname === "/halo-live.html" ? "echo" : "nova",
    sessionId: getSessionId(),
    settings: readSettings(),
    journey: readJourneyState(),
    voiceStatus: "",
    unread: 0,
    lastJourneySignature: ""
  };
  const VOICE_MODULE_SRC = "/halo-guide-voice.js";
  const REQUEST_TIMEOUT_MS = 25000;
  const reduceMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let voiceModulePromise = null;

  function randomToken() {
    if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "");
    if (crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now().toString(16)}0000000000000000`.slice(0, 32);
  }

  function getSessionId() {
    const key = "halo-companion-journey";
    try {
      const stored = localStorage.getItem(key);
      if (/^[a-zA-Z0-9_-]{16,64}$/.test(stored || "")) return stored;
      const generated = `journey_${randomToken()}`.slice(0, 64);
      localStorage.setItem(key, generated);
      return generated;
    } catch {
      return `journey_${randomToken()}`.slice(0, 64);
    }
  }

  function pageGuide() {
    return pageGuides[location.pathname] || pageGuides["/"];
  }

  function normalizeSettings(value) {
    const settings = value && typeof value === "object" ? value : {};
    return {
      voiceEnabled: settings.voiceEnabled === true,
      voiceStyle: ["steady", "warm", "calm", "bright"].includes(settings.voiceStyle) ? settings.voiceStyle : DEFAULT_SETTINGS.voiceStyle,
      voiceLocale: ["auto", "en-US", "en-GB"].includes(settings.voiceLocale) ? settings.voiceLocale : DEFAULT_SETTINGS.voiceLocale,
      guidanceDetail: ["concise", "detailed"].includes(settings.guidanceDetail) ? settings.guidanceDetail : DEFAULT_SETTINGS.guidanceDetail,
      promptMode: ["proactive", "manual"].includes(settings.promptMode) ? settings.promptMode : DEFAULT_SETTINGS.promptMode,
      guidanceScope: ["deck-only", "full-site"].includes(settings.guidanceScope) ? settings.guidanceScope : DEFAULT_SETTINGS.guidanceScope
    };
  }

  function readSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {}
  }

  function normalizeJourneyState(value) {
    if (!value || typeof value !== "object") return null;
    const stage = value.currentStage && typeof value.currentStage === "object" ? {
      id: String(value.currentStage.id || "").trim(),
      label: String(value.currentStage.label || "").trim()
    } : null;
    if (!stage?.id) return null;
    return {
      stageBadge: String(value.stageBadge || "").trim(),
      summary: String(value.summary || "").trim(),
      statusNote: String(value.statusNote || "").trim(),
      nextActionTitle: String(value.nextActionTitle || "").trim(),
      nextActionCopy: String(value.nextActionCopy || "").trim(),
      currentStage: stage,
      updatedAt: String(value.updatedAt || "").trim()
    };
  }

  function readJourneyState() {
    try {
      return normalizeJourneyState(JSON.parse(localStorage.getItem(JOURNEY_STATE_KEY) || "null"));
    } catch {
      return null;
    }
  }

  function prefersJourneyEverywhere() {
    return state.settings.guidanceScope === "full-site" || location.pathname === "/dj-deck.html";
  }

  function guidanceSignature(journey = state.journey) {
    return journey ? [journey.stageBadge, journey.currentStage?.id, journey.nextActionTitle, journey.nextActionCopy].filter(Boolean).join("|") : "";
  }

  function conciseCopy(text, limit = 2) {
    const sentences = String(text || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.slice(0, limit).join(" ") || String(text || "").trim();
  }

  function formatJourneyCopy(journey = state.journey) {
    if (!journey) {
      return {
        badge: state.settings.guidanceScope === "deck-only" ? "Deck guidance only" : "Full-site guidance",
        stage: state.settings.guidanceScope === "deck-only" ? "Journey updates stay inside the DJ deck." : "Open the DJ deck once and HALO can keep the artist journey in view across the site.",
        copy: "Voice playback stays optional and only runs when your browser allows it."
      };
    }
    const detail = state.settings.guidanceDetail;
    return {
      badge: journey.stageBadge || "Artist journey active",
      stage: detail === "concise" ? `${journey.nextActionTitle || "Next step ready"} · ${journey.currentStage.label}` : journey.nextActionTitle || `Watching ${journey.currentStage.label}`,
      copy: detail === "concise"
        ? conciseCopy(journey.nextActionCopy || journey.summary || "", 1)
        : [journey.summary, journey.statusNote, journey.nextActionCopy].filter(Boolean).join(" ")
    };
  }

  function journeyVoiceCopy(journey = state.journey) {
    if (!journey) return "HALO voice is ready. Open the DJ deck to begin an artist journey watch.";
    const detail = state.settings.guidanceDetail;
    return detail === "concise"
      ? [journey.stageBadge, journey.nextActionTitle, journey.nextActionCopy].filter(Boolean).join(". ")
      : [journey.summary, journey.statusNote, journey.nextActionTitle, journey.nextActionCopy].filter(Boolean).join(". ");
  }

  function voiceModule() {
    return window.HaloGuideVoice || null;
  }

  function loadVoiceModule() {
    if (voiceModule()) return Promise.resolve(voiceModule());
    if (voiceModulePromise) return voiceModulePromise;
    voiceModulePromise = new Promise(resolve => {
      const existing = document.querySelector("script[data-halo-guide-voice]");
      const script = existing || document.createElement("script");
      script.addEventListener("load", () => resolve(voiceModule()), { once: true });
      script.addEventListener("error", () => resolve(null), { once: true });
      if (!existing) {
        script.src = VOICE_MODULE_SRC;
        script.defer = true;
        script.dataset.haloGuideVoice = "true";
        document.head.appendChild(script);
      }
    });
    return voiceModulePromise;
  }

  function voiceSupported() {
    const module = voiceModule();
    if (module) return module.supported();
    return typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
  }

  function cancelSpeech() {
    const module = voiceModule();
    if (module) module.cancel();
    else if (typeof window.speechSynthesis !== "undefined") {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }

  function setVoiceStatus(result) {
    if (!result || result.ok || result.reason === "superseded" || result.reason === "empty") state.voiceStatus = "";
    else if (result.reason === "blocked") state.voiceStatus = "Voice blocked by the browser · tap Speak to play";
    else if (result.reason === "unsupported") state.voiceStatus = "Voice unavailable in this browser";
    else state.voiceStatus = "Voice could not play · text guidance continues";
    updateSettingsDock();
  }

  async function speakText(text) {
    if (!voiceSupported() || !state.settings.voiceEnabled) return false;
    const message = state.settings.guidanceDetail === "concise" ? conciseCopy(text) : String(text || "").trim();
    if (!message) return false;
    const module = await loadVoiceModule();
    if (!module) {
      setVoiceStatus({ ok: false, reason: "unsupported" });
      return false;
    }
    try {
      const result = await module.speak(message, { locale: state.settings.voiceLocale, style: state.settings.voiceStyle });
      setVoiceStatus(result);
      return Boolean(result?.ok);
    } catch {
      setVoiceStatus({ ok: false, reason: "error" });
      return false;
    }
  }

  function updateJourneyDisplay() {
    const section = root.querySelector("#haloCompanionJourney");
    if (!section) return;
    const shouldShow = prefersJourneyEverywhere();
    section.hidden = !shouldShow;
    if (!shouldShow) return;
    const content = formatJourneyCopy();
    root.querySelector("#haloCompanionJourneyBadge").textContent = content.badge;
    root.querySelector("#haloCompanionJourneyStage").textContent = content.stage;
    root.querySelector("#haloCompanionJourneyCopy").textContent = content.copy;
    const speak = root.querySelector("#haloCompanionJourneySpeak");
    if (speak) {
      speak.disabled = !voiceSupported() || !state.settings.voiceEnabled;
      speak.textContent = state.settings.promptMode === "manual" ? "Speak guidance" : "Replay latest guidance";
    }
  }

  function updateSettingsDock() {
    const form = root.querySelector(".halo-companion-settings-form");
    if (!form) return;
    form.elements.haloCompanionVoiceEnabled.checked = state.settings.voiceEnabled;
    form.elements.haloCompanionVoiceStyle.value = state.settings.voiceStyle;
    form.elements.haloCompanionVoiceLocale.value = state.settings.voiceLocale;
    form.elements.haloCompanionGuidanceDetail.value = state.settings.guidanceDetail;
    form.elements.haloCompanionPromptMode.value = state.settings.promptMode;
    form.elements.haloCompanionGuidanceScope.value = state.settings.guidanceScope;
    const status = root.querySelector("#haloCompanionVoiceStatus");
    if (status) {
      const accent = { auto: "auto accent", "en-US": "US English", "en-GB": "UK English" }[state.settings.voiceLocale];
      status.textContent = !voiceSupported()
        ? "Voice unavailable in this browser"
        : !state.settings.voiceEnabled
          ? "Voice available · currently off"
          : state.voiceStatus || `Voice ready · ${state.settings.voiceStyle} tone · ${accent}`;
    }
    root.querySelectorAll(".halo-companion-voice-action").forEach(button => {
      button.disabled = !voiceSupported() || !state.settings.voiceEnabled;
    });
    updateJourneyDisplay();
  }

  function applySettings(nextSettings) {
    state.settings = normalizeSettings(nextSettings);
    persistSettings();
    if (!state.settings.voiceEnabled) {
      cancelSpeech();
      state.voiceStatus = "";
    }
    updateSettingsDock();
  }

  function maybeAnnounceJourney(journey = state.journey) {
    if (!journey || !state.settings.voiceEnabled || state.settings.promptMode !== "proactive" || state.settings.guidanceScope !== "full-site") return;
    const signature = guidanceSignature(journey);
    if (!signature || signature === state.lastJourneySignature) return;
    state.lastJourneySignature = signature;
    addMessage("assistant", journeyVoiceCopy(journey), { agent: "muse", speak: true });
  }

  function handleJourneyUpdate(value) {
    const journey = normalizeJourneyState(value);
    if (!journey) {
      state.journey = null;
      updateJourneyDisplay();
      return;
    }
    state.journey = journey;
    updateJourneyDisplay();
    maybeAnnounceJourney(journey);
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes halo-companion-rise{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes halo-companion-pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.18);opacity:0}}
      @keyframes halo-companion-orbit{to{transform:rotate(360deg)}}
      .halo-companion{--hc-agent:#d8ff62;--hc-gold:#ebc470;position:fixed;left:18px;bottom:18px;max-width:calc(100vw - 20px);z-index:10020;color:#f7f4ec;font-family:"DM Mono","IBM Plex Mono","Space Mono",monospace;letter-spacing:0;line-height:1.45}
      .halo-companion *{box-sizing:border-box}.halo-companion button,.halo-companion input,.halo-companion select{font-family:inherit;font-weight:inherit;line-height:inherit;margin:0}.halo-companion .halo-companion-compose{display:block;padding:13px 14px 15px;border-top:1px solid rgba(255,255,255,.1);color:inherit;font:inherit;letter-spacing:0}.halo-companion .halo-companion-input,.halo-companion .halo-companion-setting select{width:100%}.halo-companion .halo-companion-setting input[type="checkbox"]{padding:0}
      .halo-companion-launcher{position:relative;isolation:isolate;display:grid;grid-template-columns:46px minmax(0,1fr) 6px;align-items:center;gap:11px;width:100%;min-height:58px;padding:6px 16px 6px 6px;border:1px solid rgba(255,255,255,.22);border-radius:32px;background:linear-gradient(135deg,rgba(35,42,37,.78),rgba(9,11,10,.72));color:#fff;cursor:grab;touch-action:none;user-select:none;box-shadow:0 8px 28px rgba(0,0,0,.3);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);transition:border-color .2s ease}
      @keyframes halo-companion-aura{0%,100%{opacity:.35;transform:scale(1)}50%{opacity:.65;transform:scale(1.04)}}
      .halo-companion-launcher::before{content:"";position:absolute;inset:-4px;z-index:-1;border:1px solid var(--hc-agent);border-radius:inherit;box-shadow:0 0 16px color-mix(in srgb,var(--hc-agent) 30%,transparent);pointer-events:none;animation:halo-companion-aura 3.6s ease-in-out infinite}
      .halo-companion-launcher[data-dragging="true"]{cursor:grabbing}.halo-companion-status{width:6px;height:6px;border-radius:50%;background:var(--hc-agent);box-shadow:0 0 8px var(--hc-agent)}
      .halo-companion-launcher:hover{border-color:var(--hc-agent)}.halo-companion-launcher:focus-visible,.halo-companion button:focus-visible,.halo-companion input:focus-visible{outline:2px solid var(--hc-agent);outline-offset:3px}
      .halo-companion-launcher-core{position:relative;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:var(--hc-agent);color:#090b0a;font-size:20px;box-shadow:0 0 25px color-mix(in srgb,var(--hc-agent) 40%,transparent)}
      .halo-companion-launcher-core::before{content:"";position:absolute;inset:-5px;border:1px solid var(--hc-agent);border-radius:50%;animation:halo-companion-pulse 2.8s ease-out infinite}.halo-companion-launcher-copy{display:grid;text-align:left;overflow-wrap:anywhere}.halo-companion-launcher-copy strong{font-size:11px;letter-spacing:.12em;text-transform:uppercase}.halo-companion-launcher-copy span{color:#c3cbc3;font-size:8px;letter-spacing:.06em;text-transform:uppercase}
      .halo-companion-panel{position:absolute;left:0;bottom:72px;display:grid;grid-template-rows:auto auto minmax(180px,1fr) auto;width:min(430px,calc(100vw - 36px));height:min(690px,calc(100vh - 108px));overflow:hidden;border:1px solid rgba(255,255,255,.18);background:linear-gradient(160deg,rgba(24,29,26,.74),rgba(8,10,9,.82));-webkit-backdrop-filter:blur(22px) saturate(150%);backdrop-filter:blur(22px) saturate(150%);box-shadow:0 30px 90px rgba(0,0,0,.66),inset 0 1px 0 rgba(255,255,255,.08);clip-path:polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,24px 100%,0 calc(100% - 24px));animation:halo-companion-rise .28s ease-out both}.halo-companion-panel[hidden]{display:none}
      .halo-companion-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 9% 2%,color-mix(in srgb,var(--hc-agent) 20%,transparent),transparent 29%),linear-gradient(115deg,rgba(255,255,255,.025),transparent 40%)}
      .halo-companion-head{position:relative;display:grid;grid-template-columns:1fr auto;gap:18px;padding:20px 20px 15px;border-bottom:1px solid rgba(255,255,255,.1)}.halo-companion-eyebrow{display:flex;align-items:center;gap:8px;color:var(--hc-agent);font-size:8px;letter-spacing:.2em;text-transform:uppercase}.halo-companion-eyebrow::before{content:"";width:18px;height:1px;background:currentColor}.halo-companion-title{margin:7px 0 0;font-family:Georgia,"Times New Roman",serif;font-size:25px;font-weight:400;line-height:1}.halo-companion-title em{color:var(--hc-agent);font-style:italic}.halo-companion-close{align-self:start;width:32px;height:32px;border:1px solid rgba(255,255,255,.14);border-radius:50%;background:transparent;color:#d4d7d1;cursor:pointer}
      .halo-companion-roster{position:relative;display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.025)}.halo-companion-agent{display:grid;place-items:center;gap:2px;padding:11px 4px;border:0;border-right:1px solid rgba(255,255,255,.08);background:transparent;color:#777e77;cursor:pointer;transition:background .2s,color .2s}.halo-companion-agent:last-child{border-right:0}.halo-companion-agent[data-active="true"]{background:color-mix(in srgb,var(--agent-color) 11%,transparent);color:var(--agent-color)}.halo-companion-agent-glyph{font-size:15px}.halo-companion-agent strong{font-size:8px;letter-spacing:.1em;text-transform:uppercase}.halo-companion-agent span:last-child{font-size:7px;text-transform:uppercase}
      .halo-companion-journey{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(216,255,98,.05),transparent)}.halo-companion-journey[hidden]{display:none}.halo-companion-journey-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.halo-companion-journey-head strong{font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--hc-agent)}.halo-companion-journey-badge{padding:4px 7px;border:1px solid rgba(255,255,255,.16);font-size:7px;letter-spacing:.08em;text-transform:uppercase;color:#d8ddd8}.halo-companion-journey-stage{margin:10px 0 5px;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.halo-companion-journey-copy{margin:0;color:#9ca39c;font-size:9px;line-height:1.55}.halo-companion-journey-action,.halo-companion-voice-action{margin-top:9px;border:1px solid rgba(255,255,255,.16);background:transparent;color:var(--hc-agent);padding:7px 9px;font-size:8px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}.halo-companion-journey-action[disabled],.halo-companion-voice-action[disabled]{opacity:.45;cursor:not-allowed}
      .halo-companion-feed{position:relative;display:flex;flex-direction:column;gap:13px;overflow-y:auto;padding:18px 18px 24px;scrollbar-width:thin;scrollbar-color:var(--hc-agent) #171a17}.halo-companion-message{max-width:88%;animation:halo-companion-rise .24s ease-out both}.halo-companion-message[data-role="visitor"]{align-self:flex-end}.halo-companion-message-label{margin:0 0 5px;color:#767d76;font-size:7px;letter-spacing:.14em;text-transform:uppercase}.halo-companion-message[data-role="visitor"] .halo-companion-message-label{text-align:right}.halo-companion-bubble{padding:12px 14px;border:1px solid rgba(255,255,255,.1);background:#131613;font:400 11px/1.55 "DM Mono","IBM Plex Mono",monospace;white-space:pre-wrap}.halo-companion-message[data-role="visitor"] .halo-companion-bubble{border-color:color-mix(in srgb,var(--hc-agent) 30%,transparent);background:color-mix(in srgb,var(--hc-agent) 9%,#111)}
      .halo-companion-suggestions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.halo-companion-suggestion,.halo-companion-route{border:1px solid rgba(255,255,255,.14);background:transparent;color:#d9ddd6;padding:7px 9px;font-size:8px;cursor:pointer;transition:border-color .2s,color .2s}.halo-companion-suggestion:hover,.halo-companion-route:hover{border-color:var(--hc-agent);color:var(--hc-agent)}.halo-companion-route{display:inline-flex;margin-top:9px;text-decoration:none;color:var(--hc-agent);border-color:color-mix(in srgb,var(--hc-agent) 45%,transparent)}
      .halo-companion-thinking{display:flex;align-items:center;gap:8px;color:#858c85;font-size:8px;text-transform:uppercase;letter-spacing:.12em}.halo-companion-thinking::before{content:"";width:15px;height:15px;border:1px solid rgba(255,255,255,.15);border-top-color:var(--hc-agent);border-radius:50%;animation:halo-companion-orbit .7s linear infinite}
      .halo-companion-compose{position:relative;padding:13px 14px 15px;border-top:1px solid rgba(255,255,255,.1);background:rgba(14,17,14,.55)}.halo-companion-form{display:grid;grid-template-columns:1fr 44px;gap:8px}.halo-companion-input{min-width:0;height:44px;border:1px solid rgba(255,255,255,.16);border-radius:0;background:#070908;color:#fff;padding:0 12px;font-size:10px}.halo-companion-input::placeholder{color:#656b65}.halo-companion-send{display:grid;place-items:center;border:1px solid var(--hc-agent);background:var(--hc-agent);color:#080a08;cursor:pointer;font-size:16px}.halo-companion-send:disabled{cursor:wait;opacity:.55}.halo-companion-foot{display:flex;justify-content:space-between;gap:10px;margin-top:8px;color:#666d66;font-size:7px;letter-spacing:.05em}.halo-companion-memory{color:#8fa178}.halo-companion-memory::before{content:"●";margin-right:5px;color:var(--hc-agent)}.halo-companion-settings{margin-top:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px}.halo-companion-settings summary{cursor:pointer;color:#dfe4dd;font-size:8px;letter-spacing:.14em;text-transform:uppercase;list-style:none}.halo-companion-settings summary::-webkit-details-marker{display:none}.halo-companion-settings summary::after{content:"+";float:right;color:var(--hc-agent)}.halo-companion-settings[open] summary::after{content:"–"}.halo-companion-settings-form{display:grid;gap:8px;margin-top:10px}.halo-companion-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.halo-companion-setting{display:grid;gap:5px;color:#9ea49e;font-size:8px;letter-spacing:.06em;text-transform:uppercase}.halo-companion-setting-check{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.025)}.halo-companion-setting select{height:34px;border:1px solid rgba(255,255,255,.14);background:#080a08;color:#fff;padding:0 9px;font-size:9px}.halo-companion-setting input[type="checkbox"]{width:18px;height:18px;accent-color:var(--hc-agent)}.halo-companion-settings-status{margin:2px 0 0;color:#757c75;font-size:8px}
      @keyframes halo-companion-unread{0%{box-shadow:0 0 0 0 rgba(235,196,112,.55)}70%{box-shadow:0 0 0 12px rgba(235,196,112,0)}100%{box-shadow:0 0 0 0 rgba(235,196,112,0)}}
      .halo-companion-unread{position:absolute;top:2px;left:36px;display:grid;place-items:center;min-width:19px;height:19px;padding:0 5px;border:2px solid #090b0a;border-radius:10px;background:var(--hc-gold);color:#090b0a;font-size:9px;font-weight:700;line-height:1;animation:halo-companion-unread 2s ease-out infinite}.halo-companion-unread[hidden]{display:none}
      .halo-companion-launcher[data-unread="true"]{border-color:var(--hc-gold)}.halo-companion-launcher[data-unread="true"] .halo-companion-launcher-copy span{color:var(--hc-gold)}
      .halo-companion-head{border-bottom-color:rgba(235,196,112,.22)}.halo-companion-setting select:focus-visible,.halo-companion-settings summary:focus-visible,.halo-companion-route:focus-visible{outline:2px solid var(--hc-agent);outline-offset:2px}
      .halo-companion[hidden],.halo-companion-recall[hidden]{display:none}
      .halo-companion-dismiss{position:absolute;top:-9px;right:-9px;z-index:1;display:grid;place-items:center;width:26px;height:26px;padding:0;border:1px solid rgba(255,255,255,.24);border-radius:50%;background:rgba(9,11,10,.62);color:#d4d7d1;font-size:15px;line-height:1;cursor:pointer;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:border-color .2s,color .2s}.halo-companion-dismiss:hover{border-color:var(--hc-agent);color:var(--hc-agent)}
      .halo-companion-recall{position:fixed;left:18px;bottom:18px;z-index:10020;display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:8px 14px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(12,14,13,.42);color:#e8ece6;font:500 10px/1 "DM Mono","IBM Plex Mono","Space Mono",monospace;letter-spacing:.14em;text-transform:uppercase;opacity:.72;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(14px) saturate(140%);backdrop-filter:blur(14px) saturate(140%);transition:opacity .2s ease,border-color .2s ease}.halo-companion-recall span{color:#d8ff62}.halo-companion-recall:hover,.halo-companion-recall:focus-visible{opacity:1;border-color:#d8ff62}.halo-companion-recall:focus-visible{outline:2px solid #d8ff62;outline-offset:3px}.halo-companion-recall[data-unread="true"]{opacity:1;border-color:#ebc470}
      @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.halo-companion-panel{background:#0a0c0b}.halo-companion-compose{background:#0e110e}.halo-companion-recall{background:rgba(12,14,13,.9)}}
      @media(prefers-reduced-transparency:reduce){.halo-companion-panel{background:#0a0c0b}.halo-companion-compose{background:#0e110e}.halo-companion-launcher{background:#141815}.halo-companion-recall{background:#0c0e0d;opacity:1}}
      .halo-companion-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
      .halo-companion-panel{position:fixed;max-height:calc(100vh - 20px);grid-template-rows:auto auto minmax(0,1fr) auto;overflow-y:auto}
      @media(max-width:600px){.halo-companion,.halo-companion-recall{left:10px;bottom:10px}.halo-companion-launcher{grid-template-columns:42px minmax(0,1fr) 6px;min-height:52px}.halo-companion-launcher-core{width:42px;height:42px}.halo-companion-panel{bottom:64px;width:calc(100vw - 20px);height:min(690px,calc(100vh - 84px))}.halo-companion-title{font-size:22px}.halo-companion-roster{grid-template-columns:repeat(4,1fr)}.halo-companion-agent span:last-child{display:none}.halo-companion-settings-grid{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.halo-companion *,.halo-companion *::before,.halo-companion-recall{animation:none!important;transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  function createShell() {
    const guide = pageGuide();
    const root = document.createElement("aside");
    root.className = "halo-companion";
    root.id = "haloCompanion";
    root.setAttribute("aria-label", "HALO Guide");
    root.innerHTML = `
      <section class="halo-companion-panel" id="haloCompanionPanel" hidden role="dialog" aria-modal="false" aria-labelledby="haloCompanionTitle">
        <header class="halo-companion-head">
          <div><div class="halo-companion-eyebrow">${guide.eyebrow}</div><h2 class="halo-companion-title" id="haloCompanionTitle">Your <em>companion</em> team</h2></div>
          <button class="halo-companion-close" type="button" aria-label="Close HALO Guide">×</button>
        </header>
        <div class="halo-companion-roster" aria-label="AI specialist team"></div>
        <section class="halo-companion-journey" id="haloCompanionJourney" aria-label="HALO artist journey guidance" aria-live="polite">
          <div class="halo-companion-journey-head"><strong>HALO artist journey</strong><span class="halo-companion-journey-badge" id="haloCompanionJourneyBadge">Full-site guidance</span></div>
          <p class="halo-companion-journey-stage" id="haloCompanionJourneyStage">Open the DJ deck to begin journey watch.</p>
          <p class="halo-companion-journey-copy" id="haloCompanionJourneyCopy">HALO can carry stage guidance across the site without changing the deck workflow.</p>
          <button class="halo-companion-journey-action" id="haloCompanionJourneySpeak" type="button">Replay latest guidance</button>
        </section>
        <div class="halo-companion-feed" role="log" aria-live="polite" aria-busy="false" aria-label="HALO Guide conversation"></div>
        <footer class="halo-companion-compose">
          <form class="halo-companion-form">
            <input class="halo-companion-input" maxlength="1000" autocomplete="off" enterkeyhint="send" aria-label="Ask the HALO Guide" placeholder="Ask for guidance…">
            <button class="halo-companion-send" type="submit" aria-label="Send message">↗</button>
          </form>
          <details class="halo-companion-settings">
            <summary>Voice + guidance options</summary>
            <form class="halo-companion-settings-form">
              <label class="halo-companion-setting halo-companion-setting-check"><span>Voice guidance</span><input id="haloCompanionVoiceEnabled" name="haloCompanionVoiceEnabled" type="checkbox"></label>
              <div class="halo-companion-settings-grid">
                <label class="halo-companion-setting"><span>Voice accent</span><select id="haloCompanionVoiceLocale" name="haloCompanionVoiceLocale"><option value="auto">Auto</option><option value="en-US">US English</option><option value="en-GB">UK English</option></select></label>
                <label class="halo-companion-setting"><span>Voice tone</span><select id="haloCompanionVoiceStyle" name="haloCompanionVoiceStyle"><option value="steady">Steady</option><option value="warm">Warm</option><option value="calm">Calm</option><option value="bright">Bright</option></select></label>
                <label class="halo-companion-setting"><span>Guidance detail</span><select id="haloCompanionGuidanceDetail" name="haloCompanionGuidanceDetail"><option value="concise">Concise</option><option value="detailed">Detailed</option></select></label>
                <label class="halo-companion-setting"><span>Prompt mode</span><select id="haloCompanionPromptMode" name="haloCompanionPromptMode"><option value="proactive">Proactive</option><option value="manual">Manual</option></select></label>
                <label class="halo-companion-setting"><span>Guidance scope</span><select id="haloCompanionGuidanceScope" name="haloCompanionGuidanceScope"><option value="full-site">Full-site</option><option value="deck-only">Deck-only</option></select></label>
              </div>
              <p class="halo-companion-settings-status" id="haloCompanionVoiceStatus">Voice available · currently off</p>
            </form>
          </details>
          <div class="halo-companion-foot"><span class="halo-companion-memory">Journey memory on</span><span>AI guidance · Human care available</span></div>
        </footer>
      </section>
      <button class="halo-companion-launcher" type="button" aria-expanded="false" aria-controls="haloCompanionPanel" aria-label="Open HALO Guide">
        <span class="halo-companion-launcher-core">${AGENTS[state.agent].glyph}</span>
        <span class="halo-companion-unread" hidden aria-hidden="true">0</span>
        <span class="halo-companion-launcher-copy"><strong>✦ ASK HALO</strong><span>HALO GUIDE · 4 SPECIALISTS</span></span>
        <span class="halo-companion-status" aria-hidden="true"></span>
      </button>
      <button class="halo-companion-dismiss" type="button" aria-label="Minimize HALO Guide" title="Minimize">–</button>
      <span class="halo-companion-sr" id="haloCompanionDragHint">Drag to reposition, or use arrow keys while this button is focused.</span>
      <span class="halo-companion-sr" role="status" aria-live="polite"></span>`;
    document.body.appendChild(root);
    return root;
  }

  function createRecall() {
    const recall = document.createElement("button");
    recall.className = "halo-companion-recall";
    recall.type = "button";
    recall.hidden = true;
    recall.setAttribute("aria-controls", "haloCompanion");
    recall.setAttribute("aria-label", "Call HALO: restore the HALO Guide");
    recall.innerHTML = `<span aria-hidden="true">✦</span>Call HALO`;
    document.body.appendChild(recall);
    return recall;
  }

  function setupGuideDrag(root) {
    const launcher = root.querySelector(".halo-companion-launcher");
    const panel = root.querySelector(".halo-companion-panel");
    let position = null;
    let drag = null;
    let suppressClick = false;
    launcher.setAttribute("aria-describedby", "haloCompanionDragHint");

    const clamp = (value, size, limit) => {
      const margin = Math.min(10, Math.max(0, (limit - size) / 2));
      return Math.max(margin, Math.min(value, limit - size - margin));
    };
    const placePanel = () => {
      if (panel.hidden) return;
      const rect = launcher.getBoundingClientRect();
      const top = rect.top >= panel.offsetHeight + 24
        ? rect.top - panel.offsetHeight - 14
        : rect.bottom + 14;
      panel.style.left = `${clamp(rect.left, panel.offsetWidth, window.innerWidth)}px`;
      panel.style.top = `${clamp(top, panel.offsetHeight, window.innerHeight)}px`;
      panel.style.bottom = "auto";
    };
    const place = (x, y) => {
      const rect = launcher.getBoundingClientRect();
      position = {
        x: clamp(x, rect.width, window.innerWidth),
        y: clamp(y, rect.height, window.innerHeight)
      };
      root.style.left = `${position.x}px`;
      root.style.top = `${position.y}px`;
      root.style.bottom = "auto";
      placePanel();
    };
    const stop = event => {
      if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
      const id = drag.id;
      drag = null;
      launcher.dataset.dragging = "false";
      if (launcher.hasPointerCapture(id)) launcher.releasePointerCapture(id);
    };

    launcher.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !event.isPrimary || drag) return;
      const rect = launcher.getBoundingClientRect();
      suppressClick = false;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      launcher.setPointerCapture(event.pointerId);
    });
    launcher.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (!suppressClick && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
      suppressClick = true;
      launcher.dataset.dragging = "true";
      place(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      launcher.addEventListener(type, stop);
    }
    launcher.addEventListener("click", event => {
      if (suppressClick && event.detail !== 0) event.preventDefault();
    }, true);
    launcher.addEventListener("keydown", event => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const rect = launcher.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 10;
      place(rect.left + delta[0] * step, rect.top + delta[1] * step);
    });
    const resize = () => {
      if (root.hidden) return;
      const rect = launcher.getBoundingClientRect();
      place(position?.x ?? rect.left, position?.y ?? rect.top);
    };
    window.addEventListener("resize", resize);
    window.addEventListener("blur", () => stop());
    const observer = new ResizeObserver(resize);
    observer.observe(launcher);
    observer.observe(panel);
    resize();
    return placePanel;
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

  function scrollFeed(feed) {
    const top = feed.scrollHeight;
    if (typeof feed.scrollTo === "function") feed.scrollTo({ top, behavior: reduceMotion?.matches ? "auto" : "smooth" });
    else feed.scrollTop = top;
  }

  function updateUnread() {
    const launcher = root.querySelector(".halo-companion-launcher");
    const badge = root.querySelector(".halo-companion-unread");
    const count = state.unread;
    badge.hidden = count === 0;
    badge.textContent = count > 9 ? "9+" : String(count);
    launcher.dataset.unread = String(count > 0);
    recall.dataset.unread = String(count > 0);
    launcher.setAttribute("aria-label", count ? `Open HALO Guide, ${count} new ${count === 1 ? "reply" : "replies"}` : "Open HALO Guide");
    launcher.querySelector(".halo-companion-launcher-copy span").textContent = count ? `${count} new ${count === 1 ? "reply" : "replies"}` : "HALO GUIDE · 4 SPECIALISTS";
  }

  function noteUnread(agent) {
    if (state.open) return;
    state.unread += 1;
    updateUnread();
    root.querySelector('.halo-companion-sr[role="status"]').textContent = `New HALO Guide reply from ${agent.name}.`;
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
    if (role === "assistant") {
      const voiceAction = document.createElement("button");
      voiceAction.type = "button";
      voiceAction.className = "halo-companion-voice-action";
      voiceAction.textContent = "Speak";
      voiceAction.disabled = !voiceSupported() || !state.settings.voiceEnabled;
      voiceAction.addEventListener("click", () => speakText(text));
      message.appendChild(voiceAction);
    }
    feed.appendChild(message);
    scrollFeed(feed);
    if (role === "assistant" && !options.initial) noteUnread(agent);
    if (role === "assistant" && options.speak && state.settings.promptMode === "proactive") speakText(text);
  }

  function showThinking(show) {
    const feed = root.querySelector(".halo-companion-feed");
    feed.querySelector(".halo-companion-thinking")?.remove();
    feed.setAttribute("aria-busy", String(show));
    if (!show) return;
    const thinking = document.createElement("div");
    thinking.className = "halo-companion-thinking";
    thinking.textContent = "HALO Guide is listening";
    feed.appendChild(thinking);
    scrollFeed(feed);
  }

  async function sendMessage(rawMessage) {
    const message = String(rawMessage || "").trim();
    if (!message || state.busy) return;
    state.busy = true;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    const input = root.querySelector(".halo-companion-input");
    const send = root.querySelector(".halo-companion-send");
    const focusWasInside = root.contains(document.activeElement);
    input.value = "";
    send.disabled = true;
    cancelSpeech();
    addMessage("visitor", message);
    showThinking(true);
    window.haloStats?.track("companion_message_sent", { path: location.pathname, activeAgent: state.agent });
    try {
      const response = await fetch("/api/halo-companion", {
        method: "POST",
        signal: controller?.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          message,
          path: `${location.pathname}${location.hash}`,
          title: document.title,
          companionOptions: {
            voiceStyle: state.settings.voiceStyle,
            guidanceDetail: state.settings.guidanceDetail,
            promptMode: state.settings.promptMode,
            guidanceScope: state.settings.guidanceScope
          }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The companion team could not respond.");
      showThinking(false);
      setAgent(data.agent?.id || "nova");
      addMessage("assistant", data.reply, { agent: data.agent?.id, suggestions: data.suggestions, route: data.route, speak: true });
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
      const copy = error?.name === "AbortError"
        ? "The HALO Guide is taking too long to answer. Please try again in a moment."
        : error?.message || "The companion team is reconnecting. Please try again.";
      addMessage("assistant", copy, { agent: "sol", suggestions: ["Try again", "I need a human"] });
    } finally {
      clearTimeout(timeout);
      state.busy = false;
      send.disabled = false;
      if (state.open && (focusWasInside || root.contains(document.activeElement))) input.focus();
    }
  }

  function setupDismissRecall(root, recall, close) {
    const launcher = root.querySelector(".halo-companion-launcher");
    const remember = dismissed => {
      try {
        if (dismissed) localStorage.setItem(DISMISSED_KEY, "1");
        else localStorage.removeItem(DISMISSED_KEY);
      } catch {}
    };
    const setDismissed = (dismissed, { focus = true, persist = true } = {}) => {
      if (dismissed) close();
      root.hidden = dismissed;
      recall.hidden = !dismissed;
      if (persist) remember(dismissed);
      if (focus) (dismissed ? recall : launcher).focus();
    };
    root.querySelector(".halo-companion-dismiss").addEventListener("click", () => setDismissed(true));
    recall.addEventListener("click", () => setDismissed(false));
    let stored = false;
    try {
      stored = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {}
    if (stored) setDismissed(true, { focus: false, persist: false });
    return setDismissed;
  }

  function toggle(open = !state.open) {
    const panel = root.querySelector(".halo-companion-panel");
    const launcher = root.querySelector(".halo-companion-launcher");
    const focusInside = panel.contains(document.activeElement);
    state.open = open;
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      placeGuidePanel();
      state.unread = 0;
      updateUnread();
      root.querySelector(".halo-companion-input").focus();
      scrollFeed(root.querySelector(".halo-companion-feed"));
      window.haloStats?.track("companion_opened", { path: location.pathname });
    } else if (focusInside) {
      launcher.focus();
    }
  }

  injectStyles();
  const root = createShell();
  const recall = createRecall();
  const placeGuidePanel = setupGuideDrag(root);
  renderRoster();
  setAgent(state.agent);
  state.lastJourneySignature = guidanceSignature(state.journey);
  updateSettingsDock();
  setupDismissRecall(root, recall, () => {
    toggle(false);
    cancelSpeech();
  });
  const guide = pageGuide();
  addMessage("assistant", guide.welcome, { agent: state.agent, suggestions: guide.prompts, initial: true });

  root.querySelector(".halo-companion-launcher").addEventListener("click", event => {
    if (!event.defaultPrevented) toggle();
  });
  root.querySelector(".halo-companion-close").addEventListener("click", () => toggle(false));
  root.querySelector(".halo-companion-form").addEventListener("submit", event => {
    event.preventDefault();
    sendMessage(root.querySelector(".halo-companion-input").value);
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !state.open || event.defaultPrevented || !root.contains(document.activeElement)) return;
    toggle(false);
  });
  root.querySelector(".halo-companion-settings-form").addEventListener("input", event => {
    const form = event.currentTarget;
    applySettings({
      voiceEnabled: form.elements.haloCompanionVoiceEnabled.checked,
      voiceStyle: form.elements.haloCompanionVoiceStyle.value,
      voiceLocale: form.elements.haloCompanionVoiceLocale.value,
      guidanceDetail: form.elements.haloCompanionGuidanceDetail.value,
      promptMode: form.elements.haloCompanionPromptMode.value,
      guidanceScope: form.elements.haloCompanionGuidanceScope.value
    });
  });
  root.querySelector("#haloCompanionJourneySpeak").addEventListener("click", () => {
    speakText(journeyVoiceCopy());
  });
  window.addEventListener("halo:artist-journey-update", event => {
    handleJourneyUpdate(event.detail);
  });
  window.addEventListener("storage", event => {
    if (event.key === JOURNEY_STATE_KEY) {
      if (!event.newValue) {
        handleJourneyUpdate(null);
        return;
      }
      try {
        handleJourneyUpdate(JSON.parse(event.newValue));
      } catch {
        handleJourneyUpdate(null);
      }
      return;
    }
    if (event.key === SETTINGS_KEY) {
      if (!event.newValue) {
        applySettings(DEFAULT_SETTINGS);
        return;
      }
      try {
        applySettings(JSON.parse(event.newValue));
      } catch {
        applySettings(DEFAULT_SETTINGS);
      }
    }
  });
  loadVoiceModule().then(module => {
    updateSettingsDock();
    if (module?.browserSupported()) module.ready().then(() => updateSettingsDock());
  });
})();
