import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createCreatorNetworkHandler } from "../lib/creator-network.mjs";

export default createCreatorNetworkHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin });
export const config = { path: "/api/creator-network" };
