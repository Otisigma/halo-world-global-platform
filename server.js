/**
 * HALO World Global Platform — Self-Hosted Express Server
 *
 * Replaces Netlify's routing, headers, and serverless function dispatch.
 * Mirrors every redirect, rewrite, header rule, and API route from
 * the former netlify.toml.
 *
 * Environment variables:
 *   PORT           — HTTP port (default: 3000)
 *   DATABASE_URL   — PostgreSQL connection string
 *   BLOB_ENDPOINT  — S3-compatible endpoint URL
 *   BLOB_REGION    — S3 region
 *   BLOB_ACCESS_KEY
 *   BLOB_SECRET_KEY
 *   BLOB_BUCKET    — blob bucket name (default: halo-blobs)
 *   JWT_SECRET     — HMAC-SHA256 secret for Netlify Identity compat
 *   ALLOWED_ORIGIN — comma-separated allowed CORS origins (default: same-origin)
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ---------------------------------------------------------------------------
// Security headers (mirrors netlify.toml [[headers]])
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  res.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});

// Per-path header overrides
app.use((req, res, next) => {
  const p = req.path;

  if (p.startsWith("/private") || p === "/index.html") {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  } else if (p === "/halo.html" || p === "/") {
    res.set("Cache-Control", "no-cache, must-revalidate");
  } else if (p.startsWith("/api/")) {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
  } else if (p === "/halo-command.html" || p.startsWith("/control-center")) {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
  } else if (p === "/partner-trust.html") {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  } else if (p.startsWith("/artist-economy")) {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  } else if (p.startsWith("/youtube-studio")) {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  } else if (p.endsWith(".js")) {
    res.set("Cache-Control", "public, max-age=300, must-revalidate");
  } else if (p.endsWith(".css")) {
    res.set("Cache-Control", "public, max-age=300, must-revalidate");
  }
  next();
});

// ---------------------------------------------------------------------------
// Raw body capture (must be before JSON/URL body parsers)
// ---------------------------------------------------------------------------
app.use((req, _res, next) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    req.rawBody = chunks.length ? Buffer.concat(chunks) : undefined;
    next();
  });
  req.on("error", next);
});

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ---------------------------------------------------------------------------
// Health check endpoint
// ---------------------------------------------------------------------------
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Force rewrites (status 200, force: true — served before static files)
// ---------------------------------------------------------------------------
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-cache, must-revalidate").sendFile(path.join(ROOT, "halo.html"));
});

app.get("/signal", (_req, res) => {
  res.sendFile(path.join(ROOT, "halo.html"));
});

app.get("/private", (_req, res) => {
  res.set("Cache-Control", "private, no-store").sendFile(path.join(ROOT, "index.html"));
});

app.get("/private/", (_req, res) => {
  res.set("Cache-Control", "private, no-store").sendFile(path.join(ROOT, "index.html"));
});

app.get("/console", (_req, res) => {
  res.sendFile(path.join(ROOT, "halo-command.html"));
});

app.get("/control-center", (_req, res) => {
  res.sendFile(path.join(ROOT, "halo-command.html"));
});

app.get("/control-center/", (_req, res) => {
  res.sendFile(path.join(ROOT, "halo-command.html"));
});

// /artists/* SPA rewrite
app.get("/artists/*", (_req, res) => {
  res.sendFile(path.join(ROOT, "artists", "index.html"));
});

// ---------------------------------------------------------------------------
// 301 trailing-slash redirects
// ---------------------------------------------------------------------------
const trailingSlashRoutes = [
  "/creators",
  "/release-house",
  "/song-catalog",
  "/upload-pipeline",
  "/finish-house",
  "/campaign-studio",
  "/youtube-studio",
  "/dreamweaver",
  "/dreamweaver-lab",
  "/when-the-world-goes-dark",
  "/iam-social",
  "/artist-pro",
  "/artist-economy",
  "/support",
  "/artists",
];

for (const route of trailingSlashRoutes) {
  app.get(route, (req, res) => {
    res.redirect(301, route + "/");
  });
}

// Explicit redirect for /album-concierge (satisfies deploy contract)
app.get("/album-concierge", (_req, res) => {
  res.redirect(301, "/album-concierge/");
});

// ---------------------------------------------------------------------------
// API routes — adapts Netlify Function handlers to Express
//
// Each Netlify Function exports `default async function handler(request)`
// where `request` is a Web API Request object and the return value is a
// Web API Response. The adapter below wraps each handler transparently.
// ---------------------------------------------------------------------------

/**
 * Converts an Express req into a Web API Request object, then calls the
 * Netlify handler, and pipes the resulting Web API Response back to Express.
 */
