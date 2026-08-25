import { randomUUID } from "node:crypto";
import OpenAI from "openai";

export const AGENT_MODEL = "gpt-5.4-mini";

export const AGENT_ROLES = Object.freeze({
  atlas: {
    name: "Atlas",
    title: "Strategy and product",
    mission: "Protect focus, sequence the roadmap, and connect product decisions to the 90-day commercial objective.",
    categories: ["strategy", "product"]
  },
  pulse: {
    name: "Pulse",
    title: "Growth and revenue",
    mission: "Find evidence-backed ways to improve acquisition, conversion, recurring revenue, and retention.",
    categories: ["growth", "strategy"]
  },
  bridge: {
    name: "Bridge",
    title: "Creators and partnerships",
    mission: "Strengthen creator supply, launch readiness, partner value, and transparent creator economics.",
    categories: ["creator", "growth"]
  },
  hearth: {
    name: "Hearth",
    title: "Community and care",
    mission: "Improve belonging, healthy participation, member return behavior, support, consent, and trust.",
    categories: ["community", "risk"]
  },
  sentinel: {
    name: "Sentinel",
    title: "Operations and risk",
    mission: "Find reliability, security, privacy, rights, fulfillment, and operational risks before they become incidents.",
    categories: ["operations", "risk"]
  }
});

const PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const CATEGORIES = new Set(["strategy", "growth", "creator", "community", "product", "operations", "risk"]);
const ACTION_STATUSES = new Set(["proposed", "approved", "in_progress", "completed", "dismissed"]);

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value, maxLength = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
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

function readEnvironment(name) {
  return globalThis.Netlify?.env?.get(name) || "";
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
      recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            rationale: { type: "string" },
            category: { type: "string", enum: [...CATEGORIES] },
            priority: { type: "string", enum: [...PRIORITIES] },
            expectedMetric: { type: "string" },
            needsApproval: { type: "boolean" },
            dueDate: { type: ["string", "null"] }
          },
          required: ["title", "rationale", "category", "priority", "expectedMetric", "needsApproval", "dueDate"]
        }
      },
      risks: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      memoryUpdate: { type: "string" }
    },
    required: ["agentKey", "headline", "summary", "evidence", "recommendations", "risks", "confidence", "memoryUpdate"]
  };
}

const SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    executiveSummary: { type: "string" },
    healthScore: { type: "integer" },
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
        tomorrowQuestion: { type: "string" }
      },
      required: ["whatChanged", "whatWasWrong", "whatToLearn", "tomorrowQuestion"]
    },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentKey: { type: "string", enum: [...Object.keys(AGENT_ROLES), "mirror"] },
          title: { type: "string" },
          rationale: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
          priority: { type: "string", enum: [...PRIORITIES] },
          expectedMetric: { type: "string" },
          needsApproval: { type: "boolean" },
          dueDate: { type: ["string", "null"] }
        },
        required: ["agentKey", "title", "rationale", "category", "priority", "expectedMetric", "needsApproval", "dueDate"]
      }
    },
    memoryUpdate: { type: "string" }
  },
  required: ["executiveSummary", "healthScore", "confidence", "wins", "concerns", "reflection", "priorities", "memoryUpdate"]
};

function normalizeRecommendation(value, fallbackAgentKey) {
  const category = CATEGORIES.has(value?.category) ? value.category : AGENT_ROLES[fallbackAgentKey]?.categories[0] || "strategy";
  return {
    agentKey: Object.hasOwn(AGENT_ROLES, value?.agentKey) || value?.agentKey === "mirror" ? value.agentKey : fallbackAgentKey,
    title: cleanText(value?.title, 180),
    rationale: cleanText(value?.rationale, 1200),
    category,
    priority: PRIORITIES.has(value?.priority) ? value.priority : "medium",
    expectedMetric: cleanText(value?.expectedMetric, 240),
    needsApproval: value?.needsApproval !== false,
    dueDate: safeDate(value?.dueDate)
  };
}

