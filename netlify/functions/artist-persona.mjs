import OpenAI from "openai";
import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { displayNameFor } from "../lib/halo-x.mjs";
import { serialiseStorefrontProfile } from "../lib/artist-storefront.mjs";
import { canViewStorefront, loadStorefrontPage, loadStorefrontSongs } from "../lib/artist-storefront-data.mjs";
import {
  HISTORY_TURNS, HOURLY_MESSAGE_LIMIT, MAX_FAN_MESSAGE, PERSONA_MODEL,
  buildPersonaSystemPrompt, extractFanName, mergeNotes, personaFor, splitMemory
} from "../lib/artist-personas.mjs";

// AI artist persona chat for Artist Shop storefronts (e.g. Anna Jayne).
//   GET  /api/artist-persona?artist=<slug>&visitor=<id>  → persona card + this fan's recent history
//   POST /api/artist-persona { artist, visitor, message } → persona reply
// Signed-in fans are remembered across devices; anonymous fans by a random browser id.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VISITOR = /^[A-Za-z0-9-]{16,64}$/;
const IP_HOURLY_LIMIT = HOURLY_MESSAGE_LIMIT * 3;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const hash = value => createHash("sha256").update(String(value)).digest("hex").slice(0, 40);

function visitorKeyFor(user, visitorId) {
  if (user?.id) return { key: `member:${hash(user.id)}`, memberId: user.id };
  if (VISITOR.test(String(visitorId || ""))) return { key: `anon:${hash(visitorId)}`, memberId: null };
  return null;
}

async function resolveStorefront(db, slug) {
  if (!SLUG.test(slug)) return null;
  const page = await loadStorefrontPage(db, slug);
  if (!(await canViewStorefront(db, page))) return null;
  const persona = personaFor(page);
  return persona ? { page, persona } : null;
}

async function findConversation(db, page, persona, visitorKey) {
  const rows = await db.sql`
    SELECT * FROM halo_artist_persona_conversations
    WHERE artist_slug = ${page.slug} AND persona_key = ${persona.key} AND visitor_key = ${visitorKey}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function recentMessages(db, conversationId, limit = HISTORY_TURNS) {
  const rows = await db.sql`
    SELECT role, content, created_at FROM halo_artist_persona_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.reverse().map(row => ({ role: row.role, content: row.content, at: new Date(row.created_at).toISOString() }));
}

async function rateLimited(db, conversationId, ipHash) {
  const [byConversation, byIp] = await Promise.all([
    conversationId
      ? db.sql`
          SELECT COUNT(*)::int AS count FROM halo_artist_persona_messages
          WHERE conversation_id = ${conversationId} AND role = 'user' AND created_at > NOW() - INTERVAL '1 hour'
        `
      : Promise.resolve([{ count: 0 }]),
    ipHash
      ? db.sql`
          SELECT COUNT(*)::int AS count FROM halo_artist_persona_messages m
          JOIN halo_artist_persona_conversations c ON c.id = m.conversation_id
          WHERE c.ip_hash = ${ipHash} AND m.role = 'user' AND m.created_at > NOW() - INTERVAL '1 hour'
        `
      : Promise.resolve([{ count: 0 }])
  ]);
  return Number(byConversation[0]?.count || 0) >= HOURLY_MESSAGE_LIMIT || Number(byIp[0]?.count || 0) >= IP_HOURLY_LIMIT;
}

function personaCard(page, persona, songs) {
  return serialiseStorefrontProfile(page, songs, persona).persona;
}

async function handleGet(db, url, user) {
  const slug = String(url.searchParams.get("artist") || "").trim().toLowerCase().slice(0, 80);
  const found = await resolveStorefront(db, slug);
  if (!found) return json({ message: "This storefront has no AI persona" }, 404);
  const visitor = visitorKeyFor(user, url.searchParams.get("visitor"));
  const conversation = visitor ? await findConversation(db, found.page, found.persona, visitor.key) : null;
  return json({
    artist: { slug: found.page.slug, name: found.page.artist_name },
    persona: personaCard(found.page, found.persona, []),
    fanName: conversation?.fan_name || "",
    messages: conversation ? await recentMessages(db, conversation.id, 30) : []
  });
}

