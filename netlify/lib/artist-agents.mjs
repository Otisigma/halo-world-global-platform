import { randomUUID } from "node:crypto";
import OpenAI from "openai";

export const ARTIST_AGENT_MODEL = "gpt-5.4-mini";

export const ARTIST_AGENT_ROLES = Object.freeze({
  scout: {
    name: "Scout",
    title: "A and R",
    mission: "Read which record is actually working for this artist and say what the catalogue should do next.",
    categories: ["repertoire", "campaign"]
  },
  manager: {
    name: "Steer",
    title: "Management",
    mission: "Turn the A and R read into a dated, realistic sequence of work and flag what is slipping.",
    categories: ["campaign", "rights"]
  },
  amplifier: {
    name: "Echo",
    title: "Content and social",
    mission: "Draft the words for the artist room, radio notes, and fan updates, always grounded in a real number.",
    categories: ["content", "audience"]
  },
  circle: {
    name: "Circle",
    title: "Fan growth",
    mission: "Segment the people already following this artist and propose the specific next move for each group.",
    categories: ["audience", "content"]
  }
});

export const ARTIST_SYNTHESIS_AGENT = Object.freeze({
  key: "compass",
  name: "Compass",
  title: "Critic and briefing",
  mission: "Remove every recommendation the evidence does not support and write the artist briefing."
});

const PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const CATEGORIES = new Set(["repertoire", "campaign", "audience", "content", "rights", "risk"]);
const ACTION_STATUSES = new Set(["proposed", "approved", "in_progress", "completed", "dismissed"]);
const DRAFT_STATUSES = new Set(["proposed", "approved", "published", "dismissed"]);
const DRAFT_SURFACES = new Set(["artist_room", "radio_note", "fan_update", "press_note", "external_social"]);
const PLAN_TIERS = new Set(["starter", "solo", "pro", "label"]);
const PLAN_STATUSES = new Set(["active", "paused", "cancelled"]);

export const PLAN_TIER_DEFAULTS = Object.freeze({
  starter: { monthlyRunAllowance: 4, agents: ["scout", "circle"] },
  solo: { monthlyRunAllowance: 30, agents: ["scout", "manager", "amplifier", "circle"] },
  pro: { monthlyRunAllowance: 120, agents: ["scout", "manager", "amplifier", "circle"] },
  label: { monthlyRunAllowance: 400, agents: ["scout", "manager", "amplifier", "circle"] }
});

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value, maxLength = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanBody(value, maxLength = 4000) {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength) : "";
}

function cleanStringList(value, maxItems = 8, maxLength = 240) {
  return Array.isArray(value)
    ? value.map(item => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, numberValue(value)));
}

function safeDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function daysSince(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 86_400_000));
}

export function normalizeAgentKeys(value) {
  const keys = Array.isArray(value) ? value.map(item => cleanText(item, 32)) : [];
  const allowed = keys.filter(key => Object.hasOwn(ARTIST_AGENT_ROLES, key));
  return allowed.length ? [...new Set(allowed)] : Object.keys(ARTIST_AGENT_ROLES);
}

// Every recommendation and draft must cite at least one key from this index. A team that cannot point
// at one of the artist's own numbers is guessing, and guesses are dropped before they reach the artist.
function buildSignalIndex(signals) {
  const entries = [
    ["followers.total", "People following this artist inside HALO", signals.followers.total],
    ["followers.new7d", "New followers in the last 7 days", signals.followers.new7d],
    ["followers.new30d", "New followers in the last 30 days", signals.followers.new30d],
    ["followers.radioOptIn", "Followers who accept radio alerts", signals.followers.radioOptIn],
    ["plays.last7d", "HALO Radio plays in the last 7 days", signals.plays.last7d],
    ["plays.last30d", "HALO Radio plays in the last 30 days", signals.plays.last30d],
    ["plays.rooms30d", "Distinct radio rooms playing this artist in 30 days", signals.plays.rooms30d],
    ["plays.topTrack", "Most played track in 90 days", signals.plays.topTrack?.title || null],
    ["plays.topTrackCount", "Plays for the most played track in 90 days", signals.plays.topTrack?.plays ?? null],
    ["activity.published", "Published items in the artist room", signals.activity.published],
    ["activity.published30d", "Items published in the last 30 days", signals.activity.published30d],
    ["activity.daysSinceLast", "Days since the artist room last published anything", signals.activity.daysSinceLast],
    ["releases.published", "Published releases in the HALO catalogue", signals.releases.published],
    ["releases.latestDate", "Most recent release date", signals.releases.latestDate],
    ["releases.daysSinceLatest", "Days since the most recent release", signals.releases.daysSinceLatest],
    ["shows.published", "Radio shows attached to this artist", signals.shows.published],
    ["shows.subscribers", "Members subscribed to those shows", signals.shows.subscribers],
    ["room.views7d", "Artist room views in the last 7 days", signals.room.views7d],
    ["room.views30d", "Artist room views in the last 30 days", signals.room.views30d],
    ["room.visitors30d", "Distinct artist room visitors in 30 days", signals.room.visitors30d],
    ["page.status", "Artist room publication status", signals.page.status],
    ["page.hasRelease", "Artist room has a release link", signals.page.hasRelease],
    ["page.hasVideo", "Artist room has a video", signals.page.hasVideo]
  ];
  return entries.map(([key, label, value]) => ({ key, label, value: value ?? null }));
}

