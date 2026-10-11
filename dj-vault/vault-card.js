// Reusable white-label vault card system. All metadata is rendered with textContent only.
const price = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export const VAULT_CARD_VARIANTS = Object.freeze({
  white_label: Object.freeze({ label: "White Label", stamp: "White Label // Club Use Only", rank: 1 }),
  promo_copy: Object.freeze({ label: "Promo Copy", stamp: "Promo Copy // Not For Resale", rank: 2 }),
  test_press: Object.freeze({ label: "Test Press", stamp: "Test Pressing // Approve Before Cut", rank: 3 }),
  vault_only: Object.freeze({ label: "Vault Only", stamp: "Vault Only // Never Released", rank: 4 }),
  selector_exclusive: Object.freeze({ label: "Selector Exclusive", stamp: "Selector Exclusive // Dubplate", rank: 5 })
});

export const BPM_RANGES = Object.freeze({
  all: [0, Infinity], "under-120": [0, 119], "120-129": [120, 129], "130-139": [130, 139],
  "140-159": [140, 159], "160-plus": [160, Infinity]
});

// Server-provided community counts are optional; anything that is not a safe non-negative integer counts as zero.
export const baseVotes = track => Number.isSafeInteger(track?.votes) && track.votes >= 0 ? track.votes : 0;
export const trackAnchor = id => `vault-track-${String(id || "").replace(/[^A-Za-z0-9_-]/g, "") || "edition"}`;

export const variantFor = rarity => Object.hasOwn(VAULT_CARD_VARIANTS, rarity) ? rarity : "white_label";

// Camelot-aware ordering (1A, 1B, 2A … 12B); non-Camelot keys sort alphabetically afterwards.
export function keyOrder(value) {
  const match = /^(1[0-2]|[1-9])([AB])$/i.exec(String(value || "").trim());
  return match ? Number(match[1]) * 2 + (match[2].toUpperCase() === "B" ? 1 : 0) : Infinity;
}
const compareKeys = (a, b) => (keyOrder(a) - keyOrder(b)) || String(a || "").localeCompare(String(b || ""));

export function filterAndSortTracks(tracks, { sort = "newest", rarity = "all", bpm = "all", key = "all", voteCount = baseVotes } = {}) {
  const [low, high] = BPM_RANGES[bpm] || BPM_RANGES.all;
  const list = tracks.map((track, index) => ({ track, index })).filter(({ track }) =>
    (rarity === "all" || variantFor(track.rarity) === rarity)
    && (bpm === "all" || (Number.isFinite(track.bpm) && track.bpm >= low && track.bpm <= high))
    && (key === "all" || String(track.musicalKey || "").trim().toUpperCase() === String(key).trim().toUpperCase()));
  const comparators = {
    bpm: (a, b) => (a.track.bpm ?? Infinity) - (b.track.bpm ?? Infinity),
    key: (a, b) => compareKeys(a.track.musicalKey, b.track.musicalKey),
    price: (a, b) => (a.track.pricePence ?? Infinity) - (b.track.pricePence ?? Infinity),
    "price-desc": (a, b) => (b.track.pricePence ?? -Infinity) - (a.track.pricePence ?? -Infinity),
    votes: (a, b) => voteCount(b.track) - voteCount(a.track),
    rarity: (a, b) => VAULT_CARD_VARIANTS[variantFor(b.track.rarity)].rank - VAULT_CARD_VARIANTS[variantFor(a.track.rarity)].rank
  };
  const compare = comparators[sort];
  // The API already returns newest first, so original order is the stable tie-breaker.
  return list.sort((a, b) => (compare ? compare(a, b) : 0) || a.index - b.index).map(({ track }) => track);
}

export function availableKeys(tracks) {
  return [...new Set(tracks.map(track => String(track.musicalKey || "").trim().toUpperCase()).filter(Boolean))].sort(compareKeys);
}

