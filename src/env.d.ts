/// <reference types="astro/client" />
/// <reference types="vite/client" />

declare namespace App {
  interface Locals {
    /** Request-level locale resolved in middleware (cookie toggle / browser auto-detect). */
    locale: import('@/lib/i18n').Locale;
  }
}
