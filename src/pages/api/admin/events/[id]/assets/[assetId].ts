import type { APIRoute } from 'astro';
import { getEventById } from '@/lib/secondline/events';
import { getAsset, softDeleteAsset } from '@/lib/secondline/assets';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';
import { getSseHub } from '@/lib/secondline/sse';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  const eventId = Number(params.id);
  const assetId = Number(params.assetId);
  if (!Number.isInteger(eventId) || !Number.isInteger(assetId)) return json(400, { error: 'Bad id' });
  const event = getEventById(eventId);
  if (!event) return json(404, { error: 'Event not found' });
  const asset = getAsset(assetId);
  if (!asset || asset.event_id !== event.id) return json(404, { error: 'Asset not found' });
  if (asset.deleted_at) return json(200, { ok: true });

  // Best-effort object deletion; if it fails, retention sweep will retry.
  try {
    const s3 = createS3Adapter(getBackend(event.storage_backend_id));
    await s3.deleteObject(asset.storage_key);
    if (asset.thumb_storage_key) await s3.deleteObject(asset.thumb_storage_key);
  } catch (err) {
    console.error('[secondline] admin delete: backend deletion failed', { assetId, err: String(err) });
    // Continue: still mark deleted_at so it disappears from UI.
  }
  softDeleteAsset(asset.id);

  // Tell live walls
  getSseHub().broadcast(event.id, { type: 'asset.removed', id: asset.id, ts: new Date().toISOString() });

  return json(200, { ok: true });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
