/**
 * Admin event mutations. Guarded by middleware.
 *
 *   PATCH body:
 *     { storage_backend_id?: string, pictime_gallery_url?: string|null,
 *       wall_dwell_ms?: number, wall_crossfade_ms?: number,
 *       wall_video_max_ms?: number, wall_video_full?: boolean,
 *       wall_hide_bg?: boolean, wall_hide_qr?: boolean, wall_hide_caption?: boolean }
 *
 *   storage_backend_id changes are rejected if any assets exist (immutability
 *   guarantee from spec §7.5).
 */

import type { APIRoute } from 'astro';
import { getEventById, setBackend, setPicTimeUrl, setWallSettings } from '@/lib/secondline/events';
import { countAssetsForEvent } from '@/lib/secondline/assets';
import { getBackend } from '@/lib/secondline/storage/backends';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json(400, { error: 'Bad id' });
  const event = getEventById(id);
  if (!event) return json(404, { error: 'Not found' });

  let body: {
    storage_backend_id?: string; pictime_gallery_url?: string | null;
    wall_dwell_ms?: number; wall_crossfade_ms?: number;
    wall_video_max_ms?: number; wall_video_full?: boolean;
    wall_hide_bg?: boolean; wall_hide_qr?: boolean; wall_hide_caption?: boolean;
  } = {};
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
  const WALL_KEYS = ['wall_dwell_ms', 'wall_crossfade_ms', 'wall_video_max_ms',
                     'wall_video_full', 'wall_hide_bg', 'wall_hide_qr', 'wall_hide_caption'] as const;
  if (WALL_KEYS.some(k => k in body)) {
    const dwell = body.wall_dwell_ms ?? event.wall_dwell_ms;
    const crossfade = body.wall_crossfade_ms ?? event.wall_crossfade_ms;
    const videoMax = body.wall_video_max_ms ?? event.wall_video_max_ms;
    if (!Number.isInteger(dwell) || dwell < 1000 || dwell > 120_000) {
      return json(400, { error: 'wall_dwell_ms must be 1000–120000' });
    }
    if (!Number.isInteger(crossfade) || crossfade < 100 || crossfade > 5000) {
      return json(400, { error: 'wall_crossfade_ms must be 100–5000' });
    }
    if (crossfade >= dwell) return json(400, { error: 'Crossfade must be shorter than photo duration' });
    if (!Number.isInteger(videoMax) || videoMax < 1000 || videoMax > 600_000) {
      return json(400, { error: 'wall_video_max_ms must be 1000–600000' });
    }
    const flag = (v: boolean | undefined, current: number) => v === undefined ? current : (v ? 1 : 0);
    setWallSettings(event.id, {
      wall_dwell_ms: dwell,
      wall_crossfade_ms: crossfade,
      wall_video_max_ms: videoMax,
      wall_video_full: flag(body.wall_video_full, event.wall_video_full),
      wall_hide_bg: flag(body.wall_hide_bg, event.wall_hide_bg),
      wall_hide_qr: flag(body.wall_hide_qr, event.wall_hide_qr),
      wall_hide_caption: flag(body.wall_hide_caption, event.wall_hide_caption),
    });
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
