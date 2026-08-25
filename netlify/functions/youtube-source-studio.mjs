import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import OpenAI from "openai";
import { ensureMembership } from "../lib/halo-x.mjs";

const MODEL = "gpt-5.2";
const MAX_BODY_BYTES = 48_000;
const sourceTypes = new Set(["channel", "playlist", "short", "video"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanId(value) {
  const id = cleanText(value, 40).toLowerCase();
  return /^[0-9a-f-]{36}$/.test(id) ? id : "";
}

function youtubeUrl(value, required = true) {
  const raw = cleanText(value, 500);
  if (!raw && !required) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function inferType(urlValue) {
  const url = new URL(urlValue);
  if (url.hostname.endsWith("youtu.be")) return "video";
  if (url.pathname.startsWith("/shorts/")) return "short";
  if (url.pathname === "/playlist" || url.searchParams.has("list")) return "playlist";
  if (/^\/(channel|@|c\/|user\/)/.test(url.pathname)) return "channel";
  return "video";
}

function sourcePayload(row) {
  return {
    id: row.id,
    label: row.label,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    channelUrl: row.channel_url,
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function briefPayload(row) {
  return {
    id: row.id,
    title: row.title,
    campaignGoal: row.campaign_goal,
    audience: row.audience,
    channelUrl: row.channel_url,
    sourceIds: row.source_ids || [],
    brief: row.brief || {},
    model: row.model,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function fallbackBrief({ title, goal, audience, channelUrl, sources }) {
  const sourceName = sources[0]?.label || "the selected YouTube material";
  const secondary = sources[1]?.label || sourceName;
  return {
    northStar: `Turn ${sourceName} into a connected short-form trail that earns attention, gives each clip one job, and sends interested viewers to the full YouTube channel.`,
    channelCta: `Watch the full story and explore the complete channel: ${channelUrl}`,
    shortConcepts: [
      { title: "The instant hook", sourceLabel: sourceName, duration: "15–20 seconds", opening: "Open on the strongest visual or sentence with no introduction.", cutPlan: "Hook, one proof moment, clean channel invitation.", caption: `${title}: start with the moment that makes people stop, then give them the full route.` },
      { title: "The context cut", sourceLabel: secondary, duration: "25–35 seconds", opening: "Lead with the question the full video answers.", cutPlan: "Question, revealing detail, unresolved final beat, channel invitation.", caption: `${goal} — one useful piece now, the complete story on YouTube.` },
      { title: "The three-beat montage", sourceLabel: sourceName, duration: "20–30 seconds", opening: "Stack three distinct moments under one clear promise.", cutPlan: "Three fast beats, title card, direct channel CTA.", caption: `Three reasons to enter the world. The full playlist lives on the channel.` }
    ],
    deliverables: ["3 vertical Shorts/Reels/TikToks", "3 alternate opening hooks", "1 caption set with channel link", "1 weekly posting sequence", "1 source-to-output map"],
    publishingSequence: ["Publish the strongest standalone hook first.", "Follow with a context clip that answers one question.", "Use the montage as the bridge into the playlist or channel.", "Reuse the best-performing opening with a different source moment."],
    guardrails: ["Use only footage and audio you control or have permission to publish.", "Do not imply performance results, partnerships, or audience claims that are not verified.", `Keep the campaign focused on ${cleanText(audience, 120) || "the intended audience"} and route every asset back to the channel.`]
  };
}

const briefSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    northStar: { type: "string" },
    channelCta: { type: "string" },
    shortConcepts: {
      type: "array", minItems: 3, maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          title: { type: "string" }, sourceLabel: { type: "string" }, duration: { type: "string" },
          opening: { type: "string" }, cutPlan: { type: "string" }, caption: { type: "string" }
        },
        required: ["title", "sourceLabel", "duration", "opening", "cutPlan", "caption"]
      }
    },
    deliverables: { type: "array", minItems: 4, maxItems: 8, items: { type: "string" } },
    publishingSequence: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    guardrails: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } }
  },
  required: ["northStar", "channelCta", "shortConcepts", "deliverables", "publishingSequence", "guardrails"]
};

async function generateBrief(input) {
  const fallback = fallbackBrief(input);
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: "You are HALO's YouTube campaign producer. Build a practical short-form campaign only from the supplied source labels, URLs, notes, goal, and audience. Never claim you watched or transcribed a source. Never invent quotes, timestamps, metrics, credits, trends, or rights. Every concept must identify a supplied source label and route viewers to the supplied channel URL. Return JSON only." },
        { role: "user", content: JSON.stringify(input) }
      ],
      response_format: { type: "json_schema", json_schema: { name: "halo_youtube_campaign_brief", strict: true, schema: briefSchema } }
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "null");
    return parsed ? { brief: parsed, model: MODEL } : { brief: fallback, model: "fallback" };
  } catch (error) {
    console.error("YouTube campaign brief used fallback", error instanceof Error ? error.message : "unknown error");
    return { brief: fallback, model: "fallback" };
  }
}

async function listWorkspace(db, membership) {
  const [sourceRows, briefRows] = await Promise.all([
    db.sql`SELECT * FROM halo_youtube_sources WHERE member_id = ${membership.member_id} ORDER BY updated_at DESC LIMIT 200`,
    db.sql`SELECT * FROM halo_youtube_campaign_briefs WHERE member_id = ${membership.member_id} ORDER BY created_at DESC LIMIT 20`
  ]);
  return { sources: sourceRows.map(sourcePayload), briefs: briefRows.map(briefPayload) };
}

