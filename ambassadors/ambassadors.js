const state = {
  user: null,
  data: null,
  authMode: "login",
  busy: false
};

const focusLabels = {
  "creator-support": "Creator support",
  "community-care": "Community care",
  events: "Events and rooms",
  technology: "Technology and testing",
  education: "Education and mentorship",
  "global-outreach": "Global outreach"
};

const elements = {
  accountButton: document.querySelector("#accountButton"),
  accountName: document.querySelector("#accountName"),
  ambassadorCount: document.querySelector("#ambassadorCount"),
  memberWorkspace: document.querySelector("#memberWorkspace"),
  roster: document.querySelector("#ambassadorRoster"),
  councilSection: document.querySelector("#councilSection"),
  councilWorkspace: document.querySelector("#councilWorkspace"),
  notice: document.querySelector("#notice"),
  authDialog: document.querySelector("#authDialog"),
  authForm: document.querySelector("#authForm"),
  authTitle: document.querySelector("#authTitle"),
  authIntro: document.querySelector("#authIntro"),
  authSubmit: document.querySelector("#authSubmit"),
  authMessage: document.querySelector("#authMessage"),
  nameField: document.querySelector("#nameField"),
  authName: document.querySelector("#authName"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword")
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "Founding era";
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(value));
}

function statusLabel(value) {
  return String(value || "not started").replaceAll("_", " ");
}

function showNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", error);
  elements.notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { elements.notice.hidden = true; }, 4200);
}

async function waitForIdentity() {
  if (window.haloIdentity) return window.haloIdentity;
  await new Promise(resolve => window.addEventListener("halo-identity-ready", resolve, { once: true }));
  return window.haloIdentity;
}

async function loadState() {
  try {
    const response = await fetch("/api/ambassadors", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "The Ambassador register could not be loaded.");
    state.data = data;
    render();
  } catch (error) {
    elements.memberWorkspace.innerHTML = `<section class="panel"><p class="panel-label">Signal interrupted</p><h3>Workspace unavailable</h3><p class="panel-copy">${escapeHtml(error.message)}</p></section>`;
    showNotice(error.message || "The Ambassador register could not be loaded.", true);
  }
}

async function postAction(payload) {
  if (state.busy) return;
  state.busy = true;
  document.body.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/ambassadors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "That Ambassador action did not land.");
    state.data = data;
    render();
    showNotice(data.message || "Ambassador workspace updated.");
  } catch (error) {
    showNotice(error.message || "That Ambassador action did not land.", true);
  } finally {
    state.busy = false;
    document.body.removeAttribute("aria-busy");
  }
}

function applicationForm(application = {}) {
  const focusOptions = Object.entries(focusLabels).map(([value, label]) => `<option value="${value}" ${application.focusArea === value ? "selected" : ""}>${label}</option>`).join("");
  return `
    <form id="applicationForm">
      <label><span>Why this responsibility matters to you</span><textarea name="statement" minlength="80" maxlength="1200" required placeholder="Describe how you understand the role and why you are ready to carry it.">${escapeHtml(application.statement || "")}</textarea></label>
      <p class="field-help">Minimum 80 characters. This remains private to the review council.</p>
      <label><span>Contributions you have already made</span><textarea name="contributions" minlength="80" maxlength="1200" required placeholder="Share specific ways you have supported creators or strengthened a community.">${escapeHtml(application.contributions || "")}</textarea></label>
      <div class="field-grid">
        <label><span>Primary service focus</span><select name="focusArea" required><option value="">Choose a focus</option>${focusOptions}</select></label>
        <label><span>Availability</span><input name="availability" maxlength="240" value="${escapeHtml(application.availability || "")}" placeholder="For example: two hours weekly"></label>
      </div>
      <div class="form-actions"><button class="button button-primary" type="submit">${application.status === "declined" || application.status === "withdrawn" ? "Resubmit for review" : "Submit application"}</button></div>
    </form>`;
}

function renderApplicationPanel(data) {
  if (data.isAmbassador) {
    return `<section class="panel panel-dark"><div class="panel-heading"><div><p class="panel-label">Active service</p><h3>Sovereign Ambassador</h3></div><span class="status-chip">Granted ${escapeHtml(formatDate(data.grantedAt))}</span></div><p class="panel-copy">Your service signal is active across the HALO community. Keep contributing without turning the role into rank.</p></section>`;
  }

  const application = data.application;
  if (application && ["submitted", "under_review"].includes(application.status)) {
    return `<section class="panel"><div class="panel-heading"><div><p class="panel-label">Your application</p><h3>${application.status === "under_review" ? "Council review in progress" : "Application received"}</h3></div><span class="status-chip">${escapeHtml(statusLabel(application.status))}</span></div><p class="panel-copy">Submitted ${escapeHtml(formatDate(application.submittedAt))}. The council can see your statement and contribution record; the public cannot.</p><div class="form-actions"><button class="button button-quiet" type="button" data-withdraw>Withdraw application</button></div></section>`;
  }

  const feedback = application?.status === "declined" && application.reviewNotes
    ? `<div class="nomination"><strong>Private council feedback</strong><p>${escapeHtml(application.reviewNotes)}</p></div>`
    : "";
  return `<section class="panel"><div class="panel-heading"><div><p class="panel-label">Application</p><h3>${application ? "Return to the path" : "Put your service forward"}</h3></div>${application ? `<span class="status-chip">${escapeHtml(statusLabel(application.status))}</span>` : ""}</div>${feedback}${applicationForm(application || {})}</section>`;
}

