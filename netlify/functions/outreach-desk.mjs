import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import {
  CHANNELS,
  CONTACT_STATUSES,
  LAWFUL_BASES,
  PITCH_OUTCOMES,
  TARGET_KINDS,
  cleanGenres,
  cleanSlug,
  cleanText,
  loadOutreachDashboard,
  runOutreachDesk
} from "../lib/outreach.mjs";

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function bodyFrom(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 20_000) throw new Error("payload_too_large");
  return request.json();
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function tempoValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 40 && parsed <= 220 ? Math.round(parsed) : null;
}

// The outreach desk speaks for the platform to people outside it, so it is owner-only. There is no
// tier that opens this to members: a mistake here lands in a stranger's inbox with HALO's name on it.
async function authorize(db, user) {
  if (!user?.id) return { status: 401, message: "Sign in to open the outreach desk" };
  if (!isOwner(user)) return { status: 403, message: "The outreach desk is owner-only" };
  const membership = await ensureMembership(db, user);
  return { membership };
}

async function recordEvent(db, { pitchId = null, targetId = null, eventType, actorMemberId, note = "" }) {
  await db.sql`
    INSERT INTO halo_outreach_events (pitch_id, target_id, event_type, actor_member_id, note)
    VALUES (${pitchId}, ${targetId}, ${eventType}, ${actorMemberId}, ${cleanText(note, 600)})
  `;
}