async function addSources(db, membership, body) {
  const entries = Array.isArray(body.sources) ? body.sources.slice(0, 50) : [];
  if (!entries.length) return json({ message: "Add at least one YouTube channel, playlist, Short, or video link" }, 422);
  const sharedChannelUrl = youtubeUrl(body.channelUrl, false);
  const sharedNotes = cleanText(body.notes, 1200);
  const saved = [];
  for (const entry of entries) {
    const sourceUrl = youtubeUrl(entry?.url);
    if (!sourceUrl) return json({ message: "Every source must be a valid HTTPS YouTube URL" }, 422);
    const sourceType = sourceTypes.has(entry?.type) ? entry.type : inferType(sourceUrl);
    const label = cleanText(entry?.label, 160) || `${sourceType[0].toUpperCase()}${sourceType.slice(1)} source`;
    const id = randomUUID();
    const rows = await db.sql`
      INSERT INTO halo_youtube_sources (id, member_id, label, source_url, source_type, channel_url, notes)
      VALUES (${id}, ${membership.member_id}, ${label}, ${sourceUrl}, ${sourceType}, ${sharedChannelUrl}, ${sharedNotes})
      ON CONFLICT (member_id, source_url) DO UPDATE SET
        label = EXCLUDED.label, source_type = EXCLUDED.source_type,
        channel_url = CASE WHEN EXCLUDED.channel_url = '' THEN halo_youtube_sources.channel_url ELSE EXCLUDED.channel_url END,
        notes = CASE WHEN EXCLUDED.notes = '' THEN halo_youtube_sources.notes ELSE EXCLUDED.notes END,
        updated_at = NOW()
      RETURNING *
    `;
    saved.push(sourcePayload(rows[0]));
  }
  return json({ sources: saved, message: `${saved.length} YouTube source${saved.length === 1 ? "" : "s"} saved` }, 201);
}

async function removeSource(db, membership, body) {
  const sourceId = cleanId(body.sourceId);
  const rows = await db.sql`DELETE FROM halo_youtube_sources WHERE id = ${sourceId} AND member_id = ${membership.member_id} RETURNING id`;
  return rows[0] ? json({ removed: true }) : json({ message: "YouTube source not found" }, 404);
}

async function createBrief(db, membership, body) {
  const sourceIds = [...new Set((Array.isArray(body.sourceIds) ? body.sourceIds : []).map(cleanId).filter(Boolean))].slice(0, 20);
  if (!sourceIds.length) return json({ message: "Select at least one saved source" }, 422);
  const rows = await db.sql`
    SELECT * FROM halo_youtube_sources
    WHERE member_id = ${membership.member_id} AND id = ANY(${sourceIds}::text[])
    ORDER BY updated_at DESC
  `;
  if (!rows.length) return json({ message: "No matching YouTube sources were found" }, 404);
  const title = cleanText(body.title, 160);
  const goal = cleanText(body.campaignGoal, 600);
  const audience = cleanText(body.audience, 300);
  const channelUrl = youtubeUrl(body.channelUrl) || rows.map(row => row.channel_url).find(Boolean) || rows.find(row => row.source_type === "channel")?.source_url || "";
  if (title.length < 2 || goal.length < 2) return json({ message: "Add a campaign title and goal" }, 422);
  if (!channelUrl) return json({ message: "Add the YouTube channel URL that every campaign asset should promote" }, 422);
  const sources = rows.map(row => ({ label: row.label, type: row.source_type, url: row.source_url, notes: row.notes }));
  const generated = await generateBrief({ title, goal, audience, channelUrl, sources });
  const id = randomUUID();
  const saved = await db.sql`
    INSERT INTO halo_youtube_campaign_briefs (id, member_id, title, campaign_goal, audience, channel_url, source_ids, brief, model)
    VALUES (${id}, ${membership.member_id}, ${title}, ${goal}, ${audience}, ${channelUrl}, ${JSON.stringify(sourceIds)}::jsonb, ${JSON.stringify(generated.brief)}::jsonb, ${generated.model})
    RETURNING *
  `;
  return json({ campaignBrief: briefPayload(saved[0]), message: "YouTube Shorts campaign brief created" }, 201);
}

export default async function youtubeSourceStudioHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const user = await getUser().catch(() => null);
    if (!user?.id) return json({ message: "Sign in to use the YouTube Source Box", authenticated: false }, 401);
    const db = getDatabase();
    const membership = await ensureMembership(db, user);
    if (request.method === "GET") return json({ authenticated: true, membership: { displayName: membership.display_name }, ...(await listWorkspace(db, membership)) });
    if (!(await verifyRequestOrigin(request))) return json({ message: "Cross-origin YouTube workspace updates are not accepted" }, 403);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "YouTube workspace request is too large" }, 413);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "YouTube workspace request must be valid JSON" }, 400);
    if (body.action === "add_sources") return addSources(db, membership, body);
    if (body.action === "remove_source") return removeSource(db, membership, body);
    if (body.action === "generate_brief") return createBrief(db, membership, body);
    return json({ message: "Choose a supported YouTube Source Box action" }, 400);
  } catch (error) {
    console.error("YouTube Source Box request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The YouTube Source Box is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/youtube-source-studio" };
