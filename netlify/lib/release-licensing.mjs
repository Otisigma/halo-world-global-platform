const MAX_TIERS = 8;
const MAX_VERSIONS = 8;

export const LICENSE_TIER_CATALOG = Object.freeze({
  personal: {
    label: "Personal use",
    summary: "Private listening and personal collections. No commercial or broadcast use."
  },
  sync_standard: {
    label: "Sync standard",
    summary: "Online video, social, and independent film sync inside the agreed term and territory."
  },
  sync_broadcast: {
    label: "Sync broadcast",
    summary: "Broadcast, streaming platform, and advertising sync with wider clearance requirements."
  },
  exclusive: {
    label: "Exclusive",
    summary: "Exclusive transfer of the agreed usage. Always negotiated directly with the artist."
  }
});

export const LICENSING_REVIEW_NOTE =
  "Every licence stays rights-aware and approval-gated: HALO prepares the checklist, the artist approves the deal, and rights review clears ownership, samples, and splits before delivery.";

function cleanText(value, maxLength = 120) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function slugify(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseTierSource(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizePriceCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const cents = Math.round(Number(value));
  if (!Number.isFinite(cents) || cents < 0) return null;
  return cents;
}

function normalizeCurrency(value, fallback = "USD") {
  const code = cleanText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

export function normalizeLicensingTiers(source, { currency = "USD" } = {}) {
  const tiers = [];
  const seen = new Set();
  for (const entry of parseTierSource(source)) {
    const raw = typeof entry === "string" ? { id: entry } : entry;
    if (!raw || typeof raw !== "object") continue;
    const id = slugify(raw.id || raw.tier || raw.type || raw.label);
    if (!id || seen.has(id)) continue;
    const known = LICENSE_TIER_CATALOG[id.replace(/-/g, "_")] || null;
    const label = cleanText(raw.label || known?.label || id.replace(/-/g, " "), 80);
    if (!label) continue;
    seen.add(id);
    tiers.push({
      id,
      label,
      summary: cleanText(raw.summary || raw.description || known?.summary || "", 280),
      priceCents: normalizePriceCents(raw.priceCents ?? raw.price_cents),
      currency: normalizeCurrency(raw.currency, currency),
      requiresRightsReview: raw.requiresRightsReview === undefined && raw.requires_rights_review === undefined
        ? true
        : Boolean(raw.requiresRightsReview ?? raw.requires_rights_review)
    });
    if (tiers.length >= MAX_TIERS) break;
  }
  return tiers;
}

export function normalizeLicensingVersions(source) {
  const versions = [];
  const seen = new Set();
  const entries = Array.isArray(source) ? source : [];
  for (const entry of entries) {
    const raw = typeof entry === "string" ? { label: entry } : entry;
    if (!raw || typeof raw !== "object") continue;
    const label = cleanText(raw.label || raw.name || raw.versionType || raw.version_type, 80);
    if (!label) continue;
    const id = slugify(raw.id || raw.versionType || raw.version_type || label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    versions.push({ id, label });
    if (versions.length >= MAX_VERSIONS) break;
  }
  return versions;
}

export function resolveReleaseLicensing({
  licensingTiers = [],
  availableVersions = [],
  salePriceCents = null,
  currency = "USD",
  purchaseUrl = ""
} = {}) {
  const resolvedCurrency = normalizeCurrency(currency);
  const tiers = normalizeLicensingTiers(licensingTiers, { currency: resolvedCurrency }).map(tier => ({
    ...tier,
    priceCents: tier.priceCents === null ? normalizePriceCents(salePriceCents) : tier.priceCents
  }));
  const versions = normalizeLicensingVersions(availableVersions);
  return {
    enabled: tiers.length > 0,
    currency: resolvedCurrency,
    tiers,
    versions,
    reviewNote: LICENSING_REVIEW_NOTE,
    checkoutMode: cleanText(purchaseUrl, 1200) ? "external_purchase_link" : "artist_request"
  };
}
