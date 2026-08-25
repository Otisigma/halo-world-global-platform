(() => {
  const state = { user: null, workspace: null, selectedMemberId: null, detail: null, unsubscribe: null };
  const byId = id => document.getElementById(id);
  const formatDate = value => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "No signal yet";
  const formatDateTime = value => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not scheduled";

  function relativeTime(value) {
    if (!value) return "No signal yet";
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
      if (Math.abs(seconds) >= size || unit === "minute") return formatter.format(Math.round(seconds / size), unit);
    }
    return "Just now";
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function node(tag, className = "", text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setGate(title, message, action = false) {
    byId("gateView").hidden = false;
    byId("workspaceView").hidden = true;
    byId("gateTitle").textContent = title;
    byId("gateMessage").textContent = message;
    byId("gateAction").hidden = !action;
  }

  async function request(path = "", options = {}) {
    const response = await fetch(`/api/halo-relations${path}`, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({ message: "HALO Relations returned an unreadable response" }));
    if (!response.ok) {
      const error = new Error(data.message || "HALO Relations request failed");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const post = payload => request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  function renderMetrics(metrics) {
    const grid = byId("metricGrid");
    clear(grid);
    [["Known members", metrics.totalMembers], ["Joined · 7 days", metrics.joined7d], ["Active · 7 days", metrics.active7d], ["Consent recorded", metrics.contactable], ["Follow-ups overdue", metrics.overdueTasks]].forEach(([label, value]) => {
      const card = node("article", "metric");
      card.append(node("span", "", label), node("strong", "", String(value)));
      grid.append(card);
    });
  }

  function filteredMembers() {
    const query = byId("memberSearch").value.trim().toLowerCase();
    const stage = byId("stageFilter").value;
    return state.workspace.members.filter(member => {
      const searchText = [member.name, member.email, member.region, ...member.tags].join(" ").toLowerCase();
      return (!query || searchText.includes(query)) && (stage === "all" || member.stage === stage);
    });
  }

  function renderMemberList() {
    const list = byId("memberList");
    const members = filteredMembers();
    clear(list);
    byId("memberCount").textContent = `${members.length} ${members.length === 1 ? "person" : "people"}`;
    if (!members.length) return list.append(node("p", "empty-row", "No members match this view."));
    members.forEach(member => {
      const button = node("button", `member-card${member.id === state.selectedMemberId ? " active" : ""}`);
      button.type = "button";
      button.addEventListener("click", () => selectMember(member.id));
      const top = node("div", "member-card-top");
      top.append(node("strong", "", member.name), node("span", "stage-chip", member.stage));
      const bottom = node("div", "member-card-bottom");
      const consent = node("span", `consent-dot${member.contactConsent ? " on" : ""}`);
      consent.title = member.contactConsent ? "Contact consent recorded" : "No contact consent recorded";
      bottom.append(node("span", "", relativeTime(member.lastSignInAt || member.lastSeenAt)), node("span", "", `${member.openTaskCount} tasks`), consent);
      button.append(top, node("p", "", member.invitedByName ? `${member.email || "No email available"} · invited by ${member.invitedByName}` : member.email || "No email available"), bottom);
      list.append(button);
    });
  }

  function renderPulseList(elementId, rows, type) {
    const list = byId(elementId);
    clear(list);
    if (!rows.length) return list.append(node("p", "empty-row", type === "task" ? "No open follow-ups." : "No account signals recorded yet."));
    rows.forEach(row => {
      const item = node("button", "pulse-row");
      item.type = "button";
      item.addEventListener("click", () => selectMember(row.memberId));
      if (type === "task") item.append(node("time", "", row.dueAt ? formatDateTime(row.dueAt) : "No due date"), node("strong", "", row.title), node("span", "", row.memberName));
      else item.append(node("time", "", relativeTime(row.occurredAt)), node("strong", "", row.memberName), node("span", "", row.type));
      list.append(item);
    });
  }

  function renderWorkspace() {
    byId("gateView").hidden = true;
    byId("workspaceView").hidden = false;
    renderMetrics(state.workspace.metrics);
    renderMemberList();
    renderPulseList("globalTaskList", state.workspace.tasks, "task");
    renderPulseList("activityList", state.workspace.activity, "activity");
  }

  function renderNotes(notes) {
    const list = byId("noteList");
    clear(list);
    byId("noteCount").textContent = `${notes.length} ${notes.length === 1 ? "note" : "notes"}`;
    if (!notes.length) return list.append(node("p", "empty-row", "No private team notes yet."));
    notes.forEach(note => {
      const item = node("article", "timeline-item");
      item.append(node("time", "", formatDateTime(note.createdAt)), node("p", "", note.body), node("small", "", note.authorName));
      list.append(item);
    });
  }

  function renderTasks(tasks) {
    const list = byId("taskList");
    clear(list);
    byId("taskCount").textContent = `${tasks.filter(task => task.status === "open").length} open`;
    if (!tasks.length) return list.append(node("p", "empty-row", "No follow-up tasks yet."));
    tasks.forEach(task => {
      const item = node("article", "timeline-item");
      item.append(node("time", "", task.dueAt ? formatDateTime(task.dueAt) : formatDate(task.createdAt)), node("p", "", task.title));
      if (task.status === "open") {
        const button = node("button", "tiny-button", "Complete");
        button.type = "button";
        button.addEventListener("click", () => completeTask(task.id));
        item.append(button);
      } else item.append(node("small", "", "Completed"));
      list.append(item);
    });
  }

  function renderDrafts(drafts) {
    const list = byId("draftList");
    clear(list);
    if (!drafts.length) return list.append(node("p", "empty-row", "No drafts. Consent is required before creating one."));
    drafts.forEach(draft => {
      const card = node("article", "draft-card");
      const header = node("header");
      header.append(node("span", "", `${draft.role} AI`), node("span", "", draft.status));
      const actions = node("div", "draft-actions");
      const copy = node("button", "", "Copy");
      copy.type = "button";
      copy.addEventListener("click", async () => { await navigator.clipboard.writeText(draft.content); copy.textContent = "Copied"; });
      actions.append(copy);
      if (draft.status === "draft") {
        for (const [label, status] of [["Mark approved", "approved"], ["Discard", "discarded"]]) {
          const action = node("button", "", label);
          action.type = "button";
          action.addEventListener("click", () => updateDraft(draft.id, status));
          actions.append(action);
        }
      }
      card.append(header, node("p", "", draft.content), actions);
      list.append(card);
    });
  }

  function renderEvents(events) {
    const list = byId("eventList");
    clear(list);
    if (!events.length) return list.append(node("p", "empty-row", "No session signals yet."));
    events.forEach(event => {
      const row = node("div", "event-row");
      row.append(node("i"), node("span", "", event.type), node("time", "", relativeTime(event.occurredAt)));
      list.append(row);
    });
  }

  function renderDetail() {
    const detail = state.detail;
    byId("emptyDetail").hidden = true;
    byId("memberDetail").hidden = false;
    byId("detailKicker").textContent = `${detail.member.badge} · ${detail.member.region}`;
    byId("detailName").textContent = detail.member.name;
    const inviteContext = detail.member.invitedByName ? ` · Invited by ${detail.member.invitedByName}` : "";
    byId("detailMeta").textContent = `${detail.member.email || "No email"} · Joined ${formatDate(detail.member.joinedAt)} · ${detail.member.tier}${inviteContext}`;
    byId("detailLastSeen").textContent = relativeTime(detail.member.lastSignInAt || detail.member.lastSeenAt);
    byId("profileStage").value = detail.member.stage;
    byId("profileChannel").value = detail.member.preferredChannel;
    byId("profileConsent").checked = detail.member.contactConsent;
    byId("profileTags").value = detail.member.tags.join(", ");
    byId("profileSummary").value = detail.member.summary;
    byId("profileMessage").textContent = "";
    renderNotes(detail.notes);
    renderTasks(detail.tasks);
    renderDrafts(detail.drafts);
    renderEvents(detail.events);
  }

  async function selectMember(memberId) {
    state.selectedMemberId = memberId;
    renderMemberList();
    byId("emptyDetail").hidden = false;
    byId("emptyDetail").querySelector("h2").textContent = "Loading relationship context…";
    byId("memberDetail").hidden = true;
    try {
      state.detail = (await request(`?member=${encodeURIComponent(memberId)}`)).detail;
      renderDetail();
    } catch (error) {
      byId("emptyDetail").querySelector("h2").textContent = "This profile could not load.";
      byId("emptyDetail").querySelector("p:last-child").textContent = error.message;
    }
  }

  function applyUpdate(data) {
    if (data.workspace) state.workspace = data.workspace;
    if (data.detail) state.detail = data.detail;
    renderWorkspace();
    if (state.detail) renderDetail();
  }

  async function completeTask(taskId) {
    applyUpdate(await post({ action: "complete_task", memberId: state.selectedMemberId, taskId }));
  }

  async function updateDraft(draftId, status) {
    applyUpdate(await post({ action: "update_draft", memberId: state.selectedMemberId, draftId, status }));
  }

  function bindForms() {
    byId("memberSearch").addEventListener("input", renderMemberList);
    byId("stageFilter").addEventListener("change", renderMemberList);
    byId("gateAction").addEventListener("click", () => location.assign("/halo-x.html"));
    byId("authButton").addEventListener("click", async () => state.user ? window.haloIdentity.logout() : location.assign("/halo-x.html"));
    byId("profileForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        applyUpdate(await post({ action: "update_member", memberId: state.selectedMemberId, stage: byId("profileStage").value, preferredChannel: byId("profileChannel").value, contactConsent: byId("profileConsent").checked, tags: byId("profileTags").value.split(","), summary: byId("profileSummary").value }));
        byId("profileMessage").textContent = "Saved";
      } catch (error) { byId("profileMessage").textContent = error.message; }
      finally { button.disabled = false; }
    });
    byId("noteForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try { applyUpdate(await post({ action: "add_note", memberId: state.selectedMemberId, body: byId("noteBody").value })); byId("noteBody").value = ""; }
      catch (error) { byId("profileMessage").textContent = error.message; }
      finally { button.disabled = false; }
    });
    byId("taskForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        const dueValue = byId("taskDue").value;
        applyUpdate(await post({ action: "create_task", memberId: state.selectedMemberId, title: byId("taskTitle").value, dueAt: dueValue ? new Date(dueValue).toISOString() : null }));
        byId("taskTitle").value = "";
        byId("taskDue").value = "";
      } catch (error) { byId("profileMessage").textContent = error.message; }
      finally { button.disabled = false; }
    });
    byId("draftForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      byId("draftMessage").textContent = "Creating a consent-aware review draft…";
      try {
        const data = await post({ action: "generate_draft", memberId: state.selectedMemberId, role: byId("draftRole").value, intent: byId("draftIntent").value });
        state.detail = data.detail;
        renderDetail();
        byId("draftMessage").textContent = data.message;
      } catch (error) { byId("draftMessage").textContent = error.message; }
      finally { button.disabled = false; }
    });
  }

  async function loadWorkspace() {
    setGate("Opening the relationship desk.", "Loading approved membership signals and team follow-ups.");
    try {
      state.workspace = (await request()).workspace;
      renderWorkspace();
    } catch (error) {
      if (error.status === 401) setGate("Sign in to continue.", "Use the HALO owner account to open this private workspace.", true);
      else if (error.status === 403) setGate("Owner access required.", "This workspace contains private relationship context and is limited to the owner team.");
      else setGate("The desk is temporarily unavailable.", error.message);
    }
  }

  async function connectIdentity() {
    state.user = await window.haloIdentity.getUser().catch(() => null);
    byId("authButton").textContent = state.user ? "Sign out" : "Sign in";
    state.unsubscribe?.();
    state.unsubscribe = window.haloIdentity.onAuthChange((_event, user) => {
      state.user = user;
      byId("authButton").textContent = user ? "Sign out" : "Sign in";
      user ? loadWorkspace() : setGate("Sign in to continue.", "Use the HALO owner account to open this private workspace.", true);
    });
    state.user ? loadWorkspace() : setGate("Sign in to continue.", "Use the HALO owner account to open this private workspace.", true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindForms();
    if (window.haloIdentity) connectIdentity();
    else window.addEventListener("halo-identity-ready", connectIdentity, { once: true });
  });
})();
