/**
 * Second Line guest upload endpoint.
 *
 * POST multipart/form-data
 *   - file: required, the photo/video bytes
 *   - slug: required, the event slug
 *   - uploader_name: optional, guest-supplied name
 *
 * Per-file POST (the client loops over a FileList). Single-shot upload —
 * no chunking, no multipart S3 — backed by the service worker for retry
 * on flaky networks. Max body size: 200 MB (videos) / 10 MB (images);
 * enforced here per-type with a human-readable 413, and again in
 * processUpload.
 *
 * Never throws to the client. On any failure returns { ok: false, error }
 * with the right HTTP status, and the service worker retries.
 */

import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { getEventBySlug, markFirstUpload } from '@/lib/secondline/events';
import { recordAsset } from '@/lib/secondline/assets';
import { processUpload, isAcceptedMime, isImageMime, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '@/lib/secondline/media-processing';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';
import { getSseHub } from '@/lib/secondline/sse';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { PublicAsset, SseAssetAdded } from '@/lib/secondline/types';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const ctype = request.headers.get('content-type') ?? '';
    if (!ctype.includes('multipart/form-data')) {
      return json(415, { ok: false, error: 'Expected multipart/form-data' });
    }
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '');
    if (!isValidSlugShape(slug)) return json(400, { ok: false, error: 'Invalid slug' });

    const event = getEventBySlug(slug);
    if (!event) return json(404, { ok: false, error: 'Event not found' });
    if (event.status === 'expired') return json(410, { ok: false, error: 'Event has expired' });

    const file = form.get('file');
    if (!(file instanceof File)) return json(400, { ok: false, error: 'Missing file' });
    if (file.size === 0) return json(400, { ok: false, error: 'Empty file' });

    const declaredMime = (file.type || 'application/octet-stream').toLowerCase();
    if (!isAcceptedMime(declaredMime)) return json(415, { ok: false, error: `Unsupported type ${declaredMime}` });
    const maxBytes = isImageMime(declaredMime) ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > maxBytes) {
      const kind = isImageMime(declaredMime) ? 'Photo' : 'Video';
      return json(413, { ok: false, error: `${kind} too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` });
    }

    const uploaderNameRaw = form.get('uploader_name');
    const uploaderName = typeof uploaderNameRaw === 'string' && uploaderNameRaw.trim()
      ? uploaderNameRaw.trim().slice(0, 80)
      : null;

    const buf = Buffer.from(await file.arrayBuffer());
    const processed = await processUpload(buf, declaredMime);

    const assetUuid = randomUUID();
    const ext = isImageMime(processed.mimeType) ? 'jpg' : extForVideoMime(processed.mimeType);
    const mainKey = `${event.id}/${assetUuid}.${ext}`;
    const thumbKey = processed.thumb ? `${event.id}/${assetUuid}_thumb.jpg` : null;

    const backend = getBackend(event.storage_backend_id);
    const s3 = createS3Adapter(backend);
    const ops: Promise<void>[] = [
      s3.putObject({
        key: mainKey, body: processed.main, contentType: processed.mimeType,
        cacheControl: 'public, max-age=31536000, immutable',
      }),
    ];
    if (thumbKey && processed.thumb) {
      ops.push(s3.putObject({
        key: thumbKey, body: processed.thumb, contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      }));
    }
    await Promise.all(ops);

    const asset = recordAsset({
      eventId: event.id,
      source: 'guest',
      storageKey: mainKey,
      thumbStorageKey: thumbKey,
      mimeType: processed.mimeType,
      byteSize: processed.main.length,
      width: processed.width,
      height: processed.height,
      durationMs: processed.durationMs,
      uploaderName,
    });

    markFirstUpload(event.id);

    const publicAsset: PublicAsset = {
      id: asset.id,
      src: `/m/${event.slug}/${asset.id}`,
      thumb: asset.thumb_storage_key ? `/m/${event.slug}/${asset.id}_thumb` : `/m/${event.slug}/${asset.id}`,
      mime_type: asset.mime_type,
      width: asset.width,
      height: asset.height,
      duration_ms: asset.duration_ms,
      uploader_name: asset.uploader_name,
      uploaded_at: asset.uploaded_at,
    };
    const msg: SseAssetAdded = { type: 'asset.added', asset: publicAsset, ts: asset.uploaded_at };
    getSseHub().broadcast(event.id, msg);

    return json(200, { ok: true, asset: publicAsset });
  } catch (err) {
    console.error('[secondline] upload failed', err);
    return json(500, { ok: false, error: 'Internal error' });
  }
};

function extForVideoMime(mime: string): string {
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  return 'bin';
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
