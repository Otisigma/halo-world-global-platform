import { verifiedRewards } from "../signal-network/fan-signal-tracker.js";

export function createAffiliateDashboard(root, {
  fetch = globalThis.fetch,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout
} = {}) {
  const element = name => root.querySelector(`[data-${name}]`);
  const status = element("status");
  const panel = element("private");
  const signIn = element("signin");
  const refreshButton = element("refresh");
  const inviteDetails = element("invite-details");
  const inviteLink = element("invite-link");
  let generation = 0;
  let pending = null;
  let destroyed = false;

  function reset() {
    generation++;
    pending?.abort();
    pending = null;
    panel.hidden = true;
    signIn.hidden = true;
    inviteDetails.hidden = true;
    inviteLink.value = "";
    for (const name of ["joins", "invite-empty", "referral-status", "points-status"]) element(name).textContent = "";
    root.setAttribute("aria-busy", "false");
    status.textContent = "Sign in to view your private affiliate dashboard.";
  }

  function render(data) {
    // Fail closed if a future financial service changes this read-only setup contract.
    const affiliate = data?.affiliate;
    if (affiliate?.status !== "unavailable" || data.guide?.status !== "not_configured"
      || ["referralUrl", "activeReferrals", "activePaidMonths", "earnedMinor", "heldMinor", "availableMinor", "paidMinor", "payoutHistory"]
        .some(key => affiliate[key] !== null)) throw new Error("Unsupported financial data");
    const invitations = data.invitations;
    if (!["tracked_invite", "no_invite", "unavailable"].includes(invitations?.status)) throw new Error("Invalid invitations");
    const tracked = invitations.status === "tracked_invite";
    if (tracked && !/^\/halo-x\.html\?invite=[a-f0-9]{32}$/.test(invitations.url)) throw new Error("Invalid invitation link");
    if (invitations.status !== "unavailable" && (!Number.isSafeInteger(invitations.joinedMembers) || invitations.joinedMembers < 0)) {
      throw new Error("Invalid invitation count");
    }
    let rewardText = "Verified member rewards are unavailable. No Guide eligibility has been determined.";
    if (data.rewards !== null) {
      const rewards = verifiedRewards(data);
      rewardText = rewards.enabled
        ? `Verified member rewards: ${rewards.points.toLocaleString("en-US")} points · ${rewards.tier.label}. This balance does not establish Verified Guide or affiliate eligibility.`
        : "Member rewards are off. No verified points balance is reported; manage your preferences in Track Drops.";
    }
    element("referral-status").textContent = "Affiliate setup unavailable. Existing invitations are shown separately below; they do not earn subscription commissions.";
    element("joins").textContent = invitations.status === "unavailable" ? "Unavailable" : String(invitations.joinedMembers);
    element("invite-empty").textContent = tracked
      ? "Your most recent tracked invitation is available below. Join counts cover unique members across your existing invitations, not paid subscribers."
      : invitations.status === "no_invite"
        ? "No tracked invitations yet. No affiliate link has been issued."
        : "Your existing invitations could not be loaded. No referral count or link is assumed.";
    if (tracked) inviteLink.value = invitations.url;
    inviteDetails.hidden = !tracked;
    element("points-status").textContent = rewardText;
    panel.hidden = false;
    status.textContent = "Private dashboard loaded. Affiliate earnings, tiers, and payouts require backend setup.";
  }

  async function refresh() {
    if (destroyed) return;
    reset();
    const current = generation;
    const controller = new AbortController();
    pending = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    root.setAttribute("aria-busy", "true");
    status.textContent = "Loading your private dashboard…";
    try {
      const response = await fetch("/api/affiliate-dashboard", {
        method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal
      });
      if (current !== generation || destroyed) return;
      if (response.status === 401) {
        status.textContent = "Sign in to view your private affiliate dashboard.";
        signIn.hidden = false;
        return;
      }
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (current !== generation || destroyed) return;
      render(data);
    } catch {
      if (current !== generation || destroyed) return;
      reset();
      status.textContent = "Could not load your dashboard. No balance, payout, or eligibility has been verified. Try refreshing.";
    } finally {
      clearTimeout(timer);
      if (current === generation && !destroyed) {
        pending = null;
        root.setAttribute("aria-busy", "false");
      }
    }
  }

  refreshButton.addEventListener("click", refresh);
  reset();
  return {
    refresh, reset,
    destroy() {
      destroyed = true;
      reset();
      refreshButton.removeEventListener("click", refresh);
    }
  };
}

export function connectAffiliateIdentity(dashboard, identity) {
  // Hide old account data synchronously, before checking the next session.
  const unsubscribe = identity.onAuthChange(() => { dashboard.reset(); dashboard.refresh(); });
  dashboard.refresh();
  return unsubscribe;
}

if (typeof document !== "undefined") {
  const root = document.querySelector("#affiliate-dashboard");
  if (root) {
    const dashboard = createAffiliateDashboard(root);
    let connected = false;
    const connect = () => {
      if (connected || !window.haloIdentity) return;
      connected = true;
      connectAffiliateIdentity(dashboard, window.haloIdentity);
    };
    window.addEventListener("halo-identity-ready", connect);
    window.addEventListener("pagehide", () => dashboard.reset());
    window.addEventListener("pageshow", () => { if (connected) dashboard.refresh(); });
    connect();
    dashboard.refresh();
  }
}
