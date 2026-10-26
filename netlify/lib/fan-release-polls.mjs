import { appendLedgerEntry } from "./halo-ledger.mjs";
import { REWARD_TIERS, loadMemberRewards } from "./track-drops.mjs";

// Release-consideration polls are an opt-in Campaign Studio purpose. Ranked, signed-in members recommend
// which eligible catalog song the artist team should consider next. The result is advisory only: nothing in
// this module publishes, distributes, sets chart eligibility, or touches the publication/reconcile pipeline.
export const LISTENING_PARTY_PURPOSE = "listening_party";
export const RELEASE_POLL_PURPOSE = "release_consideration";
export const RELEASE_POLL_MIN_TIER = REWARD_TIERS.find(tier => tier.id === "insider");
export const RELEASE_POLL_MIN_POINTS = RELEASE_POLL_MIN_TIER.minPoints;
export const RELEASE_POLL_RESULT_LABEL = "Fan recommendation / awaiting artist-team decision";
export const RELEASE_POLL_DECISION_STATUS = "awaiting_artist_team_decision";
export const RELEASE_POLL_REVIEW_PATH = "/song-catalog/";
export const RELEASE_POLL_VOTE_RATE_LIMIT = 10;
export const RELEASE_POLL_RULES = Object.freeze([
  `Eligibility: ${RELEASE_POLL_MIN_TIER.label} (${RELEASE_POLL_MIN_POINTS} earned points) or higher, with HALO member rewards turned on.`,
  "One vote per signed-in member. You can change your choice until the poll closes; only your latest choice counts.",
  "Every eligible vote counts once. A higher reward tier unlocks voting but never adds weight.",
  "Voting does not earn reward points.",
  "The result advises the artist and team. It does not publish the song, release it, or send it to Spotify, Apple Music, or any other service.",
  "Ties are not broken automatically; the artist team reviews them."
]);

const MAX_CANDIDATES = 20;
const MAX_DURATION_SECONDS = 7200;

function boundedDuration(value) {
  const seconds = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(MAX_DURATION_SECONDS, seconds));
}

export function isReleasePoll(campaign) {
  return campaign?.purpose === RELEASE_POLL_PURPOSE;
}

export function releasePollMinPoints(campaign) {
  return Math.max(RELEASE_POLL_MIN_POINTS, Math.floor(Number(campaign?.voter_min_reward_points) || 0));
}

/**
 * Recomputes a member's release-poll eligibility from persisted reward data on every call.
 * Client-submitted rank or points are never consulted. Only the member's own status is returned.
 */
export async function loadReleasePollEligibility(db, memberId, minPoints = RELEASE_POLL_MIN_POINTS) {
  const required = Math.max(RELEASE_POLL_MIN_POINTS, Math.floor(Number(minPoints) || 0));
  const requiredTier = { id: RELEASE_POLL_MIN_TIER.id, label: RELEASE_POLL_MIN_TIER.label, minPoints: required };
  if (!memberId) return { eligible: false, reason: "sign_in_required", tier: null, requiredTier, pointsToGo: required };
  const preferences = await db.sql`
    SELECT rewards_enabled FROM halo_member_notification_preferences
    WHERE member_id = ${memberId}
    LIMIT 1
  `;
  const rewardsEnabled = preferences[0]?.rewards_enabled === true;
  const rewards = await loadMemberRewards(db, memberId, rewardsEnabled);
  if (!rewardsEnabled) return { eligible: false, reason: "rewards_disabled", tier: null, requiredTier, pointsToGo: required };
  const pointsToGo = Math.max(0, required - rewards.points);
  return {
    eligible: pointsToGo === 0,
    reason: pointsToGo === 0 ? "eligible" : "rank_required",
    tier: rewards.tier ? { id: rewards.tier.id, label: rewards.tier.label } : null,
    requiredTier,
    pointsToGo
  };
}

export function releasePollEligibilityMessage(eligibility) {
  if (eligibility?.eligible) return `You're eligible as ${eligibility.tier?.label || "a ranked member"}. One vote per member; it advises the artist team.`;
  const required = eligibility?.requiredTier || { label: RELEASE_POLL_MIN_TIER.label, minPoints: RELEASE_POLL_MIN_POINTS };
  if (eligibility?.reason === "sign_in_required") return `Sign in with your HALO account to vote. ${required.label} (${required.minPoints} earned points) or higher is required.`;
  if (eligibility?.reason === "rewards_disabled") return `Turn on HALO member rewards in Track Drops to vote. ${required.label} (${required.minPoints} earned points) or higher is required.`;
  return `This poll is open to ${required.label} (${required.minPoints} earned points) or higher. You're ${eligibility?.pointsToGo ?? required.minPoints} points away.`;
}

/**
 * Conservative candidate check against the real catalog schema. A song qualifies only when it is an active
 * halo_song_catalog record owned by the requesting artist team (or any song for a HALO owner), its rights are
 * cleared, Dream Weaver metadata review found no required blockers ("ready" or "reviewed"), it has an active
 * approved sale master with connected audio, and it is not already published.
 */
