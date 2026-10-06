import { emptyDNA, validateDNA, suggestDNA } from "../../lib/creative-dna.js";

export async function loadDNAVocabulary(db) {
  return db.sql`SELECT id, category, label, aliases, normalized_key AS "normalizedKey", active
    FROM halo_creator_interest_terms ORDER BY id`;
}

export async function loadOwnDNA(db, memberId) {
  const rows = await db.sql`SELECT creative_dna_enabled, creative_dna_audience,
    creative_dna_discovery, creative_dna_revision,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('termId', i.term_id, 'category', i.category,
      'label', COALESCE(t.label, i.custom_label), 'relationship', i.relationship, 'audience', i.audience)
      ORDER BY i.position) FROM halo_creator_interests i
      LEFT JOIN halo_creator_interest_terms t ON t.id = i.term_id WHERE i.member_id = p.member_id), '[]'::jsonb) AS items
    FROM halo_creator_profiles p WHERE member_id = ${memberId}`;
  const row = rows[0];
  return row ? { enabled: row.creative_dna_enabled === true, audience: row.creative_dna_audience || "private",
    discovery: row.creative_dna_discovery === true, revision: Number(row.creative_dna_revision || 0), items: row.items || [] } : emptyDNA();
}

export async function loadVisibleDNA(db, memberId, viewerId, destination, slug = "") {
  const rows = await db.sql`SELECT halo_creative_dna_projection(${memberId}, ${viewerId || null},
    ${destination}, FALSE, ${slug}) AS items`;
  return rows[0]?.items || [];
}

export function createCreativeDNAHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed." }, 405);
    try {
      const user = await getUser();
      if (!user?.id) return json({ message: "Sign in to edit Creative DNA." }, 401);
      if (request.method === "POST") {
        const origin = request.headers.get("origin");
        if (!origin || origin !== new URL(request.url).origin ||
            request.headers.get("sec-fetch-site") === "cross-site") {
          return json({ message: "Cross-origin action rejected." }, 403);
        }
        try {
          if ((await verifyRequestOrigin(request)) === false) return json({ message: "Cross-origin action rejected." }, 403);
        } catch { return json({ message: "Cross-origin action rejected." }, 403); }
      }
      const db = await getDatabase(), membership = await ensureMembership(db, user);
      const memberId = membership.member_id;
      if (request.method === "GET") return json({ dna: await loadOwnDNA(db, memberId), vocabulary: await loadDNAVocabulary(db) });
      if (!(request.headers.get("content-type") || "").startsWith("application/json")) return json({ message: "Use application/json." }, 415);
      const reader = request.body?.getReader();
      let size = 0, content = "";
      if (!reader) return json({ message: "Provide a request body." }, 400);
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16000) { await reader.cancel(); return json({ message: "Request too large." }, 413); }
          content += decoder.decode(value, { stream: true });
        }
        content += decoder.decode();
      } finally { reader.releaseLock(); }
      let body;
      try { body = JSON.parse(content); } catch { return json({ message: "Invalid JSON." }, 400); }
      if (body?.action === "suggest") {
        if (Object.keys(body).some(key => !["action", "consent", "selectedText"].includes(key)) || body.consent !== true) {
          return json({ message: "Choose text and consent to local suggestions." }, 400);
        }
        const vocabulary = await loadDNAVocabulary(db);
        try { return json({ suggestions: suggestDNA(body.selectedText, vocabulary), method: "Local curated alias matching; no AI provider, no text stored." }); }
        catch (error) { return json({ message: error.message }, 400); }
      }
      if (body?.action !== "save" || Object.keys(body).some(key => !["action", "dna"].includes(key))) return json({ message: "Unknown operation." }, 400);
      let dna;
      const vocabulary = await loadDNAVocabulary(db);
      try { dna = validateDNA(body.dna, vocabulary); } catch (error) { return json({ message: error.message }, 400); }
      const rows = await db.sql`SELECT halo_save_creative_dna(${memberId}, ${membership.display_name || "HALO creator"},
        ${dna.revision}::bigint, ${dna.enabled}, ${dna.audience}, ${dna.discovery}, ${JSON.stringify(dna.items)}::jsonb) AS revision`;
      if (rows[0]?.revision == null) return json({ message: "Creative DNA changed elsewhere. Reload before saving.", conflict: true }, 409);
      return json({ dna: { ...dna, revision: Number(rows[0].revision) } });
    } catch {
      return json({ message: "Creative DNA is temporarily unavailable. Your saved interests are unchanged." }, 503);
    }
  };
}
