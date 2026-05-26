/**
 * GET /m/<slug>/<asset-id>_thumb
 * Streams the asset thumbnail; falls back to main object if no thumb stored
 * (videos in v1 — no extracted frame).
 */

import type { APIRoute } from 'astro';
import { Readable } from 'node:stream';
import { getEventBySlug } from '@/lib/secondline/events';
import { getAsset } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  const assetRaw = String(params.asset ?? '');
  if (!isValidSlugShape(slug)) return new Response('Bad slug', { status: 400 });
  const assetId = Number(assetRaw);
  if (!Number.isInteger(assetId) || assetId <= 0) return new Response('Bad asset id', { status: 400 });

  const event = getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });
  const asset = getAsset(assetId);
  if (!asset || asset.event_id !== event.id) return new Response('Not found', { status: 404 });
  if (asset.deleted_at) return new Response('Gone', { status: 410 });

  const key = asset.thumb_storage_key ?? asset.storage_key;
  const contentType = asset.thumb_storage_key ? 'image/jpeg' : asset.mime_type;

  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);

  try {
    const { body, contentLength } = await s3.getObjectStream(key);
    const webStream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (contentLength != null) headers['Content-Length'] = String(contentLength);
    return new Response(webStream, { status: 200, headers });
  } catch (err) {
    console.error('[secondline] thumb proxy failed', { slug, assetId, err: String(err) });
    return new Response('Backend error', { status: 502 });
  }
};
