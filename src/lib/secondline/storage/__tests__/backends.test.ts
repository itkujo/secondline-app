import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadBackends, getBackend, listBackends, resetBackendsCache } from '../backends';

describe('backend registry', () => {
  beforeEach(() => { resetBackendsCache(); });
  afterEach(() => {
    delete process.env.WASABI_ACCESS_KEY;
    delete process.env.WASABI_SECRET_KEY;
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

  it('throws a helpful error when an env credential is missing', () => {
    delete process.env.WASABI_ACCESS_KEY;
    expect(() => loadBackends()).toThrow(/WASABI_ACCESS_KEY/);
  });

  it('throws when looking up an unknown backend id', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    expect(() => getBackend('nope')).toThrow(/nope/);
  });

  it('listBackends returns all loaded entries', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    const all = listBackends();
    expect(all.some(b => b.id === 'wasabi')).toBe(true);
  });
});
