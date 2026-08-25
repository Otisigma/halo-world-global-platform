import OpenAI from "openai";

export const PARTNER_TRUST_MODEL = "gpt-5.4-mini";

export const PARTNER_TRUST_ROLES = Object.freeze([
  { key: "bridge", name: "Bridge", title: "Relationship lead", mission: "Explain why HALO is reaching out and make one clear, respectful request." },
  { key: "covenant", name: "Covenant", title: "Platform care", mission: "Turn responsible-use promises into specific controls that can be checked." },
  { key: "rights", name: "Rights", title: "Licensing review", mission: "Keep every use aligned with the applicable plan, ownership, and third-party rights." },
  { key: "signal", name: "Signal", title: "Technical translator", mission: "Describe the real product workflow without exaggeration or hidden automation." },
  { key: "mirror", name: "Mirror", title: "Truth and restraint", mission: "Remove invented partnerships, absolute claims, pressure, and unsupported facts." }
]);

export const PURPOSES = new Set(["introduction", "usage_disclosure", "partnership", "policy_review"]);
export const CHANNELS = new Set(["email", "support_portal", "partner_form", "meeting"]);
export const RELATIONSHIP_STATUSES = new Set(["prospective", "active", "paused", "closed"]);

export function cleanText(value, maxLength = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanBody(value, maxLength = 6000) {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength) : "";
}

export function cleanSlug(value, maxLength = 80) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, maxLength)
    : "";
}

export function cleanUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.href.slice(0, 500) : "";
  } catch {
    return "";
  }
}

export function cleanSafeguards(value) {
  const source = Array.isArray(value) ? value : String(value || "").split("\n");
  return [...new Set(source.map(item => cleanText(item, 320)).filter(Boolean))].slice(0, 12);
}

function serializePartner(row) {
  return {
    id: row.id,
    name: row.name,
    relationshipStatus: row.relationship_status,
    platformUrl: row.platform_url,
    accountUrl: row.account_url,
    contactUrl: row.contact_url,
    sourceNote: row.source_note,
    usageSummary: row.usage_summary,
    safeguards: row.safeguards || [],
    ownerNotes: row.owner_notes,
    minDaysBetweenContacts: Number(row.min_days_between_contacts || 90),
    lastSharedAt: row.last_shared_at,
    createdAt: row.created_at
  };
}

function serializeBrief(row) {
  return {
    id: Number(row.id),
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    purpose: row.purpose,
    subject: row.subject,
    body: row.body,
    evidenceKeys: row.evidence_keys || [],
    reviewNotes: row.review_notes,
    recommendedChannel: row.recommended_channel,
    status: row.status,
    responseNote: row.response_note,
    inferenceUsed: Boolean(row.inference_used),
    usage: { inputTokens: Number(row.input_tokens || 0), outputTokens: Number(row.output_tokens || 0) },
    approvedAt: row.approved_at,
    sharedAt: row.shared_at,
    createdAt: row.created_at
  };
}

