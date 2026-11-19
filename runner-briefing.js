(() => {
  const byId = id => document.getElementById(id);
  const panel = byId("runnerBriefing");
  if (!panel) return;
  let authorized = false;
  let generation = 0;
  let controller;
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const pct = value => value === null || value === undefined ? "Not enough data" : `${value}%`;
  const when = value => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) + " UK" : "Not recorded";
  const money = ({ currency, amountMinor }) => {
    try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amountMinor / 100); }
    catch { return `${(amountMinor / 100).toFixed(2)} ${currency}`; }
  };
  const UNAVAILABLE = "Unavailable (not zero)";

  function stats(rows) {
    const list = node("dl");
    for (const [label, value, flag] of rows) {
      const dd = node("dd", String(value));
      if (flag) dd.className = "runner-flag";
      list.append(node("dt", label), dd);
    }
    return list;
  }

  function items(title, source, format, empty) {
    const wrap = document.createDocumentFragment();
    wrap.append(node("h4", title));
    if (source?.status !== "available") { wrap.append(node("p", UNAVAILABLE)); return wrap; }
    if (!source.data.length) { wrap.append(node("p", empty)); return wrap; }
    const list = node("ul");
    for (const item of source.data) list.append(node("li", format(item)));
    wrap.append(list);
    return wrap;
  }

  const v = (source, pick) => source?.status === "available" ? pick(source.data) : UNAVAILABLE;
  const flagged = (source, pick) => source?.status === "available" && pick(source.data) > 0;

  function card(title, children) {
    const article = node("article", undefined, "briefing-panel");
    article.append(node("h3", title), ...children);
    return article;
  }

  function render({ briefing, history }) {
    const { signups, payments, catalog, growth } = briefing.pillars;
    const moves = briefing.leverageMoves.length ? briefing.leverageMoves.map((move, index) => {
      const article = node("article");
      article.append(node("p", `LEVERAGE MOVE ${index + 1}`, "section-label"), node("h3", move.title), node("p", move.why));
      return article;
    }) : [node("p", "No urgent leverage moves found in today's signals.")];
    byId("runnerBriefingMoves").replaceChildren(...moves);

    const totals = payments.purchases?.status === "available"
      ? (payments.purchases.data.weekTotals.map(money).join(" · ") || "None") : UNAVAILABLE;

    byId("runnerBriefingPillars").replaceChildren(
      card("1 · Sign-ups & Onboarding", [
        stats([
          ["New members (24h / 7d)", v(signups.members, d => `${d.day} / ${d.week}`)],
          ["Artist applications (24h / 7d)", v(signups.artists, d => `${d.day} / ${d.week}`)],
          ["Artist applications awaiting review", v(signups.artists, d => d.awaitingReview), flagged(signups.artists, d => d.awaitingReview)],
          ["Fan sign-ups (24h / 7d)", v(signups.fans, d => `${d.day} / ${d.week}`)],
          ["Paid-tier joins (7d)", v(signups.members, d => d.paidTierWeek)],
          ["Music Home set up (7d joiners)", v(signups.profileSetup, d => `${d.setUp} / ${d.joined} (${pct(d.setupRate)})`)],
          ["Dropped off before setup", v(signups.profileSetup, d => d.notSetUp), flagged(signups.profileSetup, d => d.notSetUp)]
        ]),
        items("Onboarding questions needing your call", signups.onboardingQuestions, q => `${q.title} (${q.status}, ${when(q.createdAt)})`, "None open.")
      ]),
      card("2 · Payment & Payout Queries", [
        stats([
          ["Live paid checkouts (24h / 7d)", v(payments.purchases, d => `${d.liveDay} / ${d.liveWeek}`)],
          ["Live revenue (7d)", totals],
          ["Test-mode checkouts (7d)", v(payments.purchases, d => d.testWeek)],
          ["Creator Passes past due", v(payments.creatorPasses, d => d.pastDue), flagged(payments.creatorPasses, d => d.pastDue)],
          ["Trials ending within 3 days", v(payments.creatorPasses, d => d.trialsEnding)],
          ["Active Creator Passes", v(payments.creatorPasses, d => d.active)]
        ]),
        items("Open payment / payout tickets", payments.paymentTickets, t => `${t.title} (${t.category}, ${t.status}, ${when(t.createdAt)})`, "None open."),
        items("Payment, webhook or checkout issues", payments.paymentIssues, i => `[${i.severity}] ${i.title} (×${i.occurrences}, last ${when(i.lastSeenAt)})`, "None open.")
      ]),
      card("3 · Catalog & Provenance Health", [
        stats([
          ["Master byte observations (24h / 7d)", v(catalog.provenance, d => `${d.day} / ${d.week}`)],
          ["Versions observed (7d)", v(catalog.provenance, d => d.versions)],
          ["Retained masters ready (SHA-256 verified)", v(catalog.retainedMasters, d => d.ready)],
          ["Snapshots failed / stalled", v(catalog.retainedMasters, d => `${d.failed} / ${d.stalled}`), flagged(catalog.retainedMasters, d => d.failed + d.stalled)],
          ["Playback start rate (7d)", v(catalog.playback, d => `${pct(d.startRate)} of ${d.attempts}`)],
          ["Playback errors (7d)", v(catalog.playback, d => d.failed), flagged(catalog.playback, d => d.failed)],
          ["Radio plays (24h)", v(catalog.radio, d => d.playsDay)],
          ["Living Chart votes (7d)", v(catalog.radio, d => d.chartVotesWeek)],
          ["Open radio / chart issues", v(catalog.radio, d => d.openIssues), flagged(catalog.radio, d => d.openIssues)],
          ["Open user bug reports", v(catalog.bugReports, d => d.open), flagged(catalog.bugReports, d => d.open)]
        ]),
        items("High-priority issues", catalog.priorityIssues, i => `[${i.severity}] ${i.title} (${i.pagePath}, ×${i.occurrences})`, "No high or critical issues open.")
      ]),
      card("4 · Growth & Competitor Edge", [
        stats([
          ["Opted-in listening sessions (7d)", v(growth.listening, d => d.sessions)],
          ["Distinct listeners (7d)", v(growth.listening, d => d.listeners)],
          ["Listen completion rate", v(growth.listening, d => pct(d.completionRate))],
          ["Requests resolved this week", v(growth.shipped, d => d.resolvedWeek)]
        ]),
        items("Chart leaders (fan signal)", growth.chartLeaders, r => `${r.title} by ${r.artist} (${r.votes} votes)`, "No chart votes this week."),
        items("Competitive gaps: most-wanted features", growth.featureRequests, f => `${f.title} (${f.votes} votes, ${f.status})`, "No open feature requests.")
      ])
    );

    const historyList = byId("runnerBriefingHistory");
    if (history === null) historyList.replaceChildren(node("li", "Saved briefings are unavailable right now."));
    else if (!history.length) historyList.replaceChildren(node("li", "The first saved briefing arrives at 08:00 UK time."));
    else historyList.replaceChildren(...history.map(item => node("li",
      `${item.briefingDate} (${item.triggerType}, ${when(item.generatedAt)}): ${item.leverageMoves.map(move => move.title).join("; ") || "no urgent moves"}`)));

    byId("runnerBriefingGaps").replaceChildren(...briefing.gaps.map(gap => node("li", gap)));
    const { available, total } = briefing.coverage;
    byId("runnerBriefingStatus").textContent = `${available === total ? "Full coverage" : `Partial coverage (${available}/${total} sources)`}. Live as of ${when(briefing.generatedAt)}.`;
  }

  function clear() {
    authorized = false;
    generation++;
    controller?.abort();
    panel.hidden = true;
    for (const id of ["runnerBriefingMoves", "runnerBriefingPillars", "runnerBriefingHistory", "runnerBriefingGaps"]) byId(id).replaceChildren();
    byId("runnerBriefingStatus").textContent = "Owner access required.";
    byId("runnerBriefingRefresh").disabled = false;
  }

  async function refresh() {
    if (!authorized) return;
    controller?.abort();
    const current = ++generation;
    const active = new AbortController();
    controller = active;
    const timeout = setTimeout(() => active.abort(), 25_000);
    byId("runnerBriefingRefresh").disabled = true;
    byId("runnerBriefingStatus").textContent = "Reading today's runner signals...";
    try {
      const response = await fetch("/api/halo-control-center?view=briefing", { credentials: "same-origin", cache: "no-store", signal: active.signal });
      if (current !== generation) return;
      if (response.status === 401 || response.status === 403) return clear();
      if (!response.ok) throw new Error("Briefing unavailable");
      const data = await response.json();
      if (authorized && current === generation) render(data);
    } catch {
      if (authorized && current === generation) byId("runnerBriefingStatus").textContent = "The runners briefing is unavailable. Refresh to retry.";
    } finally {
      clearTimeout(timeout);
      if (current === generation) byId("runnerBriefingRefresh").disabled = false;
    }
  }

  function reveal() {
    if (!authorized || window.location.hash !== "#runnerBriefing") return;
    panel.scrollIntoView({ block: "start" });
    byId("runnerBriefingTitle").focus({ preventScroll: true });
  }

  byId("runnerBriefingRefresh").addEventListener("click", refresh);
  window.addEventListener("halo-owner-operations", event => {
    if (!event.detail.authorized) return clear();
    authorized = true;
    panel.hidden = false;
    reveal();
    refresh();
  });
  window.addEventListener("hashchange", reveal);
  byId("identityButton")?.addEventListener("click", clear);
  const watchIdentity = () => window.haloIdentity?.onAuthChange?.(clear);
  window.addEventListener("halo-identity-ready", watchIdentity, { once: true });
  if (window.haloIdentity) watchIdentity();
})();
