/**
 * SQLite singleton + schema bootstrap.
 *
 * Uses Node's built-in node:sqlite (Node 22.5+). No native build step, no
 * cross-platform headaches. API surface is a strict subset of better-sqlite3
 * (prepare().run/get/all/iterate, exec, transactions via BEGIN/COMMIT).
 *
 * The schema is created and migrated by bootstrapSchema, called once at app
 * boot via getDb(). All migrations are idempotent (CREATE TABLE IF NOT EXISTS,
 * column-add via PRAGMA table_info check).
 */

import sqlite from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEnv } from './env';

export type Db = sqlite.DatabaseSync;

let _db: Db | null = null;

export function getDb(): Db {
  if (_db) return _db;
  const dir = resolve(process.cwd(), getEnv('SECONDLINE_DB_DIR') || './data');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'secondline.db');
  const db = new sqlite.DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  bootstrapSchema(db);
  _db = db;
  return db;
}

/** Test-only: replace the singleton. */
export function __setDbForTest(db: Db | null): void {
  _db = db;
}

export function bootstrapSchema(db: Db): void {
  // Ensure PRAGMAs even when called against an in-memory test db.
  db.exec(`PRAGMA foreign_keys = ON;`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      storage_backend_id TEXT NOT NULL,
      host_first_name TEXT NOT NULL,
      host_last_name TEXT NOT NULL,
      host_email TEXT NOT NULL,
      event_date TEXT NOT NULL,
      pictime_gallery_url TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
      first_upload_at TEXT,
      warned_30_at TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS idx_events_status  ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_expires ON events(expires_at);

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'guest' CHECK (source IN ('guest','booth')),
      storage_key TEXT NOT NULL,
      thumb_storage_key TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      uploader_name TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_assets_event ON assets(event_id, uploaded_at);
    CREATE INDEX IF NOT EXISTS idx_assets_alive ON assets(event_id) WHERE deleted_at IS NULL;
  `);
}