export function createVaultCard({ document, track, authorized, onAcquire, onPreviewPlay, onPreviewError, votes = baseVotes(track), voted = false, onVote, onJump }) {
  const element = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  };
  const variant = variantFor(track.rarity);
  const config = VAULT_CARD_VARIANTS[variant];
  const format = String(track.deliveryFormat || "").toUpperCase();
  const card = element("article", null, `vault-card vault-card--${variant.replace(/_/g, "-")}`);
  card.setAttribute("data-rarity", variant);
  card.id = trackAnchor(track.id);
  card.tabIndex = -1;

  const stamp = element("p", config.stamp, "vault-card__stamp");
  const sleeve = element("div", null, "vault-card__sleeve");
  sleeve.setAttribute("aria-hidden", "true");
  const label = element("div", null, "vault-card__label");
  const catalogNumber = `HALO-${String(track.id || "").replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase() || "VAULT"}`;
  label.append(element("span", catalogNumber, "vault-card__catalog"),
    element("span", "33⅓ / 45", "vault-card__speed"));
  sleeve.append(label);

  const chips = element("ul", null, "vault-meta");
  chips.setAttribute("aria-label", "Edition metadata");
  for (const [text, modifier] of [[config.label, "rarity"], [`BPM ${track.bpm ?? "N/A"}`, "bpm"],
    [`KEY ${track.musicalKey || "N/A"}`, "key"], [format || "FORMAT N/A", "format"]]) {
    chips.append(element("li", text, `vault-chip vault-chip--${modifier}`));
  }

  card.append(stamp, sleeve, element("p", catalogNumber, "vault-card__index"),
    element("h2", track.title), element("p", track.artist, "vault-card__artist"), chips,
    element("p", `DJ Vault · ${track.previewType || "clip"} preview`, "vault-card__preview-note"));

  if (track.previewUrl === `/api/dj-vault/preview?trackId=${encodeURIComponent(track.id)}`) {
    const audio = element("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = track.previewUrl;
    audio.setAttribute("aria-label", `Preview ${track.title}`);
    audio.addEventListener("play", () => onPreviewPlay?.(audio));
    audio.addEventListener("error", () => onPreviewError?.(audio));
    card.append(audio);
  }

  const actions = element("div", null, "vault-actions");
  const amount = Number(track.pricePence);
  const priced = Number.isInteger(amount) && amount >= 100;
  const button = element("button", track.entitled ? "Download edition" : `Acquire ${format}`);
  button.type = "button";
  button.disabled = !authorized || !priced;
  button.setAttribute("aria-label", `${button.textContent}: ${track.title}`);
  button.addEventListener("click", () => onAcquire?.(track, button));
  const pricing = element("div", null, "vault-pricing");
  pricing.append(element("span", priced ? price.format(amount / 100) : "Price unavailable", "vault-price"),
    element("small", format ? `${format} lossless delivery` : "Lossless delivery", "vault-format"));
  actions.append(pricing, button);

  // Community selector console: vote tally, upvote toggle, and quick jump.
  const voting = element("div", null, "vault-vote");
  voting.setAttribute("role", "group");
  voting.setAttribute("aria-label", `Community votes: ${track.title}`);
  const tally = element("p", null, "vault-vote__tally");
  const count = element("span", null, "vault-vote__count");
  tally.append(count, element("span", "selector votes", "vault-vote__unit"));
  const upvote = element("button", null, "vault-vote__up");
  upvote.type = "button";
  const jump = element("button", "Jump to track", "vault-vote__jump");
  jump.type = "button";
  jump.setAttribute("aria-label", `Jump to track: ${track.title}`);
  const paint = (total, active) => {
    count.textContent = String(total);
    upvote.textContent = active ? "▲ Upvoted" : "▲ Upvote";
    upvote.setAttribute("aria-pressed", active ? "true" : "false");
    upvote.setAttribute("aria-label", `${active ? "Remove upvote" : "Upvote"}: ${track.title} (${total} ${total === 1 ? "vote" : "votes"})`);
    card.setAttribute("data-voted", active ? "true" : "false");
  };
  paint(votes, voted);
  upvote.addEventListener("click", () => {
    const next = onVote?.(track);
    if (next) paint(next.votes, next.voted);
  });
  jump.addEventListener("click", () => onJump?.(track, card));
  voting.append(tally, upvote, jump);
  card.append(actions, voting);
  return card;
}
