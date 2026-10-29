(() => {
  const byId = id => document.getElementById(id);
  const panel = byId("ownerSignups");
  if (!panel) return;
  let authorized = false;
  let generation = 0;
  let controller;
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const purposes = {
    dreamweaver: ["Dreamweaver release-unlock / contact signups", "Captured unlock/contact consent, not a general newsletter subscription or proof of current marketing permission. CRM timestamps show first and latest signup; consent time is the earliest captured consent. No withdrawal history is stored for this source."],
    trackDrops: ["Track Drops email opt-ins", "Current preferences only: email enabled and consent recorded. Revoked or missing consent is excluded. This is not a history of withdrawals or a general newsletter list."],
    artistPro: ["Artist Pro applications", "Contact permission for the application only, not generic newsletter consent. Application status is not a subscription state. No withdrawal history is stored for this source."]
  };
  const dateLabels = {
    firstSignupAt: "First signup", lastSignupAt: "Latest signup",
    consentAt: "Consent captured", createdAt: "Application created", updatedAt: "Last updated"
  };
  const date = value => value ? new Date(value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : "Not recorded";

  function clear() {
    authorized = false;
    generation++;
    controller?.abort();
    panel.hidden = true;
    byId("signupSources").replaceChildren();
    byId("signupStatus").textContent = "Owner access required.";
    byId("signupRefresh").disabled = false;
  }

  function render(signups) {
    byId("signupSources").replaceChildren(...Object.entries(purposes).map(([key, [title, meaning]]) => {
      const section = node("article");
      section.className = "briefing-panel";
      section.append(node("h3", title), node("p", meaning));
      const source = signups.sources[key];
      if (source?.status !== "available") {
        section.append(node("p", "Unavailable — this source could not be read."));
        return section;
      }
      section.append(node("p", `${source.rows.length} shown · maximum ${signups.limitPerSource}, not a total count.`));
      const list = node("ul");
      list.tabIndex = 0;
      list.setAttribute("aria-label", title);
      for (const row of source.rows) {
        const item = node("li");
        item.append(node("strong", row.email), node("p", `Source: ${row.source} · State: ${row.status}`));
        for (const [field, label] of Object.entries(dateLabels)) {
          if (field in row) item.append(node("p", `${label}: ${date(row[field])}`));
        }
        list.append(item);
      }
      if (!source.rows.length) list.append(node("li", "No records for this source."));
      section.append(list);
      return section;
    }));
    byId("signupStatus").textContent = `Read-only snapshot · ${date(signups.refreshedAt)}. Refresh to check current preferences.`;
  }

  async function refresh() {
    if (!authorized) return;
    controller?.abort();
    const current = ++generation;
    const activeController = new AbortController();
    controller = activeController;
    const timeout = setTimeout(() => activeController.abort(), 25_000);
    byId("signupSources").replaceChildren();
    byId("signupRefresh").disabled = true;
    byId("signupStatus").textContent = "Reading private signup sources…";
    try {
      const response = await fetch("/api/halo-control-center?view=signups", {
        credentials: "same-origin", cache: "no-store", signal: activeController.signal
      });
      if (current !== generation) return;
      if (response.status === 401 || response.status === 403) return clear();
      if (!response.ok) throw new Error("Signup review unavailable.");
      const data = await response.json();
      if (authorized && current === generation) render(data.signups);
    } catch {
      if (authorized && current === generation) byId("signupStatus").textContent = "Signup review unavailable. No cached records are shown.";
    } finally {
      clearTimeout(timeout);
      if (current === generation) byId("signupRefresh").disabled = false;
    }
  }

  byId("signupRefresh").addEventListener("click", refresh);
  window.addEventListener("halo-owner-operations", event => {
    if (!event.detail.authorized) return clear();
    authorized = true;
    panel.hidden = false;
    refresh();
  });
  byId("identityButton").addEventListener("click", clear);
  const watchIdentity = () => window.haloIdentity?.onAuthChange?.(clear);
  window.addEventListener("halo-identity-ready", watchIdentity, { once: true });
  if (window.haloIdentity) watchIdentity();
})();