async function handlePost(request, db, user, context) {
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin persona messages are not accepted" }, 403);
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ message: "Send a message" }, 400);

  const slug = String(body.artist || "").trim().toLowerCase().slice(0, 80);
  const message = String(body.message || "").replace(/\s+/g, " ").trim();
  if (!message) return json({ message: "Type a message first" }, 400);
  if (message.length > MAX_FAN_MESSAGE) return json({ message: `Keep messages under ${MAX_FAN_MESSAGE} characters` }, 400);

  const visitor = visitorKeyFor(user, body.visitor);
  if (!visitor) return json({ message: "Refresh the page to start a conversation" }, 400);

  const found = await resolveStorefront(db, slug);
  if (!found) return json({ message: "This storefront has no AI persona" }, 404);
  const { page, persona } = found;

  const ipHash = context?.ip ? hash(`ip:${context.ip}`) : "";
  let conversation = await findConversation(db, page, persona, visitor.key);
  if (await rateLimited(db, conversation?.id, ipHash)) {
    return json({ message: `${persona.displayName}'s persona needs a breather — try again in a little while.` }, 429);
  }

  if (!conversation) {
    const rows = await db.sql`
      INSERT INTO halo_artist_persona_conversations (id, artist_slug, persona_key, visitor_key, member_id, ip_hash, fan_name)
      VALUES (${randomUUID()}, ${page.slug}, ${persona.key}, ${visitor.key}, ${visitor.memberId}, ${ipHash},
              ${user ? displayNameFor(user).split(" ")[0].slice(0, 80) : ""})
      ON CONFLICT (artist_slug, persona_key, visitor_key) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `;
    conversation = rows[0];
  }

  const [songs, history] = await Promise.all([
    loadStorefrontSongs(db, page, { withLyrics: true }),
    recentMessages(db, conversation.id)
  ]);
  const fanName = conversation.fan_name || extractFanName(message);
  const systemPrompt = buildPersonaSystemPrompt(persona, {
    profile: serialiseStorefrontProfile(page, songs, persona),
    songs,
    lyrics: songs.filter(song => song.lyrics?.trim()).map(song => ({ title: song.title, text: song.lyrics })),
    fan: { name: fanName, notes: conversation.fan_notes, returning: history.length > 0 }
  });

  let reply;
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: PERSONA_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map(item => ({ role: item.role, content: item.content })),
        { role: "user", content: message }
      ],
      max_completion_tokens: 1200
    });
    reply = completion.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Artist persona generation failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: `${persona.displayName}'s persona couldn't answer just now — try again in a moment.` }, 502);
  }

  const { message: answer, memory } = splitMemory(reply);
  if (!answer) return json({ message: `${persona.displayName}'s persona lost the thread — try asking another way.` }, 502);

  await db.sql`
    INSERT INTO halo_artist_persona_messages (conversation_id, role, content, model)
    VALUES (${conversation.id}, 'user', ${message}, ''), (${conversation.id}, 'assistant', ${answer.slice(0, 4000)}, ${PERSONA_MODEL})
  `;
  await db.sql`
    UPDATE halo_artist_persona_conversations SET
      fan_name = ${fanName.slice(0, 80)},
      fan_notes = ${mergeNotes(conversation.fan_notes, memory)},
      ip_hash = CASE WHEN ${ipHash} <> '' THEN ${ipHash} ELSE ip_hash END,
      message_count = message_count + 2,
      updated_at = NOW()
    WHERE id = ${conversation.id}
  `;

  return json({ reply: answer, persona: { name: persona.displayName, disclosure: persona.disclosure } });
}

export default async function artistPersona(request, context) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const user = await getUser();
    if (request.method === "GET") return await handleGet(db, new URL(request.url), user);
    return await handlePost(request, db, user, context);
  } catch (error) {
    console.error("Artist persona request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The artist persona is unavailable right now" }, 500);
  }
}

export const config = { path: "/api/artist-persona" };
