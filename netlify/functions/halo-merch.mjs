import { getDatabase } from "@netlify/database";
import {
  buildHaloMerchResponse,
  findHaloMerchProduct,
  haloMerchRedirectUrl,
  loadHaloMerchCatalog,
  serializePublicMerchProduct
} from "../lib/halo-merch.mjs";

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      ...headers
    }
  });
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    }
  });
}

export default async function haloMerchHandler(request) {
  if (request.method !== "GET") {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET" });
  }

  try {
    const url = new URL(request.url);
    const products = await loadHaloMerchCatalog(getDatabase());
    const slug = String(url.searchParams.get("slug") || "").trim();
    const intent = String(url.searchParams.get("intent") || "").trim().toLowerCase();

    if (slug) {
      const product = findHaloMerchProduct(products, slug);
      if (!product) return json({ message: "That HALO merch route was not found" }, 404, { "Cache-Control": "no-store" });
      if (intent === "checkout") {
        const redirectUrl = haloMerchRedirectUrl(product);
        if (!redirectUrl) return json({ message: "This HALO merch route is still being prepared" }, 409, { "Cache-Control": "no-store" });
        return redirect(redirectUrl);
      }
      return json({ product: serializePublicMerchProduct(product), disclosure: buildHaloMerchResponse([product]).disclosure });
    }

    return json(buildHaloMerchResponse(products));
  } catch (error) {
    console.error("HALO merch catalog failed", error instanceof Error ? error.message : "unknown error");
    return json(
      { message: "The HALO merch studio is temporarily unavailable" },
      500,
      { "Cache-Control": "no-store" }
    );
  }
}

export const config = { path: "/api/halo-merch" };
