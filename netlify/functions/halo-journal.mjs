import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { isOwner } from "../lib/halo-x.mjs";

const PROBLEM_EVENTS = new Set([
  "runtime_error",
  "unhandled_rejection",
  "request_failed",
  "media_error",
  "qa_issue",
  "offline"
]);

const PRIVATE_DETAIL_KEYS = /(^|_)(ip|ipv4|ipv6|client_ip|remote_address|forwarded_for|x_forwarded_for)($|_)/i;
const IP_ADDRESS_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}\b/gi;

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

function ownerKeyFor(memberId, sessionId) {
  return memberId || `session-${sessionId}`;
}

function cleanEventKey(value) {
  const eventKey = cleanText(value, 96);
  return /^[a-zA-Z0-9_-]{16,96}$/.test(eventKey) ? eventKey : "";
}

function cleanDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([rawKey, rawValue]) => {
    const key = cleanText(rawKey, 40).replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!key || PRIVATE_DETAIL_KEYS.test(key)) return null;
    if (typeof rawValue === "boolean" || typeof rawValue === "number") return [key, rawValue];
    return [key, cleanText(String(rawValue), 160).replace(IP_ADDRESS_PATTERN, "[private network address]")];
  }).filter(Boolean));
}

function cleanEvent(value, sessionId) {
  const eventKey = cleanEventKey(value?.eventKey);
  const eventType = cleanText(value?.eventType, 64).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (!eventKey || eventType.length < 2) return null;
  const category = cleanText(value?.category, 32).toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "activity";
  const occurredAt = new Date(value?.occurredAt || Date.now());
  const now = Date.now();
  const safeOccurredAt = Number.isNaN(occurredAt.getTime()) || Math.abs(occurredAt.getTime() - now) > 86_400_000 ? new Date(now) : occurredAt;
  return {
    eventKey,
    sessionId,
    eventType,
    category,
    pagePath: cleanPath(value?.pagePath),
    targetName: cleanText(value?.targetName, 120) || null,
    details: cleanDetails(value?.details),
    occurredAt: safeOccurredAt
  };
}

async function syncEventCount(db, ownerKey, memberId, sessionId) {
  if (memberId) {
    await db.sql`
      UPDATE halo_journal_profiles SET event_count = (
        SELECT COUNT(*)::int FROM halo_journal_events WHERE member_id = ${memberId}
      ) WHERE owner_key = ${ownerKey}
    `;
    return;
  }
  await db.sql`
    UPDATE halo_journal_profiles SET event_count = (
      SELECT COUNT(*)::int FROM halo_journal_events WHERE session_id = ${sessionId}
    ) WHERE owner_key = ${ownerKey}
  `;
}

async function ensureProfile(db, ownerKey, memberId, sessionId) {
  await db.sql`
    INSERT INTO halo_journal_profiles (owner_key, member_id, latest_session_id)
    VALUES (${ownerKey}, ${memberId}, ${sessionId})
    ON CONFLICT (owner_key) DO UPDATE SET
      member_id = COALESCE(EXCLUDED.member_id, halo_journal_profiles.member_id),
      latest_session_id = EXCLUDED.latest_session_id,
      updated_at = NOW()
  `;
  if (memberId) {
    const sessionOwnerKey = `session-${sessionId}`;
    await db.sql`
      UPDATE halo_journal_events SET member_id = ${memberId}
      WHERE session_id = ${sessionId} AND member_id IS NULL
    `;
    await db.sql`
      UPDATE halo_journal_notes SET owner_key = ${ownerKey}, member_id = ${memberId}
      WHERE owner_key = ${sessionOwnerKey}
    `;
    await db.sql`
      UPDATE halo_journal_insights SET owner_key = ${ownerKey}
      WHERE owner_key = ${sessionOwnerKey}
    `;
    await db.sql`
      UPDATE halo_journal_profiles AS member_profile SET
        memory_summary = CASE WHEN member_profile.memory_summary = '' THEN session_profile.memory_summary ELSE member_profile.memory_summary END,
        current_advice = CASE WHEN member_profile.current_advice = '' THEN session_profile.current_advice ELSE member_profile.current_advice END,
        updated_at = NOW()
      FROM halo_journal_profiles AS session_profile
      WHERE member_profile.owner_key = ${ownerKey} AND session_profile.owner_key = ${sessionOwnerKey}
    `;
    await db.sql`
      DELETE FROM halo_journal_profiles WHERE owner_key = ${sessionOwnerKey}
    `;
  }
  await syncEventCount(db, ownerKey, memberId, sessionId);
}

