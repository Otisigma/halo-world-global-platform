import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { gatherStationSignals } from "./radio-operator.mjs";

export const RADIO_MANAGER_MODEL = "gpt-5.4-mini";

export const RADIO_MANAGERS = [
  { key: "programme", name: "Mara", title: "Programme Director", remit: "running order, formats, pacing, discovery and repeat listening" },
  { key: "audience", name: "Soren", title: "Audience Strategist", remit: "listener journeys, retention, measurement and channel fit" },
  { key: "artist", name: "Imani", title: "Artist Development Lead", remit: "fair discovery, coaching, rotation readiness and artist outcomes" },
  { key: "systems", name: "Vale", title: "Broadcast Systems Manager", remit: "reliability, source quality, continuity, cost and operational risk" },
  { key: "growth", name: "Noa", title: "Growth Partnerships Lead", remit: "distribution, collaborations, promotion and audience acquisition" }
];

const priorityValues = new Set(["critical", "high", "medium", "low"]);
const effortValues = new Set(["small", "medium", "large"]);
const managerKeys = new Set(RADIO_MANAGERS.map(manager => manager.key));

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "managers", "actions", "experiments", "risks"],
  properties: {
    verdict: { type: "string" },
    summary: { type: "string" },
    managers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "assessment", "opportunity", "watchMetric"],
        properties: {
          key: { type: "string", enum: [...managerKeys] },
          assessment: { type: "string" },
          opportunity: { type: "string" },
          watchMetric: { type: "string" }
        }
      }
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["managerKey", "title", "rationale", "expectedMetric", "priority", "effort"],
        properties: {
          managerKey: { type: "string", enum: [...managerKeys] },
          title: { type: "string" },
          rationale: { type: "string" },
          expectedMetric: { type: "string" },
          priority: { type: "string", enum: [...priorityValues] },
          effort: { type: "string", enum: [...effortValues] }
        }
      }
    },
    experiments: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } }
  }
};

const SYSTEM_PROMPT = `You are the HALO Radio manager council. Five specialist managers share one evidence packet and must produce one coordinated operating plan for a creator-owned digital radio station.

Rules:
- Use only the supplied station evidence. Never invent listener, revenue, artist or reliability facts.
- Each manager must speak from its named remit and identify one measurable opportunity.
- Produce 4 to 8 non-duplicative actions for the next operating horizon.
- Prefer testable programming and distribution experiments over vague promotion.
- Protect creator fairness, listener trust, broadcast continuity and cost discipline.
- Do not claim HALO is already the best station. Define the next evidence needed to earn that claim.
- Every action is a proposal for human approval, never an autonomous real-world command.
- Return strict JSON matching the requested schema.`;

function clean(value, limit) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function normalize(raw) {
  const managerMap = new Map((Array.isArray(raw?.managers) ? raw.managers : []).map(item => [item?.key, item]));
  return {
    verdict: clean(raw?.verdict, 240) || "Build the next radio advantage through measured experiments.",
    summary: clean(raw?.summary, 4000),
    managers: RADIO_MANAGERS.map(manager => {
      const item = managerMap.get(manager.key) || {};
      return {
        ...manager,
        assessment: clean(item.assessment, 800) || "More station evidence is needed before making a strong claim.",
        opportunity: clean(item.opportunity, 500) || "Create one measurable test in this manager's remit.",
        watchMetric: clean(item.watchMetric, 200) || "Evidence coverage"
      };
    }),
    actions: (Array.isArray(raw?.actions) ? raw.actions : []).slice(0, 8).map(item => ({
      managerKey: managerKeys.has(item?.managerKey) ? item.managerKey : "programme",
      title: clean(item?.title, 240),
      rationale: clean(item?.rationale, 1200),
      expectedMetric: clean(item?.expectedMetric, 300),
      priority: priorityValues.has(item?.priority) ? item.priority : "medium",
      effort: effortValues.has(item?.effort) ? item.effort : "medium"
    })).filter(item => item.title),
    experiments: (Array.isArray(raw?.experiments) ? raw.experiments : []).slice(0, 6).map(item => clean(item, 500)).filter(Boolean),
    risks: (Array.isArray(raw?.risks) ? raw.risks : []).slice(0, 6).map(item => clean(item, 500)).filter(Boolean)
  };
}

