import { randomUUID } from "node:crypto";
import { issueKeyForFingerprint, reportIssue, resolveIssue } from "./maintenance.mjs";
import { appendLedgerEntry } from "./halo-ledger.mjs";

const CORE_PAGES = [
  "/", "/magazine.html", "/dj-deck.html", "/vip_launchpad.html", "/halo-live.html",
  "/halo-x.html", "/halo-relations.html", "/halo-command.html", "/creators/",
  "/creators/gear-guide.html", "/music/", "/radio/", "/dreamweaver/", "/dreamweaver-lab/",
  "/campaign-studio/", "/release-house/", "/finish-house/", "/artists/", "/mixes/"
];

const SATELLITE_STATUS_TARGETS = [
  { name: "Dreamweaver", route: "/dreamweaver/" },
  { name: "Dreamweaver Lab", route: "/dreamweaver-lab/" },
  { name: "Campaign Studio", route: "/campaign-studio/" },
  { name: "Finish House", route: "/finish-house/" },
  { name: "Release House", route: "/release-house/" },
  { name: "Artist Pro", route: "/artist-pro/" },
  { name: "Artists", route: "/artists/" },
  { name: "Music", route: "/music/" },
  { name: "Radio", route: "/radio/" },
  { name: "Mixes", route: "/mixes/" },
  { name: "Song Catalog", route: "/song-catalog/" },
  { name: "Album Concierge", route: "/album-concierge/" }
];

const API_ROUTES = [
  "/api/ai-dj", "/api/ambassadors", "/api/broadcast-control", "/api/community",
  "/api/creator-marketplace", "/api/dj-intelligence", "/api/halo-agent-team",
  "/api/halo-companion", "/api/halo-journal", "/api/halo-relations", "/api/halo-session",
  "/api/halo-x", "/api/issues", "/api/maintenance/issues", "/api/mixes", "/api/mixes/audio",
  "/api/payment-link", "/api/radio/audio", "/api/radio/health", "/api/radio/personas",
  "/api/radio/stations", "/api/radio/submissions", "/api/relationship-event", "/api/release-catalog",
  "/api/release-link", "/api/release-pack", "/api/resolve-track", "/api/stats/events",
  "/api/stats/summary", "/api/telemetry"
];

const OUTPUT_CHECKS = [
  {
    name: "Telemetry API output",
    path: "/api/telemetry",
    method: "POST",
    body: { deckA: { bpm: 120 }, deckB: { bpm: 120 }, crowd: { score: 50 } },
    accept: (response, body) => response.ok && body.includes('"status":"SUCCESS"')
  },
  { name: "AI DJ method contract", path: "/api/ai-dj", accept: response => response.status === 405 },
  { name: "HALO Companion method contract", path: "/api/halo-companion", accept: response => response.status === 405 },
  {
    name: "Maintenance scout asset output",
    path: "/site-monitor.js",
    accept: (response, body) => response.ok && body.includes("HALO Maintenance Scout")
  },
  ...API_ROUTES.map(path => ({
    name: `${path} route output`,
    path,
    method: "OPTIONS",
    accept: response => response.status !== 404 && response.status < 500
  }))
];

