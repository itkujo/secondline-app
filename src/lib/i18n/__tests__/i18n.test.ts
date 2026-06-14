import { describe, it, expect } from 'vitest';
import {
  detectFromAcceptLanguage,
  readLocaleCookie,
  resolveLocale,
  isLocale,
  getMessages,
  messages,
  LOCALES,
} from '../index';

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://secondline.smile-nola.com/', { headers });
}

describe('isLocale', () => {
  it('accepts only supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('detectFromAcceptLanguage', () => {
  it('picks Spanish from a Spanish-preferring header', () => {
    expect(detectFromAcceptLanguage('es-MX,es;q=0.9,en;q=0.8')).toBe('es');
  });
  it('picks English from an English header', () => {
    expect(detectFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });
  it('honors q-weights over order', () => {
    expect(detectFromAcceptLanguage('en;q=0.5,es;q=0.9')).toBe('es');
  });
  it('returns null for unsupported / empty', () => {
    expect(detectFromAcceptLanguage('fr-FR,de;q=0.8')).toBeNull();
    expect(detectFromAcceptLanguage('')).toBeNull();
    expect(detectFromAcceptLanguage(null)).toBeNull();
  });
});

describe('readLocaleCookie', () => {
  it('reads a valid sl_lang cookie', () => {
    expect(readLocaleCookie(req({ cookie: 'sl_lang=es' }))).toBe('es');
    expect(readLocaleCookie(req({ cookie: 'a=1; sl_lang=en; b=2' }))).toBe('en');
  });
  it('ignores an invalid or absent cookie', () => {
    expect(readLocaleCookie(req({ cookie: 'sl_lang=fr' }))).toBeNull();
    expect(readLocaleCookie(req())).toBeNull();
  });
});

describe('resolveLocale cascade', () => {
  it('uses the toggle cookie above all else', () => {
    const r = req({ cookie: 'sl_lang=en', 'accept-language': 'es-MX' });
    expect(resolveLocale(r, 'es')).toBe('en');
  });
  it('uses the per-event setting over browser auto-detect', () => {
    const r = req({ 'accept-language': 'en-US' });
    expect(resolveLocale(r, 'es')).toBe('es');
  });
  it('falls back to browser auto-detect when no cookie or event', () => {
    const r = req({ 'accept-language': 'es-ES,es;q=0.9' });
    expect(resolveLocale(r, null)).toBe('es');
  });
  it('falls back to English when nothing matches', () => {
    expect(resolveLocale(req(), null)).toBe('en');
    expect(resolveLocale(req({ 'accept-language': 'fr' }), undefined)).toBe('en');
  });
  it('ignores an invalid per-event language', () => {
    const r = req({ 'accept-language': 'en-US' });
    expect(resolveLocale(r, 'fr')).toBe('en');
  });
});

describe('message catalogs', () => {
  it('every locale exposes the same keys', () => {
    const keysOf = (o: object): string[] => Object.keys(o).sort();
    for (const locale of LOCALES) {
      expect(getMessages(locale)).toBe(messages[locale]);
    }
    // Top-level namespaces match between en and es.
    expect(keysOf(messages.en)).toEqual(keysOf(messages.es));
  });
  it('interpolates names', () => {
    expect(messages.es.wall.sharedBy('Ana')).toBe('Compartido por Ana');
    expect(messages.en.wall.sharedBy('Ana')).toBe('Shared by Ana');
  });
});
