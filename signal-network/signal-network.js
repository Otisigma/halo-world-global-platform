const API_URL = "/api/signal-network";
const state = {
  dashboard: null,
  collaborators: [],
  activeTab: "discover",
  activeConversationId: "",
  authMode: "signup",
  mapFrame: 0,
  mapStartedAt: performance.now()
};

const elements = {
  authButton: document.getElementById("signalAuthButton"),
  gateAuthButton: document.getElementById("gateAuthButton"),
  gate: document.getElementById("networkGate"),
  workspace: document.getElementById("signalWorkspace"),
  memberName: document.getElementById("workspaceMemberName"),
  editProfileButton: document.getElementById("editProfileButton"),
  signOutButton: document.getElementById("signOutButton"),
  metrics: {
    collaborators: document.getElementById("metricCollaborators"),
    signals: document.getElementById("metricSignals"),
    messages: document.getElementById("metricMessages"),
    regions: document.getElementById("metricRegions")
  },
  signalBadge: document.getElementById("signalTabBadge"),
  messageBadge: document.getElementById("messageTabBadge"),
  collaboratorGrid: document.getElementById("collaboratorGrid"),
  signalList: document.getElementById("signalRequestList"),
  campaignGrid: document.getElementById("campaignGrid"),
  conversationList: document.getElementById("conversationList"),
  messageThread: document.getElementById("messageThread"),
  regionList: document.getElementById("signalRegionList"),
  mapCanvas: document.getElementById("signalMapCanvas"),
  searchForm: document.getElementById("collaboratorSearchForm"),
  searchInput: document.getElementById("collaboratorSearch"),
  availabilityFilter: document.getElementById("availabilityFilter"),
  authDialog: document.getElementById("signalAuthDialog"),
  authForm: document.getElementById("signalAuthForm"),
  authTitle: document.getElementById("signalAuthTitle"),
  authNameField: document.getElementById("signalNameField"),
  authName: document.getElementById("signalAuthName"),
  authEmail: document.getElementById("signalAuthEmail"),
  authPassword: document.getElementById("signalAuthPassword"),
  authSubmit: document.getElementById("signalAuthSubmit"),
  authMessage: document.getElementById("signalAuthMessage"),
  profileDialog: document.getElementById("signalProfileDialog"),
  profileForm: document.getElementById("signalProfileForm"),
  profileMessage: document.getElementById("signalProfileMessage"),
  signalDialog: document.getElementById("sendSignalDialog"),
  signalForm: document.getElementById("sendSignalForm"),
  signalMessage: document.getElementById("sendSignalMessage"),
  toast: document.getElementById("signalToast")
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function initials(name) {
  return String(name || "H").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function listFromInput(value) {
  return [...new Set(String(value || "").split(",").map(item => item.trim()).filter(Boolean))];
}

function formatTime(value, options = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function timeAgo(value) {
  if (!value) return "No messages yet";
  const difference = Date.now() - new Date(value).valueOf();
  const minutes = Math.max(0, Math.floor(difference / 60000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function showToast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", error);
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

async function api(path = "", options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      credentials: "same-origin",
      signal: controller.signal,
      ...options,
      headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Signal Network request failed");
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Signal Network took too long to respond");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function post(action, payload = {}) {
  return api("", { method: "POST", body: JSON.stringify({ action, ...payload }) });
}

function setLoadingCards(container, count = 4) {
  container.innerHTML = Array.from({ length: count }, () => '<div class="signal-skeleton" aria-hidden="true"></div>').join("");
}

function emptyState(title, body, symbol = "◎") {
  return `<div class="signal-empty"><span>${escapeHtml(symbol)}</span><h4>${escapeHtml(title)}</h4><p>${escapeHtml(body)}</p></div>`;
}

function badge(element, count) {
  element.textContent = String(count);
  element.hidden = !count;
}

function renderDashboard() {
  const dashboard = state.dashboard;
  if (!dashboard) return;
  elements.memberName.textContent = dashboard.profile?.displayName || "HALO member";
  elements.metrics.collaborators.textContent = dashboard.summary.collaborators;
  elements.metrics.signals.textContent = dashboard.summary.pendingSignals;
  elements.metrics.messages.textContent = dashboard.summary.unreadMessages;
  elements.metrics.regions.textContent = dashboard.summary.activeRegions;
  badge(elements.signalBadge, dashboard.summary.pendingSignals);
  badge(elements.messageBadge, dashboard.summary.unreadMessages);
  renderSignals();
  renderCampaigns();
  renderConversations();
  renderRegions();
  if (!dashboard.profile?.updatedAt) openProfileDialog();
}

function renderCollaborators() {
  if (!state.collaborators.length) {
    elements.collaboratorGrid.innerHTML = emptyState("No matching signals", "Try a broader role, genre, skill, or availability filter.", "∅");
    return;
  }
  elements.collaboratorGrid.innerHTML = state.collaborators.map(person => {
    const tags = [...person.roles, ...person.genres, ...person.skills].slice(0, 7);
    return `
      <article class="signal-person-card accent-${escapeHtml(person.accent)}">
        <div class="signal-person-card__top">
          <div class="signal-avatar" aria-hidden="true">${escapeHtml(initials(person.displayName))}</div>
          <span class="signal-availability" data-status="${escapeHtml(person.availability)}">${escapeHtml(person.availability)}</span>
        </div>
        <h4>${escapeHtml(person.displayName)}</h4>
        <p class="signal-person-card__headline">${escapeHtml(person.headline || person.bio || "A HALO member shaping their next move.")}</p>
        <div class="signal-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>Open signal</span>"}</div>
        <div class="signal-person-card__footer">
          <span class="signal-person-card__region">${escapeHtml(person.regionLabel || "Region private")}</span>
          <button class="signal-button" type="button" data-send-signal="${escapeHtml(person.memberId)}" data-member-name="${escapeHtml(person.displayName)}">Send signal</button>
        </div>
      </article>`;
  }).join("");
}

function renderSignals() {
  const requests = state.dashboard?.requests || [];
  if (!requests.length) {
    elements.signalList.innerHTML = emptyState("The queue is quiet", "Signals you send or receive appear here with their current status.", "↗");
    return;
  }
  elements.signalList.innerHTML = requests.map(request => {
    const inboundPending = request.direction === "inbound" && request.status === "pending";
    const statusLabel = request.status === "pending" ? `${request.direction} / waiting` : request.status;
    return `
      <article class="signal-request">
        <div class="signal-request__marker" aria-hidden="true">${request.direction === "inbound" ? "↓" : "↑"}</div>
        <div>
          <p class="signal-request__meta">${escapeHtml(request.kind)} · ${escapeHtml(statusLabel)} · ${escapeHtml(request.displayName)}</p>
          <h4>${escapeHtml(request.subject)}</h4>
          <p class="signal-request__body">${escapeHtml(request.body)}</p>
        </div>
        <div class="signal-request__actions">
          ${inboundPending ? `<button class="signal-button signal-button--bright" type="button" data-respond-signal="${escapeHtml(request.id)}" data-status="accepted">Accept</button><button class="signal-button" type="button" data-respond-signal="${escapeHtml(request.id)}" data-status="declined">Decline</button>` : ""}
          ${request.conversationId ? `<button class="signal-button" type="button" data-open-conversation="${escapeHtml(request.conversationId)}">Message</button>` : ""}
          <button class="signal-button" type="button" data-report-member="${escapeHtml(request.memberId)}" data-request-id="${escapeHtml(request.id)}">Report</button>
        </div>
      </article>`;
  }).join("");
}

function renderCampaigns() {
  const campaigns = state.dashboard?.campaigns || [];
  if (!campaigns.length) {
    elements.campaignGrid.innerHTML = emptyState("No campaigns in flight", "Build a listening campaign in Campaign Studio, then track its momentum here.", "◌");
    return;
  }
  elements.campaignGrid.innerHTML = campaigns.map(campaign => {
    const progress = campaign.voteGoal ? Math.min(100, Math.round((campaign.votes / campaign.voteGoal) * 100)) : 0;
    return `
      <article class="signal-campaign-card">
        <span class="signal-campaign-card__status">${escapeHtml(campaign.status)} / ${campaign.tracks} tracks</span>
        <h4>${escapeHtml(campaign.title)}</h4>
        <p class="signal-person-card__headline">${escapeHtml(campaign.subtitle || "A HALO listening campaign in motion.")}</p>
        <div class="signal-campaign-card__bar" aria-label="${progress}% of vote goal"><i style="width:${progress}%"></i></div>
        <div class="signal-campaign-card__numbers"><span>${campaign.votes} votes</span><span>${campaign.voteGoal} goal</span></div>
        <div class="signal-campaign-card__footer">
          <time datetime="${escapeHtml(campaign.endsAt || "")}">${campaign.endsAt ? `Ends ${formatTime(campaign.endsAt, { month: "short", day: "numeric" })}` : "No deadline"}</time>
          <a class="signal-button" href="/campaign-studio/?campaign=${encodeURIComponent(campaign.slug)}">Open</a>
        </div>
      </article>`;
  }).join("");
}

function renderConversations() {
  const conversations = state.dashboard?.conversations || [];
  if (!conversations.length) {
    elements.conversationList.innerHTML = '<div class="signal-empty"><span>◇</span><h4>No conversations</h4><p>Accept a signal to open a trusted thread.</p></div>';
    return;
  }
  elements.conversationList.innerHTML = conversations.map(conversation => `
    <button class="signal-conversation ${conversation.id === state.activeConversationId ? "is-active" : ""}" type="button" data-conversation="${escapeHtml(conversation.id)}">
      <strong>${escapeHtml(conversation.displayName)}${conversation.unread ? ` · ${conversation.unread}` : ""}</strong>
      <span>${escapeHtml(conversation.lastMessage || conversation.headline || "Open conversation")}</span>
      <small>${escapeHtml(timeAgo(conversation.lastMessageAt))}</small>
    </button>`).join("");
}

function renderRegions() {
  const regions = state.dashboard?.regions || [];
  elements.regionList.innerHTML = regions.length ? regions.map(region => `
    <article class="signal-region">
      <div><strong>${escapeHtml(region.label)}</strong><small>${region.members} opted in · ${region.activeToday} active today</small></div>
      <span>${region.activeNow}</span>
    </article>`).join("") : emptyState("No regions broadcasting", "Members can opt into aggregate regional presence from their signal profile.", "⌁");
  drawMap();
}

async function loadDashboard() {
  const payload = await api();
  state.dashboard = payload.dashboard;
  elements.gate.hidden = true;
  elements.workspace.hidden = false;
  elements.authButton.textContent = "Network live";
  renderDashboard();
  await loadCollaborators();
}

async function loadCollaborators() {
  setLoadingCards(elements.collaboratorGrid);
  const params = new URLSearchParams({ view: "discover" });
  const query = elements.searchInput.value.trim();
  const availability = elements.availabilityFilter.value;
  if (query) params.set("q", query);
  if (availability) params.set("availability", availability);
  try {
    const payload = await api(`?${params}`);
    state.collaborators = payload.collaborators || [];
    renderCollaborators();
  } catch (error) {
    elements.collaboratorGrid.innerHTML = emptyState("Discovery is offline", error.message, "!");
  }
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll("[data-signal-tab]").forEach(button => {
    const active = button.dataset.signalTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-signal-panel]").forEach(panel => {
    const active = panel.dataset.signalPanel === tab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  if (tab === "map") requestAnimationFrame(drawMap);
}

function openAuthDialog(mode = "signup") {
  setAuthMode(mode);
  elements.authMessage.textContent = "";
  elements.authDialog.showModal();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  elements.authTitle.textContent = signup ? "Join Signal Network" : "Return to Signal Network";
  elements.authNameField.hidden = !signup;
  elements.authName.required = signup;
  elements.authPassword.autocomplete = signup ? "new-password" : "current-password";
  elements.authSubmit.textContent = signup ? "Create membership" : "Sign in";
  document.querySelectorAll("[data-auth-mode]").forEach(button => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function fillProfileForm() {
  const profile = state.dashboard?.profile || {};
  document.getElementById("profileHeadline").value = profile.headline || "";
  document.getElementById("profileBio").value = profile.bio || "";
  document.getElementById("profileRoles").value = (profile.roles || []).join(", ");
  document.getElementById("profileGenres").value = (profile.genres || []).join(", ");
  document.getElementById("profileSkills").value = (profile.skills || []).join(", ");
  document.getElementById("profileLookingFor").value = (profile.lookingFor || []).join(", ");
  document.getElementById("profileRegion").value = profile.regionLabel || "";
  document.getElementById("profileAvailability").value = profile.availability || "open";
  document.getElementById("profileAccent").value = profile.accent || "gold";
  document.getElementById("profileDiscoverable").checked = profile.discoverable !== false;
  document.getElementById("profileMapVisible").checked = Boolean(profile.mapVisible);
}

function openProfileDialog() {
  fillProfileForm();
  elements.profileMessage.textContent = "";
  if (!elements.profileDialog.open) elements.profileDialog.showModal();
}

function openSignalDialog(memberId, memberName) {
  document.getElementById("signalRecipientId").value = memberId;
  document.getElementById("signalRecipientName").textContent = memberName;
  elements.signalForm.reset();
  document.getElementById("signalRecipientId").value = memberId;
  elements.signalMessage.textContent = "";
  elements.signalDialog.showModal();
}

async function loadConversation(conversationId) {
  state.activeConversationId = conversationId;
  renderConversations();
  elements.messageThread.innerHTML = '<div class="signal-empty signal-empty--thread"><span>⌁</span><h4>Opening secure thread</h4><p>Loading the shared conversation.</p></div>';
  try {
    const payload = await api(`?view=messages&conversation=${encodeURIComponent(conversationId)}`);
    renderThread(payload);
    await post("mark_read", { conversationId });
    const conversation = state.dashboard?.conversations.find(item => item.id === conversationId);
    if (conversation) conversation.unread = 0;
    renderConversations();
  } catch (error) {
    elements.messageThread.innerHTML = emptyState("Thread unavailable", error.message, "!");
  }
}

function renderThread(payload) {
  const conversation = payload.conversation;
  const messages = payload.messages || [];
  elements.messageThread.innerHTML = `
    <header class="signal-thread__header">
      <div><h4>${escapeHtml(conversation.displayName)}</h4><small>${escapeHtml(conversation.headline || "Trusted Signal connection")}</small></div>
      <div><button class="signal-text-button" type="button" data-report-member="${escapeHtml(conversation.memberId)}">Report</button> <button class="signal-text-button" type="button" data-block-member="${escapeHtml(conversation.memberId)}">Block</button></div>
    </header>
    <div class="signal-thread__messages" id="threadMessages">
      ${messages.length ? messages.map(message => `<article class="signal-message ${message.mine ? "is-mine" : ""}">${escapeHtml(message.body)}<time datetime="${escapeHtml(message.createdAt)}">${formatTime(message.createdAt, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}</time></article>`).join("") : '<div class="signal-empty signal-empty--thread"><span>✦</span><h4>Connection accepted</h4><p>Send the first private message.</p></div>'}
    </div>
    <form class="signal-message-form" id="messageForm">
      <textarea id="messageBody" maxlength="2400" required placeholder="Write a private message…" aria-label="Message"></textarea>
      <button class="signal-button signal-button--bright" type="submit">Send</button>
    </form>`;
  const messageContainer = document.getElementById("threadMessages");
  if (messageContainer) messageContainer.scrollTop = messageContainer.scrollHeight;
}

function regionPosition(code, index, total) {
  let hash = 0;
  for (const character of code) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  const angle = ((Math.abs(hash) % 360) * Math.PI) / 180 + index * .41;
  const ring = .18 + ((Math.abs(hash >> 3) % 58) / 100);
  return { x: .5 + Math.cos(angle) * ring, y: .5 + Math.sin(angle) * ring * .72, total };
}

function drawMap() {
  cancelAnimationFrame(state.mapFrame);
  if (state.activeTab !== "map" || !elements.mapCanvas) return;
  const canvas = elements.mapCanvas;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const regions = state.dashboard?.regions || [];
  const positions = regions.map((region, index) => ({ ...regionPosition(region.code, index, regions.length), region }));
  const now = (performance.now() - state.mapStartedAt) / 1000;

  context.strokeStyle = "rgba(167,139,250,.13)";
  context.lineWidth = 1;
  positions.forEach((point, index) => {
    const next = positions[(index + 2) % positions.length];
    if (!next) return;
    context.beginPath();
    context.moveTo(point.x * rect.width, point.y * rect.height);
    context.lineTo(next.x * rect.width, next.y * rect.height);
    context.stroke();
  });

  positions.forEach((point, index) => {
    const x = point.x * rect.width;
    const y = point.y * rect.height;
    const live = point.region.activeNow > 0;
    const pulse = live ? 4 + Math.sin(now * 2.4 + index) * 2 : 0;
    context.beginPath();
    context.arc(x, y, 12 + pulse, 0, Math.PI * 2);
    context.fillStyle = live ? "rgba(165,231,95,.08)" : "rgba(167,139,250,.06)";
    context.fill();
    context.beginPath();
    context.arc(x, y, 3.2 + Math.min(5, point.region.members), 0, Math.PI * 2);
    context.fillStyle = live ? "#a5e75f" : "#a78bfa";
    context.shadowBlur = live ? 16 : 8;
    context.shadowColor = context.fillStyle;
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "rgba(242,239,228,.78)";
    context.font = "10px 'Share Tech Mono', monospace";
    context.fillText(point.region.label.toUpperCase(), x + 13, y + 4);
  });

  if (positions.length > 1) {
    positions.forEach((point, index) => {
      const next = positions[(index + 1) % positions.length];
      const progress = (now * .12 + index / positions.length) % 1;
      const x = (point.x + (next.x - point.x) * progress) * rect.width;
      const y = (point.y + (next.y - point.y) * progress) * rect.height;
      context.beginPath();
      context.arc(x, y, 1.8, 0, Math.PI * 2);
      context.fillStyle = "#3ed6d0";
      context.shadowBlur = 10;
      context.shadowColor = "#3ed6d0";
      context.fill();
      context.shadowBlur = 0;
    });
  }
  state.mapFrame = requestAnimationFrame(drawMap);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const identity = window.haloIdentity;
  if (!identity) return;
  elements.authSubmit.disabled = true;
  elements.authMessage.textContent = state.authMode === "signup" ? "Creating membership…" : "Opening network…";
  try {
    if (state.authMode === "signup") {
      const user = await identity.signup(elements.authEmail.value.trim(), elements.authPassword.value, { full_name: elements.authName.value.trim() });
      if (!user?.emailVerified) {
        elements.authMessage.textContent = "Check your email to confirm membership, then return here.";
        return;
      }
    } else {
      await identity.login(elements.authEmail.value.trim(), elements.authPassword.value);
    }
    elements.authDialog.close();
    await loadDashboard();
  } catch (error) {
    elements.authMessage.textContent = error.message || "Membership access failed";
  } finally {
    elements.authSubmit.disabled = false;
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const submit = elements.profileForm.querySelector('[type="submit"]');
  submit.disabled = true;
  elements.profileMessage.textContent = "Saving profile…";
  try {
    const regionLabel = document.getElementById("profileRegion").value.trim();
    const payload = await post("profile", {
      headline: document.getElementById("profileHeadline").value,
      bio: document.getElementById("profileBio").value,
      roles: listFromInput(document.getElementById("profileRoles").value),
      genres: listFromInput(document.getElementById("profileGenres").value),
      skills: listFromInput(document.getElementById("profileSkills").value),
      lookingFor: listFromInput(document.getElementById("profileLookingFor").value),
      regionLabel,
      regionCode: regionLabel,
      availability: document.getElementById("profileAvailability").value,
      accent: document.getElementById("profileAccent").value,
      discoverable: document.getElementById("profileDiscoverable").checked,
      mapVisible: document.getElementById("profileMapVisible").checked
    });
    state.dashboard = payload.dashboard;
    renderDashboard();
    elements.profileDialog.close();
    await loadCollaborators();
    showToast("Signal profile updated");
  } catch (error) {
    elements.profileMessage.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function handleSignalSubmit(event) {
  event.preventDefault();
  const submit = elements.signalForm.querySelector('[type="submit"]');
  submit.disabled = true;
  elements.signalMessage.textContent = "Transmitting…";
  try {
    const payload = await post("signal", {
      targetMemberId: document.getElementById("signalRecipientId").value,
      kind: document.getElementById("signalKind").value,
      subject: document.getElementById("signalSubject").value,
      body: document.getElementById("signalBody").value,
      campaignSlug: document.getElementById("signalCampaignSlug").value
    });
    state.dashboard = payload.dashboard;
    renderDashboard();
    elements.signalDialog.close();
    setTab("signals");
    showToast("Signal transmitted");
  } catch (error) {
    elements.signalMessage.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function respondToSignal(requestId, status) {
  try {
    const payload = await post("respond_signal", { requestId, status });
    state.dashboard = payload.dashboard;
    renderDashboard();
    showToast(status === "accepted" ? "Signal accepted. Private channel opened." : "Signal declined");
    if (payload.conversationId) {
      setTab("messages");
      await loadConversation(payload.conversationId);
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

async function reportMember(memberId, requestId = "") {
  const reason = window.prompt("Briefly tell the HALO review team what happened:");
  if (!reason?.trim()) return;
  try {
    await post("report", { targetMemberId: memberId, requestId, reason });
    showToast("Report sent to the review team");
  } catch (error) { showToast(error.message, true); }
}

async function blockMember(memberId) {
  if (!window.confirm("Block this member? Existing signals are archived and messaging stops.")) return;
  try {
    const payload = await post("block", { targetMemberId: memberId });
    state.dashboard = payload.dashboard;
    state.activeConversationId = "";
    renderDashboard();
    elements.messageThread.innerHTML = emptyState("Member blocked", "This connection can no longer send messages or signals.", "×");
    showToast("Member blocked");
  } catch (error) { showToast(error.message, true); }
}

async function handleMessageSubmit(event) {
  if (event.target.id !== "messageForm") return;
  event.preventDefault();
  const textarea = document.getElementById("messageBody");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const payload = await post("message", { conversationId: state.activeConversationId, body: textarea.value });
    state.dashboard = payload.dashboard;
    renderConversations();
    await loadConversation(state.activeConversationId);
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
}

function signedOutView() {
  cancelAnimationFrame(state.mapFrame);
  state.dashboard = null;
  state.collaborators = [];
  state.activeConversationId = "";
  elements.workspace.hidden = true;
  elements.gate.hidden = false;
  elements.authButton.textContent = "Open Network";
}

function bindEvents() {
  elements.authButton.addEventListener("click", async () => {
    const user = await window.haloIdentity?.getUser();
    if (user) document.getElementById("command-center").scrollIntoView({ behavior: "smooth" });
    else openAuthDialog("signup");
  });
  elements.gateAuthButton.addEventListener("click", () => openAuthDialog("signup"));
  elements.editProfileButton.addEventListener("click", openProfileDialog);
  elements.signOutButton.addEventListener("click", async () => { await window.haloIdentity?.logout(); signedOutView(); });
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.profileForm.addEventListener("submit", handleProfileSubmit);
  elements.signalForm.addEventListener("submit", handleSignalSubmit);
  elements.searchForm.addEventListener("submit", event => { event.preventDefault(); loadCollaborators(); });
  elements.availabilityFilter.addEventListener("change", loadCollaborators);
  elements.messageThread.addEventListener("submit", handleMessageSubmit);

  document.addEventListener("click", event => {
    const tab = event.target.closest("[data-signal-tab]");
    if (tab) setTab(tab.dataset.signalTab);
    const authMode = event.target.closest("[data-auth-mode]");
    if (authMode) setAuthMode(authMode.dataset.authMode);
    const close = event.target.closest("[data-close-dialog]");
    if (close) close.closest("dialog")?.close();
    const signal = event.target.closest("[data-send-signal]");
    if (signal) openSignalDialog(signal.dataset.sendSignal, signal.dataset.memberName);
    const response = event.target.closest("[data-respond-signal]");
    if (response) respondToSignal(response.dataset.respondSignal, response.dataset.status);
    const conversation = event.target.closest("[data-conversation], [data-open-conversation]");
    if (conversation) {
      setTab("messages");
      loadConversation(conversation.dataset.conversation || conversation.dataset.openConversation);
    }
    const report = event.target.closest("[data-report-member]");
    if (report) reportMember(report.dataset.reportMember, report.dataset.requestId || "");
    const block = event.target.closest("[data-block-member]");
    if (block) blockMember(block.dataset.blockMember);
  });

  window.addEventListener("resize", () => { if (state.activeTab === "map") drawMap(); });
}

async function initialize() {
  bindEvents();
  const identity = window.haloIdentity;
  if (!identity) return;
  identity.onAuthChange(async (_event, user) => {
    if (user && !state.dashboard) {
      try { await loadDashboard(); } catch (error) { showToast(error.message, true); }
    }
    if (!user) signedOutView();
  });
  const user = await identity.getUser();
  if (!user) return signedOutView();
  try { await loadDashboard(); }
  catch (error) { signedOutView(); showToast(error.message, true); }
}

if (window.haloIdentity) initialize();
else window.addEventListener("halo-identity-ready", initialize, { once: true });
