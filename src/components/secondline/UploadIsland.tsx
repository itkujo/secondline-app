/**
 * Upload island.
 *
 * Behavior:
 *  - File input accepts image/* + video/* and `multiple`
 *  - For each picked file: enqueue to the SW, render a tile that starts as
 *    "Uploading…" and flips to "✓ Uploaded" on the SW's progress message
 *  - Optional name field — saved to localStorage so guests don't retype it
 *  - All UX optimistic; SW handles retries silently
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type TileState = 'queued' | 'preparing' | 'uploading' | 'ok' | 'failed';

interface Tile {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
  state: TileState;
  attempt: number;
  error?: string;
}

interface Props { slug: string; }

const NAME_STORAGE_KEY = 'sn_uploader_name';

const SPINNER_STYLE: React.CSSProperties = {
  width: 22, height: 22, boxSizing: 'border-box', borderRadius: '50%',
  border: '3px solid rgba(255,255,255,0.25)', borderTopColor: '#d4af37',
  animation: 'sn-spin 0.8s linear infinite',
};

const HEIC_MIMES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

// crypto.randomUUID and service workers only exist in secure contexts
// (https or localhost). Guests on a plain-http LAN origin — phone pointed at
// a dev box — get fallbacks: a non-crypto id and a direct fetch() upload.
function newTileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const DIRECT_MAX_RETRIES = 2;
const DIRECT_RETRY_BASE_MS = 1500;

// Mirror of the server caps in media-processing.ts (can't import it here —
// it pulls in sharp). Checked before upload so guests get an instant,
// readable "too large" instead of a slow 413.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

function oversizeError(file: File): string | null {
  const isVideo = file.type.toLowerCase().startsWith('video/');
  const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size <= max) return null;
  return `${isVideo ? 'Video' : 'Photo'} too large (max ${Math.round(max / 1024 / 1024)} MB)`;
}

function isHeic(file: File): boolean {
  if (HEIC_MIMES.has(file.type.toLowerCase())) return true;
  // Some iOS Safari builds set type='' — fall back to extension sniff
  return /\.(heic|heif)$/i.test(file.name);
}

async function maybeConvertHeic(file: File): Promise<File> {
  if (!isHeic(file)) return file;
  // Lazy-load heic2any only when needed — keeps the ~500KB WASM out of
  // the initial bundle for non-iPhone guests.
  const mod = await import('heic2any');
  const heic2any = mod.default;
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  // heic2any returns Blob | Blob[]; flatten if needed
  const out = Array.isArray(blob) ? blob[0] : blob;
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([out], newName, { type: 'image/jpeg', lastModified: file.lastModified });
}

export default function UploadIsland({ slug }: Props) {
  const [name, setName] = useState('');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const swRef = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    setName(localStorage.getItem(NAME_STORAGE_KEY) ?? '');
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker.ready.then(reg => {
      if (cancelled) return;
      swRef.current = reg.active;
    });
    const onMsg = (event: MessageEvent) => {
      const m = event.data;
      if (!m || m.type !== 'progress') return;
      setTiles(prev => prev.map(t => t.id === m.id ? { ...t, state: m.state, attempt: m.attempt, error: m.error } : t));
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', onMsg);
    };
  }, []);

  function setTileState(id: string, state: TileState, error?: string) {
    setTiles(prev => prev.map(t => t.id === id ? { ...t, state, error } : t));
  }

  // Resolve the upload service worker, waiting briefly for first-visit
  // activation. Returns null on insecure contexts (no SW API) — callers
  // fall back to a direct fetch() upload.
  async function getSw(): Promise<ServiceWorker | null> {
    if (!('serviceWorker' in navigator)) return null;
    if (swRef.current) return swRef.current;
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(r => setTimeout(() => r(null), 3000)),
    ]);
    return reg?.active ?? null;
  }

  async function directUpload(id: string, file: File, uploaderName: string) {
    for (let attempt = 0; attempt <= DIRECT_MAX_RETRIES; attempt++) {
      try {
        setTileState(id, 'uploading');
        const form = new FormData();
        form.append('file', file);
        form.append('slug', slug);
        if (uploaderName) form.append('uploader_name', uploaderName);
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        if (res.ok) {
          setTileState(id, 'ok');
          return;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          const body = await res.json().catch(() => null);
          setTileState(id, 'failed', (body && body.error) || `HTTP ${res.status}`);
          return;
        }
      } catch {
        // network error: retry
      }
      if (attempt < DIRECT_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, DIRECT_RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    }
    setTileState(id, 'failed', 'retry-exhausted');
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(NAME_STORAGE_KEY, trimmed);

    const newTiles: Tile[] = files.map(f => {
      const tooBig = oversizeError(f);
      return {
        id: newTileId(),
        name: f.name,
        size: f.size,
        previewUrl: URL.createObjectURL(f),
        state: tooBig ? 'failed' as TileState : isHeic(f) ? 'preparing' as TileState : 'queued' as TileState,
        attempt: 0,
        error: tooBig ?? undefined,
      };
    });
    // Show 'preparing' tile state for the duration of HEIC conversion (if any)
    setTiles(prev => [...newTiles, ...prev]);

    if (fileRef.current) fileRef.current.value = '';

    const sw = await getSw();
    for (let i = 0; i < files.length; i++) {
      const tile = newTiles[i];
      if (tile.state === 'failed') continue; // rejected client-side (too large)
      try {
        const ready = await maybeConvertHeic(files[i]);
        if (sw) {
          sw.postMessage({
            type: 'enqueue',
            id: tile.id,
            slug,
            file: ready,
            uploaderName: trimmed || null,
          });
          // SW will broadcast progress events that transition state from
          // 'preparing' → 'uploading' → 'ok'
        } else {
          void directUpload(tile.id, ready, trimmed);
        }
      } catch (err) {
        console.error('[secondline] HEIC conversion failed', err);
        setTiles(prev => prev.map(t => t.id === tile.id
          ? { ...t, state: 'failed' as TileState, error: 'Couldn\'t prepare this photo' }
          : t));
      }
    }
  }

  const stats = useMemo(() => {
    const ok = tiles.filter(t => t.state === 'ok').length;
    const fail = tiles.filter(t => t.state === 'failed').length;
    const inflight = tiles.length - ok - fail;
    return { ok, fail, inflight };
  }, [tiles]);

  return (
    <div>
      <style>{'@keyframes sn-spin { to { transform: rotate(360deg) } }'}</style>
      <label style={{ display: 'block', fontSize: 13, color: '#b8b2a5', marginBottom: 6 }}>
        Your name (optional)
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="So the couple knows who shared"
          autoComplete="name"
          maxLength={80}
          style={{ display: 'block', width: '100%', padding: '10px 12px', fontSize: 16, borderRadius: 8,
                   border: '1px solid #2a2a2a', background: '#111', color: '#f8f4ea', marginTop: 6 }}
        />
      </label>

      <label
        htmlFor="secondline-file-input"
        style={{ display: 'block', marginTop: 18, padding: '18px 16px', textAlign: 'center',
                 borderRadius: 14, border: '2px dashed #d4af37', color: '#d4af37',
                 fontSize: 18, fontWeight: 600, cursor: 'pointer', background: 'rgba(212,175,55,0.05)' }}>
        Tap to choose photos or videos
      </label>
      <input
        ref={fileRef}
        id="secondline-file-input"
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={onPick}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {tiles.length > 0 && (
        <p style={{ color: '#b8b2a5', fontSize: 13, marginTop: 18 }}>
          {stats.ok} done · {stats.inflight} uploading · {stats.fail} failed
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid',
                   gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
        {tiles.map(t => (
          <li key={t.id} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8,
                                  overflow: 'hidden', background: '#111' }}>
            <img src={t.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover',
                                                    filter: t.state === 'ok' ? 'none' : 'brightness(0.65)' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 6,
                          alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 13, fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
              {t.state === 'ok' && '✓'}
              {(t.state === 'uploading' || t.state === 'queued' || t.state === 'preparing') && (
                <>
                  <span style={SPINNER_STYLE} aria-label="Uploading" role="status" />
                  {t.state === 'preparing' && 'Preparing…'}
                </>
              )}
              {t.state === 'failed' && (
                <span style={{ padding: '0 8px', textAlign: 'center' }}>
                  <span style={{ color: '#e08585', fontSize: 18 }}>!</span>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 500, marginTop: 2 }}>
                    {t.error ?? 'Upload failed'}
                  </span>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
