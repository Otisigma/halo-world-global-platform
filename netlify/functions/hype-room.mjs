import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createHypeRoomHandler } from "../lib/hype-room.mjs";

export default createHypeRoomHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership });
export const config = { path: "/api/hype-room" };
