/**
 * GET /api/events/<slug>/stream
 * Server-Sent Events stream of asset.added/asset.removed events.
 *
 * The handler does NOT replay history. Clients are expected to:
 *   1. GET /assets on connect to seed initial state
 *   2. Open this stream
 *   3. If the stream drops, reconnect and call /since?ts=<last-seen> to catch up
 *
 * Why: pushing history through SSE complicates ordering and ack semantics for
 * no benefit. The two-call pattern is dead simple to reason about.
 */

import type { APIRoute } from 'astro';
import { getEventBySlug } from '@/lib/secondline/events';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import { getSseHub } from '@/lib/secondline/sse';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return new Response('Invalid slug', { status: 400 });
  const event = getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });
  if (event.status === 'expired') return new Response('Expired', { status: 410 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send(': connected\n\n');
      unsubscribe = getSseHub().subscribe(event.id, send);
      keepAlive = setInterval(() => {
        try { send(': ka\n\n'); } catch { /* will be cleaned in cancel */ }
      }, 25_000);
    },
    cancel() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
