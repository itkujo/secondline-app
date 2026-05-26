/**
 * Resend wrapper. One-call surface: sendRawEmail({to, subject, html}).
 *
 * If RESEND_API_KEY is not set, falls back to console.info — never throws.
 * That way local dev and broken-prod-config both degrade gracefully instead
 * of taking down the request that triggered the email.
 */

import { Resend } from 'resend';
import { getEnv } from './env';

const DEFAULT_FROM = 'Smile NOLA <hello@smile-nola.com>';

let _client: Resend | null = null;

export function getResendClient(): Resend | null {
  const key = getEnv('RESEND_API_KEY');
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

export function resolveFromAddress(): string {
  return getEnv('RESEND_FROM') || DEFAULT_FROM;
}

export interface RawEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendRawEmail(input: RawEmailInput): Promise<void> {
  if (!input.to) return;
  const client = getResendClient();
  const from = input.from || resolveFromAddress();
  if (!client) {
    console.info('[email] (fallback) would send', { from, to: input.to, subject: input.subject });
    return;
  }
  try {
    await client.emails.send({ from, to: input.to, subject: input.subject, html: input.html });
  } catch (err) {
    console.error('[email] sendRawEmail failed', err);
  }
}

/** Test-only: reset the cached client. */
export function __resetEmailClient(): void {
  _client = null;
}
