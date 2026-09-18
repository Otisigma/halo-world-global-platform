(() => {
  const state = {
    identity: null,
    user: null,
    slug: new URLSearchParams(location.search).get("slug") || localStorage.getItem("halo-artist-economy-slug") || "",
    dashboard: null,
    formKind: ""
  };

  const byId = id => document.getElementById(id);
  const careerLabels = {
    first_master: "First master",
    first_audience: "First audience",
    repeatable_releases: "Repeatable releases",
    professional_opportunities: "Professional opportunities",
    sustainable_catalogue: "Sustainable catalogue"
  };
  const statusOptions = {
    work: ["incomplete", "review", "cleared", "hold", "disputed"],
    adminPublishing: ["unknown", "self_administered", "administered", "publisher_controlled", "seeking_admin"],
    income: ["expected", "received", "overdue", "disputed", "reconciled"],
    campaignStage: ["readiness", "test", "scale", "closed"],
    campaignDecision: ["prepare", "test", "scale", "stop", "complete"],
    licensingStage: ["brief", "matched", "artist_approval", "pitched", "negotiating", "contracted", "delivered", "paid", "declined"],
    rightsCheck: ["required", "reviewing", "clear", "hold"],
    licensingApproval: ["required", "requested", "approved", "declined"],
    settlement: ["planning", "confirmed", "performed", "settling", "paid", "cancelled"],
    review: ["review", "approve", "revise", "reject"],
    societyType: ["pro", "cmo", "neighbouring_rights", "mechanical", "publisher_admin", "other"],
    membershipStatus: ["research", "applied", "active", "hold"]
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function titleCase(value) {
    return String(value || "").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function toMinor(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
  }

  function fromMinor(value) {
    return (Number(value || 0) / 100).toFixed(2);
  }

  function money(value, currency = state.dashboard?.profile?.currency || "GBP") {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0) / 100);
    } catch {
      return `${currency} ${fromMinor(value)}`;
    }
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "Not dated";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "Not dated";
    return new Intl.DateTimeFormat(undefined, includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(date);
  }

  function options(values, selected) {
    return values.map(value => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(titleCase(value))}</option>`).join("");
  }

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The Artist Economy request failed.");
    return data;
  }

  function showOnly(id) {
    for (const viewId of ["lockedView", "pickerView", "economyView"]) byId(viewId).hidden = viewId !== id;
  }

  async function signIn(event) {
    event.preventDefault();
    if (!state.identity) return;
    byId("authMessage").textContent = "Confirming artist ownership…";
    try {
      state.user = await state.identity.login(byId("artistEmail").value.trim(), byId("artistPassword").value);
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
    showOnly("lockedView");
  }

  async function showPicker() {
    showOnly("pickerView");
    byId("pickerMessage").textContent = "Loading your artist rooms…";
    try {
      const data = await api("GET", "/api/artist-pages");
      const pages = Array.isArray(data.pages) ? data.pages : [];
      if (!pages.length) {
        byId("roomPicker").innerHTML = "";
        byId("pickerMessage").innerHTML = 'No artist room belongs to this account yet. <a href="/artists/">Create the artist room first.</a>';
        return;
      }
      byId("pickerMessage").textContent = "";
      byId("roomPicker").innerHTML = pages.map(page => `
        <li><button type="button" data-room-slug="${escapeHtml(page.slug)}"><strong>${escapeHtml(page.artistName)}</strong><small>/artists/${escapeHtml(page.slug)} · ${escapeHtml(page.status)}</small></button></li>
      `).join("");
    } catch (error) {
      byId("pickerMessage").textContent = error instanceof Error ? error.message : "Artist rooms could not be loaded.";
    }
  }

  async function loadDashboard() {
    if (!state.slug) return showPicker();
    try {
      const dashboard = await api("GET", `/api/artist-economy?slug=${encodeURIComponent(state.slug)}`);
      state.dashboard = dashboard;
      localStorage.setItem("halo-artist-economy-slug", state.slug);
      history.replaceState(null, "", `/artist-economy/?slug=${encodeURIComponent(state.slug)}`);
      renderDashboard();
      showOnly("economyView");
    } catch (error) {
      if (/another artist room|not found/i.test(error.message)) {
        state.slug = "";
        localStorage.removeItem("halo-artist-economy-slug");
        return showPicker();
      }
      byId("lockedMessage").textContent = error instanceof Error ? error.message : "The Artist Economy could not be opened.";
      showOnly("lockedView");
    }
  }

  function renderDashboard() {
    const { artist, profile, summary, viewer } = state.dashboard;
    byId("artistName").textContent = artist.name;
    byId("artistRoomLink").href = `/artists/${encodeURIComponent(artist.slug)}`;
    byId("missionNote").textContent = profile.missionNote || "Ownership stays with the artist. Every recommendation remains explainable and approval-gated.";
    byId("careerStage").textContent = (careerLabels[profile.careerStage] || titleCase(profile.careerStage)).toUpperCase();
    byId("availableMoney").textContent = money(summary.availableMinor);
    byId("receivedGross").textContent = money(summary.receivedGrossMinor);
    byId("receivedDeductions").textContent = `${money(summary.feesMinor + summary.taxReserveMinor + summary.obligationsMinor)} recorded deductions`;
    byId("expectedMoney").textContent = money(summary.expectedMinor);
    byId("licensingPipeline").textContent = money(summary.licensingPipelineMinor);
    byId("liveProfit").textContent = money(summary.liveProfitMinor);
    byId("monthlyNet").textContent = money(summary.monthlyNetMinor);
    byId("monthlyTarget").textContent = money(summary.monthlyTargetMinor);
    byId("targetProgress").style.width = `${Math.round(summary.targetProgress * 100)}%`;
    byId("campaignCpa").textContent = money(summary.costPerMeaningfulActionMinor);
    byId("allocationBoard").innerHTML = [
      ["Artist pay", summary.artistPayMinor, profile.artistPayBps],
      ["Next music", summary.nextMusicMinor, profile.nextMusicBps],
      ["Audience", summary.audienceMinor, profile.audienceBps],
      ["Business reserve", summary.businessReserveMinor, profile.businessReserveBps],
      ["Experiments", summary.experimentMinor, profile.experimentBps]
    ].map(([label, value, bps]) => `<article class="allocation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(money(value))}</strong><small>${Number(bps) / 100}% of available</small></article>`).join("");
    byId("gapList").innerHTML = summary.gaps.length
      ? summary.gaps.map(gap => `<li>${escapeHtml(gap)}</li>`).join("")
      : "<li>The recorded foundations are complete. Review outcomes and protect the next move.</li>";
    byId("conscienceTab").hidden = !viewer.platformOwner;
    renderStats();
    renderRightsGuidance();
    renderRights();
    renderIncome();
    renderCampaigns();
    renderLicensing();
    renderLive();
    renderConscience();
  }

  function emptyCard(title, copy) {
    return `<article class="empty-records"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></article>`;
  }

  function renderGuidanceSection(title, items, fallbackTitle, fallbackCopy, withChecklist = false) {
    return `<article class="guidance-card">
      <header><span>${escapeHtml(title)}</span><strong>${items.length}</strong></header>
      <div class="guidance-body">
        ${items.length ? items.map(item => `<section>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.detail)}</p>
          ${withChecklist && item.checklist?.length ? `<ol>${item.checklist.map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}
        </section>`).join("") : `<section><h3>${escapeHtml(fallbackTitle)}</h3><p>${escapeHtml(fallbackCopy)}</p></section>`}
      </div>
    </article>`;
  }

  function renderRightsGuidance() {
    const target = byId("rightsGuidance");
    const guidance = state.dashboard?.rightsGuidance || {};
    target.innerHTML = `
      <article class="guidance-boundary">
        <span>HALO RIGHTS COPILOT</span>
        <p>${escapeHtml(guidance.approvalBoundary || "HALO can prepare the checklist, but the artist approves the external move.")}</p>
      </article>
      <div class="guidance-grid">
        ${renderGuidanceSection("Missing data", guidance.missingData || [], "Nothing critical is missing.", "Keep identifiers, collaborators, and society memberships current as the catalogue grows.")}
        ${renderGuidanceSection("Conflicts to resolve", guidance.conflicts || [], "No conflicts are currently flagged.", "The recorded ownership picture is internally consistent right now.")}
        ${renderGuidanceSection("Suggested next steps", guidance.nextSteps || [], "No urgent next step.", "Use the Rights Passport to keep the system current before the next release or opportunity.")}
        ${renderGuidanceSection("Draft packs + checklists", guidance.draftPackets || [], "No draft pack is waiting.", "When the system sees a rights gap, it prepares a checklist here rather than acting externally.", true)}
      </div>
    `;
  }

  function compactNumber(value) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(value || 0));
  }

  function buildStatsSnapshot() {
    const profile = state.dashboard?.profile || {};
    const summary = state.dashboard?.summary || {};
    const works = state.dashboard?.works || [];
    const incomes = state.dashboard?.incomes || [];
    const campaigns = state.dashboard?.campaigns || [];
    const licensing = state.dashboard?.licensing || [];
    const live = state.dashboard?.live || [];
    const rightsGuidance = state.dashboard?.rightsGuidance || {};

    const receivedStatuses = new Set(["received", "reconciled"]);
    const openLicensing = licensing.filter(item => !["paid", "declined"].includes(item.stage));
    const paidLicensing = licensing.filter(item => item.stage === "paid");
    const paidShows = live.filter(item => item.settlementStatus === "paid");

    const trafficSignals = campaigns.reduce((sum, item) => sum + Number(item.meaningfulActions || 0), 0);
    const engagedFans = live.reduce((sum, item) => sum + Number(item.fansCaptured || 0), 0);
    const conversionRate = trafficSignals > 0 ? Math.min(1, engagedFans / trafficSignals) : 0;

    const territories = new Map();
    for (const item of licensing) {
      const territory = (item.territory || "unspecified").trim().toUpperCase();
      territories.set(territory, (territories.get(territory) || 0) + 1);
    }
    const cities = new Map();
    for (const item of live) {
      const city = (item.city || item.venueName || "unlisted city").trim();
      if (!city) continue;
      cities.set(city, (cities.get(city) || 0) + 1);
    }

    const revenueBySource = new Map();
    for (const item of incomes) {
      const key = item.sourceType || "other";
      const current = revenueBySource.get(key) || {
        source: key,
        currency: item.currency || profile.currency || "GBP",
        grossMinor: 0,
        netMinor: 0,
        openCount: 0,
        settledCount: 0
      };
      current.grossMinor += Number(item.grossMinor || 0);
      if (receivedStatuses.has(item.status)) {
        current.netMinor += Math.max(0, Number(item.grossMinor || 0) - Number(item.feesMinor || 0) - Number(item.taxReserveMinor || 0) - Number(item.obligationsMinor || 0));
        current.settledCount += 1;
      } else {
        current.openCount += 1;
      }
      revenueBySource.set(key, current);
    }

    const receivedByWork = new Map();
    const expectedByWork = new Map();
    for (const item of incomes) {
      if (!item.workId) continue;
      if (receivedStatuses.has(item.status)) {
        receivedByWork.set(item.workId, (receivedByWork.get(item.workId) || 0) + Number(item.grossMinor || 0));
      } else if (item.status === "expected") {
        expectedByWork.set(item.workId, (expectedByWork.get(item.workId) || 0) + Number(item.grossMinor || 0));
      }
    }
    const licensingByWork = new Map();
    for (const item of openLicensing) {
      if (!item.workId) continue;
      const current = licensingByWork.get(item.workId) || 0;
      licensingByWork.set(item.workId, current + Number(item.quotedFeeMinor || 0));
    }

    const trackPerformance = works.map(work => {
      const openPipelineMinor = licensingByWork.get(work.id) || 0;
      const receivedMinor = receivedByWork.get(work.id) || 0;
      const expectedMinor = expectedByWork.get(work.id) || 0;
      let nextAction = "Drive first monetisation";
      if (work.rightsStatus !== "cleared") nextAction = "Clear rights status";
      else if (openPipelineMinor > 0) nextAction = "Advance active opportunities";
      else if (receivedMinor > 0) nextAction = "Scale strongest channels";
      else if (expectedMinor > 0) nextAction = "Convert expected to received";
      return { work, receivedMinor, openPipelineMinor, nextAction };
    }).sort((left, right) => (right.receivedMinor + right.openPipelineMinor) - (left.receivedMinor + left.openPipelineMinor)).slice(0, 8);

    const opportunities = openLicensing
      .map(item => ({ ...item, dueScore: item.decisionDueAt ? new Date(item.decisionDueAt).valueOf() : Number.POSITIVE_INFINITY }))
      .sort((left, right) => left.dueScore - right.dueScore || right.quotedFeeMinor - left.quotedFeeMinor)
      .slice(0, 5);

    const insights = [
      ...(rightsGuidance.conflicts || []).map(item => item.title),
      ...(rightsGuidance.missingData || []).map(item => item.title),
      ...(summary.gaps || [])
    ].filter(Boolean).slice(0, 5);

    const nextAction = insights[0]
      || (opportunities[0] ? `${opportunities[0].opportunityName}: move to artist approval with clear rights context.` : "No critical blockers detected. Keep the system current and review new signals weekly.");

    const repeatableChannels = Array.from(revenueBySource.values()).filter(item => item.settledCount >= 2).length;

    return {
      kpis: [
        { label: "Available now", value: money(summary.availableMinor), detail: "Artist spendable after fees, tax reserve, and obligations." },
        { label: "Pipeline value", value: money((summary.expectedMinor || 0) + (summary.licensingPipelineMinor || 0)), detail: "Expected income plus open licensing value." },
        { label: "Rights-ready tracks", value: `${summary.clearedWorks || 0}/${summary.totalWorks || 0}`, detail: "Works marked cleared in the rights passport." },
        { label: "Fan conversion", value: `${Math.round(conversionRate * 100)}%`, detail: `${compactNumber(engagedFans)} engaged from ${compactNumber(trafficSignals)} campaign actions.` },
        { label: "Open opportunities", value: String(openLicensing.length), detail: `${paidLicensing.length} paid and recorded so far.` },
        { label: "Live profit", value: money(summary.liveProfitMinor), detail: `${paidShows.length} settled show(s) marked paid.` }
      ],
      territories: Array.from(territories.entries()).sort((left, right) => right[1] - left[1]).slice(0, 5),
      cities: Array.from(cities.entries()).sort((left, right) => right[1] - left[1]).slice(0, 5),
      revenueRows: Array.from(revenueBySource.values()).sort((left, right) => right.grossMinor - left.grossMinor).slice(0, 8),
      funnel: [
        { label: "Campaign traffic signals", value: trafficSignals, detail: "Meaningful actions recorded across campaign tests." },
        { label: "Captured fans", value: engagedFans, detail: "Permissioned fan captures from live engagements." },
        { label: "Revenue events", value: incomes.filter(item => receivedStatuses.has(item.status)).length + paidLicensing.length + paidShows.length, detail: "Received or paid commercial records." },
        { label: "Repeatable channels", value: repeatableChannels, detail: "Income sources with at least two settled entries." }
      ],
      trackPerformance,
      opportunities,
      insights,
      nextAction
    };
  }

  function renderStats() {
    const target = byId("statsKpiGrid");
    if (!target) return;
    const snapshot = buildStatsSnapshot();
    target.innerHTML = snapshot.kpis.map(item => `
      <article class="stats-kpi-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </article>
    `).join("");

    const listMarkup = entries => entries.length
      ? entries.map(([name, count]) => `<li><span>${escapeHtml(name)}</span><strong>${escapeHtml(String(count))}</strong></li>`).join("")
      : '<li class="stats-empty">No data recorded yet.</li>';
    byId("statsTerritoryList").innerHTML = listMarkup(snapshot.territories);
    byId("statsCityList").innerHTML = listMarkup(snapshot.cities);

    byId("statsRevenueTableBody").innerHTML = snapshot.revenueRows.length
      ? snapshot.revenueRows.map(row => `
        <tr>
          <td>${escapeHtml(titleCase(row.source))}</td>
          <td>${escapeHtml(money(row.grossMinor, row.currency))}</td>
          <td>${escapeHtml(money(row.netMinor, row.currency))}</td>
          <td>${escapeHtml(`${row.settledCount} settled / ${row.openCount} open`)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="4" class="stats-empty">Add income records to build this matrix.</td></tr>';

    const funnelMax = Math.max(1, ...snapshot.funnel.map(item => item.value));
    byId("statsFunnelList").innerHTML = snapshot.funnel.map(item => `
      <li>
        <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div>
        <span>${escapeHtml(compactNumber(item.value))}</span>
        <i style="width:${Math.round((item.value / funnelMax) * 100)}%"></i>
      </li>
    `).join("");

    byId("statsTrackTableBody").innerHTML = snapshot.trackPerformance.length
      ? snapshot.trackPerformance.map(({ work, receivedMinor, openPipelineMinor, nextAction }) => `
        <tr>
          <td>${escapeHtml(work.title)}</td>
          <td>${escapeHtml(titleCase(work.rightsStatus))}</td>
          <td>${escapeHtml(money(receivedMinor))}</td>
          <td>${escapeHtml(money(openPipelineMinor))}</td>
          <td>${escapeHtml(nextAction)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="5" class="stats-empty">Add works to unlock track-level performance.</td></tr>';

    byId("statsOpportunityList").innerHTML = snapshot.opportunities.length
      ? snapshot.opportunities.map(item => `<li>
        <div><strong>${escapeHtml(item.opportunityName)}</strong><small>${escapeHtml(`${titleCase(item.stage)} · Rights ${titleCase(item.rightsCheck)} · ${item.territory}`)}</small></div>
        <span>${escapeHtml(money(item.quotedFeeMinor, item.currency))}</span>
      </li>`).join("")
      : '<li class="stats-empty">No active opportunities yet.</li>';

    byId("statsNextAction").textContent = snapshot.nextAction;
    byId("statsInsightList").innerHTML = snapshot.insights.length
      ? snapshot.insights.map(item => `<li>${escapeHtml(item)}</li>`).join("")
      : '<li class="stats-empty">No urgent blockers are currently recorded.</li>';
  }

  function renderRights() {
    const target = byId("rightsList");
    const works = state.dashboard.works || [];
    if (!works.length) {
      target.innerHTML = emptyCard("No Rights Passport yet.", "Add the first recording or composition before the next commercial move.");
      return;
    }
    target.innerHTML = works.map(work => {
      const masterShares = work.participants.filter(participant => participant.role === "master_owner").reduce((sum, participant) => sum + participant.shareBps, 0);
      const compositionShares = work.participants.filter(participant => participant.role === "songwriter").reduce((sum, participant) => sum + participant.shareBps, 0);
      const shareSummary = [
        masterShares ? `Master ${masterShares / 100}%` : "",
        compositionShares ? `Composition ${compositionShares / 100}%` : ""
      ].filter(Boolean).join(" · ") || "Shares not recorded";
      const publishingLabel = [titleCase(work.publisherStatus), work.adminPublishingStatus ? titleCase(work.adminPublishingStatus) : ""].filter(Boolean).join(" · ");
      return `<article class="record-card" data-record-id="${escapeHtml(work.id)}" data-tone="${escapeHtml(work.rightsStatus)}">
        <header><div><div class="record-meta"><span>${escapeHtml(work.workType)}</span><span>${escapeHtml(work.rightsStatus)}</span>${work.oneStop ? "<span>One-stop</span>" : ""}</div><h3>${escapeHtml(work.title)}</h3></div><span class="status-label">${escapeHtml(shareSummary)}</span></header>
        <p>${escapeHtml(work.notes || "No private rights note has been added.")}</p>
        <div class="record-details"><div><small>Master owner</small><strong>${escapeHtml(work.masterOwner || "Not confirmed")}</strong></div><div><small>Composition owner</small><strong>${escapeHtml(work.compositionOwner || "Not confirmed")}</strong></div><div><small>Publishing / admin</small><strong>${escapeHtml(publishingLabel || "Unknown")}</strong></div><div><small>Admin publisher</small><strong>${escapeHtml(work.adminPublisherName || "Not assigned")}</strong></div><div><small>ISRC / ISWC</small><strong>${escapeHtml([work.isrc || "Missing ISRC", work.iswc || "Missing ISWC"].join(" · "))}</strong></div><div><small>Restrictions</small><strong>${escapeHtml(work.restrictions.join(", ") || "None recorded")}</strong></div></div>
        <ul class="participant-list">${work.participants.length ? work.participants.map(participant => `<li>
          <div class="participant-row"><span><strong>${escapeHtml(participant.name)}</strong> · ${escapeHtml(titleCase(participant.role))}</span><span>${participant.shareBps / 100}% · ${escapeHtml(titleCase(participant.collectionStatus))}</span></div>
          <div class="participant-societies">${participant.societies.length ? participant.societies.map(society => `<span class="society-chip">${escapeHtml(`${society.territory} · ${titleCase(society.societyType)} · ${society.societyName} · ${titleCase(society.membershipStatus)}${society.membershipIdentifier ? ` · ${society.membershipIdentifier}` : ""}`)}</span>`).join("") : '<span class="society-chip is-empty">No territory memberships recorded yet</span>'}</div>
          <div class="participant-tools"><button class="button button-quiet" type="button" data-open-form="membership" data-participant-id="${participant.id}" data-participant-name="${escapeHtml(participant.name)}" data-work-title="${escapeHtml(work.title)}">Add territory membership</button></div>
        </li>`).join("") : "<li><div class=\"participant-row\"><span>No participants recorded</span><span>Shares unknown</span></div></li>"}</ul>
        <div class="record-actions">
          <label>Status<select data-field="rightsStatus">${options(statusOptions.work, work.rightsStatus)}</select></label>
          <label>One-stop<select data-field="oneStop"><option value="false"${!work.oneStop ? " selected" : ""}>No</option><option value="true"${work.oneStop ? " selected" : ""}>Yes</option></select></label>
          <button class="button button-quiet" type="button" data-update-record="work">Save status</button>
          <button class="button button-quiet" type="button" data-open-form="participant" data-work-id="${escapeHtml(work.id)}">Add participant</button>
        </div>
      </article>`;
    }).join("");
  }

  function renderIncome() {
    const target = byId("incomeList");
    const incomes = state.dashboard.incomes || [];
    if (!incomes.length) {
      target.innerHTML = emptyCard("No income recorded.", "Expected money and received money belong in different states. Record the first statement or opportunity.");
      return;
    }
    target.innerHTML = incomes.map(item => {
      const deductions = item.feesMinor + item.taxReserveMinor + item.obligationsMinor;
      const net = Math.max(0, item.grossMinor - deductions);
      return `<article class="record-card" data-record-id="${escapeHtml(item.id)}" data-tone="${escapeHtml(item.status)}">
        <header><div><div class="record-meta"><span>${escapeHtml(titleCase(item.sourceType))}</span><span>${escapeHtml(item.status)}</span><span>${escapeHtml(formatDate(item.occurredOn))}</span></div><h3>${escapeHtml(item.description)}</h3></div><strong class="record-value">${escapeHtml(money(item.grossMinor, item.currency))}</strong></header>
        <div class="record-details"><div><small>Available after entries</small><strong>${escapeHtml(money(net, item.currency))}</strong></div><div><small>Fees</small><strong>${escapeHtml(money(item.feesMinor, item.currency))}</strong></div><div><small>Tax reserve</small><strong>${escapeHtml(money(item.taxReserveMinor, item.currency))}</strong></div><div><small>Other people / obligations</small><strong>${escapeHtml(money(item.obligationsMinor, item.currency))}</strong></div></div>
        <div class="record-actions"><label>Status<select data-field="status">${options(statusOptions.income, item.status)}</select></label><button class="button button-quiet" type="button" data-update-record="income">Update ledger</button></div>
      </article>`;
    }).join("");
  }

  function renderCampaigns() {
    const target = byId("campaignList");
    const campaigns = state.dashboard.campaigns || [];
    if (!campaigns.length) {
      target.innerHTML = emptyCard("No campaign test recorded.", "Prepare the offer and tracking before buying attention.");
      return;
    }
    target.innerHTML = campaigns.map(item => {
      const cpa = item.meaningfulActions ? Math.round(item.spentMinor / item.meaningfulActions) : 0;
      const percent = item.budgetMinor ? Math.min(100, Math.round(item.spentMinor / item.budgetMinor * 100)) : 0;
      return `<article class="record-card" data-record-id="${escapeHtml(item.id)}" data-tone="${escapeHtml(item.decision)}">
        <header><div><div class="record-meta"><span>${escapeHtml(item.stage)}</span><span>${escapeHtml(titleCase(item.objective))}</span><span>${escapeHtml(item.decision)}</span></div><h3>${escapeHtml(item.title)}</h3></div><strong class="record-value">${escapeHtml(money(item.spentMinor, item.currency))}</strong></header>
        <p>${escapeHtml(item.learning || "No campaign lesson has been written yet.")}</p>
        <div class="target-track"><span style="width:${percent}%"></span></div>
        <div class="record-details"><div><small>Budget</small><strong>${escapeHtml(money(item.budgetMinor, item.currency))}</strong></div><div><small>Stop loss</small><strong>${escapeHtml(money(item.stopLossMinor, item.currency))}</strong></div><div><small>Meaningful actions</small><strong>${item.meaningfulActions}</strong></div><div><small>Cost / action</small><strong>${escapeHtml(money(cpa, item.currency))}</strong></div></div>
        <div class="record-actions">
          <label>Stage<select data-field="stage">${options(statusOptions.campaignStage, item.stage)}</select></label>
          <label>Decision<select data-field="decision">${options(statusOptions.campaignDecision, item.decision)}</select></label>
          <label>Spent<input data-field="spent" type="number" min="0" step="0.01" value="${fromMinor(item.spentMinor)}"></label>
          <label>Actions<input data-field="meaningfulActions" type="number" min="0" step="1" value="${item.meaningfulActions}"></label>
          <label class="field-wide">Learning<input data-field="learning" maxlength="4000" value="${escapeHtml(item.learning)}"></label>
          <button class="button button-quiet" type="button" data-update-record="campaign">Save evidence</button>
        </div>
      </article>`;
    }).join("");
  }

  function renderLicensing() {
    const target = byId("licensingList");
    const records = state.dashboard.licensing || [];
    if (!records.length) {
      target.innerHTML = emptyCard("No licensing pipeline yet.", "Add a real brief, buyer conversation, or catalogue target. Nothing is pitched automatically.");
      return;
    }
    target.innerHTML = records.map(item => `<article class="record-card" data-record-id="${escapeHtml(item.id)}" data-tone="${escapeHtml(item.rightsCheck)}">
      <header><div><div class="record-meta"><span>${escapeHtml(titleCase(item.mediaType))}</span><span>${escapeHtml(item.stage)}</span><span>Rights ${escapeHtml(item.rightsCheck)}</span></div><h3>${escapeHtml(item.opportunityName)}</h3></div><strong class="record-value">${escapeHtml(money(item.quotedFeeMinor, item.currency))}</strong></header>
      <p>${escapeHtml(item.notes || "No internal opportunity note has been added.")}</p>
      <div class="record-details"><div><small>Buyer</small><strong>${escapeHtml(item.buyerName || "Not recorded")}</strong></div><div><small>Territory</small><strong>${escapeHtml(item.territory)}</strong></div><div><small>Commission</small><strong>${item.commissionBps / 100}%</strong></div><div><small>Decision due</small><strong>${escapeHtml(formatDate(item.decisionDueAt))}</strong></div><div><small>Artist approval</small><strong>${escapeHtml(titleCase(item.approvalStatus || "required"))}${item.approvedAt ? ` · ${escapeHtml(formatDate(item.approvedAt, true))}` : ""}</strong></div></div>
      <div class="record-actions"><label>Stage<select data-field="stage">${options(statusOptions.licensingStage, item.stage)}</select></label><label>Rights check<select data-field="rightsCheck">${options(statusOptions.rightsCheck, item.rightsCheck)}</select></label><label>Approval<select data-field="approvalStatus">${options(statusOptions.licensingApproval, item.approvalStatus || "required")}</select></label><label class="field-wide">Approval note<textarea data-field="approvalNote" maxlength="2000">${escapeHtml(item.approvalNote || "")}</textarea></label><button class="button button-quiet" type="button" data-update-record="licensing">Update pipeline</button></div>
    </article>`).join("");
  }

  function renderLive() {
    const target = byId("liveList");
    const records = state.dashboard.live || [];
    if (!records.length) {
      target.innerHTML = emptyCard("No live work recorded.", "Add the next show, fee, real costs, and the fan relationship it creates.");
      return;
    }
    target.innerHTML = records.map(item => {
      const revenue = item.guaranteedFeeMinor + item.ticketShareMinor + item.merchandiseMinor;
      const profit = revenue - item.costsMinor;
      return `<article class="record-card" data-record-id="${escapeHtml(item.id)}" data-tone="${escapeHtml(item.settlementStatus)}">
        <header><div><div class="record-meta"><span>${escapeHtml(item.settlementStatus)}</span><span>${escapeHtml(formatDate(item.performanceAt, true))}</span>${item.setlistReported ? "<span>Set list reported</span>" : ""}</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml([item.venueName, item.city].filter(Boolean).join(" · ") || "Venue not recorded")}</p></div><strong class="record-value">${escapeHtml(money(profit, item.currency))}</strong></header>
        <div class="record-details"><div><small>Total live revenue</small><strong>${escapeHtml(money(revenue, item.currency))}</strong></div><div><small>Costs</small><strong>${escapeHtml(money(item.costsMinor, item.currency))}</strong></div><div><small>Tickets</small><strong>${item.ticketsSold}</strong></div><div><small>Fans captured</small><strong>${item.fansCaptured}</strong></div></div>
        <div class="record-actions"><label>Settlement<select data-field="settlementStatus">${options(statusOptions.settlement, item.settlementStatus)}</select></label><label>Set list reported<select data-field="setlistReported"><option value="false"${!item.setlistReported ? " selected" : ""}>No</option><option value="true"${item.setlistReported ? " selected" : ""}>Yes</option></select></label><button class="button button-quiet" type="button" data-update-record="live">Update show</button></div>
      </article>`;
    }).join("");
  }

  function renderConscience() {
    const target = byId("conscienceList");
    const records = state.dashboard.conscience || [];
    if (!state.dashboard.viewer.platformOwner) {
      target.innerHTML = "";
      return;
    }
    if (!records.length) {
      target.innerHTML = emptyCard("No conscience review recorded.", "Challenge the next fee, product, algorithm, partnership, or policy before it reaches artists.");
      return;
    }
    target.innerHTML = records.map(item => `<article class="record-card" data-record-id="${escapeHtml(item.id)}" data-tone="${escapeHtml(item.decision)}">
      <header><div><div class="record-meta"><span>${escapeHtml(titleCase(item.proposalType))}</span><span>${escapeHtml(item.decision)}</span>${item.artistSlug ? `<span>${escapeHtml(item.artistSlug)}</span>` : "<span>Platform-wide</span>"}</div><h3>${escapeHtml(item.title)}</h3></div><span class="status-label">${escapeHtml(titleCase(item.ownershipEffect))} ownership</span></header>
      <p><strong>Artist benefit:</strong> ${escapeHtml(item.artistBenefit)}</p><p><strong>Artist risk:</strong> ${escapeHtml(item.artistRisk || "No risk recorded")}</p>
      <div class="record-details"><div><small>Income effect</small><strong>${escapeHtml(titleCase(item.incomeEffect))}</strong></div><div><small>Reversibility</small><strong>${escapeHtml(titleCase(item.reversibility))}</strong></div><div><small>Conditions</small><strong>${escapeHtml(item.conditions || "None recorded")}</strong></div></div>
      <div class="record-actions"><label>Decision<select data-field="decision">${options(statusOptions.review, item.decision)}</select></label><label>Conditions<input data-field="conditions" maxlength="4000" value="${escapeHtml(item.conditions)}"></label><button class="button button-quiet" type="button" data-update-record="review">Save conscience decision</button></div>
    </article>`).join("");
  }

  function field(name, label, type = "text", optionsHtml = "", value = "", extra = "") {
    if (type === "hidden") return `<input name="${escapeHtml(name)}" type="hidden" value="${escapeHtml(value)}">`;
    const wide = type === "textarea" || extra.includes("wide") ? " field-wide" : "";
    if (type === "select") return `<label class="${wide}">${escapeHtml(label)}<select name="${escapeHtml(name)}" ${extra}>${optionsHtml}</select></label>`;
    if (type === "textarea") return `<label class="${wide}">${escapeHtml(label)}<textarea name="${escapeHtml(name)}" ${extra}>${escapeHtml(value)}</textarea></label>`;
    return `<label class="${wide}">${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${extra}></label>`;
  }

  function moneyField(name, label, value = "0.00") {
    return field(name, label, "number", "", value, 'min="0" step="0.01"');
  }

  function workSelect(name, label, selected = "") {
    const workOptions = [`<option value="">Not linked</option>`, ...(state.dashboard?.works || []).map(work => `<option value="${escapeHtml(work.id)}"${work.id === selected ? " selected" : ""}>${escapeHtml(work.title)} · ${escapeHtml(work.workType)}</option>`)];
    return field(name, label, "select", workOptions.join(""));
  }

  function formDefinition(kind, context = {}) {
    const profile = state.dashboard?.profile || {};
    const currency = profile.currency || "GBP";
    if (kind === "profile") return {
      title: "The living plan", kicker: "ARTIST TREASURY", action: "save_profile", submit: "Save the plan",
      fields: [
        field("careerStage", "Career stage", "select", options(Object.keys(careerLabels), profile.careerStage)),
        field("currency", "Working currency", "text", "", currency, 'maxlength="3" required'),
        moneyField("monthlyIncomeTarget", "Monthly artist net target", fromMinor(profile.monthlyIncomeTargetMinor)),
        field("paymentModel", "Direct payment model", "select", options(["undecided", "artist_seller", "halo_merchant"], profile.paymentModel)),
        field("paymentStatus", "Payment readiness", "select", options(["not_connected", "preparing", "restricted", "ready"], profile.paymentStatus)),
        field("artistPay", "Artist pay %", "number", "", profile.artistPayBps / 100, 'min="0" max="100" step="0.5"'),
        field("nextMusic", "Next music %", "number", "", profile.nextMusicBps / 100, 'min="0" max="100" step="0.5"'),
        field("audience", "Audience development %", "number", "", profile.audienceBps / 100, 'min="0" max="100" step="0.5"'),
        field("businessReserve", "Business reserve %", "number", "", profile.businessReserveBps / 100, 'min="0" max="100" step="0.5"'),
        field("experiment", "Experiments %", "number", "", profile.experimentBps / 100, 'min="0" max="100" step="0.5"'),
        field("missionNote", "Artist mission note", "textarea", "", profile.missionNote, 'maxlength="2000" class="field-wide"')
      ].join("")
    };
    if (kind === "work") return {
      title: "Add to the Rights Passport", kicker: "OWNERSHIP RECORD", action: "create_work", submit: "Create rights record",
      fields: [
        field("title", "Work title", "text", "", "", "required maxlength=180"),
        field("workType", "Record type", "select", options(["recording", "composition"], "recording")),
        field("rightsStatus", "Rights status", "select", options(statusOptions.work, "incomplete")),
        field("oneStop", "One-stop clearance", "select", options(["false", "true"], "false")),
        field("masterOwner", "Master owner", "text", "", "", "maxlength=180"),
        field("compositionOwner", "Composition owner", "text", "", "", "maxlength=180"),
        field("publisherStatus", "Publishing status", "select", options(["unknown", "self_published", "administered", "publisher_controlled"], "unknown")),
        field("adminPublisherName", "Admin publisher", "text", "", "", "maxlength=180"),
        field("adminPublishingStatus", "Admin publishing status", "select", options(statusOptions.adminPublishing, "unknown")),
        field("isrc", "ISRC", "text", "", "", "maxlength=15"),
        field("iswc", "ISWC", "text", "", "", "maxlength=20"),
        field("upc", "UPC", "text", "", "", "maxlength=20"),
        field("restrictions", "Restrictions, separated by commas", "text", "", "", "maxlength=1000 class=field-wide"),
        field("notes", "Private rights note", "textarea", "", "", "maxlength=4000 class=field-wide")
      ].join("")
    };
    if (kind === "participant") return {
      title: "Record a rights participant", kicker: "SPLITS + COLLECTION", action: "add_participant", submit: "Add participant",
      fields: [
        field("workId", "Work", "hidden", "", context.workId),
        field("name", "Name", "text", "", "", "required maxlength=180"),
        field("role", "Role", "select", options(["master_owner", "songwriter", "publisher", "producer", "featured_artist", "performer", "manager", "other"], "songwriter")),
        field("share", "Recorded share %", "number", "", "0", 'min="0" max="100" step="0.01"'),
        field("collectionStatus", "Collection status", "select", options(["unconfirmed", "registered", "collecting", "hold"], "unconfirmed")),
        field("societyName", "Society / administrator", "text", "", "", "maxlength=120"),
        field("identifier", "IPI / member / contract reference", "text", "", "", "maxlength=120")
      ].join("")
    };
    if (kind === "membership") return {
      title: "Record a territory membership", kicker: "PRO / CMO / ADMIN", action: "add_society_membership", submit: "Add membership",
      fields: [
        field("participantId", "Participant", "hidden", "", context.participantId),
        field("participantSummary", "Participant", "text", "", [context.participantName, context.workTitle].filter(Boolean).join(" · "), "readonly"),
        field("territory", "Territory", "text", "", "UK", "required maxlength=120"),
        field("societyType", "Society type", "select", options(statusOptions.societyType, "pro")),
        field("societyName", "Society or administrator", "text", "", "", "required maxlength=120"),
        field("membershipIdentifier", "Membership / IPI / CAE reference", "text", "", "", "maxlength=120"),
        field("membershipStatus", "Membership status", "select", options(statusOptions.membershipStatus, "research")),
        field("notes", "Internal note", "textarea", "", "", "maxlength=4000 class=field-wide")
      ].join("")
    };
    if (kind === "income") return {
      title: "Record income", kicker: "GROSS TO AVAILABLE", action: "create_income", submit: "Add to ledger",
      fields: [
        field("description", "Description", "text", "", "", "required maxlength=240"),
        field("sourceType", "Income source", "select", options(["distribution", "publishing", "neighbouring_rights", "direct_sale", "membership", "licensing", "live", "merchandise", "service", "grant", "other"], "distribution")),
        workSelect("workId", "Linked work"),
        field("status", "Status", "select", options(statusOptions.income, "expected")),
        field("currency", "Currency", "text", "", currency, 'maxlength="3" required'),
        field("occurredOn", "Statement / receipt date", "date", "", new Date().toISOString().slice(0, 10)),
        moneyField("gross", "Gross amount"), moneyField("fees", "Fees / processing"), moneyField("taxReserve", "Tax reserve"), moneyField("obligations", "Collaborators / obligations"),
        field("externalReference", "Statement reference", "text", "", "", "maxlength=180"),
        field("notes", "Private note", "textarea", "", "", "maxlength=4000 class=field-wide")
      ].join("")
    };
    if (kind === "campaign") return {
      title: "Open a campaign test", kicker: "EVIDENCE BEFORE SCALE", action: "create_campaign", submit: "Create campaign test",
      fields: [
        field("title", "Campaign title", "text", "", "", "required maxlength=180"),
        field("stage", "Stage", "select", options(statusOptions.campaignStage, "readiness")),
        field("objective", "Meaningful objective", "select", options(["completed_listen", "retained_fan", "direct_sale", "event_registration", "licensing_lead", "other"], "retained_fan")),
        field("decision", "Current decision", "select", options(statusOptions.campaignDecision, "prepare")),
        field("currency", "Currency", "text", "", currency, 'maxlength="3" required'),
        moneyField("budget", "Approved budget"), moneyField("spent", "Spent so far"), moneyField("stopLoss", "Stop-loss"),
        field("meaningfulActions", "Meaningful actions", "number", "", "0", 'min="0" step="1"'),
        field("learning", "What has this taught us?", "textarea", "", "", "maxlength=4000 class=field-wide")
      ].join("")
    };
    if (kind === "licensing") return {
      title: "Add a licensing opportunity", kicker: "CLEARANCE PIPELINE", action: "create_licensing", submit: "Add opportunity",
      fields: [
        field("opportunityName", "Opportunity / brief", "text", "", "", "required maxlength=200"),
        field("buyerName", "Buyer / supervisor", "text", "", "", "maxlength=180"),
        workSelect("workId", "Linked work"),
        field("mediaType", "Media", "select", options(["film", "television", "advertising", "game", "trailer", "creator", "documentary", "other"], "other")),
        field("territory", "Territory", "text", "", "worldwide", "maxlength=120"),
        field("currency", "Currency", "text", "", currency, 'maxlength="3" required'),
        moneyField("quotedFee", "Quoted fee"),
        field("commission", "HALO / representative commission %", "number", "", "0", 'min="0" max="50" step="0.25"'),
        field("stage", "Stage", "select", options(statusOptions.licensingStage, "brief")),
        field("rightsCheck", "Rights check", "select", options(statusOptions.rightsCheck, "required")),
        field("decisionDueAt", "Decision deadline", "datetime-local"),
        field("restrictions", "Use restrictions", "textarea", "", "", "maxlength=2000 class=field-wide"),
        field("notes", "Private opportunity note", "textarea", "", "", "maxlength=4000 class=field-wide")
      ].join("")
    };
    if (kind === "live") return {
      title: "Add a show", kicker: "REAL LIVE PROFIT", action: "create_live", submit: "Add live engagement",
      fields: [
        field("title", "Show / engagement title", "text", "", "", "required maxlength=180"),
        field("venueName", "Venue", "text", "", "", "maxlength=180"),
        field("city", "City", "text", "", "", "maxlength=120"),
        field("performanceAt", "Performance time", "datetime-local"),
        field("currency", "Currency", "text", "", currency, 'maxlength="3" required'),
        field("settlementStatus", "Settlement status", "select", options(statusOptions.settlement, "planning")),
        moneyField("guaranteedFee", "Guaranteed fee"), moneyField("ticketShare", "Ticket share"), moneyField("merchandise", "Merchandise income"), moneyField("costs", "Real costs"),
        field("ticketsSold", "Tickets sold", "number", "", "0", 'min="0" step="1"'),
        field("fansCaptured", "Permissioned fans captured", "number", "", "0", 'min="0" step="1"'),
        field("setlistReported", "Set list reported", "select", options(["false", "true"], "false")),
        field("notes", "Settlement / relationship note", "textarea", "", "", "maxlength=4000 class=field-wide")
      ].join("")
    };
    if (kind === "review") return {
      title: "Open a conscience review", kicker: "ARTIST LIVELIHOOD COVENANT", action: "create_review", submit: "Record review",
      fields: [
        field("title", "Proposal under review", "text", "", "", "required maxlength=200"),
        field("proposalType", "Proposal type", "select", options(["product", "fee", "algorithm", "partnership", "campaign", "licensing", "policy", "other"], "product")),
        field("globalReview", "Scope", "select", '<option value="false">This artist</option><option value="true">Platform-wide</option>'),
        field("decision", "Decision", "select", options(statusOptions.review, "review")),
        field("ownershipEffect", "Ownership effect", "select", options(["strengthens", "neutral", "weakens"], "neutral")),
        field("incomeEffect", "Income effect", "select", options(["improves", "neutral", "unknown", "harms"], "unknown")),
        field("reversibility", "Reversibility", "select", options(["reversible", "difficult", "irreversible"], "reversible")),
        field("artistBenefit", "Material artist benefit", "textarea", "", "", "required maxlength=4000 class=field-wide"),
        field("artistRisk", "Artist risk", "textarea", "", "", "maxlength=4000 class=field-wide"),
        field("conditions", "Conditions before approval", "textarea", "", "", "maxlength=4000 class=field-wide")
      ].join("")
    };
    return null;
  }

  function openForm(kind, context = {}) {
    const definition = formDefinition(kind, context);
    if (!definition) return;
    state.formKind = kind;
    byId("dialogKicker").textContent = definition.kicker;
    byId("dialogTitle").textContent = definition.title;
    byId("dialogFields").innerHTML = definition.fields;
    byId("dialogSubmit").textContent = definition.submit;
    byId("recordForm").dataset.action = definition.action;
    byId("dialogMessage").textContent = "";
    byId("recordDialog").showModal();
  }

  function closeDialog() {
    byId("recordDialog").close();
    state.formKind = "";
  }

  function formPayload(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const action = form.dataset.action;
    const payload = { action, slug: state.slug, ...values };
    if (action === "save_profile") {
      payload.monthlyIncomeTargetMinor = toMinor(values.monthlyIncomeTarget);
      payload.artistPayBps = Math.round(Number(values.artistPay || 0) * 100);
      payload.nextMusicBps = Math.round(Number(values.nextMusic || 0) * 100);
      payload.audienceBps = Math.round(Number(values.audience || 0) * 100);
      payload.businessReserveBps = Math.round(Number(values.businessReserve || 0) * 100);
      payload.experimentBps = Math.round(Number(values.experiment || 0) * 100);
      const total = payload.artistPayBps + payload.nextMusicBps + payload.audienceBps + payload.businessReserveBps + payload.experimentBps;
      if (total !== 10000) throw new Error("The five allocation percentages must total exactly 100%.");
    }
    if (action === "create_work") payload.restrictions = values.restrictions.split(",").map(value => value.trim()).filter(Boolean);
    if (action === "add_participant") payload.shareBps = Math.round(Number(values.share || 0) * 100);
    if (action === "create_income") {
      payload.grossMinor = toMinor(values.gross);
      payload.feesMinor = toMinor(values.fees);
      payload.taxReserveMinor = toMinor(values.taxReserve);
      payload.obligationsMinor = toMinor(values.obligations);
      if (payload.feesMinor + payload.taxReserveMinor + payload.obligationsMinor > payload.grossMinor) throw new Error("Recorded deductions cannot exceed the gross amount.");
    }
    if (action === "create_campaign") {
      payload.budgetMinor = toMinor(values.budget);
      payload.spentMinor = toMinor(values.spent);
      payload.stopLossMinor = toMinor(values.stopLoss);
      if (payload.spentMinor > payload.budgetMinor || payload.stopLossMinor > payload.budgetMinor) throw new Error("Spend and stop-loss must stay within the approved budget.");
    }
    if (action === "create_licensing") {
      payload.quotedFeeMinor = toMinor(values.quotedFee);
      payload.commissionBps = Math.round(Number(values.commission || 0) * 100);
    }
    if (action === "create_live") {
      payload.guaranteedFeeMinor = toMinor(values.guaranteedFee);
      payload.ticketShareMinor = toMinor(values.ticketShare);
      payload.merchandiseMinor = toMinor(values.merchandise);
      payload.costsMinor = toMinor(values.costs);
    }
    return payload;
  }

  async function submitForm(event) {
    event.preventDefault();
    byId("dialogMessage").textContent = "Saving to the artist-controlled record…";
    try {
      const payload = formPayload(event.currentTarget);
      const data = await api("POST", "/api/artist-economy", payload);
      state.dashboard = data.dashboard;
      closeDialog();
      renderDashboard();
    } catch (error) {
      byId("dialogMessage").textContent = error instanceof Error ? error.message : "That record could not be saved.";
    }
  }

  async function updateRecord(button) {
    const card = button.closest("[data-record-id]");
    if (!card) return;
    const recordType = button.dataset.updateRecord;
    const payload = { action: "update_item", slug: state.slug, recordType, id: card.dataset.recordId };
    card.querySelectorAll("[data-field]").forEach(input => {
      payload[input.dataset.field] = input.dataset.field === "spent" ? toMinor(input.value) : input.value;
    });
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const data = await api("POST", "/api/artist-economy", {
        ...payload,
        spentMinor: payload.spent,
        setlistReported: payload.setlistReported === "true",
        oneStop: payload.oneStop === "true"
      });
      state.dashboard = data.dashboard;
      renderDashboard();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Try again";
      alert(error instanceof Error ? error.message : "That update could not be saved.");
    }
  }

  function selectTab(name) {
    document.querySelectorAll("[data-tab]").forEach(button => button.classList.toggle("is-active", button.dataset.tab === name));
    document.querySelectorAll("[data-panel]").forEach(panel => {
      const active = panel.dataset.panel === name;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  async function start() {
    state.user = await state.identity?.getUser();
    byId("identityButton").textContent = state.user ? "Sign out" : "Sign in";
    if (!state.user) return showOnly("lockedView");
    await loadDashboard();
  }

  document.addEventListener("click", event => {
    const roomButton = event.target.closest("[data-room-slug]");
    if (roomButton) {
      state.slug = roomButton.dataset.roomSlug;
      loadDashboard();
      return;
    }
    const formButton = event.target.closest("[data-open-form]");
    if (formButton) {
      openForm(formButton.dataset.openForm, {
        workId: formButton.dataset.workId || "",
        participantId: formButton.dataset.participantId || "",
        participantName: formButton.dataset.participantName || "",
        workTitle: formButton.dataset.workTitle || ""
      });
      return;
    }
    const updateButton = event.target.closest("[data-update-record]");
    if (updateButton) {
      updateRecord(updateButton);
      return;
    }
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      selectTab(tabButton.dataset.tab);
      return;
    }
    if (event.target.closest("[data-close-dialog]")) closeDialog();
  });

  byId("artistAuthForm").addEventListener("submit", signIn);
  byId("recordForm").addEventListener("submit", submitForm);
  byId("editProfileButton").addEventListener("click", () => openForm("profile"));
  byId("identityButton").addEventListener("click", () => state.user ? signOut() : showOnly("lockedView"));
  byId("recordDialog").addEventListener("click", event => {
    if (event.target === byId("recordDialog")) closeDialog();
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
