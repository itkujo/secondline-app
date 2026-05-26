import type { APIRoute } from 'astro';
import { getEventById } from '@/lib/secondline/events';
import { sendGalleryReady } from '@/lib/secondline/email';

export const prerender = false;

export const POST: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json(400, { error: 'Bad id' });
  const event = getEventById(id);
  if (!event) return json(404, { error: 'Not found' });
  if (!event.host_email) return json(400, { error: 'Event has no host email' });
  await sendGalleryReady(event);
  return json(200, { ok: true });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
