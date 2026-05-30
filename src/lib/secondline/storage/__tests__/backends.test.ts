import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadBackends, getBackend, listBackends, resetBackendsCache } from '../backends';

describe('backend registry', () => {
  beforeEach(() => {
    resetBackendsCache();
    // Silence the expected "wasabi-staging skipped" warn that fires in every
    // test where the staging env vars aren't set. Tests that assert on warn
    // explicitly re-spy below.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.WASABI_ACCESS_KEY;
    delete process.env.WASABI_SECRET_KEY;
    delete process.env.WASABI_STAGING_ACCESS_KEY;
    delete process.env.WASABI_STAGING_SECRET_KEY;
    vi.restoreAllMocks();
  });

  it('loads the wasabi entry from secondline-backends.json', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    const backends = loadBackends();
    expect(backends.length).toBeGreaterThan(0);
    const wasabi = getBackend('wasabi');
    expect(wasabi.id).toBe('wasabi');
    expect(wasabi.endpoint).toContain('wasabisys.com');
    expect(wasabi.accessKey).toBe('AK');
    expect(wasabi.secretKey).toBe('SK');
    expect(wasabi.forcePathStyle).toBe(false);
  });

  it('skips backends whose credentials are missing, instead of throwing', () => {
    // Provide only the prod creds. The staging entry in JSON should be
    // silently skipped (with a warn) so the same image can ship with both
    // entries but be configured for only one environment.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    const all = loadBackends();
    expect(all.some(b => b.id === 'wasabi')).toBe(true);
    expect(all.some(b => b.id === 'wasabi-staging')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/wasabi-staging.*WASABI_STAGING_ACCESS_KEY/));
  });

  it('loads both prod and staging when both sets of creds are set', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    process.env.WASABI_STAGING_ACCESS_KEY = 'AK2';
    process.env.WASABI_STAGING_SECRET_KEY = 'SK2';
    const all = loadBackends();
    expect(all.some(b => b.id === 'wasabi')).toBe(true);
    expect(all.some(b => b.id === 'wasabi-staging')).toBe(true);
    expect(getBackend('wasabi-staging').bucket).toBe('secondline-app');
  });

  it('throws when looking up a backend that was not loaded (unknown or unconfigured)', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    expect(() => getBackend('nope')).toThrow(/nope/);
    // Also: asking for staging when its env is unset should throw with a
    // hint about credentials, since it was skipped at load time.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => getBackend('wasabi-staging')).toThrow(/credential env vars/);
  });

  it('listBackends returns all loaded entries', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    const all = listBackends();
    expect(all.some(b => b.id === 'wasabi')).toBe(true);
  });
});
