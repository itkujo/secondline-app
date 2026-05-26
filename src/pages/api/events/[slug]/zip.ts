/**
 * GET /api/events/<slug>/zip
 *
 * Streams a ZIP of every alive asset for the event. Slug-gated, no auth —
 * matches the gallery's access model.
 *
 * Filenames in the ZIP are `<slug>-<asset-id>.<ext>`. We don't have
 * the guest's original filename (we throw it away on processing); a stable
 * sortable ID is more useful for the host anyway.
 */

import type { APIRoute } from 'astro';
import archiver from 'archiver';
import { Readable } from 'node:stream';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsForEvent } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return new Response('Bad slug', { status: 400 });
  const event = getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });

  const assets = listAssetsForEvent(event.id);
  if (assets.length === 0) return new Response('No assets', { status: 404 });

  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);

  const archive = archiver('zip', { zlib: { level: 1 } }); // photos/videos already compressed
  archive.on('warning', err => console.warn('[secondline] zip warning', err));
  archive.on('error', err => console.error('[secondline] zip error', err));

  void (async () => {
    try {
      for (const a of assets) {
        const { body } = await s3.getObjectStream(a.storage_key);
        const ext = extFromMime(a.mime_type);
        archive.append(body, { name: `${event.slug}-${a.id}.${ext}` });
      }
      await archive.finalize();
    } catch (err) {
      console.error('[secondline] zip build failed', err);
      archive.abort();
    }
  })();

  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="secondline-${event.slug}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
};

function extFromMime(m: string): string {
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'bin';
}
