import { getDatabase } from "@netlify/database";
import { verifyRequestOrigin } from "@netlify/identity";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json"
};

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { ...responseHeaders, ...extraHeaders } });
}

function validCheckoutUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

async function createStripeCheckout(request, mix, secretKey) {
  const requestUrl = new URL(request.url);
  const siteOrigin = requestUrl.origin;
  const body = new URLSearchParams({
    mode: "payment",
    client_reference_id: mix.id,
    success_url: `${siteOrigin}/mixes/?mix=${encodeURIComponent(mix.id)}&payment=success#editions`,
    cancel_url: `${siteOrigin}/mixes/?mix=${encodeURIComponent(mix.id)}&payment=cancelled#editions`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": String(mix.currency || "USD").toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(mix.price_minor),
    "line_items[0][price_data][product_data][name]": `${mix.title} — Mix Edition`,
    "line_items[0][price_data][product_data][description]": `${mix.original_artist} · Remix by ${mix.remixer_name}`,
    "metadata[mix_id]": mix.id,
    "metadata[production_route]": mix.production_route || "halo_mixed"
  });
  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const session = await stripeResponse.json().catch(() => ({}));
  const checkoutUrl = validCheckoutUrl(session.url);
  if (!stripeResponse.ok || !checkoutUrl) throw new Error("Stripe checkout session unavailable");
  return checkoutUrl.href;
}

export default async function paymentLinkHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }
  if (request.method === "POST") {
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin checkout requests are not accepted" }, 403);
    }
  }

  try {
    const requestUrl = new URL(request.url);
    const mixId = String(requestUrl.searchParams.get("mix") || "").trim();
    if (!mixId) return json({ message: "Choose a mix edition first." }, 400);

    const db = getDatabase();
    const rows = await db.sql`
      SELECT id, title, original_artist, remixer_name, sales_status, production_route, client_sale_enabled,
        price_minor, currency, product_info_complete, master_approved, rights_clearance_status
      FROM halo_mixes
      WHERE id = ${mixId} AND visibility = 'room'
      LIMIT 1
    `;
    const mix = rows[0];
    if (!mix || !mix.client_sale_enabled) return json({ message: "This mix is available to stream, but not offered for sale." }, 404);

    const readiness = {
      masterApproved: Boolean(mix.master_approved),
      productInfoComplete: Boolean(mix.product_info_complete),
      priceConfirmed: Number(mix.price_minor) >= 100,
      rightsConfirmed: mix.rights_clearance_status === "confirmed"
    };
    const missing = Object.entries(readiness).filter(([, ready]) => !ready).map(([item]) => item);
    if (mix.sales_status !== "ready" || missing.length) {
      return json({ message: "Checkout opens after the master, product information, price, and rights clearances are approved.", readiness, missing }, 409);
    }

    let checkoutUrl = "";
    const secretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
    if (secretKey) {
      checkoutUrl = await createStripeCheckout(request, mix, secretKey);
    } else {
      const routePaymentLink = mix.production_route === "self_mixed"
        ? process.env.STRIPE_CREATOR_MIX_PAYMENT_LINK_URL
        : process.env.STRIPE_HALO_MIX_PAYMENT_LINK_URL;
      const configuredUrl = validCheckoutUrl(routePaymentLink || process.env.STRIPE_PAYMENT_LINK_URL);
      const configuredPrice = Number.parseInt(
        mix.production_route === "self_mixed"
          ? process.env.STRIPE_CREATOR_MIX_PRICE_MINOR || process.env.STRIPE_PAYMENT_LINK_PRICE_MINOR
          : process.env.STRIPE_HALO_MIX_PRICE_MINOR || process.env.STRIPE_PAYMENT_LINK_PRICE_MINOR,
        10
      );
      if (!configuredUrl || configuredPrice !== Number(mix.price_minor)) {
        return json({ message: "Online payment needs its Stripe price aligned with this approved edition." }, 503);
      }
      configuredUrl.searchParams.set("client_reference_id", mix.id);
      checkoutUrl = configuredUrl.href;
    }

    return json({ checkoutUrl, priceMinor: Number(mix.price_minor), currency: mix.currency || "USD" });
  } catch (error) {
    console.error("HALO checkout failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Secure checkout could not be opened right now." }, 503);
  }
}

export const config = {
  path: "/api/payment-link"
};
