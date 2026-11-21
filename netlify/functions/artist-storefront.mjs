import { getDatabase } from "@netlify/database";
import { serialiseStorefrontProfile } from "../lib/artist-storefront.mjs";
import { canViewStorefront, loadStorefrontPage, loadStorefrontSongs } from "../lib/artist-storefront-data.mjs";
import { personaFor } from "../lib/artist-personas.mjs";

// Dynamic Artist Shop storefront: GET /api/artist-storefront?artist=<slug>
// Returns the artist's profile card (name, role, bio, accent, artwork), the IDs of their songs in
// the HALO Song Catalog (so the release feed, drops and library can scope to this artist), the
// AI persona available on this storefront (if any), and the other published storefronts.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function otherStorefronts(db, slug) {
  const rows = await db.sql`
    SELECT slug, artist_name, role, location, accent_color
    FROM halo_artist_pages
    WHERE status = 'published' AND owner_member_id IS NOT NULL AND slug <> ${slug}
    ORDER BY artist_name
    LIMIT 24
  `;
  return rows.map(row => ({ slug: row.slug, name: row.artist_name, role: row.role || "", location: row.location || "", accent: row.accent_color || "#d5ff52" }));
}

export default async function artistStorefront(request) {
  if (request.method !== "GET") return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const slug = String(new URL(request.url).searchParams.get("artist") || "").trim().toLowerCase().slice(0, 80);
    if (!slug) return json({ artist: null, songIds: [], storefronts: await otherStorefronts(db, "") });
    if (!SLUG.test(slug)) return json({ message: "Artist storefront not found" }, 404);
    const page = await loadStorefrontPage(db, slug);
    if (!(await canViewStorefront(db, page))) return json({ message: "Artist storefront not found" }, 404);
    const [songs, storefronts] = await Promise.all([loadStorefrontSongs(db, page), otherStorefronts(db, slug)]);
    return json({
      artist: serialiseStorefrontProfile(page, songs, personaFor(page)),
      songIds: songs.map(song => song.id),
      songs,
      storefronts
    });
  } catch (error) {
    console.error("Artist storefront request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The artist storefront could not be loaded right now" }, 500);
  }
}

export const config = { path: "/api/artist-storefront" };
