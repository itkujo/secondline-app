/**
 * Second Line assets DB layer.
 *
 * Soft-deletes only (deleted_at column); operator removal is reversible until
 * the retention sweep hard-purges the storage object. Public listing always
 * filters deleted_at IS NULL.
 */

import { getDb } from '../db';
import type { AssetRow, AssetSource } from './types';

export interface RecordAssetInput {
  eventId: number;
  source: AssetSource;
  storageKey: string;
  thumbStorageKey: string | null;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  uploaderName: string | null;
}

export function recordAsset(input: RecordAssetInput): AssetRow {
  return getDb().prepare(`
    INSERT INTO assets
      (event_id, source, storage_key, thumb_storage_key, mime_type, byte_size, width, height, duration_ms, uploader_name, uploaded_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    RETURNING *
  `).get(
    input.eventId, input.source, input.storageKey, input.thumbStorageKey,
    input.mimeType, input.byteSize, input.width, input.height, input.durationMs, input.uploaderName,
  ) as unknown as AssetRow;
}

export function getAsset(id: number): AssetRow | null {
  return (getDb().prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow | undefined) ?? null;
}

export function listAssetsForEvent(eventId: number): AssetRow[] {
  return getDb().prepare(`
    SELECT * FROM assets
    WHERE event_id = ? AND deleted_at IS NULL
    ORDER BY uploaded_at ASC, id ASC
  `).all(eventId) as unknown as AssetRow[];
}

export function listAssetsSince(eventId: number, sinceIso: string): AssetRow[] {
  return getDb().prepare(`
    SELECT * FROM assets
    WHERE event_id = ? AND deleted_at IS NULL AND uploaded_at > ?
    ORDER BY uploaded_at ASC, id ASC
  `).all(eventId, sinceIso) as unknown as AssetRow[];
}

export function softDeleteAsset(id: number): void {
  getDb().prepare(`UPDATE assets SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

export function countAssetsForEvent(eventId: number): number {
  const r = getDb().prepare(`SELECT COUNT(*) AS n FROM assets WHERE event_id = ? AND deleted_at IS NULL`).get(eventId) as { n: number };
  return r.n;
}

export function totalBytesForEvent(eventId: number): number {
  const r = getDb().prepare(`SELECT COALESCE(SUM(byte_size), 0) AS s FROM assets WHERE event_id = ? AND deleted_at IS NULL`).get(eventId) as { s: number };
  return r.s;
}

export function listAllAssetsForPurge(eventId: number): AssetRow[] {
  return getDb().prepare(`SELECT * FROM assets WHERE event_id = ?`).all(eventId) as unknown as AssetRow[];
}
