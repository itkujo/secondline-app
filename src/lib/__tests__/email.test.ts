import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveFromAddress, sendRawEmail } from '../email';

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

describe('email', () => {
  it('resolveFromAddress uses RESEND_FROM when set', () => {
    process.env.RESEND_FROM = 'Test <test@example.com>';
    expect(resolveFromAddress()).toBe('Test <test@example.com>');
  });

  it('resolveFromAddress falls back to a sane default', () => {
    expect(resolveFromAddress()).toContain('@');
  });

  it('sendRawEmail console-falls-back when no API key, never throws', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(sendRawEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('sendRawEmail returns silently when to is empty', async () => {
    process.env.RESEND_API_KEY = 'fake';
    await expect(sendRawEmail({ to: '', subject: 's', html: 'x' })).resolves.toBeUndefined();
  });
});
