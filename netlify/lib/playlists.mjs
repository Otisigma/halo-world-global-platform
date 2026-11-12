import { createHash, randomBytes } from "node:crypto";
import { FeedError, readBody, uuid } from "./signal-feed.mjs";
import { playlistWorld, WORLD_DEFAULTS } from "../../lib/playlist-world.js";
import { safeTrackDropArtwork, loadMemberRewards } from "./track-drops.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer", ...(status === 429 ? { "Retry-After": "60" } : {})
} });
const hash = token => createHash("sha256").update(token).digest("hex");
const tokenInput = token => {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new FeedError("Invalid playlist link.");
  return token;
};
const releaseId = id => {
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,120}$/i.test(id)) throw new FeedError("Choose a public release.");
  return id;
};
const fields = {
  create: ["action", "sourceId", "name", "releaseIds", "world"],
  update: ["action", "id", "revision", "name", "releaseIds", "world"],
  delete: ["action", "id"], share: ["action", "id", "enabled"],
  invite: ["action", "id", "role"], join: ["action", "token"],
  revoke: ["action", "id", "memberId"], leave: ["action", "id"],
  suggest: ["action", "id", "releaseId"], vote: ["action", "id", "suggestionId"],
  moderate: ["action", "id", "suggestionId", "approve"],
  room: ["action", "id", "state"], reward: ["action", "id"]
};
export function playlistMutation(body) {
  if (!Object.hasOwn(fields, body.action) || Object.keys(body).some(key => !fields[body.action].includes(key))
    || Object.keys(body).length !== fields[body.action].length) throw new FeedError("Choose a supported playlist action.");
  const input = { ...body };
  if (input.id !== undefined) input.id = uuid(input.id);
  if (input.action === "create") input.sourceId = releaseId(input.sourceId);
  if (input.action === "join") input.token = tokenInput(input.token);
  if (["create", "update"].includes(input.action)) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80
      || /[\u0000-\u001f\u007f]/.test(input.name)) throw new FeedError("Use a playlist name of 1-80 characters.");
    input.name = input.name.trim();
    if (!Array.isArray(input.releaseIds) || input.releaseIds.length > 100
      || new Set(input.releaseIds).size !== input.releaseIds.length) throw new FeedError("Choose up to 100 different public songs.");
    input.releaseIds = input.releaseIds.map(releaseId);
    try { input.world = playlistWorld(input.world); } catch (error) { throw new FeedError(error.message); }
    if (input.world.chapters.some(chapter => !input.releaseIds.includes(chapter.releaseId))) throw new FeedError("Chapter starts must be in this playlist.");
  }
  if (input.action === "update" && (!Number.isInteger(input.revision) || input.revision < 1)) throw new FeedError("Refresh the playlist before editing.");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new FeedError("Choose whether to share this playlist.");
  if (input.role !== undefined && !["editor", "contributor"].includes(input.role)) throw new FeedError("Choose an editor or contributor invitation.");
  if (input.memberId !== undefined && (typeof input.memberId !== "string" || !input.memberId.trim() || input.memberId.length > 100)) throw new FeedError("Choose a collaborator to remove.");
  if (input.releaseId !== undefined) input.releaseId = releaseId(input.releaseId);
  if (input.suggestionId !== undefined) input.suggestionId = uuid(input.suggestionId);
  if (input.approve !== undefined && typeof input.approve !== "boolean") throw new FeedError("Approve or reject the suggestion.");
  if (input.action === "room" && input.state !== null) {
    const state = input.state;
    if (!state || typeof state !== "object" || Object.keys(state).length !== 3
      || !["releaseId", "seconds", "playing"].every(key => Object.hasOwn(state, key))
      || typeof state.playing !== "boolean" || !Number.isFinite(state.seconds) || state.seconds < 0 || state.seconds > 86400) {
      throw new FeedError("Invalid listening-room state.");
    }
    input.state = { releaseId: releaseId(state.releaseId), seconds: Math.floor(state.seconds), playing: state.playing };
  }
  return input;
}

