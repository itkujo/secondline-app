/**
 * Env-var accessors. Centralizes reads from process.env so tests can monkey-
 * patch and so missing-required errors say something useful.
 *
 * Always whitespace-trims. Empty strings are treated as "unset".
 */

export function getEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string') return '';
  return v.trim();
}

export function getRequiredEnv(name: string): string {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
