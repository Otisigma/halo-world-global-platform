const price = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function createVaultView({ document, fetch, location, identity }) {
  const grid = document.getElementById("vault-grid");
  const status = document.getElementById("vault-status");
  const retry = document.getElementById("vault-retry");
  const more = document.getElementById("vault-more");
  const sort = document.getElementById("vault-sort");
  const login = document.getElementById("vault-login");
  let tracks = [], authorized = false, authenticated = false, nextOffset = null, generation = 0;
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
  function render() {
    grid.replaceChildren();
    const sorted = [...tracks];
    if (sort.value === "bpm") sorted.sort((a, b) => a.bpm - b.bpm);
    if (sort.value === "key") sorted.sort((a, b) => String(a.musicalKey).localeCompare(String(b.musicalKey)));
    if (sort.value === "price") sorted.sort((a, b) => a.pricePence - b.pricePence);
    for (const track of sorted) {
      const card = element("article", null, "vault-card");
      const metadata = element("div", null, "vault-meta");
      metadata.append(element("span", `BPM ${track.bpm ?? "N/A"}`), element("span", `KEY ${track.musicalKey || "N/A"}`),
        element("span", String(track.deliveryFormat || "").toUpperCase()));
      card.append(metadata, element("h2", track.title), element("p", track.artist), element("p", `DJ Vault · ${track.previewType || "clip"} preview`));
      if (track.previewUrl === `/api/dj-vault/preview?trackId=${encodeURIComponent(track.id)}`) {
        const audio = element("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = track.previewUrl;
        audio.setAttribute("aria-label", `Preview ${track.title}`);
        audio.addEventListener("play", () => grid.querySelectorAll("audio").forEach(other => { if (other !== audio) other.pause(); }));
        audio.addEventListener("error", () => { status.textContent = "This preview is unavailable."; });
        card.append(audio);
      }
      const actions = element("div", null, "vault-actions");
      const amount = Number(track.pricePence);
      const button = element("button", track.entitled ? "Download edition" : `Acquire ${String(track.deliveryFormat || "").toUpperCase()}`);
      button.type = "button";
      button.disabled = !authorized || !Number.isInteger(amount) || amount < 100;
      button.setAttribute("aria-label", `${button.textContent}: ${track.title}`);
      button.addEventListener("click", () => acquire(track, button));
      actions.append(element("span", Number.isInteger(amount) && amount >= 100 ? price.format(amount / 100) : "Price unavailable", "vault-price"), button);
      card.append(actions);
      grid.append(card);
    }
  }
  async function load(append = false) {
    const current = ++generation;
    grid.setAttribute("aria-busy", "true");
    status.textContent = "Loading vault…";
    retry.hidden = true;
    more.hidden = true;
    if (!append) { tracks = []; authorized = false; grid.replaceChildren(); }
    try {
      const session = await api("session");
      if (current !== generation) return;
      authorized = session.authorized === true;
      authenticated = session.authenticated === true;
      login.textContent = session.authenticated ? "Account / sign out" : "Sign in";
      const params = new URLSearchParams(location.search);
      if (!append && authorized && params.has("session_id")) {
        await api("confirm", { sessionId: params.get("session_id"), trackId: params.get("trackId") });
      }
      const data = await api(`tracks?offset=${append ? nextOffset : 0}`);
      if (current !== generation) return;
      if (data.success !== true || !Array.isArray(data.tracks)) throw new Error("Invalid vault response. Please try again.");
      tracks = append ? [...tracks, ...data.tracks] : data.tracks;
      nextOffset = Number.isSafeInteger(data.nextOffset) ? data.nextOffset : null;
      render();
      status.textContent = tracks.length ? `${tracks.length} editions loaded.${authorized ? "" : " Sign in with verified DJ access to acquire."}` : "No DJ Vault editions are available yet.";
      more.hidden = nextOffset === null;
    } catch (error) {
      if (current !== generation) return;
      status.textContent = error.message;
      retry.hidden = false;
    } finally { if (current === generation) grid.setAttribute("aria-busy", "false"); }
  }
  retry.addEventListener("click", () => load());
  more.addEventListener("click", () => load(true));
  sort.addEventListener("change", render);
  login.addEventListener("click", async () => {
    try { if (authenticated) await identity.logout(); else await identity.login(); await load(); }
    catch { status.textContent = "Sign-in is unavailable. Please try again."; }
  });
  return { load };
}

if (typeof window !== "undefined") {
  const identity = {
    login: async () => { await import("/identity.js"); return window.haloIdentity.login(); },
    logout: async () => { await import("/identity.js"); return window.haloIdentity.logout(); }
  };
  const view = createVaultView({ document: window.document, fetch: window.fetch.bind(window), location: window.location, identity });
  import("/identity.js").then(() => window.haloIdentity.onAuthChange(() => view.load())).catch(() => {});
  view.load();
}
