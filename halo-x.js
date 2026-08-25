(() => {
  const state = { user: null, dashboard: null, authMode: "login", unsubscribe: null };
  const elements = {};

  function byId(id) { return document.getElementById(id); }
  function text(id, value) { byId(id).textContent = value; }
  function setMessage(id, message, type = "") {
    const element = byId(id);
    element.textContent = message || "";
    element.className = `${element.dataset.messageClass || "form-message"}${type ? ` ${type}` : ""}`;
  }
  function formatDate(value, options = {}) {
    if (!value) return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", ...options }).format(new Date(value));
  }
  function tierLabel(tier) {
    return { member: "MEMBER", gold: "GOLD", backstage: "BACKSTAGE", founder: "FOUNDER" }[tier] || "MEMBER";
  }

  async function request(payload) {
    const response = await fetch("/api/halo-x", {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "HALO X could not complete that request");
    return data;
  }

  async function shareInviteRequest(payload) {
    const response = await fetch("/api/share-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The invitation could not be created");
    return data;
  }

  async function shareHalo() {
    const button = byId("shareHaloButton");
    button.disabled = true;
    setMessage("shareHaloMessage", "Creating a fresh tracked invitation…");
    try {
      const invite = await shareInviteRequest({ action: "create" });
      const shareData = {
        title: "Join me in HALO Music World",
        text: "Create your HALO account and step into the music world with me.",
        url: invite.url
      };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          await shareInviteRequest({ action: "shared", token: invite.token });
          setMessage("shareHaloMessage", "Shared. Visits and completed accounts now connect back to this invitation.", "success");
        } catch (error) {
          if (error?.name !== "AbortError") throw error;
          setMessage("shareHaloMessage", "Invitation ready. Press again whenever you want to share it.");
        }
      } else {
        await navigator.clipboard.writeText(invite.url);
        await shareInviteRequest({ action: "shared", token: invite.token });
        setMessage("shareHaloMessage", "Tracked invitation copied. Paste it anywhere you want to share HALO.", "success");
      }
    } catch (error) {
      setMessage("shareHaloMessage", error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function showSignedOut() {
    byId("signedOutView").hidden = false;
    byId("dashboardView").hidden = true;
    byId("authButton").textContent = "Sign in";
    byId("heroAccessButton").textContent = "Activate access";
  }

  function renderDashboard(dashboard) {
    state.dashboard = dashboard;
    byId("signedOutView").hidden = true;
    byId("dashboardView").hidden = false;
    byId("authButton").textContent = "Sign out";
    byId("heroAccessButton").textContent = dashboard.membership.fullAccess ? "Access active" : "Attach a pass";
    text("memberName", dashboard.membership.displayName);
    text("tierBadge", tierLabel(dashboard.membership.tier));
    text("accessStatus", dashboard.membership.fullAccess ? "Full access active" : "Membership active");
    text("accessDetail", dashboard.membership.accessEndsAt ? `Access through ${formatDate(dashboard.membership.accessEndsAt)}` : dashboard.membership.fullAccess ? "Permanent account key" : "A pass opens DJ HALO X features");
    text("accessCopy", dashboard.membership.fullAccess
      ? "Your account carries full DJ HALO X access. Invitations are no longer needed on this device or the next one."
      : "Attach a Gold Ticket, Backstage Pass, Event Pass, or Founders Key to open the complete DJ HALO X experience.");

    const pin = dashboard.roomPin;
    byId("pinTitle").value = pin?.title || "";
    byId("pinBody").value = pin?.body || "";
    byId("pinUrl").value = pin?.destinationUrl || "";
    byId("pinCta").value = pin?.ctaLabel || "Open";
    byId("clearPinButton").disabled = !pin;

    const session = dashboard.savedSession;
    byId("sessionState").innerHTML = session
      ? `<span class="pulse"></span><div><strong>${escapeHtml(session.name)}</strong><small>Revision ${session.revision} saved ${escapeHtml(formatDate(session.updatedAt, { hour: "numeric", minute: "2-digit" }))}.</small></div>`
      : '<span class="pulse"></span><div><strong>No cloud session yet</strong><small>Open the DJ console while signed in to create the first recoverable snapshot.</small></div>';

    byId("ownerSection").hidden = !dashboard.canViewReports;
    if (dashboard.canViewReports) renderOwner(dashboard);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function renderOwner(dashboard) {
    const report = dashboard.reports?.[0];
    const metrics = report?.metrics || {};
    const metricItems = [
      [metrics.totalMembers || 0, "Total members"],
      [metrics.joinedToday || 0, "Joined today"],
      [metrics.uniqueVisitorsToday || 0, "Visitors today"],
      [metrics.pageViewsToday || 0, "Page views today"],
      [metrics.active24h || 0, "Active in 24 hours"],
      [metrics.onlineNow || 0, "Online now"],
      [metrics.passesRedeemedToday || 0, "Passes activated"],
      [metrics.djSessionsSavedToday || 0, "DJ sessions saved"],
      [metrics.roomMessagesToday || 0, "Room messages"],
      [metrics.supportSignalsToday || 0, "Support signals"]
    ];
    byId("reportMetrics").innerHTML = metricItems.map(([value, label]) => `<div class="metric"><strong>${Number(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");
    text("reportDate", report ? formatDate(report.date) : "Awaiting first report");
    const joins = report?.recentJoins || [];
    byId("recentJoins").innerHTML = joins.length
      ? joins.map(join => `<div class="join-row"><div><strong>${escapeHtml(join.displayName)}</strong><small>${escapeHtml(formatDate(join.joinedAt, { hour: "numeric", minute: "2-digit" }))}</small></div><span>${escapeHtml(tierLabel(join.tier))}</span></div>`).join("")
      : '<p class="empty-row">No new members are recorded yet.</p>';
    byId("passLedger").innerHTML = dashboard.passes?.length
      ? dashboard.passes.map(pass => `<div class="ledger-row"><strong>${escapeHtml(pass.label)}</strong><small>${escapeHtml(pass.type.replaceAll("_", " "))}</small><span>${pass.redemptionCount} / ${pass.maxRedemptions}</span><small>Ends ${pass.expiresAt ? escapeHtml(formatDate(pass.expiresAt)) : "when retired"} · ${escapeHtml(pass.codeHint)}</small></div>`).join("")
      : '<p class="empty-row">No private invitations have been created.</p>';
  }

  async function loadDashboard() {
    if (!state.user) return showSignedOut();
    try {
      renderDashboard(await request());
    } catch (error) {
      setMessage("redeemMessage", error.message, "error");
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    document.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
    byId("nameField").hidden = mode !== "signup";
    byId("authName").required = mode === "signup";
    byId("authPassword").autocomplete = mode === "signup" ? "new-password" : "current-password";
    byId("authSubmit").textContent = mode === "signup" ? "Create my HALO account" : "Enter DJ HALO X";
    setMessage("authMessage", "");
  }

  async function handleAuth(event) {
    event.preventDefault();
    const api = window.haloIdentity;
    if (!api) return setMessage("authMessage", "Membership service is still connecting", "error");
    byId("authSubmit").disabled = true;
    setMessage("authMessage", state.authMode === "signup" ? "Creating your place…" : "Opening your account…");
    try {
      if (state.authMode === "signup") {
        const user = await api.signup(byId("authEmail").value.trim(), byId("authPassword").value, { full_name: byId("authName").value.trim() });
        if (!user.emailVerified) {
          setMessage("authMessage", "Check your email to confirm the account, then return to activate your pass.", "success");
          setAuthMode("login");
          return;
        }
        state.user = user;
      } else {
        state.user = await api.login(byId("authEmail").value.trim(), byId("authPassword").value);
      }
      window.haloStats?.track("halo_x_auth", { mode: state.authMode });
      await loadDashboard();
    } catch (error) {
      setMessage("authMessage", error.message || "Account access failed", "error");
    } finally {
      byId("authSubmit").disabled = false;
    }
  }

  async function connectIdentity() {
    if (!window.haloIdentity) return;
    state.user = await window.haloIdentity.getUser().catch(() => null);
    state.unsubscribe?.();
    state.unsubscribe = window.haloIdentity.onAuthChange((_event, user) => {
      state.user = user;
      user ? loadDashboard() : showSignedOut();
    });
    state.user ? loadDashboard() : showSignedOut();
  }

  async function submitAction(payload, messageId) {
    try {
      const data = await request(payload);
      if (data.dashboard) renderDashboard(data.dashboard);
      setMessage(messageId, data.message, "success");
      return data;
    } catch (error) {
      setMessage(messageId, error.message, "error");
      return null;
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
    byId("authForm").addEventListener("submit", handleAuth);
    byId("authButton").addEventListener("click", async () => {
      if (state.user) await window.haloIdentity?.logout();
      else byId("signedOutView").scrollIntoView({ behavior: "smooth" });
    });
    byId("heroAccessButton").addEventListener("click", () => (state.user ? byId("passCode") : byId("authEmail")).focus());
    byId("redeemForm").addEventListener("submit", async event => {
      event.preventDefault();
      const data = await submitAction({ action: "redeem_pass", code: byId("passCode").value }, "redeemMessage");
      if (data) byId("passCode").value = "";
    });
    byId("pinForm").addEventListener("submit", async event => {
      event.preventDefault();
      await submitAction({ action: "save_room_pin", title: byId("pinTitle").value, body: byId("pinBody").value, destinationUrl: byId("pinUrl").value, ctaLabel: byId("pinCta").value }, "pinMessage");
    });
    byId("clearPinButton").addEventListener("click", () => submitAction({ action: "clear_room_pin" }, "pinMessage"));
    byId("refreshReportButton").addEventListener("click", () => submitAction({ action: "refresh_report" }, "passMessage"));
    byId("shareHaloButton").addEventListener("click", shareHalo);
    byId("passForm").addEventListener("submit", async event => {
      event.preventDefault();
      const data = await submitAction({ action: "create_pass", passType: byId("passType").value, label: byId("passLabel").value, maxRedemptions: byId("passLimit").value, expiresAt: byId("passExpiry").value }, "passMessage");
      if (!data?.code) return;
      byId("createdPass").hidden = false;
      text("createdPassCode", data.code);
      const refreshed = await request();
      renderDashboard(refreshed);
    });
    byId("copyPassButton").addEventListener("click", async () => {
      await navigator.clipboard.writeText(byId("createdPassCode").textContent);
      byId("copyPassButton").textContent = "Copied";
    });
  }

  function applyAccessLink() {
    const passCode = new URLSearchParams(window.location.search).get("pass");
    if (!passCode) return;
    byId("passCode").value = passCode.replace(/^#/, "").slice(0, 96);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    applyAccessLink();
    setAuthMode("login");
    if (window.haloIdentity) connectIdentity();
    else window.addEventListener("halo-identity-ready", connectIdentity, { once: true });
  });
})();