function normalizeSpecialist(value, agentKey, fallback = false) {
  const role = AGENT_ROLES[agentKey];
  return {
    agentKey,
    headline: cleanText(value?.headline, 180) || `${role.name} daily signal`,
    summary: cleanText(value?.summary, 1600) || `${role.name} found insufficient evidence for a confident recommendation today.`,
    evidence: cleanStringList(value?.evidence),
    recommendations: Array.isArray(value?.recommendations)
      ? value.recommendations.map(item => normalizeRecommendation(item, agentKey)).filter(item => item.title && item.rationale).slice(0, 4)
      : [],
    risks: cleanStringList(value?.risks),
    confidence: clamp(value?.confidence || (fallback ? 0.35 : 0.5), 0, 1),
    memoryUpdate: cleanText(value?.memoryUpdate, 800),
    usedFallback: fallback
  };
}

function normalizeSynthesis(value, findings) {
  const priorities = Array.isArray(value?.priorities)
    ? value.priorities.map(item => normalizeRecommendation(item, item?.agentKey || "mirror")).filter(item => item.title && item.rationale).slice(0, 8)
    : findings.flatMap(finding => finding.recommendations).slice(0, 8);
  return {
    executiveSummary: cleanText(value?.executiveSummary, 2400) || "HALO's agent council completed a daily review using the available product and operating signals.",
    healthScore: Math.round(clamp(value?.healthScore || 50, 0, 100)),
    confidence: clamp(value?.confidence || 0.5, 0, 1),
    wins: cleanStringList(value?.wins),
    concerns: cleanStringList(value?.concerns),
    reflection: {
      whatChanged: cleanText(value?.reflection?.whatChanged, 800),
      whatWasWrong: cleanText(value?.reflection?.whatWasWrong, 800),
      whatToLearn: cleanText(value?.reflection?.whatToLearn, 800),
      tomorrowQuestion: cleanText(value?.reflection?.tomorrowQuestion, 400)
    },
    priorities,
    memoryUpdate: cleanText(value?.memoryUpdate, 1000)
  };
}

