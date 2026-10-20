// Session tokens, password hashing (PBKDF2 via WebCrypto) and login rate limiting.
// No external libraries; everything runs in the Workers runtime.

import {
  PBKDF2_ITERATIONS,
  SESSION_COOKIE,
} from "../config.js";

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

export function b64urlFromBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function bytesFromB64url(str) {
  const norm = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return b64urlFromBytes(bytes);
}

// ---------------------------------------------------------------------------
// Password hashing — storage format: pbkdf2$<iterations>$<salt b64url>$<hash b64url>
// Node's crypto.pbkdf2Sync(password, salt, iter, 32, 'sha256') produces the
// identical value (see scripts/hash-password.mjs).
// ---------------------------------------------------------------------------

async function pbkdf2Bits(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

/** Constant-time byte comparison (fixed-length digests only). */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function newPasswordHash(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return pbkdf2Bits(password, salt, PBKDF2_ITERATIONS).then((bits) =>
    `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlFromBytes(salt)}$${b64urlFromBytes(bits)}`
  );
}

/**
 * @returns {Promise<boolean>} true when the password matches the stored hash
 */
export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  let salt, expected;
  try {
    salt = bytesFromB64url(parts[2]);
    expected = bytesFromB64url(parts[3]);
  } catch {
    return false;
  }
  const actual = await pbkdf2Bits(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Sessions — stateless HMAC-signed token: base64url(payload).base64url(mac)
// ---------------------------------------------------------------------------

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function createSessionToken(secret, ttlHours) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + ttlHours * 3600 };
  const data = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  const mac = await hmac(secret, data);
  return `${data}.${b64urlFromBytes(mac)}`;
}

/**
 * @returns {Promise<boolean>} true when the token is intact and unexpired
 */
export async function verifySessionToken(token, secret) {
  if (typeof token !== "string" || typeof secret !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const data = token.slice(0, dot);
  const givenMac = bytesFromB64urlSafe(token.slice(dot + 1));
  if (!givenMac) return false;
  const expectedMac = await hmac(secret, data);
  if (!timingSafeEqual(givenMac, expectedMac)) return false;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(data)));
  } catch {
    return false;
  }
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp > Math.floor(Date.now() / 1000);
}

function bytesFromB64urlSafe(str) {
  try {
    return bytesFromB64url(str);
  } catch {
    return null;
  }
}

/** @returns {string|null} value of the session cookie, if present */
export function getSessionToken(request) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;\\s]+)`));
  return m ? m[1] : null;
}

export async function isAuthed(request, env) {
  if (!env.SESSION_SECRET) return false;
  return verifySessionToken(getSessionToken(request), env.SESSION_SECRET);
}

export function sessionCookieHeader(token, ttlHours) {
  // Secure cookies are accepted by browsers on http://localhost (treated as a
  // trustworthy origin), so the attribute can always be set.
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttlHours * 3600}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Login rate limiting (D1-backed attempt counter)
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{locked: boolean, retryAfterSec: number}>}
 */
export async function getLockState(db, ip) {
  const row = await db
    .prepare("SELECT locked_until FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first();
  if (row?.locked_until) {
    const until = Date.parse(row.locked_until);
    const now = Date.now();
    if (Number.isFinite(until) && until > now) {
      return { locked: true, retryAfterSec: Math.ceil((until - now) / 1000) };
    }
    // Lock expired — start a fresh window.
    await clearLoginFailures(db, ip);
  }
  return { locked: false, retryAfterSec: 0 };
}

/**
 * Record a failed attempt. After `maxFailures` failures the IP is locked for
 * `lockMinutes`. On locking, the counter resets so expiry starts a clean window.
 */
export async function recordLoginFailure(db, ip, maxFailures, lockMinutes) {
  const row = await db
    .prepare("SELECT failed_count FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first();
  const count = (row?.failed_count ?? 0) + 1;
  const now = new Date();
  if (count >= maxFailures) {
    const until = new Date(now.getTime() + lockMinutes * 60_000);
    await db
      .prepare(
        `INSERT INTO login_attempts (ip, failed_count, locked_until, updated_at)
         VALUES (?, 0, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET failed_count = 0, locked_until = excluded.locked_until, updated_at = excluded.updated_at`
      )
      .bind(ip, until.toISOString(), now.toISOString())
      .run();
    return { justLocked: true };
  }
  await db
    .prepare(
      `INSERT INTO login_attempts (ip, failed_count, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET failed_count = excluded.failed_count, updated_at = excluded.updated_at`
    )
    .bind(ip, count, now.toISOString())
    .run();
  return { justLocked: false };
}

export async function clearLoginFailures(db, ip) {
  await db
    .prepare("DELETE FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .run();
}