function renderNominationPanel(data) {
  const nominations = data.nominations || [];
  const nominationMarkup = nominations.length ? `<div class="nomination-list">${nominations.map(nomination => `<article class="nomination"><strong>Nominated by ${escapeHtml(nomination.nominatorName)}</strong><p>${escapeHtml(nomination.reason)}</p><button class="link-button" type="button" data-dismiss-nomination="${nomination.id}">Dismiss privately</button></article>`).join("")}</div>` : `<p class="panel-copy">No one has nominated you yet. That is not required—you can apply through your own record of service.</p>`;
  const peopleOptions = (data.eligiblePeople || []).map(person => `<option value="${escapeHtml(person.actorId)}">${escapeHtml(person.displayName)} · ${escapeHtml(person.region)}</option>`).join("");
  return `<section class="panel panel-dark"><div class="panel-heading"><div><p class="panel-label">Community nominations</p><h3>Recognize someone else</h3></div><span class="status-chip">${nominations.length} received</span></div>${nominationMarkup}<form id="nominationForm"><label><span>Community member</span><select name="nomineeActorId" required><option value="">Choose a contributor</option>${peopleOptions}</select></label><label><span>Why their service stands out</span><textarea name="reason" minlength="40" maxlength="600" required placeholder="Point to a real pattern of care, contribution, or creator support."></textarea></label><button class="button button-primary" type="submit">Send private nomination</button></form></section>`;
}

function renderMemberWorkspace(data) {
  if (!data.authenticated) {
    elements.memberWorkspace.innerHTML = `<section class="panel signed-out-panel"><p class="panel-label">Membership required</p><h3>Sign in to enter the path</h3><p class="panel-copy">Your application, nominations, and review notes stay attached to your HALO membership.</p><button class="button button-primary" type="button" data-open-auth>Join or sign in</button></section><section class="panel panel-dark signed-out-panel"><p class="panel-label">Privacy promise</p><h3>Human decisions, recorded carefully</h3><p class="panel-copy">Applications are visible only to designated council roles. Public pages show active Ambassadors, never private statements or declined applications.</p></section>`;
    return;
  }
  elements.memberWorkspace.innerHTML = renderApplicationPanel(data) + renderNominationPanel(data);
}

function renderRoster(data) {
  const ambassadors = data.ambassadors || [];
  elements.ambassadorCount.textContent = String(data.stats?.ambassadors ?? ambassadors.length);
  elements.roster.innerHTML = ambassadors.length
    ? ambassadors.map((person, index) => `<article class="roster-person"><span class="roster-number">${String(index + 1).padStart(2, "0")}</span><div><h3>${escapeHtml(person.displayName)}</h3><p>${escapeHtml(person.region)} · ${escapeHtml(person.vibeStatus)}</p></div><span class="roster-date">Serving since ${escapeHtml(formatDate(person.grantedAt))}</span><span class="signal-mark" aria-label="Sovereign Ambassador">S</span></article>`).join("")
    : `<p class="empty-copy">The founding register is open. The first Ambassadors have not been appointed yet.</p>`;
}

function renderCouncil(data) {
  elements.councilSection.hidden = !data.council;
  if (!data.council) return;
  const queue = data.reviewQueue || [];
  const queueMarkup = queue.length ? queue.map(application => `
    <details class="review-card">
      <summary class="review-summary"><div><h3>${escapeHtml(application.displayName)}</h3><p>${escapeHtml(focusLabels[application.focusArea] || application.focusArea)} · ${application.nominationCount} nomination${application.nominationCount === 1 ? "" : "s"} · submitted ${escapeHtml(formatDate(application.submittedAt))}</p></div><span class="status-chip">${escapeHtml(statusLabel(application.status))}</span></summary>
      <div class="review-body">
        <div class="evidence"><article><h4>Statement</h4><p>${escapeHtml(application.statement)}</p></article><article><h4>Contribution record</h4><p>${escapeHtml(application.contributions)}</p></article></div>
        <p class="panel-copy">Availability: ${escapeHtml(application.availability || "Not specified")}</p>
        <label><span>Private review note</span><textarea data-review-note="${application.id}" maxlength="600" placeholder="Record context, feedback, or the reason for the decision.">${escapeHtml(application.reviewNotes || "")}</textarea></label>
        <div class="review-actions"><button class="button" type="button" data-review="under_review" data-application-id="${application.id}">Mark in review</button><button class="button approve" type="button" data-review="approved" data-application-id="${application.id}">Approve role</button><button class="button" type="button" data-review="declined" data-application-id="${application.id}">Decline with feedback</button></div>
      </div>
    </details>`).join("") : `<p class="empty-copy">No applications are waiting for review.</p>`;
  const ambassadorOptions = (data.ambassadors || []).map(person => `<option value="${escapeHtml(person.actorId)}">${escapeHtml(person.displayName)}</option>`).join("");
  elements.councilWorkspace.innerHTML = `<div class="queue">${queueMarkup}</div><form id="revokeForm" class="council-tools"><p class="panel-label">Term management</p><h3>Close an active service term</h3><label><span>Ambassador</span><select name="targetActorId" required><option value="">Choose an active Ambassador</option>${ambassadorOptions}</select></label><label><span>Private record</span><textarea name="notes" minlength="10" maxlength="600" required placeholder="Record why the term is being closed."></textarea></label><button class="button button-danger" type="submit">Revoke Ambassador role</button></form>`;
}

