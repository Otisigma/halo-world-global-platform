import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(join(root, ".github/workflows/ai-autodeploy.yml"), "utf8");
const ci = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
const ignore = await readFile(join(root, ".dockerignore"), "utf8");
const step = name => {
  const source = workflow.split(`      - name: ${name}\n`)[1]?.split("\n      - name: ")[0];
  assert.ok(source, `Missing workflow step: ${name}`);
  return source;
};
const script = name => {
  const run = step(name).split("        run: |\n")[1];
  assert.ok(run, `Missing shell script: ${name}`);
  return run.replace(/^          /gm, "");
};

assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /contents: write|git push|persist-credentials: true/);
assert.match(step("Trigger Netlify build hook"), /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && env\.NETLIFY_BUILD_HOOK != ''/);
assert.match(step("Skip Netlify hook when not configured"), /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && env\.NETLIFY_BUILD_HOOK == ''/);
assert.match(step("Report deployment status"), /if: \$\{\{ always\(\) \}\}/);

// Execute the actual hook step with a fake curl; no network or production credentials.
const dir = await mkdtemp(join(tmpdir(), "halo-deploy-contracts-"));
try {
  await writeFile(join(dir, "curl"), `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
printf '%s' "$MOCK_HTTP_STATUS"
exit "$MOCK_CURL_STATUS"
`, { mode: 0o700 });
  const hook = "https://api.netlify.com/build_hooks/offline-contract-only";
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    NETLIFY_BUILD_HOOK: hook,
    CURL_ARGS: join(dir, "curl-args"),
  };
  for (const [http, curl, succeeds] of [
    ["200", "0", true], ["202", "0", true], ["204", "0", true],
    ["302", "0", false], ["400", "22", false], ["500", "22", false],
    ["000", "28", false], ["000", "6", false],
  ]) {
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script("Trigger Netlify build hook")], {
      env: { ...env, MOCK_HTTP_STATUS: http, MOCK_CURL_STATUS: curl }, encoding: "utf8",
    });
    assert.equal(result.status === 0, succeeds, `HTTP ${http}, curl ${curl}: ${result.stderr}`);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(hook), "Never log the hook URL");
    assert.match(result.stdout, succeeds ? /remain unverified/ : /No production release is verified/);
  }
  const args = (await readFile(env.CURL_ARGS, "utf8")).trim().split("\n");
  for (const [option, value] of [
    ["--connect-timeout", "10"], ["--max-time", "30"], ["--proto", "=https"],
    ["--output", "/dev/null"], ["--request", "POST"],
  ]) assert.equal(args[args.indexOf(option) + 1], value);
  assert.ok(!args.some(arg => ["-L", "--location", "--retry", "--verbose", "--show-error"].includes(arg)),
    "Do not follow redirects, retry POSTs, or print secret-bearing diagnostics");

  for (const [event, ref, configured, outcome, expected] of [
    ["pull_request", "refs/pull/467/merge", true, "skipped", /Not requested: only pushes/],
    ["workflow_dispatch", "refs/heads/main", true, "skipped", /Not requested: only pushes/],
    ["push", "refs/heads/other", true, "skipped", /Not requested: only pushes/],
    ["push", "refs/heads/main", false, "skipped", /Skipped: NETLIFY_BUILD_HOOK is not configured/],
    ["push", "refs/heads/main", true, "success", /Requested: Netlify accepted.*not a completed or verified production release/],
    ["push", "refs/heads/main", true, "failure", /Failed: Netlify hook request failed/],
    ["push", "refs/heads/main", true, "skipped", /Not requested: the hook step did not run/],
  ]) {
    const summaryPath = join(dir, "summary");
    await writeFile(summaryPath, "");
    const result = spawnSync("bash", ["-e", "-c", script("Report deployment status")], {
      env: { ...env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: "offline-sha",
        GITHUB_STEP_SUMMARY: summaryPath, NETLIFY_BUILD_HOOK: configured ? hook : "",
        HOOK_OUTCOME: outcome }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = await readFile(summaryPath, "utf8");
    assert.match(summary, expected);
    assert.match(summary, /migration state must be verified separately/);
    assert.match(summary, /Telemetry is a CI artifact only/);
    assert.ok(!summary.includes(hook), "Never put the hook URL in summaries");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

for (const file of [
  "functions/drive-catalog.mjs", "functions/drive-catalog-audio.mjs",
  "lib/drive-catalog.mjs", "lib/google-drive.mjs", "lib/direct-upload-storage.mjs",
  "lib/master-copy.mjs", "lib/resilience.mjs",
]) assert.ok(ignore.includes(`!netlify/${file}\n`), `Docker must include ${file}`);
assert.match(ignore, /^netlify\/functions\/\*$/m, "Keep other functions excluded");
assert.match(ignore, /^\.env$/m, "Keep local secrets out of the image");
assert.match(ci, /timeout 30 bash -ec/);
assert.match(ci, /--max-time 2 -sf http:\/\/127\.0\.0\.1:3000\/healthz/);
assert.match(ci, /grep '"status":"ok"'/, "Preserve the application health assertion");
assert.match(ci, /docker inspect --format "{{\.State\.Running}}"/, "Fail promptly on container crashes");
assert.doesNotMatch(ci, /docker run --rm/, "Keep crashed containers for diagnostics");
assert.match(ci, /name: Show container failure diagnostics\n\s+if: \$\{\{ failure\(\) \}\}/);
assert.match(ci, /docker logs --tail 100 halo-ci/);
assert.match(ci, /name: Clean up smoke-test container\n\s+if: \$\{\{ always\(\) \}\}/);
assert.match(ci, /docker rm -f halo-ci/);
console.log("Deployment workflow contracts passed (offline hook and summary cases, Docker health safeguards).");
