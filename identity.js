import {
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  signup
} from "https://esm.sh/@netlify/identity@1.2.0";

const identity = { getUser, login, logout, onAuthChange, signup: trackedSignup };
const inviteStorageKey = "halo-share-invite";

window.haloIdentity = identity;

function relationshipSessionKey() {
  const storageKey = "halo-relationship-session";
  let value = sessionStorage.getItem(storageKey);
  if (value) return value;
  value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(storageKey, value);
  return value;
}

async function recordRelationshipEvent(eventType) {
  try {
    await fetch("/api/relationship-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ eventType, sessionKey: relationshipSessionKey() })
    });
  } catch {}
}

function inviteTokenFromLocation() {
  const token = new URLSearchParams(window.location.search).get("invite")?.trim().toLowerCase() || "";
  if (!/^[a-f0-9]{32}$/.test(token)) return "";
  localStorage.setItem(inviteStorageKey, token);
  return token;
}

async function recordInviteAction(action, token, eventKey) {
  if (!token) return false;
  try {
    const response = await fetch("/api/share-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, token, eventKey })
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function claimStoredInvite() {
  const token = localStorage.getItem(inviteStorageKey) || "";
  if (await recordInviteAction("claim", token)) localStorage.removeItem(inviteStorageKey);
}

async function trackedSignup(email, password, data) {
  const user = await signup(email, password, data);
  if (user?.emailVerified) {
    await recordRelationshipEvent("signup");
    await claimStoredInvite();
  }
  return user;
}

const arrivalInvite = inviteTokenFromLocation();
if (arrivalInvite) recordInviteAction("opened", arrivalInvite, relationshipSessionKey());

try {
  const callback = await handleAuthCallback();
  if (callback?.type === "confirmation") await recordRelationshipEvent("signup");
  if (callback?.type === "confirmation" || callback?.type === "oauth") await recordRelationshipEvent("login");
  if (callback?.type === "recovery") await recordRelationshipEvent("recovery");
  if (callback?.type === "confirmation" || callback?.type === "oauth") await claimStoredInvite();
} catch (error) {
  console.warn("HALO membership callback could not be completed", error instanceof Error ? error.message : "unknown error");
} finally {
  onAuthChange((event, user) => {
    if (!user) return;
    if (event === "login") {
      recordRelationshipEvent("login");
      claimStoredInvite();
    }
    if (event === "recovery") recordRelationshipEvent("recovery");
  });
  getUser().then(user => {
    if (user) {
      recordRelationshipEvent("session");
      claimStoredInvite();
    }
  }).catch(() => null);
  window.dispatchEvent(new CustomEvent("halo-identity-ready", { detail: identity }));
}
