(() => {
  const byId = id => document.getElementById(id);
  const panel = byId("shopBlueprint");
  if (!panel) return;
  let authorized = false;
  let generation = 0;
  let controller;
  const STAGES = { live: "Live", partial: "Partly live", foundation: "Foundation in place", not_started: "Not started", unknown: "Status unavailable" };
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const list = (tag, entries, make) => {
    const element = node(tag);
    for (const entry of entries) element.append(make(entry));
    return element;
  };
  const when = value => new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) + " UK";

  function workstream(item, index) {
    const article = node("article", undefined, "briefing-panel");
    article.id = `blueprint-${item.id}`;
    const badge = node("p", STAGES[item.stage] || item.stage, "blueprint-stage");
    badge.dataset.stage = item.stage;
    const stats = node("dl");
    for (const { label, value, flag } of item.signals) {
      const dd = node("dd", value === null || value === undefined ? "Unavailable (not zero)" : String(value));
      if (flag) dd.className = "runner-flag";
      stats.append(node("dt", label), dd);
    }
    const surfaces = list("ul", item.surfaces, surface => {
      const li = node("li");
      const link = node("a", surface.label);
      link.href = surface.href;
      li.append(link);
      return li;
    });
    surfaces.className = "blueprint-surfaces";
    article.append(
      node("p", `${index + 1} · ${item.pillar}`, "section-label"),
      node("h3", item.title),
      badge,
      stats,
      node("h4", "Builds on"), surfaces,
      node("h4", "Build tasks"), list("ol", item.tasks, task => node("li", task)),
      node("h4", "Runner check-in"), list("ul", item.checkIns, check => node("li", check))
    );
    return article;
  }

  function render({ blueprint }) {
    const next = blueprint.nextUp.length ? blueprint.nextUp.map((item, index) => {
      const article = node("article");
      const link = node("a", item.title);
      link.href = `#blueprint-${item.id}`;
      const heading = node("h3");
      heading.append(link);
      article.append(node("p", `BUILD NEXT ${index + 1}`, "section-label"), heading, node("p", item.firstTask));
      return article;
    }) : [node("p", "Every readable workstream is live.")];
    byId("shopBlueprintNext").replaceChildren(...next);
    byId("shopBlueprintItems").replaceChildren(...blueprint.workstreams.map(workstream));
    const summary = Object.entries(STAGES)
      .filter(([key]) => blueprint.stages[key])
      .map(([key, label]) => `${blueprint.stages[key]} ${label.toLowerCase()}`).join(" · ");
    const { available, total } = blueprint.coverage;
    byId("shopBlueprintStatus").textContent = `${summary}. ${available === total ? "Full coverage" : `Partial coverage (${available}/${total} sources)`}, live as of ${when(blueprint.generatedAt)}.`;
  }

  function clear() {
    authorized = false;
    generation++;
    controller?.abort();
    panel.hidden = true;
    byId("shopBlueprintNext").replaceChildren();
    byId("shopBlueprintItems").replaceChildren();
    byId("shopBlueprintStatus").textContent = "Owner access required.";
    byId("shopBlueprintRefresh").disabled = false;
  }

  async function refresh() {
    if (!authorized) return;
    controller?.abort();
    const current = ++generation;
    const active = new AbortController();
    controller = active;
    const timeout = setTimeout(() => active.abort(), 25_000);
    byId("shopBlueprintRefresh").disabled = true;
    byId("shopBlueprintStatus").textContent = "Reading shop, video and AI readiness...";
    try {
      const response = await fetch("/api/halo-control-center?view=shop-blueprint", { credentials: "same-origin", cache: "no-store", signal: active.signal });
      if (current !== generation) return;
      if (response.status === 401 || response.status === 403) return clear();
      if (!response.ok) throw new Error("Blueprint unavailable");
      const data = await response.json();
      if (authorized && current === generation) render(data);
    } catch {
      if (authorized && current === generation) byId("shopBlueprintStatus").textContent = "The shop blueprint is unavailable. Refresh to retry.";
    } finally {
      clearTimeout(timeout);
      if (current === generation) byId("shopBlueprintRefresh").disabled = false;
    }
  }

  function reveal() {
    if (!authorized || window.location.hash !== "#shopBlueprint") return;
    panel.scrollIntoView({ block: "start" });
    byId("shopBlueprintTitle").focus({ preventScroll: true });
  }

  byId("shopBlueprintRefresh").addEventListener("click", refresh);
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