export async function loadPartnerTrustDashboard(db) {
  const [partners, briefs, totals] = await Promise.all([
    db.sql`SELECT * FROM halo_partner_contacts ORDER BY relationship_status, name`,
    db.sql`
      SELECT b.*, p.name AS partner_name
      FROM halo_partner_briefs b
      JOIN halo_partner_contacts p ON p.id = b.partner_id
      ORDER BY b.created_at DESC
      LIMIT 200
    `,
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_partner_contacts WHERE relationship_status <> 'closed') AS partners,
        (SELECT COUNT(*)::int FROM halo_partner_briefs WHERE status = 'proposed') AS proposed,
        (SELECT COUNT(*)::int FROM halo_partner_briefs WHERE status = 'approved') AS approved,
        (SELECT COUNT(*)::int FROM halo_partner_briefs WHERE status IN ('shared', 'responded')) AS shared
    `
  ]);

  return {
    roles: PARTNER_TRUST_ROLES,
    partners: partners.map(serializePartner),
    briefs: briefs.map(serializeBrief),
    totals: totals[0] || { partners: 0, proposed: 0, approved: 0, shared: 0 }
  };
}

function evidenceFor(partner, ownerContext) {
  return {
    "partner.name": partner.name,
    "partner.relationshipStatus": partner.relationship_status,
    "partner.platformUrl": partner.platform_url,
    "partner.accountUrl": partner.account_url,
    "partner.usageSummary": partner.usage_summary,
    "partner.safeguards": (partner.safeguards || []).join(" | "),
    "partner.ownerNotes": partner.owner_notes,
    "owner.context": ownerContext
  };
}

function briefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      subject: { type: "string" },
      body: { type: "string" },
      evidenceKeys: { type: "array", items: { type: "string" } },
      reviewNotes: { type: "string" },
      recommendedChannel: { type: "string", enum: [...CHANNELS] }
    },
    required: ["subject", "body", "evidenceKeys", "reviewNotes", "recommendedChannel"]
  };
}

function validateDraft(value, evidence) {
  const body = cleanBody(value?.body);
  const evidenceKeys = Array.isArray(value?.evidenceKeys)
    ? [...new Set(value.evidenceKeys.filter(key => Object.hasOwn(evidence, key) && cleanText(evidence[key], 6000)))].slice(0, 20)
    : [];
  if (body.length < 40) throw new Error("The partner brief was too short to review");
  if (!evidenceKeys.includes("partner.usageSummary") || !evidenceKeys.includes("partner.safeguards")) {
    throw new Error("The partner brief did not cite HALO's intended use and safeguards");
  }
  const lower = body.toLowerCase();
  if (lower.includes("official partner") || lower.includes("formal partner") || lower.includes("guarantee") || lower.includes("never violate")) {
    throw new Error("The partner brief used an unsupported or absolute claim");
  }
  return {
    subject: cleanText(value?.subject, 240),
    body,
    evidenceKeys,
    reviewNotes: cleanText(value?.reviewNotes, 1200),
    recommendedChannel: CHANNELS.has(value?.recommendedChannel) ? value.recommendedChannel : "support_portal"
  };
}

function fallbackDraft(partner, purpose, ownerContext, evidence) {
  const ask = purpose === "policy_review"
    ? "Could you point us to the right guidance for keeping this workflow aligned with your current policies?"
    : purpose === "partnership"
      ? "If this responsible-use approach is relevant to your platform team, we would welcome the correct channel for a conversation."
      : "We wanted to share the workflow before scaling it and invite any guidance your team believes we should add.";
  const accountLine = partner.account_url ? ` Our account is ${partner.account_url}.` : "";
  const contextLine = ownerContext ? ` Current context: ${ownerContext}.` : "";
  return validateDraft({
    subject: `HALO responsible-use introduction for ${partner.name}`,
    body: `Hello ${partner.name} team,\n\nHALO is building a human-led music platform and wants to be transparent about how we intend to use your service.${accountLine}\n\n${partner.usage_summary}\n\nOur controls include:\n${(partner.safeguards || []).map(item => `- ${item}`).join("\n")}\n\n${ask}${contextLine}\n\nNothing is sent, published, or commercially released by our AI systems without human review. We are not describing a formal partnership; we are opening a respectful line of communication.\n\nHALO Music World`,
    evidenceKeys: Object.keys(evidence).filter(key => cleanText(evidence[key], 6000)),
    reviewNotes: "Deterministic fallback draft. Confirm the receiving channel and current platform policy before sharing.",
    recommendedChannel: partner.contact_url ? "partner_form" : "support_portal"
  }, evidence);
}

export async function draftPartnerBrief(db, { partnerId, purpose, ownerContext, memberId }) {
  const rows = await db.sql`SELECT * FROM halo_partner_contacts WHERE id = ${cleanSlug(partnerId)} LIMIT 1`;
  const partner = rows[0];
  if (!partner) throw new Error("Unknown platform partner");
  const selectedPurpose = PURPOSES.has(purpose) ? purpose : "introduction";
  const context = cleanText(ownerContext, 1200);
  const evidence = evidenceFor(partner, context);
  let draft;
  let inputTokens = 0;
  let outputTokens = 0;
  let inferenceUsed = false;

  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: PARTNER_TRUST_MODEL,
      max_completion_tokens: 1200,
      messages: [
        {
          role: "system",
          content: `You are HALO's Partner Trust Team: Bridge, Covenant, Rights, Signal, and Mirror. Draft a concise message for human review. You never send, submit, publish, schedule, or contact anyone. Never claim a formal partnership unless the evidence explicitly says active. Never promise perfection or say HALO can never violate a rule. State concrete safeguards, acknowledge uncertainty, make one low-pressure request, and cite only keys from evidenceIndex. The message must cite partner.usageSummary and partner.safeguards. Do not invent contact details, permissions, API access, endorsements, legal conclusions, or platform policy. Return JSON only.`
        },
        { role: "user", content: JSON.stringify({ date: new Date().toISOString().slice(0, 10), purpose: selectedPurpose, evidenceIndex: evidence }) }
      ],
      response_format: { type: "json_schema", json_schema: { name: "halo_partner_trust_brief", strict: true, schema: briefSchema() } }
    }, { signal: AbortSignal.timeout(12_000) });
    draft = validateDraft(JSON.parse(completion.choices[0]?.message?.content || "{}"), evidence);
    inputTokens = Number(completion.usage?.prompt_tokens || 0);
    outputTokens = Number(completion.usage?.completion_tokens || 0);
    inferenceUsed = true;
  } catch {
    draft = fallbackDraft(partner, selectedPurpose, context, evidence);
  }

  const inserted = await db.sql`
    INSERT INTO halo_partner_briefs (
      partner_id, purpose, subject, body, evidence_keys, review_notes, recommended_channel,
      input_tokens, output_tokens, inference_used, created_by_member_id
    ) VALUES (
      ${partner.id}, ${selectedPurpose}, ${draft.subject}, ${draft.body}, ${draft.evidenceKeys},
      ${draft.reviewNotes}, ${draft.recommendedChannel}, ${inputTokens}, ${outputTokens}, ${inferenceUsed}, ${memberId}
    ) RETURNING id
  `;
  await db.sql`
    INSERT INTO halo_partner_events (partner_id, brief_id, event_type, actor_member_id, note)
    VALUES (${partner.id}, ${inserted[0].id}, 'brief_drafted', ${memberId}, ${draft.reviewNotes})
  `;
  return { briefId: Number(inserted[0].id), inferenceUsed };
}
