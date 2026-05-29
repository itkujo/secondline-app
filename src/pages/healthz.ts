/**
 * GET /healthz — liveness probe.
 *
 * Cheap: no DB write, no auth, no middleware coupling. Returns JSON with the
 * build SHA so operators can curl this and confirm which commit is actually
 * running in the container (vs. what they think they pushed).
 *
 *   curl -s https://your-host/healthz
 *   {"ok":true,"sha":"abc1234","ts":"2026-05-29T12:00:00.000Z"}
 *
 * Used by:
 *  - Dockerfile HEALTHCHECK
 *  - Manual deploy verification ("did my latest push actually deploy?")
 *  - External uptime monitor if you wire one up
 */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  const sha = (import.meta.env.PUBLIC_GIT_SHA ?? process.env.PUBLIC_GIT_SHA ?? 'dev').toString().slice(0, 7);
  return new Response(JSON.stringify({ ok: true, sha, ts: new Date().toISOString() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
