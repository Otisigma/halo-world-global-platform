import { getStore } from "@netlify/blobs";
import { createShieldHandler } from "../lib/halo-shield.mjs";

export default createShieldHandler({
  getStore: () => getStore({ name: "halo-shield-private", consistency: "strong" })
});

export const config = { path: "/api/halo-shield" };
