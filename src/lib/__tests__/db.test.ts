import { describe, it, expect, beforeEach } from 'vitest';
import sqlite from 'node:sqlite';
import { bootstrapSchema } from '../db';

let db: sqlite.DatabaseSync;

beforeEach(() => {
  db = new sqlite.DatabaseSync(':memory:');
  bootstrapSchema(db);
});

describe('schema bootstrap', () => {
  it('creates events table with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info('events')").all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    for (const n of [
      'id', 'slug', 'storage_backend_id',
      'host_first_name', 'host_last_name', 'host_email', 'event_date',
      'pictime_gallery_url', 'expires_at', 'status',
      'first_upload_at', 'created_at', 'warned_30_at',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('creates assets table with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info('assets')").all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    for (const n of [
      'id', 'event_id', 'source', 'storage_key', 'thumb_storage_key',
      'mime_type', 'byte_size', 'width', 'height', 'duration_ms',
      'uploader_name', 'uploaded_at', 'deleted_at',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('enforces slug UNIQUE on events', () => {
    db.prepare(`INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email, event_date, status)
                VALUES ('aaaaaaaa', 'wasabi', 'A', 'B', 'a@b.c', '2026-08-01', 'active')`).run();
    expect(() => db.prepare(`INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email, event_date, status)
                VALUES ('aaaaaaaa', 'wasabi', 'C', 'D', 'c@d.e', '2026-09-01', 'active')`).run())
      .toThrow(/UNIQUE/);
  });

  it('cascades delete from event to assets via FK', () => {
    const ev = db.prepare(`INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email, event_date, status)
                            VALUES ('bbbbbbbb', 'wasabi', 'A', 'B', 'a@b.c', '2026-08-01', 'active') RETURNING id`).get() as { id: number };
    db.prepare(`INSERT INTO assets (event_id, source, storage_key, mime_type, byte_size)
                VALUES (?, 'guest', 'key.jpg', 'image/jpeg', 12345)`).run(ev.id);
    db.prepare(`DELETE FROM events WHERE id = ?`).run(ev.id);
    const rows = db.prepare(`SELECT * FROM assets WHERE event_id = ?`).all(ev.id);
    expect(rows).toHaveLength(0);
  });

  it('bootstrapSchema is idempotent (safe to call twice)', () => {
    expect(() => bootstrapSchema(db)).not.toThrow();
  });
});
