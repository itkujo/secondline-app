import { describe, it, expect, afterEach } from 'vitest';
import { getEnv, getRequiredEnv } from '../env';

const KEY = 'SECONDLINE_TEST_ENV_KEY';

afterEach(() => { delete process.env[KEY]; });

describe('env helpers', () => {
  it('getEnv returns the trimmed value when set', () => {
    process.env[KEY] = '  hello  ';
    expect(getEnv(KEY)).toBe('hello');
  });

  it('getEnv returns empty string when unset', () => {
    expect(getEnv(KEY)).toBe('');
  });

  it('getRequiredEnv throws when unset', () => {
    expect(() => getRequiredEnv(KEY)).toThrow(/SECONDLINE_TEST_ENV_KEY/);
  });

  it('getRequiredEnv returns the value when set', () => {
    process.env[KEY] = 'x';
    expect(getRequiredEnv(KEY)).toBe('x');
  });
});
