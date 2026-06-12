/**
 * Second Line events DB layer.
 *
 * One event = one host's gallery + wall. Created manually by an operator
 * via /admin/events/new (Task 24). Storage backend is locked at creation;
 * cross-backend migration is out of scope for v1.
 */

import { getDb } from '../db';
import { getEnv } from '../env';
import { generateSlug } from './slugs';
import type { EventRow } from './types';

const RETENTION_DAYS = 180;

function defaultBackendId(): string {
  return getEnv('SECONDLINE_ACTIVE_BACKEND') || 'wasabi';
}

function computeExpiresAt(eventDate: string): string | null {
  if (!eventDate) return null;
  const d = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + RETENTION_DAYS);
  return d.toISOString();
}

export interface CreateEventInput {
  host_first_name: string;
  host_last_name: string;
  host_email: string;
  event_date: string;           // YYYY-MM-DD
  storage_backend_id?: string;  // defaults to SECONDLINE_ACTIVE_BACKEND
  pictime_gallery_url?: string | null;
}

export function createEvent(input: CreateEventInput): EventRow {
  const backend = input.storage_backend_id || defaultBackendId();
  const expires_at = computeExpiresAt(input.event_date);
  const stmt = getDb().prepare(`
    INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email,
                        event_date, pictime_gallery_url, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
    RETURNING *
  `);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return stmt.get(
        generateSlug(),
        backend,
        input.host_first_name,
        input.host_last_name,
        input.host_email,
        input.event_date,
        input.pictime_gallery_url ?? null,
        expires_at,
      ) as unknown as EventRow;
    } catch (err: unknown) {
      const msg = String((err as Error)?.message ?? '');
      if (attempt === 7 || !/UNIQUE/i.test(msg)) throw err;
    }
  }
  throw new Error('createEvent: slug generation exhausted retries');
}

export function getEventBySlug(slug: string): EventRow | null {
  return (getDb().prepare(`SELECT * FROM events WHERE slug = ?`).get(slug) as EventRow | undefined) ?? null;
}

export function getEventById(id: number): EventRow | null {
  return (getDb().prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined) ?? null;
}

export function setPicTimeUrl(eventId: number, url: string | null): void {
  getDb().prepare(`UPDATE events SET pictime_gallery_url = ? WHERE id = ?`).run(url, eventId);
}

export const WALL_TRANSITIONS = ['crossfade', 'slide', 'zoom', 'kenburns'] as const;

export interface WallSettings {
  wall_dwell_ms: number;
  wall_crossfade_ms: number;
  wall_video_max_ms: number;
  wall_video_full: number;     // 0/1
  wall_hide_bg: number;        // 0/1
  wall_hide_qr: number;        // 0/1
  wall_hide_caption: number;   // 0/1
  wall_transition: string;
}

export function setWallSettings(eventId: number, s: WallSettings): void {
  getDb().prepare(`
    UPDATE events SET wall_dwell_ms = ?, wall_crossfade_ms = ?, wall_video_max_ms = ?,
                      wall_video_full = ?, wall_hide_bg = ?, wall_hide_qr = ?, wall_hide_caption = ?,
                      wall_transition = ?
    WHERE id = ?
  `).run(s.wall_dwell_ms, s.wall_crossfade_ms, s.wall_video_max_ms,
         s.wall_video_full, s.wall_hide_bg, s.wall_hide_qr, s.wall_hide_caption,
         s.wall_transition, eventId);
}

export function setWallBgKey(eventId: number, key: string | null): void {
  getDb().prepare(`UPDATE events SET wall_bg_key = ? WHERE id = ?`).run(key, eventId);
}

export function setBackend(eventId: number, backendId: string): void {
  // Caller must enforce "no assets yet"; we don't second-guess.
  getDb().prepare(`UPDATE events SET storage_backend_id = ? WHERE id = ?`).run(backendId, eventId);
}

export function markExpired(eventId: number): void {
  getDb().prepare(`UPDATE events SET status = 'expired' WHERE id = ?`).run(eventId);
}

export function markFirstUpload(eventId: number): void {
  getDb().prepare(`UPDATE events SET first_upload_at = COALESCE(first_upload_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(eventId);
}

export function markWarned30(eventId: number): void {
  getDb().prepare(`UPDATE events SET warned_30_at = COALESCE(warned_30_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(eventId);
}

export function listActiveEvents(): EventRow[] {
  return getDb().prepare(`SELECT * FROM events WHERE status = 'active' ORDER BY created_at DESC`).all() as unknown as EventRow[];
}

export function listEventsExpiringBefore(iso: string): EventRow[] {
  return getDb().prepare(`SELECT * FROM events WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`).all(iso) as unknown as EventRow[];
}
