/**
 * Storage backend registry.
 *
 * Loads secondline-backends.json (committed, no secrets) and resolves env
 * vars into a usable StorageBackend with credentials. The registry is the
 * extension point: adding a new backend at v2 = append a JSON entry + add
 * the credential env vars to Coolify. No code change.
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
    if (!accessKey) throw new Error(`Backend ${entry.id}: missing env var ${entry.access_key_env}`);
    if (!secretKey) throw new Error(`Backend ${entry.id}: missing env var ${entry.secret_key_env}`);
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
  if (!b) throw new Error(`Unknown storage backend: ${id}`);
  return b;
}

export function listBackends(): StorageBackend[] {
  return loadBackends();
}
