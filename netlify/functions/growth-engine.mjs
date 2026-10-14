import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createGrowthHandler } from "../lib/growth-engine-http.mjs";

export default createGrowthHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership });
export const config = { path: "/api/growth-engine" };
