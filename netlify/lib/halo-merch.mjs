const HALO_MERCH_DISCLOSURE = Object.freeze({
  label: "Affiliate + fulfilment note",
  shortCopy: "HALO stays the storefront. Printful handles fulfilment behind the scenes where required.",
  detailCopy: "Merch is presented as HALO merchandise. Checkout and fulfilment run through Printful, and HALO may earn an affiliate commission on eligible orders. Pricing, shipping, and production timing should be confirmed before checkout completes."
});

const FALLBACK_MERCH_PRODUCTS = Object.freeze([
  {
    id: "merch-world-tee",
    slug: "halo-world-tee",
    featuredReleaseId: "when-the-world-goes-dark",
    featuredReleaseTitle: "When The World Goes Dark",
    artistName: "HALO",
    collectionLabel: "World signal capsule",
    title: "HALO World Tee",
    badge: "HALO merch",
    description: "Soft everyday tee anchored to the main HALO storefront so listeners can move from a release into a branded merch lane without leaving the platform voice.",
    heroImageUrl: "/assets/releases/when-the-world-goes-dark.jpg",
    priceMinor: 2800,
    currency: "GBP",
    providerName: "printful",
    providerProductId: "printful-halo-world-tee",
    affiliateCheckoutUrl: "https://www.printful.com/uk/custom/mens/t-shirts/unisex-staple-t-shirt?utm_source=halo&utm_medium=affiliate&utm_campaign=halo_music_merch",
    affiliateDisclosureRequired: true,
    fulfillmentRegions: ["United Kingdom", "Europe", "United States", "International"],
    fulfillmentNotes: "Made to order, routed through HALO, and fulfilled internationally by Printful after checkout.",
    disclosureCopy: HALO_MERCH_DISCLOSURE.detailCopy,
    status: "active",
    sortOrder: 1,
    variants: [
      { id: "merch-world-tee-black-m", variantLabel: "Black / M", color: "Black", size: "M", providerSku: "PF-HALO-WORLD-TEE-BLK-M", providerVariantId: "401", priceMinor: 2800, currency: "GBP", availabilityLabel: "UK + international", fulfillmentDaysMin: 2, fulfillmentDaysMax: 5, metadata: { material: "cotton", provider: "printful" }, status: "active" },
      { id: "merch-world-tee-black-xl", variantLabel: "Black / XL", color: "Black", size: "XL", providerSku: "PF-HALO-WORLD-TEE-BLK-XL", providerVariantId: "402", priceMinor: 2800, currency: "GBP", availabilityLabel: "UK + international", fulfillmentDaysMin: 2, fulfillmentDaysMax: 5, metadata: { material: "cotton", provider: "printful" }, status: "active" },
      { id: "merch-world-tee-bone-l", variantLabel: "Bone / L", color: "Bone", size: "L", providerSku: "PF-HALO-WORLD-TEE-BNE-L", providerVariantId: "403", priceMinor: 2800, currency: "GBP", availabilityLabel: "UK + international", fulfillmentDaysMin: 2, fulfillmentDaysMax: 5, metadata: { material: "cotton", provider: "printful" }, status: "active" }
    ]
  },
  {
    id: "merch-signal-poster",
    slug: "halo-signal-poster",
    featuredReleaseId: "my-sensitivity-like-a-crown",
    featuredReleaseTitle: "My Sensitivity Like a Crown",
    artistName: "HALO",
    collectionLabel: "Release wall set",
    title: "HALO Signal Poster",
    badge: "HALO merch",
    description: "A release-wall print route that keeps HALO product language public while the provider SKU and affiliate destination remain server-side.",
    heroImageUrl: "/assets/releases/my-sensitivity-like-a-crown.jpg",
    priceMinor: 2200,
    currency: "GBP",
    providerName: "printful",
    providerProductId: "printful-halo-signal-poster",
    affiliateCheckoutUrl: "https://www.printful.com/uk/custom/posters/posters?utm_source=halo&utm_medium=affiliate&utm_campaign=halo_music_merch",
    affiliateDisclosureRequired: true,
    fulfillmentRegions: ["United Kingdom", "Europe", "United States", "International"],
    fulfillmentNotes: "Poster production starts after order confirmation and ships through Printful's international network.",
    disclosureCopy: HALO_MERCH_DISCLOSURE.detailCopy,
    status: "active",
    sortOrder: 2,
    variants: [
      { id: "merch-signal-poster-a3", variantLabel: "A3 print", color: "Full colour", size: "A3", providerSku: "PF-HALO-SIGNAL-POSTER-A3", providerVariantId: "501", priceMinor: 2200, currency: "GBP", availabilityLabel: "Rolled poster", fulfillmentDaysMin: 2, fulfillmentDaysMax: 6, metadata: { paper: "matte", provider: "printful" }, status: "active" },
      { id: "merch-signal-poster-a2", variantLabel: "A2 print", color: "Full colour", size: "A2", providerSku: "PF-HALO-SIGNAL-POSTER-A2", providerVariantId: "502", priceMinor: 2600, currency: "GBP", availabilityLabel: "Rolled poster", fulfillmentDaysMin: 2, fulfillmentDaysMax: 6, metadata: { paper: "matte", provider: "printful" }, status: "active" }
    ]
  },
  {
    id: "merch-session-tote",
    slug: "halo-session-tote",
    featuredReleaseId: "blessed",
    featuredReleaseTitle: "Blessed",
    artistName: "HALO",
    collectionLabel: "Carry the signal",
    title: "HALO Session Tote",
    badge: "HALO merch",
    description: "A lightweight carry item for music, notebooks, and cables, positioned inside the HALO shop as merch rather than a separate partner-branded storefront.",
    heroImageUrl: "/assets/releases/blessed.jpg",
    priceMinor: 2600,
    currency: "GBP",
    providerName: "printful",
    providerProductId: "printful-halo-session-tote",
    affiliateCheckoutUrl: "https://www.printful.com/uk/custom/bags/tote-bags/eco-tote-bag?utm_source=halo&utm_medium=affiliate&utm_campaign=halo_music_merch",
    affiliateDisclosureRequired: true,
    fulfillmentRegions: ["United Kingdom", "Europe", "United States", "International"],
    fulfillmentNotes: "Print-on-demand tote fulfilled by Printful with international delivery coverage.",
    disclosureCopy: HALO_MERCH_DISCLOSURE.detailCopy,
    status: "active",
    sortOrder: 3,
    variants: [
      { id: "merch-session-tote-black", variantLabel: "Black", color: "Black", size: "One size", providerSku: "PF-HALO-SESSION-TOTE-BLK", providerVariantId: "601", priceMinor: 2600, currency: "GBP", availabilityLabel: "Everyday carry", fulfillmentDaysMin: 2, fulfillmentDaysMax: 5, metadata: { material: "organic_cotton", provider: "printful" }, status: "active" },
      { id: "merch-session-tote-natural", variantLabel: "Natural", color: "Natural", size: "One size", providerSku: "PF-HALO-SESSION-TOTE-NAT", providerVariantId: "602", priceMinor: 2600, currency: "GBP", availabilityLabel: "Everyday carry", fulfillmentDaysMin: 2, fulfillmentDaysMax: 5, metadata: { material: "organic_cotton", provider: "printful" }, status: "active" }
    ]
  }
]);

