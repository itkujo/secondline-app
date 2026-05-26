/**
 * POST /api/cron/cleanup
 *
 * Triggered by a Coolify scheduled task. Bearer-gated (NOT cookie auth) so
 * Coolify can call it without an admin session. Lives OUTSIDE /api/admin so
 * the middleware doesn't try to apply.
 */

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { runRetentionSweep } from '@/lib/secondline/retention';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const token = getEnv('SECONDLINE_CRON_TOKEN');
  if (!token) return json(503, { error: 'cron not configured' });
  const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!constantTimeEquals(provided, token)) return json(401, { error: 'unauthorized' });

  const result = await runRetentionSweep(new Date());
  return json(200, { ok: true, ...result });
};

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
