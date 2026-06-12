import { describe, it, expect } from 'vitest';
import { isExpired, daysUntilExpiry } from '../retention';
import type { EventRow } from '../types';

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1, slug: 'aaaa2345',
    storage_backend_id: 'wasabi',
    host_first_name: 'A', host_last_name: 'B', host_email: 'a@b.c',
    event_date: '2026-01-01',
    pictime_gallery_url: null,
    expires_at: null, status: 'active',
    first_upload_at: null, warned_30_at: null,
    wall_dwell_ms: 5000, wall_crossfade_ms: 400,
    wall_video_max_ms: 30000, wall_video_full: 0,
    wall_hide_bg: 0, wall_hide_qr: 0, wall_hide_caption: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('retention pure functions', () => {
  it('isExpired returns false when expires_at is null', () => {
    expect(isExpired(event({ expires_at: null }), new Date('2030-01-01'))).toBe(false);
  });
  it('isExpired returns true once expires_at is in the past', () => {
    expect(isExpired(event({ expires_at: '2026-06-01T00:00:00Z' }), new Date('2026-06-02'))).toBe(true);
  });
  it('isExpired returns false if expires_at is in the future', () => {
    expect(isExpired(event({ expires_at: '2026-06-01T00:00:00Z' }), new Date('2026-05-31'))).toBe(false);
  });
  it('daysUntilExpiry returns null when expires_at is null', () => {
    expect(daysUntilExpiry(event({ expires_at: null }), new Date('2026-01-01'))).toBeNull();
  });
  it('daysUntilExpiry returns rounded-down integer days', () => {
    expect(daysUntilExpiry(event({ expires_at: '2026-02-01T00:00:00Z' }), new Date('2026-01-01T12:00:00Z'))).toBe(30);
  });
  it('daysUntilExpiry returns negative for past expiry', () => {
    expect(daysUntilExpiry(event({ expires_at: '2026-01-01T00:00:00Z' }), new Date('2026-01-10T00:00:00Z'))).toBe(-9);
  });
});