function fallbackSpecialist(agentKey, metrics) {
  const role = AGENT_ROLES[agentKey];
  const visitors = numberValue(metrics.audience?.visitors7d);
  const activeMembers = numberValue(metrics.membership?.active7d);
  const realCreators = numberValue(metrics.marketplace?.realCreators);
  const openIssues = numberValue(metrics.operations?.openIssues);
  const recentIssues = Array.isArray(metrics.operations?.recentIssues) ? metrics.operations.recentIssues : [];
  const radioIssues = recentIssues.filter(issue => issue.category === "radio");
  const recommendations = [];

  if (agentKey === "pulse") {
    recommendations.push({
      title: visitors ? "Measure the account-to-paid conversion path" : "Create the first qualified audience baseline",
      rationale: visitors ? "Traffic exists, but revenue quality cannot improve without a visible conversion and payment baseline." : "Growth decisions need a seven-day visitor and signup baseline before spending on acquisition.",
      category: "growth",
      priority: "high",
      expectedMetric: "A documented seven-day visit, signup, checkout, and payment funnel",
      needsApproval: true,
      dueDate: null
    });
  } else if (agentKey === "bridge") {
    recommendations.push({
      title: "Prioritize real creator onboarding",
      rationale: `${realCreators} non-demo creators are currently visible in the marketplace data. The launch requires signed creators and fulfillment-ready offers.`,
      category: "creator",
      priority: "high",
      expectedMetric: "At least five signed, non-demo creators with one approved offer each",
      needsApproval: true,
      dueDate: null
    });
  } else if (agentKey === "hearth") {
    recommendations.push({
      title: "Establish a weekly return ritual",
      rationale: `${activeMembers} members were active in the last seven days. A predictable room or listening ritual creates a measurable reason to return.`,
      category: "community",
      priority: "medium",
      expectedMetric: "Weekly active-member return rate and attendance per ritual",
      needsApproval: true,
      dueDate: null
    });
  } else if (agentKey === "sentinel") {
    recommendations.push({
      title: radioIssues.length ? "Restore Halo Radio from the verified playback path" : openIssues ? "Resolve the highest-severity open issue" : "Run the commercial fulfillment checklist",
      rationale: radioIssues.length ? `${radioIssues.length} open radio issue(s) are visible. Follow the radio playback runbook: verify the public HTTPS stream and HLS selection, reject generated tones, then test mutually exclusive browser-audio and YouTube recovery playback.` : openIssues ? `${openIssues} maintenance issues remain open and should be triaged before scaling traffic.` : "Payments, rights, refunds, delivery, and owner approval need one documented operational rehearsal.",
      category: radioIssues.length || openIssues ? "operations" : "risk",
      priority: radioIssues.length || openIssues ? "high" : "medium",
      expectedMetric: radioIssues.length ? "Radio health passes and play, pause, recovery video, and source switching are verified" : openIssues ? "Highest-severity issue resolved or assigned" : "One complete checkout-to-fulfillment rehearsal",
      needsApproval: true,
      dueDate: null
    });
  } else {
    recommendations.push({
      title: "Keep Creator Launch Rooms as the primary commercial loop",
      rationale: "The platform has broad capability, so daily work should stay tied to creator supply, fan conversion, fulfillment, and retention.",
      category: "strategy",
      priority: "high",
      expectedMetric: "Every active task maps to acquisition, activation, revenue, retention, trust, or compliance",
      needsApproval: true,
      dueDate: null
    });
  }

  return normalizeSpecialist({
    headline: `${role.name} completed a deterministic review`,
    summary: `Cloud inference was unavailable, so ${role.name} used the current aggregate metrics and HALO's 90-day objective to produce a conservative recommendation.`,
    evidence: [
      `${visitors} unique visitors recorded in seven days`,
      `${activeMembers} members active in seven days`,
      `${realCreators} non-demo creators recorded`,
      `${openIssues} maintenance issues open`,
      `${radioIssues.length} open radio issues included in council evidence`
    ],
    recommendations,
    risks: ["The recommendation has lower confidence because model inference was unavailable."],
    confidence: 0.35,
    memoryUpdate: "Retain the latest aggregate baseline and compare it with the next successful council run."
  }, agentKey, true);
}

function fallbackSynthesis(findings, metrics) {
  const openIssues = numberValue(metrics.operations?.openIssues);
  const realCreators = numberValue(metrics.marketplace?.realCreators);
  const healthScore = Math.max(25, Math.min(75, 55 + Math.min(realCreators, 10) - Math.min(openIssues * 3, 20)));
  return normalizeSynthesis({
    executiveSummary: "The HALO council completed a conservative daily review. The immediate priority remains proving the creator-to-fan commercial loop while keeping payments, rights, support, and reliability under owner control.",
    healthScore,
    confidence: 0.38,
    wins: ["The platform produced a complete aggregate operating snapshot.", "Each specialist returned a bounded recommendation with an approval gate."],
    concerns: ["Cloud synthesis was unavailable, so the council could not compare signals with full model reasoning."],
    reflection: {
      whatChanged: "Today's aggregate metrics were recorded as a new operating baseline.",
      whatWasWrong: "No prior prediction should be treated as correct until an owner records the actual outcome.",
      whatToLearn: "Track completed actions and compare expected metrics with real outcomes on the next run.",
      tomorrowQuestion: "Which approved action produced the clearest measurable movement?"
    },
    priorities: findings.flatMap(finding => finding.recommendations).slice(0, 6),
    memoryUpdate: "Use completed action outcomes, not recommendation volume, as the main evidence of learning."
  }, findings);
}

