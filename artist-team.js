(() => {
  const colors = { scout: "#d4a44f", manager: "#768c9b", amplifier: "#a77b72", circle: "#839379", compass: "#f0d79b" };
  const surfaceLabels = {
    artist_room: "Artist room",
    radio_note: "Radio show note",
    fan_update: "Fan update",
    press_note: "Press note",
    external_social: "Outside platform"
  };
  const lockedCopy = "Sign in with the account that owns your HALO artist room. The team reads only your room's signals, and every proposal waits for you.";
  const state = { identity: null, user: null, slug: "", dashboard: null };

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const number = value => new Intl.NumberFormat("en-GB").format(Number(value || 0));
  const formatDateTime = value => value ? `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC` : "Not available";
  const money = (value, currency = "GBP") => {
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0) / 100);
    } catch {
      return `${currency} ${number(Math.round(Number(value || 0) / 100))}`;
    }
  };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs || {})) {
      if (val === null || val === undefined) continue;
      if (key === "class") node.className = val;
      else if (key === "dataset") Object.entries(val).forEach(([name, value]) => { node.dataset[name] = value; });
      else node.setAttribute(key, val);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clearChildren(target, nodes) {
    target.replaceChildren(...nodes);
  }

  function cleanSlug(value) {
    return typeof value === "string"
      ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-|-$/g, "").slice(0, 80)
      : "";
  }

  function showOnly(id) {
    for (const view of ["lockedView", "pickerView", "teamView"]) byId(view).hidden = view !== id;
  }

  function showLocked(message) {
    showOnly("lockedView");
    byId("lockedMessage").textContent = message;
  }

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The agent team request failed.");
    return data;
  }

  async function signIn(event) {
    event?.preventDefault();
    if (!state.identity) return;
    const email = byId("artistEmail").value.trim();
    const password = byId("artistPassword").value;
    if (!email || !password) return;
    byId("authMessage").textContent = "Confirming your access…";
    try {
      state.user = await state.identity.login(email, password);
      byId("identityButton").textContent = "Sign out";
      byId("authMessage").textContent = "";
      await start();
    } catch (error) {
      byId("authMessage").textContent = error instanceof Error ? error.message : "Sign in could not be completed.";
    }
  }

  async function signOut() {
    await state.identity?.logout();
    state.user = null;
    state.dashboard = null;
    byId("identityButton").textContent = "Sign in";
    showLocked(lockedCopy);
  }

  async function showPicker() {
    showOnly("pickerView");
    byId("pickerMessage").textContent = "Loading your artist rooms…";
    try {
      const data = await api("GET", "/api/artist-pages");
      const pages = Array.isArray(data.pages) ? data.pages : [];
      if (!pages.length) {
        byId("pickerMessage").innerHTML = 'No artist room is connected to this account yet. <a href="/artists/">Create an artist room</a> first, and the team can start reading its signals.';
        byId("roomPicker").innerHTML = "";
        return;
      }
      byId("pickerMessage").textContent = "";
      byId("roomPicker").innerHTML = pages.map(page => `
        <li><button type="button" data-slug="${escapeHtml(page.slug)}">
          <strong>${escapeHtml(page.artistName)}</strong>
          <small>/artists/${escapeHtml(page.slug)} · ${escapeHtml(page.status)}</small>
        </button></li>
      `).join("");
    } catch (error) {
      byId("pickerMessage").textContent = error instanceof Error ? error.message : "Your artist rooms could not be loaded.";
    }
  }

  function renderSignals(signals) {
    if (!signals) return;
    byId("signalFollowers").textContent = number(signals.followers.total);
    byId("signalFollowersNew").textContent = `${number(signals.followers.new30d)} joined in 30 days`;
    byId("signalPlays").textContent = number(signals.plays.last30d);
    byId("signalRooms").textContent = signals.plays.topTrack
      ? `Top track: ${signals.plays.topTrack.title}`
      : `${number(signals.plays.rooms30d)} radio room(s)`;
    byId("signalViews").textContent = number(signals.room.views30d);
    byId("signalVisitors").textContent = `${number(signals.room.visitors30d)} distinct visitor(s)`;
    byId("signalPublished").textContent = number(signals.activity.published30d);
    byId("signalLastPublished").textContent = signals.activity.daysSinceLast === null
      ? "Nothing published yet"
      : `Last update ${number(signals.activity.daysSinceLast)} day(s) ago`;
    byId("signalReleases").textContent = number(signals.releases.published);
    byId("signalReleaseAge").textContent = signals.releases.daysSinceLatest === null
      ? "No dated release"
      : `Latest ${number(signals.releases.daysSinceLatest)} day(s) ago`;
  }

  function renderBriefing(run, momentum) {
    const score = Math.max(0, Math.min(100, Number(momentum || 0)));
    byId("momentumScore").textContent = String(score);
    byId("momentumArc").style.strokeDashoffset = String(540 - (540 * score / 100));

    if (!run) {
      byId("briefingMeta").textContent = "No briefing yet.";
      byId("briefingText").textContent = "Run the team to produce the first briefing for this room.";
      byId("briefingWins").innerHTML = "";
      byId("briefingConcerns").innerHTML = "";
      byId("briefingReflection").innerHTML = "";
      byId("groundingNote").textContent = "";
      return;
    }

    byId("briefingMeta").textContent = `${run.reportDate} · ${run.status} · ${Math.round(Number(run.confidence || 0) * 100)}% confidence · ${formatDateTime(run.completedAt || run.startedAt)}`;
    byId("briefingText").textContent = run.briefing || "The team did not produce a briefing for this run.";
    const listHtml = (items, empty) => (items?.length ? items : [empty]).map(item => `<li>${escapeHtml(item)}</li>`).join("");
    byId("briefingWins").innerHTML = listHtml(run.wins, "Nothing was confirmed as working yet.");
    byId("briefingConcerns").innerHTML = listHtml(run.concerns, "No concerns were raised this run.");
    byId("briefingReflection").innerHTML = listHtml([
      run.reflection?.whatChanged,
      run.reflection?.whatWasWrong,
      run.reflection?.whatToLearn,
      run.reflection?.nextQuestion
    ].filter(Boolean), "No self-correction was recorded.");

    const grounding = run.grounding || {};
    const dropped = Number(grounding.recommendationsDropped || 0) + Number(grounding.draftsDropped || 0);
    byId("groundingNote").textContent = dropped
      ? `${number(grounding.recommendationsKept)} item(s) kept. ${number(dropped)} were discarded because they did not cite one of this room's ${number(grounding.signalKeysAvailable)} recorded signals.`
      : `${number(grounding.recommendationsKept)} item(s) kept, each citing at least one of this room's ${number(grounding.signalKeysAvailable)} recorded signals.`;
  }

  function renderFindings(findings, roles) {
    const target = byId("agentFindings");
    if (!findings?.length) {
      target.innerHTML = Object.entries(roles || {}).map(([key, role]) => `
        <article class="agent-card" style="--agent-color:${colors[key] || "#d4a44f"}">
          <header><div><span>${escapeHtml(role.title)}</span><h3>${escapeHtml(role.name)}</h3></div><span class="confidence">WAITING</span></header>
          <p>${escapeHtml(role.mission)}</p>
        </article>
      `).join("");
      return;
    }
    target.innerHTML = findings.map(finding => {
      const role = roles?.[finding.agentKey] || { name: finding.agentKey, title: "Agent" };
      return `
        <article class="agent-card" style="--agent-color:${colors[finding.agentKey] || "#d4a44f"}">
          <header>
            <div><span>${escapeHtml(role.title)}</span><h3>${escapeHtml(role.name)}</h3></div>
            <span class="confidence">${Math.round(Number(finding.confidence || 0) * 100)}%</span>
          </header>
          <p><strong>${escapeHtml(finding.headline)}</strong></p>
          <p>${escapeHtml(finding.summary)}</p>
          ${finding.evidence?.length ? `<ul>${finding.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
          ${finding.usedFallback ? '<p class="fallback-flag">Deterministic fallback — model inference was unavailable</p>' : ""}
        </article>
      `;
    }).join("");
  }

  function renderActions(actions) {
    const target = byId("actionList");
    if (!actions?.length) {
      target.innerHTML = '<p class="empty-state">No proposals yet. Run the team to produce the first set.</p>';
      return;
    }
    target.innerHTML = actions.map(action => `
      <article class="action-card" data-action-id="${action.id}">
        <header>
          <h3>${escapeHtml(action.title)}</h3>
          <span class="tag" data-priority="${escapeHtml(action.priority)}">${escapeHtml(action.priority)} · ${escapeHtml(action.category)}</span>
        </header>
        <p>${escapeHtml(action.rationale)}</p>
        ${action.signalKeys?.length ? `<ul class="signal-chips">${action.signalKeys.map(key => `<li>${escapeHtml(key)}</li>`).join("")}</ul>` : ""}
        ${action.expectedMetric ? `<p class="expected-metric">Measured by: ${escapeHtml(action.expectedMetric)}</p>` : ""}
        <div class="card-controls">
          <span class="status-pill" data-status="${escapeHtml(action.status)}">${escapeHtml(action.status.replace("_", " "))}</span>
          <button type="button" data-tone="approve" data-action-status="approved">Approve</button>
          <button type="button" data-action-status="in_progress">Working on it</button>
          <button type="button" data-action-status="completed">Done</button>
          <button type="button" data-tone="dismiss" data-action-status="dismissed">Not doing this</button>
        </div>
        <div class="card-controls">
          <input type="text" data-field="artistNote" placeholder="Your note" value="${escapeHtml(action.artistNote)}" maxlength="1200">
          <input type="text" data-field="actualOutcome" placeholder="What actually happened" value="${escapeHtml(action.actualOutcome)}" maxlength="1200">
        </div>
      </article>
    `).join("");
  }

  function renderDrafts(drafts) {
    const target = byId("draftList");
    if (!drafts?.length) {
      target.innerHTML = '<p class="empty-state">No drafts yet. The content agent writes these when it has a number to point at.</p>';
      return;
    }
    target.innerHTML = drafts.map(draft => `
      <article class="draft-card" data-draft-id="${draft.id}">
        <header>
          <h3>${escapeHtml(draft.title || surfaceLabels[draft.surface] || "Draft")}</h3>
          <span class="tag">${escapeHtml(surfaceLabels[draft.surface] || draft.surface)}</span>
        </header>
        ${draft.requiresExternalPublish ? '<p class="external-flag">Outside HALO — copy and post this yourself</p>' : ""}
        <textarea data-field="body" maxlength="4000">${escapeHtml(draft.body)}</textarea>
        ${draft.signalKeys?.length ? `<ul class="signal-chips">${draft.signalKeys.map(key => `<li>${escapeHtml(key)}</li>`).join("")}</ul>` : ""}
        <p class="disclosure">${escapeHtml(draft.disclosure)}</p>
        <div class="card-controls">
          <span class="status-pill" data-status="${escapeHtml(draft.status)}">${escapeHtml(draft.status)}</span>
          <button type="button" data-tone="approve" data-draft-status="approved">Approve wording</button>
          <button type="button" data-draft-status="published">Mark as published</button>
          <button type="button" data-tone="dismiss" data-draft-status="dismissed">Discard</button>
        </div>
      </article>
    `).join("");
  }

  function renderPlan(plan, run) {
    byId("planTier").textContent = plan ? plan.planTier : "None";
    byId("planStatus").textContent = plan ? plan.status : "Publish the artist room to activate Starter";
    byId("planRuns").textContent = plan ? number(plan.runsRemaining) : "—";
    byId("planAllowance").textContent = plan ? `${number(plan.monthlyRunAllowance)} per month` : "";
    const usage = run?.usage;
    byId("planTokens").textContent = usage ? number(Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0)) : "—";
    byId("planCalls").textContent = usage ? `${number(usage.inferenceCalls)} model call(s), ${number(usage.fallbackCalls)} fallback(s)` : "";
    byId("planAgents").textContent = plan ? number(plan.enabledAgents.length) : "—";
    byId("planExternal").textContent = plan
      ? plan.externalPublishingEnabled ? "External publishing allowed" : "HALO never posts outside for you"
      : "";
  }

  function setLabelTab(tab) {
    document.querySelectorAll("[data-label-tab]").forEach(button => button.classList.toggle("is-active", button.dataset.labelTab === tab));
    document.querySelectorAll("[data-label-panel]").forEach(panel => {
      const active = panel.dataset.labelPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  function labelStatePill(textValue) {
    return el("span", { class: "label-chip label-state", dataset: { tone: String(textValue || "").toLowerCase() } }, textValue || "Waiting");
  }

  function metricCard(label, value, detail) {
    return el("article", { class: "label-signal-card" },
      el("span", null, label),
      el("strong", null, value),
      el("small", null, detail)
    );
  }

  function listOrFallback(items, fallback) {
    return items?.length ? items : [fallback];
  }

  function renderLabelDashboard(labelDashboard) {
    const layer = byId("labelLayer");
    if (!labelDashboard) {
      layer.hidden = true;
      return;
    }
    layer.hidden = false;
    byId("labelContinuityTitle").textContent = labelDashboard.continuity?.title || "Continuity guard armed";
    byId("labelNextAction").textContent = labelDashboard.nextAction || "Review the label queue.";
    byId("labelContinuitySummary").textContent = labelDashboard.continuity?.summary || "Continuity remains protected.";

    clearChildren(byId("labelSummaryGrid"), [
      metricCard("Signed artists", number(labelDashboard.summary?.signedArtists), "Roster rooms currently under the label layer"),
      metricCard("Pending artists", number(labelDashboard.summary?.pendingArtists), "Artist Pro leads waiting for a decision"),
      metricCard("Live releases", number(labelDashboard.summary?.liveReleases), "Active campaigns in the current window"),
      metricCard("Scheduled releases", number(labelDashboard.summary?.scheduledReleases), "Release clock not yet opened"),
      metricCard("Direct gross", money(labelDashboard.summary?.directMinor), "Direct fan support recorded in Artist Economy"),
      metricCard("Label share", money(labelDashboard.summary?.labelMinor), "Label-serviced revenue already received"),
      metricCard("Pending wire", money(labelDashboard.summary?.pendingMinor), "Expected or overdue money not spendable yet"),
      metricCard("Escrow / reserve", money(labelDashboard.summary?.escrowMinor), "Recorded obligations and reserve holds")
    ]);

    clearChildren(byId("labelRosterPreview"), listOrFallback(
      (labelDashboard.roster || []).slice(0, 3).map(item => el("article", { class: "label-mini-row" },
        el("div", { class: "label-meta-line" }, labelStatePill(item.status), el("span", { class: "label-chip" }, item.tier), el("span", { class: "label-chip" }, item.region)),
        el("strong", null, item.artistName),
        el("p", null, item.note)
      )),
      el("article", { class: "label-mini-row" }, el("strong", null, "No signed artists yet"), el("p", null, "Publish the first artist room to start the label roster."))
    ));

    clearChildren(byId("labelReleasePreview"), listOrFallback(
      (labelDashboard.releases || []).slice(0, 3).map(item => el("article", { class: "label-mini-row" },
        el("div", { class: "label-meta-line" }, labelStatePill(item.state), el("span", { class: "label-chip" }, item.artistName)),
        el("strong", null, item.title),
        el("p", null, `${item.opens30d} opens · ${item.listens30d} listens in 30 days`)
      )),
      el("article", { class: "label-mini-row" }, el("strong", null, "No release telemetry yet"), el("p", null, "Connect release rooms and campaign events to fill this clock."))
    ));

    clearChildren(byId("labelInsightPreview"), listOrFallback(
      (labelDashboard.insights?.alerts || []).slice(0, 3).map(item => el("article", { class: "label-mini-row" },
        el("div", { class: "label-meta-line" }, labelStatePill(item.status), el("span", { class: "label-chip" }, item.artistName)),
        el("strong", null, item.title),
        el("p", null, item.detail)
      )),
      el("article", { class: "label-mini-row" }, el("strong", null, "No active alerts"), el("p", null, "The label cockpit is waiting for the next notable risk or escalation."))
    ));

    clearChildren(byId("labelRosterList"), listOrFallback(
      [
        ...(labelDashboard.roster || []).map(item => el("article", { class: "label-row-card" },
          el("header", null,
            el("div", null,
              el("div", { class: "label-meta-line" }, labelStatePill(item.status), el("span", { class: "label-chip" }, item.tier), el("span", { class: "label-chip" }, item.region)),
              el("h4", null, item.artistName)
            ),
            el("div", { class: "label-score" }, el("strong", null, String(item.momentum)), el("small", null, item.momentumBand))
          ),
          el("p", null, item.note),
          el("div", { class: "label-meta-line" }, el("span", { class: "label-chip" }, `${number(item.followers)} followers`), el("span", { class: "label-chip" }, `${number(item.radioPlays30d)} radio plays`), el("span", { class: "label-chip" }, `${number(item.roomViews30d)} room views`), el("span", { class: "label-chip" }, `${number(item.releases)} releases`)),
          el("div", { class: "label-link-row" }, el("a", { href: `/artists/${encodeURIComponent(item.slug)}` }, "Artist room"), el("a", { href: `/artist-economy/?slug=${encodeURIComponent(item.slug)}` }, "Payout view"))
        )),
        ...(labelDashboard.pendingArtists || []).map(item => el("article", { class: "label-row-card" },
          el("header", null,
            el("div", null,
              el("div", { class: "label-meta-line" }, labelStatePill(item.status), el("span", { class: "label-chip" }, item.tier), el("span", { class: "label-chip" }, item.region)),
              el("h4", null, item.artistName)
            ),
            el("div", { class: "label-score" }, el("strong", null, String(item.fitScore)), el("small", null, "Label fit"))
          ),
          el("p", null, `${item.releaseTitle} · ${item.releaseStage.replaceAll("_", " ")} · ${item.primaryGoal.replaceAll("_", " ")}`),
          el("small", null, item.note)
        ))
      ],
      el("article", { class: "label-row-card" }, el("h4", null, "No roster yet"), el("p", null, "Signed and pending artists will appear here once the label has rooms and leads."))
    ));

    clearChildren(byId("labelReleaseList"), listOrFallback(
      (labelDashboard.releases || []).map(item => el("article", { class: "label-row-card" },
        el("header", null,
          el("div", null,
            el("div", { class: "label-meta-line" }, labelStatePill(item.state), el("span", { class: "label-chip" }, item.artistName), item.releaseDate ? el("span", { class: "label-chip" }, item.releaseDate) : null),
            el("h4", null, item.title)
          ),
          el("div", { class: "label-score" }, el("strong", null, String(item.momentumScore)), el("small", null, item.momentumBand))
        ),
        el("div", { class: "label-meta-line" }, el("span", { class: "label-chip" }, `${number(item.opens30d)} room opens`), el("span", { class: "label-chip" }, `${number(item.listens30d)} outbound listens`), el("span", { class: "label-chip" }, `${item.versions.length} versions`)),
        el("div", { class: "label-link-row" },
          item.links?.official ? el("a", { href: item.links.official, target: "_blank", rel: "noopener noreferrer" }, "Official") : null,
          item.links?.dj ? el("a", { href: item.links.dj, target: "_blank", rel: "noopener noreferrer" }, "DJ room") : null,
          item.links?.radio ? el("a", { href: item.links.radio, target: "_blank", rel: "noopener noreferrer" }, "Radio room") : null,
          item.links?.press ? el("a", { href: item.links.press, target: "_blank", rel: "noopener noreferrer" }, "Press room") : null
        )
      )),
      el("article", { class: "label-row-card" }, el("h4", null, "No releases yet"), el("p", null, "Draft, scheduled, live, and evergreen releases will appear here."))
    ));

    clearChildren(byId("labelDiscoveryList"), listOrFallback(
      (labelDashboard.discovery || []).map(item => el("article", { class: "label-row-card" },
        el("header", null,
          el("div", null,
            el("div", { class: "label-meta-line" }, labelStatePill(item.status), ...(item.topRegions || []).map(region => el("span", { class: "label-chip" }, region))),
            el("h4", null, item.artistName)
          ),
          el("div", { class: "label-score" }, el("strong", null, String(item.fitScore)), el("small", null, `${item.momentum} momentum`))
        ),
        el("p", null, item.recommendation)
      )),
      el("article", { class: "label-row-card" }, el("h4", null, "No discovery signals yet"), el("p", null, "New candidates and strongest roster fits will appear here."))
    ));

    clearChildren(byId("labelPayoutList"), listOrFallback(
      (labelDashboard.payouts || []).map(item => el("article", { class: "label-row-card" },
        el("header", null,
          el("div", null, el("div", { class: "label-meta-line" }, el("span", { class: "label-chip" }, item.artistName)), el("h4", null, "Payout + rights position")),
          el("div", { class: "label-score" }, el("strong", null, money((item.directMinor || 0) + (item.labelMinor || 0), item.currency)), el("small", null, "received"))
        ),
        el("div", { class: "label-meta-line" }, el("span", { class: "label-chip" }, `Direct ${money(item.directMinor, item.currency)}`), el("span", { class: "label-chip" }, `Label ${money(item.labelMinor, item.currency)}`), el("span", { class: "label-chip" }, `Pending ${money(item.pendingMinor, item.currency)}`), el("span", { class: "label-chip" }, `Escrow ${money(item.escrowMinor, item.currency)}`)),
        el("div", { class: "label-splits" }, el("span", { class: "label-split" }, `Artist share ${Math.round((item.artistShareBps || 0) / 100)}%`), el("span", { class: "label-split" }, `Label share ${Math.round((item.labelShareBps || 0) / 100)}%`))
      )),
      el("article", { class: "label-row-card" }, el("h4", null, "No payout telemetry yet"), el("p", null, "Artist Economy entries will fill direct, label, pending, and escrow positions here."))
    ));

    clearChildren(byId("labelCampaignList"), listOrFallback(
      (labelDashboard.campaigns || []).map(item => el("article", { class: "label-row-card" },
        el("header", null,
          el("div", null,
            el("div", { class: "label-meta-line" }, labelStatePill(item.stage), el("span", { class: "label-chip" }, item.artistName), el("span", { class: "label-chip" }, item.decision)),
            el("h4", null, item.title)
          ),
          el("div", { class: "label-score" }, el("strong", null, money(item.spentMinor, item.currency)), el("small", null, `${number(item.meaningfulActions)} actions`))
        ),
        el("p", null, item.learning || "No lesson written yet."),
        el("div", { class: "label-meta-line" }, el("span", { class: "label-chip" }, `Budget ${money(item.budgetMinor, item.currency)}`), ...item.actions.map(action => el("span", { class: "label-chip" }, action))),
        el("div", { class: "label-link-row" }, el("a", { href: `/artists/${encodeURIComponent(item.artistSlug)}` }, "Artist room"), el("a", { href: `/artist-economy/?slug=${encodeURIComponent(item.artistSlug)}` }, "Campaign evidence"))
      )),
      el("article", { class: "label-row-card" }, el("h4", null, "No campaigns yet"), el("p", null, "Campaign lanes will appear after the first recorded test."))
    ));

    clearChildren(byId("labelInsightList"), listOrFallback(
      [
        ...((labelDashboard.insights?.prioritizedActions || []).map(item => el("article", { class: "label-row-card" },
          el("header", null,
            el("div", null, el("div", { class: "label-meta-line" }, labelStatePill(item.priority), el("span", { class: "label-chip" }, item.artistName), el("span", { class: "label-chip" }, item.category)), el("h4", null, item.title)),
            el("div", { class: "label-score" }, el("strong", null, item.priority.toUpperCase()), el("small", null, item.status))
          ),
          el("p", null, item.expectedMetric || "Owner defines the measured outcome.")
        ))),
        ...((labelDashboard.insights?.alerts || []).map(item => el("article", { class: "label-row-card" },
          el("div", { class: "label-meta-line" }, labelStatePill(item.status), el("span", { class: "label-chip" }, item.artistName)),
          el("h4", null, item.title),
          el("p", null, item.detail)
        )))
      ],
      el("article", { class: "label-row-card" }, el("h4", null, "No insights queued"), el("p", null, "Priority actions and risk alerts will collect here."))
    ));

    setLabelTab(document.querySelector("[data-label-tab].is-active")?.dataset.labelTab || "dashboard");
  }

  function renderDashboard(dashboard) {
    state.dashboard = dashboard;
    showOnly("teamView");
    byId("heroLabel").textContent = dashboard.artistName ? `${dashboard.artistName.toUpperCase()} / AGENT TEAM` : "ARTIST INTELLIGENCE";
    byId("roomLink").href = `/artists/${encodeURIComponent(dashboard.artistSlug)}`;
    renderSignals(dashboard.signals);
    renderBriefing(dashboard.latestRun, dashboard.momentum);
    renderFindings(dashboard.findings, dashboard.roles);
    renderActions(dashboard.actions);
    renderDrafts(dashboard.drafts);
    renderPlan(dashboard.plan, dashboard.latestRun);
    renderLabelDashboard(dashboard.viewer?.platformOwner ? dashboard.labelDashboard : null);
    byId("runButton").disabled = !dashboard.plan || dashboard.plan.runsRemaining <= 0;
    byId("runMessage").textContent = dashboard.plan
      ? dashboard.plan.runsRemaining <= 0 ? "This plan has used its runs for the month." : ""
      : "Publish this artist room to activate the free Starter team.";
  }

  async function loadDashboard() {
    try {
      renderDashboard(await api("GET", `/api/artist-agents?slug=${encodeURIComponent(state.slug)}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The agent team could not be loaded.";
      if (/sign in/i.test(message)) showLocked(message);
      else {
        showOnly("pickerView");
        byId("pickerMessage").textContent = message;
        await showPicker();
      }
    }
  }

  async function runTeam() {
    const button = byId("runButton");
    button.disabled = true;
    byId("runMessage").textContent = "The team is reading this room's signals…";
    try {
      const data = await api("POST", "/api/artist-agents", { action: "run", slug: state.slug });
      renderDashboard(data.dashboard);
      byId("runMessage").textContent = "New briefing ready.";
    } catch (error) {
      byId("runMessage").textContent = error instanceof Error ? error.message : "The run could not be completed.";
      button.disabled = false;
    }
  }

  async function handleActionClick(event) {
    const button = event.target.closest("button[data-action-status]");
    if (!button) return;
    const card = button.closest("[data-action-id]");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Saving";
    try {
      await api("POST", "/api/artist-agents", {
        action: "update_action",
        slug: state.slug,
        actionId: Number(card.dataset.actionId),
        status: button.dataset.actionStatus,
        artistNote: card.querySelector('[data-field="artistNote"]').value,
        actualOutcome: card.querySelector('[data-field="actualOutcome"]').value
      });
      await loadDashboard();
    } catch (error) {
      button.textContent = error instanceof Error ? error.message : "Save failed";
      button.disabled = false;
      setTimeout(() => { button.textContent = original; }, 4000);
    }
  }

  async function handleDraftClick(event) {
    const button = event.target.closest("button[data-draft-status]");
    if (!button) return;
    const card = button.closest("[data-draft-id]");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Saving";
    try {
      await api("POST", "/api/artist-agents", {
        action: "update_draft",
        slug: state.slug,
        draftId: Number(card.dataset.draftId),
        status: button.dataset.draftStatus,
        body: card.querySelector('[data-field="body"]').value
      });
      await loadDashboard();
    } catch (error) {
      button.textContent = error instanceof Error ? error.message : "Save failed";
      button.disabled = false;
      setTimeout(() => { button.textContent = original; }, 4000);
    }
  }

  function selectRoom(event) {
    const button = event.target.closest("button[data-slug]");
    if (!button) return;
    state.slug = cleanSlug(button.dataset.slug);
    const url = new URL(window.location.href);
    url.searchParams.set("slug", state.slug);
    window.history.replaceState({}, "", url);
    loadDashboard();
  }

  async function start() {
    if (!state.user) {
      showLocked(lockedCopy);
      return;
    }
    state.slug = cleanSlug(new URL(window.location.href).searchParams.get("slug"));
    if (state.slug) await loadDashboard();
    else await showPicker();
  }

  async function initializeIdentity() {
    state.identity = window.haloIdentity;
    if (!state.identity) return;
    state.user = await state.identity.getUser().catch(() => null);
    byId("identityButton").textContent = state.user ? "Sign out" : "Sign in";
    await start();
  }

  byId("identityButton").addEventListener("click", () => {
    if (state.user) return signOut();
    showLocked(lockedCopy);
    byId("artistEmail").focus();
  });
  byId("artistAuthForm").addEventListener("submit", signIn);
  byId("runButton").addEventListener("click", runTeam);
  byId("actionList").addEventListener("click", handleActionClick);
  byId("draftList").addEventListener("click", handleDraftClick);
  byId("roomPicker").addEventListener("click", selectRoom);
  byId("labelTabRail")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-label-tab]");
    if (!button) return;
    setLabelTab(button.dataset.labelTab);
  });
  window.addEventListener("halo-identity-ready", initializeIdentity, { once: true });
  if (window.haloIdentity) initializeIdentity();
})();
