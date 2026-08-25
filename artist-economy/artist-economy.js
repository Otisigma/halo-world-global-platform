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
    income: ["expected", "received", "overdue", "disputed", "reconciled"],
    campaignStage: ["readiness", "test", "scale", "closed"],
    campaignDecision: ["prepare", "test", "scale", "stop", "complete"],
    licensingStage: ["brief", "matched", "artist_approval", "pitched", "negotiating", "contracted", "delivered", "paid", "declined"],
    rightsCheck: ["required", "reviewing", "clear", "hold"],
    settlement: ["planning", "confirmed", "performed", "settling", "paid", "cancelled"],
    review: ["review", "approve", "revise", "reject"]
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

  function renderRights() {
    const target = byId("rightsList");
    const works = state.dashboard.works || [];
    if (!works.length) {
      target.innerHTML = emptyCard("No Rights Passport yet.", "Add the first recording or composition before the next commercial move.");
      return;
    }
    target.innerHTML = works.map(work => {
      const shares = work.participants.reduce((sum, participant) => sum + participant.shareBps, 0);
      return `<article class="record-card" data-record-id="${escapeHtml(work.id)}" data-tone="${escapeHtml(work.rightsStatus)}">
        <header><div><div class="record-meta"><span>${escapeHtml(work.workType)}</span><span>${escapeHtml(work.rightsStatus)}</span>${work.oneStop ? "<span>One-stop</span>" : ""}</div><h3>${escapeHtml(work.title)}</h3></div><span class="status-label">${shares / 100}% recorded</span></header>
        <p>${escapeHtml(work.notes || "No private rights note has been added.")}</p>
        <div class="record-details"><div><small>Master owner</small><strong>${escapeHtml(work.masterOwner || "Not confirmed")}</strong></div><div><small>Publishing</small><strong>${escapeHtml(titleCase(work.publisherStatus))}</strong></div><div><small>ISRC</small><strong>${escapeHtml(work.isrc || "Missing")}</strong></div><div><small>Restrictions</small><strong>${escapeHtml(work.restrictions.join(", ") || "None recorded")}</strong></div></div>
        <ul class="participant-list">${work.participants.length ? work.participants.map(participant => `<li><span><strong>${escapeHtml(participant.name)}</strong> · ${escapeHtml(titleCase(participant.role))}</span><span>${participant.shareBps / 100}% · ${escapeHtml(titleCase(participant.collectionStatus))}</span></li>`).join("") : "<li><span>No participants recorded</span><span>Shares unknown</span></li>"}</ul>
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
      <div class="record-details"><div><small>Buyer</small><strong>${escapeHtml(item.buyerName || "Not recorded")}</strong></div><div><small>Territory</small><strong>${escapeHtml(item.territory)}</strong></div><div><small>Commission</small><strong>${item.commissionBps / 100}%</strong></div><div><small>Decision due</small><strong>${escapeHtml(formatDate(item.decisionDueAt))}</strong></div></div>
      <div class="record-actions"><label>Stage<select data-field="stage">${options(statusOptions.licensingStage, item.stage)}</select></label><label>Rights check<select data-field="rightsCheck">${options(statusOptions.rightsCheck, item.rightsCheck)}</select></label><button class="button button-quiet" type="button" data-update-record="licensing">Update pipeline</button></div>
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
        field("publisherStatus", "Publishing status", "select", options(["unknown", "self_published", "administered", "publisher_controlled"], "unknown")),
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
      openForm(formButton.dataset.openForm, { workId: formButton.dataset.workId || "" });
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
