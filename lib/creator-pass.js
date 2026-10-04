export const STANDARD_VAULT_CAPACITY_BYTES = 5 * 1024 * 1024 * 1024;

export const FREE_CREATOR_PASS_ENTITLEMENTS = Object.freeze({
  smartSplitsEnabled: false,
  aiGuardianAccess: false,
  priorityDiscovery: false,
  customArtistRoom: false,
  dynamicBriefSurfacing: false,
  unlimitedVault: false,
  verifiedPremiumBadge: false
});

export const PREMIUM_CREATOR_PASS_ENTITLEMENTS = Object.freeze(
  Object.fromEntries(Object.keys(FREE_CREATOR_PASS_ENTITLEMENTS).map(key => [key, true]))
);

function futureDate(value, now) {
  return typeof value === "string" && value.trim() !== "" &&
    Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
}

export function hasPremiumAccess(pass, now = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(timestamp) || pass?.subscriptionTier !== "PREMIUM") return false;
  if (pass.subscriptionStatus === "active") return futureDate(pass.subscriptionExpiresAt, timestamp);
  if (pass.subscriptionStatus !== "trialing" || !futureDate(pass.trialEndsAt, timestamp)) return false;
  return pass.subscriptionExpiresAt == null || futureDate(pass.subscriptionExpiresAt, timestamp);
}

export function getCreatorPassEntitlements(pass, now = new Date()) {
  return hasPremiumAccess(pass, now) ? PREMIUM_CREATOR_PASS_ENTITLEMENTS : FREE_CREATOR_PASS_ENTITLEMENTS;
}

export function getVaultCapacityBytes(pass, now = new Date()) {
  return getCreatorPassEntitlements(pass, now).unlimitedVault ? Infinity : STANDARD_VAULT_CAPACITY_BYTES;
}
