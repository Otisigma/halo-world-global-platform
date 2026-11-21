(() => {
  const API = "/api/stream-reports";
  const byId = id => document.getElementById(id);
  const state = { identity: null, user: null, data: null };
  const formatNumber = value => Number(value || 0).toLocaleString("en-GB");
  const formatMoney = (value, currency) => {
    if (value === null || value === undefined || !currency) return "—";
    try {
      return Number(value).toLocaleString("en-GB", { style: "currency", currency });
    } catch {
      return `${Number(value).toFixed(2)} ${currency}`;
    }
  };
  const formatMonth = value => {
    if (!value) return "";
    const [year, month] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const period = (start, end) => {
    if (!start) return "No dates in file";
    const a = formatMonth(start.slice(0, 7));
    const b = formatMonth((end || start).slice(0, 7));
    return a === b ? a : `${a} – ${b}`;
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function tile(label, value, detail) {
    const node = el("article", "sr-tile");
    node.append(el("span", "sr-tile-label", label), el("strong", "sr-tile-value", value));
    if (detail) node.append(el("span", "sr-tile-detail", detail));
    return node;
  }

  function empty(container, message) {
    container.replaceChildren(el("p", "sr-empty", message));
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || "Something went wrong. Try again."), { status: response.status });
    return body;
  }

  function renderSources(sources) {
    const select = byId("sourceSelect");
    if (select.options.length) return;
    const groups = [["Distributor statements", false], ["Artist dashboard exports", true]];
    for (const [label, dashboard] of groups) {
      const group = document.createElement("optgroup");
      group.label = label;
      for (const source of sources.filter(item => item.dashboard === dashboard)) {
        const option = document.createElement("option");
        option.value = source.value;
        option.textContent = source.label;
        group.append(option);
      }
      select.append(group);
    }
  }

  function renderPlatforms(distributor) {
    const container = byId("platformTotals");
    if (!distributor.byPlatform.length) return empty(container, "No distributor reports yet. Upload one to see plays by platform.");
    const total = distributor.byPlatform.reduce((sum, row) => sum + row.streams, 0);
    const earnings = distributor.currency ? distributor.byPlatform.reduce((sum, row) => sum + (row.earnings || 0), 0) : null;
    container.replaceChildren(
      tile("All platforms", formatNumber(total), distributor.currency ? formatMoney(earnings, distributor.currency) : "Earnings in mixed currencies"),
      ...distributor.byPlatform.map(row => tile(
        row.label,
        formatNumber(row.streams),
        [row.downloads ? `${formatNumber(row.downloads)} downloads` : "", distributor.currency ? formatMoney(row.earnings, distributor.currency) : ""].filter(Boolean).join(" · ")
      ))
    );
  }

  function renderMonths(distributor) {
    const container = byId("monthChart");
    const months = distributor.byMonth;
    if (months.length < 2) return container.replaceChildren();
    const max = Math.max(...months.map(row => row.streams), 1);
    const list = el("ol", "sr-month-bars");
    for (const row of months) {
      const item = el("li", "sr-month");
      const bar = el("span", "sr-month-bar");
      bar.style.setProperty("--height", `${Math.max(2, Math.round((row.streams / max) * 100))}%`);
      item.title = `${formatMonth(row.month)}: ${formatNumber(row.streams)} plays`;
      item.append(el("span", "sr-month-value", formatNumber(row.streams)), bar, el("span", "sr-month-label", formatMonth(row.month)));
      list.append(item);
    }
    container.replaceChildren(el("h3", "", "Plays by month"), list);
  }

  function renderTracks(distributor) {
    const body = byId("trackRows");
    byId("earningsHeading").textContent = distributor.currency ? `Earnings (${distributor.currency})` : "Earnings";
    if (!distributor.topTracks.length) {
      const row = el("tr");
      const cell = el("td", "sr-empty", "Tracks appear here after your first distributor report.");
      cell.colSpan = 5;
      row.append(cell);
      return body.replaceChildren(row);
    }
    body.replaceChildren(...distributor.topTracks.map(track => {
      const row = el("tr");
      const name = el("td");
      name.append(el("strong", "", track.title || track.isrc));
      const meta = [track.artist, track.isrc].filter(Boolean).join(" · ");
      if (meta) name.append(el("span", "sr-sub", meta));
      if (track.songId) name.append(el("span", "sr-linked", "In your Song Catalog"));
      row.append(
        name,
        el("td", "", track.platforms.join(", ")),
        el("td", "num", formatNumber(track.streams)),
        el("td", "num", formatNumber(track.downloads)),
        el("td", "num", formatMoney(track.earnings, distributor.currency))
      );
      return row;
    }));
  }

  function renderDashboards(dashboards) {
    const container = byId("dashboardTotals");
    if (!dashboards.length) return empty(container, "No Spotify for Artists or Apple Music for Artists exports yet.");
    container.replaceChildren(...dashboards.map(row => tile(
      row.label,
      formatNumber(row.streams),
      `${formatNumber(row.tracks)} tracks · ${period(row.periodStart, row.periodEnd)} · latest export`
    )));
  }

  function renderReports(reports) {
    const list = byId("reportList");
    if (!reports.length) return empty(list, "Nothing imported yet.");
    list.replaceChildren(...reports.map(report => {
      const item = el("li", "sr-report");
      const info = el("div");
      info.append(
        el("strong", "", `${report.sourceLabel} · ${period(report.periodStart, report.periodEnd)}`),
        el("span", "sr-sub", `${report.fileName} · ${formatNumber(report.totalStreams)} plays · ${formatNumber(report.matchedLines)} of ${formatNumber(report.lineCount)} lines matched to your catalog · uploaded ${new Date(report.uploadedAt).toLocaleDateString("en-GB")}`)
      );
      const remove = el("button", "sr-button sr-button-quiet", "Delete");
      remove.type = "button";
      remove.dataset.deleteReport = report.id;
      remove.setAttribute("aria-label", `Delete ${report.fileName}`);
      item.append(info, remove);
      return item;
    }));
  }

  function render(data) {
    state.data = data;
    renderSources(data.sources);
    renderPlatforms(data.distributor);
    renderMonths(data.distributor);
    renderTracks(data.distributor);
    renderDashboards(data.dashboards);
    renderReports(data.reports);
  }

  function showSignedOut() {
    byId("workspace").hidden = true;
    byId("lockedView").hidden = false;
    byId("identityButton").textContent = "Sign in";
  }

  async function load() {
    try {
      render(await request(API));
      byId("lockedView").hidden = true;
      byId("workspace").hidden = false;
      byId("identityButton").textContent = "Sign out";
    } catch (error) {
      if (error.status === 401) return showSignedOut();
      byId("lockedView").hidden = true;
      byId("workspace").hidden = false;
      byId("uploadMessage").textContent = error.message;
    }
  }

  async function start() {
    state.user = await state.identity?.getUser?.().catch(() => null);
    if (!state.user) return showSignedOut();
    await load();
  }

  byId("signInForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = byId("signInMessage");
    message.textContent = "Signing in…";
    try {
      state.user = await state.identity.login(byId("signInEmail").value.trim(), byId("signInPassword").value);
      message.textContent = "";
      await load();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Sign in could not be completed.";
    }
  });

  byId("identityButton").addEventListener("click", async () => {
    if (!state.user) return byId("signInEmail").focus();
    await state.identity?.logout();
    state.user = null;
    showSignedOut();
  });

  byId("uploadForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = byId("uploadButton");
    const message = byId("uploadMessage");
    const file = byId("reportFile").files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      message.textContent = "Reports must be 5 MB or smaller. Split the export by month and upload each part.";
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    button.disabled = true;
    message.textContent = "Reading your report…";
    try {
      const data = await request(API, { method: "POST", body: form });
      render(data);
      const result = data.imported;
      const notes = [
        `${formatNumber(result.totalStreams)} plays imported${result.platforms.length ? ` across ${result.platforms.join(", ")}` : ""}`,
        result.totalDownloads ? `${formatNumber(result.totalDownloads)} downloads` : "",
        result.rowsSkipped ? `${formatNumber(result.rowsSkipped)} rows skipped (no track or play count)` : "",
        result.rowsWithoutMonth ? `${formatNumber(result.rowsWithoutMonth)} rows had no date` : "",
        result.mixedCurrencies ? "earnings were in more than one currency, so they aren't totalled" : ""
      ].filter(Boolean);
      message.textContent = `${notes.join(". ")}.`;
      formElement.reset();
    } catch (error) {
      if (error.status === 401) showSignedOut();
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  byId("reportList").addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-report]");
    if (!button) return;
    if (!confirm("Delete this report? Its plays will be removed from your totals.")) return;
    button.disabled = true;
    try {
      render(await request(`${API}?id=${encodeURIComponent(button.dataset.deleteReport)}`, { method: "DELETE" }));
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  });

  function connectIdentity() {
    if (!window.haloIdentity) return false;
    state.identity = window.haloIdentity;
    start();
    return true;
  }

  if (!connectIdentity()) {
    window.addEventListener("halo-identity-ready", event => {
      state.identity = event.detail || window.haloIdentity;
      start();
    }, { once: true });
  }
})();
