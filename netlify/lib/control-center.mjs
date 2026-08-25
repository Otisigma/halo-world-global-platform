import OpenAI from "openai";
import { actorIdFor } from "./halo-x.mjs";
import { AGENT_MODEL, AGENT_ROLES } from "./agent-team.mjs";

const TARGETS = new Set(["council", ...Object.keys(AGENT_ROLES), "mirror"]);
const CATEGORIES = new Set(["strategy", "growth", "creator", "community", "product", "operations", "risk"]);
const PRIORITIES = new Set(["critical", "high", "medium", "low"]);

const COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    response: { type: "string" },
    assessment: { type: "string" },
    proposeAction: { type: "boolean" },
    action: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        rationale: { type: "string" },
        category: { type: "string", enum: [...CATEGORIES] },
        priority: { type: "string", enum: [...PRIORITIES] },
        expectedMetric: { type: "string" },
        dueDate: { type: ["string", "null"] }
      },
      required: ["title", "rationale", "category", "priority", "expectedMetric", "dueDate"]
    }
  },
  required: ["response", "assessment", "proposeAction", "action"]
};

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function safeDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeAction(value, target) {
  if (!value || typeof value !== "object") return null;
  const agentKey = target === "council" ? "mirror" : target;
  const title = cleanText(value.title, 180);
  const rationale = cleanText(value.rationale, 1200);
  if (!title || !rationale) return null;
  return {
    agentKey,
    title,
    rationale,
    category: CATEGORIES.has(value.category) ? value.category : AGENT_ROLES[agentKey]?.categories?.[0] || "strategy",
    priority: PRIORITIES.has(value.priority) ? value.priority : "medium",
    expectedMetric: cleanText(value.expectedMetric, 240),
    dueDate: safeDate(value.dueDate)
  };
}

function fallbackReply(target, message, requestProposal) {
  const role = target === "council"
    ? { name: "Council", mission: "coordinate the specialist team and challenge assumptions" }
    : target === "mirror"
      ? { name: "Mirror", mission: "test assumptions against outcomes and evidence" }
      : AGENT_ROLES[target];
  const response = `${role?.name || "The council"} received the instruction. The team needs current operating evidence and an owner-approved scope before any external action. The request has been recorded for follow-through.`;
  const action = requestProposal ? {
    agentKey: target === "council" ? "mirror" : target,
    title: cleanText(message, 120) || "Review owner instruction",
    rationale: `Translate the owner instruction into a measurable, reversible work item aligned with ${role?.mission || "HALO operations"}.`,
    category: AGENT_ROLES[target]?.categories?.[0] || (target === "sentinel" ? "operations" : "strategy"),
    priority: "medium",
    expectedMetric: "A documented result with owner-reviewed evidence",
    dueDate: null
  } : null;
  return { response, assessment: "Acknowledged with a conservative fallback because live AI synthesis was unavailable.", action, usedFallback: true };
}

async function loadCommandContext(db) {
  const [runRows, issueRows, actionRows, memoryRows] = await Promise.all([
    db.sql`SELECT report_date, status, metrics, executive_summary, concerns, completed_at FROM halo_agent_runs ORDER BY started_at DESC LIMIT 1`,
    db.sql`SELECT severity, category, title, status, last_seen_at FROM maintenance_issues WHERE status <> 'healed' ORDER BY last_seen_at DESC LIMIT 12`,
    db.sql`SELECT agent_key, title, priority, status, expected_metric, updated_at FROM halo_agent_actions ORDER BY updated_at DESC LIMIT 16`,
    db.sql`SELECT agent_key, last_reflection, lessons, updated_at FROM halo_agent_memory ORDER BY agent_key`
  ]);
  return {
    latestCouncilReport: runRows[0] || null,
    currentIssues: issueRows,
    currentActions: actionRows,
    teamMemory: memoryRows
  };
}

async function generateReply(db, target, message, requestProposal) {
  const context = await loadCommandContext(db);
  const role = target === "council"
    ? "You are Mirror speaking for the full HALO specialist council. Coordinate distinct perspectives and identify the next evidence-backed move."
    : target === "mirror"
      ? "You are Mirror, the HALO reflection and synthesis lead. Challenge assumptions and compare instructions with recorded outcomes."
      : `You are ${AGENT_ROLES[target].name}, HALO's ${AGENT_ROLES[target].title} specialist. Your mission is to ${AGENT_ROLES[target].mission.toLowerCase()}`;
  const openai = new OpenAI();
  const completion = await openai.chat.completions.create({
    model: AGENT_MODEL,
    messages: [
      {
        role: "system",
        content: `${role} Respond directly to the owner using only the supplied operational context. Be concise, candid, and specific about uncertainty. You may propose one measurable action when useful, but never claim an external action has already happened. Money, publishing, contracts, account changes, messages to people, and production changes always require explicit human approval. Return JSON only.`
      },
      {
        role: "user",
        content: JSON.stringify({ ownerInstruction: message, actionProposalRequested: requestProposal, operationalContext: context })
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "halo_owner_command", strict: true, schema: COMMAND_SCHEMA }
    }
  }, { signal: AbortSignal.timeout(12_000) });
  const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  return {
    response: cleanText(parsed.response, 4000),
    assessment: cleanText(parsed.assessment, 1200),
    action: parsed.proposeAction ? normalizeAction(parsed.action, target) : null,
    usedFallback: false
  };
}