function renderAccount() {
  elements.accountName.textContent = state.user?.name || state.user?.email || "Visitor";
  elements.accountButton.textContent = state.user ? "Sign out" : "Join / Sign in";
}

function render() {
  if (!state.data) return;
  renderAccount();
  renderMemberWorkspace(state.data);
  renderRoster(state.data);
  renderCouncil(state.data);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  elements.nameField.hidden = !signup;
  elements.authName.required = signup;
  elements.authPassword.autocomplete = signup ? "new-password" : "current-password";
  elements.authTitle.textContent = signup ? "Join the movement" : "Enter the community";
  elements.authIntro.textContent = signup ? "Create a HALO membership before entering the Ambassador path." : "Sign in to apply, nominate a contributor, or review your status.";
  elements.authSubmit.textContent = signup ? "Create membership" : "Sign in";
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  elements.authMessage.textContent = "";
}

function openAuth() {
  setAuthMode("login");
  elements.authDialog.showModal();
  elements.authEmail.focus();
}

document.addEventListener("click", async event => {
  const openButton = event.target.closest("[data-open-auth]");
  if (openButton) openAuth();

  const closeButton = event.target.closest("[data-close-dialog]");
  if (closeButton) elements.authDialog.close();

  const modeButton = event.target.closest("[data-auth-mode]");
  if (modeButton) setAuthMode(modeButton.dataset.authMode);

  const withdrawButton = event.target.closest("[data-withdraw]");
  if (withdrawButton && window.confirm("Withdraw this application from council review?")) await postAction({ action: "withdraw" });

  const dismissButton = event.target.closest("[data-dismiss-nomination]");
  if (dismissButton) await postAction({ action: "dismiss_nomination", nominationId: Number(dismissButton.dataset.dismissNomination) });

  const reviewButton = event.target.closest("[data-review]");
  if (reviewButton) {
    const applicationId = Number(reviewButton.dataset.applicationId);
    const note = document.querySelector(`[data-review-note="${applicationId}"]`)?.value || "";
    await postAction({ action: "review", applicationId, decision: reviewButton.dataset.review, notes: note });
  }
});

document.addEventListener("submit", async event => {
  if (event.target.id === "applicationForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    await postAction({ action: "apply", statement: form.get("statement"), contributions: form.get("contributions"), focusArea: form.get("focusArea"), availability: form.get("availability") });
  }
  if (event.target.id === "nominationForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    await postAction({ action: "nominate", nomineeActorId: form.get("nomineeActorId"), reason: form.get("reason") });
  }
  if (event.target.id === "revokeForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    if (window.confirm("Close this Ambassador service term and record the decision?")) await postAction({ action: "revoke", targetActorId: form.get("targetActorId"), notes: form.get("notes") });
  }
});

elements.accountButton.addEventListener("click", async () => {
  if (!state.user) return openAuth();
  await window.haloIdentity?.logout();
  state.user = null;
  await loadState();
  showNotice("You are signed out.");
});

elements.authForm.addEventListener("submit", async event => {
  event.preventDefault();
  elements.authMessage.textContent = "";
  elements.authSubmit.disabled = true;
  try {
    const identity = await waitForIdentity();
    if (state.authMode === "signup") {
      const user = await identity.signup(elements.authEmail.value.trim(), elements.authPassword.value, { full_name: elements.authName.value.trim() });
      if (!user?.emailVerified) {
        setAuthMode("login");
        elements.authMessage.textContent = "Check your inbox to confirm your membership, then sign in.";
        return;
      }
      state.user = user;
    } else {
      state.user = await identity.login(elements.authEmail.value.trim(), elements.authPassword.value);
    }
    elements.authDialog.close();
    elements.authForm.reset();
    await loadState();
    showNotice("Welcome to the Ambassador path.");
  } catch (error) {
    elements.authMessage.textContent = error?.status === 401 ? "The email or password did not match." : (error?.message || "Membership could not be completed.");
  } finally {
    elements.authSubmit.disabled = false;
  }
});

async function initialize() {
  const identity = await waitForIdentity();
  state.user = await identity.getUser().catch(() => null);
  renderAccount();
  await loadState();
}

initialize();
