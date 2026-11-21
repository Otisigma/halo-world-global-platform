// Shared helpers for dynamic Artist Shop storefronts.
// A storefront is one published HALO artist page (halo_artist_pages) plus the songs in the
// HALO Song Catalog that are credited to that artist. Collaborations count: a song by
// "Owen Anthony & Anna Jayne" belongs on both Owen Anthony's and Anna Jayne's storefronts.

const CREDIT_SPLIT = /\s*(?:&|,|\+|\/|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b)\s*/i;

export function artistKey(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/** Every individual artist credited in a display string like "Owen Anthony & Anna Jayne". */
export function creditedArtists(name) {
  const full = artistKey(name);
  if (!full) return [];
  const parts = full.split(CREDIT_SPLIT).map(part => part.trim()).filter(Boolean);
  return [...new Set([full, ...parts])];
}

/** True when a song credited to `trackArtist` belongs on the storefront for `pageArtist`. */
export function artistMatches(pageArtist, trackArtist) {
  const page = artistKey(pageArtist);
  if (!page) return false;
  return creditedArtists(trackArtist).includes(page);
}

export function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

/** Fallback role when the artist hasn't written one: derived from the genres they release in. */
export function deriveRole(page, songs = []) {
  const written = String(page?.role || "").trim();
  if (written) return written;
  const counts = new Map();
  songs.forEach(song => {
    const genre = String(song.genre || "").trim();
    if (genre) counts.set(genre, (counts.get(genre) || 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([genre]) => genre);
  return top.length ? `${top.join(" / ")} artist` : "HALO artist";
}

export function serialiseStorefrontSong(row) {
  return {
    id: String(row.id),
    title: row.title || "Untitled",
    artist: row.artist_name || "",
    album: row.album_title || "",
    genre: row.genre || "",
    artwork: safeUrl(row.artwork_url),
    saleStatus: String(row.sale_status || "").toLowerCase(),
    priceMinor: Number.isFinite(Number(row.sale_price_cents)) ? Number(row.sale_price_cents) : 0,
    currency: /^[A-Z]{3}$/.test(String(row.currency || "")) ? row.currency : "USD",
    hasLyrics: Boolean(String(row.lyrics_text || "").trim())
  };
}

export function serialiseStorefrontProfile(page, songs, persona) {
  return {
    slug: page.slug,
    name: page.artist_name,
    role: deriveRole(page, songs),
    bio: String(page.bio || "").trim() || String(page.tagline || "").trim() || `${page.artist_name} releases music direct to fans through HALO.`,
    tagline: page.tagline || "",
    location: page.location || "",
    accent: /^#[0-9a-fA-F]{6}$/.test(String(page.accent_color || "")) ? page.accent_color : "#d5ff52",
    artwork: safeUrl(page.artwork_url),
    currentRelease: page.release_title
      ? { title: page.release_title, date: page.release_date ? new Date(page.release_date).toISOString().slice(0, 10) : "", url: safeUrl(page.release_url) }
      : null,
    roomUrl: `/artists/${encodeURIComponent(page.slug)}`,
    persona: persona ? { key: persona.key, name: persona.displayName, greeting: persona.greeting, disclosure: persona.disclosure, starters: persona.starters } : null
  };
}
