/* Halo Ledger — client-side controller */
(function () {
  "use strict";

  const API = "/api/halo-ledger";
  const CATEGORY_LABELS = {
    upload_event: "Upload",
    issue_report: "Issue",
    fix_record: "Fix",
    department_action: "Dept. Action",
    approval_event: "Approval",
    agent_activity: "Agent",
    feature_request: "Feature Ask",
    route_health: "Route Health",
    system_event: "System",
  };
  const ROUTE_HEALTH_STATES = ["working", "attention", "broken", "disconnected"];
  const ROUTE_HEALTH_STATE_LABELS = {
    working: "Working",
    attention: "Attention",
    broken: "Broken",
    disconnected: "Disconnected",
  };

  let currentCategory = "";
  let currentQuery = "";
  let nextBefore = null;
  let loading = false;

  const statusEl = document.getElementById("ledgerStatus");
  const listEl = document.getElementById("ledgerList");
  const loadMoreBtn = document.getElementById("ledgerLoadMore");
  const searchInput = document.getElementById("ledgerQuery");
  const searchBtn = document.getElementById("ledgerSearchBtn");
  const detailPanel = document.getElementById("ledgerDetail");
  const detailBody = document.getElementById("ledgerDetailBody");
  const detailClose = document.getElementById("ledgerDetailClose");
  const chips = document.querySelectorAll(".ledger-chip");
  const routeHealthTrendsEl = document.getElementById("routeHealthTrends");
  const routeHealthSummaryEl = document.getElementById("routeHealthSummary");
  const routeHealthHistoryEl = document.getElementById("routeHealthHistory");

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  function buildEntryHtml(entry) {
    const label = CATEGORY_LABELS[entry.eventCategory] || entry.eventCategory;
    return `
      <div class="ledger-entry-top">
        <span class="ledger-category-badge" data-category="${escHtml(entry.eventCategory)}">${escHtml(label)}</span>
        <span class="ledger-entry-summary">${escHtml(entry.summary)}</span>
      </div>
      <div class="ledger-entry-meta">
        <span>${escHtml(formatDate(entry.createdAt))}</span>
        ${entry.pipelineStage ? `<span>stage: ${escHtml(entry.pipelineStage)}</span>` : ""}
        <span class="ledger-outcome" data-outcome="${escHtml(entry.outcome)}">${escHtml(entry.outcome)}</span>
      </div>
    `;
  }

  function escHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeStateCounts(value) {
    const source = value && typeof value === "object" ? value : {};
    return ROUTE_HEALTH_STATES.reduce((acc, state) => {
      acc[state] = Number(source[state] || 0);
      return acc;
    }, {});
  }

  function deriveRouteHealthState(stateCounts) {
    if (stateCounts.broken > 0) return "broken";
    if (stateCounts.attention > 0 || stateCounts.disconnected > 0) return "attention";
    return "working";
  }

  function normalizeRouteHealthEntry(entry) {
    const details = entry && entry.details && typeof entry.details === "object" ? entry.details : {};
    const stateCounts = normalizeStateCounts(details.stateCounts);
    const routeStates = Array.isArray(details.routeStates) ? details.routeStates : [];
    const chartStatus = ROUTE_HEALTH_STATES.includes(details.chartStatus)
      ? details.chartStatus
      : deriveRouteHealthState(stateCounts);
    return {
      ...entry,
      chartStatus,
      stateCounts,
      routeStates,
      totalRoutes: routeStates.length,
      notableRoutes: routeStates.filter(route => route && route.state && route.state !== "working").slice(0, 3),
    };
  }

  function buildRouteHealthCountsHtml(stateCounts) {
    return `
      <ul class="ledger-route-health-counts" aria-label="Route-health state counts">
        ${ROUTE_HEALTH_STATES.map(state => `
          <li class="ledger-route-health-count" data-route-health-state="${state}">
            <span>${escHtml(ROUTE_HEALTH_STATE_LABELS[state])}</span>
            <strong>${escHtml(String(stateCounts[state]))}</strong>
          </li>
        `).join("")}
      </ul>
    `;
  }

  function buildRouteHealthNote(entry) {
    if (!entry.notableRoutes.length) {
      return entry.totalRoutes
        ? `${entry.totalRoutes} routes checked — all routes are working in this snapshot.`
        : "Snapshot persisted without route detail.";
    }
    return entry.notableRoutes
      .map(route => {
        const label = route.name && route.route ? `${route.name} (${route.route})` : (route.name || route.route || "Unnamed route");
        const stateLabel = ROUTE_HEALTH_STATE_LABELS[route.state] || route.state || "Unknown";
        return `${label}: ${stateLabel}`;
      })
      .join(" · ");
  }

  function renderRouteHealthTrends(entries) {
    if (!routeHealthTrendsEl || !routeHealthSummaryEl || !routeHealthHistoryEl) return;
    if (!entries.length) {
      routeHealthTrendsEl.hidden = true;
      routeHealthSummaryEl.innerHTML = "";
      routeHealthHistoryEl.innerHTML = "";
      return;
    }

    const [latest, ...history] = entries.map(normalizeRouteHealthEntry);
    routeHealthTrendsEl.hidden = false;
    routeHealthSummaryEl.innerHTML = `
      <div class="ledger-route-health-summary-top">
        <p class="ledger-route-health-summary-meta">Latest snapshot · ${escHtml(formatDate(latest.createdAt))}</p>
        <span class="ledger-route-health-state" data-route-health-state="${escHtml(latest.chartStatus)}">${escHtml(ROUTE_HEALTH_STATE_LABELS[latest.chartStatus] || latest.chartStatus)}</span>
      </div>
      <h3 class="ledger-route-health-summary-title">${escHtml(latest.summary || "Route health snapshot")}</h3>
      ${buildRouteHealthCountsHtml(latest.stateCounts)}
      <p class="ledger-route-health-note">${escHtml(buildRouteHealthNote(latest))}</p>
    `;

    routeHealthHistoryEl.innerHTML = "";
    if (!history.length) {
      routeHealthHistoryEl.innerHTML = '<li class="ledger-route-health-empty">No earlier route-health snapshots yet.</li>';
      return;
    }

    history.forEach(entry => {
      const li = document.createElement("li");
      li.className = "ledger-route-health-history-item";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-label", entry.summary || "Route health snapshot");
      li.innerHTML = `
        <div class="ledger-route-health-history-top">
          <span class="ledger-route-health-state" data-route-health-state="${escHtml(entry.chartStatus)}">${escHtml(ROUTE_HEALTH_STATE_LABELS[entry.chartStatus] || entry.chartStatus)}</span>
          <span class="ledger-route-health-timestamp">${escHtml(formatDate(entry.createdAt))}</span>
        </div>
        ${buildRouteHealthCountsHtml(entry.stateCounts)}
        <p class="ledger-route-health-note">${escHtml(buildRouteHealthNote(entry))}</p>
      `;
      li.addEventListener("click", () => showDetail(entry));
      li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") showDetail(entry); });
      routeHealthHistoryEl.appendChild(li);
    });
  }

  function renderEntries(entries, append) {
    if (!append) listEl.innerHTML = "";
    if (!entries.length && !append) {
      listEl.innerHTML = '<li class="ledger-entry" style="cursor:default;pointer-events:none"><span class="ledger-entry-summary" style="color:#666">No entries found.</span></li>';
      return;
    }
    entries.forEach(entry => {
      const li = document.createElement("li");
      li.className = "ledger-entry";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-label", entry.summary);
      li.innerHTML = buildEntryHtml(entry);
      li.addEventListener("click", () => showDetail(entry));
      li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") showDetail(entry); });
      listEl.appendChild(li);
    });
  }

  function showDetail(entry) {
    const label = CATEGORY_LABELS[entry.eventCategory] || entry.eventCategory;
    let detailsHtml = "";
    try {
      const pretty = JSON.stringify(entry.details || {}, null, 2);
      if (pretty !== "{}") detailsHtml = `<h2>Details</h2><pre>${escHtml(pretty)}</pre>`;
    } catch { /* ignore */ }

    const refs = [
      entry.refSongId ? `Song: ${entry.refSongId}` : "",
      entry.refIssueId ? `Issue: ${entry.refIssueId}` : "",
      entry.refReleaseId ? `Release: ${entry.refReleaseId}` : "",
      entry.refAgentId ? `Agent: ${entry.refAgentId}` : "",
    ].filter(Boolean).join(" · ");

    detailBody.innerHTML = `
      <span class="ledger-category-badge" data-category="${escHtml(entry.eventCategory)}">${escHtml(label)}</span>
      <h2>${escHtml(entry.summary)}</h2>
      <p>${escHtml(formatDate(entry.createdAt))}&nbsp;·&nbsp;<span class="ledger-outcome" data-outcome="${escHtml(entry.outcome)}">${escHtml(entry.outcome)}</span></p>
      ${entry.pipelineStage ? `<p>Pipeline stage: <strong>${escHtml(entry.pipelineStage)}</strong></p>` : ""}
      ${refs ? `<p>${escHtml(refs)}</p>` : ""}
      ${entry.body ? `<h2>Notes</h2><pre>${escHtml(entry.body)}</pre>` : ""}
      ${detailsHtml}
      <p style="margin-top:1rem;font-size:0.7rem;color:#555">ID: ${escHtml(entry.id)}</p>
    `;
    detailPanel.removeAttribute("hidden");
    detailPanel.focus();
  }

  async function fetchEntries(append) {
    if (loading) return;
    loading = true;
    setStatus(append ? "Loading more…" : "Loading…");

    const params = new URLSearchParams();
    if (currentCategory) params.set("category", currentCategory);
    if (currentQuery) params.set("q", currentQuery);
    if (append && nextBefore) params.set("before", nextBefore);
    params.set("limit", "50");

    try {
      const res = await fetch(`${API}?${params}`);
      if (res.status === 401) {
        setStatus("Sign in to view Halo Ledger.");
        listEl.innerHTML = "";
        loadMoreBtn.hidden = true;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entries = data.entries || [];
      nextBefore = data.nextBefore || null;
      renderEntries(entries, append);
      const count = append ? `Loaded ${entries.length} more` : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
      setStatus(count + (nextBefore ? " — scroll for more" : ""));
      loadMoreBtn.hidden = !nextBefore;
    } catch (err) {
      console.error("Ledger fetch failed", err);
      setStatus("Could not load ledger entries. Try again shortly.");
    } finally {
      loading = false;
    }
  }

  async function fetchRouteHealthTrends() {
    if (!routeHealthTrendsEl) return;
    const params = new URLSearchParams({
      category: "route_health",
      limit: "9",
    });

    try {
      const res = await fetch(`${API}?${params}`);
      if (res.status === 401) {
        routeHealthTrendsEl.hidden = true;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderRouteHealthTrends(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      console.error("Route-health trends fetch failed", err);
      routeHealthTrendsEl.hidden = true;
    }
  }

  function reset() {
    nextBefore = null;
    fetchEntries(false);
  }

  // Category chips
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      chips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentCategory = chip.dataset.category || "";
      reset();
    });
  });

  // Search
  function doSearch() {
    currentQuery = searchInput.value.trim();
    reset();
  }
  searchBtn.addEventListener("click", doSearch);
  searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

  // Load more
  loadMoreBtn.addEventListener("click", () => fetchEntries(true));

  // Detail close
  detailClose.addEventListener("click", () => detailPanel.setAttribute("hidden", ""));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") detailPanel.setAttribute("hidden", "");
  });

  // Initial load
  fetchRouteHealthTrends();
  fetchEntries(false);
})();
