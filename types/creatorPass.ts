export type SubscriptionTier = "STANDARD" | "PREMIUM";
export type SubscriptionStatus = "inactive" | "trialing" | "active" | "past_due" | "canceled" | "expired";

export interface CreatorPassEntitlements {
  smartSplitsEnabled: boolean;
  aiGuardianAccess: boolean;
  priorityDiscovery: boolean;
  customArtistRoom: boolean;
  dynamicBriefSurfacing: boolean;
  unlimitedVault: boolean;
  verifiedPremiumBadge: boolean;
}

export interface CreatorPass {
  creatorId: string;
  displayName: string;
  roles: string[];
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  trialEndsAt: string | null;
  vaultCapacityBytes: number | null;
  entitlements: CreatorPassEntitlements;
}
