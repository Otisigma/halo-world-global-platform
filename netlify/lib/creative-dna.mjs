import { createHash } from "node:crypto";
import { DNA_TERMS, DNA_LIMITS, defaultCreativeDna } from "../../lib/creative-dna.js";
import { curatedCreators } from "../../lib/creator-directory.js";
import { publicLink } from "./signal-feed.mjs";

export class DnaError extends Error {
  constructor(message, status = 400, fieldErrors = null) {
    super(message); this.status = status; this.fieldErrors = fieldErrors;
  }
}
const invalidField = (field, message) => new DnaError(message, 400, field ? { [field]: message } : null);
const canonical = value => value.normalize("NFKC").trim().toLowerCase();
const termsByInput = new Map(DNA_TERMS.flatMap(term =>
  [term.key, term.label, ...term.aliases].map(value => [`${term.dimension}:${canonical(value)}`, term.id])
    .concat([[term.id, term.id]])
));

function text(value, max, field = null) {
  if (value == null) return "";
  if (typeof value !== "string") throw invalidField(field, "Invalid text field");
  const normalized = value.normalize("NFC").trim();
  if ([...normalized].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw invalidField(field, `Use up to ${max} characters without control characters`);
  }
  return normalized;
}
export function canonicalTermIds(values, max = DNA_LIMITS.totalTerms) {
  if (!Array.isArray(values) || values.length > max) throw invalidField("termIds", `Use up to ${max} terms`);
  const ids = values.map(value => {
    if (typeof value !== "string" || value.length > 100) throw invalidField("termIds", "Invalid DNA term");
    const id = termsByInput.get(canonical(value));
    if (!id) throw invalidField("termIds", "Unknown DNA term");
    return id;
  });
  return [...new Set(ids)].sort();
}
export function dnaInput(body) {
  const fields = ["action", "creativeStatement", "creativeGoals", "workflowNotes", "visibility", "expectedRevision", "termIds"];
  if (!body || Object.keys(body).some(key => !fields.includes(key))) throw new DnaError("Unknown Creative DNA field");
  if (!["private", "members", "public"].includes(body.visibility)) throw invalidField("visibility", "Choose a DNA visibility");
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= 2147483647) {
    throw invalidField("expectedRevision", "Invalid DNA revision");
  }
  const termIds = canonicalTermIds(body.termIds);
  const counts = {};
  for (const id of termIds) {
    const dimension = id.split(":")[0];
    counts[dimension] = (counts[dimension] || 0) + 1;
    if (counts[dimension] > DNA_LIMITS.perDimension) throw invalidField("termIds", "Use up to 8 terms per dimension");
  }
  return {
    creativeStatement: text(body.creativeStatement, DNA_LIMITS.creativeStatement, "creativeStatement"),
    creativeGoals: text(body.creativeGoals, DNA_LIMITS.creativeGoals, "creativeGoals"),
    workflowNotes: text(body.workflowNotes, DNA_LIMITS.workflowNotes, "workflowNotes"),
    visibility: body.visibility, expectedRevision: body.expectedRevision, termIds
  };
}
export function publicProfileId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new DnaError("Invalid public profile identifier");
  }
  return value.toLowerCase();
}

