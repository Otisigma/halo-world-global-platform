export const LISTING_TYPES = Object.freeze([
  { id: "full_track", label: "Full Track" },
  { id: "instrumental", label: "Instrumental" },
  { id: "stem_pack", label: "Stem Pack" },
  { id: "exclusive_license", label: "Exclusive License" },
  { id: "non_exclusive_license", label: "Non-Exclusive License" },
  { id: "custom_edit", label: "Custom Edit / Remix Pack" }
]);

export const ORBIT_TIERS = Object.freeze([
  { id: "core", label: "Core Studio Vault", description: "Your private creative center. Placement never grants file access." },
  { id: "inner", label: "Inner Crew", description: "Close collaborators and trusted creative partners." },
  { id: "peers", label: "Network Peers", description: "Creators to discover and connect with." },
  { id: "public", label: "Public Signal", description: "Open discovery across the HALO network." }
]);

// Illustrative discovery data only; never published inventory or membership records.
export const CREATOR_SEEDS = Object.freeze([
  {
    id: "dj-halo", displayName: "DJ Halo", verified: true,
    genres: ["House", "Afro House"], roles: ["DJ", "Producer"],
    bio: "Building artist-owned dance-floor stories and collaborative studio sessions.",
    location: "HALO Studio · sample scene", availability: "Open to collaboration",
    followers: 0, following: 0, tier: "core",
    featuredRelease: { title: "Golden Hour", description: "Illustrative release concept · preview coming soon" },
    featuredListings: ["halo-track", "halo-exclusive"]
  },
  {
    id: "dj-butterfly", displayName: "DJ Butterfly", verified: true,
    genres: ["Melodic House", "Electronica"], roles: ["DJ", "Remixer"],
    bio: "Airy melodies, deep grooves, and space for the next shared idea.",
    location: "Inner Crew · sample scene", availability: "Open to remixes",
    followers: 0, following: 0, tier: "inner",
    featuredRelease: { title: "Metamorphosis", description: "Illustrative release concept · preview coming soon" },
    featuredListings: ["butterfly-stems", "butterfly-edit"]
  },
  {
    id: "dj-romy", displayName: "DJ Romy", verified: true,
    genres: ["Deep House", "Soul"], roles: ["DJ", "Producer"],
    bio: "Warm textures and soulful rhythms for a connected creator community.",
    location: "Network Peers · sample scene", availability: "Open to studio sessions",
    followers: 0, following: 0, tier: "peers",
    featuredRelease: { title: "Afterglow", description: "Illustrative release concept · preview coming soon" },
    featuredListings: ["romy-instrumental", "romy-license"]
  }
]);

export function safeAssetUrl(value) {
  if (typeof value !== "string" || !value.trim() || /[\s\\\u0000-\u001f]/u.test(value)) return "";
  try {
    const url = new URL(value, "https://halo.invalid");
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (value.startsWith("/") && !value.startsWith("//")) {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return value.startsWith("https://") ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeListing(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A listing is required.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 180) throw new Error("Use a listing title between 1 and 180 characters.");
  if (!LISTING_TYPES.some(type => type.id === input.listingType)) throw new Error("Choose a supported listing type.");
  const price = typeof input.price === "number" ? input.price
    : typeof input.price === "string" && /^\d+(?:\.\d{1,2})?$/.test(input.price.trim()) ? Number(input.price) : NaN;
  if (!Number.isFinite(price) || price < 0 || price > 1000000 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) {
    throw new Error("Use a price from 0 to 1,000,000 with at most two decimal places.");
  }
  const currency = typeof input.currency === "string" ? input.currency.toUpperCase() : "USD";
  if (!["USD", "EUR", "GBP", "CAD", "AUD"].includes(currency)) throw new Error("Choose a supported currency.");
  const text = (key, max) => {
    if (input[key] == null) return "";
    if (typeof input[key] !== "string" || input[key].trim().length > max) throw new Error(`Invalid ${key}.`);
    return input[key].trim();
  };
  const assetPreviewUrl = text("assetPreviewUrl", 2048);
  if (assetPreviewUrl && !safeAssetUrl(assetPreviewUrl)) throw new Error("Use a public HTTPS or site-relative preview URL.");
  return {
    title, listingType: input.listingType, price, currency,
    description: text("description", 2000), licenseType: text("licenseType", 120),
    format: text("format", 80), assetPreviewUrl: safeAssetUrl(assetPreviewUrl),
    isFeatured: input.isFeatured === true,
    // Local proposals cannot authorize a sale, regardless of caller input.
    isForSale: false
  };
}

export function formatListingPrice(listing) {
  const price = listing?.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return "Price on request";
  const currency = ["USD", "EUR", "GBP", "CAD", "AUD"].includes(listing.currency) ? listing.currency : "USD";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);
}

export const LISTING_SEEDS = Object.freeze([
  { id: "halo-track", creatorId: "dj-halo", ...normalizeListing({
    title: "Golden Hour · Full Track", description: "Sample full-track package. No downloadable master or checkout is available.",
    listingType: "full_track", price: 12, currency: "USD", licenseType: "Personal listening · sample terms",
    format: "WAV / MP3", isFeatured: true
  }) },
  { id: "halo-exclusive", creatorId: "dj-halo", ...normalizeListing({
    title: "Golden Hour · Exclusive", description: "Illustrative exclusive licensing proposal. Rights require a separate signed agreement.",
    listingType: "exclusive_license", price: 500, currency: "USD", licenseType: "Exclusive · agreement required", format: "WAV"
  }) },
  { id: "butterfly-stems", creatorId: "dj-butterfly", ...normalizeListing({
    title: "Metamorphosis · Stem Pack", description: "A sample remix-ready stem package; files are not supplied.",
    listingType: "stem_pack", price: 35, currency: "USD", licenseType: "Remix use · sample terms", format: "WAV stems", isFeatured: true
  }) },
  { id: "butterfly-edit", creatorId: "dj-butterfly", ...normalizeListing({
    title: "Metamorphosis · Custom Edit", description: "Example custom edit brief. Confirm scope, credits, and rights before commissioning.",
    listingType: "custom_edit", price: 120, currency: "USD", licenseType: "Custom scope · agreement required", format: "WAV / project pack"
  }) },
  { id: "romy-instrumental", creatorId: "dj-romy", ...normalizeListing({
    title: "Afterglow · Instrumental", description: "Sample instrumental listing for vocal and collaboration discovery.",
    listingType: "instrumental", price: 20, currency: "USD", licenseType: "Personal listening · sample terms", format: "WAV / MP3"
  }) },
  { id: "romy-license", creatorId: "dj-romy", ...normalizeListing({
    title: "Afterglow · Non-Exclusive", description: "Illustrative non-exclusive licensing proposal. No license is granted by saving or requesting.",
    listingType: "non_exclusive_license", price: 60, currency: "USD", licenseType: "Non-exclusive · agreement required", format: "WAV", isFeatured: true
  }) }
]);