// Momentum is computed here rather than asked of the model, so the same signals always produce the
// same score and the artist can be told exactly what moved it.
export function momentumScore(signals) {
  const followerPoints = Math.min(20, numberValue(signals.followers.new30d) * 2);
  const reachPoints = Math.min(20, numberValue(signals.followers.total));
  const playPoints = Math.min(20, numberValue(signals.plays.last30d) * 2);
  const roomPoints = Math.min(10, numberValue(signals.plays.rooms30d) * 4);
  const activityPoints = Math.min(15, numberValue(signals.activity.published30d) * 3);
  const showPoints = Math.min(10, numberValue(signals.shows.published) * 5);
  const releaseRecency = signals.releases.daysSinceLatest;
  const releasePoints = releaseRecency === null ? 0 : releaseRecency <= 45 ? 10 : releaseRecency <= 120 ? 6 : 2;
  const stalePenalty = numberValue(signals.activity.daysSinceLast) > 45 ? 8 : 0;
  const total = followerPoints + reachPoints + playPoints + roomPoints + activityPoints + showPoints + releasePoints - stalePenalty;
  return Math.round(clamp(total, 0, 100));
}

export async function collectArtistSignals(db, slug) {
  const pageRows = await db.sql`
    SELECT slug, artist_name, status, release_title, release_url, video_url, release_date, updated_at
    FROM halo_artist_pages WHERE slug = ${slug} LIMIT 1
  `;
  const page = pageRows[0];
  if (!page) return null;

  const roomPath = `/artists/${slug}`;
  const [followRows, playRows, topTrackRows, activityRows, releaseRows, showRows, roomRows] = await Promise.all([
    db.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d,
        COUNT(*) FILTER (WHERE notify_radio)::int AS radio_opt_in
      FROM halo_artist_follows WHERE artist_slug = ${slug}
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days')::int AS plays_7d,
        COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days')::int AS plays_30d,
        COUNT(DISTINCT room) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days')::int AS rooms_30d
      FROM halo_radio_play_history WHERE artist_slug = ${slug}
    `,
    db.sql`
      SELECT title, COUNT(*)::int AS plays, MAX(started_at) AS last_played
      FROM halo_radio_play_history
      WHERE artist_slug = ${slug} AND started_at >= NOW() - INTERVAL '90 days'
      GROUP BY title
      ORDER BY plays DESC, last_played DESC
      LIMIT 5
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        COUNT(*) FILTER (WHERE status = 'published' AND created_at >= NOW() - INTERVAL '30 days')::int AS published_30d,
        MAX(created_at) FILTER (WHERE status = 'published') AS last_published_at
      FROM halo_artist_activity WHERE artist_slug = ${slug}
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        MAX(release_date) FILTER (WHERE status = 'published') AS latest_release_date
      FROM halo_release_campaigns WHERE artist = ${page.artist_name}
    `,
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_radio_shows WHERE artist_slug = ${slug} AND status = 'published') AS published,
        (
          SELECT COUNT(*)::int FROM halo_radio_show_subscriptions subscription
          JOIN halo_radio_shows show ON show.id = subscription.show_id
          WHERE show.artist_slug = ${slug}
        ) AS subscribers
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE event_name = 'page_view' AND created_at >= NOW() - INTERVAL '7 days')::int AS views_7d,
        COUNT(*) FILTER (WHERE event_name = 'page_view' AND created_at >= NOW() - INTERVAL '30 days')::int AS views_30d,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS visitors_30d
      FROM analytics_events WHERE page_path = ${roomPath}
    `
  ]);

  const follows = followRows[0] || {};
  const plays = playRows[0] || {};
  const activity = activityRows[0] || {};
  const releases = releaseRows[0] || {};
  const shows = showRows[0] || {};
  const room = roomRows[0] || {};
  const latestReleaseDate = dateOnly(releases.latest_release_date);

  const signals = {
    followers: {
      total: numberValue(follows.total),
      new7d: numberValue(follows.new_7d),
      new30d: numberValue(follows.new_30d),
      radioOptIn: numberValue(follows.radio_opt_in)
    },
    plays: {
      last7d: numberValue(plays.plays_7d),
      last30d: numberValue(plays.plays_30d),
      rooms30d: numberValue(plays.rooms_30d),
      topTrack: topTrackRows[0] ? { title: cleanText(topTrackRows[0].title, 160), plays: numberValue(topTrackRows[0].plays) } : null,
      trackLeaderboard: topTrackRows.map(row => ({ title: cleanText(row.title, 160), plays: numberValue(row.plays) }))
    },
    activity: {
      published: numberValue(activity.published),
      published30d: numberValue(activity.published_30d),
      daysSinceLast: daysSince(activity.last_published_at)
    },
    releases: {
      published: numberValue(releases.published),
      latestDate: latestReleaseDate,
      daysSinceLatest: latestReleaseDate ? daysSince(`${latestReleaseDate}T00:00:00Z`) : null
    },
    shows: {
      published: numberValue(shows.published),
      subscribers: numberValue(shows.subscribers)
    },
    room: {
      views7d: numberValue(room.views_7d),
      views30d: numberValue(room.views_30d),
      visitors30d: numberValue(room.visitors_30d)
    },
    page: {
      status: cleanText(page.status, 24),
      hasRelease: Boolean(page.release_url),
      hasVideo: Boolean(page.video_url),
      releaseTitle: cleanText(page.release_title, 160)
    }
  };

  return {
    artistSlug: page.slug,
    artistName: cleanText(page.artist_name, 120),
    capturedAt: new Date().toISOString(),
    signals,
    signalIndex: buildSignalIndex(signals),
    momentum: momentumScore(signals)
  };
}

function recommendationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      rationale: { type: "string" },
      category: { type: "string", enum: [...CATEGORIES] },
      priority: { type: "string", enum: [...PRIORITIES] },
      expectedMetric: { type: "string" },
      signalKeys: { type: "array", items: { type: "string" } },
      dueDate: { type: ["string", "null"] }
    },
    required: ["title", "rationale", "category", "priority", "expectedMetric", "signalKeys", "dueDate"]
  };
}

function specialistSchema(agentKey) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      agentKey: { type: "string", enum: [agentKey] },
      headline: { type: "string" },
      summary: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      recommendations: { type: "array", items: recommendationSchema() },
      drafts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            surface: { type: "string", enum: [...DRAFT_SURFACES] },
            title: { type: "string" },
            body: { type: "string" },
            signalKeys: { type: "array", items: { type: "string" } }
          },
          required: ["surface", "title", "body", "signalKeys"]
        }
      },
      risks: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      memoryUpdate: { type: "string" }
    },
    required: ["agentKey", "headline", "summary", "evidence", "recommendations", "drafts", "risks", "confidence", "memoryUpdate"]
  };
}

const COMPASS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    briefing: { type: "string" },
    confidence: { type: "number" },
    wins: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    reflection: {
      type: "object",
      additionalProperties: false,
      properties: {
        whatChanged: { type: "string" },
        whatWasWrong: { type: "string" },
        whatToLearn: { type: "string" },
        nextQuestion: { type: "string" }
      },
      required: ["whatChanged", "whatWasWrong", "whatToLearn", "nextQuestion"]
    },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentKey: { type: "string", enum: [...Object.keys(ARTIST_AGENT_ROLES), "compass"] },
          title: { type: "string" },
          rationale: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
          priority: { type: "string", enum: [...PRIORITIES] },
          expectedMetric: { type: "string" },
          signalKeys: { type: "array", items: { type: "string" } },
          dueDate: { type: ["string", "null"] }
        },
        required: ["agentKey", "title", "rationale", "category", "priority", "expectedMetric", "signalKeys", "dueDate"]
      }
    },
    memoryUpdate: { type: "string" }
  },
  required: ["briefing", "confidence", "wins", "concerns", "reflection", "priorities", "memoryUpdate"]
};

// The grounding gate. A recommendation survives only when it cites a signal key that actually exists
// for this artist, which is what keeps the output specific instead of generic advice.
export function groundRecommendation(value, fallbackAgentKey, knownKeys) {
  const signalKeys = cleanStringList(value?.signalKeys, 6, 64).filter(key => knownKeys.has(key));
  if (!signalKeys.length) return null;
  const title = cleanText(value?.title, 180);
  const rationale = cleanText(value?.rationale, 1200);
  if (!title || !rationale) return null;
  const agentKey = Object.hasOwn(ARTIST_AGENT_ROLES, value?.agentKey) || value?.agentKey === "compass"
    ? value.agentKey
    : fallbackAgentKey;
  return {
    agentKey,
    title,
    rationale,
    category: CATEGORIES.has(value?.category) ? value.category : ARTIST_AGENT_ROLES[fallbackAgentKey]?.categories[0] || "audience",
    priority: PRIORITIES.has(value?.priority) ? value.priority : "medium",
    expectedMetric: cleanText(value?.expectedMetric, 240),
    signalKeys,
    needsApproval: true,
    dueDate: safeDate(value?.dueDate)
  };
}

function groundDraft(value, knownKeys) {
  const surface = DRAFT_SURFACES.has(value?.surface) ? value.surface : "artist_room";
  const signalKeys = cleanStringList(value?.signalKeys, 6, 64).filter(key => knownKeys.has(key));
  const body = cleanBody(value?.body, 4000);
  if (!signalKeys.length || !body) return null;
  return {
    surface,
    title: cleanText(value?.title, 200),
    body,
    signalKeys,
    requiresExternalPublish: surface === "external_social"
  };
}

function normalizeSpecialist(value, agentKey, knownKeys, { fallback = false } = {}) {
  const role = ARTIST_AGENT_ROLES[agentKey];
  const proposed = Array.isArray(value?.recommendations) ? value.recommendations : [];
  const recommendations = proposed.map(item => groundRecommendation(item, agentKey, knownKeys)).filter(Boolean).slice(0, 4);
  const proposedDrafts = agentKey === "amplifier" && Array.isArray(value?.drafts) ? value.drafts : [];
  const drafts = proposedDrafts.map(item => groundDraft(item, knownKeys)).filter(Boolean).slice(0, 3);
  return {
    agentKey,
    headline: cleanText(value?.headline, 180) || `${role.name} reviewed this week's signals`,
    summary: cleanText(value?.summary, 1600) || `${role.name} did not find enough evidence for a confident recommendation.`,
    evidence: cleanStringList(value?.evidence),
    recommendations,
    drafts,
    risks: cleanStringList(value?.risks),
    confidence: clamp(value?.confidence || (fallback ? 0.35 : 0.5), 0, 1),
    memoryUpdate: cleanText(value?.memoryUpdate, 800),
    usedFallback: fallback,
    droppedRecommendations: Math.max(0, proposed.length - recommendations.length),
    droppedDrafts: Math.max(0, proposedDrafts.length - drafts.length)
  };
}