function publicAsset(value, fallback = "/assets/halo-app-icon-512.png") {
  const candidate = String(value || "").trim();
  if (!candidate) return fallback;
  if (candidate.startsWith("/")) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRegions(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || "").trim()).filter(Boolean);
}

function sanitizeRedirectUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function checkoutPathFor(slug) {
  return `/api/halo-merch?slug=${encodeURIComponent(slug)}&intent=checkout`;
}

function dispatchWindowFor(variants) {
  if (!variants.length) return "2–5 working days";
  const minimum = Math.min(...variants.map(variant => Number(variant.fulfillmentDaysMin || 0)));
  const maximum = Math.max(...variants.map(variant => Number(variant.fulfillmentDaysMax || 0)));
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return "2–5 working days";
  return minimum === maximum ? `${minimum} working days` : `${minimum}–${maximum} working days`;
}

function normalizeVariants(variants = []) {
  return variants
    .filter(variant => String(variant.status || "active") === "active")
    .sort((left, right) => String(left.variantLabel || "").localeCompare(String(right.variantLabel || "")))
    .map(variant => ({
      id: variant.id,
      label: variant.variantLabel,
      color: variant.color,
      size: variant.size,
      availabilityLabel: variant.availabilityLabel,
      priceMinor: Number(variant.priceMinor || 0),
      currency: String(variant.currency || "GBP").toUpperCase(),
      dispatchWindow: dispatchWindowFor([variant])
    }));
}

function cloneFallbackProduct(product) {
  return {
    ...product,
    fulfillmentRegions: [...product.fulfillmentRegions],
    variants: product.variants.map(variant => ({ ...variant, metadata: { ...(variant.metadata || {}) } }))
  };
}

