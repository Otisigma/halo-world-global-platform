(() => {
  const app = document.getElementById("app");
  const accountButton = document.getElementById("accountButton");
  const authDialog = document.getElementById("authDialog");
  const state = { user: null, sources: [], briefs: [], selected: new Set(), activeBrief: null, authMode: "login" };
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const formatDate = value => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));

  async function api(method = "GET", body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/youtube-source-studio", {
        method, credentials: "same-origin", signal: controller.signal,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The YouTube Source Box could not complete that request.");
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("The request timed out. Please try again.");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function authGate() {
    app.innerHTML = `<section class="auth-gate"><span class="eyebrow">YOUTUBE SOURCE BOX / PRIVATE</span><h1>One box.<br>Every source.</h1><p>Sign in to save channel, playlist, Short, and video links in one private campaign workspace.</p><div><button class="button" type="button" data-open-auth>Sign in to open the box</button></div></section>`;
  }

  function sourceCard(source) {
    return `<article class="source-card"><input type="checkbox" aria-label="Use ${escapeHtml(source.label)} in campaign" data-source-choice value="${source.id}" ${state.selected.has(source.id) ? "checked" : ""}><span class="type">${escapeHtml(source.sourceType)} / source</span><h3>${escapeHtml(source.label)}</h3><p>${escapeHtml(source.notes || "Saved and ready to assign to a campaign brief.")}</p><div class="source-actions"><a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noreferrer">Open on YouTube ↗</a><button class="remove-source" type="button" data-remove-source="${source.id}">Remove</button></div></article>`;
  }

  function renderBrief(brief) {
    if (!brief?.brief) return "";
    const data = brief.brief;
    return `<section class="latest-brief" id="latestBrief"><header class="brief-header"><div><span class="eyebrow">CAMPAIGN PACKAGE / ${escapeHtml(brief.model)}</span><h2>${escapeHtml(brief.title)}</h2></div><a href="${escapeHtml(brief.channelUrl)}" target="_blank" rel="noreferrer">Open destination channel ↗</a></header><p class="north-star">${escapeHtml(data.northStar)}</p><div class="concept-grid">${(data.shortConcepts || []).map((concept, index) => `<article class="concept"><span>Short ${String(index + 1).padStart(2, "0")} / ${escapeHtml(concept.sourceLabel)}</span><h3>${escapeHtml(concept.title)}</h3><small>${escapeHtml(concept.duration)}</small><dl><dt>Opening</dt><dd>${escapeHtml(concept.opening)}</dd><dt>Cut plan</dt><dd>${escapeHtml(concept.cutPlan)}</dd><dt>Caption</dt><dd>${escapeHtml(concept.caption)}</dd></dl></article>`).join("")}</div><div class="brief-lists"><div><h3>Deliverables</h3><ul>${(data.deliverables || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div><h3>Publishing sequence</h3><ol>${(data.publishingSequence || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol></div><div><h3>Guardrails</h3><ul>${(data.guardrails || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div></section>`;
  }

  function renderWorkspace() {
    const selectedCount = state.selected.size;
    app.innerHTML = `<section class="hero"><div class="hero-copy"><div><span class="eyebrow">YOUTUBE / CAMPAIGN SOURCE SYSTEM</span><h1>Load it.<br><em>Shape it.</em><br>Send it.</h1></div><p>Drop in the channel, every playlist, or individual videos. Keep the source material organized, then turn the right pieces into a connected Shorts campaign that always leads people back to YouTube.</p></div><aside class="hero-index"><strong>${String(state.sources.length).padStart(2, "0")}</strong><span>Saved source links<br>${selectedCount} selected for the next brief</span></aside></section>
      <section class="workspace"><div class="intake"><div class="section-head"><div><span class="eyebrow">01 / LOAD THE BOX</span><h2>Paste the library.</h2></div></div><form id="sourceForm"><label>Channel destination<input name="channelUrl" type="url" placeholder="https://youtube.com/@yourchannel"></label><label>Source links<textarea name="sourceLines" required placeholder="Main channel | https://youtube.com/@yourchannel\nBest performances | https://youtube.com/playlist?list=...\nCampaign video | https://youtu.be/..."></textarea></label><p class="form-hint">Add one item per line. Use <strong>Label | URL</strong>, or paste a raw YouTube URL. Up to 50 links at once.</p><label>Shared campaign notes<textarea name="notes" maxlength="1200" placeholder="What matters in these sources? Key themes, moments, permissions, or instructions for the campaign."></textarea></label><p class="form-message" id="sourceMessage" role="status"></p><button class="button" type="submit">Save sources</button></form></div><div class="library"><div class="section-head"><div><span class="eyebrow">02 / SOURCE LIBRARY</span><h2>Select what the campaign needs.</h2></div><div class="section-count">${selectedCount}</div></div><div class="source-list">${state.sources.length ? state.sources.map(sourceCard).join("") : '<div class="empty-card">The box is empty. Paste a channel, playlist, Short, or video link to begin. This workspace stores the links and your notes; it does not claim to watch or transcribe material automatically.</div>'}</div></div></section>
      <section class="brief-builder"><div class="brief-intro"><span class="eyebrow">03 / CAMPAIGN DIRECTION</span><h2>Give every clip a job.</h2><p>Select the saved sources that matter, name the outcome, and create a production-ready set of Shorts concepts. The brief maps each idea to a source instead of making up material that is not in your library.</p></div><form class="brief-form" id="briefForm"><label>Campaign title<input name="title" maxlength="160" value="YouTube Shorts campaign" required></label><label>Channel link every asset promotes<input name="channelUrl" type="url" value="${escapeHtml(state.sources.find(source => source.channelUrl)?.channelUrl || state.sources.find(source => source.sourceType === "channel")?.sourceUrl || "")}" placeholder="https://youtube.com/@yourchannel" required></label><label>Who should this reach?<input name="audience" maxlength="300" placeholder="Existing listeners, new fans, DJs, collaborators..."></label><label>What should the campaign accomplish?<textarea name="campaignGoal" maxlength="600" required placeholder="Use the strongest moments across these playlists to make a sequence of Shorts that introduces the artist world and drives people into the full channel."></textarea></label><p class="form-message" id="briefMessage" role="status"></p><button class="button button-dark" type="submit" ${selectedCount ? "" : "disabled"}>Create Shorts campaign brief</button></form></section>
      ${renderBrief(state.activeBrief)}
      ${state.briefs.length ? `<section class="archive"><div class="section-head"><div><span class="eyebrow">CAMPAIGN ARCHIVE</span><h2>Previous briefs.</h2></div></div><div class="archive-grid">${state.briefs.map(brief => `<article class="archive-card" data-open-brief="${brief.id}" tabindex="0"><span>${escapeHtml(formatDate(brief.createdAt))}</span><strong>${escapeHtml(brief.title)}</strong><small>${escapeHtml(brief.campaignGoal)}</small></article>`).join("")}</div></section>` : ""}`;
  }

  async function loadWorkspace() {
    try {
      const data = await api();
      state.sources = data.sources || [];
      state.briefs = data.briefs || [];
      state.activeBrief = state.briefs[0] || null;
      renderWorkspace();
    } catch (error) {
      if (!state.user) authGate();
      else app.innerHTML = `<section class="auth-gate"><span class="eyebrow">SOURCE BOX / OFFLINE</span><h1>Signal paused.</h1><p>${escapeHtml(error.message)}</p><button class="button" type="button" data-retry>Try again</button></section>`;
    }
  }

  function parseSourceLines(value) {
    return value.split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, 50).map((line, index) => {
      const divider = line.indexOf("|");
      if (divider < 0) return { label: `YouTube source ${index + 1}`, url: line };
      return { label: line.slice(0, divider).trim(), url: line.slice(divider + 1).trim() };
    });
  }

  app.addEventListener("click", async event => {
    if (event.target.closest("[data-open-auth]")) return authDialog.showModal();
    if (event.target.closest("[data-retry]")) return loadWorkspace();
    const removeButton = event.target.closest("[data-remove-source]");
    if (removeButton) {
      removeButton.disabled = true;
      try {
        await api("POST", { action: "remove_source", sourceId: removeButton.dataset.removeSource });
        state.sources = state.sources.filter(source => source.id !== removeButton.dataset.removeSource);
        state.selected.delete(removeButton.dataset.removeSource);
        renderWorkspace();
      } catch (error) { removeButton.textContent = error.message; }
      return;
    }
    const archiveCard = event.target.closest("[data-open-brief]");
    if (archiveCard) {
      state.activeBrief = state.briefs.find(brief => brief.id === archiveCard.dataset.openBrief) || state.activeBrief;
      renderWorkspace();
      document.getElementById("latestBrief")?.scrollIntoView({ behavior: "smooth" });
    }
  });

  app.addEventListener("change", event => {
    if (!event.target.matches("[data-source-choice]")) return;
    if (event.target.checked) state.selected.add(event.target.value); else state.selected.delete(event.target.value);
    renderWorkspace();
  });

  app.addEventListener("submit", async event => {
    if (event.target.id === "sourceForm") {
      event.preventDefault();
      const data = new FormData(event.target);
      const message = document.getElementById("sourceMessage");
      const button = event.target.querySelector("button[type=submit]");
      button.disabled = true; message.textContent = "Saving the source library…";
      try {
        await api("POST", { action: "add_sources", channelUrl: data.get("channelUrl"), notes: data.get("notes"), sources: parseSourceLines(String(data.get("sourceLines") || "")) });
        await loadWorkspace();
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    }
    if (event.target.id === "briefForm") {
      event.preventDefault();
      const data = new FormData(event.target);
      const message = document.getElementById("briefMessage");
      const button = event.target.querySelector("button[type=submit]");
      button.disabled = true; message.textContent = "Mapping sources into a Shorts campaign…";
      try {
        const response = await api("POST", { action: "generate_brief", sourceIds: [...state.selected], title: data.get("title"), channelUrl: data.get("channelUrl"), audience: data.get("audience"), campaignGoal: data.get("campaignGoal") });
        state.activeBrief = response.campaignBrief;
        state.briefs.unshift(response.campaignBrief);
        renderWorkspace();
        document.getElementById("latestBrief")?.scrollIntoView({ behavior: "smooth" });
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    }
  });

  function setAuthMode(mode) {
    state.authMode = mode;
    document.querySelectorAll("[data-auth-mode]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.authMode === mode)));
    document.getElementById("nameField").hidden = mode !== "signup";
    document.getElementById("authTitle").textContent = mode === "signup" ? "Join the private workspace." : "Sign in to load sources.";
    document.getElementById("authSubmit").textContent = mode === "signup" ? "Create account" : "Sign in";
  }

  document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  authDialog.addEventListener("click", event => { if (event.target.matches("[data-close]")) authDialog.close(); });
  document.getElementById("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = document.getElementById("authMessage");
    const email = document.getElementById("authEmail").value;
    const password = document.getElementById("authPassword").value;
    message.textContent = state.authMode === "signup" ? "Creating membership…" : "Signing in…";
    try {
      if (state.authMode === "signup") await window.haloIdentity.signup(email, password, { full_name: document.getElementById("authName").value });
      else await window.haloIdentity.login(email, password);
      state.user = await window.haloIdentity.getUser();
      accountButton.textContent = state.user?.user_metadata?.full_name || state.user?.email || "Team account";
      authDialog.close(); await loadWorkspace();
    } catch (error) { message.textContent = error.message || "Membership access could not be completed."; }
  });

  accountButton.addEventListener("click", async () => {
    if (!state.user) return authDialog.showModal();
    await window.haloIdentity.logout(); state.user = null; state.sources = []; state.briefs = []; state.selected.clear(); accountButton.textContent = "Team sign in"; authGate();
  });

  async function initialize() {
    state.user = await window.haloIdentity.getUser().catch(() => null);
    accountButton.textContent = state.user?.user_metadata?.full_name || state.user?.email || "Team sign in";
    if (state.user) loadWorkspace(); else authGate();
  }
  window.addEventListener("halo-identity-ready", initialize, { once: true });
  if (window.haloIdentity) initialize();
})();