export async function loadReleaseCandidates(db, { memberId, owner = false, songIds = null } = {}) {
  const ids = Array.isArray(songIds) ? songIds.slice(0, MAX_CANDIDATES) : null;
  const rows = ids
    ? await db.sql`
        SELECT song.id, song.title, song.artist_name, song.genre, master.duration_seconds
        FROM halo_song_catalog song
        JOIN LATERAL (
          SELECT version.duration_seconds
          FROM halo_song_versions version
          WHERE version.song_id = song.id
            AND version.status = 'active'
            AND version.version_type = 'sale_master'
            AND version.mastering_status = 'approved'
            AND (COALESCE(version.audio_url, '') <> '' OR COALESCE(version.audio_blob_prefix, '') <> ''
              OR COALESCE(version.audio_storage_key, '') <> '')
          LIMIT 1
        ) master ON TRUE
        WHERE song.id = ANY(${ids}::text[])
          AND song.status = 'active'
          AND song.rights_status = 'cleared'
          AND song.metadata_status IN ('ready', 'reviewed')
          AND song.pipeline_status <> 'published'
          AND (${owner} OR song.owner_member_id = ${memberId})
      `
    : await db.sql`
        SELECT song.id, song.title, song.artist_name, song.genre, master.duration_seconds
        FROM halo_song_catalog song
        JOIN LATERAL (
          SELECT version.duration_seconds
          FROM halo_song_versions version
          WHERE version.song_id = song.id
            AND version.status = 'active'
            AND version.version_type = 'sale_master'
            AND version.mastering_status = 'approved'
            AND (COALESCE(version.audio_url, '') <> '' OR COALESCE(version.audio_blob_prefix, '') <> ''
              OR COALESCE(version.audio_storage_key, '') <> '')
          LIMIT 1
        ) master ON TRUE
        WHERE song.status = 'active'
          AND song.rights_status = 'cleared'
          AND song.metadata_status IN ('ready', 'reviewed')
          AND song.pipeline_status <> 'published'
          AND (${owner} OR song.owner_member_id = ${memberId})
        ORDER BY song.updated_at DESC
        LIMIT 50
      `;
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    artist: row.artist_name,
    genre: row.genre || "",
    durationSeconds: boundedDuration(row.duration_seconds)
  }));
}

export function defaultReleasePollPromotion({ title, candidateCount }) {
  const count = Number(candidateCount) || 0;
  return {
    eyebrow: "HALO RELEASE CONSIDERATION POLL",
    headline: `${count} candidates. Your recommendation. The artist team decides.`,
    caption: `${title} is open to ${RELEASE_POLL_MIN_TIER.label} members and above. Recommend which song the artist team should consider next. One vote per member; the result is advisory and does not publish anything.`,
    storyTitle: "RECOMMEND THE NEXT RELEASE",
    storySubtitle: `${count} candidates · ${RELEASE_POLL_MIN_TIER.label}+ members · advisory`,
    callToAction: "Recommend. The artist team decides.",
    hashtags: "#HALOFanRecommendation"
  };
}

/**
 * Deterministic tally. Leaders are every candidate sharing the top count, listed in shortlist order.
 * Ties are reported as unresolved for human review; no tie-break and no publish decision is made here.
 */
export function releasePollRecommendation(tracks) {
  const ranked = [...(tracks || [])]
    .map(track => ({
      trackId: Number(track.id),
      title: String(track.title || ""),
      artist: String(track.artist ?? track.artist_name ?? ""),
      position: Number(track.position) || 0,
      votes: Math.max(0, Number(track.votes) || 0)
    }))
    .sort((a, b) => b.votes - a.votes || a.position - b.position);
  const totalVotes = ranked.reduce((sum, track) => sum + track.votes, 0);
  const top = ranked[0]?.votes || 0;
  const leaders = top > 0 ? ranked.filter(track => track.votes === top) : [];
  const outcome = !totalVotes ? "no_votes" : leaders.length > 1 ? "tie" : "leader";
  const note = outcome === "tie"
    ? "Tie — unresolved. HALO does not break ties; the artist team will review the tied songs."
    : outcome === "no_votes"
      ? "No eligible votes were cast. The artist team decides without a fan recommendation."
      : "Fans recommended this song. The artist team will review rights, consent, metadata, and release readiness before any decision.";
  return {
    label: RELEASE_POLL_RESULT_LABEL,
    decisionStatus: RELEASE_POLL_DECISION_STATUS,
    advisory: true,
    outcome,
    totalVotes,
    leaders,
    standings: ranked,
    note
  };
}

/** Public-safe view of a stored or computed recommendation. */
export function publicRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object") return null;
  const clean = item => ({
    trackId: Number(item?.trackId) || 0,
    title: String(item?.title || "").slice(0, 140),
    artist: String(item?.artist || "").slice(0, 140),
    votes: Math.max(0, Number(item?.votes) || 0)
  });
  return {
    label: RELEASE_POLL_RESULT_LABEL,
    decisionStatus: RELEASE_POLL_DECISION_STATUS,
    advisory: true,
    outcome: ["leader", "tie", "no_votes"].includes(recommendation.outcome) ? recommendation.outcome : "no_votes",
    totalVotes: Math.max(0, Number(recommendation.totalVotes) || 0),
    leaders: Array.isArray(recommendation.leaders) ? recommendation.leaders.slice(0, 20).map(clean) : [],
    note: String(recommendation.note || "").slice(0, 300)
  };
}