async function loadJournal(db, ownerKey, memberId, sessionId) {
  const eventsPromise = memberId
    ? db.sql`
        SELECT id, event_type, category, page_path, target_name, details, occurred_at
        FROM halo_journal_events
        WHERE member_id = ${memberId}
        ORDER BY occurred_at DESC
        LIMIT 80
      `
    : db.sql`
        SELECT id, event_type, category, page_path, target_name, details, occurred_at
        FROM halo_journal_events
        WHERE session_id = ${sessionId}
        ORDER BY occurred_at DESC
        LIMIT 80
      `;
  const [profileRows, eventRows, noteRows, insightRows] = await Promise.all([
    db.sql`
      SELECT memory_summary, current_advice, observed_patterns, event_count, last_reflected_at, updated_at
      FROM halo_journal_profiles WHERE owner_key = ${ownerKey}
    `,
    eventsPromise,
    db.sql`
      SELECT id, body, created_at
      FROM halo_journal_notes
      WHERE owner_key = ${ownerKey}
      ORDER BY created_at DESC
      LIMIT 20
    `,
    db.sql`
      SELECT id, trigger_type, headline, insight, recommendation, created_at
      FROM halo_journal_insights
      WHERE owner_key = ${ownerKey}
      ORDER BY created_at DESC
      LIMIT 12
    `
  ]);
  return {
    profile: profileRows[0] || null,
    events: eventRows,
    notes: noteRows,
    insights: insightRows
  };
}

function fallbackReflection(journal, triggerType) {
  const problemCount = journal.events.filter(event => event.category === "problem" || PROBLEM_EVENTS.has(event.event_type)).length;
  const pages = [...new Set(journal.events.map(event => event.page_path))].slice(0, 4);
  const latestProblem = journal.events.find(event => event.category === "problem" || PROBLEM_EVENTS.has(event.event_type));
  return {
    headline: problemCount ? "A recurring friction point needs attention" : "Your HALO workflow is taking shape",
    insight: problemCount
      ? `The journal found ${problemCount} recent problem signal${problemCount === 1 ? "" : "s"}${latestProblem?.target_name ? ` around ${latestProblem.target_name}` : ""}. The recent path crosses ${pages.join(", ") || "the current workspace"}.`
      : `The journal has captured ${journal.events.length} recent actions across ${pages.length || 1} workspace area${pages.length === 1 ? "" : "s"}. No repeating failure pattern is visible yet.`,
    recommendation: problemCount
      ? "Reproduce the latest problem once, note the expected result, then run the site quality check before changing another part of the workflow."
      : "Add a short note about the current goal so future advice can connect activity to the result you are trying to achieve.",
    memorySummary: journal.profile?.memory_summary || `HALO Journal is building a long-term picture from ${journal.events.length} recent actions and ${journal.notes.length} saved notes.`,
    patterns: problemCount ? ["Recent problem signals", `Activity across ${pages.length || 1} workspace areas`, `Reflection trigger: ${triggerType}`] : ["Active exploration", "No repeated failure detected"]
  };
}

async function createReflection(db, { ownerKey, memberId, sessionId, triggerType }) {
  const journal = await loadJournal(db, ownerKey, memberId, sessionId);
  let reflection;
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: "You are Halo Journal, a calm operational memory and troubleshooting advisor. Analyze privacy-safe product activity, user-authored notes, and prior memory. Identify evidence-based patterns without inventing actions, intent, diagnoses, or personal facts. Never claim to monitor typed content, local files, passwords, payment data, or activity outside HALO. Keep advice specific, brief, and reversible. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            triggerType,
            priorMemory: journal.profile?.memory_summary || "No prior memory yet",
            recentEvents: journal.events.slice(0, 60),
            journalNotes: journal.notes.slice(0, 12)
          })
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "halo_journal_reflection",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              headline: { type: "string" },
              insight: { type: "string" },
              recommendation: { type: "string" },
              memorySummary: { type: "string" },
              patterns: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } }
            },
            required: ["headline", "insight", "recommendation", "memorySummary", "patterns"]
          }
        }
      }
    });
    reflection = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch (error) {
    console.error("Halo Journal reflection failed", error instanceof Error ? error.message : "unknown error");
    reflection = fallbackReflection(journal, triggerType);
  }

  const safe = {
    headline: cleanText(reflection.headline, 120) || "Halo Journal reflection",
    insight: cleanText(reflection.insight, 1200) || "The journal needs more activity before it can identify a reliable pattern.",
    recommendation: cleanText(reflection.recommendation, 800) || "Continue the current task and add a note if something feels unclear.",
    memorySummary: cleanText(reflection.memorySummary, 2400),
    patterns: Array.isArray(reflection.patterns) ? reflection.patterns.map(pattern => cleanText(pattern, 120)).filter(Boolean).slice(0, 5) : []
  };

  const insightRows = await db.sql`
    INSERT INTO halo_journal_insights (owner_key, trigger_type, headline, insight, recommendation)
    VALUES (${ownerKey}, ${triggerType}, ${safe.headline}, ${safe.insight}, ${safe.recommendation})
    RETURNING id, trigger_type, headline, insight, recommendation, created_at
  `;
  await db.sql`
    UPDATE halo_journal_profiles SET
      memory_summary = ${safe.memorySummary},
      current_advice = ${safe.recommendation},
      observed_patterns = ${JSON.stringify(safe.patterns)}::jsonb,
      last_reflected_at = NOW(),
      updated_at = NOW()
    WHERE owner_key = ${ownerKey}
  `;
  return insightRows[0];
}

