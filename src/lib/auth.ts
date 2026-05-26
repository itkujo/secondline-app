/**
 * Single-password admin auth.
 *
 * - Cookie `sn_secondline`, 24h TTL, HMAC-signed with ADMIN_SESSION_SECRET.
 * - SameSite=Lax, HttpOnly, Secure when import.meta.env.PROD.
 * - In-memory sliding-window rate limit per (bucket, IP). Login bucket caps
 *   at 5 attempts per 5 minutes.
 * - All password compares are constant-time.
 *
 * This module owns ALL admin-auth surface. Middleware (src/middleware.ts)
 * and the login/logout endpoints are the only consumers.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { getEnv, getRequiredEnv } from './env';

export const COOKIE_NAME = 'sn_secondline';
const COOKIE_TTL_SEC = 24 * 60 * 60;
const COOKIE_TTL_MS = COOKIE_TTL_SEC * 1000;

// --- Password ---

export function passwordsMatch(submitted: string): boolean {
  const expected = getEnv('ADMIN_PASSWORD');
  if (!expected || !submitted) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Cookie signing ---

function sign(payload: string): string {
  const secret = getRequiredEnv('ADMIN_SESSION_SECRET');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Cookie value format: <issuedAtMs>.<nonce>.<sig>
 * Verification re-signs and compares constant-time; rejects on TTL expiry.
 */
export function issueSessionCookie(): string {
  const issuedAt = Date.now();
  const nonce = randomBytes(8).toString('base64url');
  const payload = `${issuedAt}.${nonce}`;
  const sig = sign(payload);
  const value = `${payload}.${sig}`;
  const flags = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_TTL_SEC}`,
  ];
  if (isProd()) flags.push('Secure');
  return flags.join('; ');
}

export function clearSessionCookie(): string {
  const flags = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isProd()) flags.push('Secure');
  return flags.join('; ');
}

export function verifyCookie(value: string): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [issuedAtStr, nonce, sig] = parts;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > COOKIE_TTL_MS) return false;
  const expected = sign(`${issuedAtStr}.${nonce}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readSessionCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const name = p.slice(0, eq);
    if (name === COOKIE_NAME) return p.slice(eq + 1);
  }
  return null;
}

export function isAuthed(request: Request): boolean {
  const v = readSessionCookie(request.headers.get('cookie') ?? '');
  if (!v) return false;
  return verifyCookie(v);
}

// --- IP detection ---

export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return '0.0.0.0';
}

// --- Rate limit ---

interface Bucket { hits: number[]; }
const buckets = new Map<string, Bucket>();

function key(name: string, ip: string): string { return `${name}::${ip}`; }

export function rateLimit(name: string, ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const k = key(name, ip);
  let b = buckets.get(k);
  if (!b) { b = { hits: [] }; buckets.set(k, b); }
  b.hits = b.hits.filter(t => now - t < windowMs);
  if (b.hits.length >= max) return false;
  b.hits.push(now);
  return true;
}

export function loginRateLimit(ip: string): boolean {
  return rateLimit('login', ip, 5, 5 * 60 * 1000);
}

export function resetRateLimit(): void {
  buckets.clear();
}

// --- Helpers ---

function isProd(): boolean {
  // import.meta.env is replaced at build time; in tests/runtime the
  // NODE_ENV-style check is the fallback.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((import.meta as any).env?.PROD) return true;
  } catch { /* not in vite */ }
  return process.env.NODE_ENV === 'production';
}