/**
 * Records a member's single current choice and an audit event in one statement. The window, purpose, and
 * member identity are re-checked by the statement itself and by the database vote guard. No reward points are granted.
 */
export async function castReleasePollVote(db, { campaign, memberId, trackId }) {
  if (!memberId) return { status: 401, body: { message: "Sign in with your HALO account to vote in release-consideration polls" } };
  const eligibility = await loadReleasePollEligibility(db, memberId, releasePollMinPoints(campaign));
  if (!eligibility.eligible) {
    return { status: 403, body: { message: releasePollEligibilityMessage(eligibility), eligibility } };
  }
  const recent = await db.sql`
    SELECT COUNT(*)::int AS count FROM halo_fan_release_poll_vote_events
    WHERE campaign_id = ${campaign.id} AND member_id = ${memberId} AND created_at >= NOW() - INTERVAL '10 minutes'
  `;
  if (Number(recent[0]?.count || 0) >= RELEASE_POLL_VOTE_RATE_LIMIT) {
    return { status: 429, body: { message: "Too many vote changes. Please wait a few minutes and try again." } };
  }
  const voterKey = `member:${memberId}`;
  let rows;
  try {
    rows = await castVoteStatement(db, { campaign, memberId, trackId, voterKey, tierId: eligibility.tier?.id || RELEASE_POLL_MIN_TIER.id });
  } catch (error) {
    // The database guard re-checks identity, rank, opt-in, and the vote window; map its refusals to safe messages.
    const code = /release_poll_[a-z_]+/.exec(error instanceof Error ? error.message : "")?.[0];
    if (code === "release_poll_closed") return { status: 409, body: { message: "This poll is not accepting votes" } };
    if (code) return { status: 403, body: { message: releasePollEligibilityMessage({ ...eligibility, eligible: false, reason: "rank_required" }) } };
    throw error;
  }
  if (!rows[0]) return { status: 409, body: { message: "This poll is not accepting votes" } };
  return { status: 200, eligibility, trackId: Number(rows[0].campaign_track_id) };
}

async function castVoteStatement(db, { campaign, memberId, trackId, voterKey, tierId }) {
  return db.sql`
    WITH vote AS (
      INSERT INTO halo_fan_vote_campaign_votes (campaign_id, campaign_track_id, voter_key, member_id)
      SELECT ${campaign.id}, track.id, ${voterKey}, ${memberId}
      FROM halo_fan_vote_campaign_tracks track
      JOIN halo_fan_vote_campaigns poll ON poll.id = track.campaign_id
      WHERE track.id = ${trackId} AND track.campaign_id = ${campaign.id}
        AND poll.purpose = 'release_consideration' AND poll.status = 'published'
        AND poll.starts_at <= NOW() AND poll.ends_at > NOW()
      ON CONFLICT (campaign_id, voter_key) DO UPDATE SET
        campaign_track_id = EXCLUDED.campaign_track_id,
        updated_at = NOW()
      RETURNING campaign_track_id
    ), audit AS (
      INSERT INTO halo_fan_release_poll_vote_events (campaign_id, campaign_track_id, member_id, reward_tier)
      SELECT ${campaign.id}, vote.campaign_track_id, ${memberId}, ${tierId}
      FROM vote
      RETURNING id
    )
    SELECT vote.campaign_track_id, (SELECT COUNT(*)::int FROM audit) AS audited
    FROM vote
  `;
}

/**
 * Closes a release poll and records the advisory recommendation once. Closing first means the database vote
 * guard rejects any later vote, so the tally reflects every accepted vote. No release or publication row is touched.
 */
export async function recordReleasePollRecommendation(db, { campaignId, tracks, actorId }) {
  const recommendation = releasePollRecommendation(tracks);
  const rows = await db.sql`
    UPDATE halo_fan_vote_campaigns
    SET recommendation = ${JSON.stringify(recommendation)}::jsonb, recommendation_recorded_at = NOW(), updated_at = NOW()
    WHERE id = ${campaignId} AND purpose = 'release_consideration' AND status = 'closed' AND recommendation IS NULL
    RETURNING *
  `;
  if (rows[0]) {
    try {
      await appendLedgerEntry(db, {
        actorId,
        actorType: "member",
        eventCategory: "system_event",
        summary: `Fan release recommendation recorded (${recommendation.outcome}); awaiting artist-team decision`,
        details: { campaignId, outcome: recommendation.outcome, totalVotes: recommendation.totalVotes, leaderTrackIds: recommendation.leaders.map(leader => leader.trackId) },
        outcome: "pending"
      });
    } catch (error) {
      console.warn("HALO release poll ledger entry skipped", error instanceof Error ? error.message : "unknown error");
    }
  }
  return rows[0] || null;
}
