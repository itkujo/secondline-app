import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite from 'node:sqlite';
import { bootstrapSchema, __setDbForTest } from '../../db';
import {
  createEvent, getEventBySlug, getEventById,
  setPicTimeUrl, markExpired, listActiveEvents, markFirstUpload, markWarned30,
} from '../events';

let db: sqlite.DatabaseSync;

beforeEach(() => {
  db = new sqlite.DatabaseSync(':memory:');
  bootstrapSchema(db);
  __setDbForTest(db);
});

afterEach(() => {
  __setDbForTest(null);
});

describe('events DB layer', () => {
  it('createEvent inserts a row and returns it with a unique slug and computed expires_at', () => {
    const ev = createEvent({
      host_first_name: 'Sarah', host_last_name: 'Beaumont',
      host_email: 'sarah@example.com', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    expect(ev.slug).toHaveLength(8);
    expect(ev.status).toBe('active');
    expect(ev.expires_at).toBeTruthy();
    // 180 days from 2026-08-01 = 2027-01-28
    expect(ev.expires_at!.startsWith('2027-01-28')).toBe(true);
    expect(ev.host_first_name).toBe('Sarah');
  });

  it('createEvent uses default backend when not specified', () => {
    process.env.SECONDLINE_ACTIVE_BACKEND = 'wasabi';
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
    });
    expect(ev.storage_backend_id).toBe('wasabi');
  });

  it('getEventBySlug returns the row when slug matches, null otherwise', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    expect(getEventBySlug(ev.slug)?.id).toBe(ev.id);
    expect(getEventBySlug('zzzzzzzz')).toBeNull();
  });

  it('setPicTimeUrl updates the URL', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    setPicTimeUrl(ev.id, 'https://pictime.example/abc');
    expect(getEventBySlug(ev.slug)?.pictime_gallery_url).toBe('https://pictime.example/abc');
  });

  it('markExpired flips status', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    markExpired(ev.id);
    expect(getEventBySlug(ev.slug)?.status).toBe('expired');
  });

  it('markFirstUpload sets first_upload_at only once (idempotent)', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    markFirstUpload(ev.id);
    const first = getEventBySlug(ev.slug)!;
    expect(first.first_upload_at).toBeTruthy();
    markFirstUpload(ev.id);
    const second = getEventBySlug(ev.slug)!;
    expect(second.first_upload_at).toBe(first.first_upload_at);
  });

  it('markWarned30 sets warned_30_at only once', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    markWarned30(ev.id);
    const first = getEventBySlug(ev.slug)!;
    expect(first.warned_30_at).toBeTruthy();
    markWarned30(ev.id);
    const second = getEventBySlug(ev.slug)!;
    expect(second.warned_30_at).toBe(first.warned_30_at);
  });

  it('listActiveEvents returns only active events', () => {
    const a = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    const b = createEvent({
      host_first_name: 'C', host_last_name: 'D',
      host_email: 'c@d.e', event_date: '2026-09-01',
      storage_backend_id: 'wasabi',
    });
    markExpired(b.id);
    const active = listActiveEvents();
    const ids = active.map(e => e.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it('getEventById round-trips', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    expect(getEventById(ev.id)?.slug).toBe(ev.slug);
    expect(getEventById(99999)).toBeNull();
  });
});
