/**
 * @netlify/identity compat shim
 *
 * Replaces Netlify Identity with JWT-based authentication.
 *
 * Required env vars:
 *   JWT_SECRET — shared HMAC-SHA256 secret for signing/verifying tokens
 *
 * The shim surfaces the same minimal API used across all Netlify Functions:
 *   const user = await getUser(request)  → { id, email, roles, metadata } | null
 *   verifyRequestOrigin(request)         → true (no-op; handled by CORS middleware)
 *
 * Token format: standard ****** in the Authorization header, or
 * `nf_jwt` cookie (same as Netlify Identity uses for browser sessions).
 *
 * To issue tokens (e.g. login endpoint), import issueToken from this module.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from((str + pad).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(header, payload, secret) {
  const data = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${base64urlEncode(sig)}`;
}

function verify(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(data).digest();
  const actual = base64urlDecode(parts[2]);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(parts[1]).toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractToken(request) {
  // Authorization: ******
  const auth = request.headers?.get?.("authorization") || request.headers?.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();

  // Cookie: nf_jwt=<token>
  const cookie = request.headers?.get?.("cookie") || request.headers?.cookie || "";
  const match = cookie.match(/(?:^|;\s*)nf_jwt=([^;]+)/);
  if (match) return decodeURIComponent(match[1]).trim();

  return null;
}

/**
 * Get the authenticated user from the request.
 * Returns null if unauthenticated or token is invalid/expired.
 */
export async function getUser(request) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn("[identity] JWT_SECRET not set — all requests will be unauthenticated");
    return null;
  }
  const token = extractToken(request);
  if (!token) return null;
  const payload = verify(token, secret);
  if (!payload) return null;
  return {
    id: payload.sub || payload.id,
    email: payload.email,
    roles: Array.isArray(payload.roles) ? payload.roles : (payload.app_metadata?.roles ?? []),
    metadata: payload.user_metadata || {},
    token: payload,
  };
}

/**
 * Verify the request origin. In the self-hosted setup, CORS is enforced at
 * the Express middleware level (see server.js), so this is a no-op that
 * always returns true to maintain API compatibility.
 */
export function verifyRequestOrigin(_request) {
  return true;
}

/**
 * Issue a signed JWT for a user. Used by login/session endpoints.
 * @param {object} user  - { id, email, roles?, metadata? }
 * @param {number} ttlSeconds - token lifetime in seconds (default: 7 days)
 */
export function issueToken(user, ttlSeconds = 60 * 60 * 24 * 7) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.roles || [],
    user_metadata: user.metadata || {},
    iat: now,
    exp: now + ttlSeconds,
  };
  const header = { alg: "HS256", typ: "JWT" };
  return sign(header, payload, secret);
}
