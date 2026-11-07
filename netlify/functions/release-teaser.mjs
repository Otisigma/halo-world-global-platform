import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createReleaseTeaserHandler } from "../lib/release-teaser.mjs";

export default createReleaseTeaserHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership });
export const config = { path: "/api/release-teaser" };