export async function readNetworkBody(request) {
  // Existing profile tag arrays can legitimately exceed the tighter DNA action limit.
  const networkBodyBytes = 128000;
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > networkBodyBytes) throw new DnaError("Request body too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DnaError("JSON body required");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > networkBodyBytes) { await reader.cancel(); throw new DnaError("Request body too large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new DnaError("Request body must be valid JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DnaError("Invalid request");
  const dnaAction = body.action === "save_dna" || (body.action === "invite" && body.publicProfileId != null);
  if (dnaAction && (size > DNA_LIMITS.bodyBytes || declaredSize > DNA_LIMITS.bodyBytes)) {
    throw new DnaError("Request body too large", 413);
  }
  if (dnaAction &&
    !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new DnaError("Use application/json", 415);
  }
  if (dnaAction &&
    request.headers.get("origin") !== new URL(request.url).origin) {
    throw new DnaError("Cross-origin action rejected", 403);
  }
  return body;
}

export async function dnaQuota(db, memberId, action) {
  const bucket = memberId ? `member:${memberId}:${action}` : `public:${action}`;
  const max = action === "write" ? 20 : memberId ? 60 : 240;
  const rows = await db.sql`
    INSERT INTO halo_creator_dna_rate_limits(bucket) VALUES (${bucket})
    ON CONFLICT (bucket) DO UPDATE SET
      attempts = CASE WHEN halo_creator_dna_rate_limits.window_start <= NOW() - INTERVAL '1 minute'
        THEN 1 ELSE halo_creator_dna_rate_limits.attempts + 1 END,
      window_start = CASE WHEN halo_creator_dna_rate_limits.window_start <= NOW() - INTERVAL '1 minute'
        THEN NOW() ELSE halo_creator_dna_rate_limits.window_start END
    WHERE halo_creator_dna_rate_limits.attempts < ${max}
      OR halo_creator_dna_rate_limits.window_start <= NOW() - INTERVAL '1 minute'
    RETURNING attempts`;
  if (!rows.length) throw new DnaError("Creative DNA rate limit reached; try again later", 429);
}

export function dnaDto(row, owner = false) {
  const dna = {
    creativeStatement: row?.creative_statement || "",
    creativeGoals: row?.creative_goals || "",
    termIds: row?.term_ids || []
  };
  if (owner) Object.assign(dna, {
    workflowNotes: row?.workflow_notes || "", visibility: row?.visibility || "private", revision: row?.revision || 0
  });
  return dna;
}
export function creatorDto(row, memberId = null, reasons = []) {
  return {
    publicProfileId: row.public_profile_id, displayName: row.display_name,
    bio: row.bio || "", roles: row.roles || [], genres: row.genres || [], languages: row.languages || [],
    bpmMin: row.bpm_min ?? null, bpmMax: row.bpm_max ?? null, artistSlug: row.artist_slug || null,
    premiumVerified: row.premium_verified === true,
    dna: dnaDto(row), matchReasons: reasons, canInvite: Boolean(memberId && row.member_id !== memberId)
  };
}
export async function activeDnaTerms(db) {
  const rows = await db.sql`SELECT id, dimension, key, label, aliases FROM halo_creator_dna_terms
    WHERE active = TRUE ORDER BY dimension, key`;
  return rows.map(({ id, dimension, key, label, aliases }) => ({ id, dimension, key, label, aliases }));
}
function requireActiveTerms(ids, terms) {
  const active = new Set(terms.map(term => term.id));
  if (ids.some(id => !active.has(id))) throw invalidField("termIds", "A selected DNA term is no longer available. Refresh the vocabulary.");
}
export async function dnaOwner(db, memberId) {
  const [rows, projects, terms] = await Promise.all([
    db.sql`SELECT c.*, d.creative_statement, d.creative_goals, d.workflow_notes, d.visibility, d.revision,
      ARRAY(SELECT tag.term_id FROM halo_creator_dna_tags tag JOIN halo_creator_dna_terms term ON term.id = tag.term_id
        WHERE tag.member_id = c.member_id AND term.active = TRUE ORDER BY tag.term_id) AS term_ids
      FROM halo_creator_profiles c LEFT JOIN halo_creator_dna d USING(member_id) WHERE c.member_id = ${memberId}`,
    db.sql`SELECT id, title FROM halo_creator_projects WHERE owner_member_id = ${memberId} AND status = 'open' ORDER BY id`,
    activeDnaTerms(db)
  ]);
  const row = rows[0];
  const profile = row ? {
    publicProfileId: row.public_profile_id, displayName: row.display_name, discoverable: row.discoverable,
    bio: row.bio, roles: row.roles, genres: row.genres, languages: row.languages,
    bpmMin: row.bpm_min, bpmMax: row.bpm_max, artistSlug: row.artist_slug
  } : null;
  return { profile, dna: row ? dnaDto(row, true) : defaultCreativeDna(), terms,
    projects: profile ? projects.map(({ id, title }) => ({ id, title })) : [] };
}
export async function saveDna(db, memberId, input) {
  await dnaQuota(db, memberId, "write");
  const profiles = await db.sql`SELECT public_profile_id FROM halo_creator_profiles WHERE member_id = ${memberId}`;
  if (!profiles.length) throw new DnaError("Save your Creator Pass profile first", 409);
  requireActiveTerms(input.termIds, await activeDnaTerms(db));
  const rows = await db.sql`SELECT * FROM halo_save_creator_dna(
    ${memberId}, ${input.creativeStatement}, ${input.creativeGoals}, ${input.workflowNotes},
    ${input.visibility}, ${input.expectedRevision}, ${input.termIds}::text[])`;
  if (!rows.length) throw new DnaError("Creative DNA changed. Reload before saving again.", 409,
    { expectedRevision: "Reload the latest Creative DNA before saving." });
  return { dna: dnaDto({ ...rows[0], term_ids: input.termIds }, true), message: "Creative DNA saved" };
}

export async function bilateralBlock(db, memberId, otherId) {
  const rows = await db.sql`SELECT 1 FROM halo_signal_blocks
    WHERE (member_id = ${memberId} AND target_member_id = ${otherId})
      OR (member_id = ${otherId} AND target_member_id = ${memberId}) LIMIT 1`;
  return rows.length > 0;
}
export async function resolveDnaInvite(db, memberId, id) {
  if (!memberId) throw new DnaError("Sign in to invite creators", 401);
  const validatedId = publicProfileId(id);
  await dnaQuota(db, memberId, "write");
  const rows = await db.sql`SELECT c.member_id FROM halo_creator_profiles c
    JOIN halo_creator_dna d USING(member_id)
    WHERE c.public_profile_id = ${validatedId}::uuid AND c.discoverable = TRUE
      AND (d.visibility = 'public' OR (${memberId}::text IS NOT NULL AND d.visibility = 'members'))
      AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b
        WHERE (b.member_id = ${memberId} AND b.target_member_id = c.member_id)
          OR (b.member_id = c.member_id AND b.target_member_id = ${memberId}))`;
  if (!rows.length) throw new DnaError("Creator not found", 404);
  return rows[0].member_id;
}

export function searchInput(url, memberId) {
  const q = text(url.searchParams.get("q"), 160);
  const role = text(url.searchParams.get("role"), 80), genre = text(url.searchParams.get("genre"), 80);
  const language = text(url.searchParams.get("language"), 80);
  const rawBpm = url.searchParams.get("bpm");
  const bpm = rawBpm == null || rawBpm === "" ? null : Number(rawBpm);
  if (bpm !== null && (!/^\d+$/.test(rawBpm) || !Number.isInteger(bpm) || bpm < 20 || bpm > 300)) throw new DnaError("Invalid BPM");
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit == null ? 24 : Number(rawLimit);
  if (rawLimit !== null && !/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 48) throw new DnaError("Use a page size from 1 to 48");
  const termIds = canonicalTermIds(url.searchParams.getAll("term"), DNA_LIMITS.searchTerms);
  const binding = createHash("sha256").update(JSON.stringify({ q, role, genre, language, bpm, termIds, memberId, limit })).digest("hex");
  let cursor = null;
  const raw = url.searchParams.get("cursor");
  if (raw !== null) {
    try {
      if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const decoded = Buffer.from(raw, "base64url");
      if (decoded.toString("base64url") !== raw) throw new Error();
      const value = JSON.parse(decoded.toString("utf8"));
      if (Object.keys(value).sort().join() !== "binding,id,premium,score" || value.binding !== binding ||
        !Number.isInteger(value.score) || value.score < 0 || value.score > 1000000 || typeof value.premium !== "boolean") throw new Error();
      cursor = { ...value, id: publicProfileId(value.id) };
    } catch { throw new DnaError("Invalid pagination cursor"); }
  }
  return { q, role, genre, language, bpm, limit, termIds, binding, cursor };
}
export function cursorFor(row, binding) {
  return Buffer.from(JSON.stringify({ binding, id: row.public_profile_id,
    score: Number(row.score), premium: row.premium_verified === true })).toString("base64url");
}
export function dnaFallback(filters) {
  return { creators: [], terms: DNA_TERMS, nextCursor: null, total: 0, directoryUnavailable: true,
    curated: curatedCreators(filters).map(row => ({
      displayName: row.display_name, bio: row.bio, artistSlug: row.artist_slug,
      roles: row.roles, genres: row.genres, languages: row.languages, curated: true, canInvite: false
    })) };
}

export function publishedReleaseLink(value) {
  if (typeof value === "string" && /^\/music\/\?song=[a-z0-9-]+$/i.test(value)) return value;
  return publicLink(value);
}

export async function dnaSearch(db, memberId, input) {
  await dnaQuota(db, memberId, "search");
  const { q, role, genre, language, bpm, termIds, limit, cursor } = input;
  const terms = await activeDnaTerms(db);
  requireActiveTerms(termIds, terms);
  const rows = await db.sql`
    WITH eligible AS MATERIALIZED (
      SELECT c.member_id, c.public_profile_id, c.display_name, c.bio,
        CASE WHEN EXISTS (SELECT 1 FROM halo_artist_pages page WHERE page.slug = c.artist_slug
          AND page.owner_member_id = c.member_id AND page.status = 'published') THEN c.artist_slug ELSE NULL END AS artist_slug,
        c.roles, c.genres, c.languages, c.bpm_min, c.bpm_max, d.creative_statement, d.creative_goals,
        ARRAY(SELECT tag.term_id FROM halo_creator_dna_tags tag JOIN halo_creator_dna_terms term ON term.id = tag.term_id
          WHERE tag.member_id = c.member_id AND term.active = TRUE ORDER BY tag.term_id) AS term_ids,
        COALESCE(pass.subscription_tier = 'PREMIUM' AND (
          (pass.subscription_status = 'active' AND pass.subscription_expires_at > NOW()) OR
          (pass.subscription_status = 'trialing' AND pass.trial_ends_at > NOW()
            AND (pass.subscription_expires_at IS NULL OR pass.subscription_expires_at > NOW()))
        ), FALSE) AS premium_verified,
        CASE WHEN ${q} = '' THEN 0 ELSE
          LEAST(1000000, floor(100000 * (
            ts_rank(to_tsvector('simple', c.display_name || ' ' || c.bio), plainto_tsquery('simple', ${q})) +
            ts_rank(to_tsvector('simple', d.creative_statement || ' ' || d.creative_goals), plainto_tsquery('simple', ${q}))
          )))::int END AS score
      FROM halo_creator_profiles c JOIN halo_creator_dna d USING(member_id)
      LEFT JOIN halo_creator_passes pass USING(member_id)
      WHERE c.discoverable = TRUE AND (d.visibility = 'public' OR (${memberId}::text IS NOT NULL AND d.visibility = 'members'))
        AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b WHERE ${memberId}::text IS NOT NULL
          AND ((b.member_id = ${memberId} AND b.target_member_id = c.member_id)
            OR (b.member_id = c.member_id AND b.target_member_id = ${memberId})))
        AND (${role} = '' OR c.roles @> ARRAY[${role}]::text[])
        AND (${genre} = '' OR c.genres @> ARRAY[${genre}]::text[])
        AND (${language} = '' OR c.languages @> ARRAY[${language}]::text[])
        AND (${bpm}::int IS NULL OR ${bpm} BETWEEN c.bpm_min AND c.bpm_max)
        AND (${q} = '' OR to_tsvector('simple', c.display_name || ' ' || c.bio) @@ plainto_tsquery('simple', ${q})
          OR to_tsvector('simple', d.creative_statement || ' ' || d.creative_goals) @@ plainto_tsquery('simple', ${q}))
        AND NOT EXISTS (SELECT 1 FROM unnest(${termIds}::text[]) selected(id)
          WHERE NOT EXISTS (SELECT 1 FROM halo_creator_dna_tags t JOIN halo_creator_dna_terms term ON term.id = t.term_id
            WHERE t.member_id = c.member_id AND t.term_id = selected.id AND term.active = TRUE))
    ), page AS (
      SELECT * FROM eligible
      WHERE ${cursor === null} OR score < ${cursor?.score ?? 0}
        OR (score = ${cursor?.score ?? 0} AND premium_verified < ${cursor?.premium ?? false})
        OR (score = ${cursor?.score ?? 0} AND premium_verified = ${cursor?.premium ?? false}
          AND public_profile_id > ${cursor?.id ?? "00000000-0000-4000-8000-000000000000"}::uuid)
      ORDER BY score DESC, premium_verified DESC, public_profile_id ASC LIMIT ${limit + 1}
    )
    SELECT (SELECT count(*)::int FROM eligible) AS total,
      COALESCE((SELECT jsonb_agg(page ORDER BY score DESC, premium_verified DESC, public_profile_id ASC) FROM page), '[]'::jsonb) AS creators`;
  const page = rows[0]?.creators || [];
  const items = page.slice(0, limit);
  return {
    creators: items.map(row => creatorDto(row, memberId, [
      ...termIds.filter(id => row.term_ids?.includes(id)).map(id => `Shared DNA: ${terms.find(term => term.id === id).label}`),
      ...(q ? ["Matches your creative search"] : []),
      ...(role ? [`Role: ${role}`] : []), ...(genre ? [`Genre: ${genre}`] : []),
      ...(language ? [`Language: ${language}`] : []), ...(bpm ? [`BPM: ${bpm}`] : [])
    ])),
    terms, total: Number(rows[0]?.total || 0), curated: [],
    nextCursor: page.length > limit ? cursorFor(items.at(-1), input.binding) : null
  };
}

export async function dnaProfile(db, memberId, id) {
  await dnaQuota(db, memberId, "search");
  const rows = await db.sql`SELECT c.member_id, c.public_profile_id, c.display_name, c.bio,
    CASE WHEN EXISTS (SELECT 1 FROM halo_artist_pages page WHERE page.slug = c.artist_slug
      AND page.owner_member_id = c.member_id AND page.status = 'published') THEN c.artist_slug ELSE NULL END AS artist_slug,
    c.roles, c.genres, c.languages, c.bpm_min, c.bpm_max,
    d.creative_statement, d.creative_goals,
    ARRAY(SELECT tag.term_id FROM halo_creator_dna_tags tag JOIN halo_creator_dna_terms term ON term.id = tag.term_id
      WHERE tag.member_id = c.member_id AND term.active = TRUE ORDER BY tag.term_id) AS term_ids,
    COALESCE(pass.subscription_tier = 'PREMIUM' AND (
      (pass.subscription_status = 'active' AND pass.subscription_expires_at > NOW()) OR
      (pass.subscription_status = 'trialing' AND pass.trial_ends_at > NOW()
        AND (pass.subscription_expires_at IS NULL OR pass.subscription_expires_at > NOW()))
    ), FALSE) AS premium_verified
    FROM halo_creator_profiles c LEFT JOIN halo_creator_dna d USING(member_id)
    LEFT JOIN halo_creator_passes pass USING(member_id)
    WHERE c.public_profile_id = ${id}::uuid AND (
      c.member_id = ${memberId} OR (c.discoverable = TRUE AND
        (d.visibility = 'public' OR (${memberId}::text IS NOT NULL AND d.visibility = 'members'))))
      AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b WHERE ${memberId}::text IS NOT NULL
        AND ((b.member_id = ${memberId} AND b.target_member_id = c.member_id)
          OR (b.member_id = c.member_id AND b.target_member_id = ${memberId})))`;
  const row = rows[0];
  if (!row) throw new DnaError("Creator not found", 404);
  const [releases, projects] = await Promise.all([
    db.sql`SELECT release.id, release.title, release.official_url FROM halo_release_campaigns release
      WHERE release.owner_member_id = ${row.member_id} AND release.status = 'published' AND release.visibility = 'public'
        AND EXISTS (SELECT 1 FROM halo_artist_pages page
          WHERE page.slug = release.artist_slug AND page.owner_member_id = release.owner_member_id AND page.status = 'published')
      ORDER BY release.release_date DESC, release.id LIMIT 24`,
    memberId
      ? db.sql`SELECT id, title FROM halo_creator_projects WHERE owner_member_id = ${memberId} AND status = 'open' ORDER BY id`
      : Promise.resolve([])
  ]);
  return { profile: creatorDto(row, memberId),
    releases: releases.map(release => ({ id: release.id, title: release.title, url: publishedReleaseLink(release.official_url) }))
      .filter(release => release.url),
    projects: projects.map(({ id, title }) => ({ id, title })) };
}
