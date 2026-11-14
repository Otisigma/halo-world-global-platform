// Neither verified reward tiers, browser-local HP nor concept sessions establish an album entitlement.
export function verifiedRewards(data) {
  const rewards = data?.rewards;
  if (rewards?.enabled === false) return rewards;
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  if (rewards?.enabled !== true || !integer(rewards.points) || typeof rewards.tier?.label !== "string"
    || !Array.isArray(rewards.breakdown) || rewards.breakdown.length !== 3
    || rewards.breakdown.some(item => typeof item.label !== "string" || !integer(item.points))
    || rewards.breakdown.reduce((sum, item) => sum + item.points, 0) !== rewards.points) throw new Error("Invalid rewards");
  const progress = rewards.progress;
  if (progress !== null && (!integer(progress?.max) || progress.max <= rewards.points
    || progress.value !== rewards.points || typeof progress.label !== "string")) throw new Error("Invalid progress");
  return rewards;
}

export function createFanSignalTracker(root, {
  document = globalThis.document,
  fetch = globalThis.fetch,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout
} = {}) {
  if (!root) return { refresh() {}, reset() {}, destroy() {} };
  const status = root.querySelector("[data-concierge-status]");
  const retry = root.querySelector("[data-concierge-retry]");
  const pointsStatus = root.querySelector("[data-points-status]");
  const progress = root.querySelector("[data-points-progress]");
  const breakdown = root.querySelector("[data-points-breakdown]");
  let generation = 0;
  let pending = null;
  let destroyed = false;

  function reset() {
    generation++;
    pending?.abort();
    pending = null;
    root.setAttribute("aria-busy", "false");
    status.textContent = "Open Points & Rewards to check your recent album concepts.";
    pointsStatus.textContent = "Open Points & Rewards to load your verified member rewards.";
    progress.hidden = true;
    progress.removeAttribute("value");
    progress.removeAttribute("max");
    progress.removeAttribute("aria-valuetext");
    breakdown.replaceChildren();
    retry.hidden = true;
  }

  async function refresh() {
    if (destroyed) return;
    reset();
    const current = generation;
    const controller = new AbortController();
    pending = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    root.setAttribute("aria-busy", "true");
    status.textContent = "Loading your recent album concepts…";
    pointsStatus.textContent = "Loading your verified member rewards…";
    async function load(path, target, render) {
      try {
        const response = await fetch(path, {
          method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal
        });
        if (current !== generation || destroyed) return;
        if (response.status === 401) {
          target.textContent = "Sign in to view your own member rewards and album concepts. Signing in does not unlock an album reward.";
          return;
        }
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json();
        if (current !== generation || destroyed) return;
        render(data);
      } catch {
        if (current !== generation || destroyed) return;
        target.textContent = "Could not load this information. No album entitlement or claim has been verified.";
        retry.hidden = false;
      }
    }
    try {
      await Promise.all([
        load("/api/track-drops", pointsStatus, data => {
          const rewards = verifiedRewards(data);
          if (!rewards.enabled) {
            pointsStatus.textContent = "Member rewards are off. Manage your preferences in Track Drops; no balance is reported while rewards are off.";
            return;
          }
          const next = rewards.progress;
          pointsStatus.textContent = `Verified member rewards: ${rewards.points} points · ${rewards.tier.label}. ${next
            ? `${next.max - next.value} points to ${next.label} (${next.value} / ${next.max}).`
            : "Top member reward tier reached."} This is not Album Concierge eligibility.`;
          if (next) {
            progress.max = next.max;
            progress.value = next.value;
            progress.setAttribute("aria-valuetext", `${next.value} of ${next.max} member reward points toward ${next.label}, not an album unlock`);
            progress.hidden = false;
          }
          breakdown.replaceChildren(...rewards.breakdown.map(item => {
            const li = document.createElement("li");
            li.textContent = `${item.label}: ${item.points} points`;
            return li;
          }));
        }),
        load("/api/album-concierge", status, data => {
          if (!Array.isArray(data?.sessions) || data.sessions.length > 20) throw new Error("invalid response");
          status.textContent = data.sessions.length
            ? `Recent album concepts: ${data.sessions.length} (latest 20). These are saved creative sessions, not reward claims or owned recordings.`
            : "No album concepts yet. You can start a concept in Album Concierge without a points unlock.";
        })
      ]);
    } finally {
      clearTimeout(timer);
      if (current === generation && !destroyed) {
        pending = null;
        root.setAttribute("aria-busy", "false");
      }
    }
  }

  retry.addEventListener("click", refresh);
  reset();
  return {
    refresh, reset,
    destroy() {
      destroyed = true;
      reset();
      retry.removeEventListener("click", refresh);
    }
  };
}
