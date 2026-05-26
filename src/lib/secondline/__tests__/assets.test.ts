import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite from 'node:sqlite';
import { bootstrapSchema, __setDbForTest } from '../../db';
import { createEvent } from '../events';
import {
  recordAsset, listAssetsForEvent, getAsset, softDeleteAsset,
  countAssetsForEvent, listAssetsSince, totalBytesForEvent, listAllAssetsForPurge,
} from '../assets';

let db: sqlite.DatabaseSync;
let eventId: number;

beforeEach(() => {
  db = new sqlite.DatabaseSync(':memory:');
  bootstrapSchema(db);
  __setDbForTest(db);
  eventId = createEvent({
    host_first_name: 'A', host_last_name: 'B',
    host_email: 'a@b.c', event_date: '2026-08-01',
    storage_backend_id: 'wasabi',
  }).id;
});

afterEach(() => { __setDbForTest(null); });

describe('assets DB layer', () => {
  it('recordAsset inserts and returns the new row', () => {
    const a = recordAsset({
      eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: 'k/1_thumb.jpg',
      mimeType: 'image/jpeg', byteSize: 100_000, width: 1024, height: 768, durationMs: null, uploaderName: 'Alice',
    });
    expect(a.id).toBeGreaterThan(0);
    expect(a.storage_key).toBe('k/1.jpg');
  });

  it('listAssetsForEvent returns alive assets in upload order', () => {
    recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    const list = listAssetsForEvent(eventId);
    expect(list.map(a => a.storage_key)).toEqual(['k/1.jpg', 'k/2.jpg']);
  });

  it('softDeleteAsset hides asset from listAssetsForEvent but row remains', () => {
    const a = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    softDeleteAsset(a.id);
    expect(listAssetsForEvent(eventId)).toHaveLength(0);
    expect(getAsset(a.id)?.deleted_at).toBeTruthy();
  });

  it('countAssetsForEvent counts only alive', () => {
    const a = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    expect(countAssetsForEvent(eventId)).toBe(2);
    softDeleteAsset(a.id);
    expect(countAssetsForEvent(eventId)).toBe(1);
  });

  it('listAssetsSince returns assets uploaded strictly after the given ISO ts', () => {
    const first = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    db.prepare(`UPDATE assets SET uploaded_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(first.id);
    const second = recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    const since = listAssetsSince(eventId, '2021-01-01T00:00:00Z');
    expect(since.map(a => a.id)).toEqual([second.id]);
  });

  it('totalBytesForEvent sums byte_size of alive assets', () => {
    recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1000, width: 1, height: 1, durationMs: null, uploaderName: null });
    recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 2500, width: 1, height: 1, durationMs: null, uploaderName: null });
    expect(totalBytesForEvent(eventId)).toBe(3500);
  });

  it('listAllAssetsForPurge includes soft-deleted rows', () => {
    const a = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    softDeleteAsset(a.id);
    expect(listAllAssetsForPurge(eventId)).toHaveLength(1);
  });
});
