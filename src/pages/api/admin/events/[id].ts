/**
 * Admin event mutations. Guarded by middleware.
 *
 *   PATCH body:
 *     { storage_backend_id?: string, pictime_gallery_url?: string|null }
 *
 *   storage_backend_id changes are rejected if any assets exist (immutability
 *   guarantee from spec §7.5).
 */

import type { APIRoute } from 'astro';
import { getEventById, setBackend, setPicTimeUrl } from '@/lib/secondline/events';
import { countAssetsForEvent } from '@/lib/secondline/assets';
import { getBackend } from '@/lib/secondline/storage/backends';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json(400, { error: 'Bad id' });
  const event = getEventById(id);
  if (!event) return json(404, { error: 'Not found' });

  let body: { storage_backend_id?: string; pictime_gallery_url?: string | null } = {};
  try { body = await request.json(); } catch { return json(400, { error: 'Bad JSON' }); }

  if (typeof body.storage_backend_id === 'string') {
    if (body.storage_backend_id !== event.storage_backend_id) {
      if (countAssetsForEvent(event.id) > 0) {
        return json(409, { error: 'Backend is locked — assets already uploaded' });
      }
      try { getBackend(body.storage_backend_id); }
      catch { return json(400, { error: `Unknown backend ${body.storage_backend_id}` }); }
      setBackend(event.id, body.storage_backend_id);
    }
  }
  if ('pictime_gallery_url' in body) {
    const v = body.pictime_gallery_url ? String(body.pictime_gallery_url).trim() : null;
    if (v && !/^https?:\/\//i.test(v)) return json(400, { error: 'URL must start with http(s)://' });
    setPicTimeUrl(event.id, v);
  }

  return json(200, { ok: true });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