export async function collectAgentMetrics(db) {
  const [audienceRows, membershipRows, communityRows, marketplaceRows, releaseRows, operationsRows, intelligenceRows, recentIssueRows] = await Promise.all([
    db.sql`
      SELECT
        COUNT(DISTINCT anonymous_id) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS visitors_24h,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS visitors_7d,
        COUNT(*) FILTER (WHERE event_name = 'page_view' AND created_at >= NOW() - INTERVAL '24 hours')::int AS page_views_24h,
        COUNT(*) FILTER (WHERE event_name = 'page_view' AND created_at >= NOW() - INTERVAL '7 days')::int AS page_views_7d
      FROM analytics_events
    `,
    db.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE joined_at >= NOW() - INTERVAL '24 hours')::int AS joined_24h,
        COUNT(*) FILTER (WHERE joined_at >= NOW() - INTERVAL '7 days')::int AS joined_7d,
        COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '24 hours')::int AS active_24h,
        COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '7 days')::int AS active_7d,
        COUNT(*) FILTER (WHERE tier IN ('gold', 'backstage', 'founder'))::int AS elevated_access
      FROM halo_memberships
    `,
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM community_messages WHERE created_at >= NOW() - INTERVAL '7 days') AS messages_7d,
        (SELECT COUNT(*)::int FROM community_room_posts WHERE created_at >= NOW() - INTERVAL '7 days') AS room_posts_7d,
        (SELECT COUNT(*)::int FROM community_support WHERE created_at >= NOW() - INTERVAL '7 days') AS support_7d,
        (SELECT COUNT(*)::int FROM community_reports WHERE status = 'open') AS open_reports
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS published_creators,
        COUNT(*) FILTER (WHERE status = 'published' AND is_demo = FALSE)::int AS real_creators,
        (SELECT COUNT(*)::int FROM marketplace_products WHERE status = 'published') AS published_products,
        (SELECT COUNT(*)::int FROM marketplace_interests WHERE created_at >= NOW() - INTERVAL '7 days') AS interests_7d
      FROM marketplace_creators
    `,
    db.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'interested')::int AS interested,
        COUNT(*) FILTER (WHERE status = 'downloaded')::int AS downloaded,
        COUNT(*) FILTER (WHERE status = 'played')::int AS played
      FROM halo_release_selector_responses
    `,
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM maintenance_issues WHERE status <> 'healed') AS open_issues,
        (SELECT COUNT(*)::int FROM maintenance_issues WHERE status <> 'healed' AND severity IN ('high', 'critical')) AS severe_issues,
        (SELECT failed_checks::int FROM halo_maintenance_sweeps ORDER BY started_at DESC LIMIT 1) AS latest_failed_checks,
        (SELECT pages_checked::int + connections_checked::int + outputs_checked::int FROM halo_maintenance_sweeps ORDER BY started_at DESC LIMIT 1) AS latest_checks_total,
        (SELECT COUNT(*)::int FROM halo_relationship_tasks WHERE status = 'open') AS open_relationship_tasks,
        (SELECT COUNT(*)::int FROM halo_companion_care_requests WHERE status = 'open') AS open_care_requests
    `,
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_dj_decisions WHERE created_at >= NOW() - INTERVAL '7 days') AS dj_decisions_7d,
        (SELECT COUNT(*)::int FROM halo_dj_audience_signals WHERE created_at >= NOW() - INTERVAL '7 days') AS audience_signals_7d,
        (SELECT COUNT(*)::int FROM halo_mixes WHERE created_at >= NOW() - INTERVAL '7 days') AS mixes_7d
    `,
    db.sql`
      SELECT source, category, severity, title, LEFT(details, 500) AS details,
             page_path, status, occurrence_count, last_seen_at
      FROM maintenance_issues
      WHERE status <> 'healed'
      ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        last_seen_at DESC
      LIMIT 12
    `
  ]);

  const audience = audienceRows[0] || {};
  const membership = membershipRows[0] || {};
  const community = communityRows[0] || {};
  const marketplace = marketplaceRows[0] || {};
  const releases = releaseRows[0] || {};
  const operations = operationsRows[0] || {};
  const intelligence = intelligenceRows[0] || {};

  return {
    capturedAt: new Date().toISOString(),
    audience: {
      visitors24h: numberValue(audience.visitors_24h),
      visitors7d: numberValue(audience.visitors_7d),
      pageViews24h: numberValue(audience.page_views_24h),
      pageViews7d: numberValue(audience.page_views_7d)
    },
    membership: {
      total: numberValue(membership.total),
      joined24h: numberValue(membership.joined_24h),
      joined7d: numberValue(membership.joined_7d),
      active24h: numberValue(membership.active_24h),
      active7d: numberValue(membership.active_7d),
      elevatedAccess: numberValue(membership.elevated_access)
    },
    community: {
      messages7d: numberValue(community.messages_7d),
      roomPosts7d: numberValue(community.room_posts_7d),
      support7d: numberValue(community.support_7d),
      openReports: numberValue(community.open_reports)
    },
    marketplace: {
      publishedCreators: numberValue(marketplace.published_creators),
      realCreators: numberValue(marketplace.real_creators),
      publishedProducts: numberValue(marketplace.published_products),
      interests7d: numberValue(marketplace.interests_7d)
    },
    releases: {
      totalResponses: numberValue(releases.total),
      interested: numberValue(releases.interested),
      downloaded: numberValue(releases.downloaded),
      played: numberValue(releases.played)
    },
    operations: {
      openIssues: numberValue(operations.open_issues),
      severeIssues: numberValue(operations.severe_issues),
      latestFailedChecks: numberValue(operations.latest_failed_checks),
      latestChecksTotal: numberValue(operations.latest_checks_total),
      openRelationshipTasks: numberValue(operations.open_relationship_tasks),
      openCareRequests: numberValue(operations.open_care_requests),
      recentIssues: recentIssueRows.map(row => ({
        source: cleanText(row.source, 32),
        category: cleanText(row.category, 48),
        severity: cleanText(row.severity, 16),
        title: cleanText(row.title, 180),
        details: cleanText(row.details, 500),
        pagePath: cleanText(row.page_path, 256),
        status: cleanText(row.status, 24),
        occurrenceCount: numberValue(row.occurrence_count),
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null
      }))
    },
    intelligence: {
      djDecisions7d: numberValue(intelligence.dj_decisions_7d),
      audienceSignals7d: numberValue(intelligence.audience_signals_7d),
      mixes7d: numberValue(intelligence.mixes_7d)
    }
  };
}

async function loadCouncilContext(db) {
  const [memoryRows, actionRows, runRows, knowledgeRows] = await Promise.all([
    db.sql`SELECT agent_key, working_model, lessons, last_reflection, run_count FROM halo_agent_memory`,
    db.sql`
      SELECT agent_key, title, status, expected_metric, actual_outcome, owner_note, updated_at
      FROM halo_agent_actions
      WHERE status IN ('completed', 'dismissed') OR actual_outcome <> '' OR owner_note <> ''
      ORDER BY updated_at DESC
      LIMIT 30
    `,
    db.sql`
      SELECT executive_summary, health_score, reflection, report_date
      FROM halo_agent_runs
      WHERE status IN ('complete', 'partial')
      ORDER BY started_at DESC
      LIMIT 1
    `,
    db.sql`
      SELECT knowledge_key, title, domain, summary, symptoms, diagnosis, resolution, verification, related_paths
      FROM halo_agent_knowledge
      WHERE status = 'active'
      ORDER BY updated_at DESC
      LIMIT 20
    `
  ]);
  return {
    memory: Object.fromEntries(memoryRows.map(row => [row.agent_key, row])),
    outcomes: actionRows,
    previousRun: runRows[0] || null,
    operationalKnowledge: knowledgeRows.map(row => ({
      knowledgeKey: row.knowledge_key,
      title: row.title,
      domain: row.domain,
      summary: row.summary,
      symptoms: row.symptoms || [],
      diagnosis: row.diagnosis || [],
      resolution: row.resolution || [],
      verification: row.verification || [],
      relatedPaths: row.related_paths || []
    }))
  };
}

async function runSpecialist(openai, agentKey, metrics, context) {
  const role = AGENT_ROLES[agentKey];
  const completion = await openai.chat.completions.create({
    model: AGENT_MODEL,
    max_completion_tokens: 900,
    messages: [
      {
        role: "system",
        content: `You are ${role.name}, HALO's ${role.title} agent. ${role.mission} Work only from the supplied aggregate evidence. Do not invent revenue, users, contracts, creator consent, legal status, completed work, or causal claims. Recommendations are proposals only: never claim to send messages, spend money, publish content, change accounts, enter contracts, make payments, or take external action. Flag missing evidence. Prefer one to three measurable priorities. Reflect on prior outcomes and correct earlier assumptions when evidence contradicts them. Return JSON only.`
      },
      {
        role: "user",
        content: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          ninetyDayObjective: "Prove a repeatable creator-to-fan commercial loop with real creators, paid offers, retention, rights, and owner-controlled fulfillment.",
          metrics,
          operationalKnowledge: context.operationalKnowledge,
          priorMemory: context.memory[agentKey] || null,
          completedOrReviewedActions: context.outcomes.filter(item => item.agent_key === agentKey).slice(0, 10),
          previousCouncilReport: context.previousRun
        })
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: `halo_${agentKey}_daily`, strict: true, schema: specialistSchema(agentKey) }
    }
  }, { signal: AbortSignal.timeout(11_000) });
  return normalizeSpecialist(JSON.parse(completion.choices[0]?.message?.content || "{}"), agentKey);
}

