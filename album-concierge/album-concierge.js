/* Album Concierge — guided creative, collector, and keepsake workspace */

(function () {
  "use strict";

  const state = {
    purpose: "",
    emotions: [],
    soundDirection: "",
    genreDirection: "",
    storyInput: "",
    sessionId: "",
    selectedTitle: "",
    result: null,
    currentStep: 0,
    shared: false,
    user: null,
    identity: null,
    authMode: "login",
    flowStartedAt: 0
  };

  const byId = id => document.getElementById(id);
  const notice = byId("acNotice");
  const stepper = byId("acStepper");
  const loading = byId("acLoading");
  const loadingLabel = byId("acLoadingLabel");
  const results = byId("acResults");
  const storyInput = byId("storyInput");
  const steps = [1, 2, 3, 4].map(number => byId(`step-${number}`));

  function showNotice(message, type = "success") {
    if (!notice) return;
    notice.textContent = message;
    notice.className = `ac-notice is-${type}`;
    notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearNotice() {
    if (!notice) return;
    notice.textContent = "";
    notice.className = "ac-notice";
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || "Request failed");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function updateStepper(active, done = false) {
    if (!stepper) return;
    stepper.querySelectorAll(".ac-step").forEach(element => {
      const number = Number(element.dataset.step);
      element.classList.remove("is-done");
      element.removeAttribute("aria-current");
      if (done || number < active) element.classList.add("is-done");
      else if (number === active) element.setAttribute("aria-current", "step");
    });
  }

  function showStep(number) {
    steps.forEach((element, index) => element?.classList.toggle("is-active", index + 1 === number));
    loading?.classList.remove("is-active");
    results?.classList.remove("is-active");
    updateStepper(number);
    state.currentStep = number;
    clearNotice();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showLoading() {
    steps.forEach(element => element?.classList.remove("is-active"));
    results?.classList.remove("is-active");
    loading?.classList.add("is-active");
    updateStepper(5);
    const labels = [
      "Crafting your album story…",
      "Finding song ideas that match the feeling…",
      "Building a keepsake-worthy tracklist…",
      "Binding the liner notes…"
    ];
    let index = 0;
    if (loadingLabel) loadingLabel.textContent = labels[0];
    const interval = window.setInterval(() => {
      index = (index + 1) % labels.length;
      if (loadingLabel) loadingLabel.textContent = labels[index];
    }, 2200);
    return () => window.clearInterval(interval);
  }

  function setButtonBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = label;
      button.disabled = true;
      button.classList.add("is-busy");
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
      button.classList.remove("is-busy");
    }
  }

  function bindSingleChoice(container, onSelect) {
    container?.querySelectorAll(".ac-choice").forEach(button => {
      button.addEventListener("click", () => {
        container.querySelectorAll(".ac-choice").forEach(other => {
          other.classList.remove("is-selected");
          other.setAttribute("aria-pressed", "false");
        });
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
        onSelect(button.dataset.value);
      });
    });
  }

  function bindMultiChoice(container, onUpdate) {
    container?.querySelectorAll(".ac-chip").forEach(button => {
      button.addEventListener("click", () => {
        const selected = button.getAttribute("aria-pressed") !== "true";
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
        onUpdate(Array.from(container.querySelectorAll(".ac-chip.is-selected")).map(item => item.dataset.value));
      });
    });
  }

  function setOwnerVisibility(shared) {
    document.querySelectorAll(".owner-only").forEach(element => { element.hidden = shared; });
    ["savePrivateBtn", "shareBtn", "giftBtn", "restartBtn"].forEach(id => {
      const element = byId(id);
      if (element) element.hidden = shared;
    });
    if (byId("sharedBanner")) byId("sharedBanner").hidden = !shared;
  }

  function absoluteUrl(path) {
    return new URL(path, location.origin).href;
  }

  async function copyOrShare({ title, text, url }) {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return "shared";
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return "copied";
    }
    window.prompt("Copy this keepsake link", url);
    return "shown";
  }

  function renderStyles(items) {
    const container = byId("styleReferences");
    if (!container) return;
    container.replaceChildren();
    (items || []).forEach(item => {
      const chip = document.createElement("span");
      chip.textContent = item;
      container.appendChild(chip);
    });
  }

  function renderTracks(tracks) {
    const tracklist = byId("tracklistEl");
    if (!tracklist) return;
    tracklist.replaceChildren();
    (tracks || []).forEach((track, index) => {
      const item = document.createElement("li");
      item.className = "ac-track";
      const number = document.createElement("span");
      number.className = "ac-track-num";
      number.textContent = String(index + 1).padStart(2, "0");
      const info = document.createElement("div");
      info.className = "ac-track-info";
      const title = document.createElement("div");
      title.className = "ac-track-title";
      title.textContent = track.title || `Track ${index + 1}`;
      info.appendChild(title);
      if (track.moodNote) {
        const note = document.createElement("div");
        note.className = "ac-track-note";
        note.textContent = track.moodNote;
        info.appendChild(note);
      }
      item.append(number, info);
      tracklist.appendChild(item);
    });
  }

  function selectTitle(title, persist = false) {
    state.selectedTitle = title;
    if (byId("coverTitleDisplay")) byId("coverTitleDisplay").textContent = title;
    byId("titleChips")?.querySelectorAll(".ac-title-chip").forEach(button => {
      const selected = button.textContent === title;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (persist && !state.shared) saveSession(state.result?.mode || "private", { quiet: true }).catch(() => null);
  }

  function renderTitles(data) {
    const container = byId("titleChips");
    if (!container) return;
    container.replaceChildren();
    const selected = data.selectedTitle || data.generatedTitles?.[0] || "Untitled Album";
    (data.generatedTitles || [selected]).forEach(title => {
      const button = document.createElement("button");
      button.className = `ac-title-chip${title === selected ? " is-active" : ""}`;
      button.type = "button";
      button.textContent = title;
      button.setAttribute("aria-pressed", String(title === selected));
      button.disabled = state.shared;
      button.addEventListener("click", () => selectTitle(title, true));
      container.appendChild(button);
    });
    selectTitle(selected);
  }

  function renderPremium(data) {
    const premium = Boolean(data.isPremium);
    const status = byId("premiumStatus");
    const upgrade = byId("upgradeBtn");
    const tools = byId("collectorTools");
    if (status) status.textContent = premium
      ? "Collector Edition unlocked. Your artwork and private media tools are ready."
      : data.premiumStatus === "pending"
        ? "Checkout started. Return here after payment to unlock the collector tools."
        : "Collector tools are locked.";
    if (upgrade) upgrade.hidden = premium;
    if (tools) tools.hidden = !premium;
  }

  function renderMedia(data) {
    const image = byId("coverImage");
    const icon = byId("coverIcon");
    if (image) {
      image.hidden = !data.coverUrl;
      if (data.coverUrl) image.src = data.coverUrl;
      else image.removeAttribute("src");
    }
    if (icon) icon.hidden = Boolean(data.coverUrl);
    const player = byId("voiceNotePlayer");
    if (player) {
      player.hidden = !data.voiceNoteUrl;
      if (data.voiceNoteUrl) player.src = data.voiceNoteUrl;
      else player.removeAttribute("src");
    }
  }

  function renderSecret(data) {
    const extra = data.unlockedExtras?.[0];
    const button = byId("secretRevealBtn");
    const note = byId("secretNote");
    if (!button || !note) return;
    button.hidden = !extra;
    note.hidden = true;
    note.textContent = extra?.content || "";
  }

  function renderResult(data) {
    state.result = data;
    state.sessionId = data.id;
    state.shared = Boolean(data.shared || state.shared);
    setOwnerVisibility(state.shared);
    renderTitles(data);
    renderTracks(data.generatedTracks);
    renderStyles(data.generatedStyleReferences);
    if (byId("themeText")) byId("themeText").textContent = data.generatedTheme || "";
    if (byId("whyText")) byId("whyText").textContent = data.generatedWhy || data.generatedTheme || "";
    if (byId("resultsThemeIntro")) byId("resultsThemeIntro").textContent = data.generatedTheme?.split(".")[0] ? `${data.generatedTheme.split(".")[0]}.` : "";
    if (byId("coverPromptNote")) byId("coverPromptNote").textContent = data.generatedCoverPrompt || "";
    const dedication = data.finalDedication || data.generatedDedication || "";
    if (byId("dedicationEl")) byId("dedicationEl").textContent = dedication;
    if (byId("dedicationEditor")) byId("dedicationEditor").value = dedication;
    if (byId("refineGenre")) byId("refineGenre").value = data.genreDirection || "";
    if (byId("refineTrackCount")) byId("refineTrackCount").value = String(data.trackCount || data.generatedTracks?.length || 8);
    if (byId("refineTone")) byId("refineTone").value = data.toneDirection || "";
    if (byId("refineArtwork")) byId("refineArtwork").value = data.artworkStyle || "";
    renderPremium(data);
    renderMedia(data);
    renderSecret(data);
  }

  function showResults(data, { track = false, shared = false } = {}) {
    state.shared = shared;
    loading?.classList.remove("is-active");
    steps.forEach(element => element?.classList.remove("is-active"));
    results?.classList.add("is-active");
    updateStepper(5, true);
    renderResult({ ...data, shared });
    results?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (track) {
      window.haloStats?.track("album_concierge_result_ready", {
        session_id: data.id,
        duration_ms: state.flowStartedAt ? Date.now() - state.flowStartedAt : 0
      });
    }
  }

  function resetFlow() {
    Object.assign(state, {
      purpose: "",
      emotions: [],
      soundDirection: "",
      genreDirection: "",
      storyInput: "",
      sessionId: "",
      selectedTitle: "",
      result: null,
      shared: false,
      currentStep: 0,
      flowStartedAt: Date.now()
    });
    document.querySelectorAll(".ac-choice, .ac-chip").forEach(button => {
      button.classList.remove("is-selected");
      button.setAttribute("aria-pressed", "false");
    });
    if (storyInput) storyInput.value = "";
    if (byId("genreDirection")) byId("genreDirection").value = "";
    ["step1Next", "step2Next", "step3Next", "step4Generate"].forEach(id => { if (byId(id)) byId(id).disabled = true; });
    setOwnerVisibility(false);
    showStep(1);
  }

  function ensureSignedIn() {
    if (state.user) return true;
    openAuth("login");
    showNotice("Join or sign in to create and keep your album.", "error");
    return false;
  }

  bindSingleChoice(byId("step-1"), value => {
    state.purpose = value;
    byId("step1Next").disabled = false;
  });
  bindMultiChoice(byId("step-2"), values => {
    state.emotions = values;
    byId("step2Next").disabled = values.length === 0;
  });
  bindSingleChoice(byId("step-3"), value => {
    state.soundDirection = value;
    byId("step3Next").disabled = false;
  });

  byId("step1Next")?.addEventListener("click", () => showStep(2));
  byId("step2Back")?.addEventListener("click", () => showStep(1));
  byId("step2Next")?.addEventListener("click", () => showStep(3));
  byId("step3Back")?.addEventListener("click", () => showStep(2));
  byId("step3Next")?.addEventListener("click", () => {
    state.genreDirection = byId("genreDirection")?.value.trim() || "";
    showStep(4);
  });
  byId("step4Back")?.addEventListener("click", () => showStep(3));
  storyInput?.addEventListener("input", () => {
    state.storyInput = storyInput.value.trim();
    byId("step4Generate").disabled = state.storyInput.length < 20;
  });

  byId("step4Generate")?.addEventListener("click", async () => {
    if (!ensureSignedIn()) return;
    state.storyInput = storyInput?.value.trim() || "";
    const stop = showLoading();
    try {
      const session = await api("/api/album-concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: state.purpose,
          emotion: state.emotions.join(", "),
          soundDirection: state.soundDirection,
          genreDirection: state.genreDirection,
          storyInput: state.storyInput,
          trackCount: 8
        })
      });
      state.sessionId = session.id;
      const generated = await api("/api/album-concierge?action=generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId })
      });
      stop();
      showResults(generated, { track: true });
      loadTreasury();
    } catch (error) {
      stop();
      showStep(4);
      showNotice(error.status === 401 ? "Sign in to build and save your album." : `Something went wrong: ${error.message}`, "error");
    }
  });

  byId("dedicationEditor")?.addEventListener("input", () => {
    const value = byId("dedicationEditor").value;
    if (byId("dedicationEl")) byId("dedicationEl").textContent = value;
    if (state.result) state.result.finalDedication = value;
  });

  async function saveSession(mode, { quiet = false } = {}) {
    if (!state.sessionId) return null;
    const saved = await api("/api/album-concierge?action=save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        mode,
        selectedTitle: state.selectedTitle,
        finalDedication: byId("dedicationEditor")?.value.trim() || state.result?.finalDedication || ""
      })
    });
    renderResult(saved);
    if (!quiet) showNotice(mode === "private" ? "Album saved privately in your Treasury." : "Album sharing is ready.");
    return saved;
  }

  byId("savePrivateBtn")?.addEventListener("click", async () => {
    try {
      await saveSession("private");
      window.haloStats?.track("album_concierge_saved", { session_id: state.sessionId, mode: "private" });
      loadTreasury();
    } catch (error) { showNotice(error.message, "error"); }
  });

  byId("shareBtn")?.addEventListener("click", async () => {
    try {
      const saved = await saveSession("public", { quiet: true });
      const result = await copyOrShare({
        title: state.selectedTitle || "My Album Concept",
        text: "I made a personal album keepsake with HALO Album Concierge.",
        url: absoluteUrl(saved.shareUrl)
      });
      showNotice(result === "copied" ? "Public keepsake link copied." : "Public keepsake ready to share.");
      window.haloStats?.track("album_concierge_shared", { session_id: state.sessionId });
    } catch (error) { showNotice(`Share failed: ${error.message}`, "error"); }
  });

  byId("giftBtn")?.addEventListener("click", async () => {
    try {
      const saved = await saveSession("gift", { quiet: true });
      const result = await copyOrShare({
        title: state.selectedTitle || "An album made for you",
        text: "This album was made for you. Open your private keepsake.",
        url: absoluteUrl(saved.shareUrl)
      });
      showNotice(result === "copied" ? "Gift link copied. Send it to someone special." : "Gift keepsake ready.");
      window.haloStats?.track("album_concierge_gifted", { session_id: state.sessionId });
    } catch (error) { showNotice(`Gift link failed: ${error.message}`, "error"); }
  });

  byId("refineBtn")?.addEventListener("click", async () => {
    const button = byId("refineBtn");
    setButtonBusy(button, true, "Refining…");
    const stop = showLoading();
    try {
      const refined = await api("/api/album-concierge?action=refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          genreDirection: byId("refineGenre")?.value.trim(),
          trackCount: byId("refineTrackCount")?.value,
          toneDirection: byId("refineTone")?.value,
          artworkStyle: byId("refineArtwork")?.value,
          finalDedication: byId("dedicationEditor")?.value.trim(),
          refinement: byId("refinementPrompt")?.value.trim()
        })
      });
      stop();
      showResults(refined);
      if (byId("refinementPrompt")) byId("refinementPrompt").value = "";
      window.haloStats?.track("album_concierge_refined", { session_id: state.sessionId, track_count: refined.trackCount });
      loadTreasury();
    } catch (error) {
      stop();
      showResults(state.result);
      showNotice(`Refinement failed: ${error.message}`, "error");
    } finally {
      setButtonBusy(button, false);
    }
  });

  byId("generateCoverBtn")?.addEventListener("click", async () => {
    const button = byId("generateCoverBtn");
    setButtonBusy(button, true, "Painting cover…");
    try {
      const updated = await api("/api/album-concierge?action=cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId })
      });
      renderResult(updated);
      showNotice("Custom cover art added to the Collector Edition.");
      window.haloStats?.track("album_concierge_cover_generated", { session_id: state.sessionId });
    } catch (error) { showNotice(error.message, "error"); }
    finally { setButtonBusy(button, false); }
  });

  byId("uploadVoiceBtn")?.addEventListener("click", async () => {
    const file = byId("voiceNoteInput")?.files?.[0];
    if (!file) return showNotice("Choose a voice note first.", "error");
    const button = byId("uploadVoiceBtn");
    setButtonBusy(button, true, "Uploading…");
    try {
      const form = new FormData();
      form.set("sessionId", state.sessionId);
      form.set("voiceNote", file);
      const updated = await api("/api/album-concierge?action=voice-note", { method: "POST", body: form });
      renderResult(updated);
      showNotice("Voice note added to the keepsake.");
    } catch (error) { showNotice(error.message, "error"); }
    finally { setButtonBusy(button, false); }
  });

  byId("upgradeBtn")?.addEventListener("click", async () => {
    const button = byId("upgradeBtn");
    setButtonBusy(button, true, "Opening checkout…");
    try {
      const checkout = await api("/api/album-concierge?action=checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId })
      });
      if (checkout.alreadyPremium) {
        renderPremium({ ...state.result, isPremium: true, premiumStatus: "active" });
        return;
      }
      window.haloStats?.track("album_concierge_premium_checkout", { session_id: state.sessionId });
      location.assign(checkout.checkoutUrl);
    } catch (error) {
      showNotice(error.message, "error");
      setButtonBusy(button, false);
    }
  });

  async function verifyCheckout(sessionId, checkoutSessionId) {
    try {
      const updated = await api("/api/album-concierge?action=verify-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, checkoutSessionId })
      });
      showResults(updated);
      showNotice("Collector Edition unlocked. Welcome to the atelier.");
      window.haloStats?.track("album_concierge_premium_unlocked", { session_id: sessionId });
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("checkout");
      history.replaceState({}, "", cleanUrl);
    } catch (error) { showNotice(error.message, "error"); }
  }

  byId("exportBtn")?.addEventListener("click", () => {
    window.haloStats?.track("album_concierge_exported", { session_id: state.sessionId, shared: state.shared });
    window.print();
  });
  byId("printBookletBtn")?.addEventListener("click", () => {
    window.haloStats?.track("album_concierge_exported", { session_id: state.sessionId, format: "booklet" });
    window.print();
  });
  byId("restartBtn")?.addEventListener("click", resetFlow);
  byId("secretRevealBtn")?.addEventListener("click", () => {
    const note = byId("secretNote");
    if (note) note.hidden = !note.hidden;
  });

  async function loadTreasury() {
    if (!state.user || state.shared) return;
    const container = byId("treasuryList");
    try {
      const data = await api("/api/album-concierge");
      container?.replaceChildren();
      if (!data.sessions?.length) {
        const empty = document.createElement("p");
        empty.className = "ac-empty-state";
        empty.textContent = "Your first finished concept appears here.";
        container?.appendChild(empty);
        return;
      }
      data.sessions.forEach(session => {
        const card = document.createElement("button");
        card.className = "ac-treasury-card";
        card.type = "button";
        const title = document.createElement("strong");
        title.textContent = session.selectedTitle || session.generatedTitles?.[0] || "Album in progress";
        const summary = document.createElement("p");
        summary.textContent = session.generatedTheme || session.storyInput || "Return to finish this album concept.";
        const meta = document.createElement("small");
        meta.textContent = `${session.mode} · ${new Date(session.updatedAt).toLocaleDateString()}`;
        card.append(title, summary, meta);
        card.addEventListener("click", () => {
          showResults(session);
          history.replaceState({}, "", `/album-concierge/?session=${encodeURIComponent(session.id)}`);
        });
        container?.appendChild(card);
      });
    } catch (error) {
      if (error.status !== 401) showNotice("Your Treasury could not be loaded right now.", "error");
    }
  }

  byId("refreshTreasuryBtn")?.addEventListener("click", loadTreasury);

  byId("startFlowBtn")?.addEventListener("click", () => {
    state.flowStartedAt = Date.now();
    byId("concierge")?.scrollIntoView({ behavior: "smooth" });
    showStep(1);
  });
  byId("giftFlowBtn")?.addEventListener("click", () => {
    state.flowStartedAt = Date.now();
    byId("concierge")?.scrollIntoView({ behavior: "smooth" });
    showStep(1);
    byId("step-1")?.querySelector('[data-value="gift"]')?.click();
  });
  byId("vibeFlowBtn")?.addEventListener("click", () => {
    state.flowStartedAt = Date.now();
    byId("concierge")?.scrollIntoView({ behavior: "smooth" });
    byId("step-1")?.querySelector('[data-value="self"]')?.click();
    showStep(2);
  });

  function setAuthMode(mode) {
    state.authMode = mode;
    const signup = mode === "signup";
    byId("authTitle").textContent = signup ? "Create your HALO membership." : "Sign in to keep your album.";
    byId("authNameLabel").hidden = !signup;
    byId("authName").required = signup;
    byId("authPassword").autocomplete = signup ? "new-password" : "current-password";
    byId("authSubmitBtn").textContent = signup ? "Create account" : "Sign in";
    byId("authSwitchBtn").textContent = signup ? "Already a member? Sign in" : "New here? Create an account";
    byId("authMessage").textContent = "";
  }

  function openAuth(mode = "login") {
    setAuthMode(mode);
    byId("authDialog")?.showModal();
  }

  function renderAccount() {
    const button = byId("accountButton");
    if (!button) return;
    button.textContent = state.user ? `${state.user.name || state.user.email || "Member"} · Sign out` : "Join / sign in";
  }

  byId("authCloseBtn")?.addEventListener("click", () => byId("authDialog")?.close());
  byId("authSwitchBtn")?.addEventListener("click", () => setAuthMode(state.authMode === "login" ? "signup" : "login"));
  byId("authForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.identity) return showNotice("Membership is still loading. Try again in a moment.", "error");
    const button = byId("authSubmitBtn");
    setButtonBusy(button, true, state.authMode === "signup" ? "Creating…" : "Signing in…");
    try {
      if (state.authMode === "signup") {
        const user = await state.identity.signup(byId("authEmail").value.trim(), byId("authPassword").value, { full_name: byId("authName").value.trim() });
        if (!user?.emailVerified) {
          setAuthMode("login");
          byId("authMessage").textContent = "Check your email to confirm your membership, then sign in.";
          return;
        }
        state.user = user;
      } else {
        state.user = await state.identity.login(byId("authEmail").value.trim(), byId("authPassword").value);
      }
      byId("authDialog")?.close();
      byId("authForm")?.reset();
      renderAccount();
      const loaded = await maybeLoadSession();
      if (!loaded) loadTreasury();
      showNotice("Welcome. Your private album workspace is ready.");
    } catch (error) {
      byId("authMessage").textContent = error?.status === 401 ? "The email or password did not match." : (error.message || "Membership could not be completed.");
    } finally { setButtonBusy(button, false); }
  });

  byId("accountButton")?.addEventListener("click", async () => {
    if (!state.user) return openAuth("login");
    await state.identity?.logout();
    state.user = null;
    renderAccount();
    byId("treasuryList").innerHTML = '<p class="ac-empty-state">Sign in and create an album to begin your Treasury.</p>';
    results?.classList.remove("is-active");
    showNotice("You are signed out.");
  });

  async function maybeLoadSession() {
    const params = new URLSearchParams(location.search);
    const shareToken = params.get("share");
    const sessionId = params.get("session");
    const checkoutSessionId = params.get("checkout");
    if (!shareToken && !sessionId) return false;
    const stop = showLoading();
    try {
      const data = shareToken
        ? await api(`/api/album-concierge?share=${encodeURIComponent(shareToken)}`)
        : await api(`/api/album-concierge?sessionId=${encodeURIComponent(sessionId)}`);
      stop();
      showResults(data, { shared: Boolean(shareToken) });
      if (checkoutSessionId && sessionId) await verifyCheckout(sessionId, checkoutSessionId);
      if (params.get("payment") === "cancelled") showNotice("Checkout was cancelled. Your album is still safe.", "error");
      return true;
    } catch (error) {
      stop();
      if (error.status === 401) openAuth("login");
      showNotice(error.status === 404 ? "This keepsake link is unavailable." : error.message, "error");
      return false;
    }
  }

  steps.forEach(element => element?.classList.remove("is-active"));
  loading?.classList.remove("is-active");
  results?.classList.remove("is-active");

  window.addEventListener("halo-identity-ready", async event => {
    state.identity = event.detail;
    state.user = await state.identity.getUser().catch(() => null);
    renderAccount();
    const loaded = await maybeLoadSession();
    if (!loaded) loadTreasury();
  }, { once: true });

  window.setTimeout(async () => {
    if (state.identity) return;
    state.identity = window.haloIdentity || null;
    state.user = await state.identity?.getUser?.().catch(() => null);
    renderAccount();
    const loaded = await maybeLoadSession();
    if (!loaded) loadTreasury();
  }, 1200);
}());
