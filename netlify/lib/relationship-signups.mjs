// Shared by owner-authorized Relations and Control Center handlers only.
export async function loadRelationshipSignups(db) {
  return db.sql`
    SELECT s.email, s.source_signup_id, s.first_name, s.favorite_platform, s.status, s.signup_count,
      s.source, s.consent_at, s.first_signup_at, s.last_signup_at,
      s.linked_member_id, m.display_name AS linked_member_name
    FROM halo_relationship_signups s
    LEFT JOIN halo_memberships m ON m.member_id = s.linked_member_id
    ORDER BY s.last_signup_at DESC, s.email ASC
    LIMIT 30
  `;
}
