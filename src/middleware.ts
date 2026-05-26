/**
 * Astro middleware. Auto-guards admin surfaces:
 *
 *   /admin/*       -> redirect to /admin/login if not authed
 *   /api/admin/*   -> 401 JSON if not authed
 *
 * Exempt routes:
 *   /admin/login
 *   /api/admin/login
 *   /api/admin/logout
 *
 * Cron and public surfaces are unguarded — they have their own bearer-token
 * checks (/api/cron/*) or are slug-gated (/u, /w, /g, /m, /api/events, /api/upload).
 */

import { defineMiddleware } from 'astro:middleware';
import { isAuthed } from '@/lib/auth';

const EXEMPT_PATHS = new Set<string>([
  '/admin/login',
  '/api/admin/login',
  '/api/admin/logout',
]);

export const onRequest = defineMiddleware(async ({ request, url, redirect }, next) => {
  const path = url.pathname;
  const isAdminPage = path.startsWith('/admin/') || path === '/admin';
  const isAdminApi = path.startsWith('/api/admin/') || path === '/api/admin';

  if ((isAdminPage || isAdminApi) && !EXEMPT_PATHS.has(path)) {
    if (!isAuthed(request)) {
      if (isAdminApi) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return redirect(`/admin/login?next=${encodeURIComponent(path)}`, 302);
    }
  }

  return next();
});