async function netlifyAdapter(handler, req, res) {
  try {
    // Build a Web API Request from the Express request
    const protocol = req.protocol || "http";
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `${protocol}://${host}${req.originalUrl}`;

    // Reconstruct the raw body for the Request
    let bodyInit = undefined;
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        bodyInit = JSON.stringify(req.body);
      } else if (
        contentType.includes("multipart/form-data") ||
        contentType.includes("application/x-www-form-urlencoded")
      ) {
        // Pass raw body stream through; already parsed by express.
        // For file uploads via multipart, the raw body stream must be
        // forwarded intact — for this we use the rawBody Buffer attached
        // by the rawBodyMiddleware (see below).
        bodyInit = req.rawBody || undefined;
      } else {
        bodyInit = req.rawBody || undefined;
      }
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (value != null) {
        headers.set(key, value);
      }
    }

    const webRequest = new Request(url, {
      method,
      headers,
      body: bodyInit,
      // duplex required when body is provided
      ...(bodyInit !== undefined ? { duplex: "half" } : {}),
    });

    const webResponse = await handler(webRequest);

    if (!(webResponse instanceof Response)) {
      res.status(500).json({ error: "Handler returned invalid response" });
      return;
    }

    res.status(webResponse.status);

    for (const [key, value] of webResponse.headers.entries()) {
      res.set(key, value);
    }

    const body = await webResponse.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err) {
    // Log with separate args to avoid format-string injection from user-controlled path
    const safePath = String(req.path).replace(/[\r\n\t]/g, " ").slice(0, 200);
    console.error("[api]", safePath, "error:", err?.message ?? err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

// Remove the old raw body middleware that was placed after body parsers
// (moved above — see "Raw body capture" section)

/**
 * Register all API routes from netlify/functions/.
 * Routes with `schedule` configs are registered as callable HTTP endpoints
 * at /api/scheduled/<name> so they can be triggered by an external cron
 * (e.g. GitHub Actions, Kubernetes CronJob).
 */
async function registerApiRoutes() {
  // HTTP routes (path-mapped functions)
  const httpRoutes = [
    { file: "ai-dj",                   path: "/api/ai-dj" },
    { file: "album-concierge",         path: "/api/album-concierge" },
    { file: "ambassadors",             path: "/api/ambassadors" },
    { file: "artist-agents",           path: "/api/artist-agents" },
    { file: "artist-connections",      path: "/api/artist/connections" },
    { file: "artist-economy",          path: "/api/artist-economy" },
    { file: "artist-page-scout",       path: "/api/artist-page-scout" },
    { file: "artist-pages",            path: "/api/artist-pages" },
    { file: "artist-pro",              path: "/api/artist-pro" },
    { file: "broadcast-control",       path: "/api/broadcast-control" },
    { file: "community",               path: "/api/community" },
    { file: "creator-charter",         path: "/api/creator-charter" },
    { file: "creator-marketplace",     path: "/api/creator-marketplace" },
    { file: "dj-intelligence",         path: "/api/dj-intelligence" },
    { file: "dreamweaver-campaigns",   path: "/api/dreamweaver-campaigns" },
    { file: "dreamweaver-song-lab",    path: "/api/dreamweaver-song-lab" },
    { file: "fan-campaigns",           path: "/api/fan-campaigns" },
    { file: "finish-house",            path: "/api/finish-house" },
    { file: "gemma-radio-operator",    path: "/api/radio/gemma" },
    { file: "halo-agent-team",         path: "/api/halo-agent-team" },
    { file: "halo-companion",          path: "/api/halo-companion" },
    { file: "halo-control-center",     path: "/api/halo-control-center" },
    { file: "halo-journal",            path: "/api/halo-journal" },
    { file: "halo-ledger",             path: "/api/halo-ledger" },
    { file: "halo-relations",          path: "/api/halo-relations" },
    { file: "halo-session",            path: "/api/halo-session" },
    { file: "halo-x",                  path: "/api/halo-x" },
    { file: "iam-social",              path: "/api/iam-social" },
    { file: "issues",                  path: "/api/issues" },
    { file: "maintenance-issues",      path: "/api/maintenance-issues" },
    { file: "mix-audio",               path: "/api/mixes/audio" },
    { file: "mix-flightplan",          path: "/api/mix-flightplan" },
    { file: "mix-reviews",             path: "/api/mix-reviews" },
    { file: "mixes",                   path: "/api/mixes" },
    { file: "outreach-desk",           path: "/api/outreach-desk" },
    { file: "partner-trust",           path: "/api/partner-trust" },
    { file: "payment-link",            path: "/api/payment-link" },
    { file: "radio-artwork",           path: "/api/radio/artwork" },
    { file: "radio-audience",          path: "/api/radio/audience" },
    { file: "radio-audio",             path: "/api/radio/audio" },
    { file: "radio-health",            path: "/api/radio/health" },
    { file: "radio-manager-council",   path: "/api/radio/manager-council" },
    { file: "radio-operator",          path: "/api/radio/operator" },
    { file: "radio-personas",          path: "/api/radio/personas" },
    { file: "radio-schedule",          path: "/api/radio/schedule" },
    { file: "radio-stations",          path: "/api/radio/stations" },
    { file: "radio-submissions",       path: "/api/radio/submissions" },
    { file: "relationship-event",      path: "/api/relationship-event" },
    { file: "release-catalog",         path: "/api/release-catalog" },
    { file: "release-house",           path: "/api/release-house" },
    { file: "release-link",            path: "/api/release-link" },
    { file: "release-pack",            path: "/api/release-pack" },
    { file: "resolve-track",           path: "/api/resolve-track" },
    { file: "set-preflight",           path: "/api/set-preflight" },
    { file: "share-invite",            path: "/api/share-invite" },
    { file: "signal-network",          path: "/api/signal-network" },
    { file: "song-catalog-artwork",    path: "/api/song-catalog/artwork" },
    { file: "song-catalog-audio",      path: "/api/song-catalog/audio" },
    { file: "song-catalog-producer",   path: "/api/song-catalog/producer" },
    { file: "song-catalog",            path: "/api/song-catalog" },
    { file: "stats-event",             path: "/api/stats/events" },
    { file: "stats-summary",           path: "/api/stats/summary" },
    { file: "stem-collector",          path: "/api/stem-collector" },
    { file: "stem-vault-audio",        path: "/api/stem-vault/audio" },
    { file: "stem-vault",              path: "/api/stem-vault" },
    { file: "support-feedback",        path: "/api/support-feedback" },
    { file: "telemetry",               path: "/api/telemetry" },
    { file: "unified-upload",          path: "/api/unified-upload" },
    { file: "upload-notifications",    path: "/api/upload-notifications" },
    { file: "upload-pipeline",         path: "/api/upload-pipeline" },
    { file: "videos",                  path: "/api/videos" },
    { file: "visual-mixes",            path: "/api/visual-mixes" },
    { file: "world-dark-pulse",        path: "/api/when-the-world-goes-dark/pulse" },
    { file: "youtube-source-studio",   path: "/api/youtube-source-studio" },
  ];

  // Scheduled functions — exposed as HTTP endpoints for external cron triggers
  const scheduledRoutes = [
    { file: "artist-agent-weekly",        schedule: "15 8 * * 1" },
    { file: "dreamweaver-campaign-monitor", schedule: "30 7 * * *" },
    { file: "halo-agent-daily",           schedule: "30 7 * * *" },
    { file: "halo-daily-report",          schedule: "0 8 * * *" },
    { file: "health-scout",               schedule: "*/15 * * * *" },
    { file: "music-catalog-scout",        schedule: "0 * * * *" },
    { file: "outreach-weekly",            schedule: "40 9 * * 2" },
    { file: "radio-health-scout",         schedule: "*/5 * * * *" },
    { file: "radio-operator-daily",       schedule: "0 5 * * *" },
    { file: "radio-persona-planner",      schedule: "0 4 * * 1" },
  ];

  const errors = [];

  for (const route of httpRoutes) {
    try {
      const mod = await import(`./netlify/functions/${route.file}.mjs`).catch(
        () => import(`./netlify/functions/${route.file}.ts`)
      ).catch(() => null);

      if (!mod?.default) {
        console.warn(`[server] No default export in netlify/functions/${route.file} — skipping`);
        continue;
      }

      const handler = mod.default;
      app.all(route.path, (req, res) => netlifyAdapter(handler, req, res));
      console.log(`[server] Registered ${route.path}`);
    } catch (err) {
      errors.push(`${route.file}: ${err.message}`);
    }
  }

  for (const route of scheduledRoutes) {
    try {
      const mod = await import(`./netlify/functions/${route.file}.mjs`).catch(() => null);
      if (!mod?.default) continue;

      const handler = mod.default;
      const httpPath = `/api/scheduled/${route.file}`;
      app.post(httpPath, (req, res) => netlifyAdapter(handler, req, res));
      console.log(`[server] Registered scheduled ${httpPath} (cron: ${route.schedule})`);
    } catch (err) {
      errors.push(`${route.file} (scheduled): ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[server] ${errors.length} function(s) failed to load:`, errors);
  }
}

// ---------------------------------------------------------------------------
// Block sensitive server-side directories from static file access
// ---------------------------------------------------------------------------
const BLOCKED_PREFIXES = [
  "/netlify/",
  "/scripts/",
  "/db/",
  "/deploy/",
  "/.github/",
  "/node_modules/",
];

app.use((req, res, next) => {
  const p = req.path;
  for (const prefix of BLOCKED_PREFIXES) {
    if (p === prefix.slice(0, -1) || p.startsWith(prefix)) {
      return res.status(404).end();
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Static files (serve repo root)
// ---------------------------------------------------------------------------
app.use(express.static(ROOT, {
  // Don't serve index.html automatically — we handle / explicitly above
  index: false,
  // Cache JS/CSS for 5 minutes
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.set("Cache-Control", "public, max-age=300, must-revalidate");
    }
  },
}));

// ---------------------------------------------------------------------------
// SPA fallback (mirrors the catch-all `/* → /index.html, force: false`)
// Must be registered AFTER static files and API routes.
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.set("Cache-Control", "private, no-store").sendFile(path.join(ROOT, "index.html"));
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function start() {
  await registerApiRoutes();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] HALO World running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});

export default app;
