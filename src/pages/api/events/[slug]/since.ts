/**
 * GET /api/events/<slug>/since?ts=<ISO>
 * Returns assets uploaded strictly after `ts`. Used by the wall to catch up
 * after an SSE disconnect.
 */

import type { APIRoute } from 'astro';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsSince } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { AssetRow, PublicAsset } from '@/lib/secondline/types';

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return json(400, { error: 'Invalid slug' });
  const event = getEventBySlug(slug);
  if (!event) return json(404, { error: 'Not found' });

  const ts = url.searchParams.get('ts') ?? '';
  if (!ts || Number.isNaN(Date.parse(ts))) return json(400, { error: 'Invalid ts' });

  const rows = listAssetsSince(event.id, ts);
  return json(200, { assets: rows.map(r => toPublic(r, event.slug)) });
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
