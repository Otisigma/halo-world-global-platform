(() => {
  const app = document.getElementById("app");
  const accountButton = document.getElementById("accountButton");
  const authDialog = document.getElementById("authDialog");
  const params = new URLSearchParams(location.search);
  const state = {
    user: null,
    studio: null,
    campaign: null,
    selected: new Set(),
    tracksLoaded: false,
    authMode: "login",
    initialized: false,
    publicSlug: params.get("campaign") || "",
    forceFanView: params.get("view") === "fan",
    preflightId: params.get("preflight") || "",
    requestedPersona: ["halo", "butterfly", "romy"].includes(params.get("persona")) ? params.get("persona") : "halo"
  };

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const formatDate = value => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const formatDuration = seconds => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Preview";
  const shareUrl = campaign => `${location.origin}/campaign-studio/?campaign=${encodeURIComponent(campaign.slug)}&view=fan`;
  const personaName = id => ({ halo: "DJ HALO", butterfly: "DJ BUTTERFLY", romy: "DJ ROMY" }[id] || "DJ HALO");
  const selectOptions = (selected, values) => values.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");

  function withTimeout(promise, message, timeoutMs = 20_000) {
    let timeout;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]).finally(() => clearTimeout(timeout));
  }

  async function api(method, url, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The campaign request could not be completed.");
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("The campaign request timed out. Please try again.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function updateAccount() {
    accountButton.textContent = state.user ? state.user.name || state.user.email || "Team account" : "Team sign in";
  }

  function authGate() {
    app.innerHTML = `<section class="auth-gate"><p class="signal-label">DREAMWEAVER / TEAM ACCESS</p><h1>Build the vote. Keep the release human.</h1><p>Sign in to bring your approved listening-party material into a controlled campaign workspace.</p><div><button class="primary-button" type="button" data-open-auth>Sign in to start</button></div></section>`;
  }

  function studioHero(trackCount) {
    return `<section class="studio-hero"><div class="hero-copy"><p class="signal-label">DREAMWEAVER / FAN CAMPAIGN STUDIO</p><h1>Turn the room into a <em>movement.</em></h1><p>Bring the shortlist into one artist-controlled space and shape a complete fan campaign without exposing the technology behind it.</p></div><aside class="hero-ticket"><span>Available listening tracks</span><strong>${trackCount}</strong><small>Choose up to 20. The latest 14 are selected when the list opens.</small></aside></section>`;
  }

  function renderStudio() {
    if (!state.studio?.authenticated) return authGate();
    const tracks = state.studio.tracks || [];
    const campaigns = state.studio.campaigns || [];
    const deadline = new Date(Date.now() + 7 * 86400000);
    deadline.setMinutes(deadline.getMinutes() - deadline.getTimezoneOffset());
    app.innerHTML = `${studioHero(tracks.length)}
      <section class="studio-shell"><aside class="studio-rail"><p class="signal-label">CAMPAIGN ARCHIVE</p><h2>Your signals.</h2><p>Open a draft, share a live vote, or check the community unlock.</p><div class="campaign-history">
      ${campaigns.length ? campaigns.map(campaign => `<a class="history-card" href="/campaign-studio/?campaign=${encodeURIComponent(campaign.slug)}"><span>${escapeHtml(campaign.status)} / ${campaign.votes} votes</span><strong>${escapeHtml(campaign.title)}</strong><small>${campaign.trackCount} tracks · ends ${escapeHtml(formatDate(campaign.endsAt))}</small></a>`).join("") : '<p class="history-card">No campaigns yet. This first signal starts the archive.</p>'}
      </div></aside><div class="studio-work"><div class="step-heading"><div><p class="signal-label">01 / LOAD THE ROOM</p><h2>Choose the tracks fans hear before they vote.</h2></div><div class="track-count">${state.selected.size}<small>selected</small></div></div>
      ${tracks.length ? `<button class="primary-button" type="button" data-load-tracks>${state.tracksLoaded ? "Reset to latest 14" : "Load listening-party tracks"}</button>
      ${state.tracksLoaded ? `<div class="track-picker">${tracks.map((track, index) => `<label class="picker-track"><input type="checkbox" value="${escapeHtml(track.id)}" data-track-choice ${state.selected.has(track.id) ? "checked" : ""}><span class="picker-number">${String(index + 1).padStart(2, "0")}</span><span class="picker-copy"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.artist)} · ${escapeHtml(track.genre || formatDuration(track.durationSeconds))}</small></span><span class="picker-mark">✓</span></label>`).join("")}</div>
      <form class="campaign-form" id="campaignForm"><label class="wide">Campaign title<input name="title" maxlength="140" value="The First Listening Party" required></label><label class="wide">Invitation line<input name="subtitle" maxlength="240" value="Hear the full shortlist and choose what HALO releases next."></label><label>Host persona<select name="hostPersonaId">${selectOptions(state.requestedPersona, [["halo","DJ HALO · peak hour"],["butterfly","DJ BUTTERFLY · melodic host"],["romy","DJ ROMY · afterhours"]])}</select></label><label>Room atmosphere<select name="atmosphere">${selectOptions("midnight", [["midnight","Midnight signal"],["sunset","Sunset terrace"],["butterfly","Butterfly garden"],["electric","Electric room"]])}</select></label><label>Celebration<select name="celebration">${selectOptions("confetti", [["confetti","Confetti burst"],["streamers","Slow streamers"],["starlight","Starlight"],["none","No celebration"]])}</select></label><label>Motion<select name="motion">${selectOptions("gentle", [["gentle","Gentle"],["full","Full atmosphere"],["reduced","Reduced motion"]])}</select></label><label>Community vote goal<input name="voteGoal" type="number" min="10" max="100000" value="100" required></label><label>Voting closes<input name="endsAt" type="datetime-local" value="${deadline.toISOString().slice(0, 16)}" required></label><label class="wide">Community unlock<input name="rewardTitle" maxlength="140" value="Exclusive 60-minute DJ mix" required></label><label class="wide">Reward note<textarea name="rewardDescription" maxlength="500">Every participating fan receives access when the community reaches the vote goal.</textarea></label><label class="wide">Room note<textarea name="roomNote" maxlength="300">Come early. Hear every song in full. Stay for the reveal.</textarea></label><p class="status-message" id="createMessage"></p><div class="form-actions"><button class="signal-button" type="submit" ${state.selected.size < 2 ? "disabled" : ""}>Build the Dreamweaver campaign</button></div></form>` : ""}` : `<div class="empty-state"><h1>No tracks in the room yet.</h1><p>Add tracks to HALO Radio first, then return here to build the listening-party campaign.</p><a class="primary-button" href="/radio/">Open HALO Radio</a></div>`}
      </div></section>`;
  }

  function renderCampaignEditor() {
    const campaign = state.campaign;
    const promotion = campaign.promotion || {};
    const partyTheme = campaign.partyTheme || {};
    const deadline = new Date(new Date(campaign.endsAt).valueOf() - new Date(campaign.endsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    app.innerHTML = `${studioHero(campaign.tracks.length)}<section class="campaign-editor"><div class="editor-main"><div class="step-heading"><div><p class="signal-label">02 / DREAMWEAVER DRAFT</p><h2>The campaign package is ready for the team.</h2></div><div class="track-count">${campaign.totalVotes}<small>votes</small></div></div>
      <form class="editor-form" id="editorForm"><label class="wide">Campaign title<input name="title" maxlength="140" value="${escapeHtml(campaign.title)}" required></label><label class="wide">Invitation line<input name="subtitle" maxlength="240" value="${escapeHtml(campaign.subtitle)}"></label><label>Host persona<select name="hostPersonaId">${selectOptions(campaign.hostPersonaId || "halo", [["halo","DJ HALO"],["butterfly","DJ BUTTERFLY"],["romy","DJ ROMY"]])}</select></label><label>Room atmosphere<select name="atmosphere">${selectOptions(partyTheme.atmosphere || "midnight", [["midnight","Midnight signal"],["sunset","Sunset terrace"],["butterfly","Butterfly garden"],["electric","Electric room"]])}</select></label><label>Celebration<select name="celebration">${selectOptions(partyTheme.celebration || "confetti", [["confetti","Confetti burst"],["streamers","Slow streamers"],["starlight","Starlight"],["none","No celebration"]])}</select></label><label>Motion<select name="motion">${selectOptions(partyTheme.motion || "gentle", [["gentle","Gentle"],["full","Full atmosphere"],["reduced","Reduced motion"]])}</select></label><label>Vote goal<input name="voteGoal" type="number" min="10" max="100000" value="${campaign.voteGoal}"></label><label>Voting closes<input name="endsAt" type="datetime-local" value="${deadline}"></label><label class="wide">Community unlock<input name="rewardTitle" maxlength="140" value="${escapeHtml(campaign.rewardTitle)}"></label><label class="wide">Reward note<textarea name="rewardDescription" maxlength="500">${escapeHtml(campaign.rewardDescription)}</textarea></label><label class="wide">Room note<textarea name="roomNote" maxlength="300">${escapeHtml(partyTheme.roomNote || "Come early. Hear every song in full. Stay for the reveal.")}</textarea></label><label class="wide">Campaign headline<input name="headline" maxlength="300" value="${escapeHtml(promotion.headline || "")}"></label><label class="wide">Social caption<textarea name="caption" maxlength="2200">${escapeHtml(promotion.caption || "")}</textarea></label><label>Story title<input name="storyTitle" maxlength="300" value="${escapeHtml(promotion.storyTitle || "")}"></label><label>Story subtitle<input name="storySubtitle" maxlength="300" value="${escapeHtml(promotion.storySubtitle || "")}"></label><label>Call to action<input name="callToAction" maxlength="300" value="${escapeHtml(promotion.callToAction || "")}"></label><label>Hashtags<input name="hashtags" maxlength="300" value="${escapeHtml(promotion.hashtags || "")}"></label><p class="status-message" id="editorMessage">${campaign.launchedAt ? `Launch pack live · hosted by ${escapeHtml(personaName(campaign.hostPersonaId))}.` : campaign.status === "published" ? "Live campaign · edits remain available." : "Draft campaign · launch when the team approves."}</p><div class="form-actions"><button class="ghost-button" type="submit">Save edits</button><button class="primary-button" type="button" data-launch>${campaign.launchedAt ? "Update launch pack" : "Create launch pack + go live"}</button></div></form></div>
      <aside class="editor-aside"><p class="signal-label">03 / SHARE KIT</p><h3>Ready to move.</h3><code class="share-url">${escapeHtml(shareUrl(campaign))}</code><div class="mini-card"><small>${escapeHtml(personaName(campaign.hostPersonaId))} / ${escapeHtml(promotion.eyebrow || "HALO LISTENING PARTY")}</small><strong>${escapeHtml(promotion.storyTitle || campaign.title)}</strong><span>${escapeHtml(promotion.callToAction || "Listen. Vote. Unlock.")}</span></div><div class="asset-actions"><button type="button" data-share-party>Share listening party</button><button type="button" data-copy-caption>Copy caption + link</button><button type="button" data-download-card>Download social card</button><button type="button" data-copy-link>Copy voting link</button><a href="${escapeHtml(shareUrl(campaign))}" target="_blank" rel="noopener">Open fan preview</a></div></aside></section>`;
  }

  function renderPublicCampaign() {
    const campaign = state.campaign;
    const promotion = campaign.promotion || {};
    const partyTheme = campaign.partyTheme || {};
    document.body.dataset.partyAtmosphere = partyTheme.atmosphere || "midnight";
    document.body.dataset.partyMotion = partyTheme.motion || "gentle";
    document.documentElement.style.setProperty("--party-accent", partyTheme.accent || "#d5ef5a");
    app.innerHTML = `<div class="party-atmosphere party-${escapeHtml(partyTheme.celebration || "confetti")}" aria-hidden="true">${Array.from({ length: 28 }, (_, index) => `<i style="--i:${index}"></i>`).join("")}</div><section class="vote-hero"><div class="hero-copy"><p class="signal-label">${escapeHtml(personaName(campaign.hostPersonaId))} / ${escapeHtml(promotion.eyebrow || "HALO LISTENING PARTY")}</p><h1>${escapeHtml(promotion.headline || campaign.title)}</h1><p>${escapeHtml(campaign.subtitle)}</p><p class="party-room-note">${escapeHtml(partyTheme.roomNote || "Hear every record. Stay for the reveal.")}</p></div><aside class="vote-progress"><strong>${campaign.totalVotes}</strong><span>of ${campaign.voteGoal} votes · ${campaign.progress}% unlocked</span><div class="progress-bar"><i style="transform:scaleX(${campaign.progress / 100})"></i></div></aside></section>
      <section class="reward-strip"><b>${campaign.rewardUnlocked ? "UNLOCKED" : "THE UNLOCK"}</b><div><strong>${escapeHtml(campaign.rewardTitle)}</strong><br><small>${escapeHtml(campaign.rewardDescription)}</small></div><small>Voting closes ${escapeHtml(formatDate(campaign.endsAt))}</small></section>
      <section class="vote-grid">${campaign.tracks.map(track => `<article class="vote-track ${campaign.viewerVote === track.id ? "is-selected" : ""}"><div class="track-art" ${track.artworkUrl ? `style="background-image:url('${escapeHtml(track.artworkUrl)}')"` : ""}></div><div class="track-content"><span class="track-index">TRACK ${String(track.position).padStart(2, "0")} / ${escapeHtml(track.genre || formatDuration(track.durationSeconds))}</span><h2>${escapeHtml(track.title)}</h2><span class="artist">${escapeHtml(track.artist)}</span><p>${escapeHtml(track.description || "Listen before you choose. Your vote helps decide the next release.")}</p>${track.audioUrl ? `<audio controls preload="none" src="${escapeHtml(track.audioUrl)}"></audio>` : ""}<div class="vote-row"><button class="vote-button" type="button" data-vote="${track.id}" ${campaign.acceptingVotes ? "" : "disabled"}>${campaign.viewerVote === track.id ? "Your vote" : "Vote for this track"}</button><span class="vote-total">${track.votes} ${track.votes === 1 ? "vote" : "votes"}</span></div></div></article>`).join("")}</section><p class="vote-message" id="voteMessage">${campaign.acceptingVotes ? "One vote per fan. You can change your choice before the campaign closes." : "Voting is closed. The final signal remains visible."}</p>`;
  }

  function campaignPayload(form) {
    const data = new FormData(form);
    return { slug: state.campaign.slug, title: data.get("title"), subtitle: data.get("subtitle"), voteGoal: data.get("voteGoal"), endsAt: new Date(data.get("endsAt")).toISOString(), rewardTitle: data.get("rewardTitle"), rewardDescription: data.get("rewardDescription"), hostPersonaId: data.get("hostPersonaId"), preflightId: state.campaign.preflightId || state.preflightId, partyTheme: { atmosphere: data.get("atmosphere"), celebration: data.get("celebration"), motion: data.get("motion"), accent: state.campaign.partyTheme?.accent || "#d5ef5a", roomNote: data.get("roomNote") }, promotion: { eyebrow: state.campaign.promotion?.eyebrow || "HALO LISTENING PARTY", headline: data.get("headline"), caption: data.get("caption"), storyTitle: data.get("storyTitle"), storySubtitle: data.get("storySubtitle"), callToAction: data.get("callToAction"), hashtags: data.get("hashtags") } };
  }

  async function loadStudio() {
    try { state.studio = await api("GET", "/api/fan-campaigns"); renderStudio(); }
    catch (error) { app.innerHTML = `<section class="empty-state"><p class="signal-label">SIGNAL INTERRUPTED</p><h1>The studio could not open.</h1><p>${escapeHtml(error.message)}</p></section>`; }
  }

  async function loadPublicCampaign() {
    try {
      const data = await api("GET", `/api/fan-campaigns?slug=${encodeURIComponent(state.publicSlug)}`);
      state.campaign = data.campaign;
      const savedVote = Number(localStorage.getItem(`halo-fan-vote:${state.campaign.slug}`));
      if (!state.campaign.viewerVote && state.campaign.tracks.some(track => track.id === savedVote)) state.campaign.viewerVote = savedVote;
      if (state.campaign.owner && state.user && !state.forceFanView) renderCampaignEditor(); else renderPublicCampaign();
      document.title = `${state.campaign.title} — HALO Fan Vote`;
    } catch (error) { app.innerHTML = `<section class="empty-state"><p class="signal-label">CAMPAIGN NOT FOUND</p><h1>This signal is off air.</h1><p>${escapeHtml(error.message)}</p><a href="/campaign-studio/">Open Dreamweaver Studio</a></section>`; }
  }

  async function initializeIdentity() {
    if (state.initialized) return;
    state.initialized = true;
    state.user = await window.haloIdentity.getUser().catch(() => null);
    updateAccount();
    if (state.publicSlug) loadPublicCampaign(); else loadStudio();
    window.haloIdentity.onAuthChange((_event, user) => { state.user = user; updateAccount(); });
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const signup = mode === "signup";
    document.getElementById("authTitle").textContent = signup ? "Join HALO to build." : "Sign in to build.";
    document.getElementById("authSubmit").textContent = signup ? "Join and open studio" : "Sign in";
    document.getElementById("authNameField").hidden = !signup;
    document.getElementById("authPassword").autocomplete = signup ? "new-password" : "current-password";
    document.querySelectorAll("[data-auth-mode]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.authMode === mode)));
  }

  async function submitAuth(event) {
    event.preventDefault();
    const message = document.getElementById("authMessage");
    const submitButton = document.getElementById("authSubmit");
    message.textContent = "Opening the studio…";
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    try {
      const email = document.getElementById("authEmail").value;
      const password = document.getElementById("authPassword").value;
      if (state.authMode === "signup") {
        await withTimeout(
          window.haloIdentity.signup(email, password, { data: { full_name: document.getElementById("authName").value.trim() } }),
          "Membership sign-up timed out. Please try again."
        );
        message.textContent = "Check your email to confirm your membership, then sign in.";
        setAuthMode("login");
        return;
      }
      state.user = await withTimeout(window.haloIdentity.login(email, password), "Sign-in timed out. Please try again.");
      updateAccount();
      authDialog.close();
      if (state.publicSlug) await loadPublicCampaign(); else await loadStudio();
    } catch (error) { message.textContent = error instanceof Error ? error.message : "Membership access failed."; }
    finally {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
    }
  }

  async function saveEditor(action) {
    const message = document.getElementById("editorMessage");
    message.textContent = action === "launch" ? "Creating the page, links, atmosphere, and launch pack…" : action === "publish" ? "Publishing the fan vote…" : "Saving the team draft…";
    try { const data = await api("POST", "/api/fan-campaigns", { action, ...campaignPayload(document.getElementById("editorForm")) }); state.campaign = data.campaign; renderCampaignEditor(); }
    catch (error) { message.textContent = error.message; }
  }

  async function vote(trackId) {
    const message = document.getElementById("voteMessage");
    message.textContent = "Sending your signal…";
    let voterToken = localStorage.getItem("halo-fan-voter-token");
    if (!voterToken) { voterToken = crypto.randomUUID(); localStorage.setItem("halo-fan-voter-token", voterToken); }
    try { const data = await api("POST", "/api/fan-campaigns", { action: "vote", slug: state.campaign.slug, trackId, voterToken }); state.campaign = data.campaign; localStorage.setItem(`halo-fan-vote:${state.campaign.slug}`, String(trackId)); renderPublicCampaign(); document.getElementById("voteMessage").textContent = "Your vote is in. Share the campaign to move the community unlock."; }
    catch (error) { message.textContent = error.message; }
  }

  async function copyText(text, button) {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = original; }, 1800);
  }

  function downloadCard() {
    const campaign = state.campaign;
    const promotion = campaign.promotion || {};
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1350;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ece7d8"; context.fillRect(0, 0, 1080, 1350);
    context.strokeStyle = "#d84d35"; context.lineWidth = 3;
    for (let offset = -400; offset < 1500; offset += 44) { context.beginPath(); context.moveTo(offset, 0); context.lineTo(offset + 420, 1350); context.stroke(); }
    context.fillStyle = "#171713"; context.fillRect(64, 64, 952, 1222);
    context.fillStyle = "#d5ef5a"; context.font = "600 25px IBM Plex Mono"; context.fillText((promotion.eyebrow || "HALO LISTENING PARTY").toUpperCase(), 110, 145);
    context.fillStyle = "#ece7d8"; context.font = "800 94px Syne";
    const words = (promotion.storyTitle || campaign.title).toUpperCase().split(/\s+/); const lines = []; let line = "";
    for (const word of words) { const candidate = `${line} ${word}`.trim(); if (context.measureText(candidate).width > 820 && line) { lines.push(line); line = word; } else line = candidate; }
    if (line) lines.push(line);
    lines.slice(0, 6).forEach((text, index) => context.fillText(text, 110, 430 + index * 102));
    context.strokeStyle = "#ece7d8"; context.lineWidth = 4; context.beginPath(); context.moveTo(110, 1090); context.lineTo(970, 1090); context.stroke();
    context.font = "600 27px IBM Plex Mono"; context.fillText((promotion.callToAction || "LISTEN. VOTE. UNLOCK.").toUpperCase(), 110, 1155);
    context.fillStyle = "#d84d35"; context.font = "800 38px Syne"; context.fillText(`${campaign.tracks.length} TRACKS / ${campaign.voteGoal} VOTE UNLOCK`, 110, 1230);
    const link = document.createElement("a"); link.download = `${campaign.slug}-social-card.png`; link.href = canvas.toDataURL("image/png"); link.click();
  }

  app.addEventListener("click", event => {
    if (event.target.closest("[data-open-auth]")) return authDialog.showModal();
    if (event.target.closest("[data-load-tracks]")) { state.tracksLoaded = true; state.selected = new Set(state.studio.tracks.slice(0, 14).map(track => track.id)); return renderStudio(); }
    if (event.target.closest("[data-publish]")) return saveEditor("publish");
    if (event.target.closest("[data-launch]")) return saveEditor("launch");
    if (event.target.closest("[data-share-party]")) {
      const share = { title: state.campaign.title, text: state.campaign.promotion?.caption || state.campaign.subtitle, url: shareUrl(state.campaign) };
      if (navigator.share) return navigator.share(share).catch(() => {});
      return copyText(`${share.text}\n\n${share.url}`, event.target.closest("[data-share-party]"));
    }
    const voteButton = event.target.closest("[data-vote]"); if (voteButton) return vote(Number(voteButton.dataset.vote));
    const copyCaption = event.target.closest("[data-copy-caption]"); if (copyCaption) return copyText(`${state.campaign.promotion.caption}\n\n${state.campaign.promotion.hashtags}\n${shareUrl(state.campaign)}`, copyCaption);
    const copyLink = event.target.closest("[data-copy-link]"); if (copyLink) return copyText(shareUrl(state.campaign), copyLink);
    if (event.target.closest("[data-download-card]")) return downloadCard();
  });

  app.addEventListener("change", event => {
    if (!event.target.matches("[data-track-choice]")) return;
    if (event.target.checked) state.selected.add(event.target.value); else state.selected.delete(event.target.value);
    renderStudio();
  });

  app.addEventListener("submit", async event => {
    if (event.target.id === "campaignForm") {
      event.preventDefault();
      const message = document.getElementById("createMessage");
      const submitButton = event.target.querySelector('button[type="submit"]');
      message.textContent = "Dreamweaver is shaping the campaign package…";
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
      const data = new FormData(event.target);
      try {
        const response = await api("POST", "/api/fan-campaigns", { action: "create", trackIds: [...state.selected], title: data.get("title"), subtitle: data.get("subtitle"), voteGoal: data.get("voteGoal"), endsAt: new Date(data.get("endsAt")).toISOString(), rewardTitle: data.get("rewardTitle"), rewardDescription: data.get("rewardDescription"), hostPersonaId: data.get("hostPersonaId"), preflightId: state.preflightId, partyTheme: { atmosphere: data.get("atmosphere"), celebration: data.get("celebration"), motion: data.get("motion"), accent: "#d5ef5a", roomNote: data.get("roomNote") } });
        state.campaign = response.campaign; state.publicSlug = state.campaign.slug;
        history.replaceState({}, "", `/campaign-studio/?campaign=${encodeURIComponent(state.campaign.slug)}`);
        renderCampaignEditor();
      } catch (error) {
        message.textContent = error.message;
        submitButton.disabled = state.selected.size < 2;
        submitButton.removeAttribute("aria-busy");
      }
    }
    if (event.target.id === "editorForm") { event.preventDefault(); saveEditor("save"); }
  });

  accountButton.addEventListener("click", async () => {
    if (!state.user) return authDialog.showModal();
    await window.haloIdentity.logout(); state.user = null; updateAccount();
    if (state.publicSlug) loadPublicCampaign(); else authGate();
  });
  authDialog.addEventListener("click", event => { if (event.target.matches("[data-close-dialog]")) authDialog.close(); });
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  document.getElementById("authForm").addEventListener("submit", submitAuth);
  window.addEventListener("halo-identity-ready", initializeIdentity, { once: true });
  if (window.haloIdentity) initializeIdentity();
})();
