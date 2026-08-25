(() => {
  const colors = { atlas: "#768c9b", pulse: "#d4a44f", bridge: "#839379", hearth: "#a77b72", sentinel: "#9a5b3f" };
  const names = { atlas: "Atlas", pulse: "Pulse", bridge: "Bridge", hearth: "Hearth", sentinel: "Sentinel", mirror: "Mirror" };
  const state = { identity: null, user: null, dashboard: null, controlCenter: null };

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const number = value => new Intl.NumberFormat("en-GB").format(Number(value || 0));
  const formatDateTime = value => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "Not available";
  const listHtml = (items, empty) => (items?.length ? items : [empty]).map(item => `<li>${escapeHtml(item)}</li>`).join("");

  function showLocked(message) {
    byId("commandView").hidden = true;
    byId("lockedView").hidden = false;
    byId("lockedMessage").textContent = message;
  }

  function showCommand() {
    byId("lockedView").hidden = true;
    byId("commandView").hidden = false;
  }

  async function signIn(event) {
    event?.preventDefault();
    if (!state.identity) return;
    const email = byId("ownerEmail").value.trim();
    const password = byId("ownerPassword").value;
    if (!email || !password) return;
    byId("authMessage").textContent = "Confirming owner access…";
    try {
      state.user = await state.identity.login(email, password);
      byId("identityButton").textContent = "Sign out";
      byId("authMessage").textContent = "";
      await loadAll();
    } catch (error) {
      byId("authMessage").textContent = error instanceof Error ? error.message : "Sign in could not be completed.";
    }
  }

  async function signOut() {
    await state.identity?.logout();
    state.user = null;
    byId("identityButton").textContent = "Sign in";
    showLocked("Sign in with an owner account to read the daily report, approve proposed work, and teach the council from real outcomes.");
  }

  async function api(method = "GET", body) {
    const response = await fetch("/api/halo-agent-team", {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The council request failed.");
    return data;
  }

  async function controlApi(method = "GET", body) {
    const response = await fetch("/api/halo-control-center", {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The control center request failed.");
    return data;
  }

  function renderMetrics(metrics = {}) {
    byId("metricVisitors").textContent = number(metrics.audience?.visitors7d);
    byId("metricMembers").textContent = number(metrics.membership?.active7d);
    byId("metricCreators").textContent = number(metrics.marketplace?.realCreators);
    byId("metricIssues").textContent = number(metrics.operations?.openIssues);
    byId("metricSignals").textContent = number((metrics.community?.messages7d || 0) + (metrics.community?.roomPosts7d || 0) + (metrics.intelligence?.audienceSignals7d || 0));
  }

  function renderHealth(run) {
    const score = Math.max(0, Math.min(100, Number(run?.healthScore || 0)));
    byId("healthScore").textContent = run ? String(score) : "—";
    byId("healthArc").style.strokeDashoffset = String(540 - (540 * score / 100));
    byId("reportConfidence").textContent = run ? `${Math.round(Number(run.confidence || 0) * 100)}% council confidence` : "Awaiting first report";
  }

  function renderFindings(findings = [], roles = {}) {
    const target = byId("agentFindings");
    if (!findings.length) {
      target.innerHTML = Object.entries(roles).map(([key, role]) => `<article class="agent-card" data-agent="${key}" style="--agent-color:${colors[key]}"><header><div><span>${escapeHtml(role.title)}</span><h3>${escapeHtml(role.name)}</h3></div><span class="confidence">WAITING</span></header><p>${escapeHtml(role.mission)}</p></article>`).join("");
      return;
    }
    target.innerHTML = findings.map(finding => {
      const role = roles[finding.agentKey] || {};
      const evidence = finding.evidence?.length ? `<details><summary>READ EVIDENCE</summary><ul>${listHtml(finding.evidence, "No evidence recorded")}</ul></details>` : "";
      return `<article class="agent-card" data-agent="${escapeHtml(finding.agentKey)}" style="--agent-color:${colors[finding.agentKey] || "#d4a44f"}">
        <header><div><span>${escapeHtml(role.title || finding.agentKey)}</span><h3>${escapeHtml(role.name || names[finding.agentKey])}</h3></div><span class="confidence">${Math.round(Number(finding.confidence || 0) * 100)}%${finding.usedFallback ? " / FALLBACK" : ""}</span></header>
        <p><strong>${escapeHtml(finding.headline)}</strong><br>${escapeHtml(finding.summary)}</p>${evidence}
      </article>`;
    }).join("");
  }

  function actionCard(action) {
    const statusOptions = ["proposed", "approved", "in_progress", "completed", "dismissed"].map(status => `<option value="${status}"${status === action.status ? " selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("");
    return `<article class="action-card" data-priority="${escapeHtml(action.priority)}" data-action-id="${action.id}">
      <div class="action-source"><span>${escapeHtml(names[action.agentKey] || action.agentKey)}</span><small>${escapeHtml(action.priority)} / ${escapeHtml(action.status)}</small></div>
      <div class="action-copy"><h3>${escapeHtml(action.title)}</h3><p>${escapeHtml(action.rationale)}</p><strong>EXPECTED SIGNAL — ${escapeHtml(action.expectedMetric || "Owner defines success before approval")}</strong></div>
      <details class="action-controls"><summary>Review decision</summary><form class="action-form">
        <label>Status<select name="status">${statusOptions}</select></label>
        <label>Owner note<textarea name="ownerNote" rows="3" maxlength="1200">${escapeHtml(action.ownerNote)}</textarea></label>
        <label>Actual outcome<textarea name="actualOutcome" rows="3" maxlength="1200" placeholder="Record measurable evidence after the work is tested.">${escapeHtml(action.actualOutcome)}</textarea></label>
        <button type="submit">Save to council memory</button>
      </form></details>
    </article>`;
  }

  function renderActions(actions = []) {
    const target = byId("actionQueue");
    target.innerHTML = actions.length ? actions.map(actionCard).join("") : `<div class="empty-state">No proposed actions yet. Run the council after the platform has collected operating signals.</div>`;
    target.querySelectorAll(".action-form").forEach(form => form.addEventListener("submit", saveAction));
  }

  function renderMemory(memory = []) {
    byId("memoryLedger").innerHTML = memory.length ? memory.map(item => `<article class="memory-row"><strong>${escapeHtml(names[item.agentKey] || item.agentKey)}</strong><p>${escapeHtml(item.lastReflection || "No reflection has been stored yet.")}</p><span>${number(item.runCount)} RUNS</span></article>`).join("") : `<div class="empty-state">Memory begins after the first council run.</div>`;
  }

  function renderMaintenance(maintenance = {}) {
    const sweep = maintenance.latest;
    byId("sweepStatus").textContent = sweep ? sweep.status.toUpperCase() : "WAITING";
    byId("sweepPages").textContent = sweep ? number(sweep.pagesChecked) : "—";
    byId("sweepConnections").textContent = sweep ? number(sweep.connectionsChecked) : "—";
    byId("sweepOutputs").textContent = sweep ? number(sweep.outputsChecked) : "—";
    byId("sweepFailed").textContent = sweep ? number(sweep.failedChecks) : "—";
    byId("maintenanceTimestamp").textContent = sweep ? `Latest sweep ${formatDateTime(sweep.completedAt || sweep.startedAt)}` : "Waiting for the first deployed-site sweep.";
    const checks = maintenance.checks || [];
    const visibleChecks = checks.filter(check => check.status === "failed").concat(checks.filter(check => check.status === "passed").slice(0, 12));
    byId("maintenanceChecks").innerHTML = visibleChecks.length ? visibleChecks.map(check => `<article class="maintenance-check" data-status="${escapeHtml(check.status)}"><span>${escapeHtml(check.kind)}</span><strong>${escapeHtml(check.target)}</strong><p>${escapeHtml(check.detail)}</p><small>${check.httpStatus ? `HTTP ${number(check.httpStatus)} · ` : ""}${number(check.durationMs)} MS</small></article>`).join("") : `<div class="empty-state">The scheduled maintenance team runs every 15 minutes after deployment.</div>`;
  }

  function renderActivity(activity = []) {
    byId("activityFeed").innerHTML = activity.length ? activity.map(item => `<article class="activity-row" data-type="${escapeHtml(item.type)}">
      <span class="activity-dot" aria-hidden="true"></span>
      <span class="activity-type">${escapeHtml(item.type)}<br>${escapeHtml(item.status)}</span>
      <div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>
      <time class="activity-time" datetime="${escapeHtml(item.occurredAt)}">${formatDateTime(item.occurredAt)}</time>
    </article>`).join("") : `<div class="empty-state">No operational activity has been recorded yet.</div>`;
  }

  function renderCommandThread(commands = []) {
    const visible = commands.slice(0, 24).reverse();
    byId("commandThread").innerHTML = visible.length ? visible.map(command => {
      const targetName = command.targetAgent === "council" ? "Full council" : names[command.targetAgent] || command.targetAgent;
      const actionChip = command.actionId ? `<span class="approval-chip">Action #${number(command.actionId)} · ${escapeHtml(command.actionStatus || "proposed")}</span>` : "";
      return `<article class="command-exchange">
        <div class="owner-message"><div class="message-meta"><span>OWNER → ${escapeHtml(targetName)}</span><time>${formatDateTime(command.createdAt)}</time></div><p>${escapeHtml(command.message)}</p></div>
        <div class="agent-response" style="--agent-color:${colors[command.targetAgent] || "#d4a44f"}"><div class="message-meta"><span>${escapeHtml(targetName)} RESPONSE</span><span>${escapeHtml(command.status)}</span></div><strong>${escapeHtml(command.assessment || "Team acknowledgement")}</strong><p>${escapeHtml(command.response || "The team is preparing a response.")}</p>${actionChip}</div>
      </article>`;
    }).join("") : `<div class="command-empty"><strong>The council is listening.</strong><span>Send a question, instruction, or request for a measurable action.</span></div>`;
    byId("commandThread").scrollTop = byId("commandThread").scrollHeight;
  }

  function renderControlCenter(controlCenter) {
    state.controlCenter = controlCenter;
    byId("pulseIssues").textContent = number(controlCenter.pulse?.openIssues);
    byId("pulseActions").textContent = number(controlCenter.pulse?.activeActions);
    byId("pulseCommands").textContent = number(controlCenter.pulse?.commands24h);
    byId("pulseFailures").textContent = number(controlCenter.pulse?.failures24h);
    byId("controlRefresh").textContent = `Live view refreshed ${formatDateTime(controlCenter.refreshedAt)} · updates every 45 seconds`;
    renderActivity(controlCenter.activity);
    renderCommandThread(controlCenter.commands);
  }

  function renderDashboard(dashboard) {
    state.dashboard = dashboard;
    showCommand();
    const run = dashboard.latestRun;
    renderHealth(run);
    renderMetrics(run?.metrics);
    renderFindings(dashboard.findings, dashboard.roles);
    renderActions(dashboard.actions);
    renderMemory(dashboard.memory);
    renderMaintenance(dashboard.maintenance);
    byId("reportTimestamp").textContent = run ? `Latest report ${formatDateTime(run.completedAt || run.startedAt)}` : "No report has been generated yet.";
    byId("reportStatus").textContent = run ? `${run.status.toUpperCase()} / ${run.triggerType.toUpperCase()}` : "NO REPORT";
    byId("reportModel").textContent = run ? `${run.model} · Human approval required` : "Human approval remains required";
    byId("mirrorSummary").textContent = run?.reflection?.tomorrowQuestion || "Mirror is waiting for the first complete council run.";
    byId("executiveSummary").textContent = run?.executiveSummary || "The first daily report has not been generated.";
    byId("winsList").innerHTML = listHtml(run?.wins, "No recorded wins yet.");
    byId("concernsList").innerHTML = listHtml(run?.concerns, "No recorded concerns yet.");
    byId("tomorrowQuestion").textContent = `“${run?.reflection?.tomorrowQuestion || "What changed, and what evidence proved it?"}”`;
    byId("reflectionChanged").textContent = run?.reflection?.whatChanged || "Awaiting comparison data.";
    byId("reflectionWrong").textContent = run?.reflection?.whatWasWrong || "No prior assumption has been reviewed.";
    byId("reflectionLearning").textContent = run?.reflection?.whatToLearn || "Completed outcomes become tomorrow's memory.";
  }

  async function loadDashboard() {
    try {
      const dashboard = await api();
      renderDashboard(dashboard);
    } catch (error) {
      showLocked(error instanceof Error ? error.message : "The owner council could not be loaded.");
    }
  }

  async function loadControlCenter() {
    try {
      renderControlCenter(await controlApi());
    } catch (error) {
      byId("controlRefresh").textContent = error instanceof Error ? error.message : "The live operations pulse could not be loaded.";
    }
  }

  async function loadAll() {
    await Promise.all([loadDashboard(), loadControlCenter()]);
  }

  async function runCouncil() {
    const button = byId("runCouncilButton");
    button.disabled = true;
    button.textContent = "Council in session";
    byId("runStatus").textContent = "Five specialists are reading the latest aggregate signals.";
    try {
      const data = await api("POST", { action: "run" });
      renderDashboard(data.dashboard);
      await loadControlCenter();
      byId("runStatus").textContent = "New report recorded. Review proposed actions before anything moves.";
    } catch (error) {
      byId("runStatus").textContent = error instanceof Error ? error.message : "The council run failed.";
    } finally {
      button.disabled = false;
      button.textContent = "Run the council now";
    }
  }

  async function runMaintenance() {
    const button = byId("runMaintenanceButton");
    button.disabled = true;
    button.textContent = "Sweep in progress";
    byId("maintenanceTimestamp").textContent = "Checking deployed pages, internal connections, and output contracts now.";
    try {
      const data = await api("POST", { action: "run_maintenance" });
      renderDashboard(data.dashboard);
      await loadControlCenter();
    } catch (error) {
      byId("maintenanceTimestamp").textContent = error instanceof Error ? error.message : "The maintenance sweep failed.";
    } finally {
      button.disabled = false;
      button.textContent = "Run full sweep";
    }
  }

  async function saveAction(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const card = form.closest("[data-action-id]");
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "Saving evidence";
    try {
      await api("POST", {
        action: "update_action",
        actionId: Number(card.dataset.actionId),
        status: form.elements.status.value,
        ownerNote: form.elements.ownerNote.value,
        actualOutcome: form.elements.actualOutcome.value
      });
      await loadAll();
    } catch (error) {
      button.textContent = error instanceof Error ? error.message : "Save failed";
      button.disabled = false;
    }
  }

  async function sendCommand(event) {
    event.preventDefault();
    const message = byId("commandMessage").value.trim();
    if (!message) return;
    const button = byId("sendCommandButton");
    button.disabled = true;
    button.textContent = "Team is reviewing";
    byId("commandStatus").textContent = "Reading current signals and preparing a grounded response…";
    try {
      const data = await controlApi("POST", {
        targetAgent: byId("commandTarget").value,
        message,
        requestProposal: byId("requestProposal").checked
      });
      renderControlCenter(data.controlCenter);
      byId("commandMessage").value = "";
      byId("commandStatus").textContent = data.command.actionId
        ? `Action #${number(data.command.actionId)} is waiting in your approval queue.`
        : "The response is recorded in the private owner channel.";
      if (data.command.actionId) await loadDashboard();
    } catch (error) {
      byId("commandStatus").textContent = error instanceof Error ? error.message : "The command could not be sent.";
    } finally {
      button.disabled = false;
      button.textContent = "Send to team";
    }
  }

  async function initializeIdentity() {
    state.identity = window.haloIdentity;
    if (!state.identity) return;
    state.user = await state.identity.getUser().catch(() => null);
    byId("identityButton").textContent = state.user ? "Sign out" : "Sign in";
    if (state.user) await loadAll();
    else showLocked("Sign in with an owner account to read the daily report, approve proposed work, and teach the council from real outcomes.");
  }

  byId("identityButton").addEventListener("click", () => {
    if (state.user) return signOut();
    showLocked("Sign in with an owner account to read the daily report, approve proposed work, and teach the council from real outcomes.");
    byId("ownerEmail").focus();
  });
  byId("ownerAuthForm").addEventListener("submit", signIn);
  byId("runCouncilButton").addEventListener("click", runCouncil);
  byId("runMaintenanceButton").addEventListener("click", runMaintenance);
  byId("commandForm").addEventListener("submit", sendCommand);
  window.setInterval(() => {
    if (state.user && document.visibilityState === "visible") loadControlCenter();
  }, 45_000);
  window.addEventListener("halo-identity-ready", initializeIdentity, { once: true });
  if (window.haloIdentity) initializeIdentity();
})();
