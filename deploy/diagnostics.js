#!/usr/bin/env node
/**
 * HALO World — Deploy Diagnostics
 *
 * Verifies the self-hosted deployment is healthy end-to-end:
 *   1. HTTP /healthz endpoint responds with { status: "ok" }
 *   2. Database connection is live (runs SELECT 1)
 *   3. Blob storage bucket is reachable (HeadBucket)
 *
 * Usage:
 *   node deploy/diagnostics.js [base_url]
 *
 * Examples:
 *   node deploy/diagnostics.js                          # uses http://localhost:3000
 *   node deploy/diagnostics.js https://halo.example.com
 *
 * Exit code 0 = all checks pass; non-zero = one or more checks failed.
 */

import pg from "pg";
import {
  S3Client,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

const BASE_URL = process.argv[2] || "http://localhost:3000";
const BUCKET = process.env.BLOB_BUCKET || "halo-blobs";

const results = [];

function pass(name, detail) {
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  results.push({ name, ok: true });
}

function fail(name, err) {
  console.error(`❌ ${name} — ${err?.message ?? err}`);
  results.push({ name, ok: false });
}

// ---------------------------------------------------------------------------
// 1. Health endpoint
// ---------------------------------------------------------------------------
async function checkHttp() {
  const url = `${BASE_URL}/healthz`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body?.status !== "ok") throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
  return `${url} → ${res.status}`;
}

// ---------------------------------------------------------------------------
// 2. Database
// ---------------------------------------------------------------------------
async function checkDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString });
  await client.connect();
  const { rows } = await client.query("SELECT 1 AS ok");
  await client.end();
  if (rows[0]?.ok !== 1) throw new Error("Unexpected query result");
  return `SELECT 1 succeeded`;
}

// ---------------------------------------------------------------------------
// 3. Blob storage
// ---------------------------------------------------------------------------
async function checkBlobs() {
  if (!process.env.BLOB_ENDPOINT && !process.env.BLOB_ACCESS_KEY) {
    return "skipped (BLOB_ENDPOINT/BLOB_ACCESS_KEY not set)";
  }
  const client = new S3Client({
    endpoint: process.env.BLOB_ENDPOINT,
    region: process.env.BLOB_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.BLOB_ACCESS_KEY || "",
      secretAccessKey: process.env.BLOB_SECRET_KEY || "",
    },
    forcePathStyle: true,
  });
  await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  return `bucket "${BUCKET}" is reachable`;
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------
async function run() {
  console.log(`\nHALO World — Deploy Diagnostics`);
  console.log(`Target: ${BASE_URL}\n`);

  for (const [name, fn] of [
    ["HTTP /healthz", checkHttp],
    ["Database (SELECT 1)", checkDatabase],
    ["Blob storage (HeadBucket)", checkBlobs],
  ]) {
    try {
      const detail = await fn();
      pass(name, detail);
    } catch (err) {
      fail(name, err);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

  if (failed.length > 0) {
    console.error(`\nFailed checks: ${failed.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }
}

run();
