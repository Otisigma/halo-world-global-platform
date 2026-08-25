import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { createHash } from "node:crypto";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function actorIdFor(userId) {
  return `member-${createHash("sha256").update(String(userId)).digest("hex").slice(0, 32)}`;
}

function serializeCreator(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.display_name,
    city: row.city,
    countryCode: row.country_code,
    disciplines: row.disciplines || [],
    statement: row.statement,
    bio: row.bio,
    accent: row.accent,
    featured: row.is_featured,
    demo: row.is_demo
  };
}

function serializeProduct(row, savedProductIds) {
  return {
    id: Number(row.id),
    creatorId: Number(row.creator_id),
    creatorSlug: row.creator_slug,
    creatorName: row.creator_name,
    slug: row.slug,
    title: row.title,
    type: row.product_type,
    description: row.description,
    priceMinor: Number(row.price_minor),
    currency: row.currency,
    format: row.format_label,
    edition: row.edition_label,
    featured: row.is_featured,
    saved: savedProductIds.has(Number(row.id))
  };
}

async function loadCatalog(db, user) {
  const actorId = user?.id ? actorIdFor(user.id) : null;
  const [creatorRows, productRows, savedRows, foundingRows] = await Promise.all([
    db.sql`
      SELECT id, slug, display_name, city, country_code, disciplines, statement, bio, accent,
        is_featured, is_demo
      FROM marketplace_creators
      WHERE status = 'published'
      ORDER BY is_featured DESC, sort_order, display_name
    `,
    db.sql`
      SELECT p.id, p.creator_id, c.slug AS creator_slug, c.display_name AS creator_name,
        p.slug, p.title, p.product_type, p.description, p.price_minor, p.currency,
        p.format_label, p.edition_label, p.is_featured
      FROM marketplace_products p
      JOIN marketplace_creators c ON c.id = p.creator_id
      WHERE p.status = 'published' AND c.status = 'published'
      ORDER BY p.is_featured DESC, p.sort_order, p.title
    `,
    actorId
      ? db.sql`SELECT product_id FROM marketplace_interests WHERE actor_id = ${actorId} AND interest_type = 'saved_drop'`
      : Promise.resolve([]),
    actorId
      ? db.sql`SELECT id FROM marketplace_interests WHERE actor_id = ${actorId} AND interest_type = 'founding_creator' LIMIT 1`
      : Promise.resolve([])
  ]);
  const savedProductIds = new Set(savedRows.map(row => Number(row.product_id)));

  return {
    authenticated: Boolean(user),
    viewer: user ? { name: user.name || user.userMetadata?.full_name || "HALO member" } : null,
    foundingCreatorInterest: foundingRows.length > 0,
    creators: creatorRows.map(serializeCreator),
    products: productRows.map(row => serializeProduct(row, savedProductIds)),
    launch: {
      region: "United Kingdom + Ireland",
      access: "Founding edition · Invite-led",
      note: "Preview catalog — products shown are concept listings until launch creators are approved."
    }
  };
}

async function handlePost(request, db, user) {
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin marketplace actions are not accepted" }, 403);
  }
  if (!user?.id) return json({ message: "Join or sign in to continue" }, 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  const actorId = actorIdFor(user.id);
  if (payload.action === "founding_creator") {
    const enabled = payload.enabled !== false;
    if (enabled) {
      await db.sql`
        INSERT INTO marketplace_interests (actor_id, interest_type)
        VALUES (${actorId}, 'founding_creator')
        ON CONFLICT DO NOTHING
      `;
    } else {
      await db.sql`
        DELETE FROM marketplace_interests
        WHERE actor_id = ${actorId} AND interest_type = 'founding_creator'
      `;
    }
    return json({ foundingCreatorInterest: enabled });
  }

  if (payload.action === "saved_drop") {
    const productId = Number(payload.productId);
    if (!Number.isSafeInteger(productId) || productId < 1) return json({ message: "Choose a valid drop" }, 400);
    const productRows = await db.sql`
      SELECT p.id
      FROM marketplace_products p
      JOIN marketplace_creators c ON c.id = p.creator_id
      WHERE p.id = ${productId} AND p.status = 'published' AND c.status = 'published'
      LIMIT 1
    `;
    if (!productRows.length) return json({ message: "This drop is not available" }, 404);

    const enabled = payload.enabled !== false;
    if (enabled) {
      await db.sql`
        INSERT INTO marketplace_interests (actor_id, product_id, interest_type)
        VALUES (${actorId}, ${productId}, 'saved_drop')
        ON CONFLICT DO NOTHING
      `;
    } else {
      await db.sql`
        DELETE FROM marketplace_interests
        WHERE actor_id = ${actorId} AND product_id = ${productId} AND interest_type = 'saved_drop'
      `;
    }
    return json({ productId, saved: enabled });
  }

  return json({ message: "Unknown marketplace action" }, 400);
}

export default async function creatorMarketplaceHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405);
  }

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (request.method === "POST") return handlePost(request, db, user);
    return json(await loadCatalog(db, user));
  } catch (error) {
    console.error("Creator marketplace request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The founding catalog is temporarily unavailable" }, 500);
  }
}

export const config = {
  path: "/api/creator-marketplace"
};
