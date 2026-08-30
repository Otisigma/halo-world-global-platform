import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;

const app = express();
const port = Number(process.env.PORT || 3000);

function resolve(relativePath) {
  return path.join(root, relativePath);
}

function fileExists(relativePath) {
  return fs.existsSync(resolve(relativePath));
}

function sendFileIfPresent(res, relativePath) {
  const absolutePath = resolve(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send(`${relativePath} not found`);
  }
  return res.sendFile(absolutePath);
}

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(
  express.static(root, {
    index: false,
    extensions: ["html"],
    redirect: false,
  })
);

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

app.get("/", (_req, res) => sendFileIfPresent(res, "halo.html"));
app.get("/private", (_req, res) => sendFileIfPresent(res, "index.html"));
app.get("/album-concierge/", (_req, res) =>
  sendFileIfPresent(res, path.join("album-concierge", "index.html"))
);

app.use((_req, res) => {
  res.status(404).send("Not found");
});

app.listen(port, () => {
  console.log(`HALO static server listening on port ${port}`);
});
