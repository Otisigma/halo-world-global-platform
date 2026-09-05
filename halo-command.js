(() => {
  const colors = { atlas: "#768c9b", pulse: "#d4a44f", bridge: "#839379", hearth: "#a77b72", sentinel: "#9a5b3f" };
  const names = { atlas: "Atlas", pulse: "Pulse", bridge: "Bridge", hearth: "Hearth", sentinel: "Sentinel", mirror: "Mirror" };
  const state = { identity: null, user: null, dashboard: null, controlCenter: null };

  const byId = id => document.getElementById(id);
  const number = value => new Intl.NumberFormat("en-GB").format(Number(value || 0));
  const formatDateTime = value => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "Not available";

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs || {})) {
      if (val !== null && val !== undefined) node.setAttribute(key, val);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function emptyState(message) {
    return el("div", { class: "empty-state" }, message);
  }

  function renderList(target, items, empty) {
    const data = items?.length ? items : [empty];
    target.replaceChildren(...data.map(item => el("li", null, item)));
  }

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
      target.replaceChildren(...Object.entries(roles).map(([key, role]) => {
        const article = el("article", { class: "agent-card", "data-agent": key });
        article.style.setProperty("--agent-color", colors[key] || "#d4a44f");
        const headerDiv = el("div", null, el("span", null, role.title), el("h3", null, role.name));
        article.append(el("header", null, headerDiv, el("span", { class: "confidence" }, "WAITING")));
        article.append(el("p", null, role.mission));
        return article;
      }));
      return;
    }
    target.replaceChildren(...findings.map(finding => {
      const role = roles[finding.agentKey] || {};
      const article = el("article", { class: "agent-card", "data-agent": finding.agentKey });
      article.style.setProperty("--agent-color", colors[finding.agentKey] || "#d4a44f");
      const confidence = `${Math.round(Number(finding.confidence || 0) * 100)}%${finding.usedFallback ? " / FALLBACK" : ""}`;
      const headerDiv = el("div", null,
        el("span", null, role.title || finding.agentKey),
        el("h3", null, role.name || names[finding.agentKey])
      );
      article.append(el("header", null, headerDiv, el("span", { class: "confidence" }, confidence)));
      const p = el("p", null, el("strong", null, finding.headline));
      p.append(document.createElement("br"));
      p.append(document.createTextNode(finding.summary));
      article.append(p);
      if (finding.evidence?.length) {
        const ul = el("ul", null, ...finding.evidence.map(e => el("li", null, e)));
        article.append(el("details", null, el("summary", null, "READ EVIDENCE"), ul));
      }
      return article;
    }));
  }

  function actionCard(action) {
    const article = el("article", { class: "action-card", "data-priority": action.priority, "data-action-id": action.id });
    const sourceDiv = el("div", { class: "action-source" },
      el("span", null, names[action.agentKey] || action.agentKey),
      el("small", null, `${action.priority} / ${action.status}`)
    );
    const copyStrong = el("strong", null, `EXPECTED SIGNAL — ${action.expectedMetric || "Owner defines success before approval"}`);
    const copyDiv = el("div", { class: "action-copy" },
      el("h3", null, action.title),
      el("p", null, action.rationale),
      copyStrong
    );
    const select = el("select", { name: "status" });
    for (const status of ["proposed", "approved", "in_progress", "completed", "dismissed"]) {
      const opt = el("option", { value: status }, status.replaceAll("_", " "));
      if (status === action.status) opt.selected = true;
      select.append(opt);
    }
    const noteArea = el("textarea", { name: "ownerNote", rows: "3", maxlength: "1200" });
    noteArea.value = action.ownerNote || "";
    const outcomeArea = el("textarea", { name: "actualOutcome", rows: "3", maxlength: "1200", placeholder: "Record measurable evidence after the work is tested." });
    outcomeArea.value = action.actualOutcome || "";
    const form = el("form", { class: "action-form" },
      el("label", null, "Status", select),
      el("label", null, "Owner note", noteArea),
      el("label", null, "Actual outcome", outcomeArea),
      el("button", { type: "submit" }, "Save to council memory")
    );
    const details = el("details", { class: "action-controls" }, el("summary", null, "Review decision"), form);
    article.append(sourceDiv, copyDiv, details);
    return article;
  }

  function renderActions(actions = []) {
    const target = byId("actionQueue");
    if (!actions.length) {
      target.replaceChildren(emptyState("No proposed actions yet. Run the council after the platform has collected operating signals."));
    } else {
      target.replaceChildren(...actions.map(actionCard));
    }
    target.querySelectorAll(".action-form").forEach(form => form.addEventListener("submit", saveAction));
  }

  function renderMemory(memory = []) {
    const target = byId("memoryLedger");
    if (!memory.length) {
      target.replaceChildren(emptyState("Memory begins after the first council run."));
      return;
    }
    target.replaceChildren(...memory.map(item =>
      el("article", { class: "memory-row" },
        el("strong", null, names[item.agentKey] || item.agentKey),
        el("p", null, item.lastReflection || "No reflection has been stored yet."),
        el("span", null, `${number(item.runCount)} RUNS`)
      )
    ));
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
    const target = byId("maintenanceChecks");
    if (!visibleChecks.length) {
      target.replaceChildren(emptyState("The scheduled maintenance team runs every 15 minutes after deployment."));
    } else {
      target.replaceChildren(...visibleChecks.map(check => {
        const durationText = `${check.httpStatus ? `HTTP ${number(check.httpStatus)} · ` : ""}${number(check.durationMs)} MS`;
        return el("article", { class: "maintenance-check", "data-status": check.status },
          el("span", null, check.kind),
          el("strong", null, check.target),
          el("p", null, check.detail),
          el("small", null, durationText)
        );
      }));
    }
    renderSatelliteStatuses(sweep?.satelliteStatuses || []);
  }

  function renderSatelliteStatuses(statuses = []) {
    const target = byId("satelliteStatuses");
    if (!statuses.length) {
      target.replaceChildren(emptyState("Run halo-signal-check to publish trusted satellite status cards."));
      return;
    }
    target.replaceChildren(...statuses.map(item => el("article", { class: "satellite-status-card", "data-status": item.status },
      el("header", null, el("span", null, item.status.toUpperCase()), el("span", null, item.route)),
      el("strong", null, item.name),
      el("ul", null,
        ["built", "connected", "live", "verified"].map(key =>
          el("li", null, key.toUpperCase(), el("em", null, item[key] ? "YES" : "NO"))
        )
      ),
      el("small", null, item.status === "green"
        ? "Trusted across build, menu, route, and contract checks."
        : item.status === "yellow"
          ? "Built and reachable, but still missing a required menu or verification signal."
          : "Missing a build, route, menu link, or verification requirement.")
    )));
  }

  function renderActivity(activity = []) {
    const target = byId("activityFeed");
    if (!activity.length) {
      target.replaceChildren(emptyState("No operational activity has been recorded yet."));
      return;
    }
    target.replaceChildren(...activity.map(item => {
      const typeSpan = el("span", { class: "activity-type" }, item.type);
      typeSpan.append(document.createElement("br"));
      typeSpan.append(document.createTextNode(item.status));
      const copyDiv = el("div", { class: "activity-copy" },
        el("strong", null, item.title),
        el("span", null, item.detail)
      );
      const time = el("time", { class: "activity-time", datetime: item.occurredAt }, formatDateTime(item.occurredAt));
      return el("article", { class: "activity-row", "data-type": item.type },
        el("span", { class: "activity-dot", "aria-hidden": "true" }),
        typeSpan,
        copyDiv,
        time
      );
    }));
  }

  function renderCommandThread(commands = []) {
    const target = byId("commandThread");
    const visible = commands.slice(0, 24).reverse();
    if (!visible.length) {
      target.replaceChildren(el("div", { class: "command-empty" },
        el("strong", null, "The council is listening."),
        el("span", null, "Send a question, instruction, or request for a measurable action.")
      ));
    } else {
      target.replaceChildren(...visible.map(command => {
        const targetName = command.targetAgent === "council" ? "Full council" : names[command.targetAgent] || command.targetAgent;
        const ownerMeta = el("div", { class: "message-meta" },
          el("span", null, `OWNER → ${targetName}`),
          el("time", null, formatDateTime(command.createdAt))
        );
        const ownerDiv = el("div", { class: "owner-message" }, ownerMeta, el("p", null, command.message));
        const responseMeta = el("div", { class: "message-meta" },
          el("span", null, `${targetName} RESPONSE`),
          el("span", null, command.status)
        );
        const responseDiv = el("div", { class: "agent-response" }, responseMeta,
          el("strong", null, command.assessment || "Team acknowledgement"),
          el("p", null, command.response || "The team is preparing a response.")
        );
        responseDiv.style.setProperty("--agent-color", colors[command.targetAgent] || "#d4a44f");
        if (command.actionId) {
          responseDiv.append(el("span", { class: "approval-chip" }, `Action #${number(command.actionId)} · ${command.actionStatus || "proposed"}`));
        }
        return el("article", { class: "command-exchange" }, ownerDiv, responseDiv);
      }));
    }
    target.scrollTop = target.scrollHeight;
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
    renderList(byId("winsList"), run?.wins, "No recorded wins yet.");
    renderList(byId("concernsList"), run?.concerns, "No recorded concerns yet.");
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

  async function runSignalCheck() {
    const button = byId("runSignalCheckButton");
    button.disabled = true;
    button.textContent = "Signal check in progress";
    byId("maintenanceTimestamp").textContent = "Checking built, live, connected, and verified status across satellite routes now.";
    try {
      const data = await api("POST", { action: "halo-signal-check" });
      renderDashboard(data.dashboard);
      await loadControlCenter();
    } catch (error) {
      byId("maintenanceTimestamp").textContent = error instanceof Error ? error.message : "halo-signal-check failed.";
    } finally {
      button.disabled = false;
      button.textContent = "Run halo-signal-check";
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
  byId("runSignalCheckButton").addEventListener("click", runSignalCheck);
  byId("commandForm").addEventListener("submit", sendCommand);
  window.setInterval(() => {
    if (state.user && document.visibilityState === "visible") loadControlCenter();
  }, 45_000);
  window.addEventListener("halo-identity-ready", initializeIdentity, { once: true });
  if (window.haloIdentity) initializeIdentity();
})();
