/**
 * Second Line host-facing email templates.
 *
 * All inline HTML, brand-tinted (dark luxury, gold on near-black). Senders
 * call sendRawEmail from @/lib/email; this module owns only the templates
 * and the thin wrapper functions that map an EventRow into a send.
 *
 * Locale: emails go out in the event's configured language (events.language),
 * falling back to English. There's no per-recipient browser context at send
 * time, so the per-event setting is the only signal that applies here.
 */

import { getEnv } from '@/lib/env';
import { sendRawEmail } from '@/lib/email';
import { getMessages, resolveLocale, type Locale } from '@/lib/i18n';
import type { EventRow } from './types';

function publicBase(): string {
  return getEnv('SECONDLINE_PUBLIC_URL') || 'https://secondline.smile-nola.com';
}

/** Locale for an event's emails: the per-event setting, else English. */
function eventLocale(event: EventRow): Locale {
  // resolveLocale with a synthetic header-less request reduces to:
  // event.language (if valid) -> default. No cookie/Accept-Language here.
  return resolveLocale(new Request('https://secondline.smile-nola.com'), event.language);
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shell(inner: string, locale: Locale): string {
  return `<!doctype html><html lang="${locale}"><body style="margin:0;padding:0;background:#050505;color:#f8f4ea;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">${inner}</div></body></html>`;
}

function brandHeader(): string {
  return `<div style="text-align:center;margin-bottom:24px;">
    <div style="font-family:Georgia,serif;font-size:22px;color:#d4af37;letter-spacing:0.08em;">SMILE NOLA</div>
    <div style="font-size:11px;color:#b8b2a5;letter-spacing:0.2em;margin-top:6px;">SECOND LINE</div>
  </div>`;
}

function buttonHtml(label: string, href: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:#d4af37;color:#050505;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">${esc(label)}</a>`;
}

export function renderGalleryReadyHtml(event: EventRow, base?: string): string {
  const b = base || publicBase();
  const locale = eventLocale(event);
  const t = getMessages(locale).email;
  const galleryUrl = `${b}/g/${event.slug}`;
  const zipUrl = `${b}/api/events/${event.slug}/zip`;
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">${esc(t.galleryReadyHeading)}</h1>
    <p style="color:#cfc7b3;line-height:1.55;">${esc(t.galleryReadyGreeting(event.host_first_name))}</p>
    <p style="margin:28px 0;">${buttonHtml(t.viewGallery, galleryUrl)}</p>
    <p style="color:#b8b2a5;font-size:14px;line-height:1.55;">
      ${esc(t.alsoDownloadPre)}<a href="${esc(zipUrl)}" style="color:#d4af37;">${esc(t.alsoDownloadLink)}</a>${esc(t.alsoDownloadPost)}
    </p>
    <p style="color:#9a9484;font-size:12px;margin-top:32px;">
      ${esc(t.retentionNote)}
    </p>
  `, locale);
}

export function renderExpiryWarningHtml(event: EventRow, base: string, daysLeft: number): string {
  const b = base || publicBase();
  const locale = eventLocale(event);
  const t = getMessages(locale).email;
  const zipUrl = `${b}/api/events/${event.slug}/zip`;
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">${esc(t.expiryHeading(daysLeft))}</h1>
    <p style="color:#cfc7b3;line-height:1.55;">${esc(t.expiryBody(event.host_first_name, daysLeft))}</p>
    <p style="margin:28px 0;">${buttonHtml(t.downloadZip, zipUrl)}</p>
    ${event.pictime_gallery_url ? `<p style="color:#b8b2a5;font-size:14px;">${esc(t.expiryPrintsPre)}<a href="${esc(event.pictime_gallery_url)}" style="color:#d4af37;">${esc(t.expiryPrintsLink)}</a>${esc(t.expiryPrintsPost)}</p>` : ''}
  `, locale);
}

export function renderExpiredHtml(event: EventRow): string {
  const locale = eventLocale(event);
  const t = getMessages(locale).email;
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">${esc(t.expiredHeading)}</h1>
    <p style="color:#cfc7b3;line-height:1.55;">${esc(t.expiredBody(event.host_first_name, event.event_date))}</p>
    <p style="margin:28px 0;">${buttonHtml(t.orderPrints, event.pictime_gallery_url || 'https://smile-nola.com')}</p>
  `, locale);
}

// ---- Send wrappers ----

export async function sendGalleryReady(event: EventRow): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: getMessages(eventLocale(event)).email.galleryReadySubject,
    html: renderGalleryReadyHtml(event),
  });
}

export async function sendExpiryWarning(event: EventRow, daysLeft: number): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: getMessages(eventLocale(event)).email.expirySubject(daysLeft),
    html: renderExpiryWarningHtml(event, publicBase(), daysLeft),
  });
}

export async function sendExpiredNotice(event: EventRow): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: getMessages(eventLocale(event)).email.expiredSubject,
    html: renderExpiredHtml(event),
  });
}
