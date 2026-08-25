import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import {
  CHANNELS,
  PURPOSES,
  RELATIONSHIP_STATUSES,
  cleanSafeguards,
  cleanSlug,
  cleanText,
  cleanUrl,
  draftPartnerBrief,
  loadPartnerTrustDashboard
} from "../lib/partner-trust.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorize(db, user) {
  if (!user?.id) return { status: 401, message: "Sign in to open the partner trust desk" };
  if (!isOwner(user)) return { status: 403, message: "The partner trust desk is owner-only" };
  return { membership: await ensureMembership(db, user) };
}

async function bodyFrom(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 24_000) throw new Error("payload_too_large");
  return request.json();
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function addPartner(db, payload, memberId) {
  const name = cleanText(payload.name, 160);
  const platformUrl = cleanUrl(payload.platformUrl);
  const sourceNote = cleanText(payload.sourceNote, 500);
  const usageSummary = cleanText(payload.usageSummary, 2000);
  const safeguards = cleanSafeguards(payload.safeguards);
  if (name.length < 2 || !platformUrl || sourceNote.length < 8 || usageSummary.length < 20 || !safeguards.length) {
    return json({ message: "Add a name, HTTPS platform link, source note, intended use, and at least one safeguard" }, 400);
  }
  const id = cleanSlug(payload.id || name);
  const rows = await db.sql`
    INSERT INTO halo_partner_contacts (
      id, name, relationship_status, platform_url, account_url, contact_url, source_note,
      usage_summary, safeguards, owner_notes, min_days_between_contacts, added_by_member_id
    ) VALUES (
      ${id}, ${name}, ${RELATIONSHIP_STATUSES.has(payload.relationshipStatus) ? payload.relationshipStatus : "prospective"},
      ${platformUrl}, ${cleanUrl(payload.accountUrl)}, ${cleanUrl(payload.contactUrl)}, ${sourceNote},
      ${usageSummary}, ${safeguards}, ${cleanText(payload.ownerNotes, 2000)},
      ${Math.min(365, Math.max(14, Number(payload.minDaysBetweenContacts) || 90))}, ${memberId}
    ) ON CONFLICT (id) DO NOTHING RETURNING id
  `;
  if (!rows.length) return json({ message: "A partner record with that id already exists" }, 409);
  await db.sql`
    INSERT INTO halo_partner_events (partner_id, event_type, actor_member_id, note)
    VALUES (${id}, 'partner_added', ${memberId}, ${sourceNote})
  `;
  return json({ ok: true, partnerId: id });
}

async function updateBrief(db, payload, memberId) {
  const briefId = positiveId(payload.briefId);
  if (!briefId) return json({ message: "Unknown partner brief" }, 400);
  const action = payload.action;
  const transitions = {
    approve_brief: { from: "proposed", to: "approved", event: "brief_approved" },
    archive_brief: { from: null, to: "archived", event: "brief_archived" },
    record_shared: { from: "approved", to: "shared", event: "brief_shared" },
    record_response: { from: "shared", to: "responded", event: "response_recorded" }
  };
  const transition = transitions[action];
  if (!transition) return json({ message: "Unknown partner brief action" }, 400);
  const note = cleanText(payload.note, action === "record_response" ? 2000 : 1200);
  const rows = await db.sql`
    SELECT b.partner_id, b.status, p.last_shared_at, p.min_days_between_contacts
    FROM halo_partner_briefs b
    JOIN halo_partner_contacts p ON p.id = b.partner_id
    WHERE b.id = ${briefId}
    LIMIT 1
  `;
  const brief = rows[0];
  if (!brief) return json({ message: "Unknown partner brief" }, 404);
  if (transition.from && brief.status !== transition.from) return json({ message: `This brief must be ${transition.from} first` }, 409);

  if (action === "record_shared" && brief.last_shared_at) {
    const elapsedDays = Math.floor((Date.now() - new Date(brief.last_shared_at).getTime()) / 86_400_000);
    const minimumDays = Number(brief.min_days_between_contacts || 90);
    if (elapsedDays < minimumDays) {
      return json({ message: `This platform is protected by a ${minimumDays}-day contact gap. Record sharing only after that interval.` }, 409);
    }
  }

  if (action === "approve_brief") {
    await db.sql`UPDATE halo_partner_briefs SET status = 'approved', approved_by_member_id = ${memberId}, approved_at = NOW(), updated_at = NOW() WHERE id = ${briefId}`;
  } else if (action === "record_shared") {
    await db.sql`UPDATE halo_partner_briefs SET status = 'shared', shared_by_member_id = ${memberId}, shared_at = NOW(), updated_at = NOW() WHERE id = ${briefId}`;
    await db.sql`UPDATE halo_partner_contacts SET last_shared_at = NOW(), updated_at = NOW() WHERE id = ${brief.partner_id}`;
  } else if (action === "record_response") {
    if (!note) return json({ message: "Record what the partner said before closing the loop" }, 400);
    await db.sql`UPDATE halo_partner_briefs SET status = 'responded', response_note = ${note}, updated_at = NOW() WHERE id = ${briefId}`;
  } else {
    await db.sql`UPDATE halo_partner_briefs SET status = 'archived', updated_at = NOW() WHERE id = ${briefId}`;
  }
  await db.sql`
    INSERT INTO halo_partner_events (partner_id, brief_id, event_type, actor_member_id, note)
    VALUES (${brief.partner_id}, ${briefId}, ${transition.event}, ${memberId}, ${note})
  `;
  return json({ ok: true });
}

export default async function partnerTrustHandler(request) {
  const db = getDatabase();
  const user = await getUser(request).catch(() => null);
  const access = await authorize(db, user);
  if (!access.membership) return json({ message: access.message }, access.status);

  if (request.method === "GET") return json(await loadPartnerTrustDashboard(db));
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  if (!verifyRequestOrigin(request)) return json({ message: "Request origin could not be verified" }, 403);

  let payload;
  try {
    payload = await bodyFrom(request);
  } catch (error) {
    return json({ message: error.message === "payload_too_large" ? "Partner request is too large" : "A valid partner request is required" }, 400);
  }

  const memberId = access.membership.member_id;
  if (payload.action === "add_partner") return addPartner(db, payload, memberId);
  if (payload.action === "draft_brief") {
    if (!PURPOSES.has(payload.purpose)) return json({ message: "Choose a valid reason for contacting this platform" }, 400);
    try {
      const result = await draftPartnerBrief(db, { partnerId: payload.partnerId, purpose: payload.purpose, ownerContext: payload.ownerContext, memberId });
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ message: cleanText(error.message, 300) || "The partner team could not prepare a brief" }, 400);
    }
  }
  if (["approve_brief", "archive_brief", "record_shared", "record_response"].includes(payload.action)) {
    return updateBrief(db, payload, memberId);
  }
  if (payload.action === "update_partner") {
    const partnerId = cleanSlug(payload.partnerId);
    const status = RELATIONSHIP_STATUSES.has(payload.relationshipStatus) ? payload.relationshipStatus : null;
    if (!partnerId || !status) return json({ message: "Unknown partner status" }, 400);
    await db.sql`UPDATE halo_partner_contacts SET relationship_status = ${status}, owner_notes = ${cleanText(payload.ownerNotes, 2000)}, updated_at = NOW() WHERE id = ${partnerId}`;
    return json({ ok: true });
  }
  return json({ message: "Unknown partner trust action" }, 400);
}

export const config = { path: "/api/partner-trust" };
