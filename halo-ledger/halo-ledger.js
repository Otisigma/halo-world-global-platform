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
    system_event: "System",
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
  fetchEntries(false);
})();
