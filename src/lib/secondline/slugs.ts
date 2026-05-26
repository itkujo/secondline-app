/**
 * Slug generation for Second Line events.
 *
 * Slugs are short, opaque, base32-ish identifiers that appear in every public
 * Second Line URL (/u/<slug>, /w/<slug>, /g/<slug>, /m/<slug>/...). They are
 * the only access control on guest-facing pages (matching Kululu/Memtly) and
 * therefore must be:
 *
 *  - long enough to be infeasible to enumerate (8 chars × 31 alphabet ≈ 2^39)
 *  - readable when printed on signage or read aloud (no 0/O/1/I/l ambiguity)
 *  - case-stable (lowercase only)
 *  - sourced from crypto.randomInt, not Math.random
 */

import { randomInt } from 'node:crypto';

export const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 chars
export const SLUG_LENGTH = 8;

export function generateSlug(): string {
  let s = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    s += SLUG_ALPHABET[randomInt(0, SLUG_ALPHABET.length)];
  }
  return s;
}

const SLUG_RE = new RegExp(`^[${SLUG_ALPHABET}]{${SLUG_LENGTH}}$`);

export function isValidSlugShape(s: unknown): s is string {
  return typeof s === 'string' && SLUG_RE.test(s);
}
