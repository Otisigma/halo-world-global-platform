import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import OpenAI from "openai";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const model = "gpt-5.4-mini";

const VALID_PURPOSES = new Set(["self", "gift", "fans", "project"]);
const VALID_MODES = new Set(["private", "gift", "public"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanList(value, maxItems, maxItemLen) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => cleanText(String(item), maxItemLen)).filter(Boolean);
}

function serialize(row) {
  return {
    id: row.id,
    purpose: row.purpose,
    emotion: row.emotion,
    soundDirection: row.sound_direction,
    storyInput: row.story_input,
    generatedTitles: row.generated_titles || [],
    generatedTheme: row.generated_theme || "",
    generatedTracks: row.generated_tracks || [],
    generatedCoverPrompt: row.generated_cover_prompt || "",
    generatedDedication: row.generated_dedication || "",
    mode: row.mode,
    isPremium: Boolean(row.is_premium),
    status: row.status,
    errorMessage: row.error_message || "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function handleGet(request, db, actorId) {
  const url = new URL(request.url);
  const sessionId = cleanText(url.searchParams.get("sessionId") || "", 40);
  if (sessionId) {
    const rows = await db.query(
      "SELECT * FROM halo_album_concierge_sessions WHERE id = $1 AND member_id = $2 LIMIT 1",
      [sessionId, actorId]
    );
    if (!rows.length) return json({ error: "Not found" }, 404);
    return json(serialize(rows[0]));
  }
  const rows = await db.query(
    "SELECT * FROM halo_album_concierge_sessions WHERE member_id = $1 ORDER BY created_at DESC LIMIT 20",
    [actorId]
  );
  return json({ sessions: rows.map(serialize) });
}

async function handleCreate(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const purpose = cleanText(body.purpose, 64);
  if (!VALID_PURPOSES.has(purpose)) return json({ error: "Invalid purpose" }, 400);

  const emotion = cleanText(body.emotion, 256);
  const soundDirection = cleanText(body.soundDirection, 128);
  const storyInput = cleanText(body.storyInput, 4000);

  const rows = await db.query(
    `INSERT INTO halo_album_concierge_sessions
       (member_id, purpose, emotion, sound_direction, story_input, status)
     VALUES ($1, $2, $3, $4, $5, 'draft')
     RETURNING *`,
    [actorId, purpose, emotion, soundDirection, storyInput]
  );
  return json(serialize(rows[0]), 201);
}

async function handleGenerate(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const sessionId = cleanText(body.sessionId, 40);
  if (!sessionId) return json({ error: "sessionId required" }, 400);

  const rows = await db.query(
    "SELECT * FROM halo_album_concierge_sessions WHERE id = $1 AND member_id = $2 LIMIT 1",
    [sessionId, actorId]
  );
  if (!rows.length) return json({ error: "Not found" }, 404);
  const session = rows[0];

  if (session.status === "generating") return json({ error: "Already generating" }, 409);

  await db.query(
    "UPDATE halo_album_concierge_sessions SET status = 'generating', updated_at = NOW() WHERE id = $1",
    [sessionId]
  );

  const openai = new OpenAI();
  const systemPrompt = `You are a premium album concierge creative assistant for HALO World.
Your role: turn a personal story, mood, or memory into a bespoke album concept.
Always respond with valid JSON matching the requested schema.
Never invent credits, real artists, or copyrighted content.
Generate original, emotionally resonant ideas.`;

  const userPrompt = `Create a premium album concept for the following:
Purpose: ${session.purpose}
Emotional direction: ${session.emotion}
Sound direction: ${session.sound_direction}
Story: ${session.story_input}

Respond with ONLY valid JSON in this exact shape:
{
  "titles": ["<title 1>", "<title 2>", "<title 3>"],
  "theme": "<2–3 sentence album theme statement>",
  "tracks": [
    {"position": 1, "title": "<track title>", "moodNote": "<1-sentence mood/concept note>"},
    ...
  ],
  "coverPrompt": "<visual art direction for album cover: style, colour palette, imagery>",
  "dedication": "<personal dedication or liner note message, 2–4 sentences>"
}

Include 8–10 tracks. Keep everything emotionally grounded and premium.`;

  let generated;
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.9,
      max_tokens: 1800
    });
    const raw = completion.choices[0]?.message?.content || "{}";
    generated = JSON.parse(raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, ""));
  } catch (err) {
    await db.query(
      "UPDATE halo_album_concierge_sessions SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
      [String(err.message).slice(0, 500), sessionId]
    );
    return json({ error: "Generation failed" }, 502);
  }

  const titles = cleanList(generated.titles, 5, 120);
  const theme = cleanText(generated.theme, 1000);
  const tracks = Array.isArray(generated.tracks)
    ? generated.tracks.slice(0, 14).map((t, i) => ({
        position: Number(t.position) || i + 1,
        title: cleanText(String(t.title || ""), 120),
        moodNote: cleanText(String(t.moodNote || ""), 300)
      }))
    : [];
  const coverPrompt = cleanText(generated.coverPrompt, 600);
  const dedication = cleanText(generated.dedication, 600);

  const updated = await db.query(
    `UPDATE halo_album_concierge_sessions
     SET status = 'ready',
         generated_titles = $1,
         generated_theme = $2,
         generated_tracks = $3,
         generated_cover_prompt = $4,
         generated_dedication = $5,
         model = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING *`,
    [JSON.stringify(titles), theme, JSON.stringify(tracks), coverPrompt, dedication, model, sessionId]
  );
  return json(serialize(updated[0]));
}

async function handleSave(request, db, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const sessionId = cleanText(body.sessionId, 40);
  if (!sessionId) return json({ error: "sessionId required" }, 400);

  const mode = VALID_MODES.has(body.mode) ? body.mode : "private";
  const isPremium = Boolean(body.isPremium);

  const rows = await db.query(
    "SELECT id FROM halo_album_concierge_sessions WHERE id = $1 AND member_id = $2 LIMIT 1",
    [sessionId, actorId]
  );
  if (!rows.length) return json({ error: "Not found" }, 404);

  const updated = await db.query(
    "UPDATE halo_album_concierge_sessions SET mode = $1, is_premium = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
    [mode, isPremium, sessionId]
  );
  return json(serialize(updated[0]));
}

export default async function handler(request) {
  if (request.method !== "GET") {
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ error: "Forbidden" }, 403);
    }
  }

  const user = await getUser(request);
  if (!user?.id) return json({ error: "Unauthorized" }, 401);

  const db = getDatabase();
  const actorId = (await ensureMembership(db, user)).actorId;

  const url = new URL(request.url);
  const action = cleanText(url.searchParams.get("action") || "", 32);

  if (request.method === "GET") return handleGet(request, db, actorId);
  if (request.method === "POST" && action === "generate") return handleGenerate(request, db, actorId);
  if (request.method === "POST" && action === "save") return handleSave(request, db, actorId);
  if (request.method === "POST") return handleCreate(request, db, actorId);

  return json({ error: "Method not allowed" }, 405);
}

export const config = { path: "/api/album-concierge" };
