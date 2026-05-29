/**
 * Storage backend registry.
 *
 * Loads secondline-backends.json (committed, no secrets) and resolves env
 * vars into a usable StorageBackend with credentials. The registry is the
 * extension point: adding a new backend at v2 = append a JSON entry + add
 * the credential env vars to Coolify. No code change.
 *
 * Lazy-strict semantics: backends whose credential env vars are absent are
 * SKIPPED at load time (with a console.warn) rather than throwing. This lets
 * the same image carry both `wasabi` and `wasabi-staging` entries in JSON
 * while only one set of credentials is provided at runtime. getBackend(id)
 * still throws if you ask for a backend that wasn't successfully loaded —
 * so misconfiguration is still loud at the moment of use, just not at boot.
 *
 * Singleton-with-reset pattern so tests can blow away cache between cases.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEnv } from '@/lib/env';
import type { BackendId, BackendRegistryEntry, StorageBackend } from '../types';

let _cache: Map<BackendId, StorageBackend> | null = null;

function configPath(): string {
  return resolve(process.cwd(), 'secondline-backends.json');
}

export function resetBackendsCache(): void {
  _cache = null;
}

export function loadBackends(): StorageBackend[] {
  if (_cache) return Array.from(_cache.values());

  const raw = readFileSync(configPath(), 'utf8');
  const parsed = JSON.parse(raw) as { backends: BackendRegistryEntry[] };
  if (!Array.isArray(parsed.backends)) {
    throw new Error('secondline-backends.json: expected { backends: [...] }');
  }

  const cache = new Map<BackendId, StorageBackend>();
  for (const entry of parsed.backends) {
    const accessKey = getEnv(entry.access_key_env);
    const secretKey = getEnv(entry.secret_key_env);
    if (!accessKey || !secretKey) {
      console.warn(
        `[secondline] backend "${entry.id}" skipped: missing ${!accessKey ? entry.access_key_env : entry.secret_key_env}`,
      );
      continue;
    }
    cache.set(entry.id, {
      id: entry.id,
      label: entry.label,
      endpoint: entry.endpoint,
      region: entry.region,
      bucket: entry.bucket,
      accessKey,
      secretKey,
      forcePathStyle: !!entry.force_path_style,
    });
  }

  _cache = cache;
  return Array.from(cache.values());
}

export function getBackend(id: BackendId): StorageBackend {
  if (!_cache) loadBackends();
  const b = _cache!.get(id);
  if (!b) {
    throw new Error(
      `Unknown or unconfigured storage backend: ${id} (check that its credential env vars are set)`,
    );
  }
  return b;
}

export function listBackends(): StorageBackend[] {
  return loadBackends();
}