export async function loadPlaylist(db, { id, memberId, shareHash, roomOnly = false }) {
  const rows = shareHash ? await db.sql`
    SELECT p.*, 'listener' AS role FROM halo_playlists p WHERE p.share_hash = ${shareHash} LIMIT 1
  ` : await db.sql`
    SELECT p.*, CASE WHEN p.owner_member_id = ${memberId} THEN 'owner' ELSE m.role END AS role
    FROM halo_playlists p LEFT JOIN halo_playlist_members m ON m.playlist_id = p.id AND m.member_id = ${memberId}
    WHERE p.id = ${id}::uuid AND (p.owner_member_id = ${memberId} OR m.member_id IS NOT NULL) LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new FeedError("Playlist unavailable or access revoked.", 404);
  const releases = await db.sql`
    SELECT id, title, artist, artwork_url, bpm, genres, content_rating FROM halo_release_campaigns
    WHERE id = ANY(${roomOnly ? row.room ? [row.room.releaseId] : [] : row.release_ids}::text[]) AND status = 'published' AND visibility = 'public'
  `;
  const available = new Map(releases.map(release => [release.id, release]));
  const tracks = row.release_ids.map(id => {
    const release = available.get(id);
    return release ? {
      id, title: release.title, artist: release.artist, artwork: safeTrackDropArtwork(release.artwork_url),
      bpm: release.bpm == null ? null : Number(release.bpm), genres: release.genres || [],
      contentRating: release.content_rating, available: true, publicPath: `/music/?song=${encodeURIComponent(id)}`
    } : { id, available: false };
  });
  const room = row.room && available.has(row.room.releaseId) && Date.now() - Date.parse(row.room.at) < 20_000 ? row.room : null;
  if (roomOnly) return { id: row.id, room, roomRevision: row.room_revision };
  const result = {
    id: row.id, name: row.name, world: playlistWorld(row.world), tracks,
    releaseIds: row.release_ids, revision: row.revision, role: row.role, sharing: Boolean(row.share_hash),
    room, roomRevision: row.room_revision, updatedAt: new Date(row.updated_at).toISOString()
  };
  if (shareHash) {
    result.world = { ...result.world, request: "", preferences: { ...WORLD_DEFAULTS.preferences } };
    return result;
  }
  result.sourceId = row.source_id;
  const suggestions = await db.sql`
    SELECT s.id, s.release_id, r.title, r.artist,
      (SELECT COUNT(*)::int FROM halo_playlist_votes v WHERE v.suggestion_id = s.id) AS votes,
      EXISTS (SELECT 1 FROM halo_playlist_votes v WHERE v.suggestion_id = s.id AND v.member_id = ${memberId}) AS voted
    FROM halo_playlist_suggestions s
    JOIN halo_release_campaigns r ON r.id = s.release_id AND r.status = 'published' AND r.visibility = 'public'
    WHERE s.playlist_id = ${row.id}::uuid AND s.status = 'pending' ORDER BY s.created_at, s.id LIMIT 100
  `;
  result.suggestions = suggestions.map(row => ({ id: row.id, releaseId: row.release_id, title: row.title, artist: row.artist, votes: row.votes, voted: row.voted }));
  if (row.role === "owner") {
    const members = await db.sql`
      SELECT m.member_id, m.role, membership.display_name FROM halo_playlist_members m
      JOIN halo_memberships membership ON membership.member_id = m.member_id WHERE m.playlist_id = ${row.id}::uuid
      ORDER BY m.member_id LIMIT 20
    `;
    result.collaborators = members.map(row => ({ id: row.member_id, name: row.display_name, role: row.role }));
  }
  return result;
}

export function createPlaylistsHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed." }, 405);
    try {
      const url = new URL(request.url), origin = request.headers.get("origin");
      if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new FeedError("Same-origin request required.", 403);
      if (request.method === "GET") {
        const keys = [...url.searchParams.keys()];
        if (keys.length > 1 || keys.some(key => !["id", "share", "room"].includes(key))) throw new FeedError("Invalid playlist query.");
        const room = url.searchParams.get("room");
        if (url.searchParams.has("share") || (room && /^[a-f0-9]{64}$/.test(room))) {
          const shareHash = hash(tokenInput(url.searchParams.get("share") || room));
          return json({ playlist: await loadPlaylist(await getDatabase(), { shareHash, roomOnly: Boolean(room) }) });
        }
        if (room !== null) uuid(room);
        if (url.searchParams.has("id")) uuid(url.searchParams.get("id"));
      } else {
        if (url.search) throw new FeedError("Invalid playlist query.");
        let valid = false;
        try { valid = origin === url.origin && (await verifyRequestOrigin(request)) !== false; } catch {}
        if (!valid) throw new FeedError("Same-origin request required.", 403);
      }
      const input = request.method === "POST" ? playlistMutation(await readBody(request, 24_000)) : null;
      const user = await getUser();
      if (!user?.id) throw new FeedError("Sign in to sync, collaborate or claim playlist rewards.", 401);
      const db = await getDatabase();
      await ensureMembership(db, user);
      if (!input) {
        if (url.searchParams.has("id")) return json({ playlist: await loadPlaylist(db, { id: url.searchParams.get("id"), memberId: user.id }) });
        if (url.searchParams.has("room")) return json({ playlist: await loadPlaylist(db, { id: url.searchParams.get("room"), memberId: user.id, roomOnly: true }) });
        const rows = await db.sql`
          WITH accessible AS (
            SELECT id FROM halo_playlists WHERE owner_member_id = ${user.id}
            UNION SELECT playlist_id AS id FROM halo_playlist_members WHERE member_id = ${user.id}
          )
          SELECT p.id, p.name, p.source_id, p.revision, p.updated_at,
            CASE WHEN p.owner_member_id = ${user.id} THEN 'owner' ELSE m.role END AS role
          FROM accessible a JOIN halo_playlists p ON p.id = a.id
          LEFT JOIN halo_playlist_members m ON m.playlist_id = p.id AND m.member_id = ${user.id}
          ORDER BY p.updated_at DESC, p.id LIMIT 120
        `;
        const preferences = await db.sql`SELECT rewards_enabled FROM halo_member_notification_preferences WHERE member_id = ${user.id}`;
        return json({
          playlists: rows.map(row => ({ id: row.id, name: row.name, sourceId: row.source_id, revision: row.revision, role: row.role })),
          rewards: await loadMemberRewards(db, user.id, preferences[0]?.rewards_enabled === true)
        });
      }
      let token = null;
      const normalized = { ...input };
      if (input.action === "join") { normalized.tokenHash = hash(input.token); delete normalized.token; }
      if (input.action === "invite" || (input.action === "share" && input.enabled)) {
        token = randomBytes(32).toString("hex"); normalized.tokenHash = hash(token);
      }
      if (input.action === "share" && !input.enabled) normalized.tokenHash = null;
      const rows = await db.sql`SELECT halo_playlist_mutate(${user.id}, ${input.action}, ${JSON.stringify(normalized)}::jsonb) AS outcome`;
      const outcome = rows[0]?.outcome;
      const failures = {
        invalid: [400, "Invalid playlist changes."], forbidden: [403, "This action is restricted to the playlist owner or an editor."],
        not_found: [404, "Playlist or invitation unavailable."], conflict: [409, "Someone edited this playlist. Refresh before saving; your changes were not applied."],
        unavailable: [409, "A new song is no longer public. No changes applied."], name_exists: [409, "You already have a playlist with this name."],
        limit: [429, "Playlist limit reached (100 playlists, 100 songs, 20 collaborators/invitations)."],
        rate_limit: [429, "Too many playlist changes. Try again in a minute."],
        rewards_disabled: [409, "Enable member rewards in Track Drops first. No consent was changed."],
        milestone_required: [409, "Choose at least 5 public songs from at least 3 other artists for the first curator milestone."]
      };
      if (Object.hasOwn(failures, outcome?.result)) {
        const [status, message] = failures[outcome.result]; return json({ message, code: outcome.result }, status);
      }
      if (!["saved", "exists", "joined", "left", "deleted", "shared", "invited", "revoked", "room_updated", "reward_checked", "suggested", "suggestion_updated"].includes(outcome?.result)) {
        throw new Error("Missing playlist mutation result.");
      }
      // Return committed outcomes; never make a follow-up read mask a completed write/grant.
      return json({ ...outcome, ...(token ? { token } : {}) });
    } catch (error) {
      if (error instanceof FeedError) return json({ message: error.message }, error.status);
      if (error?.code === "23505") return json({ message: "Playlist name or source already exists. Refresh before saving.", code: "name_exists" }, 409);
      console.error("HALO account playlists unavailable", error instanceof Error ? error.name : "unknown error");
      return json({ message: "Account playlists are unavailable. The playlist migration and database connection must be configured. Refresh before retrying; a previous action may have completed." }, 503);
    }
  };
}