function serializeCommand(row) {
  return {
    id: Number(row.id),
    targetAgent: row.target_agent,
    message: row.message,
    response: row.response,
    assessment: row.assessment,
    status: row.status,
    proposedAction: row.proposed_action || {},
    model: row.model,
    actionId: row.action_id ? Number(row.action_id) : null,
    actionStatus: row.action_status || null,
    createdAt: new Date(row.created_at).toISOString(),
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null
  };
}

export async function createAgentCommand(db, user, payload) {
  const target = TARGETS.has(payload?.targetAgent) ? payload.targetAgent : "council";
  const message = cleanText(payload?.message, 3000);
  const requestProposal = payload?.requestProposal !== false;
  if (message.length < 2) return null;

  const inserted = await db.sql`
    INSERT INTO halo_agent_commands (requester_key, target_agent, message)
    VALUES (${actorIdFor(user.id)}, ${target}, ${message})
    RETURNING id
  `;
  const commandId = Number(inserted[0].id);
  let result;
  try {
    result = await generateReply(db, target, message, requestProposal);
    if (!result.response) throw new Error("empty_response");
  } catch (error) {
    console.error("HALO control center synthesis failed", error instanceof Error ? error.message : "unknown error");
    result = fallbackReply(target, message, requestProposal);
  }

  let actionId = null;
  if (result.action) {
    const actionRows = await db.sql`
      INSERT INTO halo_agent_actions (
        run_id, source_command_id, agent_key, title, rationale, category, priority, needs_approval, expected_metric, due_date
      ) VALUES (
        NULL, ${commandId}, ${result.action.agentKey}, ${result.action.title}, ${result.action.rationale},
        ${result.action.category}, ${result.action.priority}, TRUE, ${result.action.expectedMetric}, ${result.action.dueDate}
      )
      RETURNING id
    `;
    actionId = Number(actionRows[0].id);
  }

  const rows = await db.sql`
    UPDATE halo_agent_commands SET
      response = ${result.response},
      assessment = ${result.assessment},
      status = ${actionId ? "awaiting_approval" : "answered"},
      proposed_action = ${JSON.stringify(result.action || {})}::jsonb,
      model = ${result.usedFallback ? "deterministic-fallback" : AGENT_MODEL},
      responded_at = NOW()
    WHERE id = ${commandId}
    RETURNING *
  `;
  return { ...serializeCommand(rows[0]), actionId, actionStatus: actionId ? "proposed" : null };
}

export async function loadControlCenter(db) {
  const [commandRows, runRows, sweepRows, issueRows, actionRows, countsRows] = await Promise.all([
    db.sql`
      SELECT command.*, action.id AS action_id, action.status AS action_status
      FROM halo_agent_commands AS command
      LEFT JOIN halo_agent_actions AS action ON action.source_command_id = command.id
      ORDER BY command.created_at DESC
      LIMIT 80
    `,
    db.sql`SELECT id, status, trigger_type, health_score, executive_summary, started_at, completed_at FROM halo_agent_runs ORDER BY started_at DESC LIMIT 8`,
    db.sql`SELECT id, status, trigger_type, failed_checks, started_at, completed_at FROM halo_maintenance_sweeps ORDER BY started_at DESC LIMIT 8`,
    db.sql`SELECT id, severity, category, title, status, last_seen_at FROM maintenance_issues ORDER BY last_seen_at DESC LIMIT 12`,
    db.sql`SELECT id, agent_key, title, priority, status, updated_at FROM halo_agent_actions ORDER BY updated_at DESC LIMIT 14`,
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM maintenance_issues WHERE status <> 'healed') AS open_issues,
        (SELECT COUNT(*)::int FROM halo_agent_actions WHERE status IN ('proposed', 'approved', 'in_progress')) AS active_actions,
        (SELECT COUNT(*)::int FROM halo_agent_commands WHERE created_at >= NOW() - INTERVAL '24 hours') AS commands_24h,
        (SELECT COUNT(*)::int FROM halo_maintenance_checks WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours') AS failures_24h
    `
  ]);

  const activity = [
    ...runRows.map(row => ({ type: "council", status: row.status, title: row.executive_summary || "Council monitoring run", detail: `${row.trigger_type} review · health ${row.health_score}`, occurredAt: row.completed_at || row.started_at })),
    ...sweepRows.map(row => ({ type: "maintenance", status: row.status, title: "Platform maintenance sweep", detail: `${row.trigger_type} sweep · ${row.failed_checks} failed checks`, occurredAt: row.completed_at || row.started_at })),
    ...issueRows.map(row => ({ type: "issue", status: row.status, title: row.title, detail: `${row.severity} · ${row.category}`, occurredAt: row.last_seen_at })),
    ...actionRows.map(row => ({ type: "action", status: row.status, title: row.title, detail: `${row.agent_key} · ${row.priority} priority`, occurredAt: row.updated_at }))
  ].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 30).map(item => ({ ...item, occurredAt: new Date(item.occurredAt).toISOString() }));

  const counts = countsRows[0] || {};
  return {
    commands: commandRows.map(serializeCommand),
    activity,
    pulse: {
      openIssues: Number(counts.open_issues || 0),
      activeActions: Number(counts.active_actions || 0),
      commands24h: Number(counts.commands_24h || 0),
      failures24h: Number(counts.failures_24h || 0)
    },
    refreshedAt: new Date().toISOString()
  };
}