function normalizeCompass(value, findings, knownKeys) {
  const proposed = Array.isArray(value?.priorities) ? value.priorities : [];
  const priorities = proposed
    .map(item => groundRecommendation(item, item?.agentKey && Object.hasOwn(ARTIST_AGENT_ROLES, item.agentKey) ? item.agentKey : "scout", knownKeys))
    .filter(Boolean)
    .slice(0, 6);
  return {
    briefing: cleanText(value?.briefing, 2400) || "The team reviewed this artist's HALO signals and kept only the recommendations the numbers support.",
    confidence: clamp(value?.confidence || 0.5, 0, 1),
    wins: cleanStringList(value?.wins),
    concerns: cleanStringList(value?.concerns),
    reflection: {
      whatChanged: cleanText(value?.reflection?.whatChanged, 800),
      whatWasWrong: cleanText(value?.reflection?.whatWasWrong, 800),
      whatToLearn: cleanText(value?.reflection?.whatToLearn, 800),
      nextQuestion: cleanText(value?.reflection?.nextQuestion, 400)
    },
    priorities: priorities.length ? priorities : findings.flatMap(finding => finding.recommendations).slice(0, 6),
    memoryUpdate: cleanText(value?.memoryUpdate, 1000),
    droppedPriorities: Math.max(0, proposed.length - priorities.length)
  };
}

function fallbackSpecialist(agentKey, snapshot, knownKeys) {
  const role = ARTIST_AGENT_ROLES[agentKey];
  const { signals } = snapshot;
  const recommendations = [];

  if (agentKey === "scout") {
    const top = signals.plays.topTrack;
    recommendations.push(top
      ? {
        title: `Lead the next push with ${top.title}`,
        rationale: `${top.title} has ${top.plays} HALO Radio play(s) in the last 90 days, more than any other track in this room.`,
        category: "repertoire",
        priority: "high",
        expectedMetric: "Plays and follows attributed to the lead track over the next 30 days",
        signalKeys: ["plays.topTrack", "plays.topTrackCount"],
        dueDate: null
      }
      : {
        title: "Get one track into radio rotation to create a first signal",
        rationale: `This room has ${signals.plays.last30d} radio play(s) in 30 days, so there is not yet enough listening evidence to choose a lead track.`,
        category: "repertoire",
        priority: "high",
        expectedMetric: "At least one track playing in a HALO Radio room",
        signalKeys: ["plays.last30d"],
        dueDate: null
      });
  } else if (agentKey === "manager") {
    recommendations.push({
      title: signals.releases.published ? "Set a dated plan around the current release" : "Publish one release into the HALO catalogue",
      rationale: signals.releases.published
        ? `${signals.releases.published} release(s) are published and the most recent is ${signals.releases.daysSinceLatest ?? "an unknown number of"} day(s) old, so the next moves need dates rather than intentions.`
        : "No published release is attached to this artist yet, so campaign work has nothing to point at.",
      category: "campaign",
      priority: "high",
      expectedMetric: "A dated sequence covering the next 30 days",
      signalKeys: signals.releases.published ? ["releases.published", "releases.daysSinceLatest"] : ["releases.published"],
      dueDate: null
    });
  } else if (agentKey === "amplifier") {
    recommendations.push({
      title: signals.activity.published30d ? "Keep the artist room publishing weekly" : "Publish something into the artist room this week",
      rationale: `The room published ${signals.activity.published30d} item(s) in the last 30 days and was last updated ${signals.activity.daysSinceLast ?? "an unknown number of"} day(s) ago.`,
      category: "content",
      priority: signals.activity.published30d ? "medium" : "high",
      expectedMetric: "Published items per 30 days and room views",
      signalKeys: ["activity.published30d", "activity.daysSinceLast"],
      dueDate: null
    });
  } else {
    recommendations.push({
      title: signals.followers.total ? "Give existing followers one specific reason to return" : "Convert room visitors into followers",
      rationale: signals.followers.total
        ? `${signals.followers.total} member(s) follow this artist and ${signals.followers.new30d} joined in the last 30 days, so retention now matters as much as reach.`
        : `The room recorded ${signals.room.visitors30d} distinct visitor(s) in 30 days with no follows yet, so the follow moment needs to be made obvious.`,
      category: "audience",
      priority: "high",
      expectedMetric: "New follows and returning followers over 30 days",
      signalKeys: signals.followers.total ? ["followers.total", "followers.new30d"] : ["room.visitors30d", "followers.total"],
      dueDate: null
    });
  }

  return normalizeSpecialist({
    headline: `${role.name} produced a deterministic read`,
    summary: `Model inference was unavailable, so ${role.name} used this artist's recorded HALO signals to produce one conservative recommendation.`,
    evidence: [
      `${signals.followers.total} follower(s) inside HALO`,
      `${signals.plays.last30d} radio play(s) in 30 days`,
      `${signals.activity.published30d} room item(s) published in 30 days`,
      `${signals.releases.published} published release(s)`
    ],
    recommendations,
    drafts: [],
    risks: ["Confidence is lower because this read was produced without model inference."],
    confidence: 0.35,
    memoryUpdate: "Compare this deterministic baseline against the next successful run."
  }, agentKey, knownKeys, { fallback: true });
}

function fallbackCompass(findings, snapshot, knownKeys) {
  const { signals } = snapshot;
  return normalizeCompass({
    briefing: `${snapshot.artistName} has ${signals.followers.total} follower(s), ${signals.plays.last30d} radio play(s) in the last 30 days, and ${signals.activity.published30d} room update(s) in the same window. The team produced a conservative plan without model synthesis, so treat every item as a starting point rather than a settled decision.`,
    confidence: 0.38,
    wins: signals.plays.last30d ? [`The catalogue is being played inside HALO Radio ${signals.plays.last30d} time(s) per 30 days.`] : [],
    concerns: ["Model synthesis was unavailable, so recommendations were not challenged by the critic."],
    reflection: {
      whatChanged: "Today's signals were recorded as a new baseline for this artist.",
      whatWasWrong: "No earlier prediction should be treated as correct until an outcome is recorded.",
      whatToLearn: "Track which approved items actually moved follows and plays.",
      nextQuestion: "Which approved action produced the clearest movement in follows or plays?"
    },
    priorities: findings.flatMap(finding => finding.recommendations).slice(0, 6),
    memoryUpdate: "Use recorded outcomes, not recommendation volume, as the evidence of progress."
  }, findings, knownKeys);
}

