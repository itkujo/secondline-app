import { describe, it, expect } from 'vitest';
import { renderGalleryReadyHtml, renderExpiryWarningHtml, renderExpiredHtml } from '../email';
import type { EventRow } from '../types';

const event: EventRow = {
  id: 1, slug: 'ekdnza28',
  storage_backend_id: 'wasabi',
  host_first_name: 'Sarah', host_last_name: 'Beaumont',
  host_email: 'sarah@example.com',
  event_date: '2026-10-12',
  pictime_gallery_url: 'https://pictime.example/wedding-abc',
  expires_at: '2027-04-10T00:00:00Z',
  status: 'active',
  first_upload_at: null,
  warned_30_at: null,
  wall_dwell_ms: 5000,
  wall_crossfade_ms: 400,
  wall_video_max_ms: 30000,
  wall_video_full: 0,
  wall_hide_bg: 0,
  wall_hide_qr: 0,
  wall_hide_caption: 0,
  wall_transition: 'crossfade',
  wall_bg_key: null,
  language: null,
  created_at: '2026-05-25T00:00:00Z',
};

describe('secondline email templates', () => {
  it('gallery-ready includes gallery URL and ZIP link', () => {
    const html = renderGalleryReadyHtml(event, 'https://secondline.smile-nola.com');
    expect(html).toContain('/g/ekdnza28');
    expect(html).toContain('/api/events/ekdnza28/zip');
    expect(html).toContain('Sarah');
  });

  it('expiry warning includes days-remaining and ZIP CTA', () => {
    const html = renderExpiryWarningHtml(event, 'https://secondline.smile-nola.com', 30);
    expect(html).toContain('30');
    expect(html).toContain('ZIP');
  });

  it('expired template points to PicTime', () => {
    const html = renderExpiredHtml(event);
    expect(html).toContain(event.pictime_gallery_url!);
  });

  it('escapes HTML in dynamic fields', () => {
    const evil = { ...event, host_first_name: '<script>alert(1)</script>' };
    const html = renderGalleryReadyHtml(evil, 'https://x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders in English by default and Spanish when the event language is es', () => {
    const en = renderGalleryReadyHtml(event, 'https://x');
    expect(en).toContain('Your event gallery is ready');
    expect(en).toContain('<html lang="en">');

    const es = renderGalleryReadyHtml({ ...event, language: 'es' }, 'https://x');
    expect(es).toContain('La galería de tu evento está lista');
    expect(es).toContain('<html lang="es">');
  });
});
