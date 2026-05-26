/**
 * Second Line host-facing email templates.
 *
 * All inline HTML, brand-tinted (dark luxury, gold on near-black). Senders
 * call sendRawEmail from @/lib/email; this module owns only the templates
 * and the thin wrapper functions that map an EventRow into a send.
 */

import { getEnv } from '@/lib/env';
import { sendRawEmail } from '@/lib/email';
import type { EventRow } from './types';

function publicBase(): string {
  return getEnv('SECONDLINE_PUBLIC_URL') || 'https://secondline.smile-nola.com';
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#050505;color:#f8f4ea;font-family:Helvetica,Arial,sans-serif;">
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
  const galleryUrl = `${b}/g/${event.slug}`;
  const zipUrl = `${b}/api/events/${event.slug}/zip`;
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">Your event gallery is ready</h1>
    <p style="color:#cfc7b3;line-height:1.55;">Hi ${esc(event.host_first_name)}, here's everything your guests shared during the event.</p>
    <p style="margin:28px 0;">${buttonHtml('View gallery', galleryUrl)}</p>
    <p style="color:#b8b2a5;font-size:14px;line-height:1.55;">
      You can also <a href="${esc(zipUrl)}" style="color:#d4af37;">download everything as a ZIP</a>.
    </p>
    <p style="color:#9a9484;font-size:12px;margin-top:32px;">
      Your guest gallery is available for 180 days from your event date.
    </p>
  `);
}

export function renderExpiryWarningHtml(event: EventRow, base: string, daysLeft: number): string {
  const b = base || publicBase();
  const zipUrl = `${b}/api/events/${event.slug}/zip`;
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">Your guest gallery expires in ${daysLeft} days</h1>
    <p style="color:#cfc7b3;line-height:1.55;">Hi ${esc(event.host_first_name)}, your Second Line gallery will be cleared in ${daysLeft} days. Grab everything as a ZIP now so you have a copy.</p>
    <p style="margin:28px 0;">${buttonHtml('Download all as ZIP', zipUrl)}</p>
    ${event.pictime_gallery_url ? `<p style="color:#b8b2a5;font-size:14px;">After that, you'll still be able to <a href="${esc(event.pictime_gallery_url)}" style="color:#d4af37;">order prints from PicTime</a>.</p>` : ''}
  `);
}

export function renderExpiredHtml(event: EventRow): string {
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">Your guest gallery has been archived</h1>
    <p style="color:#cfc7b3;line-height:1.55;">Hi ${esc(event.host_first_name)}, your Second Line gallery from your event on ${esc(event.event_date)} has reached its 180-day end. Prints are still available on PicTime:</p>
    <p style="margin:28px 0;">${buttonHtml('Order prints', event.pictime_gallery_url || 'https://smile-nola.com')}</p>
  `);
}

// ---- Send wrappers ----

export async function sendGalleryReady(event: EventRow): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: `Your event gallery is ready — Smile NOLA`,
    html: renderGalleryReadyHtml(event),
  });
}

export async function sendExpiryWarning(event: EventRow, daysLeft: number): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: `Your gallery expires in ${daysLeft} days — Smile NOLA`,
    html: renderExpiryWarningHtml(event, publicBase(), daysLeft),
  });
}

export async function sendExpiredNotice(event: EventRow): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: `Your guest gallery has been archived — Smile NOLA`,
    html: renderExpiredHtml(event),
  });
}
