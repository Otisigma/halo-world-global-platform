import { isOwner } from "./halo-x.mjs";
import { loadRelationshipSignups } from "./relationship-signups.mjs";

const iso = value => value ? new Date(value).toISOString() : null;

async function source(load, serialize) {
  try {
    const rows = await load();
    return { status: "available", rows: rows.map(serialize) };
  } catch {
    // Missing tables and failed queries must not masquerade as empty lists.
    return { status: "unavailable", rows: null };
  }
}

export async function loadOwnerSignups(db, user) {
  if (!isOwner(user)) throw new Error("Owner access is required");
  const [dreamweaver, trackDrops, artistPro] = await Promise.all([
    source(() => loadRelationshipSignups(db), row => ({
      email: row.email,
      source: row.source,
      status: row.status,
      firstSignupAt: iso(row.first_signup_at),
      lastSignupAt: iso(row.last_signup_at),
      consentAt: iso(row.consent_at)
    })),
    source(() => db.sql`
      SELECT m.email, p.email_consent_at, p.updated_at
      FROM halo_member_notification_preferences p
      JOIN halo_memberships m ON m.member_id = p.member_id
      WHERE p.track_drops_email = TRUE AND p.email_consent_at IS NOT NULL
      ORDER BY p.email_consent_at DESC, p.member_id ASC
      LIMIT 30
    `, row => ({
      email: row.email,
      source: "track_drops",
      status: "opted_in",
      consentAt: iso(row.email_consent_at),
      updatedAt: iso(row.updated_at)
    })),
    source(() => db.sql`
      SELECT email, source, status, consent_at, created_at, updated_at
      FROM halo_artist_pro_leads
      ORDER BY updated_at DESC, id ASC
      LIMIT 30
    `, row => ({
      email: row.email,
      source: row.source,
      status: row.status,
      consentAt: iso(row.consent_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    }))
  ]);
  return { limitPerSource: 30, refreshedAt: new Date().toISOString(), sources: { dreamweaver, trackDrops, artistPro } };
}
