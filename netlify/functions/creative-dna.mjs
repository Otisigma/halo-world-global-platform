import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createCreativeDNAHandler } from "../lib/creative-dna.mjs";
export default createCreativeDNAHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin });
export const config = { path: "/api/creative-dna" };
