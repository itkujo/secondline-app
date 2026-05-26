/**
 * GET /api/events/<slug>/assets
 * Returns the full asset list for an event (used by the wall and gallery on
 * initial load). Slug-gated. No auth.
 */

import type { APIRoute } from 'astro';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsForEvent } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { PublicAsset, AssetRow } from '@/lib/secondline/types';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return json(400, { error: 'Invalid slug' });
  const event = getEventBySlug(slug);
  if (!event) return json(404, { error: 'Not found' });
  if (event.status === 'expired' && event.pictime_gallery_url) {
    return new Response(null, { status: 302, headers: { Location: event.pictime_gallery_url } });
  }
  const rows = listAssetsForEvent(event.id);
  return json(200, {
    event: { slug: event.slug, status: event.status },
    assets: rows.map(r => toPublic(r, event.slug)),
  });
};

function toPublic(r: AssetRow, slug: string): PublicAsset {
  return {
    id: r.id,
    src: `/m/${slug}/${r.id}`,
    thumb: r.thumb_storage_key ? `/m/${slug}/${r.id}_thumb` : `/m/${slug}/${r.id}`,
    mime_type: r.mime_type,
    width: r.width, height: r.height, duration_ms: r.duration_ms,
    uploader_name: r.uploader_name, uploaded_at: r.uploaded_at,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