async function addTarget(db, payload, memberId) {
  const name = cleanText(payload.name, 160);
  const sourceNote = cleanText(payload.sourceNote, 300);
  const kind = TARGET_KINDS.has(payload.kind) ? payload.kind : null;
  const contactEmail = cleanText(payload.contactEmail, 200);
  const contactUrl = cleanText(payload.contactUrl, 400);

  if (!name || name.length < 2) return json({ message: "A contact needs a name" }, 400);
  if (!kind) return json({ message: "Choose what this contact does" }, 400);
  // Provenance is required by the schema. Rejecting it here too gives a readable message instead of
  // a constraint violation, but the database remains the thing that actually guarantees it.
  if (sourceNote.length < 4) {
    return json({ message: "Record where this contact came from before adding them" }, 400);
  }
  if (!contactEmail && !contactUrl) {
    return json({ message: "Add either an email or a submission link" }, 400);
  }

  const id = cleanSlug(payload.id || `${name}-${payload.organisation || kind}`) || cleanSlug(`${kind}-${Date.now()}`);
  const minDays = Math.min(365, Math.max(7, Number(payload.minDaysBetweenContacts) || 45));

  const rows = await db.sql`
    INSERT INTO halo_outreach_targets (
      id, kind, name, organisation, territory, genres, tempo_min, tempo_max,
      contact_email, contact_url, preferred_channel, source_note, lawful_basis,
      min_days_between_contacts, notes, added_by_member_id
    ) VALUES (
      ${id}, ${kind}, ${name}, ${cleanText(payload.organisation, 160)},
      ${cleanText(payload.territory, 60) || "Global"}, ${cleanGenres(payload.genres)},
      ${tempoValue(payload.tempoMin)}, ${tempoValue(payload.tempoMax)},
      ${contactEmail}, ${contactUrl},
      ${CHANNELS.has(payload.preferredChannel) ? payload.preferredChannel : "email"},
      ${sourceNote},
      ${LAWFUL_BASES.has(payload.lawfulBasis) ? payload.lawfulBasis : "public_professional_listing"},
      ${minDays}, ${cleanText(payload.notes, 1200)}, ${memberId}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;

  if (!rows.length) return json({ message: "A contact with that id already exists" }, 409);
  await recordEvent(db, { targetId: id, eventType: "target_added", actorMemberId: memberId, note: sourceNote });
  return json({ ok: true, targetId: id });
}

async function updateTarget(db, payload, memberId) {
  const id = cleanSlug(payload.targetId);
  if (!id) return json({ message: "Unknown contact" }, 400);

  const status = CONTACT_STATUSES.has(payload.contactStatus) ? payload.contactStatus : null;
  if (!status) return json({ message: "Unknown contact status" }, 400);

  const minDays = Math.min(365, Math.max(7, Number(payload.minDaysBetweenContacts) || 45));
  const note = cleanText(payload.note, 300);

  // An opt-out is dated at the moment it is recorded and the note travels with it. The schema
  // refuses an undated opt-out, so this is the only way the state can be reached.
  const rows = await db.sql`
    UPDATE halo_outreach_targets
    SET contact_status = ${status},
        opted_out_at = CASE
          WHEN ${status} = 'opted_out' THEN COALESCE(opted_out_at, NOW())
          ELSE NULL END,
        opt_out_note = CASE WHEN ${status} = 'opted_out' THEN ${note} ELSE '' END,
        min_days_between_contacts = ${minDays},
        notes = COALESCE(NULLIF(${cleanText(payload.notes, 1200)}, ''), notes),
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, contact_status
  `;
  if (!rows.length) return json({ message: "Contact not found" }, 404);

  // An opt-out is retroactive: anything still queued for that contact is withdrawn in the same
  // action, so a decision made today cannot be undone by a draft written yesterday.
  let withdrawn = 0;
  if (status === "opted_out" || status === "bounced") {
    const archived = await db.sql`
      UPDATE halo_outreach_pitches
      SET status = 'archived', updated_at = NOW()
      WHERE target_id = ${id} AND status IN ('proposed', 'approved')
      RETURNING id
    `;
    withdrawn = archived.length;
  }

  await recordEvent(db, {
    targetId: id,
    eventType: status === "opted_out" ? "opted_out" : "target_updated",
    actorMemberId: memberId,
    note: note || `status set to ${status}`
  });

  return json({ ok: true, contactStatus: rows[0].contact_status, withdrawn });
}

async function approvePitch(db, payload, memberId) {
  const id = positiveId(payload.pitchId);
  if (!id) return json({ message: "Unknown approach" }, 400);

  // Approval re-checks the contact's state inside the statement. A contact who opted out after the
  // draft was written cannot be approved, however the request arrived.
  const rows = await db.sql`
    UPDATE halo_outreach_pitches p
    SET status = 'approved', approved_by_member_id = ${memberId}, approved_at = NOW(), updated_at = NOW()
    FROM halo_outreach_targets t
    WHERE p.id = ${id}
      AND t.id = p.target_id
      AND p.status = 'proposed'
      AND t.contact_status = 'active'
    RETURNING p.id
  `;
  if (!rows.length) {
    return json({ message: "That approach cannot be approved — it may already be approved, or the contact is no longer contactable" }, 409);
  }
  await recordEvent(db, { pitchId: id, eventType: "approved", actorMemberId: memberId });
  return json({ ok: true });
}

async function unapprovePitch(db, payload, memberId) {
  const id = positiveId(payload.pitchId);
  if (!id) return json({ message: "Unknown approach" }, 400);
  const rows = await db.sql`
    UPDATE halo_outreach_pitches
    SET status = 'proposed', approved_by_member_id = NULL, approved_at = NULL, updated_at = NOW()
    WHERE id = ${id} AND status = 'approved'
    RETURNING id
  `;
  if (!rows.length) return json({ message: "Only an approved approach can be returned to the queue" }, 409);
  await recordEvent(db, { pitchId: id, eventType: "unapproved", actorMemberId: memberId });
  return json({ ok: true });
}

async function markSent(db, payload, memberId) {
  const id = positiveId(payload.pitchId);
  if (!id) return json({ message: "Unknown approach" }, 400);

  // HALO does not send. This records that the owner sent it themselves, which is what starts the
  // contact's frequency cap running.
  const rows = await db.sql`
    UPDATE halo_outreach_pitches
    SET status = 'sent', sent_by_member_id = ${memberId}, sent_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND status = 'approved'
    RETURNING id, target_id
  `;
  if (!rows.length) return json({ message: "Approve the approach before recording it as sent" }, 409);

  await db.sql`
    UPDATE halo_outreach_targets
    SET pitches_sent = pitches_sent + 1, last_contacted_at = NOW(), updated_at = NOW()
    WHERE id = ${rows[0].target_id}
  `;
  await recordEvent(db, { pitchId: id, targetId: rows[0].target_id, eventType: "sent", actorMemberId: memberId });
  return json({ ok: true });
}

async function recordOutcome(db, payload, memberId) {
  const id = positiveId(payload.pitchId);
  const outcome = PITCH_OUTCOMES.has(payload.outcome) ? payload.outcome : null;
  if (!id || !outcome || outcome === "pending") return json({ message: "Choose what happened" }, 400);

  const rows = await db.sql`
    UPDATE halo_outreach_pitches
    SET outcome = ${outcome}, outcome_note = ${cleanText(payload.note, 600)},
        outcome_recorded_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND status = 'sent'
    RETURNING id, target_id, outcome
  `;
  if (!rows.length) return json({ message: "Record the approach as sent before logging what happened" }, 409);

  // Recorded outcomes are what the fit score reads next time. This is the loop that makes the desk
  // get better at choosing rather than just faster at writing.
  const targetId = rows[0].target_id;
  if (outcome === "replied" || outcome === "declined") {
    await db.sql`UPDATE halo_outreach_targets SET replies = replies + 1, updated_at = NOW() WHERE id = ${targetId}`;
  } else if (outcome === "placed") {
    await db.sql`
      UPDATE halo_outreach_targets
      SET replies = replies + 1, placements = placements + 1, updated_at = NOW()
      WHERE id = ${targetId}
    `;
  }

  await recordEvent(db, { pitchId: id, targetId, eventType: outcome, actorMemberId: memberId, note: payload.note });
  return json({ ok: true });
}

async function archivePitch(db, payload, memberId) {
  const id = positiveId(payload.pitchId);
  if (!id) return json({ message: "Unknown approach" }, 400);
  const rows = await db.sql`
    UPDATE halo_outreach_pitches SET status = 'archived', updated_at = NOW()
    WHERE id = ${id} AND status IN ('proposed', 'approved')
    RETURNING id
  `;
  if (!rows.length) return json({ message: "That approach cannot be archived" }, 409);
  await recordEvent(db, { pitchId: id, eventType: "archived", actorMemberId: memberId, note: payload.note });
  return json({ ok: true });
}

export default async function handler(request) {
  if (!verifyRequestOrigin(request)) return json({ message: "Bad origin" }, 403);

  const db = getDatabase();
  const user = await getUser(request);
  const auth = await authorize(db, user);
  if (auth.status) return json({ message: auth.message }, auth.status);
  const memberId = auth.membership.member_id;

  const url = new URL(request.url);

  if (request.method === "GET") {
    const releaseId = cleanText(url.searchParams.get("releaseId"), 80) || null;
    const [dashboard, releases] = await Promise.all([
      loadOutreachDashboard(db, releaseId),
      db.sql`
        SELECT id, title, artist, release_date, status
        FROM halo_release_campaigns
        ORDER BY release_date DESC NULLS LAST LIMIT 40
      `
    ]);
    return json({
      ...dashboard,
      releases: releases.map(row => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : null,
        status: row.status
      })),
      selectedReleaseId: releaseId
    });
  }

  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);

  let payload;
  try {
    payload = await bodyFrom(request);
  } catch {
    return json({ message: "Could not read that request" }, 400);
  }

  const action = cleanText(payload?.action, 40);

  try {
    switch (action) {
      case "add_target": return await addTarget(db, payload, memberId);
      case "update_target": return await updateTarget(db, payload, memberId);
      case "approve_pitch": return await approvePitch(db, payload, memberId);
      case "unapprove_pitch": return await unapprovePitch(db, payload, memberId);
      case "mark_sent": return await markSent(db, payload, memberId);
      case "record_outcome": return await recordOutcome(db, payload, memberId);
      case "archive_pitch": return await archivePitch(db, payload, memberId);
      case "run_desk": {
        const releaseId = cleanText(payload.releaseId, 80);
        if (!releaseId) return json({ message: "Choose a release to work" }, 400);

        // Two runs an hour, matching the limit the agent council already uses for manual triggers.
        const recent = await db.sql`
          SELECT COUNT(*)::int AS runs FROM halo_outreach_runs
          WHERE trigger_type = 'manual' AND created_at > NOW() - INTERVAL '1 hour'
        `;
        if (Number(recent[0]?.runs || 0) >= 2) {
          return json({ message: "The desk has already run twice this hour" }, 429, { "Retry-After": "1800" });
        }

        const result = await runOutreachDesk(db, releaseId, { triggerType: "manual", memberId });
        return json({ ok: true, ...result });
      }
      default:
        return json({ message: "Unknown action" }, 400);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "release_not_found") {
      return json({ message: "That release is not in the catalogue" }, 404);
    }
    console.error("HALO outreach desk failed", action, error instanceof Error ? error.message : "unknown error");
    return json({ message: "The outreach desk could not complete that" }, 500);
  }
}

export const config = {
  path: "/api/outreach-desk"
};
