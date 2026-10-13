// Circle Members directory: loads the signed-in member's circle roster from
// /api/circles/members and renders it into the three concentric tiers.
export const CIRCLE_API_URL = "/api/circles/members";
export const CIRCLE_LIST_IDS = Object.freeze({
  artist_core: "artistCoreList",
  creative_team: "creativeTeamList",
  extended_world: "extendedWorldList"
});
const STATUS_CLASSES = { active: "is-active", pending: "is-pending" };

export function listIdForCircle(circleName) {
  return CIRCLE_LIST_IDS[circleName] || CIRCLE_LIST_IDS.extended_world;
}

export function groupMembersByCircle(members) {
  const groups = { artist_core: [], creative_team: [], extended_world: [] };
  for (const member of Array.isArray(members) ? members : []) {
    if (!member || typeof member.email !== "string" || !member.email) continue;
    const circle = CIRCLE_LIST_IDS[member.circle_name] ? member.circle_name : "extended_world";
    groups[circle].push(member);
  }
  return groups;
}

export function createMemberRow(doc, member) {
  const status = member.status === "active" ? "active" : "pending";
  const row = doc.createElement("li");
  row.className = "circle-member";

  const identity = doc.createElement("div");
  identity.className = "circle-member__identity";
  const email = doc.createElement("p");
  email.className = "circle-member__email";
  email.textContent = String(member.email);
  email.title = String(member.email);
  const role = doc.createElement("span");
  role.className = "circle-member__role";
  role.textContent = member.self ? "You · admin" : String(member.role || "collaborator");
  identity.append(email, role);

  const badge = doc.createElement("span");
  badge.className = `circle-member__status ${STATUS_CLASSES[status]}`;
  badge.textContent = status;

  row.append(identity, badge);
  return row;
}

function createEmptyRow(doc) {
  const row = doc.createElement("li");
  row.className = "circle-member circle-member--empty";
  row.textContent = "No members yet — send the first invite.";
  return row;
}

export function renderCircleMembers(members, doc = document) {
  const groups = groupMembersByCircle(members);
  for (const [circle, listId] of Object.entries(CIRCLE_LIST_IDS)) {
    const listEl = doc.getElementById(listId);
    if (!listEl) continue;
    listEl.innerHTML = "";
    const tierMembers = groups[circle];
    if (!tierMembers.length) listEl.append(createEmptyRow(doc));
    for (const member of tierMembers) listEl.append(createMemberRow(doc, member));
    const count = doc.querySelector(`[data-circle-count="${circle}"]`);
    if (count) count.textContent = `${tierMembers.length} ${tierMembers.length === 1 ? "member" : "members"}`;
  }
  return groups;
}

function setStatus(doc, message, isError = false) {
  const status = doc.getElementById("circleDirectoryStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

async function request(fetchImpl, options = {}) {
  const response = await fetchImpl(CIRCLE_API_URL, {
    credentials: "same-origin",
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Circle directory request failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function fetchCircleMembers({ fetchImpl = globalThis.fetch, doc = document } = {}) {
  setStatus(doc, "Loading your circles…");
  try {
    const data = await request(fetchImpl);
    const groups = renderCircleMembers(data.members, doc);
    setStatus(doc, "");
    return groups;
  } catch (error) {
    renderCircleMembers([], doc);
    setStatus(doc, error.status === 401 ? "Sign in to Signal Network to see and invite your circle members." : error.message, error.status !== 401);
    console.error("Error loading circle directory:", error);
    return null;
  }
}

export async function inviteCircleMember(invite, { fetchImpl = globalThis.fetch, doc = document } = {}) {
  const data = await request(fetchImpl, {
    method: "POST",
    body: JSON.stringify({ action: "invite", email: invite.email, circle_name: invite.circle_name, role: invite.role })
  });
  renderCircleMembers(data.members, doc);
  return data;
}

export function openInviteModal(circleName = "", doc = document) {
  const dialog = doc.getElementById("circleInviteDialog");
  if (!dialog) return;
  const select = doc.getElementById("circleInviteCircle");
  if (select && CIRCLE_LIST_IDS[circleName]) select.value = circleName;
  const message = doc.getElementById("circleInviteMessage");
  if (message) message.textContent = "";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  doc.getElementById("circleInviteEmail")?.focus();
}

function bindDirectory(doc) {
  doc.addEventListener("click", event => {
    const trigger = event.target.closest?.("[data-circle-invite]");
    if (trigger) openInviteModal(trigger.dataset.circleInvite, doc);
  });

  const form = doc.getElementById("circleInviteForm");
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const message = doc.getElementById("circleInviteMessage");
    if (submit) submit.disabled = true;
    try {
      await inviteCircleMember({
        email: doc.getElementById("circleInviteEmail").value.trim(),
        circle_name: doc.getElementById("circleInviteCircle").value,
        role: doc.getElementById("circleInviteRole").value
      }, { doc });
      form.reset();
      doc.getElementById("circleInviteDialog")?.close?.();
      setStatus(doc, "Invite recorded — it shows as pending until they join.");
    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function initialize() {
  bindDirectory(document);
  fetchCircleMembers();
  const watchIdentity = () => window.haloIdentity?.onAuthChange?.(() => fetchCircleMembers());
  if (window.haloIdentity) watchIdentity();
  else window.addEventListener("halo-identity-ready", watchIdentity, { once: true });
}

if (typeof window !== "undefined" && typeof document !== "undefined" && document.getElementById("circleDirectory")) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
}
