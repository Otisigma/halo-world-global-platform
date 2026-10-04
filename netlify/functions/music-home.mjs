import { createMusicHomeHandler } from "../lib/music-home.mjs";

export default async function musicHomeHandler(request) {
  const [{ getStore }, { getDatabase }, { getUser, verifyRequestOrigin }] = await Promise.all([
    import("@netlify/blobs"), import("@netlify/database"), import("@netlify/identity")
  ]);
  return createMusicHomeHandler({ getDatabase, getUser, verifyRequestOrigin, getStore })(request);
}

export const config = { path: "/api/music-home" };
