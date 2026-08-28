import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { resolveReleaseArtworkFields } from "../lib/release-artwork.mjs";

const MAX_BODY_BYTES = 16_384;
const sourceKinds = new Set(["profile", "release", "activity", "video", "campaign", "topic"]);
const statuses = new Set(["draft", "ready", "retired"]);
const signals = new Set(["saved", "reused", "worked", "needs_change"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanSlug(value) {
  const slug = cleanText(value, 80).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

function cleanUuid(value) {
  const id = cleanText(value, 48);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
}

function serializeSnippet(row) {
  return {
    id: row.id,
    artistSlug: row.artist_slug,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    title: row.title,
    body: row.body,
    hook: row.hook,
    topic: row.topic,
    assetUrl: row.asset_url,
    status: row.status,
    useCount: Number(row.use_count || 0),
    feedback: row.feedback || {},
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function accessibleArtists(db, user, memberId) {
  return db.sql`
    SELECT slug, artist_name, tagline, bio, artwork_url, release_title, release_date, release_url, updated_at
    FROM halo_artist_pages
    WHERE owner_member_id = ${memberId} OR ${isOwner(user)}
    ORDER BY updated_at DESC
  `;
}

async function requireArtist(db, user, membership, artistSlug) {
  const rows = await db.sql`
    SELECT slug, artist_name, tagline, bio, artwork_url, release_title, release_date, release_url, updated_at
    FROM halo_artist_pages
    WHERE slug = ${artistSlug} AND (owner_member_id = ${membership.member_id} OR ${isOwner(user)})
    LIMIT 1
  `;
  return rows[0] || null;
}

async function loadMaterials(db, artist, membership) {
  const [releaseRows, activityRows, videoRows, campaignRows] = await Promise.all([
    db.sql`
      SELECT id, title, artist, release_date, artwork_url, imported_artwork_url, artwork_override_url, official_url, pitch, press_description, updated_at
      FROM halo_release_campaigns
      WHERE owner_member_id = ${membership.member_id} OR LOWER(artist) = LOWER(${artist.artist_name})
      ORDER BY COALESCE(release_date, created_at::date) DESC, updated_at DESC
      LIMIT 24
    `,
    db.sql`
      SELECT id, kind, title, description, url, starts_at, created_at, updated_at
      FROM halo_artist_activity
      WHERE artist_slug = ${artist.slug}
      ORDER BY COALESCE(starts_at, created_at) DESC
      LIMIT 24
    `,
    db.sql`
      SELECT id, title, description, source_url, thumbnail_url, created_at, updated_at
      FROM halo_videos
      WHERE artist_slug = ${artist.slug} OR owner_member_id = ${membership.member_id}
      ORDER BY created_at DESC
      LIMIT 24
    `,
    db.sql`
      SELECT id, title, package, recommendations, performance_score, destination_url, created_at, updated_at
      FROM halo_dreamweaver_campaigns
      WHERE member_id = ${membership.member_id} AND LOWER(artist_name) = LOWER(${artist.artist_name})
      ORDER BY updated_at DESC
      LIMIT 16
    `
  ]);

  const materials = [{
    id: artist.slug,
    kind: "profile",
    title: artist.artist_name,
    summary: artist.bio || artist.tagline || "Artist identity and current story.",
    detail: artist.tagline || "Artist profile",
    assetUrl: artist.artwork_url || "",
    sourceUrl: "",
    date: artist.updated_at
  }];

  releaseRows.forEach(row => {
    const artwork = resolveReleaseArtworkFields({
      artworkUrl: row.artwork_url,
      importedArtworkUrl: row.imported_artwork_url,
      artworkOverrideUrl: row.artwork_override_url
    });
    materials.push({
    id: row.id,
    kind: "release",
    title: row.title,
    summary: row.pitch || row.press_description || `A release by ${row.artist}.`,
    detail: row.release_date ? `Released ${new Date(row.release_date).toLocaleDateString("en-GB", { dateStyle: "medium" })}` : "Release archive",
    assetUrl: artwork.artwork,
    sourceUrl: row.official_url || "",
    date: row.release_date || row.updated_at
    });
  });
  activityRows.forEach(row => materials.push({
    id: String(row.id),
    kind: "activity",
    title: row.title,
    summary: row.description || "A moment from the artist timeline.",
    detail: row.kind,
    assetUrl: "",
    sourceUrl: row.url || "",
    date: row.starts_at || row.created_at
  }));
  videoRows.forEach(row => materials.push({
    id: row.id,
    kind: "video",
    title: row.title,
    summary: row.description || "Artist-controlled video material.",
    detail: "Video archive",
    assetUrl: row.thumbnail_url || "",
    sourceUrl: row.source_url || "",
    date: row.created_at
  }));
  campaignRows.forEach(row => materials.push({
    id: row.id,
    kind: "campaign",
    title: row.title,
    summary: row.package?.coreIdea || row.recommendations?.summary || "A previous Dreamweaver campaign package.",
    detail: row.performance_score ? `Momentum ${Number(row.performance_score)} / 100` : "Dreamweaver campaign",
    assetUrl: "",
    sourceUrl: row.destination_url || "",
    date: row.updated_at
  }));

  return materials.sort((first, second) => new Date(second.date || 0) - new Date(first.date || 0));
}

async function loadWorkspace(db, user, requestedSlug) {
  const membership = await ensureMembership(db, user);
  const artists = await accessibleArtists(db, user, membership.member_id);
  if (!artists.length) return { membership, artists: [], artist: null, materials: [], snippets: [] };
  const artist = artists.find(row => row.slug === requestedSlug) || artists[0];
  const [materials, snippetRows] = await Promise.all([
    loadMaterials(db, artist, membership),
    db.sql`
      SELECT snippet.*,
        COALESCE((
          SELECT jsonb_object_agg(signal, total)
          FROM (
            SELECT signal, COUNT(*)::int AS total
            FROM halo_social_snippet_feedback feedback
            WHERE feedback.snippet_id = snippet.id
            GROUP BY signal
          ) counts
        ), '{}'::jsonb) AS feedback
      FROM halo_social_snippets snippet
      WHERE snippet.artist_slug = ${artist.slug} AND snippet.owner_member_id = ${membership.member_id}
      ORDER BY (snippet.status = 'ready') DESC, snippet.updated_at DESC
      LIMIT 80
    `
  ]);
  return {
    membership,
    artists: artists.map(row => ({ slug: row.slug, artistName: row.artist_name })),
    artist: {
      slug: artist.slug,
      artistName: artist.artist_name,
      tagline: artist.tagline,
      artworkUrl: artist.artwork_url,
      releaseTitle: artist.release_title
    },
    materials,
    snippets: snippetRows.map(serializeSnippet)
  };
}

async function parseBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new Error("Request is too large");
  return request.json();
}

export default async function iamSocialHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to open I AM Social" }, 401);
    const url = new URL(request.url);
    if (request.method === "GET") {
      const workspace = await loadWorkspace(db, user, cleanSlug(url.searchParams.get("artist")));
      return json(workspace);
    }
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin social updates are not accepted" }, 403);
    }
    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      return json({ message: error.message || "Request body must be valid JSON" }, 400);
    }
    const membership = await ensureMembership(db, user);
    const artistSlug = cleanSlug(body.artistSlug);
    const artist = await requireArtist(db, user, membership, artistSlug);
    if (!artist) return json({ message: "Choose an artist workspace you manage" }, 404);

    if (body.action === "create") {
      const sourceKind = sourceKinds.has(body.sourceKind) ? body.sourceKind : "topic";
      const title = cleanText(body.title, 160);
      const snippetBody = cleanText(body.body, 2400);
      if (!title || !snippetBody) return json({ message: "Add a title and reusable snippet" }, 400);
      const id = randomUUID();
      await db.sql`
        INSERT INTO halo_social_snippets (
          id, artist_slug, owner_member_id, source_kind, source_id, title, body, hook, topic, asset_url, status
        ) VALUES (
          ${id}, ${artist.slug}, ${membership.member_id}, ${sourceKind}, ${cleanText(body.sourceId, 120)},
          ${title}, ${snippetBody}, ${cleanText(body.hook, 240)}, ${cleanText(body.topic, 100)},
          ${cleanText(body.assetUrl, 1200)}, ${statuses.has(body.status) ? body.status : "ready"}
        )
      `;
    } else if (body.action === "update") {
      const snippetId = cleanUuid(body.snippetId);
      const title = cleanText(body.title, 160);
      const snippetBody = cleanText(body.body, 2400);
      if (!snippetId || !title || !snippetBody) return json({ message: "Add a valid snippet, title, and copy" }, 400);
      await db.sql`
        UPDATE halo_social_snippets SET
          title = ${title}, body = ${snippetBody}, hook = ${cleanText(body.hook, 240)},
          topic = ${cleanText(body.topic, 100)}, status = ${statuses.has(body.status) ? body.status : "ready"}, updated_at = NOW()
        WHERE id = ${snippetId} AND artist_slug = ${artist.slug} AND owner_member_id = ${membership.member_id}
      `;
    } else if (body.action === "feedback") {
      const snippetId = cleanUuid(body.snippetId);
      const signal = signals.has(body.signal) ? body.signal : "";
      if (!snippetId || !signal) return json({ message: "Choose a valid snippet and feedback signal" }, 400);
      const ownedRows = await db.sql`
        SELECT id FROM halo_social_snippets
        WHERE id = ${snippetId} AND artist_slug = ${artist.slug} AND owner_member_id = ${membership.member_id}
        LIMIT 1
      `;
      if (!ownedRows.length) return json({ message: "Snippet not found" }, 404);
      await db.sql`
        INSERT INTO halo_social_snippet_feedback (snippet_id, member_id, signal, note)
        VALUES (${snippetId}, ${membership.member_id}, ${signal}, ${cleanText(body.note, 800)})
      `;
      if (["reused", "worked"].includes(signal)) {
        await db.sql`
          UPDATE halo_social_snippets
          SET use_count = use_count + 1, last_used_at = NOW(), updated_at = NOW()
          WHERE id = ${snippetId}
        `;
      }
    } else {
      return json({ message: "Unknown I AM Social action" }, 400);
    }

    return json(await loadWorkspace(db, user, artist.slug));
  } catch (error) {
    console.error("I AM Social request failed", error);
    return json({ message: "I AM Social could not complete that request" }, 500);
  }
}

export const config = { path: "/api/iam-social" };
