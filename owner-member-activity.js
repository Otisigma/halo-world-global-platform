(() => {
  const byId = id => document.getElementById(id);
  const panel = byId("ownerMembers");
  if (!panel) return;
  let authorized = false;
  let epoch = 0;
  let directoryRequest = 0;
  let detailRequest = 0;
  let directoryController;
  let detailController;
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const date = value => value ? new Date(value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : "Not recorded";
  const unavailable = "Unavailable — this source could not be read. This is not the same as no activity.";
  const emptyDetail = () => [node("p", "Choose a member to read their recorded activity and requests.")];

  function clear() {
    authorized = false;
    epoch++;
    directoryController?.abort();
    detailController?.abort();
    panel.hidden = true;
    byId("memberDirectory").replaceChildren();
    byId("memberDetail").replaceChildren(...emptyDetail());
    byId("memberPages").replaceChildren();
    byId("memberStatus").textContent = "Owner access required.";
    byId("memberRefresh").disabled = false;
  }

  async function request(url, previous, onAbortable) {
    previous?.abort();
    const controller = new AbortController();
    onAbortable(controller);
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) return { denied: true };
      if (!response.ok) return { failed: true, status: response.status };
      return { data: await response.json() };
    } finally {
      clearTimeout(timeout);
    }
  }

  function renderPages(pages) {
    const target = byId("memberPages");
    const items = [node("p", `Anonymous browser sessions, last ${pages?.windowDays || 7} days. Not linked to any member and not a person-level history.`)];
    if (pages?.status !== "available") {
      items.push(node("p", unavailable));
      return target.replaceChildren(...items);
    }
    const list = node("ol");
    list.setAttribute("aria-label", "Most viewed pages, anonymous aggregate");
    for (const row of pages.rows) list.append(node("li", `${row.pagePath} · ${row.views} views · ${row.sessions} sessions`));
    if (!pages.rows.length) list.append(node("li", "No anonymous page views recorded in this window."));
    items.push(list, node("p", `Top ${pages.limit} pages only.`));
    target.replaceChildren(...items);
  }

  function renderDirectory(directory) {
    const list = byId("memberDirectory");
    if (directory.members?.status !== "available") {
      list.replaceChildren(node("li", unavailable));
    } else if (!directory.members.rows.length) {
      list.replaceChildren(node("li", "No members recorded."));
    } else {
      list.replaceChildren(...directory.members.rows.map(member => {
        const item = node("li");
        const button = node("button", `${member.name} · ${member.email || "No email recorded"}`);
        button.type = "button";
        button.setAttribute("data-member-id", member.id);
        button.addEventListener("click", () => {
          for (const other of list.children) other.children?.[0]?.setAttribute?.("aria-current", "false");
          button.setAttribute("aria-current", "true");
          loadDetail(member.id);
        });
        const requests = member.requests
          ? `${member.requests.total} requests (${member.requests.open} open)`
          : "Requests unavailable";
        item.append(button, node("p", `Tier: ${member.tier} · Joined ${date(member.joinedAt)} · Last seen ${date(member.lastSeenAt)} · ${requests}`));
        return item;
      }));
    }
    renderPages(directory.anonymousPages);
    byId("memberStatus").textContent = `Read-only snapshot · ${date(directory.refreshedAt)} · up to ${directory.limit} most recently seen members, not a total count.`;
  }

  function section(title, note) {
    const wrapper = node("section");
    wrapper.append(node("h4", title));
    if (note) wrapper.append(node("p", note));
    return wrapper;
  }

  function timelineFrom(sources) {
    const entries = [];
    const add = (label, at, text) => entries.push({ label, at, text });
    for (const event of sources.accountEvents?.rows || []) add("Account (Relations sign-in events)", event.occurredAt, `Account ${event.type}`);
    for (const request of sources.requests?.rows || []) add("Feedback Desk", request.createdAt, `Submitted ${request.category} request: ${request.title}`);
    for (const reward of sources.rewards?.rows || []) add("Member rewards", reward.createdAt, `${reward.reason} (+${reward.points})`);
    for (const submission of sources.releaseHouse?.rows || []) add("Release House", submission.createdAt, `Submitted “${submission.trackTitle}” by ${submission.artistName} for ${submission.pathway} · now ${submission.status}`);
    for (const session of sources.listening?.rows || []) add("Opted-in listening reports", session.startedAt, `Listened to “${session.releaseTitle}” · ${session.outcome}`);
    for (const signup of sources.dreamweaver?.rows || []) add("Dreamweaver unlock signup", signup.lastSignupAt, `Unlock/contact signup via ${signup.source} · ${signup.status}`);
    return entries.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  }

  function renderDetail(activity) {
    const { member, sources } = activity;
    const target = byId("memberDetail");
    const heading = node("h3", member.name);
    const parts = [heading, node("p", `${member.email || "No email recorded"} · Tier: ${member.tier} · Joined ${date(member.joinedAt)}`),
      node("p", `Last seen: ${date(member.lastSeenAt)} (last signed-in HALO request; not a page visit).`)];

    const where = section("Where they have been", activity.pageHistory.reason);
    const requestPages = (sources.requests?.rows || []).filter(request => request.pagePath);
    if (requestPages.length) {
      const list = node("ul");
      list.setAttribute("aria-label", "Pages reported by the browser when requests were submitted");
      for (const request of requestPages) list.append(node("li", `${request.pagePath} · when submitting “${request.title}” · ${date(request.createdAt)}`));
      where.append(node("p", "Only attributable locations: the page the browser reported when this member submitted a request."), list);
    }
    parts.push(where);

    const requests = section("Help, bug & feature requests", "This member's own submissions only. Staff notes are not shown; details are shortened.");
    if (sources.requests?.status !== "available") requests.append(node("p", unavailable));
    else if (!sources.requests.rows.length) requests.append(node("p", "No requests submitted."));
    else {
      const list = node("ul");
      list.setAttribute("aria-label", `${member.name} requests`);
      for (const request of sources.requests.rows) {
        const item = node("li");
        item.append(node("strong", `${request.category} · ${request.title}`),
          node("p", `Status: ${request.status} · ${request.visibility} · ${request.voteCount} votes`),
          node("p", `Submitted ${date(request.createdAt)} · Updated ${date(request.updatedAt)}`),
          node("p", request.excerpt));
        list.append(item);
      }
      requests.append(list);
    }
    parts.push(requests);

    const timeline = section("What they have done", `Newest first, merged from the sources below. Each source shows at most ${activity.limitPerSource} recent records, so older items may be missing.`);
    const entries = timelineFrom(sources);
    const list = node("ol");
    list.setAttribute("aria-label", `${member.name} recorded activity`);
    for (const entry of entries) list.append(node("li", `${date(entry.at)} · ${entry.label} · ${entry.text}`));
    if (!entries.length) list.append(node("li", "No recorded activity in the readable sources."));
    timeline.append(list);
    const labels = { accountEvents: "Account sign-in events", requests: "Feedback Desk", rewards: "Member rewards", releaseHouse: "Release House submissions", listening: "Opted-in listening reports", dreamweaver: "Dreamweaver unlock signups", trackDrops: "Track Drops preferences" };
    const missing = Object.entries(labels).filter(([key]) => sources[key]?.status !== "available").map(([, label]) => label);
    if (missing.length) timeline.append(node("p", `Unavailable sources (not zero): ${missing.join(", ")}.`));
    parts.push(timeline);

    const preferences = section("Current consent & signup categories");
    const trackDrops = sources.trackDrops;
    if (trackDrops?.status !== "available") preferences.append(node("p", `Track Drops: ${unavailable}`));
    else {
      const current = trackDrops.rows[0];
      preferences.append(node("p", current
        ? `Track Drops email: ${current.emailOptIn ? `opted in (consent ${date(current.consentAt)})` : "not opted in"} · In-app: ${current.inApp ? "on" : "off"} · Current, revocable preference.`
        : "Track Drops: no preference saved (not opted in)."));
    }
    preferences.append(node("p", "Dreamweaver unlock/contact signups are not newsletter consent."), node("p", activity.artistPro.reason));
    parts.push(preferences);

    target.replaceChildren(...parts);
    target.focus?.();
  }

  async function loadDetail(memberId) {
    if (!authorized) return;
    const current = ++detailRequest;
    const currentEpoch = epoch;
    byId("memberDetail").replaceChildren(node("p", "Reading this member's recorded activity…"));
    try {
      const result = await request(`/api/halo-control-center?view=member&member=${encodeURIComponent(memberId)}`, detailController, c => { detailController = c; });
      if (!authorized || currentEpoch !== epoch || current !== detailRequest) return;
      if (result.denied) return clear();
      if (result.failed) throw new Error(result.status === 404 ? "Member not found." : "Member activity unavailable.");
      renderDetail(result.data.activity);
    } catch (error) {
      if (authorized && currentEpoch === epoch && current === detailRequest) {
        byId("memberDetail").replaceChildren(node("p", error?.message === "Member not found." ? "Member not found." : "Member activity unavailable. No cached records are shown."));
      }
    }
  }

  async function refresh() {
    if (!authorized) return;
    const current = ++directoryRequest;
    const currentEpoch = epoch;
    detailRequest++;
    detailController?.abort();
    byId("memberDirectory").replaceChildren();
    byId("memberDetail").replaceChildren(...emptyDetail());
    byId("memberPages").replaceChildren();
    byId("memberRefresh").disabled = true;
    byId("memberStatus").textContent = "Reading private member activity…";
    try {
      const result = await request("/api/halo-control-center?view=members", directoryController, c => { directoryController = c; });
      if (!authorized || currentEpoch !== epoch || current !== directoryRequest) return;
      if (result.denied) return clear();
      if (result.failed) throw new Error("Member activity unavailable.");
      renderDirectory(result.data.directory);
    } catch {
      if (authorized && currentEpoch === epoch && current === directoryRequest) byId("memberStatus").textContent = "Member activity unavailable. No cached records are shown.";
    } finally {
      if (currentEpoch === epoch && current === directoryRequest) byId("memberRefresh").disabled = false;
    }
  }

  byId("memberRefresh").addEventListener("click", refresh);
  window.addEventListener("halo-owner-operations", event => {
    if (!event.detail.authorized) return clear();
    // Repeated confirmations keep the owner's current member selection; Refresh reloads on demand.
    if (authorized) return;
    authorized = true;
    panel.hidden = false;
    refresh();
  });
  byId("identityButton").addEventListener("click", clear);
  const watchIdentity = () => window.haloIdentity?.onAuthChange?.(clear);
  window.addEventListener("halo-identity-ready", watchIdentity, { once: true });
  if (window.haloIdentity) watchIdentity();
})();
