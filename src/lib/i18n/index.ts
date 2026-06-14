/**
 * Second Line i18n entry point.
 *
 * Owns locale typing + the resolution cascade. The actual strings live in
 * ./messages. Safe to import from SSR `.astro`, React islands, and server-only
 * email code (no server-only deps here).
 *
 * Resolution cascade (highest priority first):
 *   1. Guest toggle      — the `sl_lang` cookie (an explicit per-device choice)
 *   2. Per-event setting  — events.language, chosen by the host in admin
 *   3. Browser auto-detect — the Accept-Language header
 *   4. DEFAULT_LOCALE      — English
 */

import { messages, type Locale, type Messages } from './messages';

export type { Locale, Messages };
export { messages };

export const LOCALES: readonly Locale[] = ['en', 'es'];
export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie name for the explicit guest language toggle. Mirrored in LangToggle. */
export const LOCALE_COOKIE = 'sl_lang';

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'es';
}

export function getMessages(locale: Locale): Messages {
  return messages[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

/**
 * Pick the first supported locale from an Accept-Language header, honoring
 * q-weights. Returns null when neither English nor Spanish is requested.
 */
export function detectFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.split('=')[1]) : 1;
      return { base: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { base } of ranked) {
    if (base === 'es') return 'es';
    if (base === 'en') return 'en';
  }
  return null;
}

/** Read the explicit guest toggle cookie off a request, if present and valid. */
export function readLocaleCookie(request: Request): Locale | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const pair of cookie.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== LOCALE_COOKIE) continue;
    const val = decodeURIComponent(pair.slice(eq + 1).trim());
    return isLocale(val) ? val : null;
  }
  return null;
}

/**
 * Resolve the locale for a request, optionally given the per-event default.
 * See the cascade documented at the top of this file.
 */
export function resolveLocale(request: Request, eventLanguage?: string | null): Locale {
  const cookie = readLocaleCookie(request);
  if (cookie) return cookie;
  if (isLocale(eventLanguage)) return eventLanguage;
  return detectFromAcceptLanguage(request.headers.get('accept-language')) ?? DEFAULT_LOCALE;
}