async function runMirror(openai, metrics, findings, context) {
  const completion = await openai.chat.completions.create({
    model: AGENT_MODEL,
    max_completion_tokens: 1400,
    messages: [
      {
        role: "system",
        content: "You are Mirror, the HALO council synthesizer and self-reflection agent. Compare specialist findings against the supplied aggregate evidence and recorded outcomes. Remove duplicate, unsupported, unsafe, or low-value recommendations. Admit uncertainty. Correct prior assumptions when outcomes disagree. Select no more than six priorities, and keep every real-world action behind owner approval. Never claim to have executed an action. Return JSON only."
      },
      {
        role: "user",
        content: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          metrics,
          specialistFindings: findings,
          operationalKnowledge: context.operationalKnowledge,
          priorMirrorMemory: context.memory.mirror || null,
          recentOutcomes: context.outcomes,
          previousCouncilReport: context.previousRun
        })
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "halo_mirror_daily", strict: true, schema: SYNTHESIS_SCHEMA }
    }
  }, { signal: AbortSignal.timeout(11_000) });
  return normalizeSynthesis(JSON.parse(completion.choices[0]?.message?.content || "{}"), findings);
}

async function persistFinding(db, runId, finding) {
  await db.sql`
    INSERT INTO halo_agent_findings (
      run_id, agent_key, headline, summary, evidence, recommendations, risks, confidence, used_fallback
    ) VALUES (
      ${runId}, ${finding.agentKey}, ${finding.headline}, ${finding.summary},
      ${JSON.stringify(finding.evidence)}::jsonb, ${JSON.stringify(finding.recommendations)}::jsonb,
      ${JSON.stringify(finding.risks)}::jsonb, ${finding.confidence}, ${finding.usedFallback}
    )
  `;
}

