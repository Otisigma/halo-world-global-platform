(() => {
  const state = {
    user: null,
    data: null,
    selectedReleaseId: null,
    statusFilter: "proposed",
    unsubscribe: null
  };

  const byId = id => document.getElementById(id);

  const formatDate = value => value
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
    : "Never";

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  // Everything below builds nodes rather than assigning markup. Contact names, notes, and drafted
  // bodies are all owner-entered or model-written text, and none of it is trusted as HTML.
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
    const response = await fetch(`/api/outreach-desk${path}`, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({ message: "The outreach desk returned an unreadable response" }));
    if (!response.ok) {
      const error = new Error(data.message || "The outreach desk request failed");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const post = payload => request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  function metric(label, value, note, lead = false) {
    const cell = node("div", lead ? "metric" : "metric");
    cell.append(node("span", "", label), node("strong", "", String(value)));
    if (note) cell.append(node("small", "", note));
    return cell;
  }

  function renderMetrics() {
    const totals = state.data.totals;
    const grid = byId("metricGrid");
    clear(grid);
    grid.append(
      metric("Contactable", totals.activeTargets, "Active contacts on the list"),
      metric("Awaiting you", state.data.pitches.filter(p => p.status === "proposed").length, "Drafted, not approved"),
      metric("Approved", state.data.pitches.filter(p => p.status === "approved").length, "Ready for you to send"),
      metric("Sent", totals.sent, "Recorded by you"),
      metric("Reply rate", totals.replyRate === null ? "—" : `${totals.replyRate}%`, `${totals.placements} placement${totals.placements === 1 ? "" : "s"}`)
    );
  }

  function renderReleases() {
    const select = byId("releaseSelect");
    clear(select);
    if (!state.data.releases.length) {
      select.append(new Option("No releases in the catalogue", ""));
      byId("runButton").disabled = true;
      return;
    }
    byId("runButton").disabled = false;
    for (const release of state.data.releases) {
      const label = `${release.artist} — ${release.title}${release.releaseDate ? ` (${release.releaseDate})` : ""}`;
      select.append(new Option(label, release.id));
    }
    if (state.selectedReleaseId) select.value = state.selectedReleaseId;
    else state.selectedReleaseId = select.value;
  }

  function renderBriefing() {
    const panel = byId("briefingPanel");
    const run = state.data.runs[0];
    if (!run) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    byId("briefingBody").textContent = run.briefing || "No briefing recorded for this run.";
    const tokens = run.usage.inputTokens + run.usage.outputTokens;
    byId("briefingCost").textContent = `${formatDate(run.createdAt)} · ${run.status} · ${tokens.toLocaleString()} tokens · ${run.usage.fallbackCalls} fallback`;
  }

  function pitchActions(pitch) {
    const row = node("div", "pitch-actions");

    if (pitch.status === "proposed") {
      const approve = node("button", "button dark small", "Approve");
      approve.type = "button";
      approve.addEventListener("click", () => act(approve, { action: "approve_pitch", pitchId: pitch.id }));
      const archive = node("button", "button quiet small", "Archive");
      archive.type = "button";
      archive.addEventListener("click", () => act(archive, { action: "archive_pitch", pitchId: pitch.id }));
      row.append(approve, archive);
    }

    if (pitch.status === "approved") {
      // The send path is a clipboard, deliberately. HALO has no mail credentials and this button is
      // the seam where a human takes over.
      const copy = node("button", "button light small", "Copy for sending");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        const text = pitch.subject ? `Subject: ${pitch.subject}\n\n${pitch.body}` : pitch.body;
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = "Copied";
          setTimeout(() => { copy.textContent = "Copy for sending"; }, 2000);
        } catch {
          copy.textContent = "Select the text above";
        }
      });

      const sent = node("button", "button dark small", "I sent this");
      sent.type = "button";
      sent.addEventListener("click", () => act(sent, { action: "mark_sent", pitchId: pitch.id }));

      const back = node("button", "button quiet small", "Return to queue");
      back.type = "button";
      back.addEventListener("click", () => act(back, { action: "unapprove_pitch", pitchId: pitch.id }));

      row.append(copy, sent, back);
    }

    return row;
  }

  function outcomeForm(pitch) {
    const form = node("form", "outcome-form");

    const label = node("label");
    label.append(node("span", "", "What happened"));
    const select = node("select");
    for (const [value, text] of [["replied", "They replied"], ["placed", "They placed it"], ["declined", "They declined"], ["no_response", "No response"]]) {
      select.append(new Option(text, value));
    }
    if (pitch.outcome !== "pending") select.value = pitch.outcome;
    label.append(select);

    const noteLabel = node("label");
    noteLabel.append(node("span", "", "Note"));
    const note = node("input");
    note.type = "text";
    note.maxLength = 600;
    note.value = pitch.outcomeNote || "";
    noteLabel.append(note);

    const save = node("button", "button light small", pitch.outcome === "pending" ? "Record" : "Update");
    save.type = "submit";

    form.append(label, noteLabel, save);
    form.addEventListener("submit", event => {
      event.preventDefault();
      act(save, { action: "record_outcome", pitchId: pitch.id, outcome: select.value, note: note.value });
    });
    return form;
  }

  function renderPitch(pitch) {
    const card = node("article", "pitch");

    const top = node("div", "pitch-top");
    const who = node("div", "pitch-who");
    who.append(
      node("strong", "", pitch.targetName || pitch.targetId),
      node("span", "", `${pitch.targetKind || "contact"} · ${pitch.channel}`)
    );
    const stamp = node("div", `fit-stamp ${pitch.fitScore >= 60 ? "fit-strong" : "fit-weak"}`);
    stamp.append(node("em", "", "Fit"), node("strong", "", String(pitch.fitScore)));
    top.append(who, stamp);
    card.append(top);

    const reasons = node("div", "reason-row");
    reasons.append(node("span", "chip status", pitch.status));
    if (pitch.outcome !== "pending") reasons.append(node("span", "chip status", pitch.outcome.replace(/_/g, " ")));
    for (const reason of pitch.fitReasons) reasons.append(node("span", "chip", reason));
    for (const key of pitch.signalKeys) reasons.append(node("span", "chip signal", key));
    card.append(reasons);

    const draft = node("div", "pitch-draft");
    if (pitch.subject) draft.append(node("p", "pitch-subject", `Subject: ${pitch.subject}`));
    draft.append(node("p", "pitch-body", pitch.body));
    const contact = pitch.contactEmail || pitch.contactUrl;
    if (contact) draft.append(node("p", "pitch-contact", `Send to: ${contact}`));
    card.append(draft);

    card.append(pitchActions(pitch));
    if (pitch.status === "sent") card.append(outcomeForm(pitch));

    return card;
  }

  function renderPitches() {
    const list = byId("pitchList");
    clear(list);

    const filtered = state.statusFilter === "all"
      ? state.data.pitches
      : state.data.pitches.filter(pitch => pitch.status === state.statusFilter);

    if (!filtered.length) {
      const empty = node("div", "empty-note");
      if (!state.data.targets.length) {
        empty.append(node("strong", "", "The list is empty, which is the correct place to start."));
        empty.append(document.createTextNode("Add contacts you actually hold — people you have met, stations that publish a submission address, editors whose work you know. Each one records where it came from. Nothing is scraped and nothing is invented, because a plausible-looking address for a real person is worse than an empty desk."));
      } else {
        empty.append(node("strong", "", "Nothing here yet."));
        empty.append(document.createTextNode("Choose a release above and run the desk to build a queue, or change the filter to see approaches at another stage."));
      }
      list.append(empty);
      return;
    }

    for (const pitch of filtered) list.append(renderPitch(pitch));
  }

  function renderTargets() {
    const list = byId("targetList");
    clear(list);
    byId("targetCount").textContent = `${state.data.targets.length} contact${state.data.targets.length === 1 ? "" : "s"}`;

    if (!state.data.targets.length) {
      const empty = node("div", "empty-note");
      empty.append(node("strong", "", "No contacts yet."));
      empty.append(document.createTextNode("Use the form above to add the first one."));
      list.append(empty);
      return;
    }

    for (const target of state.data.targets) {
      const card = node("article", `target status-${target.contactStatus}`);

      const top = node("div", "target-top");
      top.append(node("strong", "", target.name), node("span", "", target.kind));
      card.append(top);

      const metaParts = [target.organisation, target.territory].filter(Boolean);
      if (target.genres.length) metaParts.push(target.genres.join(", "));
      if (target.tempoMin && target.tempoMax) metaParts.push(`${target.tempoMin}-${target.tempoMax} BPM`);
      card.append(node("p", "target-meta", metaParts.join(" · ")));

      card.append(node("p", "target-meta",
        `Last contacted ${formatDate(target.lastContactedAt)} · cap ${target.minDaysBetweenContacts}d · ${target.pitchesSent} sent, ${target.replies} replies, ${target.placements} placed`));

      card.append(node("p", "target-source", target.sourceNote));

      const actions = node("div", "target-actions");
      const select = node("select");
      for (const [value, text] of [["active", "Active"], ["paused", "Paused"], ["opted_out", "Opted out"], ["bounced", "Bounced"]]) {
        select.append(new Option(text, value));
      }
      select.value = target.contactStatus;
      select.setAttribute("aria-label", `Contact status for ${target.name}`);
      select.addEventListener("change", () => {
        act(select, {
          action: "update_target",
          targetId: target.id,
          contactStatus: select.value,
          minDaysBetweenContacts: target.minDaysBetweenContacts,
          note: select.value === "opted_out" ? "Recorded from the outreach desk" : ""
        });
      });
      actions.append(select);
      card.append(actions);

      list.append(card);
    }
  }

  function renderWorkspace() {
    byId("gateView").hidden = true;
    byId("workspaceView").hidden = false;
    renderMetrics();
    renderReleases();
    renderBriefing();
    renderPitches();
    renderTargets();
  }

  async function act(control, payload) {
    control.disabled = true;
    try {
      const result = await post(payload);
      if (typeof result.withdrawn === "number" && result.withdrawn > 0) {
        byId("runMessage").textContent = `${result.withdrawn} queued approach${result.withdrawn === 1 ? "" : "es"} withdrawn for that contact.`;
      }
      await loadWorkspace({ quiet: true });
    } catch (error) {
      byId("runMessage").textContent = error.message;
    } finally {
      control.disabled = false;
    }
  }

  function bindControls() {
    byId("gateAction").addEventListener("click", () => window.haloIdentity?.login());

    byId("authButton").addEventListener("click", () => {
      state.user ? window.haloIdentity?.logout() : window.haloIdentity?.login();
    });

    byId("releaseSelect").addEventListener("change", event => {
      state.selectedReleaseId = event.target.value;
      loadWorkspace({ quiet: true });
    });

    byId("statusFilter").addEventListener("change", event => {
      state.statusFilter = event.target.value;
      renderPitches();
    });

    byId("runButton").addEventListener("click", async () => {
      const button = byId("runButton");
      button.disabled = true;
      byId("runMessage").textContent = "Reading the list, scoring fit, and drafting only where the evidence supports it…";
      try {
        const result = await post({ action: "run_desk", releaseId: state.selectedReleaseId });
        byId("runMessage").textContent = `${result.kept} queued, ${result.dropped} dropped, ${result.blockedSuppressed + result.blockedFrequency} held back by the contact rules. Nothing has been sent.`;
        await loadWorkspace({ quiet: true });
      } catch (error) {
        byId("runMessage").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    byId("targetForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      byId("targetMessage").textContent = "Adding the contact…";
      try {
        await post({
          action: "add_target",
          name: byId("targetName").value,
          kind: byId("targetKind").value,
          organisation: byId("targetOrg").value,
          territory: byId("targetTerritory").value,
          genres: byId("targetGenres").value.split(",").map(item => item.trim()).filter(Boolean),
          tempoMin: byId("targetTempoMin").value,
          tempoMax: byId("targetTempoMax").value,
          contactEmail: byId("targetEmail").value,
          contactUrl: byId("targetUrl").value,
          preferredChannel: byId("targetChannel").value,
          lawfulBasis: byId("targetBasis").value,
          sourceNote: byId("targetSource").value,
          minDaysBetweenContacts: byId("targetGap").value,
          notes: byId("targetNotes").value
        });
        byId("targetForm").reset();
        byId("targetGap").value = "45";
        byId("targetMessage").textContent = "Contact added.";
        await loadWorkspace({ quiet: true });
      } catch (error) {
        byId("targetMessage").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadWorkspace({ quiet = false } = {}) {
    if (!quiet) setGate("Opening the outreach desk.", "Loading contacts, queued approaches, and the last run.");
    try {
      const query = state.selectedReleaseId ? `?releaseId=${encodeURIComponent(state.selectedReleaseId)}` : "";
      state.data = await request(query);
      if (!state.selectedReleaseId && state.data.releases.length) {
        state.selectedReleaseId = state.data.releases[0].id;
      }
      renderWorkspace();
    } catch (error) {
      if (error.status === 401) setGate("Sign in to continue.", "Use the HALO owner account to open the outreach desk.", true);
      else if (error.status === 403) setGate("Owner access required.", "The outreach desk speaks for HALO to people outside it, so it is limited to the owner.");
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
      user ? loadWorkspace() : setGate("Sign in to continue.", "Use the HALO owner account to open the outreach desk.", true);
    });
    state.user ? loadWorkspace() : setGate("Sign in to continue.", "Use the HALO owner account to open the outreach desk.", true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindControls();
    if (window.haloIdentity) connectIdentity();
    else window.addEventListener("halo-identity-ready", connectIdentity, { once: true });
  });
})();