function cleanDetail(value, maximum = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function sameOriginTarget(baseUrl, rawTarget) {
  if (!rawTarget || rawTarget.includes("${") || rawTarget.includes("{{") || /^(#|mailto:|tel:|data:|javascript:)/i.test(rawTarget)) return null;
  try {
    const target = new URL(rawTarget, baseUrl);
    if (target.origin !== new URL(baseUrl).origin) return null;
    target.hash = "";
    return target;
  } catch {
    return null;
  }
}

function extractConnections(baseUrl, html) {
  const connections = new Map();
  for (const match of html.matchAll(/(?:^|\s)(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
    const target = sameOriginTarget(baseUrl, match[1]);
    if (target) connections.set(target.href, target);
  }
  return [...connections.values()];
}

function isHtml(response, body) {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/html") || /<!doctype html|<html[\s>]/i.test(body);
}

function normalizeRoute(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

async function requestTarget(url, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(8_000)
    });
    const body = await response.text();
    return { response, body, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      response: null,
      body: "",
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : "Request failed"
    };
  }
}

function checkRecord(kind, target, request, passed, detail) {
  return {
    kind,
    target,
    status: passed ? "passed" : "failed",
    httpStatus: request.response?.status || null,
    durationMs: request.durationMs,
    detail: cleanDetail(detail)
  };
}

async function persistCheck(db, sweepId, check) {
  await db.sql`
    INSERT INTO halo_maintenance_checks (
      sweep_id, check_kind, target, status, http_status, duration_ms, detail
    ) VALUES (
      ${sweepId}, ${check.kind}, ${check.target}, ${check.status},
      ${check.httpStatus}, ${check.durationMs}, ${check.detail}
    )
  `;
}

async function reconcileIssue(check) {
  const fingerprint = `maintenance-sweep:${check.kind}:${check.target}`;
  const issueKey = issueKeyForFingerprint(fingerprint);
  if (check.status === "passed") {
    await resolveIssue(issueKey, `${check.target} passed the recurring maintenance sweep.`);
    return;
  }
  await reportIssue({
    source: "scheduled",
    category: check.kind === "output" ? "api" : "availability",
    severity: check.kind === "page" ? "high" : "medium",
    title: `${check.kind} check failed: ${check.target}`,
    details: check.detail || "The recurring maintenance sweep did not observe the expected output.",
    pagePath: check.target,
    fingerprint,
    metadata: { httpStatus: check.httpStatus, durationMs: check.durationMs, checkKind: check.kind }
  });
}

export async function runMaintenanceSweep(db, baseUrl, { triggerType = "scheduled" } = {}) {
  const rootUrl = new URL(baseUrl);
  const sweepId = randomUUID();
  await db.sql`
    INSERT INTO halo_maintenance_sweeps (id, trigger_type, base_url)
    VALUES (${sweepId}, ${triggerType}, ${rootUrl.origin})
  `;

  const checks = [];
  const queuedPages = new Map(CORE_PAGES.map(path => {
    const url = new URL(path, rootUrl);
    return [url.href, url];
  }));
  const checkedConnections = new Set();
  let pagesChecked = 0;
  let connectionsChecked = 0;
  const pageStatusByRoute = new Map();
  const connectedRoutesFromMainMenu = new Set();

  for (const pageUrl of queuedPages.values()) {
    if (pagesChecked >= 80) break;
    const request = await requestTarget(pageUrl);
    const passed = Boolean(request.response?.ok && isHtml(request.response, request.body));
    const pageCheck = checkRecord(
      "page",
      `${pageUrl.pathname}${pageUrl.search}`,
      request,
      passed,
      passed ? "HTML document loaded with the expected structure." : request.error || `Unexpected page response ${request.response?.status || "unavailable"}.`
    );
    checks.push(pageCheck);
    await persistCheck(db, sweepId, pageCheck);
    pageStatusByRoute.set(normalizeRoute(pageUrl.pathname), passed);
    pagesChecked += 1;
    if (!passed) continue;

    for (const connectionUrl of extractConnections(pageUrl, request.body)) {
      if (checkedConnections.has(connectionUrl.href) || connectionsChecked >= 160) continue;
      checkedConnections.add(connectionUrl.href);
      const connectionRequest = await requestTarget(connectionUrl);
      const connectionPassed = Boolean(connectionRequest.response?.ok);
      const connectionCheck = checkRecord(
        "connection",
        `${connectionUrl.pathname}${connectionUrl.search}`,
        connectionRequest,
        connectionPassed,
        connectionPassed ? "Internal connection resolved successfully." : connectionRequest.error || `Connection returned HTTP ${connectionRequest.response?.status || "unavailable"}.`
      );
      checks.push(connectionCheck);
      await persistCheck(db, sweepId, connectionCheck);
      connectionsChecked += 1;
      if (normalizeRoute(pageUrl.pathname) === "/") {
        connectedRoutesFromMainMenu.add(normalizeRoute(connectionUrl.pathname));
      }
      if (connectionPassed && isHtml(connectionRequest.response, connectionRequest.body) && !queuedPages.has(connectionUrl.href)) {
        queuedPages.set(connectionUrl.href, connectionUrl);
      }
    }
  }

  const satelliteStatuses = SATELLITE_STATUS_TARGETS.map(target => {
    const route = normalizeRoute(target.route);
    const built = pageStatusByRoute.has(route);
    const live = pageStatusByRoute.get(route) === true;
    const connected = connectedRoutesFromMainMenu.has(route);
    const verified = built && live && connected;
    const status = verified ? "green" : built && live ? "yellow" : "red";
    return { name: target.name, route, built, live, connected, verified, status };
  });

  for (const status of satelliteStatuses) {
    if (!status.connected) {
      const connectedCheck = checkRecord(
        "connection",
        status.route,
        { response: null, durationMs: 0 },
        false,
        `${status.name} is not linked from the main menu route.`
      );
      checks.push(connectedCheck);
      await persistCheck(db, sweepId, connectedCheck);
      connectionsChecked += 1;
    }
    const verifiedCheck = checkRecord(
      "output",
      `${status.route}#verified`,
      { response: null, durationMs: 0 },
      status.verified,
      status.verified
        ? `${status.name} is built, live, connected, and verified.`
        : `${status.name} failed one or more satellite checks (built/live/connected/verified).`
    );
    checks.push(verifiedCheck);
    await persistCheck(db, sweepId, verifiedCheck);
  }

  for (const output of OUTPUT_CHECKS) {
    const targetUrl = new URL(output.path, rootUrl);
    const request = await requestTarget(targetUrl, output);
    const passed = Boolean(request.response && output.accept(request.response, request.body));
    const outputCheck = checkRecord(
      "output",
      output.path,
      request,
      passed,
      passed ? `${output.name} matched its expected contract.` : request.error || `${output.name} returned an unexpected output.`
    );
    checks.push(outputCheck);
    await persistCheck(db, sweepId, outputCheck);
  }

  const failedChecks = checks.filter(check => check.status === "failed");
  const passedChecks = checks.length - failedChecks.length;
  const status = failedChecks.some(check => check.kind === "page") ? "failed" : failedChecks.length ? "degraded" : "passed";
  await db.sql`
    UPDATE halo_maintenance_sweeps SET
      status = ${status},
      pages_checked = ${pagesChecked},
      connections_checked = ${connectionsChecked},
      outputs_checked = ${OUTPUT_CHECKS.length + SATELLITE_STATUS_TARGETS.length},
      passed_checks = ${passedChecks},
      failed_checks = ${failedChecks.length},
      completed_at = NOW()
    WHERE id = ${sweepId}
  `;

  await appendLedgerEntry(db, {
    actorId: "system",
    actorType: "system",
    eventCategory: "system_event",
    summary: `Live-connected satellite status command completed (${status})`,
    details: {
      command: "run_live_connected_satellite_status",
      triggerType,
      baseUrl: rootUrl.origin,
      pagesChecked,
      connectionsChecked,
      outputsChecked: OUTPUT_CHECKS.length + SATELLITE_STATUS_TARGETS.length,
      passedChecks,
      failedChecks: failedChecks.length,
      satelliteStatuses
    },
    body: `${failedChecks.length} failed checks across live-connected satellite status workflow.`,
    outcome: status === "passed" ? "success" : "failure"
  });

  await Promise.allSettled(checks.map(reconcileIssue));
  return {
    id: sweepId,
    status,
    pagesChecked,
    connectionsChecked,
    outputsChecked: OUTPUT_CHECKS.length + SATELLITE_STATUS_TARGETS.length,
    passedChecks,
    failedChecks: failedChecks.length,
    satelliteStatuses
  };
}

function serializeSweep(row) {
  return {
    id: row.id,
    status: row.status,
    triggerType: row.trigger_type,
    pagesChecked: Number(row.pages_checked || 0),
    connectionsChecked: Number(row.connections_checked || 0),
    outputsChecked: Number(row.outputs_checked || 0),
    passedChecks: Number(row.passed_checks || 0),
    failedChecks: Number(row.failed_checks || 0),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  };
}

export async function loadMaintenanceSweeps(db) {
  const [sweeps, checks] = await Promise.all([
    db.sql`SELECT * FROM halo_maintenance_sweeps ORDER BY started_at DESC LIMIT 12`,
    db.sql`
      SELECT * FROM halo_maintenance_checks
      WHERE sweep_id = (SELECT id FROM halo_maintenance_sweeps ORDER BY started_at DESC LIMIT 1)
      ORDER BY CASE status WHEN 'failed' THEN 1 ELSE 2 END, check_kind, target
      LIMIT 200
    `
  ]);
  return {
    latest: sweeps[0] ? serializeSweep(sweeps[0]) : null,
    history: sweeps.map(serializeSweep),
    checks: checks.map(row => ({
      kind: row.check_kind,
      target: row.target,
      status: row.status,
      httpStatus: row.http_status == null ? null : Number(row.http_status),
      durationMs: Number(row.duration_ms || 0),
      detail: row.detail
    }))
  };
}
