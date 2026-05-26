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

const HEIC_MIMES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

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

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(NAME_STORAGE_KEY, trimmed);

    const newTiles: Tile[] = files.map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      previewUrl: URL.createObjectURL(f),
      state: isHeic(f) ? 'preparing' : 'queued',
      attempt: 0,
    }));
    // Show 'preparing' tile state for the duration of HEIC conversion (if any)
    setTiles(prev => [...newTiles, ...prev]);

    if (fileRef.current) fileRef.current.value = '';

    const sw = swRef.current ?? navigator.serviceWorker.controller;
    if (!sw) {
      setTiles(prev => prev.map(t => newTiles.find(n => n.id === t.id)
        ? { ...t, state: 'failed', error: 'Try again — uploader not ready' }
        : t));
      return;
    }
    for (let i = 0; i < files.length; i++) {
      const tile = newTiles[i];
      try {
        const ready = await maybeConvertHeic(files[i]);
        sw.postMessage({
          type: 'enqueue',
          id: tile.id,
          slug,
          file: ready,
          uploaderName: trimmed || null,
        });
        // SW will broadcast progress events that transition state from
        // 'preparing' → 'uploading' → 'ok'
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
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 13, fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
              {t.state === 'ok' && '✓'}
              {t.state === 'uploading' && '…'}
              {t.state === 'preparing' && 'Preparing…'}
              {t.state === 'queued' && '·'}
              {t.state === 'failed' && '!'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
