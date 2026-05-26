/**
 * POST /api/admin/logout — clears the session cookie, 302 to /admin/login.
 */

import type { APIRoute } from 'astro';
import { clearSessionCookie } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = async () => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': clearSessionCookie(),
    },
  });
};
