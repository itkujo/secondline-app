/**
 * POST /api/admin/login
 *
 * Body: application/x-www-form-urlencoded
 *   password=<string>
 *   next=<path>   (optional, defaults to /admin/events)
 *
 * On success: 302 to `next` with Set-Cookie.
 * On wrong password: 302 to /admin/login?error=1 (preserves next).
 * On rate-limit: 302 to /admin/login?error=rate.
 */

import type { APIRoute } from 'astro';
import { passwordsMatch, issueSessionCookie, clientIp, loginRateLimit } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!loginRateLimit(ip)) {
    return new Response(null, { status: 302, headers: { Location: '/admin/login?error=rate' } });
  }

  let password = '';
  let next = '/admin/events';
  try {
    const form = await request.formData();
    password = String(form.get('password') ?? '');
    const n = String(form.get('next') ?? '');
    if (n && n.startsWith('/') && !n.startsWith('//')) next = n;
  } catch {
    return new Response(null, { status: 302, headers: { Location: '/admin/login?error=1' } });
  }

  if (!passwordsMatch(password)) {
    const loc = `/admin/login?error=1&next=${encodeURIComponent(next)}`;
    return new Response(null, { status: 302, headers: { Location: loc } });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': issueSessionCookie(),
    },
  });
};