async function loadArtistContext(db, slug) {
  const [memoryRows, actionRows, runRows] = await Promise.all([
    db.sql`
      SELECT agent_key, working_model, lessons, last_reflection, run_count
      FROM halo_artist_agent_memory WHERE artist_slug = ${slug}
    `,
    db.sql`
      SELECT agent_key, title, status, expected_metric, actual_outcome, artist_note, updated_at
      FROM halo_artist_agent_actions
      WHERE artist_slug = ${slug}
        AND (status IN ('completed', 'dismissed') OR actual_outcome <> '' OR artist_note <> '')
      ORDER BY updated_at DESC
      LIMIT 20
    `,
    db.sql`
      SELECT briefing, momentum_score, reflection, report_date
      FROM halo_artist_agent_runs
      WHERE artist_slug = ${slug} AND status IN ('complete', 'partial')
      ORDER BY started_at DESC
      LIMIT 1
    `
  ]);
  return {
    memory: Object.fromEntries(memoryRows.map(row => [row.agent_key, row])),
    outcomes: actionRows,
    previousRun: runRows[0] || null
  };
}

function usageFrom(completion) {
  return {
    inputTokens: numberValue(completion?.usage?.prompt_tokens),
    outputTokens: numberValue(completion?.usage?.completion_tokens)
  };
}

const GROUNDING_RULE = "Every recommendation and draft must cite one or more signalKeys taken from the supplied signalIndex. Any item without a real signal key is discarded before the artist sees it, so never invent a key or a number.";
const AUTHORITY_RULE = "You produce proposals and drafts only. You never publish, post, send, spend, sign, contract, or contact anyone. Never claim an action was taken. Never invent streams, revenue, press coverage, playlist placement, or fan quotes.";

async function runSpecialist(openai, agentKey, snapshot, context, knownKeys) {
  const role = ARTIST_AGENT_ROLES[agentKey];
  const completion = await openai.chat.completions.create({
    model: ARTIST_AGENT_MODEL,
    max_completion_tokens: 900,
    messages: [
      {
        role: "system",
        content: `You are ${role.name}, the ${role.title} agent working for one artist inside HALO. ${role.mission} ${GROUNDING_RULE} ${AUTHORITY_RULE} Prefer one to three specific, measurable moves over general advice. ${agentKey === "amplifier" ? "Write drafts in the artist's own plain voice, never hype, and keep each under 900 characters." : "Return an empty drafts array."} Return JSON only.`
      },
      {
        role: "user",
        content: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          artist: { name: snapshot.artistName, slug: snapshot.artistSlug },
          momentum: snapshot.momentum,
          signalIndex: snapshot.signalIndex,
          signals: snapshot.signals,
          priorMemory: context.memory[agentKey] || null,
          recordedOutcomes: context.outcomes.filter(item => item.agent_key === agentKey).slice(0, 8),
          previousBriefing: context.previousRun
        })
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: `halo_artist_${agentKey}`, strict: true, schema: specialistSchema(agentKey) }
    }
  }, { signal: AbortSignal.timeout(11_000) });
  return {
    finding: normalizeSpecialist(JSON.parse(completion.choices[0]?.message?.content || "{}"), agentKey, knownKeys),
    usage: usageFrom(completion)
  };
}

async function runCompass(openai, snapshot, findings, context, knownKeys) {
  const completion = await openai.chat.completions.create({
    model: ARTIST_AGENT_MODEL,
    max_completion_tokens: 1400,
    messages: [
      {
        role: "system",
        content: `You are ${ARTIST_SYNTHESIS_AGENT.name}, the critic for this artist's agent team. ${ARTIST_SYNTHESIS_AGENT.mission} Remove duplicate, generic, unsupported, or unsafe recommendations, and remove anything that would be true of any artist. Admit uncertainty plainly. Write the briefing directly to the artist in second person, in short concrete sentences. ${GROUNDING_RULE} ${AUTHORITY_RULE} Keep at most six priorities. Return JSON only.`
      },
      {
        role: "user",
        content: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          artist: { name: snapshot.artistName, slug: snapshot.artistSlug },
          momentum: snapshot.momentum,
          signalIndex: snapshot.signalIndex,
          specialistFindings: findings,
          priorMemory: context.memory.compass || null,
          recordedOutcomes: context.outcomes,
          previousBriefing: context.previousRun
        })
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "halo_artist_compass", strict: true, schema: COMPASS_SCHEMA }
    }
  }, { signal: AbortSignal.timeout(11_000) });
  return {
    synthesis: normalizeCompass(JSON.parse(completion.choices[0]?.message?.content || "{}"), findings, knownKeys),
    usage: usageFrom(completion)
  };
}

export async function loadArtistPlan(db, slug) {
  const rows = await db.sql`SELECT * FROM halo_artist_agent_plans WHERE artist_slug = ${slug} LIMIT 1`;
  return rows[0] || null;
}

