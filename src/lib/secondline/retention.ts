/**
 * Retention sweep and reminder orchestration.
 *
 * Pure helpers (isExpired, daysUntilExpiry) are tested in isolation.
 * The sweep functions are side-effectful and call into the storage adapter
 * to delete objects, then update DB state to 'expired'. They log every
 * action and tolerate per-event failures (one bad event doesn't block the
 * batch — log it, continue).
 */

import { listActiveEvents, listEventsExpiringBefore, markExpired, markWarned30 } from './events';
import { listAllAssetsForPurge, softDeleteAsset } from './assets';
import { getBackend } from './storage/backends';
import { createS3Adapter } from './storage/s3';
import { sendExpiryWarning, sendExpiredNotice } from './email';
import type { EventRow } from './types';

export function isExpired(event: EventRow, now: Date): boolean {
  if (!event.expires_at) return false;
  return Date.parse(event.expires_at) <= now.getTime();
}

export function daysUntilExpiry(event: EventRow, now: Date): number | null {
  if (!event.expires_at) return null;
  const diffMs = Date.parse(event.expires_at) - now.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

export async function runRetentionSweep(now: Date = new Date()): Promise<{ processed: number; expired: number; failed: number }> {
  const events = listActiveEvents();
  let expired = 0, failed = 0;
  for (const ev of events) {
    if (!isExpired(ev, now)) continue;
    try {
      await purgeEventAssets(ev);
      markExpired(ev.id);
      await sendExpiredNotice(ev).catch(err => console.error('[secondline] expired notice send failed', err));
      expired++;
    } catch (err) {
      console.error('[secondline] retention sweep: failed to expire event', { id: ev.id, slug: ev.slug, err: String(err) });
      failed++;
    }
  }
  return { processed: events.length, expired, failed };
}

async function purgeEventAssets(event: EventRow): Promise<void> {
  const assets = listAllAssetsForPurge(event.id);
  if (assets.length === 0) return;
  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);
  for (const a of assets) {
    try {
      await s3.deleteObject(a.storage_key);
      if (a.thumb_storage_key) await s3.deleteObject(a.thumb_storage_key);
      softDeleteAsset(a.id);
    } catch (err) {
      console.error('[secondline] failed to delete asset object', { id: a.id, key: a.storage_key, err: String(err) });
      // continue — the next sweep run will retry
    }
  }
}

/**
 * Send the 30-day expiry warning to hosts of events that are within their
 * warning window AND haven't already been notified (warned_30_at IS NULL).
 * Safe to re-run within the same day — dedupes via warned_30_at column.
 */
export async function sendExpiryReminders(now: Date = new Date(), windowDays = 30): Promise<{ sent: number }> {
  const horizonMs = now.getTime() + windowDays * 24 * 60 * 60 * 1000;
  const horizonIso = new Date(horizonMs).toISOString();
  const events = listEventsExpiringBefore(horizonIso);
  let sent = 0;
  for (const ev of events) {
    if (ev.warned_30_at) continue;
    const left = daysUntilExpiry(ev, now);
    if (left == null || left < 0 || left > windowDays) continue;
    try {
      await sendExpiryWarning(ev, left);
      markWarned30(ev.id);
      sent++;
    } catch (err) {
      console.error('[secondline] expiry warning send failed', { id: ev.id, err: String(err) });
    }
  }
  return { sent };
}
