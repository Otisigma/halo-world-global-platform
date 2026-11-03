import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createFanCurationsHandler } from "../lib/fan-curations.mjs";

export default createFanCurationsHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership });
export const config = { path: ["/api/fan-curations", "/api/fan-curations/card", "/api/fan-curations/preview"] };
