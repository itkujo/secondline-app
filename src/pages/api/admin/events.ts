/**
 * POST /api/admin/events
 *
 * Body: application/x-www-form-urlencoded
 *   host_first_name (required)
 *   host_last_name  (required)
 *   host_email      (required)
 *   event_date      (required, YYYY-MM-DD)
 *   storage_backend_id (required, must exist in registry)
 *   pictime_gallery_url (optional)
 *
 * On success: 302 to /admin/events/<new-id>?created=1.
 * On validation error: 302 to /admin/events/new?error=<msg>.
 *
 * Guarded by middleware (lives under /api/admin).
 */

import type { APIRoute } from 'astro';
import { createEvent } from '@/lib/secondline/events';
import { getBackend } from '@/lib/secondline/storage/backends';
import { isLocale } from '@/lib/i18n';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try { form = await request.formData(); }
  catch { return redirectErr('Bad form body'); }

  const host_first_name = String(form.get('host_first_name') ?? '').trim();
  const host_last_name = String(form.get('host_last_name') ?? '').trim();
  const host_email = String(form.get('host_email') ?? '').trim();
  const event_date = String(form.get('event_date') ?? '').trim();
  const storage_backend_id = String(form.get('storage_backend_id') ?? '').trim();
  const pictime_raw = String(form.get('pictime_gallery_url') ?? '').trim();
  const language_raw = String(form.get('language') ?? '').trim();

  if (!host_first_name || host_first_name.length > 80) return redirectErr('Host first name is required (≤80 chars)');
  if (!host_last_name || host_last_name.length > 80) return redirectErr('Host last name is required (≤80 chars)');
  if (!EMAIL_RE.test(host_email)) return redirectErr('Host email looks invalid');
  if (!DATE_RE.test(event_date)) return redirectErr('Event date must be YYYY-MM-DD');
  if (Number.isNaN(Date.parse(`${event_date}T00:00:00Z`))) return redirectErr('Event date is not a valid date');

  try { getBackend(storage_backend_id); }
  catch { return redirectErr(`Unknown storage backend: ${storage_backend_id}`); }

  let pictime_gallery_url: string | null = null;
  if (pictime_raw) {
    if (!/^https?:\/\//i.test(pictime_raw)) return redirectErr('PicTime URL must start with http(s)://');
    pictime_gallery_url = pictime_raw;
  }

  const language = isLocale(language_raw) ? language_raw : null;

  const event = createEvent({
    host_first_name, host_last_name, host_email,
    event_date, storage_backend_id, pictime_gallery_url, language,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/events/${event.id}?created=1` },
  });
};

function redirectErr(msg: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/events/new?error=${encodeURIComponent(msg)}` },
  });
}
