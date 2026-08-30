import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname);

const app = express();
const port = Number(process.env.PORT || 3000);
app.enable("strict routing");
const blockedPathPrefixes = [
  ".git",
  ".github",
  "netlify",
  "db",
  "scripts",
  "deploy",
  "docs",
  "ops",
  "github",
];
const blockedFilenames = new Set([
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "docker-compose.yml",
  ".dockerignore",
  ".gitignore",
  "netlify.toml",
]);
const allowedExtensions = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".webmanifest",
  ".txt",
  ".map",
  ".ico",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".wav",
  ".mp4",
  ".webm",
]);

function resolveFromRoot(relativePath) {
  return path.join(root, relativePath);
}

function fileExists(relativePath) {
  return fs.existsSync(resolveFromRoot(relativePath));
}

function sendFileIfPresent(res, relativePath) {
  const absolutePath = resolveFromRoot(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send(`${relativePath} not found`);
  }
  return res.sendFile(absolutePath);
}

function isBlockedPath(relativePath) {
  if (!relativePath) return true;
  if (blockedFilenames.has(relativePath)) return true;
  if (relativePath.split("/").some((segment) => segment.startsWith("."))) return true;
  return blockedPathPrefixes.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`)
  );
}

function safeResolve(relativePath) {
  const normalized = relativePath.replace(/^\/+/, "");
  if (isBlockedPath(normalized)) return null;

  const absolutePath = path.resolve(root, normalized);
  if (!absolutePath.startsWith(root + path.sep)) return null;

  return absolutePath;
}

function sendStaticCandidate(res, relativePath) {
  const absolutePath = safeResolve(relativePath);
  if (!absolutePath) return false;
  if (!fs.existsSync(absolutePath)) return false;
  if (!fs.statSync(absolutePath).isFile()) return false;
  res.sendFile(absolutePath);
  return true;
}

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "halo-world-global-platform",
    branch: process.env.GIT_BRANCH || process.env.BRANCH || null,
    commit: process.env.GIT_COMMIT || process.env.COMMIT_SHA || null,
    nodeEnv: process.env.NODE_ENV || "development",
    files: {
      home: fileExists("halo.html"),
      private: fileExists("index.html"),
      albumConcierge: fileExists(path.join("album-concierge", "index.html")),
    },
  });
});

app.get("/", (_req, res) => {
  return sendFileIfPresent(res, "halo.html");
});

app.get("/private", (_req, res) => {
  return sendFileIfPresent(res, "index.html");
});

app.get("/album-concierge", (_req, res) => {
  return res.redirect(301, "/album-concierge/");
});

app.get("/album-concierge/", (_req, res) =>
  sendFileIfPresent(res, path.join("album-concierge", "index.html"))
);

app.get("*", (req, res, next) => {
  const routePath = decodeURIComponent(req.path);
  const relativePath = routePath.replace(/^\/+/, "");
  if (!relativePath) return next();

  const extension = path.extname(relativePath).toLowerCase();
  if (extension && allowedExtensions.has(extension)) {
    if (sendStaticCandidate(res, relativePath)) return;
    return next();
  }

  if (routePath.endsWith("/") && sendStaticCandidate(res, path.join(relativePath, "index.html"))) {
    return;
  }

  if (!extension && sendStaticCandidate(res, `${relativePath}.html`)) {
    return;
  }

  return next();
});

app.use((_req, res) => {
  res.status(404).send("Not found");
});

app.listen(port, () => {
  console.log(`HALO static server listening on port ${port}`);
});
