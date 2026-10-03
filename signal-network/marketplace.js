import { CREATOR_SEEDS, LISTING_SEEDS, LISTING_TYPES, formatListingPrice, normalizeListing, safeAssetUrl } from "../lib/creator-marketplace.js";
import { HaloAIService } from "../lib/halo-ai-service.js";

export const STORAGE_KEY = "halo.signal-marketplace.demo.v1";
const MAX_DRAFTS = 20;
export const MAX_STATE_BYTES = 100000;
const types = new Set(LISTING_TYPES.map(type => type.id));
const listingIds = new Set(LISTING_SEEDS.map(listing => listing.id));
const typeLabel = value => LISTING_TYPES.find(type => type.id === value)?.label || value;

export function publicPreviewUrl(value) {
  if (!value) return "";
  const safe = safeAssetUrl(String(value).trim());
  if (!safe) return "";
  try {
    const url = new URL(safe);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        host === "localhost" || !host.includes(".") || host.endsWith(".local") ||
        host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return "";
    return url.href;
  } catch { return ""; }
}

function boundedText(value, limit, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) {
    throw new Error(`${label} is required and must be at most ${limit} characters.`);
  }
  return value.trim();
}

export function createLocalDraft(input, id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`) {
  if (!["text", "collaboration", "listing"].includes(input.kind)) throw new Error("Choose a valid draft kind.");
  const draft = {
    id, kind: input.kind,
    title: boundedText(input.title, 120, "Title"),
    description: boundedText(input.description, 2000, "Description")
  };
  if (draft.kind === "listing") {
    if (!types.has(input.listingType)) throw new Error("Choose one of the six listing types.");
    if (typeof input.price !== "string" && typeof input.price !== "number") throw new Error("Enter a valid price.");
    if (String(input.price).trim() === "") throw new Error("Price is required.");
    const price = typeof input.price === "string" ? input.price.trim() : input.price;
    if (!["USD", "EUR", "GBP"].includes(input.currency)) throw new Error("Choose USD, EUR, or GBP.");
    const preview = publicPreviewUrl(input.assetPreviewUrl);
    if (input.assetPreviewUrl && !preview) throw new Error("Use a public HTTPS preview URL without credentials, query strings, or fragments.");
    const listing = normalizeListing({
      id, creatorId: "local-draft", title: draft.title, description: draft.description,
      listingType: input.listingType, price, currency: input.currency,
      licenseType: boundedText(input.licenseType, 120, "Proposed license terms"),
      format: boundedText(input.format, 80, "Format"),
      assetPreviewUrl: preview, isFeatured: false, isForSale: false
    });
    draft.listing = { ...listing, id, creatorId: "local-draft", isForSale: false, isFeatured: false, assetPreviewUrl: preview };
  }
  return draft;
}

export function sanitizeLocalState(input) {
  const clean = { saved: [], liked: [], drafts: [] };
  if (!input || typeof input !== "object") return clean;
  for (const key of ["saved", "liked"]) {
    if (Array.isArray(input[key])) clean[key] = [...new Set(input[key].filter(id => listingIds.has(id)))].slice(0, LISTING_SEEDS.length);
  }
  if (Array.isArray(input.drafts)) {
    for (const item of input.drafts.slice(0, MAX_DRAFTS)) {
      try {
        if (!item || typeof item.id !== "string" || !/^draft-[a-zA-Z0-9-]{1,80}$/.test(item.id) ||
            clean.drafts.some(draft => draft.id === item.id)) continue;
        clean.drafts.push(createLocalDraft({ ...item.listing, ...item }, item.id));
      } catch { /* Discard malformed or obsolete browser drafts. */ }
    }
  }
  return clean;
}

export function createLocalStore(storage) {
  let available = true;
  let state = sanitizeLocalState(null);
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!storage) available = false;
    if (raw && raw.length <= MAX_STATE_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_STATE_BYTES) {
      state = sanitizeLocalState(JSON.parse(raw));
    }
  } catch { available = false; }
  return {
    get state() { return state; },
    get available() { return available; },
    save(next) {
      const nextState = sanitizeLocalState(next);
      const serialized = JSON.stringify(nextState);
      if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
        throw new Error("Local demo storage limit reached. Shorten or delete drafts before saving; this change was not saved.");
      }
      state = nextState;
      try {
        if (!storage) throw new Error("Storage unavailable");
        storage.setItem(STORAGE_KEY, serialized);
        available = true;
      } catch { available = false; }
      return state;
    },
    clear() {
      state = sanitizeLocalState(null);
      try {
        if (!storage) throw new Error("Storage unavailable");
        storage.removeItem(STORAGE_KEY);
        available = true;
      } catch { available = false; }
    }
  };
}

export function filterListings(listings, type) {
  return type === "all" ? listings : listings.filter(listing => listing.listingType === type);
}

export function initMarketplace(doc = document) {
  const root = doc.getElementById("signal-feed");
  if (!root) return;
  const get = id => doc.getElementById(id);
  let storage;
  try { storage = globalThis.localStorage; } catch { /* Browser privacy settings can deny even access. */ }
  const store = createLocalStore(storage);
  const node = (tag, text, className) => {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const button = (label, action) => {
    const element = node("button", label, "signal-market__button");
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  };
  const announce = message => {
    get("marketStatus").textContent = `${message}${store.available ? "" : " Browser storage is unavailable; changes last only for this page session."}`;
  };
  for (const id of ["marketTypeFilter", "marketListingType"]) {
    for (const type of LISTING_TYPES) {
      const option = node("option", type.label);
      option.value = type.id;
      get(id).append(option);
    }
  }

  function preview(listing) {
    const url = publicPreviewUrl(listing.assetPreviewUrl);
    if (!url) {
      const disabled = button("Preview unavailable — no audio supplied", () => {});
      disabled.disabled = true;
      return disabled;
    }
    const container = node("div");
    const open = button("Load public audio preview", () => {
      const audio = node("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.src = url;
      audio.setAttribute("aria-label", `Public preview of ${listing.title}`);
      audio.addEventListener("error", () => {
        container.replaceChildren(node("p", "Preview could not be loaded. No audio is available."));
      });
      container.replaceChildren(audio);
    });
    container.append(open);
    return container;
  }

  function detail(listing) {
    get("marketDetailTitle").textContent = listing.title;
    const body = get("marketDetailBody");
    body.replaceChildren(
      node("p", listing.description),
      node("p", `${typeLabel(listing.listingType)} · ${formatListingPrice(listing)}`, "signal-market__price"),
      node("p", `Illustrative license: ${listing.licenseType}. Format: ${listing.format}. No rights verified or granted.`),
      preview(listing)
    );
    get("marketDetailStatus").textContent = "";
    get("marketDetail").showModal();
  }

  function terms(listing) {
    const badges = node("div", undefined, "signal-market__terms");
    badges.append(
      node("span", `Format: ${listing.format || "Unspecified"}`),
      node("span", `Illustrative license: ${listing.licenseType || "Unspecified"}`)
    );
    return badges;
  }

  function card(listing) {
    const creator = CREATOR_SEEDS.find(person => person.id === listing.creatorId);
    const article = node("article", undefined, "signal-market__card");
    if (listing.isFeatured) article.append(node("p", "Featured demo", "signal-market__eyebrow"));
    article.append(
      node("p", `${creator?.displayName || "Illustrative creator"}${creator?.verified ? " · Verified (demo)" : ""}`, "signal-market__creator"),
      node("p", [...(creator?.roles || []), ...(creator?.genres || [])].slice(0, 4).join(" / ")),
      node("h4", listing.title),
      node("p", listing.description),
      node("p", `${typeLabel(listing.listingType)} · ${formatListingPrice(listing)}`, "signal-market__price"),
      terms(listing),
      preview(listing)
    );
    if (creator) {
      const profile = node("a", `Explore ${creator.displayName} in Creator Network`, "signal-market__creator-link");
      profile.href = "/creator-network/";
      article.append(profile);
    }
    const actions = node("div", undefined, "signal-market__actions");
    for (const [key, label] of [["saved", "Save"], ["liked", "Like"]]) {
      const active = store.state[key].includes(listing.id);
      const control = button(`${active ? (key === "saved" ? "Saved" : "Liked") : label} locally`, () => {
        const current = store.state[key];
        try {
          store.save({ ...store.state, [key]: current.includes(listing.id) ? current.filter(id => id !== listing.id) : [...current, listing.id] });
        } catch (error) {
          announce(error.message || "Local preference was not saved.");
          return;
        }
        const nowActive = store.state[key].includes(listing.id);
        root.querySelectorAll(`[data-market-reaction="${key}"]`).forEach(item => {
          if (item.dataset.marketListing !== listing.id) return;
          item.textContent = `${nowActive ? (key === "saved" ? "Saved" : "Liked") : label} locally`;
          item.setAttribute("aria-pressed", String(nowActive));
        });
        announce("Local demo preference updated.");
      });
      control.dataset.marketReaction = key;
      control.dataset.marketListing = listing.id;
      control.setAttribute("aria-pressed", String(active));
      actions.append(control);
    }
    actions.append(button("View listing details", () => detail(listing)));
    article.append(actions);
    return article;
  }

  function render() {
    const filtered = filterListings(LISTING_SEEDS, get("marketTypeFilter").value);
    const featured = filtered.filter(listing => listing.isFeatured);
    for (const [id, listings] of [["marketFeatured", featured], ["marketFeed", filtered]]) {
      get(id).replaceChildren(...listings.map(card));
      if (!listings.length) get(id).append(node("p", "No illustrative listings in this selection."));
    }
    const drafts = get("marketDrafts");
    drafts.replaceChildren();
    for (const draft of store.state.drafts) {
      const article = node("article", undefined, "signal-market__card");
      article.append(
        node("p", `Local ${draft.kind} draft · not published`, "signal-market__eyebrow"),
        node("h4", draft.title), node("p", draft.description)
      );
      if (draft.listing) article.append(
        node("p", `${typeLabel(draft.listing.listingType)} · ${formatListingPrice(draft.listing)} · sale unavailable`, "signal-market__price"),
        terms(draft.listing),
        preview(draft.listing)
      );
      article.append(button("Delete local draft", () => {
        store.save({ ...store.state, drafts: store.state.drafts.filter(item => item.id !== draft.id) });
        render();
        announce("Local draft deleted.");
      }));
      drafts.append(article);
    }
    if (!store.state.drafts.length) drafts.append(node("p", "No local drafts yet. Nothing here is published."));
  }

  const form = get("marketComposerForm");
  const composerStatus = get("marketComposerStatus");
  const guideResult = get("marketGuideResult");
  let guideVersion = 0;
  const clearGuide = () => { guideVersion++; guideResult.replaceChildren(); };
  form.addEventListener("input", clearGuide);
  const input = () => ({
    kind: get("marketDraftKind").value, title: get("marketTitle").value,
    description: get("marketDescription").value,
    listingType: get("marketListingType").value, price: get("marketPrice").value,
    currency: get("marketCurrency").value, licenseType: get("marketLicense").value,
    format: get("marketFormat").value, assetPreviewUrl: get("marketPreview").value
  });
  get("marketDraftKind").addEventListener("change", () => {
    const sale = get("marketDraftKind").value === "listing";
    get("marketSaleFields").hidden = !sale;
    get("marketSaleFields").disabled = !sale;
  });
  get("marketCompose").addEventListener("click", () => {
    composerStatus.textContent = "";
    get("marketComposer").showModal();
  });
  for (const [dialog, close] of [["marketDetail", "marketDetailClose"], ["marketComposer", "marketComposerClose"]]) {
    get(close).addEventListener("click", () => get(dialog).close());
  }
  get("marketDetail").addEventListener("close", () => {
    get("marketDetailBody").querySelectorAll("audio").forEach(audio => { audio.pause(); audio.removeAttribute("src"); audio.load(); });
    get("marketDetailBody").replaceChildren();
  });
  get("marketRequest").addEventListener("click", () => {
    get("marketDetailStatus").textContent = "Unavailable in this demo. No request was sent. Use the separate member command center for real member connections.";
  });
  get("marketBuy").addEventListener("click", () => {
    get("marketDetailStatus").textContent = "No checkout is available. No purchase, payment, or license was created.";
  });
  get("marketTypeFilter").addEventListener("change", () => {
    render();
    announce(`${filterListings(LISTING_SEEDS, get("marketTypeFilter").value).length} illustrative listings shown.`);
  });
  get("marketClear").addEventListener("click", () => {
    store.clear();
    form.reset();
    get("marketSaleFields").hidden = true;
    get("marketSaleFields").disabled = true;
    composerStatus.textContent = "";
    clearGuide();
    render();
    announce("Local demo likes, saves, and drafts cleared. Member data is unchanged.");
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      if (store.state.drafts.length >= MAX_DRAFTS) throw new Error("Local draft limit reached (20). Delete a draft or clear local demo state.");
      const draft = createLocalDraft(input());
      store.save({ ...store.state, drafts: [draft, ...store.state.drafts] });
      render();
      form.reset();
      get("marketSaleFields").hidden = true;
      get("marketSaleFields").disabled = true;
      clearGuide();
      get("marketComposer").close();
      announce("Draft saved locally only. Nothing was published or offered for sale.");
    } catch (error) { composerStatus.textContent = error.message || "Draft could not be validated."; }
  });
  get("marketGuide").addEventListener("click", async () => {
    const version = ++guideVersion;
    guideResult.replaceChildren();
    composerStatus.textContent = "";
    try {
      const title = boundedText(get("marketTitle").value, 120, "Title");
      const description = boundedText(get("marketDescription").value, 2000, "Description");
      const review = await HaloAIService.reviewProject({ title, description, listingType: get("marketListingType").value });
      if (version !== guideVersion) return;
      guideResult.append(
        node("h3", "HALO Guide · local-rules advisory"),
        node("p", "Local advisory checklist only. Not actual AI or audio analysis, a valuation, or a rights / ownership review. No assets are sent or examined."),
        node("p", review.summary || "Develop your concept before publishing.")
      );
      for (const key of ["insights", "nextSteps"]) {
        const list = node("ul");
        for (const item of (Array.isArray(review[key]) ? review[key] : []).slice(0, 8)) {
          list.append(node("li", typeof item === "string" ? item : item?.detail || item?.description || item?.title || ""));
        }
        guideResult.append(list);
      }
      if (review.suggestedListingType) guideResult.append(node("p", `Suggested type: ${typeLabel(review.suggestedListingType)}. Suggestions do not change or publish your draft.`));
      if (typeof review.suggestedPrice === "number") guideResult.append(node("p", `Illustrative starting price: ${formatListingPrice({ price: review.suggestedPrice, currency: review.currency || "USD" })}. Not a valuation or guaranteed sale price.`));
    } catch { composerStatus.textContent = "Enter a title and description to get local advisory guidance. No external review was performed."; }
  });
  render();
  announce("Illustrative feed ready. No live inventory or transaction services connected.");
  return { store, render };
}

if (typeof document !== "undefined") initMarketplace(document);
