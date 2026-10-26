import { getStore } from "@netlify/blobs";
import { authorizeStatsAdmin } from "../lib/stats.mjs";
import { createShieldHandler } from "../lib/halo-shield.mjs";

export default createShieldHandler({
  getStore: () => getStore({ name: "halo-shield-private", consistency: "strong" }),
  authorize: authorizeStatsAdmin,
  internal: true
});

export const config = { path: "/api/halo-shield/internal" };
