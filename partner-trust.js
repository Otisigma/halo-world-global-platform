(() => {
  const state = { user: null, data: null, selectedPartnerId: "", statusFilter: "proposed", unsubscribe: null };
  const byId = id => document.getElementById(id);
  const node = (tag, className = "", text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const clear = element => { while (element.firstChild) element.removeChild(element.firstChild); };
  const formatDate = value => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Never";

  function setGate(title, message, action = false) {
    byId("gateView").hidden = false;
    byId("workspaceView").hidden = true;
    byId("gateTitle").textContent = title;
    byId("gateMessage").textContent = message;
    byId("gateAction").hidden = !action;
  }

  async function request(options = {}) {
    const response = await fetch("/api/partner-trust", { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({ message: "The partner trust desk returned an unreadable response" }));
    if (!response.ok) {
      const error = new Error(data.message || "The partner trust request failed");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const post = payload => request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  function renderRoles() {
    const list = byId("roleList");
    clear(list);
    state.data.roles.forEach((role, index) => {
      const card = node("article", "role");
      card.append(node("span", "", `${String(index + 1).padStart(2, "0")} · ${role.title}`), node("h3", "", role.name), node("p", "", role.mission));
      list.append(card);
    });
  }

  function selectPartner(partnerId) {
    state.selectedPartnerId = partnerId;
    byId("briefPartner").value = partnerId;
    document.querySelectorAll(".partner-card").forEach(card => card.classList.toggle("is-selected", card.dataset.partnerId === partnerId));
  }

  function renderPartners() {
    const list = byId("partnerList");
    const select = byId("briefPartner");
    clear(list);
    clear(select);
    byId("partnerCount").textContent = `${state.data.partners.length} record${state.data.partners.length === 1 ? "" : "s"}`;
    if (!state.data.partners.length) {
      list.append(node("p", "empty", "Add the first platform record with its intended use and safeguards."));
      select.append(new Option("No platform records", ""));
      byId("draftButton").disabled = true;
      return;
    }
    byId("draftButton").disabled = false;
    if (!state.selectedPartnerId || !state.data.partners.some(partner => partner.id === state.selectedPartnerId)) state.selectedPartnerId = state.data.partners[0].id;
    state.data.partners.forEach(partner => {
      const card = node("article", `partner-card${partner.id === state.selectedPartnerId ? " is-selected" : ""}`);
      card.dataset.partnerId = partner.id;
      const top = node("div", "partner-card-top");
      top.append(node("h3", "", partner.name), node("span", "status", partner.relationshipStatus));
      card.append(top, node("p", "", partner.usageSummary), node("span", "safeguard-count", `${partner.safeguards.length} recorded safeguards`));
      card.addEventListener("click", () => selectPartner(partner.id));
      list.append(card);
      select.append(new Option(partner.name, partner.id));
    });
    select.value = state.selectedPartnerId;
  }

  function button(label, className, handler) {
    const element = node("button", `button small ${className}`, label);
    element.type = "button";
    element.addEventListener("click", () => handler(element));
    return element;
  }

  async function act(control, payload) {
    control.disabled = true;
    const original = control.textContent;
    control.textContent = "Working…";
    try {
      await post(payload);
      await loadWorkspace(true);
    } catch (error) {
      byId("briefMessage").textContent = error.message;
    } finally {
      control.disabled = false;
      control.textContent = original;
    }
  }

  function renderBriefs() {
    const list = byId("briefList");
    clear(list);
    const briefs = state.data.briefs.filter(brief => state.statusFilter === "all" || brief.status === state.statusFilter);
    if (!briefs.length) {
      list.append(node("p", "empty", state.statusFilter === "proposed" ? "No briefs are waiting. Choose a platform and ask the team to prepare one." : "No briefs match this status."));
      return;
    }
    briefs.forEach(brief => {
      const card = node("article", "brief-card");
      const top = node("div", "brief-top");
      const heading = node("div");
      heading.append(node("span", "brief-meta", `${brief.partnerName} · ${brief.purpose.replaceAll("_", " ")} · ${formatDate(brief.createdAt)}`), node("h3", "", brief.subject || "Partner trust note"));
      top.append(heading, node("span", "status", brief.status));
      card.append(top, node("div", "brief-body", brief.body));
      const evidence = node("div", "evidence");
      brief.evidenceKeys.forEach(key => evidence.append(node("span", "", key)));
      card.append(evidence);
      if (brief.reviewNotes) card.append(node("p", "review-note", brief.reviewNotes));
      const actions = node("div", "brief-actions");
      if (brief.status === "proposed") {
        actions.append(
          button("Approve", "ink", control => act(control, { action: "approve_brief", briefId: brief.id })),
          button("Archive", "quiet", control => act(control, { action: "archive_brief", briefId: brief.id }))
        );
      }
      if (brief.status === "approved") {
        actions.append(button("Copy for human sharing", "rust", async control => {
          try {
            await navigator.clipboard.writeText(`${brief.subject ? `Subject: ${brief.subject}\n\n` : ""}${brief.body}`);
            control.textContent = "Copied";
          } catch {
            byId("briefMessage").textContent = "Clipboard access was unavailable. Select the brief text manually.";
          }
        }), button("Record as shared", "ink", control => act(control, { action: "record_shared", briefId: brief.id, note: "Owner confirmed the approved brief was shared through a human-selected channel." })));
      }
      if (brief.status === "shared") {
        const responseForm = node("form", "response-form");
        const input = node("input");
        input.required = true;
        input.maxLength = 2000;
        input.placeholder = "Record the platform response or current outcome";
        const save = node("button", "button small ink", "Record response");
        save.type = "submit";
        responseForm.append(input, save);
        responseForm.addEventListener("submit", event => {
          event.preventDefault();
          if (input.value.trim()) act(save, { action: "record_response", briefId: brief.id, note: input.value.trim() });
        });
        card.append(responseForm);
      }
      if (actions.children.length) card.append(actions);
      if (brief.responseNote) card.append(node("p", "review-note", `Recorded response: ${brief.responseNote}`));
      list.append(card);
    });
  }

  function renderWorkspace() {
    byId("gateView").hidden = true;
    byId("workspaceView").hidden = false;
    byId("partnerMetric").textContent = state.data.totals.partners;
    byId("proposedMetric").textContent = state.data.totals.proposed;
    byId("approvedMetric").textContent = state.data.totals.approved;
    byId("sharedMetric").textContent = state.data.totals.shared;
    renderRoles();
    renderPartners();
    renderBriefs();
  }

  async function loadWorkspace(quiet = false) {
    if (!quiet) setGate("Opening the partner trust desk.", "Loading platform records, safeguards, and owner-reviewed briefs.");
    try {
      state.data = await request();
      renderWorkspace();
    } catch (error) {
      if (error.status === 401) setGate("Sign in to continue.", "Use the HALO owner account to open partner communications.", true);
      else if (error.status === 403) setGate("Owner access required.", "This desk speaks for HALO outside the platform, so it remains owner-only.");
      else setGate("The desk is temporarily unavailable.", error.message);
    }
  }

  function bindControls() {
    byId("authButton").addEventListener("click", () => state.user ? window.haloIdentity?.logout() : window.haloIdentity?.login());
    byId("gateAction").addEventListener("click", () => window.haloIdentity?.login());
    byId("briefPartner").addEventListener("change", event => selectPartner(event.target.value));
    byId("statusFilter").addEventListener("change", event => { state.statusFilter = event.target.value; renderBriefs(); });
    byId("briefForm").addEventListener("submit", async event => {
      event.preventDefault();
      const control = byId("draftButton");
      control.disabled = true;
      control.textContent = "The team is reviewing…";
      byId("briefMessage").textContent = "Bridge, Covenant, Rights, Signal, and Mirror are preparing one grounded draft.";
      try {
        await post({ action: "draft_brief", partnerId: byId("briefPartner").value, purpose: byId("briefPurpose").value, ownerContext: byId("ownerContext").value });
        state.statusFilter = "proposed";
        byId("statusFilter").value = "proposed";
        byId("ownerContext").value = "";
        byId("briefMessage").textContent = "Draft prepared for owner review. Nothing was sent.";
        await loadWorkspace(true);
      } catch (error) {
        byId("briefMessage").textContent = error.message;
      } finally {
        control.disabled = false;
        control.textContent = "Ask the team to draft";
      }
    });
    byId("partnerForm").addEventListener("submit", async event => {
      event.preventDefault();
      const control = event.submitter;
      control.disabled = true;
      try {
        await post({ action: "add_partner", name: byId("partnerName").value, platformUrl: byId("platformUrl").value, accountUrl: byId("accountUrl").value, contactUrl: byId("contactUrl").value, sourceNote: byId("sourceNote").value, usageSummary: byId("usageSummary").value, safeguards: byId("safeguards").value });
        event.currentTarget.reset();
        byId("partnerMessage").textContent = "Platform record added with its provenance and safeguards.";
        await loadWorkspace(true);
      } catch (error) {
        byId("partnerMessage").textContent = error.message;
      } finally {
        control.disabled = false;
      }
    });
  }

  async function connectIdentity() {
    state.user = await window.haloIdentity.getUser().catch(() => null);
    byId("authButton").textContent = state.user ? "Sign out" : "Sign in";
    state.unsubscribe?.();
    state.unsubscribe = window.haloIdentity.onAuthChange((_event, user) => {
      state.user = user;
      byId("authButton").textContent = user ? "Sign out" : "Sign in";
      user ? loadWorkspace() : setGate("Sign in to continue.", "Use the HALO owner account to open partner communications.", true);
    });
    state.user ? loadWorkspace() : setGate("Sign in to continue.", "Use the HALO owner account to open partner communications.", true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindControls();
    if (window.haloIdentity) connectIdentity();
    else window.addEventListener("halo-identity-ready", connectIdentity, { once: true });
  });
})();
