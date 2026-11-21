import { getUser } from "@netlify/identity";
import { ensureMembership } from "./halo-x.mjs";
import { artistMatches, serialiseStorefrontSong } from "./artist-storefront.mjs";

// Database access shared by the Artist Shop storefront and the AI artist persona endpoints.

export async function loadStorefrontPage(db, slug) {
  const rows = await db.sql`SELECT * FROM halo_artist_pages WHERE slug = ${slug} LIMIT 1`;
  return rows[0] || null;
}

/** Songs from the artist page owner's Song Catalog credited to this artist (collaborations included). */
export async function loadStorefrontSongs(db, page, { withLyrics = false } = {}) {
  if (!page?.owner_member_id) return [];
  const rows = await db.sql`
    SELECT id, title, artist_name, album_title, genre, artwork_url, sale_status, sale_price_cents, currency, lyrics_text
    FROM halo_song_catalog
    WHERE owner_member_id = ${page.owner_member_id} AND status = 'active'
      AND LOWER(COALESCE(rights_status, '')) <> 'disputed'
    ORDER BY updated_at DESC
    LIMIT 400
  `;
  return rows
    .filter(row => artistMatches(page.artist_name, row.artist_name))
    .map(row => withLyrics ? { ...serialiseStorefrontSong(row), lyrics: String(row.lyrics_text || "") } : serialiseStorefrontSong(row));
}

export async function canViewStorefront(db, page) {
  if (page && page.status === "published" && page.owner_member_id) return true;
  if (!page) return false;
  const user = await getUser();
  if (!user?.id) return false;
  const membership = await ensureMembership(db, user);
  return membership?.member_id === page.owner_member_id;
}

