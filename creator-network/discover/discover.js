import { DIMENSIONS, dnaRequest, element, renderDNASummary, mountDNAVisitor } from "/creator-network/creative-dna.js";

const FILTER_FIELDS = ["q", "role", "genre", "language", "bpm"];
export function readFilters(search) {
  const params = new URLSearchParams(search);
  const filters = Object.fromEntries(FILTER_FIELDS.map(name => [name, (params.get(name) || "").slice(0, name === "q" ? 160 : 80)]));
  if (!/^(?:[2-9]\d|1\d\d|2\d\d|300)$/.test(filters.bpm)) filters.bpm = "";
  filters.termIds = [...new Set(params.getAll("term"))].filter(id => /^[a-z_]+:[a-z0-9_-]+$/.test(id)).slice(0, 12);
  return filters;
}
export function filterQuery(filters) {
  const params = new URLSearchParams();
  for (const name of FILTER_FIELDS) if (filters[name]?.trim()) params.set(name, filters[name].trim());
  for (const id of [...new Set(filters.termIds || [])].slice(0, 12)) params.append("term", id);
  return params;
}

// Request and authentication generations also protect against servers ignoring abort.
export function createDiscoveryController({ request = dnaRequest, render, clear = () => {} }) {
  let generation = 0, controller, filters = readFilters(""), nextCursor = null, creators = [], terms = [];
  const seen = new Set();
  async function search(nextFilters = filters, append = false) {
    if (append && !nextCursor) return;
    const cursor = append ? nextCursor : null;
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    filters = nextFilters;
    if (!append) { creators = []; seen.clear(); nextCursor = null; clear(); }
    render({ loading: true, creators, terms, nextCursor: null });
    const params = filterQuery(filters);
    params.set("view", "dna_search");
    params.set("limit", "24");
    if (cursor) params.set("cursor", cursor);
    try {
      const data = await request(`?${params}`, undefined, controller.signal);
      if (version !== generation) return;
      terms = data.terms || terms;
      for (const creator of data.creators || []) {
        if (!creator.publicProfileId || seen.has(creator.publicProfileId)) continue;
        seen.add(creator.publicProfileId);
        creators.push(creator);
      }
      nextCursor = data.nextCursor || null;
      render({ ...data, creators: [...creators], terms, nextCursor, loading: false });
    } catch (error) {
      if (version !== generation) return;
      render({ creators: [...creators], terms, nextCursor: cursor, loading: false, error: error.message });
      nextCursor = cursor;
    }
  }
  return {
    search, more: () => search(filters, true),
    invalidate() {
      generation++;
      controller?.abort();
      creators = [];
      terms = [];
      nextCursor = null;
      seen.clear();
      clear();
    }
  };
}

