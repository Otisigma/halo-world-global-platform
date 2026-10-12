import { availableKeys, baseVotes, createMixCard, createVaultCard, filterAndSortTracks, validMixId } from "./vault-card.js";

export const VOTE_STORAGE_KEY = "halo.djVault.votes";
export const VOTE_LIMIT = 500;

// Per-browser vote ledger used only as a fallback for visitors without verified DJ
// access; verified DJs vote through /api/dj-vault/vote and see shared totals.
// Only short, plain track IDs are kept; unreadable or unavailable storage
// degrades to in-memory votes for the current visit.
export function createVoteStore(storage) {
  const valid = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  let voted = new Set();
  try {
    const saved = JSON.parse(storage?.getItem(VOTE_STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) voted = new Set(saved.filter(valid).slice(-VOTE_LIMIT));
  } catch { voted = new Set(); }
  const save = () => { try { storage?.setItem(VOTE_STORAGE_KEY, JSON.stringify([...voted])); } catch {} };
  return {
    has: id => voted.has(String(id)),
    toggle(id) {
      const key = String(id);
      if (!valid(key)) return false;
      if (voted.has(key)) voted.delete(key);
      else {
        voted.add(key);
        // Keep the ledger bounded: the oldest vote makes room for the newest.
        if (voted.size > VOTE_LIMIT) voted.delete(voted.values().next().value);
      }
      save();
      return voted.has(key);
    }
  };
}

export function applyVaultRoute(document) {
  const body = document?.body;
  if (!body) return false;
  body.classList.add("dj-vault-room");
  body.dataset.route = "dj-vault";
  return true;
}

export function createVaultView({ document, fetch, location, identity, history, storage = null }) {
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
  const mixGrid = document.getElementById("vault-mixes");
  const mixStatus = document.getElementById("vault-mix-status");
  const uploadLink = document.getElementById("vault-upload-link");
  const featuredContainer = document.getElementById("vault-shop-push-container");
  const featuredSlot = document.getElementById("vault-shop-push");
  let tracks = [], authorized = false, authenticated = false, nextOffset = null, generation = 0;
  let paymentConfirmed = false, paymentError = "", rendered = new Map(), cueHandled = false;
  let mixGeneration = 0, featuredGeneration = 0;
  const votes = createVoteStore(storage);
  // Verified DJs see shared server totals (which already include their own vote);
  // other visitors see the shared total plus their browser-local vote.
  const voteCount = track => baseVotes(track) + (!authorized && votes.has(track.id) ? 1 : 0);
  const hasVoted = track => authorized ? track.voted === true : votes.has(track.id);
  const reducedMotion = () => document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== false;
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
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in to continue." : response.status === 403 ? "Verified DJ access required." : response.status === 429 ? "Too many requests. Try again shortly." : "DJ Vault is unavailable. Please try again.");
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
  function vote(track) {
    if (!authorized) {
      const voted = votes.toggle(track.id);
      return { voted, votes: voteCount(track) };
    }
    return api("vote", { trackId: track.id, voted: track.voted !== true }).then(data => {
      if (data?.success !== true || typeof data.voted !== "boolean" || !Number.isSafeInteger(data.votes) || data.votes < 0) throw new Error("Invalid vote response. Please try again.");
      track.voted = data.voted;
      track.votes = data.votes;
      return { voted: data.voted, votes: data.votes };
    }).catch(error => { status.textContent = error.message; return null; });
  }
  function focusTrack(card) {
    card.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    (card.querySelector("audio") || card).focus?.({ preventScroll: true });
  }
  function jump(track, card) {
    const params = new URLSearchParams(location.search);
    params.set("track", String(track.id));
    history?.replaceState(null, "", `/dj-vault/?${params}`);
    focusTrack(card);
    status.textContent = `Cued ${track.title || "edition"}${card.querySelector("audio") ? " — preview ready on the deck." : "."}`;
  }
  function render() {
    const visible = filterAndSortTracks(tracks, { sort: sort.value, rarity: rarityFilter.value, bpm: bpmFilter.value, key: keyFilter.value, voteCount });
    const cards = visible.map(track => createVaultCard({
      document, track, authorized,
      votes: voteCount(track), voted: hasVoted(track), onVote: vote, onJump: jump,
      onAcquire: acquire,
      onPreviewPlay: audio => grid.querySelectorAll("audio").forEach(other => { if (other !== audio) other.pause(); }),
      onPreviewError: () => { status.textContent = "This preview is unavailable."; }
    }));
    rendered = new Map(visible.map((track, index) => [String(track.id), cards[index]]));
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
  async function loadFeatured() {
    if (!featuredContainer || !featuredSlot) return;
    const current = ++featuredGeneration;
    featuredContainer.hidden = true;
    featuredSlot.replaceChildren();
    try {
      const data = await api("featured-push");
      if (current !== featuredGeneration || data.success !== true || !validMixId(data.edition?.id)) return;
      const mix = data.edition;
      const card = createMixCard({ document, mix });
      card.id = `vault-featured-${mix.id}`;
      const tag = { featured: "Featured", white_label: "White label", test_press: "Test press" };
      card.querySelector("p").textContent = tag[mix.pushPriority] || tag.featured;
      const amount = mix.commerce?.priceMinor;
      const currency = mix.commerce?.currency;
      const free = mix.salesStatus === "stream_only" && mix.commerce?.clientSaleEnabled === false;
      const price = free ? "Free stream" : Number.isSafeInteger(amount) && amount >= 100 && /^[A-Z]{3}$/.test(currency || "")
        ? new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount / 100) : "Price unavailable";
      card.append(element("p", price, "vault-price"));
      featuredSlot.replaceChildren(card);
      featuredContainer.hidden = false;
    } catch {
      // An unavailable banner must not block catalog browsing or checkout.
    }
  }
  async function loadMixes() {
    const current = ++mixGeneration;
    mixGrid.replaceChildren();
    mixGrid.setAttribute("aria-busy", "true");
    mixStatus.textContent = "Loading mixes…";
    const target = new URLSearchParams(location.search).get("mix");
    const getMixes = async path => {
      const response = await fetch(`/api/mixes${path}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Mixes are unavailable. Try again to reload.");
      const data = await response.json();
      if (!Array.isArray(data.mixes)) throw new Error("Invalid mixes response. Try again to reload.");
      return data.mixes.filter(mix => mix && validMixId(mix.id));
    };
    try {
      const mixes = await getMixes("?limit=18");
      if (validMixId(target) && !mixes.some(mix => mix.id === target)) {
        const requested = await getMixes(`?id=${encodeURIComponent(target)}`);
        mixes.unshift(...requested.filter(mix => mix.id === target));
      }
      if (current !== mixGeneration) return;
      const selected = mixes.find(mix => mix.id === target);
      const ordered = selected ? [selected, ...mixes.filter(mix => mix.id !== target)] : mixes;
      const cards = ordered.map(mix => createMixCard({ document, mix, selected: mix.id === target }));
      mixGrid.replaceChildren(...cards);
      mixStatus.textContent = `${mixes.length ? `${mixes.length} mixes loaded.` : "No mixes are available yet."}${target ? selected ? ` Selected mix: ${selected.title || "Untitled mix"}.` : " Requested mix is unavailable or private." : ""}`;
      if (selected) focusTrack(cards[0]);
    } catch (error) {
      if (current !== mixGeneration) return;
      mixStatus.textContent = error.message;
      retry.hidden = false;
    } finally { if (current === mixGeneration) mixGrid.setAttribute("aria-busy", "false"); }
  }
  async function load(append = false) {
    const current = ++generation;
    grid.setAttribute("aria-busy", "true");
    status.textContent = "Loading vault…";
    retry.hidden = true;
    more.hidden = true;
    confirm.hidden = true;
    if (!append) { tracks = []; authorized = false; grid.replaceChildren(); }
    const mixesLoaded = !append ? loadMixes() : null;
    const featuredLoaded = !append ? loadFeatured() : null;
    try {
      const session = await api("session");
      if (current !== generation) return;
      authorized = session.authorized === true;
      authenticated = session.authenticated === true;
      login.textContent = session.authenticated ? "Account / sign out" : "Sign in";
      if (uploadLink) uploadLink.hidden = session.canRoute !== true;
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
      if (!cueHandled) {
        cueHandled = true;
        const cued = rendered.get(new URLSearchParams(location.search).get("track"));
        if (cued) focusTrack(cued);
      }
    } catch (error) {
      if (current !== generation) return;
      status.textContent = error.message;
      retry.hidden = false;
    } finally {
      await mixesLoaded;
      await featuredLoaded;
      if (current === generation) grid.setAttribute("aria-busy", "false");
    }
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
  let storage = null;
  try { storage = window.localStorage; } catch {}
  const view = createVaultView({ document: window.document, fetch: window.fetch.bind(window), location: window.location, identity, history: window.history, storage });
  import("/identity.js").then(() => window.haloIdentity.onAuthChange(() => view.load())).catch(() => {});
  view.load();
}
