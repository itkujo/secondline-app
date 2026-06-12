/**
 * Admin: custom wall background. Guarded by middleware.
 *
 *   POST  multipart/form-data { file } — JPEG/PNG/WebP, ≤ 10 MB. Resized to
 *         ≤ 2560px wide, stored as JPEG under a timestamped key (so the
 *         media proxy can serve it immutable), key saved on the event.
 *   DELETE — removes the object and clears the key.
 */

import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { getEventById, setWallBgKey } from '@/lib/secondline/events';
import { isImageMime, MAX_IMAGE_BYTES } from '@/lib/secondline/media-processing';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json(400, { error: 'Bad id' });
  const event = getEventById(id);
  if (!event) return json(404, { error: 'Not found' });

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return json(400, { error: 'Missing file' });
    if (file.size > MAX_IMAGE_BYTES) return json(413, { error: `Image too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB)` });
    const mime = (file.type || '').toLowerCase();
    if (!isImageMime(mime)) return json(415, { error: `Unsupported type ${mime}` });

    const input = Buffer.from(await file.arrayBuffer());
    const main = await sharp(input).rotate()
      .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true, progressive: true })
      .toBuffer();

    const key = `${event.id}/wall-bg-${Date.now()}.jpg`;
    const s3 = createS3Adapter(getBackend(event.storage_backend_id));
    await s3.putObject({
      key, body: main, contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    // Best-effort cleanup of the previous background object.
    if (event.wall_bg_key) {
      try { await s3.deleteObject(event.wall_bg_key); } catch { /* retention sweep won't see it; acceptable orphan */ }
    }
    setWallBgKey(event.id, key);
    return json(200, { ok: true, src: `/m/${event.slug}/bg?v=${encodeURIComponent(key)}` });
  } catch (err) {
    console.error('[secondline] wall-bg upload failed', err);
    return json(500, { error: 'Internal error' });
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json(400, { error: 'Bad id' });
  const event = getEventById(id);
  if (!event) return json(404, { error: 'Not found' });
  if (event.wall_bg_key) {
    try {
      const s3 = createS3Adapter(getBackend(event.storage_backend_id));
      await s3.deleteObject(event.wall_bg_key);
    } catch (err) {
      console.error('[secondline] wall-bg delete: backend deletion failed', { id, err: String(err) });
    }
    setWallBgKey(event.id, null);
  }
  return json(200, { ok: true });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
