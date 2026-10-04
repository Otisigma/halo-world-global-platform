import { getCreatorPassEntitlements, getVaultCapacityBytes } from "../../lib/creator-pass.js";

function dateString(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "invalid";
}

export function creatorPassFromRow(row = {}, now = new Date()) {
  const pass = {
    creatorId: row.member_id || "",
    displayName: row.display_name || "",
    roles: Array.isArray(row.roles) ? row.roles : [],
    subscriptionTier: row.subscription_tier === "PREMIUM" ? "PREMIUM" : "STANDARD",
    subscriptionStatus: row.subscription_status || "inactive",
    subscriptionExpiresAt: dateString(row.subscription_expires_at),
    trialEndsAt: dateString(row.trial_ends_at)
  };
  const capacity = getVaultCapacityBytes(pass, now);
  return {
    ...pass,
    vaultCapacityBytes: Number.isFinite(capacity) ? capacity : null,
    entitlements: getCreatorPassEntitlements(pass, now)
  };
}

export function publicCreatorPassFromRow(row, now = new Date()) {
  const { entitlements } = creatorPassFromRow(row, now);
  return {
    priorityDiscovery: entitlements.priorityDiscovery,
    verifiedPremiumBadge: entitlements.verifiedPremiumBadge,
    dynamicBriefSurfacing: entitlements.dynamicBriefSurfacing
  };
}

export async function loadCreatorPass(db, memberId) {
  const rows = await db.sql`
    SELECT member_id, subscription_tier, subscription_status, subscription_expires_at, trial_ends_at
    FROM halo_creator_passes WHERE member_id = ${memberId} LIMIT 1
  `;
  return creatorPassFromRow({ ...rows[0], member_id: memberId });
}