async function persistAction(db, runId, action) {
  await db.sql`
    INSERT INTO halo_agent_actions (
      run_id, agent_key, title, rationale, category, priority, needs_approval, expected_metric, due_date
    ) VALUES (
      ${runId}, ${action.agentKey}, ${action.title}, ${action.rationale}, ${action.category}, ${action.priority},
      ${action.needsApproval}, ${action.expectedMetric}, ${action.dueDate}
    )
  `;
}

async function updateMemory(db, agentKey, reflection, workingModel) {
  const lessons = cleanStringList(workingModel?.risks || [], 6, 240);
  await db.sql`
    INSERT INTO halo_agent_memory (agent_key, working_model, lessons, last_reflection, run_count)
    VALUES (${agentKey}, ${JSON.stringify(workingModel || {})}::jsonb, ${JSON.stringify(lessons)}::jsonb, ${reflection}, 1)
    ON CONFLICT (agent_key) DO UPDATE SET
      working_model = EXCLUDED.working_model,
      lessons = EXCLUDED.lessons,
      last_reflection = EXCLUDED.last_reflection,
      run_count = halo_agent_memory.run_count + 1,
      updated_at = NOW()
  `;
}

export async function runAgentCouncil(db, { triggerType = "scheduled" } = {}) {
  const runId = randomUUID();
  const reportDate = new Date().toISOString().slice(0, 10);
  const metrics = await collectAgentMetrics(db);
  const context = await loadCouncilContext(db);

  await db.sql`
    INSERT INTO halo_agent_runs (id, report_date, trigger_type, status, model, metrics)
    VALUES (${runId}, ${reportDate}, ${triggerType}, 'running', ${AGENT_MODEL}, ${JSON.stringify(metrics)}::jsonb)
  `;

  let openai;
  try {
    openai = new OpenAI();
  } catch {
    openai = null;
  }

  let failedAgents = 0;
  const findings = await Promise.all(Object.keys(AGENT_ROLES).map(async agentKey => {
    if (!openai) {
      failedAgents += 1;
      return fallbackSpecialist(agentKey, metrics);
    }
    try {
      return await runSpecialist(openai, agentKey, metrics, context);
    } catch (error) {
      failedAgents += 1;
      console.error(`HALO agent ${agentKey} inference failed`, error instanceof Error ? error.message : "unknown error");
      return fallbackSpecialist(agentKey, metrics);
    }
  }));

  for (const finding of findings) await persistFinding(db, runId, finding);

  let synthesis;
  let mirrorFallback = false;
  try {
    synthesis = openai ? await runMirror(openai, metrics, findings, context) : fallbackSynthesis(findings, metrics);
    mirrorFallback = !openai;
  } catch (error) {
    mirrorFallback = true;
    console.error("HALO Mirror inference failed", error instanceof Error ? error.message : "unknown error");
    synthesis = fallbackSynthesis(findings, metrics);
  }

  for (const action of synthesis.priorities) await persistAction(db, runId, action);
  for (const finding of findings) {
    await updateMemory(db, finding.agentKey, finding.memoryUpdate, {
      headline: finding.headline,
      summary: finding.summary,
      risks: finding.risks,
      recommendations: finding.recommendations.map(item => ({ title: item.title, expectedMetric: item.expectedMetric }))
    });
  }
  await updateMemory(db, "mirror", synthesis.memoryUpdate, {
    healthScore: synthesis.healthScore,
    executiveSummary: synthesis.executiveSummary,
    risks: synthesis.concerns,
    tomorrowQuestion: synthesis.reflection.tomorrowQuestion
  });

  const status = failedAgents || mirrorFallback ? "partial" : "complete";
  const errorSummary = status === "partial" ? `${failedAgents} specialist fallback(s); Mirror fallback: ${mirrorFallback ? "yes" : "no"}.` : "";
  await db.sql`
    UPDATE halo_agent_runs SET
      status = ${status},
      executive_summary = ${synthesis.executiveSummary},
      health_score = ${synthesis.healthScore},
      confidence = ${synthesis.confidence},
      wins = ${JSON.stringify(synthesis.wins)}::jsonb,
      concerns = ${JSON.stringify(synthesis.concerns)}::jsonb,
      reflection = ${JSON.stringify(synthesis.reflection)}::jsonb,
      error_summary = ${errorSummary},
      completed_at = NOW()
    WHERE id = ${runId}
  `;

  return { id: runId, reportDate, status, model: AGENT_MODEL, metrics, findings, synthesis };
}