export function mountDiscovery() {
  const byId = id => document.getElementById(id), form = byId("dnaSearch");
  if (!form) return;
  let filters = readFilters(window.location.search), vocabulary = [], timer, identity, authenticated = false, authGeneration = 0;
  let shownProfile = null, restoring = false;
  const visitor = mountDNAVisitor({
    signedIn: () => authenticated,
    onClose() {
      if (restoring) return;
      shownProfile = null;
      const url = new URL(window.location.href);
      if (url.searchParams.has("profile")) {
        url.searchParams.delete("profile");
        window.history.replaceState(null, "", url);
      }
    }
  });
  function clear() {
    byId("dnaResults").replaceChildren();
    byId("curatedCreators").replaceChildren();
    byId("curatedFallback").hidden = true;
    byId("resultCount").textContent = "";
    byId("dnaMore").hidden = true;
    byId("discoveryStatus").textContent = "";
  }
  function facets() {
    const root = byId("dnaFacets");
    root.replaceChildren();
    for (const [dimension, title] of Object.entries(DIMENSIONS)) {
      const group = element("fieldset"), legend = element("legend", title), chips = element("div");
      chips.className = "dna-chips";
      const label = element("label", `Add ${title.toLowerCase()}`), select = element("select");
      const placeholder = element("option", "Any");
      placeholder.value = "";
      select.append(placeholder);
      for (const term of vocabulary.filter(term => term.dimension === dimension && !filters.termIds.includes(term.id))) {
        const option = element("option", term.label);
        option.value = term.id;
        select.append(option);
      }
      select.addEventListener("change", () => {
        if (!select.value) return;
        if (filters.termIds.length >= 12) {
          byId("facetStatus").textContent = "Remove a tag before adding another (12 total).";
          select.value = "";
          return;
        }
        filters.termIds.push(select.value);
        changed();
        facets();
        byId("dnaFacets").querySelector(`[data-dimension="${dimension}"]`)?.focus();
      });
      select.dataset.dimension = dimension;
      for (const termId of filters.termIds.filter(id => id.startsWith(`${dimension}:`))) {
        const term = vocabulary.find(item => item.id === termId);
        const chip = element("button", `${term?.label || termId} ×`);
        chip.type = "button";
        chip.setAttribute("aria-label", `Remove ${term?.label || termId} filter`);
        chip.addEventListener("click", () => {
          filters.termIds = filters.termIds.filter(id => id !== termId);
          changed();
          facets();
          byId("dnaFacets").querySelector(`[data-dimension="${dimension}"]`)?.focus();
        });
        chips.append(chip);
      }
      label.append(select);
      group.append(legend, chips, label);
      root.append(group);
    }
  }
  function openProfile(id) {
    shownProfile = id;
    const url = new URL(window.location.href);
    url.searchParams.set("profile", id);
    window.history.pushState(null, "", url);
    restoring = true;
    visitor.open(id, vocabulary);
    restoring = false;
    shownProfile = id;
  }
  function card(profile) {
    const article = element("article"), summary = element("div");
    article.append(element("h3", profile.displayName), element("p", profile.bio),
      element("p", [...(profile.roles || []), ...(profile.genres || []), ...(profile.languages || [])].join(" · ")));
    renderDNASummary(summary, profile.dna, vocabulary);
    article.append(summary);
    if (profile.premiumVerified === true) article.append(element("p", "✓ Verified Premium — active pass, not identity or rights verification."));
    if (profile.matchReasons?.length) {
      article.append(element("h4", "Why this matched"));
      const reasons = element("ul");
      profile.matchReasons.forEach(reason => reasons.append(element("li", typeof reason === "string" ? reason : reason.label || reason.text || "Shared filter")));
      article.append(reasons);
    }
    const open = element("button", "Open Profile");
    open.type = "button";
    open.addEventListener("click", () => openProfile(profile.publicProfileId));
    article.append(open);
    return article;
  }
  const controller = createDiscoveryController({
    clear,
    render(data) {
      byId("dnaResults").setAttribute("aria-busy", String(data.loading));
      byId("dnaMore").hidden = !data.nextCursor;
      byId("dnaMore").disabled = data.loading;
      if (data.loading) {
        byId("discoveryStatus").textContent = "Loading Creative DNA matches…";
        return;
      }
      vocabulary = data.terms || [];
      facets();
      byId("dnaResults").replaceChildren(...data.creators.map(card));
      byId("resultCount").textContent = `${data.creators.length} shown${Number.isFinite(data.total) ? ` · ${data.total} matching creators` : ""}`;
      byId("discoveryStatus").textContent = data.error
        ? `Search unavailable: ${data.error} Retry Search.`
        : data.directoryUnavailable ? "Live discovery is temporarily unavailable. Curated inspiration below is separate from results."
          : data.creators.length ? "Matches updated." : "No shared Creative DNA matches. Try fewer filters.";
      const curated = data.curated || [];
      byId("curatedFallback").hidden = curated.length === 0;
      byId("curatedCreators").replaceChildren(...curated.map(profile => {
        const article = element("article");
        article.append(element("h3", profile.displayName || profile.display_name),
          element("p", profile.bio), element("p", "HALO-curated seed · not a live DNA match · invitations unavailable"));
        return article;
      }));
      const deepLink = new URLSearchParams(window.location.search).get("profile");
      if (deepLink && shownProfile !== deepLink) {
        restoring = true;
        visitor.open(deepLink, vocabulary);
        restoring = false;
        shownProfile = deepLink;
      }
    }
  });
  function syncForm() {
    for (const name of FILTER_FIELDS) form.elements.namedItem(name).value = filters[name];
    facets();
  }
  function writeURL() {
    const query = filterQuery(filters);
    window.history.pushState(null, "", `${window.location.pathname}${query.size ? `?${query}` : ""}`);
  }
  function changed(immediate = false) {
    clearTimeout(timer);
    for (const name of FILTER_FIELDS) filters[name] = form.elements.namedItem(name).value;
    byId("facetStatus").textContent = "";
    restoring = true;
    visitor.clear();
    restoring = false;
    shownProfile = null;
    // Invalidate immediately, not after debounce: old matches must never flash.
    controller.invalidate();
    const run = () => { writeURL(); controller.search(filters); };
    if (immediate) run();
    else timer = setTimeout(run, 300);
  }
  form.addEventListener("input", event => { if (FILTER_FIELDS.includes(event.target.name)) changed(); });
  form.addEventListener("submit", event => { event.preventDefault(); changed(true); });
  form.addEventListener("reset", event => {
    event.preventDefault();
    filters = readFilters("");
    syncForm();
    changed(true);
  });
  byId("dnaMore").addEventListener("click", () => controller.more());
  window.addEventListener("popstate", () => {
    clearTimeout(timer);
    filters = readFilters(window.location.search);
    syncForm();
    restoring = true;
    visitor.clear();
    restoring = false;
    shownProfile = null;
    controller.invalidate();
    controller.search(filters);
  });
  async function authChanged() {
    const version = ++authGeneration;
    clearTimeout(timer);
    authenticated = false;
    restoring = true;
    visitor.clear();
    restoring = false;
    shownProfile = null;
    controller.invalidate();
    byId("dnaFacets").replaceChildren();
    vocabulary = [];
    try {
      const user = await identity.getUser();
      if (version !== authGeneration) return;
      authenticated = Boolean(user);
      byId("discoverySignIn").textContent = authenticated ? "Your creator workspace" : "Sign in to collaborate";
      controller.search(filters);
    } catch {
      if (version === authGeneration) {
        byId("discoveryStatus").textContent = "Identity unavailable. Showing public discovery.";
        controller.search(filters);
      }
    }
  }
  function ready(value) {
    if (identity || !value) return;
    identity = value;
    identity.onAuthChange(authChanged);
    authChanged();
  }
  syncForm();
  controller.search(filters);
  if (window.haloIdentity) ready(window.haloIdentity);
  else window.addEventListener("halo-identity-ready", event => ready(event.detail || window.haloIdentity), { once: true });
  return { controller, visitor };
}
if (typeof document !== "undefined") mountDiscovery();