function serializePlan(row) {
  if (!row) return null;
  return {
    artistSlug: row.artist_slug,
    planTier: row.plan_tier,
    status: row.status,
    enabledAgents: normalizeAgentKeys(row.enabled_agents),
    monthlyRunAllowance: numberValue(row.monthly_run_allowance),
    runsThisPeriod: numberValue(row.runs_this_period),
    runsRemaining: Math.max(0, numberValue(row.monthly_run_allowance) - numberValue(row.runs_this_period)),
    periodStartedOn: dateOnly(row.period_started_on),
    externalPublishingEnabled: Boolean(row.external_publishing_enabled),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

// Quota is rolled forward on read so a stale period never silently blocks an artist.
export async function reserveArtistRun(db, slug) {
  const rows = await db.sql`
    UPDATE halo_artist_agent_plans SET
      runs_this_period = CASE
        WHEN date_trunc('month', period_started_on) < date_trunc('month', CURRENT_DATE) THEN 1
        ELSE runs_this_period + 1
      END,
      period_started_on = CASE
        WHEN date_trunc('month', period_started_on) < date_trunc('month', CURRENT_DATE) THEN CURRENT_DATE
        ELSE period_started_on
      END,
      updated_at = NOW()
    WHERE artist_slug = ${slug}
      AND status = 'active'
      AND (
        date_trunc('month', period_started_on) < date_trunc('month', CURRENT_DATE)
        OR runs_this_period < monthly_run_allowance
      )
    RETURNING *
  `;
  return rows[0] ? serializePlan(rows[0]) : null;
}

export async function setArtistPlan(db, slug, values, memberId) {
  const planTier = PLAN_TIERS.has(values?.planTier) ? values.planTier : null;
  const status = PLAN_STATUSES.has(values?.status) ? values.status : "active";
  if (!planTier) return null;
  const defaults = PLAN_TIER_DEFAULTS[planTier];
  const enabledAgents = normalizeAgentKeys(values?.enabledAgents || defaults.agents)
    .filter(key => defaults.agents.includes(key));
  const rows = await db.sql`
    INSERT INTO halo_artist_agent_plans (
      artist_slug, plan_tier, status, enabled_agents, monthly_run_allowance, activated_by_member_id
    ) VALUES (
      ${slug}, ${planTier}, ${status}, ${JSON.stringify(enabledAgents.length ? enabledAgents : defaults.agents)}::jsonb,
      ${defaults.monthlyRunAllowance}, ${memberId || null}
    )
    ON CONFLICT (artist_slug) DO UPDATE SET
      plan_tier = EXCLUDED.plan_tier,
      status = EXCLUDED.status,
      enabled_agents = EXCLUDED.enabled_agents,
      monthly_run_allowance = EXCLUDED.monthly_run_allowance,
      updated_at = NOW()
    RETURNING *
  `;
  return serializePlan(rows[0]);
}

export async function runArtistAgentTeam(db, slug, { triggerType = "scheduled", plan = null } = {}) {
  const snapshot = await collectArtistSignals(db, slug);
  if (!snapshot) return null;

  const activePlan = plan || serializePlan(await loadArtistPlan(db, slug));
  const enabledAgents = activePlan ? activePlan.enabledAgents : Object.keys(ARTIST_AGENT_ROLES);
  const knownKeys = new Set(snapshot.signalIndex.map(entry => entry.key));
  const runId = randomUUID();
  const reportDate = new Date().toISOString().slice(0, 10);

  await db.sql`
    INSERT INTO halo_artist_agent_runs (id, artist_slug, report_date, trigger_type, status, model, signals, momentum_score)
    VALUES (${runId}, ${slug}, ${reportDate}, ${triggerType}, 'running', ${ARTIST_AGENT_MODEL},
            ${JSON.stringify({ signals: snapshot.signals, signalIndex: snapshot.signalIndex })}::jsonb, ${snapshot.momentum})
  `;

  const context = await loadArtistContext(db, slug);
  let openai;
  try {
    openai = new OpenAI();
  } catch {
    openai = null;
  }

  const totals = { inputTokens: 0, outputTokens: 0, inferenceCalls: 0, fallbackCalls: 0 };
  const findings = await Promise.all(enabledAgents.map(async agentKey => {
    if (!openai) {
      totals.fallbackCalls += 1;
      return fallbackSpecialist(agentKey, snapshot, knownKeys);
    }
    try {
      const { finding, usage } = await runSpecialist(openai, agentKey, snapshot, context, knownKeys);
      totals.inferenceCalls += 1;
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      return finding;
    } catch (error) {
      totals.fallbackCalls += 1;
      console.error(`HALO artist agent ${agentKey} inference failed`, error instanceof Error ? error.message : "unknown error");
      return fallbackSpecialist(agentKey, snapshot, knownKeys);
    }
  }));

  let synthesis;
  let compassFallback = false;
  try {
    if (openai) {
      const result = await runCompass(openai, snapshot, findings, context, knownKeys);
      synthesis = result.synthesis;
      totals.inferenceCalls += 1;
      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
    } else {
      compassFallback = true;
      totals.fallbackCalls += 1;
      synthesis = fallbackCompass(findings, snapshot, knownKeys);
    }
  } catch (error) {
    compassFallback = true;
    totals.fallbackCalls += 1;
    console.error("HALO artist Compass inference failed", error instanceof Error ? error.message : "unknown error");
    synthesis = fallbackCompass(findings, snapshot, knownKeys);
  }

  for (const finding of findings) {
    await db.sql`
      INSERT INTO halo_artist_agent_findings (
        run_id, artist_slug, agent_key, headline, summary, evidence, recommendations, risks, confidence, used_fallback
      ) VALUES (
        ${runId}, ${slug}, ${finding.agentKey}, ${finding.headline}, ${finding.summary},
        ${JSON.stringify(finding.evidence)}::jsonb, ${JSON.stringify(finding.recommendations)}::jsonb,
        ${JSON.stringify(finding.risks)}::jsonb, ${finding.confidence}, ${finding.usedFallback}
      )
    `;
    for (const draft of finding.drafts) {
      await db.sql`
        INSERT INTO halo_artist_agent_drafts (
          run_id, artist_slug, agent_key, surface, title, body, signal_keys, requires_external_publish
        ) VALUES (
          ${runId}, ${slug}, ${finding.agentKey}, ${draft.surface}, ${draft.title}, ${draft.body},
          ${JSON.stringify(draft.signalKeys)}::jsonb, ${draft.requiresExternalPublish}
        )
      `;
    }
  }

  for (const action of synthesis.priorities) {
    await db.sql`
      INSERT INTO halo_artist_agent_actions (
        run_id, artist_slug, agent_key, title, rationale, category, priority, needs_approval, expected_metric, signal_keys, due_date
      ) VALUES (
        ${runId}, ${slug}, ${action.agentKey}, ${action.title}, ${action.rationale}, ${action.category},
        ${action.priority}, TRUE, ${action.expectedMetric}, ${JSON.stringify(action.signalKeys)}::jsonb, ${action.dueDate}
      )
    `;
  }

  for (const finding of findings) {
    await updateArtistMemory(db, slug, finding.agentKey, finding.memoryUpdate, {
      headline: finding.headline,
      summary: finding.summary,
      risks: finding.risks,
      recommendations: finding.recommendations.map(item => ({ title: item.title, expectedMetric: item.expectedMetric }))
    });
  }
  await updateArtistMemory(db, slug, "compass", synthesis.memoryUpdate, {
    momentum: snapshot.momentum,
    briefing: synthesis.briefing,
    risks: synthesis.concerns,
    nextQuestion: synthesis.reflection.nextQuestion
  });

  const grounding = {
    signalKeysAvailable: knownKeys.size,
    recommendationsKept: synthesis.priorities.length,
    recommendationsDropped: findings.reduce((total, finding) => total + finding.droppedRecommendations, 0) + synthesis.droppedPriorities,
    draftsDropped: findings.reduce((total, finding) => total + finding.droppedDrafts, 0)
  };
  const status = totals.fallbackCalls ? "partial" : "complete";
  const errorSummary = status === "partial"
    ? `${totals.fallbackCalls} deterministic fallback(s); critic fallback: ${compassFallback ? "yes" : "no"}.`
    : "";

  await db.sql`
    UPDATE halo_artist_agent_runs SET
      status = ${status},
      briefing = ${synthesis.briefing},
      confidence = ${synthesis.confidence},
      wins = ${JSON.stringify(synthesis.wins)}::jsonb,
      concerns = ${JSON.stringify(synthesis.concerns)}::jsonb,
      reflection = ${JSON.stringify(synthesis.reflection)}::jsonb,
      grounding = ${JSON.stringify(grounding)}::jsonb,
      input_tokens = ${totals.inputTokens},
      output_tokens = ${totals.outputTokens},
      inference_calls = ${totals.inferenceCalls},
      fallback_calls = ${totals.fallbackCalls},
      error_summary = ${errorSummary},
      completed_at = NOW()
    WHERE id = ${runId}
  `;

  return {
    id: runId,
    artistSlug: slug,
    artistName: snapshot.artistName,
    reportDate,
    status,
    model: ARTIST_AGENT_MODEL,
    momentum: snapshot.momentum,
    grounding,
    usage: totals,
    findings,
    synthesis
  };
}

function serializeRun(row) {
  return {
    id: row.id,
    reportDate: dateOnly(row.report_date),
    triggerType: row.trigger_type,
    status: row.status,
    model: row.model,
    momentum: numberValue(row.momentum_score),
    briefing: row.briefing,
    confidence: numberValue(row.confidence),
    wins: row.wins || [],
    concerns: row.concerns || [],
    reflection: row.reflection || {},
    grounding: row.grounding || {},
    usage: {
      inputTokens: numberValue(row.input_tokens),
      outputTokens: numberValue(row.output_tokens),
      inferenceCalls: numberValue(row.inference_calls),
      fallbackCalls: numberValue(row.fallback_calls)
    },
    errorSummary: row.error_summary,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  };
}

function serializeAction(row) {
  return {
    id: numberValue(row.id),
    runId: row.run_id,
    agentKey: row.agent_key,
    title: row.title,
    rationale: row.rationale,
    category: row.category,
    priority: row.priority,
    status: row.status,
    needsApproval: Boolean(row.needs_approval),
    expectedMetric: row.expected_metric,
    signalKeys: row.signal_keys || [],
    artistNote: row.artist_note,
    actualOutcome: row.actual_outcome,
    dueDate: dateOnly(row.due_date),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function serializeDraft(row) {
  return {
    id: numberValue(row.id),
    runId: row.run_id,
    agentKey: row.agent_key,
    surface: row.surface,
    title: row.title,
    body: row.body,
    signalKeys: row.signal_keys || [],
    status: row.status,
    requiresExternalPublish: Boolean(row.requires_external_publish),
    disclosure: row.disclosure,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export async function loadArtistAgentDashboard(db, slug) {
  const [planRow, runRows, findingRows, actionRows, draftRows, memoryRows] = await Promise.all([
    loadArtistPlan(db, slug),
    db.sql`SELECT * FROM halo_artist_agent_runs WHERE artist_slug = ${slug} ORDER BY started_at DESC LIMIT 12`,
    db.sql`
      SELECT * FROM halo_artist_agent_findings
      WHERE run_id = (SELECT id FROM halo_artist_agent_runs WHERE artist_slug = ${slug} ORDER BY started_at DESC LIMIT 1)
      ORDER BY id
    `,
    db.sql`
      SELECT * FROM halo_artist_agent_actions
      WHERE artist_slug = ${slug}
        AND (status IN ('proposed', 'approved', 'in_progress')
             OR run_id = (SELECT id FROM halo_artist_agent_runs WHERE artist_slug = ${slug} ORDER BY started_at DESC LIMIT 1))
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT 40
    `,
    db.sql`
      SELECT * FROM halo_artist_agent_drafts
      WHERE artist_slug = ${slug} AND status <> 'dismissed'
      ORDER BY created_at DESC LIMIT 20
    `,
    db.sql`SELECT * FROM halo_artist_agent_memory WHERE artist_slug = ${slug} ORDER BY agent_key`
  ]);

  const snapshot = await collectArtistSignals(db, slug);
  return {
    artistSlug: slug,
    artistName: snapshot?.artistName || "",
    roles: Object.fromEntries(Object.entries(ARTIST_AGENT_ROLES).map(([key, role]) => [key, { ...role }])),
    criticAgent: { ...ARTIST_SYNTHESIS_AGENT },
    plan: serializePlan(planRow),
    planTiers: PLAN_TIER_DEFAULTS,
    signals: snapshot?.signals || null,
    signalIndex: snapshot?.signalIndex || [],
    momentum: snapshot?.momentum ?? 0,
    latestRun: runRows[0] ? serializeRun(runRows[0]) : null,
    history: runRows.map(serializeRun),
    findings: findingRows.map(row => ({
      agentKey: row.agent_key,
      headline: row.headline,
      summary: row.summary,
      evidence: row.evidence || [],
      recommendations: row.recommendations || [],
      risks: row.risks || [],
      confidence: numberValue(row.confidence),
      usedFallback: Boolean(row.used_fallback)
    })),
    actions: actionRows.map(serializeAction),
    drafts: draftRows.map(serializeDraft),
    memory: memoryRows.map(row => ({
      agentKey: row.agent_key,
      workingModel: row.working_model || {},
      lessons: row.lessons || [],
      lastReflection: row.last_reflection,
      runCount: numberValue(row.run_count),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
    }))
  };
}

async function updateArtistMemory(db, slug, agentKey, reflection, workingModel) {
  const lessons = cleanStringList(workingModel?.risks || [], 6, 240);
  await db.sql`
    INSERT INTO halo_artist_agent_memory (artist_slug, agent_key, working_model, lessons, last_reflection, run_count)
    VALUES (${slug}, ${agentKey}, ${JSON.stringify(workingModel || {})}::jsonb, ${JSON.stringify(lessons)}::jsonb, ${reflection}, 1)
    ON CONFLICT (artist_slug, agent_key) DO UPDATE SET
      working_model = EXCLUDED.working_model,
      lessons = EXCLUDED.lessons,
      last_reflection = EXCLUDED.last_reflection,
      run_count = halo_artist_agent_memory.run_count + 1,
      updated_at = NOW()
  `;
}

export async function updateArtistAction(db, slug, actionId, values) {
  const id = Math.trunc(numberValue(actionId));
  const status = ACTION_STATUSES.has(values?.status) ? values.status : null;
  if (!id || !status) return null;
  const rows = await db.sql`
    UPDATE halo_artist_agent_actions SET
      status = ${status},
      artist_note = ${cleanText(values?.artistNote, 1200)},
      actual_outcome = ${cleanText(values?.actualOutcome, 1200)},
      completed_at = CASE WHEN ${status} = 'completed' THEN NOW() ELSE NULL END,
      updated_at = NOW()
    WHERE id = ${id} AND artist_slug = ${slug}
    RETURNING *
  `;
  return rows[0] ? serializeAction(rows[0]) : null;
}

// Approval is the only path out of 'proposed', and it always records who approved it. Publishing to an
// external channel stays a human act: HALO stores the approved words, it does not send them anywhere.
export async function updateArtistDraft(db, slug, draftId, values, memberId) {
  const id = Math.trunc(numberValue(draftId));
  const status = DRAFT_STATUSES.has(values?.status) ? values.status : null;
  if (!id || !status) return null;
  if (status !== "dismissed" && status !== "proposed" && !memberId) return null;
  const body = typeof values?.body === "string" ? cleanBody(values.body, 4000) : null;
  const approver = status === "approved" || status === "published" ? memberId : null;
  const rows = await db.sql`
    UPDATE halo_artist_agent_drafts SET
      status = ${status},
      body = COALESCE(${body}, body),
      approved_by_member_id = CASE WHEN ${approver}::text IS NULL THEN approved_by_member_id ELSE ${approver} END,
      approved_at = CASE WHEN ${approver}::text IS NULL THEN approved_at ELSE NOW() END,
      updated_at = NOW()
    WHERE id = ${id} AND artist_slug = ${slug}
    RETURNING *
  `;
  return rows[0] ? serializeDraft(rows[0]) : null;
}

export async function listActiveArtistPlans(db, limit = 12) {
  const rows = await db.sql`
    SELECT plan.* FROM halo_artist_agent_plans plan
    JOIN halo_artist_pages page ON page.slug = plan.artist_slug
    WHERE plan.status = 'active' AND page.status = 'published'
    ORDER BY plan.updated_at DESC
    LIMIT ${Math.trunc(clamp(limit, 1, 50))}
  `;
  return rows.map(serializePlan);
}
