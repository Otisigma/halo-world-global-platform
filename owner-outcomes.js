(() => {
  const byId = id => document.getElementById(id);
  const panel = byId("ownerOutcomes");
  if (!panel) return;
  let authorized = false;
  let generation = 0;
  let controller;
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const rate = value => value === null ? "Not enough data" : `${value}%`;
  const definitions = {
    creators: {
      title: "Artists completing release preparation",
      summary: m => `${m.prepared} / ${m.projects} new projects prepared (${rate(m.preparationRate)})`,
      detail: () => "Projects created in the last 7 days that currently have all 13 Release House rooms complete. This is preparation, not verified publication. New projects have had less time to finish.",
      gap: "Not measured: whether artists finished without help, or how long completion took."
    },
    listeners: {
      title: "Listeners coming back",
      summary: m => `${m.returningListeners} / ${m.previousListeners} prior-week listeners returned (${rate(m.returnRate)})`,
      detail: m => `${m.currentListeners} distinct opted-in members listened this week. Return rate compares listeners from the preceding 7 days with listeners in the latest 7 days. Only current, consented listening reports count; anonymous and opted-out listeners are excluded.`,
      gap: "This measures repeat listening by opted-in members, not all visitors or long-term retention."
    },
    playback: {
      title: "Shop playback reliability",
      summary: m => `${m.ready} / ${m.attempts} attempts reached playing (${rate(m.startRate)})`,
      detail: m => `${m.failed} attempts reported an error; ${m.unknown} have no outcome. An attempt can start and later fail, so those counts can overlap. Paused, blocked, lost reports and still-loading attempts are not silently counted as success.`,
      gap: "New measurement: shop player only, on /music/ and /music-upload/. Not platform-wide uptime, buffering performance or proof of a full listen. Browser privacy settings and missing reports limit coverage."
    },
    operations: {
      title: "Problems detected and resolved",
      summary: m => `${m.openIssues} open issues; ${m.healedIssues} marked healed this week`,
      detail: m => `${m.newIssues} issue records first seen this week; ${m.scheduledIssues} currently attributed to scheduled checks. Repeated occurrences are not separate issues. Source attribution can change when an issue is reported again.`,
      gap: "Not proven: detection before any user was affected. A healed record is not independent proof of a successful repair."
    }
  };

  function clear() {
    authorized = false;
    generation++;
    controller?.abort();
    panel.hidden = true;
    byId("outcomeSources").replaceChildren();
    byId("outcomeStatus").textContent = "Owner access required.";
    byId("outcomeRefresh").disabled = false;
  }

  function render(outcomes) {
    const cards = Object.entries(definitions).map(([key, definition]) => {
      const card = node("article");
      card.className = "briefing-panel";
      card.append(node("h3", definition.title));
      const source = outcomes.sources[key];
      if (source?.status !== "available") {
        card.append(node("p", "Unavailable - this source could not be read. This is not a zero result."));
      } else {
        card.append(node("p", definition.summary(source.metrics)), node("p", definition.detail(source.metrics)));
      }
      card.append(node("p", definition.gap));
      return card;
    });
    byId("outcomeSources").replaceChildren(...cards);
    const missing = Object.values(outcomes.sources).some(source => source.status !== "available");
    byId("outcomeStatus").textContent = `${missing ? "Partial coverage" : "Recorded evidence"} - 7 days ending ${new Date(outcomes.window.end).toLocaleString("en-GB", { timeZone: "UTC" })} UTC. No overall greatness score is inferred.`;
  }

  async function refresh() {
    if (!authorized) return;
    controller?.abort();
    const current = ++generation;
    const activeController = new AbortController();
    controller = activeController;
    const timeout = setTimeout(() => activeController.abort(), 25_000);
    byId("outcomeSources").replaceChildren();
    byId("outcomeRefresh").disabled = true;
    byId("outcomeStatus").textContent = "Reading outcome evidence...";
    try {
      const response = await fetch("/api/halo-control-center?view=outcomes", {
        credentials: "same-origin", cache: "no-store", signal: activeController.signal
      });
      if (current !== generation) return;
      if (response.status === 401 || response.status === 403) return clear();
      if (!response.ok) throw new Error("Outcome review unavailable");
      const data = await response.json();
      if (authorized && current === generation) render(data.outcomes);
    } catch {
      if (authorized && current === generation) {
        byId("outcomeStatus").textContent = "Outcome review unavailable. No cached evidence is shown. Refresh to retry.";
      }
    } finally {
      clearTimeout(timeout);
      if (current === generation) byId("outcomeRefresh").disabled = false;
    }
  }

  byId("outcomeRefresh").addEventListener("click", refresh);
  window.addEventListener("halo-owner-operations", event => {
    if (!event.detail.authorized) return clear();
    authorized = true;
    panel.hidden = false;
    refresh();
  });
  byId("identityButton").addEventListener("click", clear);
  const watchIdentity = () => window.haloIdentity?.onAuthChange?.(clear);
  window.addEventListener("halo-identity-ready", watchIdentity, { once: true });
  if (window.haloIdentity) watchIdentity();
})();
