import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { isOwner } from "../lib/halo-x.mjs";

const agents = {
  nova: { name: "Nova", role: "Site Navigator" },
  sol: { name: "Sol", role: "Care Guide" },
  echo: { name: "Echo", role: "Community Host" },
  muse: { name: "Muse", role: "Creator Coach" }
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanPath(value) {
  const path = cleanText(value, 180);
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function cleanSessionId(value) {
  const sessionId = cleanText(value, 64);
  return /^[a-zA-Z0-9_-]{16,64}$/.test(sessionId) ? sessionId : "";
}

function memberIdFor(user) {
  return user?.id ? `member-${createHash("sha256").update(String(user.id)).digest("hex").slice(0, 32)}` : null;
}

function displayNameFor(user) {
  return cleanText(user?.name || user?.userMetadata?.full_name, 64) || null;
}

function fallbackReply(message, path, safeSpace = false) {
  const lower = message.toLowerCase();
  if (safeSpace) {
    return { agent: "sol", reply: "Sol here. We can slow this down without pressure. Tell me the smallest part you want help with, or ask me to leave a note for the human care team.", suggestions: ["Help me choose one next step", "I need a human", "Make this easier to understand"], route: null };
  }
  if (/creator|artist|sell|marketplace|music/.test(lower)) {
    return { agent: "muse", reply: "Muse here. I can help shape your creator path, prepare for the marketplace, or point you toward the DJ tools. Tell me what you are creating and where you feel stuck.", suggestions: ["Explore the creator marketplace", "Help me prepare my profile", "Show me the DJ tools"], route: "/creators/" };
  }
  if (/community|family|friend|people|clubhouse|connect/.test(lower)) {
    return { agent: "echo", reply: "Echo here. HALO is built around shared moments. I can guide you to the clubhouse, help you find ways to participate, or make the experience easier for your family.", suggestions: ["Take me to the clubhouse", "How can my family join?", "Explain Pass the Light"], route: "/#clubhouse" };
  }
  if (/help|support|safe|access|overwhelm|human|person/.test(lower)) {
    return { agent: "sol", reply: "Sol here. We can slow this down and take one step at a time. Tell me what you need help with, or ask me to leave a note for the human care team.", suggestions: ["I need a human", "Make this easier to understand", "Help with access"], route: null };
  }
  return { agent: "nova", reply: `Nova here. I can guide you from ${path === "/" ? "the HALO home experience" : "this part of HALO"} to live shows, DJ tools, VIP access, creators, or community. What would make your next step feel clear?`, suggestions: ["What can I do here?", "Show me the live experience", "Meet the agent team"], route: null };
}

async function recentJourney(db, sessionId) {
  const [journeyRows, messageRows] = await Promise.all([
    db.sql`
      SELECT active_agent, journey_summary, message_count
      FROM halo_companion_journeys WHERE session_id = ${sessionId}
    `,
    db.sql`
      SELECT role, agent, body, page_path
      FROM halo_companion_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 10
    `
  ]);
  return { journey: journeyRows[0] || null, messages: messageRows.reverse() };
}

async function journalMemory(db, memberId) {
  if (!memberId) return null;
  const rows = await db.sql`
    SELECT memory_summary, current_advice, observed_patterns, event_count, updated_at
    FROM halo_journal_profiles
    WHERE owner_key = ${memberId}
  `;
  return rows[0] || null;
}

async function createCareRequest(db, { sessionId, memberId, path, reason }) {
  const safeReason = cleanText(reason, 500);
  await db.sql`
    INSERT INTO halo_companion_care_requests (session_id, member_id, page_path, reason)
    VALUES (${sessionId}, ${memberId}, ${path}, ${safeReason.length >= 3 ? safeReason : "Visitor requested human care."})
  `;
}

export default async function haloCompanionHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);

  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin companion requests are not accepted" }, 403);
  }

  const payload = await request.json().catch(() => ({}));
  const sessionId = cleanSessionId(payload.sessionId);
  const message = cleanText(payload.message, 1000);
  const path = cleanPath(payload.path);
  const title = cleanText(payload.title, 120);
  const safeSpace = payload.safeSpace === true;
  if (!sessionId || !message) return json({ message: "A valid journey and message are required" }, 400);

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const memberId = memberIdFor(user);
    const displayName = displayNameFor(user);

    await db.sql`
      INSERT INTO halo_companion_journeys (session_id, member_id, display_name, last_path)
      VALUES (${sessionId}, ${memberId}, ${displayName}, ${path})
      ON CONFLICT (session_id) DO UPDATE SET
        member_id = COALESCE(EXCLUDED.member_id, halo_companion_journeys.member_id),
        display_name = COALESCE(EXCLUDED.display_name, halo_companion_journeys.display_name),
        last_path = EXCLUDED.last_path,
        updated_at = NOW()
    `;

    const rateRows = await db.sql`
      SELECT COUNT(*)::int AS total
      FROM halo_companion_messages
      WHERE session_id = ${sessionId} AND role = 'visitor' AND created_at >= NOW() - INTERVAL '1 minute'
    `;
    if (Number(rateRows[0]?.total || 0) >= 12) return json({ message: "The companion team is catching up. Take a short pause and try again." }, 429);

    const [context, journal] = await Promise.all([
      recentJourney(db, sessionId),
      isOwner(user) ? journalMemory(db, memberId).catch(() => null) : null
    ]);
    await db.sql`
      INSERT INTO halo_companion_messages (session_id, role, body, page_path)
      VALUES (${sessionId}, 'visitor', ${message}, ${path})
    `;

    let result;
    try {
      const openai = new OpenAI();
      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are HALO Companion, a coordinated care team for clients, families, fans, and creators across the HALO website. Route each turn to exactly one specialist: Nova (site navigation and product guidance), Sol (patient support, accessibility, safety, family guidance, and human handoff), Echo (community, belonging, live experiences, and participation), or Muse (creators, artists, DJ tools, and marketplace readiness). Be warm, concise, practical, and never claim to have completed an action you cannot perform. Do not provide medical, legal, financial, or emergency advice. For immediate danger or crisis, encourage contacting local emergency services or a trusted person. Only use these real routes: /, /halo-live.html, /dj-deck.html, /vip_launchpad.html, /creators/, /#clubhouse. Set needsHumanCare true when the visitor explicitly asks for a person, reports an unresolved account/access/safety problem, or appears distressed. When safeSpace is true, use Sol, acknowledge the visitor without diagnosis, avoid urgency or pressure, offer one small next step, and mention human support when appropriate. Return JSON only.`
          },
          {
            role: "user",
            content: JSON.stringify({
              visitor: { displayName: displayName || "Guest" },
              currentPage: { path, title },
              journeySummary: context.journey?.journey_summary || "First conversation",
              haloJournalMemory: journal ? {
                summary: journal.memory_summary,
                currentAdvice: journal.current_advice,
                observedPatterns: journal.observed_patterns,
                eventCount: journal.event_count
              } : "No journal reflection yet",
              recentConversation: context.messages,
              safeSpace,
              message
            })
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "halo_companion_reply",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                agent: { type: "string", enum: Object.keys(agents) },
                reply: { type: "string" },
                suggestions: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
                route: { type: ["string", "null"] },
                needsHumanCare: { type: "boolean" },
                journeySummary: { type: "string" }
              },
              required: ["agent", "reply", "suggestions", "route", "needsHumanCare", "journeySummary"]
            }
          }
        }
      });
      result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch (error) {
      console.error("HALO Companion inference failed", error instanceof Error ? error.message : "unknown error");
      result = { ...fallbackReply(message, path, safeSpace), needsHumanCare: /human|person|someone call|real support/i.test(message), journeySummary: context.journey?.journey_summary || "Visitor is exploring HALO and looking for guidance." };
    }

    if (safeSpace) result.agent = "sol";
    if (!agents[result.agent]) result.agent = "nova";
    result.reply = cleanText(result.reply, 2400) || fallbackReply(message, path, safeSpace).reply;
    result.suggestions = Array.isArray(result.suggestions) ? result.suggestions.map(item => cleanText(item, 90)).filter(Boolean).slice(0, 3) : [];
    result.route = ["/", "/halo-live.html", "/dj-deck.html", "/vip_launchpad.html", "/creators/", "/#clubhouse"].includes(result.route) ? result.route : null;
    const journeySummary = cleanText(result.journeySummary, 1200);

    await Promise.all([
      db.sql`
        INSERT INTO halo_companion_messages (session_id, role, agent, body, page_path)
        VALUES (${sessionId}, 'assistant', ${result.agent}, ${result.reply}, ${path})
      `,
      db.sql`
        UPDATE halo_companion_journeys SET
          active_agent = ${result.agent},
          journey_summary = ${journeySummary},
          last_path = ${path},
          message_count = message_count + 2,
          updated_at = NOW()
        WHERE session_id = ${sessionId}
      `
    ]);

    if (result.needsHumanCare) {
      await createCareRequest(db, { sessionId, memberId, path, reason: message.slice(0, 500) });
    }

    return json({
      agent: { id: result.agent, ...agents[result.agent] },
      reply: result.reply,
      suggestions: result.suggestions,
      route: result.route,
      careRequestCreated: Boolean(result.needsHumanCare)
    });
  } catch (error) {
    console.error("HALO Companion request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The companion team is reconnecting. Please try again in a moment." }, 500);
  }
}

export const config = { path: "/api/halo-companion" };
