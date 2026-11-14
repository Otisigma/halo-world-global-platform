import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createDiscovererHandler } from "../lib/discoverer-milestones.mjs";

export default createDiscovererHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership });
export const config = { path: "/api/discoverer-milestones" };
