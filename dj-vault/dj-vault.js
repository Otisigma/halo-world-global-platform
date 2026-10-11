import { availableKeys, createVaultCard, filterAndSortTracks } from "./vault-card.js";

export function applyVaultRoute(document) {
  const body = document?.body;
  if (!body) return false;
  body.classList.add("dj-vault-room");
  body.dataset.route = "dj-vault";
  return true;
}

export function createVaultView({ document, fetch, location, identity, history }) {
  const grid = document.getElementById("vault-grid");
  const status = document.getElementById("vault-status");
  const retry = document.getElementById("vault-retry");
  const more = document.getElementById("vault-more");
  const sort = document.getElementById("vault-sort");
  const rarityFilter = document.getElementById("vault-rarity");
  const bpmFilter = document.getElementById("vault-bpm");
  const keyFilter = document.getElementById("vault-key");
  const login = document.getElementById("vault-login");
  const auth = document.getElementById("vault-auth");
  const email = document.getElementById("vault-email");
  const password = document.getElementById("vault-password");
  const confirm = document.getElementById("vault-confirm");
  let tracks = [], authorized = false, authenticated = false, nextOffset = null, generation = 0;
  let paymentConfirmed = false, paymentError = "";
  const element = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  };
  const api = async (path, body) => {
    const response = await fetch(`/api/dj-vault/${path}`, {
      credentials: "same-origin", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in to continue." : response.status === 403 ? "Verified DJ access required." : "DJ Vault is unavailable. Please try again.");
    return response.json();
  };
  async function acquire(track, button) {
    button.disabled = true;
    try {
      if (track.entitled) {
        location.assign(`/api/dj-vault/download?trackId=${encodeURIComponent(track.id)}`);
        return;
      }
      const data = await api("checkout", { trackId: track.id });
      if (data.entitled) { track.entitled = true; render(); return; }
      const checkout = new URL(data.checkoutUrl);
      if (checkout.protocol !== "https:" || checkout.hostname !== "checkout.stripe.com" || checkout.username || checkout.password) throw new Error("Invalid checkout destination.");
      location.assign(checkout.href);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = !authorized; }
  }
  function syncKeyOptions() {
    const selected = keyFilter.value || "all";
    const keys = availableKeys(tracks);
    const all = element("option", "All keys");
    all.value = "all";
    keyFilter.replaceChildren(all, ...keys.map(key => { const option = element("option", key); option.value = key; return option; }));
    keyFilter.value = keys.includes(selected) ? selected : "all";
  }
  function render() {
    const visible = filterAndSortTracks(tracks, { sort: sort.value, rarity: rarityFilter.value, bpm: bpmFilter.value, key: keyFilter.value });
    const cards = visible.map(track => createVaultCard({
      document, track, authorized,
      onAcquire: acquire,
      onPreviewPlay: audio => grid.querySelectorAll("audio").forEach(other => { if (other !== audio) other.pause(); }),
      onPreviewError: () => { status.textContent = "This preview is unavailable."; }
    }));
    const bins = [];
    for (let index = 0; index < cards.length; index += 3) {
      const name = `Crate ${String(index / 3 + 1).padStart(2, "0")}`;
      const bin = element("section", null, "vault-bin");
      bin.setAttribute("aria-label", name);
      const rail = element("p", `${name} // ${Math.min(3, cards.length - index)} pressings`, "vault-bin__label");
      const sleeves = element("div", null, "vault-bin__sleeves");
      sleeves.append(...cards.slice(index, index + 3));
      bin.append(rail, sleeves);
      bins.push(bin);
    }
    grid.replaceChildren(...bins);
    return visible.length;
  }
  function describe(shown) {
    const filtered = [rarityFilter, bpmFilter, keyFilter].some(control => (control.value || "all") !== "all");
    const count = filtered ? `Showing ${shown} of ${tracks.length} editions.` : `${tracks.length} editions loaded.`;
    status.textContent = (tracks.length ? `${count}${shown ? "" : " No editions match these filters."}${authorized ? "" : " Sign in with verified DJ access to acquire."}` : "No DJ Vault editions are available yet.")
      + (paymentError ? ` ${paymentError}` : "");
  }
  function refilter() { describe(render()); }
  async function load(append = false) {
    const current = ++generation;
    grid.setAttribute("aria-busy", "true");
    status.textContent = "Loading vault…";
    retry.hidden = true;
    more.hidden = true;
    confirm.hidden = true;
    if (!append) { tracks = []; authorized = false; grid.replaceChildren(); }
    try {
      const session = await api("session");
      if (current !== generation) return;
      authorized = session.authorized === true;
      authenticated = session.authenticated === true;
      login.textContent = session.authenticated ? "Account / sign out" : "Sign in";
      const params = new URLSearchParams(location.search);
      paymentError = "";
      if (!append && authorized && params.has("session_id") && !paymentConfirmed) {
        try {
          await api("confirm", { sessionId: params.get("session_id"), trackId: params.get("trackId") });
          paymentConfirmed = true;
          params.delete("session_id");
          params.delete("trackId");
          history?.replaceState(null, "", `/dj-vault/${params.size ? `?${params}` : ""}`);
        } catch (error) {
          paymentError = `Payment confirmation needs attention: ${error.message}`;
          confirm.hidden = false;
        }
      }
      const data = await api(`tracks?offset=${append ? nextOffset : 0}`);
      if (current !== generation) return;
      if (data.success !== true || !Array.isArray(data.tracks)) throw new Error("Invalid vault response. Please try again.");
      tracks = append ? [...tracks, ...data.tracks] : data.tracks;
      nextOffset = Number.isSafeInteger(data.nextOffset) ? data.nextOffset : null;
      syncKeyOptions();
      describe(render());
      more.hidden = nextOffset === null;
    } catch (error) {
      if (current !== generation) return;
      status.textContent = error.message;
      retry.hidden = false;
    } finally { if (current === generation) grid.setAttribute("aria-busy", "false"); }
  }
  retry.addEventListener("click", () => load());
  more.addEventListener("click", () => load(true));
  for (const control of [sort, rarityFilter, bpmFilter, keyFilter]) control.addEventListener("change", refilter);
  confirm.addEventListener("click", () => load());
  login.addEventListener("click", async () => {
    try {
      if (authenticated) { await identity.logout(); await load(); }
      else { auth.hidden = false; email.focus(); }
    }
    catch { status.textContent = "Sign-in is unavailable. Please try again."; }
  });
  auth.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = auth.querySelector("button");
    submit.disabled = true;
    try {
      await identity.login(email.value, password.value);
      password.value = "";
      auth.hidden = true;
      await load();
    } catch { password.value = ""; status.textContent = "Sign-in failed. Check your credentials and try again."; }
    finally { submit.disabled = false; }
  });
  return { load };
}

if (typeof window !== "undefined") {
  applyVaultRoute(window.document);
  const identity = {
    login: async (email, password) => { await import("/identity.js"); return window.haloIdentity.login(email, password); },
    logout: async () => { await import("/identity.js"); return window.haloIdentity.logout(); }
  };
  const view = createVaultView({ document: window.document, fetch: window.fetch.bind(window), location: window.location, identity, history: window.history });
  import("/identity.js").then(() => window.haloIdentity.onAuthChange(() => view.load())).catch(() => {});
  view.load();
}