function fallbackCouncil(signals) {
  const audience = signals.audience || {};
  const catalogue = signals.catalogue || {};
  const programming = signals.programming || {};
  const reliability = signals.reliability || {};
  const hasAudience = Number(audience.uniqueListeners || 0) > 0;
  return {
    verdict: hasAudience ? "Turn current listening into a repeatable weekly habit." : "Instrument the audience before scaling the schedule.",
    summary: "The council used a conservative evidence-only fallback. It prioritizes measurement, dependable programming, artist development and controlled distribution tests.",
    managers: [
      { key: "programme", assessment: `${programming.publishedShows || 0} published shows and ${programming.playsLastWeek || 0} recorded plays are visible.`, opportunity: "Give each room a recognizable weekly appointment and compare retention by format.", watchMetric: "Average session minutes by show and room" },
      { key: "audience", assessment: `${audience.uniqueListeners || 0} unique listeners and ${audience.averageSessionMinutes || 0} average session minutes are visible in the current window.`, opportunity: "Improve tune-in attribution and identify where listeners leave.", watchMetric: "Seven-day returning listener rate" },
      { key: "artist", assessment: `${catalogue.rotationTracks || 0} rotation tracks and ${catalogue.tracksAwaitingReview || 0} tracks awaiting review are visible.`, opportunity: "Create a predictable review-to-airplay path with useful artist feedback.", watchMetric: "Reviewed tracks reaching rotation" },
      { key: "systems", assessment: `${reliability.openIssues || 0} open radio issues are visible.`, opportunity: "Protect uninterrupted playback before increasing promotion.", watchMetric: "Successful listening sessions without recovery" },
      { key: "growth", assessment: "The current evidence does not identify acquisition sources strongly enough for confident scaling.", opportunity: "Run one trackable creator-led distribution test at a time.", watchMetric: "Qualified tune-ins per campaign source" }
    ],
    actions: [
      { managerKey: "audience", title: "Publish a weekly audience scorecard", rationale: "A shared baseline prevents programming decisions from relying on taste alone.", expectedMetric: "Tune-ins, unique listeners, average session minutes, skip rate and return rate reported weekly", priority: "critical", effort: "small" },
      { managerKey: "programme", title: "Test one signature appointment in each room", rationale: "Consistent appointments create a reason to return and make room performance comparable.", expectedMetric: "Session length and returning listeners improve for at least one room", priority: "high", effort: "medium" },
      { managerKey: "systems", title: "Close listener-impacting playback issues before promotion", rationale: "Paid or partner traffic is wasted when playback continuity is uncertain.", expectedMetric: "No critical radio issues and fewer recovery events", priority: reliability.openIssues ? "critical" : "medium", effort: "medium" },
      { managerKey: "artist", title: "Set a seven-day rotation review promise", rationale: "A dependable response loop makes the station useful to independent artists even before airplay.", expectedMetric: "Median submission-to-decision time below seven days", priority: "high", effort: "medium" },
      { managerKey: "growth", title: "Run one tagged creator distribution pilot", rationale: "A small attributed test reveals which partnerships bring listeners who stay.", expectedMetric: "Attributed tune-ins and session minutes from one pilot", priority: "medium", effort: "small" }
    ],
    experiments: ["Compare a hosted discovery hour with uninterrupted rotation in the same room and time band.", "Test artist-led tune-in links with source attribution and a seven-day return check."],
    risks: ["Sparse or incomplete audience attribution can create false confidence.", "Adding shows before reliability and review capacity are stable can weaken listener and artist trust."]
  };
}

export async function composeManagerCouncil(signals, objective, horizonDays) {
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: RADIO_MANAGER_MODEL,
      max_completion_tokens: 2200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ objective, horizonDays, managers: RADIO_MANAGERS, signals }) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "halo_radio_manager_council", strict: true, schema: RESPONSE_SCHEMA }
      }
    }, { signal: AbortSignal.timeout(25_000) });
    return { council: normalize(JSON.parse(completion.choices[0]?.message?.content || "{}")), usedFallback: false };
  } catch {
    return { council: normalize(fallbackCouncil(signals)), usedFallback: true };
  }
}

export async function runManagerCouncil(db, memberId, { objective, horizonDays }) {
  const id = randomUUID();
  const signals = await gatherStationSignals(db);
  const { council, usedFallback } = await composeManagerCouncil(signals, objective, horizonDays);
  await db.sql`
    INSERT INTO halo_radio_manager_councils (
      id, model, objective, horizon_days, verdict, summary, managers, experiments, risks,
      signals, used_fallback, created_by_member_id
    ) VALUES (
      ${id}, ${RADIO_MANAGER_MODEL}, ${objective}, ${horizonDays}, ${council.verdict}, ${council.summary},
      ${JSON.stringify(council.managers)}::jsonb, ${JSON.stringify(council.experiments)}::jsonb,
      ${JSON.stringify(council.risks)}::jsonb, ${JSON.stringify(signals)}::jsonb, ${usedFallback}, ${memberId}
    )
  `;
  for (const action of council.actions) {
    await db.sql`
      INSERT INTO halo_radio_manager_actions (
        id, council_id, manager_key, title, rationale, expected_metric, priority, effort
      ) VALUES (
        ${randomUUID()}, ${id}, ${action.managerKey}, ${action.title}, ${action.rationale},
        ${action.expectedMetric}, ${action.priority}, ${action.effort}
      )
    `;
  }
  return loadManagerCouncil(db, id);
}

function serializeAction(row) {
  return {
    id: row.id,
    councilId: row.council_id,
    managerKey: row.manager_key,
    title: row.title,
    rationale: row.rationale,
    expectedMetric: row.expected_metric,
    priority: row.priority,
    effort: row.effort,
    status: row.status,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null
  };
}

export async function loadManagerCouncil(db, councilId = "") {
  const councilRows = councilId
    ? await db.sql`SELECT * FROM halo_radio_manager_councils WHERE id = ${councilId} LIMIT 1`
    : await db.sql`SELECT * FROM halo_radio_manager_councils ORDER BY created_at DESC LIMIT 1`;
  const row = councilRows[0];
  if (!row) return null;
  const actionRows = await db.sql`
    SELECT * FROM halo_radio_manager_actions
    WHERE council_id = ${row.id}
    ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at
  `;
  return {
    id: row.id,
    model: row.model,
    objective: row.objective,
    horizonDays: Number(row.horizon_days),
    verdict: row.verdict,
    summary: row.summary,
    managers: row.managers || [],
    experiments: row.experiments || [],
    risks: row.risks || [],
    usedFallback: row.used_fallback,
    createdAt: new Date(row.created_at).toISOString(),
    actions: actionRows.map(serializeAction)
  };
}

export async function decideManagerAction(db, memberId, actionId, status, decisionNote) {
  const rows = await db.sql`
    UPDATE halo_radio_manager_actions
    SET status = ${status}, decision_note = ${decisionNote}, decided_by_member_id = ${memberId}, decided_at = NOW()
    WHERE id = ${actionId}
    RETURNING *
  `;
  return rows[0] ? serializeAction(rows[0]) : null;
}
