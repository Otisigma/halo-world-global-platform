const PURPOSE_LABELS = { release_notes: "Release notes", halo_updates: "HALO platform updates" };

export function safeUpdateDestination(value, origin = globalThis.location?.origin) {
  if (typeof value !== "string" || !origin || (!value.startsWith("/") && !value.startsWith("https://")) || value.startsWith("//") || value.includes("\\")) return "";
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.username && !url.password ? `${url.pathname}${url.search}${url.hash}` : "";
  } catch { return ""; }
}

export function mountCampaignUpdates(root, identity = globalThis.window?.haloIdentity) {
  if (!root || !identity) return () => {};
  const doc = root.ownerDocument;
  const node = (tag, text) => {
    const result = doc.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const title = node("h3", "Your HALO updates");
  const account = node("a", "Sign in / Creator Pass");
  account.href = "/creator-network/";
  const disclosure = node("p", "Choose release notes and platform updates separately. These preferences control your in-app inbox, not automatic email. Dreamweaver unlock consent does not subscribe you to HALO platform updates.");
  const status = node("p", "Sign in with your Creator Pass to manage update preferences.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const form = node("form");
  const fieldset = node("fieldset");
  fieldset.append(node("legend", "In-app subscriptions"));
  const inputs = {};
  for (const [purpose, label] of Object.entries(PURPOSE_LABELS)) {
    const wrapper = node("label");
    const input = node("input");
    input.type = "checkbox";
    input.name = purpose;
    input.disabled = true;
    inputs[purpose] = input;
    wrapper.append(input, doc.createTextNode(` ${label} `));
    fieldset.append(wrapper);
  }
  const save = node("button", "Save update preferences");
  save.type = "submit";
  save.disabled = true;
  const refresh = node("button", "Refresh updates");
  refresh.type = "button";
  refresh.disabled = true;
  form.append(fieldset, save, refresh);
  const list = node("div");
  list.setAttribute("aria-label", "Campaign update inbox");
  root.replaceChildren(title, account, disclosure, status, form, list);
  let session = 0, userId = "", busy = false, stopped = false, dirty = false, poll;
  let active = new AbortController();
  let preferences = {};

  function current(epoch) { return !stopped && epoch === session; }
  function controls(enabled) {
    list.inert = !enabled;
    root.setAttribute("aria-busy", String(!enabled && Boolean(userId)));
    fieldset.disabled = !enabled;
    for (const input of Object.values(inputs)) input.disabled = !enabled;
    save.disabled = !enabled;
    refresh.disabled = !enabled;
  }
  async function request(body, epoch) {
    const controller = new AbortController();
    const sessionSignal = active.signal;
    const cancel = () => controller.abort();
    sessionSignal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 12000);
    try {
      const response = await fetch("/api/campaign-updates", {
        credentials: "same-origin", signal: controller.signal,
        ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
      });
      const data = await response.json();
      if (!current(epoch)) throw new Error("Session changed");
      if (!response.ok) throw new Error(data.message || "Updates are unavailable.");
      return data;
    } finally {
      clearTimeout(timer);
      sessionSignal.removeEventListener("abort", cancel);
    }
  }
  function render(data, epoch) {
    dirty = false;
    preferences = Object.fromEntries((data.preferences || []).map(item => [item.purpose, item.subscribed === true]));
    for (const purpose of Object.keys(inputs)) inputs[purpose].checked = preferences[purpose] === true;
    list.replaceChildren();
    for (const item of data.inbox || []) {
      const card = node("article");
      card.append(node("h4", item.output.title), node("p", item.output.body));
      const destination = safeUpdateDestination(item.output.destinationUrl);
      if (destination) {
        const link = node("a", "Open on HALO");
        link.href = destination;
        card.append(link);
      }
      if (!item.readAt) {
        const read = node("button", "Mark read");
        read.type = "button";
        read.addEventListener("click", () => act(async () => {
          await request({ action: "read", id: item.id }, epoch);
          render(await request(null, epoch), epoch);
          status.textContent = "Update marked read.";
        }, epoch));
        card.append(read);
      }
      list.append(card);
    }
    if (!list.children.length) list.append(node("p", "No campaign updates yet."));
  }
  async function act(work, epoch = session) {
    if (busy || !userId || !current(epoch)) return;
    busy = true;
    controls(false);
    try { await work(); }
    catch (error) { if (current(epoch)) status.textContent = error.message; }
    finally { if (current(epoch)) { busy = false; controls(true); } }
  }
  async function load(epoch = session) {
    return act(async () => {
      render(await request(null, epoch), epoch);
      status.textContent = "Updates loaded. Preferences are opt-in.";
    }, epoch);
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    const epoch = session;
    const desired = Object.fromEntries(Object.entries(inputs).map(([purpose, input]) => [purpose, input.checked]));
    act(async () => {
      for (const [purpose, enabled] of Object.entries(desired)) {
        if (enabled !== (preferences[purpose] === true)) await request({ action: enabled ? "subscribe" : "unsubscribe", purpose }, epoch);
      }
      render(await request(null, epoch), epoch);
      status.textContent = "Update preferences saved.";
    }, epoch);
  });
  form.addEventListener("change", () => {
    dirty = Object.entries(inputs).some(([purpose, input]) => input.checked !== (preferences[purpose] === true));
    status.textContent = dirty ? "Unsaved preferences — automatic refresh paused. Save your choices or refresh to discard them." : "Preferences unchanged.";
  });
  refresh.addEventListener("click", () => load());
  function sessionChanged(user) {
    session++;
    active.abort();
    active = new AbortController();
    userId = user?.id || "";
    account.textContent = userId ? "Manage Creator Pass" : "Sign in / Creator Pass";
    busy = false;
    preferences = {};
    dirty = false;
    list.replaceChildren();
    Object.values(inputs).forEach(input => { input.checked = false; });
    controls(Boolean(userId));
    status.textContent = userId ? "Loading your subscriptions…" : "Sign in with your Creator Pass to manage update preferences.";
    if (userId) load();
  }
  const unsubscribe = identity.onAuthChange((_event, user) => sessionChanged(user));
  const initialSession = session;
  identity.getUser().then(user => { if (current(initialSession)) sessionChanged(user); }).catch(() => {
    if (current(initialSession)) status.textContent = "Identity is unavailable. Try signing in again.";
  });
  poll = setInterval(() => { if (userId && !doc.hidden && !dirty) load(); }, 60000);
  const dispose = () => {
    stopped = true;
    session++;
    active.abort();
    clearInterval(poll);
    unsubscribe?.();
  };
  globalThis.window?.addEventListener("pagehide", event => { if (!event.persisted) dispose(); });
  globalThis.window?.addEventListener("pageshow", async event => {
    if (!event.persisted) return;
    sessionChanged(null);
    const epoch = session;
    const user = await identity.getUser().catch(() => null);
    if (current(epoch)) sessionChanged(user);
  });
  return dispose;
}

if (globalThis.document && globalThis.window) {
  const connect = () => {
    for (const root of document.querySelectorAll("[data-campaign-updates]")) mountCampaignUpdates(root);
  };
  if (window.haloIdentity) connect();
  else window.addEventListener("halo-identity-ready", connect, { once: true });
}
