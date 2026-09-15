import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";
import OpenAI from "openai";
import { appendLedgerEntry } from "./halo-ledger.mjs";
import { AI_MODELS, MAINTENANCE_TRIAGE_SYSTEM_PROMPT } from "./ai-governance.mjs";
import { normalizeVerificationMetadata } from "./verification-metadata.mjs";

const severityLevels = new Set(["low", "medium", "high", "critical"]);
const sources = new Set(["browser", "manual", "scheduled", "server"]);
const DISPATCH_MAX_ATTEMPTS = 3;
const DISPATCH_BACKOFF_MINUTES = [2, 10, 30];
const RETRYABLE_DISPATCH_STATUS_LIST = ["pending", "failed", "retrying", "escalated"];
const RETRYABLE_DISPATCH_STATUSES = new Set(RETRYABLE_DISPATCH_STATUS_LIST);

function toIsoTimestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null;
}

function cleanText(value, maximum, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum) || fallback;
}

function cleanPagePath(value) {
  const path = cleanText(value, 256, "/").split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : "/";
}

function cleanMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 12)
      .flatMap(([key, item]) => {
        const cleanKey = cleanText(key, 48);
        if (!cleanKey) return [];
        if (typeof item === "boolean" || typeof item === "number") return [[cleanKey, item]];
        if (typeof item === "string") return [[cleanKey, cleanText(item, 240)]];
        return [];
      })
  );
}

export async function recordMaintenanceLifecycle(db, issue, lifecycleEvent, {
  summary = "",
  outcome = "pending",
  details = {},
  body = ""
} = {}) {
  try {
    await appendLedgerEntry(db, {
      actorId: "system",
      actorType: "system",
      eventCategory: "maintenance_lifecycle",
      refIssueId: String(issue?.id ?? issue?.issueKey ?? ""),
      summary: summary || `Maintenance ${lifecycleEvent}: ${issue?.title || "Issue"}`,
      details: {
        lifecycleEvent,
        issueId: issue?.id ?? null,
        issueKey: issue?.issueKey ?? null,
        issueStatus: issue?.status ?? null,
        triageStatus: issue?.triageStatus ?? null,
        dispatchStatus: issue?.dispatchStatus ?? null,
        ...details
      },
      body: body || issue?.details || "",
      outcome
    });
  } catch (error) {
    console.error("Maintenance lifecycle ledger entry failed", error instanceof Error ? error.message : "unknown error");
  }
}

export function normalizeIssue(payload = {}) {
  const source = sources.has(payload.source) ? payload.source : "browser";
  const category = cleanText(payload.category, 48, "runtime").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const severity = severityLevels.has(payload.severity) ? payload.severity : "medium";
  const title = cleanText(payload.title, 180, "Site issue detected");
  const details = cleanText(payload.details, 4000, "No additional details were supplied.");
  const pagePath = cleanPagePath(payload.pagePath);
  const metadata = cleanMetadata(payload.metadata);
  const fingerprintSource = cleanText(payload.fingerprint, 500) || `${source}|${category}|${title}|${pagePath}`;
  const issueKey = createHash("sha256").update(fingerprintSource).digest("hex");

  return { issueKey, source, category, severity, title, details, pagePath, metadata };
}

