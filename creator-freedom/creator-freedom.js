(() => {
  const state = { room: null, user: null, identity: null, authMode: "login", busyPrinciple: null };
  const byId = id => document.getElementById(id);
  const formatNumber = value => new Intl.NumberFormat("en-GB").format(Number(value || 0));
  const escapeHtml = value => String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function setStatus(element, message, type = "") {
    element.textContent = message;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }

  function relativeDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "Recently";
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  async function requestRoom(payload) {
    const response = await fetch("/api/creator-charter", payload ? {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    } : { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "The Charter Room could not connect.");
      error.status = response.status;
      throw error;
    }
    state.room = data;
    renderRoom();
    return data;
  }

  function requireMember(message) {
    if (state.user) return true;
    byId("auth-copy").textContent = message;
    byId("auth-dialog").showModal();
    return false;
  }

  function renderVotes() {
    document.querySelectorAll(".charter-point").forEach(point => {
      const principle = Number(point.dataset.principle);
      const totals = state.room?.votes?.find(item => item.principle === principle) || {};
      const viewerPosition = state.room?.viewer?.votes?.[String(principle)] || "";
      const container = point.querySelector(".principle-vote");
      const options = [
        ["support", "Support", totals.support],
        ["needs_work", "Needs work", totals.needsWork],
        ["concern", "Concern", totals.concern]
      ];
      container.innerHTML = options.map(([position, label, total]) => `<button class="vote-button${viewerPosition === position ? " is-active" : ""}" type="button" data-position="${position}" ${state.busyPrinciple === principle ? "disabled" : ""}>${label} · ${formatNumber(total)}</button>`).join("");
      container.querySelectorAll("button").forEach(button => button.addEventListener("click", () => castVote(principle, button.dataset.position)));
    });
  }

  function renderResponses() {
    const list = byId("response-list");
    const responses = state.room?.responses || [];
    if (!responses.length) {
      list.innerHTML = '<div class="record-empty">The public record is open. Add the first question, proposal, experience, or challenge.</div>';
      return;
    }
    list.innerHTML = responses.map(response => `<article class="response-card"><header><span>${escapeHtml(response.category)}</span><time datetime="${escapeHtml(response.createdAt)}">${relativeDate(response.createdAt)}</time></header><p>${escapeHtml(response.body)}</p><footer>${escapeHtml(response.displayName)}</footer></article>`).join("");
  }

  function renderAcknowledgment() {
    const acknowledgment = state.room?.viewer?.acknowledgment;
    const form = byId("affirm-form");
    if (!acknowledgment) {
      form.querySelector("button").textContent = "Affirm version 2026-08";
      return;
    }
    form.elements.role.value = acknowledgment.role;
    form.elements.toolFreedom.checked = acknowledgment.toolFreedom;
    form.elements.rightsResponsibility.checked = acknowledgment.rightsResponsibility;
    form.elements.fairReview.checked = acknowledgment.fairReview;
    form.querySelector("button").textContent = "Charter affirmed — update promise";
    setStatus(byId("affirm-status"), `Affirmed ${relativeDate(acknowledgment.affirmedAt)}.`, "success");
  }

  function renderRoom() {
    byId("affirmation-count").textContent = formatNumber(state.room?.summary?.affirmations);
    byId("vote-count").textContent = formatNumber(state.room?.summary?.votes);
    byId("response-count").textContent = formatNumber(state.room?.summary?.responses);
    renderVotes();
    renderResponses();
    renderAcknowledgment();
  }

  async function castVote(principle, position) {
    if (!requireMember("Sign in to respond to each charter principle.")) return;
    state.busyPrinciple = principle;
    renderVotes();
    try {
      await requestRoom({ action: "vote", principle, position });
      window.haloStats?.track("creator_charter_vote", { principle, position });
    } catch (error) {
      if (error.status === 401) requireMember(error.message);
      else setStatus(byId("response-status"), error.message, "error");
    } finally {
      state.busyPrinciple = null;
      renderVotes();
    }
  }

  async function submitAffirmation(event) {
    event.preventDefault();
    if (!requireMember("Sign in to place your name behind the Creator Freedom Charter.")) return;
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    setStatus(byId("affirm-status"), "Recording your promise…");
    try {
      await requestRoom({
        action: "affirm",
        role: form.elements.role.value,
        toolFreedom: form.elements.toolFreedom.checked,
        rightsResponsibility: form.elements.rightsResponsibility.checked,
        fairReview: form.elements.fairReview.checked
      });
      setStatus(byId("affirm-status"), "Your charter affirmation is now recorded.", "success");
      window.haloStats?.track("creator_charter_affirmed", { version: "2026-08" });
    } catch (error) {
      if (error.status === 401) requireMember(error.message);
      setStatus(byId("affirm-status"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function submitResponse(event) {
    event.preventDefault();
    if (!requireMember("Sign in to publish your response in the Charter Room.")) return;
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    setStatus(byId("response-status"), "Publishing to the public record…");
    try {
      await requestRoom({ action: "respond", category: form.elements.category.value, body: form.elements.body.value });
      form.elements.body.value = "";
      byId("character-count").textContent = "0 / 1000";
      setStatus(byId("response-status"), "Your response is now part of the room.", "success");
      window.haloStats?.track("creator_charter_response", { category: form.elements.category.value });
    } catch (error) {
      if (error.status === 401) requireMember(error.message);
      setStatus(byId("response-status"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    document.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("is-active", button.dataset.authMode === mode));
    const nameLabel = byId("auth-form").querySelector(".auth-name");
    nameLabel.hidden = mode !== "signup";
    nameLabel.querySelector("input").required = mode === "signup";
    byId("auth-form").querySelector("button").textContent = mode === "signup" ? "Create account" : "Sign in";
    byId("auth-title").textContent = mode === "signup" ? "Join the Charter Room" : "Enter the Charter Room";
    setStatus(byId("auth-status"), "");
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    if (!state.identity) return setStatus(byId("auth-status"), "Membership is still connecting.", "error");
    button.disabled = true;
    setStatus(byId("auth-status"), state.authMode === "signup" ? "Creating your membership…" : "Opening the room…");
    try {
      if (state.authMode === "signup") {
        const user = await state.identity.signup(form.elements.email.value, form.elements.password.value, { full_name: form.elements.name.value });
        if (!user?.emailVerified) {
          setStatus(byId("auth-status"), "Check your email to confirm your account, then return to sign in.", "success");
          return;
        }
        state.user = user;
      } else {
        state.user = await state.identity.login(form.elements.email.value, form.elements.password.value);
      }
      byId("auth-dialog").close();
      updateIdentityUi();
      await requestRoom();
    } catch (error) {
      setStatus(byId("auth-status"), error?.message || "Membership could not connect.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function updateIdentityUi() {
    const label = state.user?.name || state.user?.userMetadata?.full_name || state.user?.email;
    byId("header-auth").textContent = label ? `Signed in · ${label}` : "Join / sign in";
  }

  async function connectIdentity(identity) {
    if (!identity || state.identity) return;
    state.identity = identity;
    state.user = await identity.getUser().catch(() => null);
    updateIdentityUi();
    identity.onAuthChange((event, user) => {
      state.user = user || null;
      updateIdentityUi();
      requestRoom().catch(() => null);
    });
    requestRoom().catch(error => {
      byId("response-list").innerHTML = `<div class="record-empty">${escapeHtml(error.message)}</div>`;
    });
  }

  byId("affirm-form").addEventListener("submit", submitAffirmation);
  byId("response-form").addEventListener("submit", submitResponse);
  byId("response-form").elements.body.addEventListener("input", event => { byId("character-count").textContent = `${event.target.value.length} / 1000`; });
  byId("header-auth").addEventListener("click", () => {
    if (state.user) document.querySelector("#charter-room").scrollIntoView({ behavior: "smooth" });
    else byId("auth-dialog").showModal();
  });
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  byId("auth-form").addEventListener("submit", submitAuth);
  window.addEventListener("halo-identity-ready", event => connectIdentity(event.detail));
  if (window.haloIdentity) connectIdentity(window.haloIdentity);
  requestRoom().catch(error => { byId("response-list").innerHTML = `<div class="record-empty">${escapeHtml(error.message)}</div>`; });
})();