export default async function haloJournalHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin journal requests are not accepted" }, 403);
  }

  const payload = await request.json().catch(() => ({}));
  const sessionId = cleanSessionId(payload.sessionId);
  if (!sessionId) return json({ message: "A valid journal session is required" }, 400);

  try {
    const user = await getUser();
    if (!user?.id) return json({ message: "Sign in with the HALO owner account to access the journal" }, 401);
    if (!isOwner(user)) return json({ message: "Halo Journal is private to the HALO owner" }, 403);

    const db = await getDatabase();
    const memberId = memberIdFor(user);
    const ownerKey = ownerKeyFor(memberId, sessionId);
    await ensureProfile(db, ownerKey, memberId, sessionId);

    const action = cleanText(payload.action, 24) || "events";
    if (action === "read") {
      const journal = await loadJournal(db, ownerKey, memberId, sessionId);
      return json({ ...journal, scope: "owner" });
    }

    if (action === "note") {
      const body = cleanText(payload.body, 1200);
      if (!body) return json({ message: "Write a note before saving it" }, 400);
      const recentNotes = await db.sql`
        SELECT COUNT(*)::int AS total FROM halo_journal_notes
        WHERE owner_key = ${ownerKey} AND created_at >= NOW() - INTERVAL '1 minute'
      `;
      if (Number(recentNotes[0]?.total || 0) >= 12) return json({ message: "Pause briefly before adding more notes" }, 429);
      const noteRows = await db.sql`
        INSERT INTO halo_journal_notes (owner_key, member_id, session_id, body)
        VALUES (${ownerKey}, ${memberId}, ${sessionId}, ${body})
        RETURNING id, body, created_at
      `;
      return json({ note: noteRows[0] }, 201);
    }

    if (action === "reflect") {
      const recentInsights = await db.sql`
        SELECT COUNT(*)::int AS total FROM halo_journal_insights
        WHERE owner_key = ${ownerKey} AND created_at >= NOW() - INTERVAL '1 minute'
      `;
      if (Number(recentInsights[0]?.total || 0) >= 3) return json({ message: "The journal needs a moment before reflecting again" }, 429);
      const insight = await createReflection(db, { ownerKey, memberId, sessionId, triggerType: "manual" });
      return json({ insight }, 201);
    }

    const events = Array.isArray(payload.events) ? payload.events.slice(0, 30).map(event => cleanEvent(event, sessionId)).filter(Boolean) : [];
    if (!events.length) return json({ message: "No valid journal events were supplied" }, 400);

    let inserted = 0;
    let problemDetected = false;
    for (const event of events) {
      const rows = await db.sql`
        INSERT INTO halo_journal_events (event_key, session_id, member_id, event_type, category, page_path, target_name, details, occurred_at)
        VALUES (${event.eventKey}, ${sessionId}, ${memberId}, ${event.eventType}, ${event.category}, ${event.pagePath}, ${event.targetName}, ${JSON.stringify(event.details)}::jsonb, ${event.occurredAt.toISOString()})
        ON CONFLICT (event_key) DO NOTHING
        RETURNING id
      `;
      inserted += rows.length;
      if (event.category === "problem" || PROBLEM_EVENTS.has(event.eventType)) problemDetected = true;
    }

    await syncEventCount(db, ownerKey, memberId, sessionId);
    await db.sql`
      UPDATE halo_journal_profiles SET latest_session_id = ${sessionId}, updated_at = NOW()
      WHERE owner_key = ${ownerKey}
    `;

    let insight = null;
    if (problemDetected) {
      const profileRows = await db.sql`
        SELECT last_reflected_at IS NULL OR last_reflected_at < NOW() - INTERVAL '10 minutes' AS ready
        FROM halo_journal_profiles WHERE owner_key = ${ownerKey}
      `;
      if (profileRows[0]?.ready) insight = await createReflection(db, { ownerKey, memberId, sessionId, triggerType: "problem" });
    }

    return json({ accepted: inserted, insight }, inserted ? 201 : 200);
  } catch (error) {
    console.error("Halo Journal request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Halo Journal could not update its memory right now" }, 500);
  }
}

export const config = { path: "/api/halo-journal" };
