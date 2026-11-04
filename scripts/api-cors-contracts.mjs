import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import express from "express";
import { createApiCors } from "../deploy/api-cors.js";

assert.throws(() => createApiCors("*"));
assert.throws(() => createApiCors("https://example.com/path"));
assert.throws(() => createApiCors("https://example.com/"));
const app = express();
app.use(createApiCors("https://extra.example"));
app.all("/api/test", (_req, res) => res.status(401).json({ message: "Authentication required" }));
app.all("/api/drive-catalog/audio", (_req, res) => res.set("Access-Control-Allow-Origin", "*").status(206).end());
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000",
    "https://halomusicworld.com", "https://admin.halomusicworld.com",
    "https://halo-world-global-platform.netlify.app", "https://extra.example"]) {
    const response = await fetch(`${base}/api/test`, {
      method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type,authorization" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.match(response.headers.get("vary"), /Origin/);
    assert.match(response.headers.get("access-control-allow-methods"), /PUT/);
    assert.match(response.headers.get("access-control-allow-headers"), /Authorization/);
  }
  for (const origin of ["null", "https://evil.example", "https://halomusicworld.com.evil.example"]) {
    const response = await fetch(`${base}/api/test`, { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  const anonymous = await fetch(`${base}/api/test`);
  assert.equal(anonymous.status, 401, "no Origin must not bypass authentication");
  assert.equal(anonymous.headers.get("access-control-allow-origin"), null);
  const denied = await fetch(`${base}/api/test`, { headers: { Origin: "https://halomusicworld.com" } });
  assert.equal(denied.status, 401, "allowed CORS must not bypass authentication");
  assert.equal(denied.headers.get("access-control-allow-origin"), "https://halomusicworld.com");
  const audio = await fetch(`${base}/api/drive-catalog/audio`, { headers: { Origin: "https://external.example" } });
  assert.equal(audio.status, 206);
  assert.equal(audio.headers.get("access-control-allow-origin"), "*");
  assert.equal(audio.headers.get("access-control-allow-credentials"), null);
  console.log("API CORS contracts passed: exact origins, preflight, credentials, auth preservation and audio isolation.");
} finally {
  server.close();
  await once(server, "close");
}

const child = spawn(process.execPath, ["server.js"], {
  cwd: new URL("../", import.meta.url),
  env: { ...process.env, PORT: "0", DRIVE_CATALOG_FOLDER_ID: "", DRIVE_CATALOG_INDEX_FILE_ID: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let diagnostics = "";
child.stderr.on("data", chunk => { diagnostics += chunk; });
try {
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${diagnostics}`)), 15000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${diagnostics}`)); });
    child.stdout.on("data", chunk => {
      output += chunk;
      const match = /listening on port (\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const origin = "https://halomusicworld.com";
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  for (const [path, method, status] of [
    ["/api/drive-catalog", "OPTIONS", 204],
    ["/api/drive-catalog", "GET", 200],
    ["/api/missing", "PUT", 404],
  ]) {
    const response = await fetch(`${base}${path}`, { method, headers: { Origin: origin } });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("access-control-allow-origin"), origin,
      "bridged function headers must not overwrite exact credentialed origin");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  }
  assert.equal((await fetch(`${base}/api/drive-catalog`, { headers: { Origin: "https://evil.example" } })).status, 403);
  const audio = await fetch(`${base}/api/drive-catalog/audio`, { method: "OPTIONS", headers: { Origin: "https://external.example" } });
  assert.equal(audio.status, 204);
  assert.equal(audio.headers.get("access-control-allow-origin"), "*");
  assert.equal(audio.headers.get("access-control-allow-credentials"), null);
  console.log("Actual Express bridge CORS contracts passed, including wildcard override prevention.");
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
}
