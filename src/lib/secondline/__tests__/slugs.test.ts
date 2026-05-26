import { describe, it, expect } from 'vitest';
import { generateSlug, SLUG_ALPHABET, SLUG_LENGTH, isValidSlugShape } from '../slugs';

describe('slugs', () => {
  it('generates a slug of exactly SLUG_LENGTH characters', () => {
    const s = generateSlug();
    expect(s).toHaveLength(SLUG_LENGTH);
  });

  it('only uses characters from the safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const s = generateSlug();
      for (const ch of s) {
        expect(SLUG_ALPHABET).toContain(ch);
      }
    }
  });

  it('alphabet excludes visually ambiguous characters', () => {
    expect(SLUG_ALPHABET).not.toMatch(/[0oOilI1]/);
  });

  it('isValidSlugShape accepts well-formed slugs and rejects malformed ones', () => {
    expect(isValidSlugShape('abcd2345')).toBe(true);
    expect(isValidSlugShape('abc')).toBe(false);          // too short
    expect(isValidSlugShape('abcd2345X')).toBe(false);    // too long
    expect(isValidSlugShape('abcd234O')).toBe(false);     // forbidden char (O)
    expect(isValidSlugShape('../../etc')).toBe(false);
    expect(isValidSlugShape('')).toBe(false);
  });
});