export function maintenanceAuthorized(request) {
  const expectedToken = process.env.MAINTENANCE_AGENT_TOKEN;
  if (!expectedToken) return false;

  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function acceptPublicIssueReport(request) {
  const address = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const reporterKey = createHash("sha256").update(`${address.split(",")[0]}|${userAgent}`).digest("hex");
  const db = getDatabase();
  const insertedRows = await db.sql`
    INSERT INTO maintenance_report_events (reporter_key)
    SELECT ${reporterKey}
    WHERE (
      SELECT COUNT(*)
      FROM maintenance_report_events
      WHERE reporter_key = ${reporterKey}
        AND created_at >= NOW() - INTERVAL '1 minute'
    ) < 20
    RETURNING id
  `;
  return insertedRows.length > 0;
}

function parseAiTriage(text) {
  try {
    const parsed = JSON.parse(text);
    return {
      summary: cleanText(parsed.summary, 1200, "Automated triage completed."),
      severity: severityLevels.has(parsed.severity) ? parsed.severity : "medium",
      fixPlan: Array.isArray(parsed.fixPlan)
        ? parsed.fixPlan.slice(0, 8).map(step => cleanText(step, 500)).filter(Boolean)
        : [],
      verification: Array.isArray(parsed.verification)
        ? parsed.verification.slice(0, 6).map(step => cleanText(step, 500)).filter(Boolean)
        : []
    };
  } catch {
    return null;
  }
}

async function triageIssue(issue) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      summary: `${issue.title}. The maintenance worker should reproduce the issue, apply the smallest safe fix, and verify the affected route.`,
      severity: issue.severity,
      fixPlan: ["Reproduce the reported behavior", "Identify the root cause", "Apply a focused fix", "Run targeted verification"],
      verification: ["Confirm the original symptom no longer occurs", "Check adjacent functionality for regressions"]
    };
  }

  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: AI_MODELS.maintenanceTriage,
    input: [{
      role: "system",
      content: MAINTENANCE_TRIAGE_SYSTEM_PROMPT
    }, {
      role: "user",
      content: JSON.stringify({
        source: issue.source,
        category: issue.category,
        reportedSeverity: issue.severity,
        title: issue.title,
        details: issue.details,
        pagePath: issue.pagePath,
        metadata: issue.metadata
      })
    }],
    max_output_tokens: 900
  });

  return parseAiTriage(response.output_text) || {
    summary: `${issue.title}. Automated triage returned an unreadable response, so manual diagnosis is required.`,
    severity: issue.severity,
    fixPlan: ["Reproduce and diagnose the issue", "Apply a focused fix"],
    verification: ["Verify the original report"]
  };
}

function validWebhookUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function dispatchIssue(issue, triage) {
  const webhookUrl = process.env.MAINTENANCE_AI_WEBHOOK_URL;
  if (!validWebhookUrl(webhookUrl)) return { status: "not_configured", reference: null };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.MAINTENANCE_AGENT_TOKEN || ""}`,
      "Content-Type": "application/json",
      "User-Agent": "HALO-Maintenance-Scout/1.0"
    },
    body: JSON.stringify({
      event: "maintenance.issue.reported",
      issue: {
        id: issue.id,
        key: issue.issueKey,
        source: issue.source,
        category: issue.category,
        severity: triage.severity,
        title: issue.title,
        details: issue.details,
        pagePath: issue.pagePath,
        occurrenceCount: issue.occurrenceCount,
        firstSeenAt: issue.firstSeenAt,
        lastSeenAt: issue.lastSeenAt,
        metadata: issue.metadata
      },
      triage,
      callbackPath: `/api/maintenance/issues/${issue.id}`
    }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) throw new Error(`Maintenance webhook returned ${response.status}`);
  let responseBody = {};
  try {
    responseBody = await response.json();
  } catch {
    responseBody = {};
  }
  return { status: "sent", reference: cleanText(responseBody.reference, 180) || null };
}

function mapIssueRow(row) {
  return {
    id: Number(row.id),
    issueKey: row.issue_key,
    source: row.source,
    category: row.category,
    severity: row.severity,
    title: row.title,
    details: row.details,
    pagePath: row.page_path,
    metadata: row.metadata || {},
    status: row.status,
    occurrenceCount: Number(row.occurrence_count),
    triageStatus: row.triage_status,
    aiSummary: row.ai_summary,
    aiFixPlan: row.ai_fix_plan,
    dispatchStatus: row.dispatch_status,
    maintenanceReference: row.maintenance_reference,
    resolutionSummary: row.resolution_summary,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    dispatchedAt: row.dispatched_at,
    healedAt: row.healed_at,
    updatedAt: row.updated_at
  };
}

function nextDispatchAt(attemptNumber) {
  const backoffMinutes = DISPATCH_BACKOFF_MINUTES[Math.max(0, Math.min(DISPATCH_BACKOFF_MINUTES.length - 1, attemptNumber - 1))];
  return new Date(Date.now() + (backoffMinutes * 60 * 1000)).toISOString();
}

function dispatchAttempts(issue) {
  return Math.max(0, Number(issue?.metadata?.dispatchAttempts || 0));
}

function canRetryDispatch(issue) {
  if (!RETRYABLE_DISPATCH_STATUSES.has(issue.dispatchStatus)) return false;
  if (issue.dispatchStatus === "escalated") {
    const escalatedAt = toIsoTimestamp(issue?.metadata?.dispatchEscalatedAt);
    const lastSeenAt = toIsoTimestamp(issue.lastSeenAt);
    if (!lastSeenAt) return false;
    if (!escalatedAt) return true;
    return new Date(lastSeenAt) > new Date(escalatedAt);
  }
  const nextDispatchWindow = toIsoTimestamp(issue?.metadata?.nextDispatchAt);
  if (!nextDispatchWindow) return true;
  return new Date(nextDispatchWindow) <= new Date();
}

function triageFromIssue(issue) {
  const fixPlanData = issue?.aiFixPlan && typeof issue.aiFixPlan === "object" ? issue.aiFixPlan : {};
  const fallbackSummary = `${issue.title}. The maintenance worker should reproduce the issue, apply the smallest safe fix, and verify the affected route.`;
  return {
    summary: cleanText(issue.aiSummary, 1200, fallbackSummary),
    severity: severityLevels.has(issue.severity) ? issue.severity : "medium",
    fixPlan: Array.isArray(fixPlanData.fixPlan)
      ? fixPlanData.fixPlan.map(step => cleanText(step, 500)).filter(Boolean).slice(0, 8)
      : ["Reproduce the reported behavior", "Identify the root cause", "Apply a focused fix", "Run targeted verification"],
    verification: Array.isArray(fixPlanData.verification)
      ? fixPlanData.verification.map(step => cleanText(step, 500)).filter(Boolean).slice(0, 6)
      : ["Confirm the original symptom no longer occurs", "Check adjacent functionality for regressions"]
  };
}

function maintenanceProgressTimestamp(issue) {
  return toIsoTimestamp(
    issue?.metadata?.lastMaintenanceUpdateAt
      || issue?.updatedAt
      || issue?.dispatchedAt
      || issue?.lastSeenAt
      || issue?.firstSeenAt
  );
}

async function dispatchWithPersistence(db, issue, triage, source) {
  const escalatedAt = toIsoTimestamp(issue?.metadata?.dispatchEscalatedAt);
  const issueLastSeenAt = toIsoTimestamp(issue?.lastSeenAt);
  const restartAfterEscalation = issue.dispatchStatus === "escalated"
    && (!escalatedAt || (issueLastSeenAt && new Date(issueLastSeenAt) > new Date(escalatedAt)));
  const attempt = restartAfterEscalation ? 1 : dispatchAttempts(issue) + 1;
  try {
    const dispatch = await dispatchIssue(issue, triage);
    const nextMetadata = {
      ...(issue.metadata || {}),
      dispatchAttempts: attempt,
      nextDispatchAt: null,
      lastDispatchError: null,
      lastDispatchAt: new Date().toISOString(),
      dispatchEscalatedAt: null
    };
    const [dispatchedRow] = await db.sql`
      UPDATE maintenance_issues
      SET dispatch_status = ${dispatch.status},
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(nextMetadata)}::jsonb,
          maintenance_reference = COALESCE(${dispatch.reference}, maintenance_reference),
          dispatched_at = CASE WHEN ${dispatch.status} = 'sent' THEN NOW() ELSE dispatched_at END,
          status = CASE WHEN ${dispatch.status} = 'sent' AND status = 'open' THEN 'reported' ELSE status END,
          updated_at = NOW()
      WHERE id = ${issue.id}
      RETURNING *
    `;
    const updated = mapIssueRow(dispatchedRow);
    await recordMaintenanceLifecycle(db, updated, "dispatch_sent", {
      summary: `Maintenance dispatch sent: ${updated.title}`,
      outcome: "success",
      details: { source, attempt, maintenanceReference: updated.maintenanceReference }
    });
    return updated;
  } catch (error) {
    const lastError = cleanText(error instanceof Error ? error.message : "unknown error", 500, "unknown dispatch error");
    const escalated = attempt >= DISPATCH_MAX_ATTEMPTS;
    const nextMetadata = {
      ...(issue.metadata || {}),
      dispatchAttempts: attempt,
      nextDispatchAt: escalated ? null : nextDispatchAt(attempt),
      lastDispatchError: lastError,
      lastDispatchAt: new Date().toISOString(),
      dispatchEscalatedAt: escalated ? new Date().toISOString() : null
    };
    const [failedRow] = await db.sql`
      UPDATE maintenance_issues
      SET dispatch_status = ${escalated ? "escalated" : "retrying"},
          status = CASE WHEN ${escalated} THEN 'failed' ELSE status END,
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(nextMetadata)}::jsonb,
          updated_at = NOW()
      WHERE id = ${issue.id}
      RETURNING *
    `;
    const updated = mapIssueRow(failedRow);
    await recordMaintenanceLifecycle(db, updated, escalated ? "dispatch_escalated" : "dispatch_failed", {
      summary: escalated ? `Maintenance dispatch escalated: ${updated.title}` : `Maintenance dispatch failed: ${updated.title}`,
      outcome: "failure",
      details: { source, attempt, maxAttempts: DISPATCH_MAX_ATTEMPTS, error: lastError, nextDispatchAt: updated.metadata?.nextDispatchAt || null }
    });
    return updated;
  }
}

export async function reportIssue(payload) {
  const issue = normalizeIssue(payload);
  const db = getDatabase();
  const [row] = await db.sql`
    INSERT INTO maintenance_issues (
      issue_key, source, category, severity, title, details, page_path, metadata
    ) VALUES (
      ${issue.issueKey}, ${issue.source}, ${issue.category}, ${issue.severity},
      ${issue.title}, ${issue.details}, ${issue.pagePath}, ${JSON.stringify(issue.metadata)}::jsonb
    )
    ON CONFLICT (issue_key) DO UPDATE SET
      severity = EXCLUDED.severity,
      title = EXCLUDED.title,
      details = EXCLUDED.details,
      metadata = EXCLUDED.metadata,
      status = CASE
        WHEN maintenance_issues.status IN ('healed', 'ignored') THEN 'open'
        ELSE maintenance_issues.status
      END,
      occurrence_count = maintenance_issues.occurrence_count + 1,
      triage_status = CASE
        WHEN maintenance_issues.status IN ('healed', 'ignored') THEN 'pending'
        ELSE maintenance_issues.triage_status
      END,
      dispatch_status = CASE
        WHEN maintenance_issues.status IN ('healed', 'ignored')
          OR maintenance_issues.dispatch_status = 'escalated'
          OR maintenance_issues.last_seen_at < NOW() - INTERVAL '30 minutes' THEN 'pending'
        ELSE maintenance_issues.dispatch_status
      END,
      healed_at = CASE
        WHEN maintenance_issues.status IN ('healed', 'ignored') THEN NULL
        ELSE maintenance_issues.healed_at
      END,
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `;

  let storedIssue = mapIssueRow(row);

  await recordMaintenanceLifecycle(db, storedIssue, "issue_reported", {
    summary: `Issue reported: ${storedIssue.title}`,
    outcome: "pending",
    details: {
      category: storedIssue.category,
      severity: storedIssue.severity,
      source: storedIssue.source,
      pagePath: storedIssue.pagePath,
      occurrenceCount: storedIssue.occurrenceCount
    }
  });

  if (!canRetryDispatch(storedIssue)) return storedIssue;

  let triage;
  const shouldRunTriage = storedIssue.triageStatus !== "complete" || !storedIssue.aiSummary;
  try {
    if (shouldRunTriage) {
      await recordMaintenanceLifecycle(db, storedIssue, "triage_started", {
        summary: `Maintenance triage started: ${storedIssue.title}`,
        outcome: "pending"
      });
      triage = await triageIssue(storedIssue);
      const [triagedRow] = await db.sql`
        UPDATE maintenance_issues
        SET severity = ${triage.severity},
            triage_status = 'complete',
            ai_summary = ${triage.summary},
            ai_fix_plan = ${JSON.stringify({ fixPlan: triage.fixPlan, verification: triage.verification })}::jsonb,
            updated_at = NOW()
        WHERE id = ${storedIssue.id}
        RETURNING *
      `;
      storedIssue = mapIssueRow(triagedRow);
      await recordMaintenanceLifecycle(db, storedIssue, "triage_completed", {
        summary: `Maintenance triage completed: ${storedIssue.title}`,
        outcome: "success",
        details: { triageSeverity: triage.severity, fixPlanSteps: triage.fixPlan.length, verificationSteps: triage.verification.length }
      });
    } else {
      triage = triageFromIssue(storedIssue);
    }
  } catch (error) {
    console.error("Issue triage failed", error instanceof Error ? error.message : "unknown error");
    triage = {
      summary: `${storedIssue.title}. Automated triage was unavailable.`,
      severity: storedIssue.severity,
      fixPlan: ["Reproduce and diagnose the issue", "Apply a focused fix"],
      verification: ["Verify the original report"]
    };
    const [failedTriageRow] = await db.sql`
      UPDATE maintenance_issues
      SET triage_status = 'failed', updated_at = NOW()
      WHERE id = ${storedIssue.id}
      RETURNING *
    `;
    if (failedTriageRow) storedIssue = mapIssueRow(failedTriageRow);
    await recordMaintenanceLifecycle(db, storedIssue, "triage_failed", {
      summary: `Maintenance triage failed: ${storedIssue.title}`,
      outcome: "failure",
      details: { error: cleanText(error instanceof Error ? error.message : "unknown error", 500, "unknown triage error") }
    });
  }

  await recordMaintenanceLifecycle(db, storedIssue, "dispatch_started", {
    summary: `Maintenance dispatch started: ${storedIssue.title}`,
    outcome: "pending",
    details: { source: "issue_report" }
  });
  return dispatchWithPersistence(db, storedIssue, triage, "issue_report");
}

export async function resolveIssue(issueKey, summary, options = {}) {
  const db = getDatabase();
  const verification = normalizeVerificationMetadata(options.verification, {
    resultSummary: cleanText(summary, 1200, "Automated verification passed."),
    source: cleanText(options.source, 80, "automated")
  });
  const metadataPatch = verification
    ? { autoHealVerification: verification, lastHealedBy: "automation" }
    : { lastHealedBy: "automation" };
  const [row] = await db.sql`
    UPDATE maintenance_issues
    SET status = 'healed',
        resolution_summary = ${cleanText(summary, 2000, "Automated verification passed.")},
        metadata = (COALESCE(metadata, '{}'::jsonb) - 'autoHealVerification' - 'verificationUnavailableReason') || ${JSON.stringify(metadataPatch)}::jsonb,
        healed_at = NOW(),
        updated_at = NOW()
    WHERE issue_key = ${issueKey}
      AND status IN ('open', 'reported', 'acknowledged', 'in_progress', 'failed')
    RETURNING *
  `;
  if (!row) return false;
  const issue = mapIssueRow(row);
  await recordMaintenanceLifecycle(db, issue, "auto_healed", {
    summary: `Issue auto-healed: ${issue.title}`,
    outcome: "success",
    details: { verification: verification || null }
  });
  return true;
}

export async function retryDispatchQueue(db, { limit = 12 } = {}) {
  const rows = await db.sql`
    SELECT *
    FROM maintenance_issues
    WHERE status IN ('open', 'reported', 'failed')
      AND dispatch_status = ANY(${RETRYABLE_DISPATCH_STATUS_LIST})
      AND (
        dispatch_status <> 'escalated'
        OR last_seen_at > COALESCE(NULLIF(metadata->>'dispatchEscalatedAt', '')::timestamptz, to_timestamp(0))
      )
      AND (
        metadata->>'nextDispatchAt' IS NULL
        OR NULLIF(metadata->>'nextDispatchAt', '')::timestamptz <= NOW()
      )
    ORDER BY updated_at ASC
    LIMIT ${Math.max(1, Math.min(50, Number(limit) || 12))}
  `;
  const issues = rows.map(mapIssueRow);
  let sent = 0;
  let retrying = 0;
  let escalated = 0;

  for (const issue of issues) {
    await recordMaintenanceLifecycle(db, issue, "dispatch_started", {
      summary: `Maintenance dispatch retry started: ${issue.title}`,
      outcome: "pending",
      details: { source: "dispatch_retry" }
    });
    const updated = await dispatchWithPersistence(db, issue, triageFromIssue(issue), "dispatch_retry");
    if (updated.dispatchStatus === "sent") sent += 1;
    else if (updated.dispatchStatus === "retrying") retrying += 1;
    else if (updated.dispatchStatus === "escalated") escalated += 1;
  }

  return { considered: issues.length, sent, retrying, escalated };
}

export async function escalateStaleMaintenanceIssues(db, { limit = 24 } = {}) {
  const rows = await db.sql`
    SELECT *
    FROM maintenance_issues
    WHERE status IN ('open', 'reported', 'acknowledged', 'in_progress', 'failed')
      AND (
        metadata->>'staleEscalatedAt' IS NULL
        OR NULLIF(metadata->>'staleEscalatedAt', '')::timestamptz < COALESCE(NULLIF(metadata->>'lastMaintenanceUpdateAt', '')::timestamptz, updated_at, dispatched_at, last_seen_at, first_seen_at)
      )
      AND (
        (severity IN ('critical', 'high') AND COALESCE(NULLIF(metadata->>'lastMaintenanceUpdateAt', '')::timestamptz, updated_at, dispatched_at, last_seen_at, first_seen_at) < NOW() - INTERVAL '2 hours')
        OR (severity = 'medium' AND COALESCE(NULLIF(metadata->>'lastMaintenanceUpdateAt', '')::timestamptz, updated_at, dispatched_at, last_seen_at, first_seen_at) < NOW() - INTERVAL '8 hours')
        OR (severity = 'low' AND COALESCE(NULLIF(metadata->>'lastMaintenanceUpdateAt', '')::timestamptz, updated_at, dispatched_at, last_seen_at, first_seen_at) < NOW() - INTERVAL '24 hours')
      )
    ORDER BY updated_at ASC
    LIMIT ${Math.max(1, Math.min(100, Number(limit) || 24))}
  `;
  const issues = rows.map(mapIssueRow);
  for (const issue of issues) {
    const metadataPatch = {
      staleEscalatedAt: new Date().toISOString()
    };
    const [updatedRow] = await db.sql`
      UPDATE maintenance_issues
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb,
          updated_at = NOW()
      WHERE id = ${issue.id}
      RETURNING *
    `;
    const updatedIssue = updatedRow ? mapIssueRow(updatedRow) : issue;
    await recordMaintenanceLifecycle(db, updatedIssue, "stale_escalated", {
      summary: `Maintenance issue escalated for SLA breach: ${issue.title}`,
      outcome: "failure",
      details: {
        staleSince: maintenanceProgressTimestamp(updatedIssue),
        severity: updatedIssue.severity,
        dispatchStatus: updatedIssue.dispatchStatus
      }
    });
  }
  return { escalated: issues.length };
}

export function issueKeyForFingerprint(fingerprint) {
  return createHash("sha256").update(fingerprint).digest("hex");
}

export { mapIssueRow };