function groupMerchRows(rows) {
  const products = new Map();
  for (const row of rows) {
    if (!products.has(row.product_id)) {
      products.set(row.product_id, {
        id: row.product_id,
        slug: row.slug,
        featuredReleaseId: row.featured_release_id || "",
        featuredReleaseTitle: row.featured_release_title || "",
        artistName: row.artist_name || "HALO",
        collectionLabel: row.collection_label || "",
        title: row.title || "",
        badge: row.badge || "HALO merch",
        description: row.description || "",
        heroImageUrl: row.hero_image_url || "",
        priceMinor: Number(row.price_minor || 0),
        currency: String(row.currency || "GBP").toUpperCase(),
        providerName: row.provider_name || "printful",
        providerProductId: row.provider_product_id || "",
        affiliateCheckoutUrl: row.affiliate_checkout_url || "",
        affiliateDisclosureRequired: row.affiliate_disclosure_required !== false,
        fulfillmentRegions: normalizeRegions(row.fulfillment_regions),
        fulfillmentNotes: row.fulfillment_notes || "",
        disclosureCopy: row.disclosure_copy || HALO_MERCH_DISCLOSURE.detailCopy,
        status: row.product_status || "active",
        sortOrder: Number(row.sort_order || 0),
        variants: []
      });
    }
    if (row.variant_id) {
      products.get(row.product_id).variants.push({
        id: row.variant_id,
        variantLabel: row.variant_label,
        color: row.color || "",
        size: row.size || "",
        providerSku: row.provider_sku || "",
        providerVariantId: row.provider_variant_id || "",
        priceMinor: Number(row.variant_price_minor || row.price_minor || 0),
        currency: String(row.variant_currency || row.currency || "GBP").toUpperCase(),
        availabilityLabel: row.availability_label || "Available",
        fulfillmentDaysMin: Number(row.fulfillment_days_min || 0),
        fulfillmentDaysMax: Number(row.fulfillment_days_max || 0),
        metadata: row.metadata || {},
        status: row.variant_status || "active"
      });
    }
  }
  return [...products.values()].sort((left, right) => (
    left.sortOrder - right.sortOrder
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id)
  ));
}

export function serializePublicMerchProduct(product) {
  const variants = normalizeVariants(product.variants);
  const startingPriceMinor = variants.length
    ? Math.min(...variants.map(variant => Number(variant.priceMinor || 0)))
    : Number(product.priceMinor || 0);
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    artistName: product.artistName || "HALO",
    collectionLabel: product.collectionLabel || "HALO merch",
    badge: product.badge || "HALO merch",
    description: product.description || "",
    imageUrl: publicAsset(product.heroImageUrl),
    startingPriceMinor,
    currency: String(product.currency || variants[0]?.currency || "GBP").toUpperCase(),
    associatedReleaseId: product.featuredReleaseId || "",
    associatedReleaseTitle: product.featuredReleaseTitle || "",
    purchasePath: checkoutPathFor(product.slug),
    commerceState: "routing_preview",
    variants,
    fulfillment: {
      regions: normalizeRegions(product.fulfillmentRegions),
      dispatchWindow: dispatchWindowFor(product.variants || []),
      note: product.fulfillmentNotes || "Made to order and fulfilled by Printful after checkout.",
      providerLabel: "Printful fulfilment"
    },
    disclosure: {
      required: Boolean(product.affiliateDisclosureRequired),
      copy: String(product.disclosureCopy || HALO_MERCH_DISCLOSURE.detailCopy)
    }
  };
}

export function buildHaloMerchResponse(products) {
  const publicProducts = products.map(serializePublicMerchProduct);
  return {
    count: publicProducts.length,
    products: publicProducts,
    disclosure: HALO_MERCH_DISCLOSURE,
    note: "HALO keeps the storefront voice public while Printful routing, provider SKUs, and affiliate destinations stay behind the API."
  };
}

export function findHaloMerchProduct(products, slug) {
  const target = String(slug || "").trim().toLowerCase();
  return products.find(product => String(product.slug || "").trim().toLowerCase() === target) || null;
}

export function haloMerchRedirectUrl(product) {
  return sanitizeRedirectUrl(product?.affiliateCheckoutUrl);
}

export async function loadHaloMerchCatalog(db) {
  if (!db?.sql) return FALLBACK_MERCH_PRODUCTS.map(cloneFallbackProduct);
  try {
    const rows = await db.sql`
      SELECT
        product.id AS product_id,
        product.slug,
        product.featured_release_id,
        product.featured_release_title,
        product.artist_name,
        product.collection_label,
        product.title,
        product.badge,
        product.description,
        product.hero_image_url,
        product.price_minor,
        product.currency,
        product.provider_name,
        product.provider_product_id,
        product.affiliate_checkout_url,
        product.affiliate_disclosure_required,
        product.fulfillment_regions,
        product.fulfillment_notes,
        product.disclosure_copy,
        product.status AS product_status,
        product.sort_order,
        variant.id AS variant_id,
        variant.variant_label,
        variant.color,
        variant.size,
        variant.provider_sku,
        variant.provider_variant_id,
        variant.price_minor AS variant_price_minor,
        variant.currency AS variant_currency,
        variant.availability_label,
        variant.fulfillment_days_min,
        variant.fulfillment_days_max,
        variant.metadata,
        variant.status AS variant_status
      FROM halo_merch_products product
      LEFT JOIN halo_merch_variants variant
        ON variant.product_id = product.id
        AND variant.status = 'active'
      WHERE product.status = 'active'
      ORDER BY product.sort_order, product.title, variant.variant_label
    `;
    if (!rows.length) return FALLBACK_MERCH_PRODUCTS.map(cloneFallbackProduct);
    return groupMerchRows(rows);
  } catch {
    return FALLBACK_MERCH_PRODUCTS.map(cloneFallbackProduct);
  }
}
