import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { ensureMembership } from "../lib/halo-x.mjs";
import { authorizeStatsAdmin } from "../lib/stats.mjs";
import { createIndustryWireHandler } from "../lib/industry-wire.mjs";

export default createIndustryWireHandler({
  getDatabase,
  getUser,
  ensureMembership,
  authorizeOperator: authorizeStatsAdmin,
  getStore: () => getStore({ name: "halo-industry-wire", consistency: "strong" })
});

export const config = { path: "/api/industry-wire" };