function serializeRun(row) {
  return {
    id: row.id,
    reportDate: String(row.report_date),
    triggerType: row.trigger_type,
    status: row.status,
    model: row.model,
    metrics: row.metrics || {},
    executiveSummary: row.executive_summary,
    healthScore: numberValue(row.health_score),
    confidence: numberValue(row.confidence),
    wins: row.wins || [],
    concerns: row.concerns || [],
    reflection: row.reflection || {},
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
    ownerNote: row.owner_note,
    actualOutcome: row.actual_outcome,
    dueDate: row.due_date ? String(row.due_date) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export async function loadAgentDashboard(db) {
  const [runRows, findingRows, actionRows, memoryRows] = await Promise.all([
    db.sql`SELECT * FROM halo_agent_runs ORDER BY started_at DESC LIMIT 14`,
    db.sql`
      SELECT finding.* FROM halo_agent_findings AS finding
      JOIN halo_agent_runs AS run ON run.id = finding.run_id
      WHERE run.id = (SELECT id FROM halo_agent_runs ORDER BY started_at DESC LIMIT 1)
      ORDER BY finding.id
    `,
    db.sql`
      SELECT * FROM halo_agent_actions
      WHERE status IN ('proposed', 'approved', 'in_progress')
         OR run_id = (SELECT id FROM halo_agent_runs ORDER BY started_at DESC LIMIT 1)
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT 60
    `,
    db.sql`SELECT * FROM halo_agent_memory ORDER BY agent_key`
  ]);
  return {
    roles: Object.fromEntries(Object.entries(AGENT_ROLES).map(([key, role]) => [key, { ...role }])),
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

export async function updateAgentAction(db, actionId, values) {
  const id = Math.trunc(numberValue(actionId));
  const status = ACTION_STATUSES.has(values?.status) ? values.status : null;
  const ownerNote = cleanText(values?.ownerNote, 1200);
  const actualOutcome = cleanText(values?.actualOutcome, 1200);
  if (!id || !status) return null;
  const rows = await db.sql`
    UPDATE halo_agent_actions SET
      status = ${status},
      owner_note = ${ownerNote},
      actual_outcome = ${actualOutcome},
      completed_at = CASE WHEN ${status} = 'completed' THEN NOW() ELSE NULL END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ? serializeAction(rows[0]) : null;
}

export async function canRunManualCouncil(db) {
  const rows = await db.sql`
    SELECT COUNT(*)::int AS total
    FROM halo_agent_runs
    WHERE trigger_type = 'manual' AND started_at >= NOW() - INTERVAL '1 hour'
  `;
  return numberValue(rows[0]?.total) < 2;
}

export async function sendAgentReportWebhook(report) {
  const configured = readEnvironment("HALO_AGENT_REPORT_WEBHOOK_URL");
  if (!configured) return false;
  let webhookUrl;
  try {
    webhookUrl = new URL(configured);
  } catch {
    return false;
  }
  if (webhookUrl.protocol !== "https:" || webhookUrl.username || webhookUrl.password) return false;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "halo_agent_daily_report",
      reportDate: report.reportDate,
      status: report.status,
      healthScore: report.synthesis.healthScore,
      confidence: report.synthesis.confidence,
      executiveSummary: report.synthesis.executiveSummary,
      wins: report.synthesis.wins,
      concerns: report.synthesis.concerns,
      reflection: report.synthesis.reflection,
      priorities: report.synthesis.priorities.map(item => ({
        agentKey: item.agentKey,
        title: item.title,
        priority: item.priority,
        expectedMetric: item.expectedMetric,
        needsApproval: item.needsApproval
      }))
    }),
    signal: AbortSignal.timeout(8000)
  });
  return response.ok;
}
