(() => {
  if (window.__haloJournalLoaded) return;
  window.__haloJournalLoaded = true;

  const SESSION_KEY = "halo-companion-journey";
  const MONITORING_KEY = "halo-journal-monitoring";
  const QUEUE_KEY = "halo-journal-pending";
  const MAX_QUEUE = 80;
  const state = {
    open: false,
    authorized: false,
    authorizing: false,
    loading: false,
    sending: false,
    monitoring: readMonitoringPreference(),
    sessionId: getSessionId(),
    queue: readQueue(),
    sliderTimers: new WeakMap(),
    data: null
  };
  let root = null;

  function getSessionId() {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (/^[a-zA-Z0-9_-]{16,64}$/.test(stored || "")) return stored;
      const randomPart = crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const generated = `journey_${randomPart}`.slice(0, 64);
      localStorage.setItem(SESSION_KEY, generated);
      return generated;
    } catch {
      return `journey_${Date.now()}_${Math.random().toString(36).slice(2)}`.slice(0, 64);
    }
  }

  function readMonitoringPreference() {
    try {
      return localStorage.getItem(MONITORING_KEY) !== "paused";
    } catch {
      return true;
    }
  }

  function readQueue() {
    try {
      const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
    } catch {
      return [];
    }
  }

  function persistQueue() {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue.slice(-MAX_QUEUE)));
    } catch {}
  }

  function eventKey() {
    const randomPart = crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : Math.random().toString(36).slice(2);
    return `journal_${Date.now().toString(36)}_${randomPart}`.slice(0, 96);
  }

  function safeLabel(element) {
    if (!(element instanceof Element)) return "";
    const explicit = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("name");
    const visible = element instanceof HTMLInputElement && !["button", "submit", "reset", "checkbox", "radio", "range"].includes(element.type)
      ? ""
      : element.textContent;
    return String(explicit || visible || element.id || element.tagName).trim().replace(/\s+/g, " ").slice(0, 120);
  }

  function record(eventType, options = {}) {
    if (!state.authorized || (!state.monitoring && !options.force)) return;
    state.queue.push({
      eventKey: eventKey(),
      eventType,
      category: options.category || "activity",
      pagePath: `${location.pathname}${location.hash}`.slice(0, 180),
      targetName: String(options.targetName || "").slice(0, 120),
      details: options.details || {},
      occurredAt: new Date().toISOString()
    });
    state.queue = state.queue.slice(-MAX_QUEUE);
    persistQueue();
    updateLauncher();
    if (options.immediate || state.queue.length >= 12) flush();
  }

  async function flush(useBeacon = false) {
    if (state.sending || !state.queue.length) return;
    const batch = state.queue.slice(0, 30);
    const body = JSON.stringify({ action: "events", sessionId: state.sessionId, events: batch });
    if (useBeacon && navigator.sendBeacon) {
      const sent = navigator.sendBeacon("/api/halo-journal", new Blob([body], { type: "application/json" }));
      if (sent) {
        state.queue.splice(0, batch.length);
        persistQueue();
      }
      return;
    }
    state.sending = true;
    try {
      const response = await fetch("/api/halo-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Journal sync failed");
      state.queue.splice(0, batch.length);
      persistQueue();
      if (result.insight) {
        state.data = state.data || {};
        state.data.insights = [result.insight, ...(state.data.insights || [])];
        announceAdvice(result.insight);
      }
      if (state.queue.length) setTimeout(flush, 250);
    } catch {
      updateStatus("Memory waiting for connection", "waiting");
    } finally {
      state.sending = false;
      updateLauncher();
    }
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes halo-journal-enter{from{opacity:0;transform:translateY(16px) rotate(.4deg)}to{opacity:1;transform:translateY(0) rotate(0)}}
      .halo-journal{--hj-ink:#25241f;--hj-paper:#eee8d7;--hj-red:#a64e3f;--hj-moss:#52604d;position:fixed;right:18px;bottom:76px;z-index:10019;font-family:"Courier Prime","IBM Plex Mono",monospace;color:var(--hj-ink);line-height:1.45}
      .halo-journal *{box-sizing:border-box}.halo-journal button,.halo-journal textarea{font:inherit}.halo-journal-launcher{display:flex;align-items:center;gap:9px;min-height:42px;padding:9px 14px;border:1px solid rgba(238,232,215,.38);border-radius:3px;background:#292a25;color:#f4efdf;box-shadow:5px 7px 0 rgba(0,0,0,.22);cursor:pointer;text-transform:uppercase;letter-spacing:.12em;font-size:11px;transition:transform .18s ease,box-shadow .18s ease}.halo-journal-launcher:hover{transform:translate(-2px,-2px);box-shadow:7px 9px 0 rgba(0,0,0,.22)}.halo-journal-launcher:focus-visible,.halo-journal button:focus-visible,.halo-journal textarea:focus-visible{outline:3px solid #d28b55;outline-offset:3px}.halo-journal-pulse{width:8px;height:8px;border-radius:50%;background:#92a56f;box-shadow:0 0 0 4px rgba(146,165,111,.15)}.halo-journal-launcher[data-state="paused"] .halo-journal-pulse{background:#9e9484}.halo-journal-launcher[data-state="attention"] .halo-journal-pulse{background:#d47858}
      .halo-journal-panel{position:absolute;right:0;bottom:54px;width:min(430px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 100px));overflow:auto;border:1px solid #c8bea5;border-radius:2px;background:linear-gradient(rgba(82,96,77,.055) 1px,transparent 1px),var(--hj-paper);background-size:100% 27px;box-shadow:12px 16px 0 rgba(0,0,0,.25);animation:halo-journal-enter .24s ease both}.halo-journal-panel[hidden]{display:none}.halo-journal-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:18px;padding:19px 20px 14px;border-bottom:2px solid var(--hj-ink);background:rgba(238,232,215,.97)}.halo-journal-kicker{display:block;color:var(--hj-red);font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.halo-journal-head h2{margin:3px 0 0;font-family:Georgia,"Times New Roman",serif;font-size:28px;font-weight:500;letter-spacing:-.03em}.halo-journal-close{align-self:flex-start;border:0;background:transparent;color:var(--hj-ink);font-size:25px;cursor:pointer}.halo-journal-body{padding:18px 20px 24px}.halo-journal-privacy{margin:0 0 17px;padding:10px 12px;border-left:3px solid var(--hj-moss);background:rgba(255,255,255,.37);font-size:11px}.halo-journal-status{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:18px;font-size:11px}.halo-journal-switch{border:1px solid var(--hj-ink);border-radius:2px;background:transparent;padding:6px 9px;cursor:pointer;font-weight:700}.halo-journal-switch[data-active="true"]{background:var(--hj-moss);color:#fff}.halo-journal-section{margin:0 0 20px}.halo-journal-section-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 9px;padding-bottom:5px;border-bottom:1px solid rgba(37,36,31,.35);font-size:10px;text-transform:uppercase;letter-spacing:.16em}.halo-journal-memory,.halo-journal-insight{padding:13px;border:1px solid rgba(37,36,31,.3);background:rgba(255,255,255,.46)}.halo-journal-memory p,.halo-journal-insight p{margin:0;font-size:12px}.halo-journal-insight strong{display:block;margin-bottom:7px;font-family:Georgia,"Times New Roman",serif;font-size:19px;font-weight:500}.halo-journal-advice{margin-top:10px!important;padding-top:9px;border-top:1px dashed rgba(37,36,31,.35);color:#5e382f}.halo-journal-actions{display:flex;gap:8px;margin-top:10px}.halo-journal-action{border:1px solid var(--hj-ink);border-radius:2px;background:var(--hj-ink);color:var(--hj-paper);padding:8px 11px;cursor:pointer;font-size:11px}.halo-journal-action[disabled]{opacity:.55;cursor:wait}.halo-journal-action[data-quiet]{background:transparent;color:var(--hj-ink)}.halo-journal-note{width:100%;min-height:74px;resize:vertical;border:1px solid rgba(37,36,31,.45);border-radius:2px;background:rgba(255,255,255,.54);padding:10px;color:var(--hj-ink);font-size:12px}.halo-journal-timeline{display:grid;gap:8px}.halo-journal-entry{display:grid;grid-template-columns:72px 1fr;gap:10px;padding:8px 0;border-bottom:1px dashed rgba(37,36,31,.25);font-size:11px}.halo-journal-entry time{color:#766f62}.halo-journal-entry strong{display:block;font-size:11px}.halo-journal-entry span{color:#665f53}.halo-journal-empty{margin:0;padding:18px;border:1px dashed rgba(37,36,31,.4);text-align:center;font-size:12px}.halo-journal-toast{position:absolute;right:0;bottom:54px;width:min(360px,calc(100vw - 24px));padding:15px;border-left:4px solid var(--hj-red);background:var(--hj-paper);box-shadow:8px 10px 0 rgba(0,0,0,.25);font-size:12px}.halo-journal-toast[hidden]{display:none}.halo-journal-toast strong{display:block;margin-bottom:4px;font-family:Georgia,"Times New Roman",serif;font-size:17px}.halo-journal-skeleton{height:76px;margin-bottom:10px;background:linear-gradient(90deg,rgba(37,36,31,.06),rgba(255,255,255,.42),rgba(37,36,31,.06));background-size:220% 100%;animation:halo-journal-shimmer 1.3s linear infinite}@keyframes halo-journal-shimmer{to{background-position:-220% 0}}
      @media(max-width:640px){.halo-journal{right:12px;bottom:70px}.halo-journal-panel{position:fixed;inset:10px 10px 76px;width:auto;max-height:none}.halo-journal-launcher{font-size:10px}.halo-journal-toast{position:fixed;right:10px;bottom:76px;left:10px;width:auto}}
      @media(prefers-reduced-motion:reduce){.halo-journal-panel{animation:none}.halo-journal-launcher{transition:none}}
    `;
    document.head.appendChild(style);
  }

  function createShell() {
    const root = document.createElement("aside");
    root.className = "halo-journal";
    root.setAttribute("aria-label", "Halo Journal");
    root.innerHTML = `
      <button class="halo-journal-launcher" type="button" aria-expanded="false"><span class="halo-journal-pulse"></span><span>Halo Journal</span></button>
      <section class="halo-journal-panel" aria-label="Halo Journal memory" hidden>
        <header class="halo-journal-head"><div><span class="halo-journal-kicker">Operational memory</span><h2>Halo Journal</h2></div><button class="halo-journal-close" type="button" aria-label="Close Halo Journal">×</button></header>
        <div class="halo-journal-body">
          <p class="halo-journal-privacy">Private to the HALO owner. Records meaningful HALO actions and technical signals, but never passwords, typed field content, payment data, local files, IP addresses, or activity outside HALO.</p>
          <div class="halo-journal-status"><span data-journal-status>Memory ready</span><button class="halo-journal-switch" type="button" aria-pressed="true">Monitoring on</button></div>
          <div class="halo-journal-content"><div class="halo-journal-skeleton"></div><div class="halo-journal-skeleton"></div></div>
        </div>
      </section>
      <div class="halo-journal-toast" role="status" hidden></div>
    `;
    document.body.appendChild(root);
    return root;
  }

  function updateLauncher() {
    const launcher = root.querySelector(".halo-journal-launcher");
    launcher.dataset.state = !state.monitoring ? "paused" : state.queue.length ? "attention" : "ready";
    launcher.querySelector("span:last-child").textContent = state.queue.length ? `Journal · ${state.queue.length} pending` : "Halo Journal";
  }

  function updateStatus(message, status = "ready") {
    const element = root.querySelector("[data-journal-status]");
    if (element) {
      element.textContent = message;
      element.dataset.state = status;
    }
  }

  function displayTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Now" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function eventTitle(event) {
    return String(event.event_type || "activity").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function render() {
    const content = root.querySelector(".halo-journal-content");
    const data = state.data || { profile: null, events: [], insights: [], notes: [] };
    content.replaceChildren();

    const memorySection = document.createElement("section");
    memorySection.className = "halo-journal-section";
    memorySection.innerHTML = `<h3 class="halo-journal-section-title"><span>Long-term memory</span><span>${data.profile?.event_count || 0} signals</span></h3>`;
    const memory = document.createElement("div");
    memory.className = "halo-journal-memory";
    const memoryText = document.createElement("p");
    memoryText.textContent = data.profile?.memory_summary || "The journal is collecting enough context to form its first reliable memory.";
    memory.appendChild(memoryText);
    memorySection.appendChild(memory);
    content.appendChild(memorySection);

    const insightSection = document.createElement("section");
    insightSection.className = "halo-journal-section";
    insightSection.innerHTML = `<h3 class="halo-journal-section-title"><span>Current reflection</span><span>AI-assisted</span></h3>`;
    const insight = data.insights?.[0];
    const insightCard = document.createElement("div");
    insightCard.className = "halo-journal-insight";
    const headline = document.createElement("strong");
    headline.textContent = insight?.headline || "No problem pattern detected";
    const insightText = document.createElement("p");
    insightText.textContent = insight?.insight || "Ask for a reflection after a few actions, or let the journal respond automatically when a problem appears.";
    const advice = document.createElement("p");
    advice.className = "halo-journal-advice";
    advice.textContent = insight?.recommendation || data.profile?.current_advice || "Keep working normally. The journal only interrupts when it has useful evidence.";
    insightCard.append(headline, insightText, advice);
    const reflect = document.createElement("button");
    reflect.type = "button";
    reflect.className = "halo-journal-action";
    reflect.textContent = "Reflect on recent work";
    reflect.addEventListener("click", () => requestReflection(reflect));
    const actions = document.createElement("div");
    actions.className = "halo-journal-actions";
    actions.appendChild(reflect);
    insightSection.append(insightCard, actions);
    content.appendChild(insightSection);

    const noteSection = document.createElement("section");
    noteSection.className = "halo-journal-section";
    noteSection.innerHTML = `<h3 class="halo-journal-section-title"><span>Add context</span><span>Saved intentionally</span></h3>`;
    const note = document.createElement("textarea");
    note.className = "halo-journal-note";
    note.maxLength = 1200;
    note.placeholder = "What are you trying to accomplish, or what went wrong?";
    note.setAttribute("aria-label", "Halo Journal note");
    const save = document.createElement("button");
    save.type = "button";
    save.className = "halo-journal-action";
    save.textContent = "Save note";
    save.addEventListener("click", () => saveNote(note, save));
    const noteActions = document.createElement("div");
    noteActions.className = "halo-journal-actions";
    noteActions.appendChild(save);
    noteSection.append(note, noteActions);
    content.appendChild(noteSection);

    const timelineSection = document.createElement("section");
    timelineSection.className = "halo-journal-section";
    timelineSection.innerHTML = `<h3 class="halo-journal-section-title"><span>Recent timeline</span><span>${data.scope === "member" ? "Account memory" : "This browser"}</span></h3>`;
    const timeline = document.createElement("div");
    timeline.className = "halo-journal-timeline";
    const entries = data.events?.slice(0, 16) || [];
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "halo-journal-empty";
      empty.textContent = "Meaningful actions appear here as you use HALO.";
      timeline.appendChild(empty);
    } else {
      entries.forEach(event => {
        const entry = document.createElement("article");
        entry.className = "halo-journal-entry";
        const time = document.createElement("time");
        time.dateTime = event.occurred_at;
        time.textContent = displayTime(event.occurred_at);
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = eventTitle(event);
        const detail = document.createElement("span");
        detail.textContent = event.target_name || event.page_path || "HALO activity";
        copy.append(title, detail);
        entry.append(time, copy);
        timeline.appendChild(entry);
      });
    }
    timelineSection.appendChild(timeline);
    content.appendChild(timelineSection);
  }

  async function loadJournal() {
    if (state.loading) return;
    state.loading = true;
    updateStatus("Reading memory…", "loading");
    try {
      await flush();
      const response = await fetch("/api/halo-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "read", sessionId: state.sessionId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Journal could not load");
      state.data = data;
      render();
      updateStatus("Owner-only memory active");
    } catch (error) {
      updateStatus(error.message || "Journal could not load", "error");
      render();
    } finally {
      state.loading = false;
    }
  }

  async function requestReflection(button) {
    button.disabled = true;
    button.textContent = "Reading the journal…";
    try {
      await flush();
      const response = await fetch("/api/halo-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reflect", sessionId: state.sessionId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Reflection failed");
      state.data = state.data || { profile: null, events: [], insights: [], notes: [] };
      state.data.insights = [data.insight, ...(state.data.insights || [])];
      render();
    } catch (error) {
      updateStatus(error.message || "Reflection could not be created", "error");
      button.disabled = false;
      button.textContent = "Try reflection again";
    }
  }

  async function saveNote(textarea, button) {
    const body = textarea.value.trim();
    if (!body) {
      textarea.focus();
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch("/api/halo-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "note", sessionId: state.sessionId, body })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Note could not be saved");
      textarea.value = "";
      state.data.notes = [data.note, ...(state.data.notes || [])];
      updateStatus("Note saved to long-term memory");
    } catch (error) {
      updateStatus(error.message || "Note could not be saved", "error");
    } finally {
      button.disabled = false;
    }
  }

  function announceAdvice(insight) {
    const toast = root.querySelector(".halo-journal-toast");
    toast.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = insight.headline || "Halo Journal noticed a problem";
    const copy = document.createElement("span");
    copy.textContent = insight.recommendation || "Open Halo Journal for a suggested next step.";
    toast.append(title, copy);
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 9000);
  }

  function toggleMonitoring() {
    state.monitoring = !state.monitoring;
    try {
      localStorage.setItem(MONITORING_KEY, state.monitoring ? "active" : "paused");
    } catch {}
    const button = root.querySelector(".halo-journal-switch");
    button.dataset.active = String(state.monitoring);
    button.setAttribute("aria-pressed", String(state.monitoring));
    button.textContent = state.monitoring ? "Monitoring on" : "Monitoring paused";
    updateStatus(state.monitoring ? "Meaningful activity monitoring resumed" : "Automatic activity monitoring paused");
    updateLauncher();
  }

  function toggle(open = !state.open) {
    state.open = open;
    root.querySelector(".halo-journal-panel").hidden = !open;
    root.querySelector(".halo-journal-launcher").setAttribute("aria-expanded", String(open));
    if (open) loadJournal();
  }

  function bindMonitoring() {
    document.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target.closest("button,a,[role='button'],input[type='checkbox'],input[type='radio']") : null;
      if (!target || target.closest(".halo-journal")) return;
      const isLink = target instanceof HTMLAnchorElement;
      record(isLink ? "navigation" : "control_activated", {
        targetName: safeLabel(target),
        details: { control: target.tagName.toLowerCase(), destination: isLink ? String(target.getAttribute("href") || "").slice(0, 120) : "" }
      });
    }, true);

    document.addEventListener("submit", event => {
      if (event.target instanceof Element && !event.target.closest(".halo-journal")) record("form_submitted", { targetName: safeLabel(event.target), immediate: true });
    }, true);

    document.addEventListener("input", event => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "range" || target.closest(".halo-journal")) return;
      clearTimeout(state.sliderTimers.get(target));
      state.sliderTimers.set(target, setTimeout(() => record("slider_adjusted", {
        targetName: safeLabel(target),
        details: { minimum: target.min, maximum: target.max }
      }), 500));
    }, true);

    document.addEventListener("play", event => {
      if (event.target instanceof HTMLMediaElement) record("media_played", { targetName: safeLabel(event.target), details: { media: event.target.tagName.toLowerCase() } });
    }, true);
    document.addEventListener("pause", event => {
      if (event.target instanceof HTMLMediaElement && !event.target.ended) record("media_paused", { targetName: safeLabel(event.target), details: { media: event.target.tagName.toLowerCase() } });
    }, true);
    document.addEventListener("error", event => {
      if (event.target instanceof HTMLMediaElement) record("media_error", { category: "problem", targetName: safeLabel(event.target), immediate: true });
    }, true);

    window.addEventListener("error", event => record("runtime_error", {
      category: "problem",
      targetName: "Page script",
      details: { source: String(event.filename || "").split("/").pop() || "unknown", line: event.lineno || 0 },
      immediate: true
    }));
    window.addEventListener("unhandledrejection", () => record("unhandled_rejection", { category: "problem", targetName: "Background task", immediate: true }));
    window.addEventListener("offline", () => record("offline", { category: "problem", targetName: "Network connection", immediate: true }));
    window.addEventListener("online", () => { record("online", { targetName: "Network connection", immediate: true }); flush(); });
    window.addEventListener("halo:journal-event", event => {
      const detail = event.detail || {};
      record(detail.eventType || "halo_activity", detail);
    });
    window.addEventListener("pagehide", () => flush(true));
    setInterval(flush, 8000);
  }

  async function authorizeOwner() {
    if (state.authorized || state.authorizing) return;
    state.authorizing = true;
    try {
      const response = await fetch("/api/halo-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "read", sessionId: state.sessionId })
      });
      if (!response.ok) return;
      state.data = await response.json();
      state.authorized = true;
    } catch {
      return;
    } finally {
      state.authorizing = false;
    }

    injectStyles();
    root = createShell();
    root.querySelector(".halo-journal-switch").dataset.active = String(state.monitoring);
    root.querySelector(".halo-journal-switch").setAttribute("aria-pressed", String(state.monitoring));
    root.querySelector(".halo-journal-switch").textContent = state.monitoring ? "Monitoring on" : "Monitoring paused";
    root.querySelector(".halo-journal-launcher").addEventListener("click", () => toggle());
    root.querySelector(".halo-journal-close").addEventListener("click", () => toggle(false));
    root.querySelector(".halo-journal-switch").addEventListener("click", toggleMonitoring);
    document.addEventListener("keydown", event => { if (event.key === "Escape" && state.open) toggle(false); });
    bindMonitoring();
    render();
    updateStatus("Owner-only memory active");
    updateLauncher();
    record("page_viewed", { targetName: document.title || location.pathname, details: { referrer: document.referrer ? "internal_or_external" : "direct" } });
  }

  window.addEventListener("halo-identity-ready", event => {
    event.detail?.onAuthChange?.(user => {
      if (user) authorizeOwner();
    });
    authorizeOwner();
  });
  authorizeOwner();
})();
