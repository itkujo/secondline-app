/**
 * Media proxy.
 *
 * GET /m/<slug>/<asset-id>
 * Streams the main asset from its backend's S3-compatible store.
 *
 * Access control:
 *   - Slug must shape-match — rejects path traversal at parse time.
 *   - Asset must belong to the event for that slug — prevents cross-event peek.
 *
 * Notes on the proxy lesson from AGENTS.md: this route relies on the request
 * arriving at the app through Traefik. We do NOT inspect Host headers — the
 * route is bound by Astro's path-based matching, not domain matching. Coolify
 * routes BOTH secondline.smile-nola.com AND media.smile-nola.com to the app,
 * and the `/m/*` scoping is done at the Astro level via this file's location.
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

  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);

  try {
    const { body, contentType, contentLength } = await s3.getObjectStream(asset.storage_key);
    const webStream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
    const headers: Record<string, string> = {
      'Content-Type': contentType ?? asset.mime_type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (contentLength != null) headers['Content-Length'] = String(contentLength);
    return new Response(webStream, { status: 200, headers });
  } catch (err) {
    console.error('[secondline] media proxy failed', { slug, assetId, err: String(err) });
    return new Response('Backend error', { status: 502 });
  }
};
