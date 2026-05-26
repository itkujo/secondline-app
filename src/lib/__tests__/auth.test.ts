import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  passwordsMatch, issueSessionCookie, clearSessionCookie,
  readSessionCookie, verifyCookie, isAuthed,
  clientIp, rateLimit, loginRateLimit, resetRateLimit,
  COOKIE_NAME,
} from '../auth';

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'correct-horse';
  process.env.ADMIN_SESSION_SECRET = 'test-secret-key-32-bytes-min-okay';
  resetRateLimit();
});

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_SESSION_SECRET;
});

describe('auth', () => {
  it('passwordsMatch true on exact match, false otherwise, constant-time', () => {
    expect(passwordsMatch('correct-horse')).toBe(true);
    expect(passwordsMatch('wrong')).toBe(false);
    expect(passwordsMatch('')).toBe(false);
  });

  it('issueSessionCookie returns a Set-Cookie string with HttpOnly + SameSite + Path', () => {
    const c = issueSessionCookie();
    expect(c).toContain(`${COOKIE_NAME}=`);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=\d+/);
  });

  it('clearSessionCookie returns a Set-Cookie that expires the cookie', () => {
    const c = clearSessionCookie();
    expect(c).toContain(`${COOKIE_NAME}=`);
    expect(c).toMatch(/Max-Age=0/);
  });

  it('verifyCookie accepts a freshly-issued token and rejects tampering', () => {
    const set = issueSessionCookie();
    const value = set.split(';')[0].split('=')[1];
    expect(verifyCookie(value)).toBe(true);
    expect(verifyCookie(value + 'x')).toBe(false);
    expect(verifyCookie('garbage')).toBe(false);
    expect(verifyCookie('')).toBe(false);
  });

  it('readSessionCookie pulls the named cookie out of a header', () => {
    expect(readSessionCookie(`other=1; ${COOKIE_NAME}=abc.def; foo=bar`)).toBe('abc.def');
    expect(readSessionCookie('')).toBeNull();
    expect(readSessionCookie('other=1')).toBeNull();
  });

  it('isAuthed combines readSessionCookie + verifyCookie', () => {
    const set = issueSessionCookie();
    const value = set.split(';')[0].split('=')[1];
    const req = new Request('http://x', { headers: { cookie: `${COOKIE_NAME}=${value}` } });
    expect(isAuthed(req)).toBe(true);
    const reqBad = new Request('http://x', { headers: { cookie: `${COOKIE_NAME}=garbage` } });
    expect(isAuthed(reqBad)).toBe(false);
  });

  it('clientIp prefers X-Forwarded-For first value', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('clientIp falls back to X-Real-IP', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(clientIp(req)).toBe('9.9.9.9');
  });

  it('rateLimit denies after window cap', () => {
    for (let i = 0; i < 3; i++) expect(rateLimit('test', '1.1.1.1', 3, 60_000)).toBe(true);
    expect(rateLimit('test', '1.1.1.1', 3, 60_000)).toBe(false);
    // Different IP unaffected
    expect(rateLimit('test', '2.2.2.2', 3, 60_000)).toBe(true);
  });

  it('loginRateLimit allows 5 then denies', () => {
    for (let i = 0; i < 5; i++) expect(loginRateLimit('1.1.1.1')).toBe(true);
    expect(loginRateLimit('1.1.1.1')).toBe(false);
  });
});
