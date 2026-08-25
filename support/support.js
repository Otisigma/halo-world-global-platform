const state = { identity: null, user: null, authMode: "login", publicRequests: [], myRequests: [] };
const byId = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Recently" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function label(value) {
  return String(value || "").replaceAll("_", " ");
}

async function api(path = "", options = {}) {
  const response = await fetch(`/api/support-feedback${path}`, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "The request could not be completed");
  return data;
}

function publicCard(request) {
  return `<article class="signal-card" data-request-key="${escapeHtml(request.requestKey)}">
    <header><span>Feature signal</span><span class="status">${escapeHtml(label(request.status))}</span></header>
    <h3>${escapeHtml(request.title)}</h3>
    <p>${escapeHtml(request.details)}</p>
    ${request.staffNote ? `<p class="staff-note"><strong>HALO response:</strong> ${escapeHtml(request.staffNote)}</p>` : ""}
    <footer><small>${escapeHtml(formatDate(request.createdAt))}</small><button class="vote-button${request.viewerVoted ? " is-voted" : ""}" type="button" data-vote="${escapeHtml(request.requestKey)}" ${request.viewerVoted ? "disabled" : ""}><span>↑</span>${request.viewerVoted ? "Supported" : "Support"} · ${request.voteCount}</button></footer>
  </article>`;
}

function privateCard(request) {
  return `<article class="request-card">
    <header><span>${escapeHtml(request.category)}</span><span class="status">${escapeHtml(label(request.status))}</span></header>
    <h3>${escapeHtml(request.title)}</h3>
    <p>${escapeHtml(request.details)}</p>
    ${request.staffNote ? `<p class="staff-note"><strong>HALO response:</strong> ${escapeHtml(request.staffNote)}</p>` : ""}
    <footer><small>${escapeHtml(formatDate(request.createdAt))} · ${escapeHtml(request.requestKey.slice(0, 8).toUpperCase())}</small></footer>
  </article>`;
}

function renderPublic() {
  byId("public-list").innerHTML = state.publicRequests.length
    ? state.publicRequests.map(publicCard).join("")
    : '<p class="empty-note">No public feature signals yet. Send the first one.</p>';
}

function renderMine() {
  byId("my-list").innerHTML = state.user
    ? state.myRequests.length ? state.myRequests.map(privateCard).join("") : '<p class="empty-note">Your feedback record is clear. Send a signal when you need us.</p>'
    : '<p class="empty-note">Sign in to see your feedback history.</p>';
}

async function loadPublic() {
  try {
    state.publicRequests = (await api()).requests || [];
    renderPublic();
  } catch (error) {
    byId("public-list").innerHTML = `<p class="empty-note">${escapeHtml(error.message)}</p>`;
  }
}

async function loadMine() {
  if (!state.user) { state.myRequests = []; renderMine(); return; }
  try {
    state.myRequests = (await api("?scope=mine")).requests || [];
    renderMine();
  } catch (error) {
    byId("my-list").innerHTML = `<p class="empty-note">${escapeHtml(error.message)}</p>`;
  }
}

function setSignedIn(user) {
  state.user = user;
  byId("account-button").textContent = user ? "Sign out" : "Join / sign in";
  byId("auth-gate").hidden = Boolean(user);
  byId("feedback-form").hidden = !user;
  loadMine();
  loadPublic();
}

function openAuth() {
  byId("auth-status").textContent = "";
  byId("auth-dialog").showModal();
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("is-active", button.dataset.authMode === mode));
  document.querySelector(".auth-name").hidden = mode !== "signup";
  byId("auth-form").elements.password.autocomplete = mode === "signup" ? "new-password" : "current-password";
}

async function connectIdentity(identity) {
  if (state.identity) return;
  state.identity = identity;
  setSignedIn(await identity.getUser().catch(() => null));
  identity.onAuthChange((_event, user) => setSignedIn(user));
}

document.querySelectorAll("[data-open-auth]").forEach(button => button.addEventListener("click", openAuth));
byId("dialog-close").addEventListener("click", () => byId("auth-dialog").close());
document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));

byId("account-button").addEventListener("click", async () => {
  if (!state.user) { openAuth(); return; }
  await state.identity?.logout();
});

byId("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = byId("auth-status");
  status.className = "auth-status";
  status.textContent = "Connecting…";
  try {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (state.authMode === "signup") {
      await state.identity.signup(email, password, { full_name: form.elements.name.value.trim() });
      status.classList.add("is-success");
      status.textContent = "Check your email to confirm your HALO account.";
      return;
    }
    const user = await state.identity.login(email, password);
    setSignedIn(user);
    byId("auth-dialog").close();
    form.reset();
  } catch (error) {
    status.classList.add("is-error");
    status.textContent = error.message || "Member access failed";
  }
});

document.querySelectorAll('input[name="category"]').forEach(input => input.addEventListener("change", () => {
  const feature = byId("feedback-form").elements.category.value === "feature";
  byId("public-choice").hidden = !feature;
  if (!feature) byId("feedback-form").elements.public.checked = false;
}));

byId("feedback-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = byId("form-status");
  const submit = form.querySelector('button[type="submit"]');
  status.className = "form-status";
  status.textContent = "Sending signal…";
  submit.disabled = true;
  try {
    const data = await api("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: form.elements.category.value,
        title: form.elements.title.value,
        details: form.elements.details.value,
        pageUrl: form.elements.pageUrl.value,
        public: form.elements.public.checked
      })
    });
    form.reset();
    byId("public-choice").hidden = true;
    status.classList.add("is-success");
    status.textContent = `Received · reference ${data.request.requestKey.slice(0, 8).toUpperCase()}`;
    await Promise.all([loadMine(), loadPublic()]);
  } catch (error) {
    status.classList.add("is-error");
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

byId("public-list").addEventListener("click", async event => {
  const button = event.target.closest("[data-vote]");
  if (!button) return;
  if (!state.user) { openAuth(); return; }
  button.disabled = true;
  try {
    const data = await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "vote", requestKey: button.dataset.vote }) });
    const index = state.publicRequests.findIndex(request => request.requestKey === data.request.requestKey);
    if (index >= 0) state.publicRequests[index] = data.request;
    renderPublic();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message;
  }
});

window.addEventListener("halo-identity-ready", event => connectIdentity(event.detail), { once: true });
if (window.haloIdentity) connectIdentity(window.haloIdentity);
loadPublic();
