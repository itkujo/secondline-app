/**
 * Upload island.
 *
 * Behavior:
 *  - File input accepts image/* + video/* and `multiple`
 *  - For each picked file: (optionally convert HEIC →) upload via XHR with a
 *    real, byte-level progress bar per tile, retrying transient failures
 *  - Optional name field — saved to localStorage so guests don't retype it
 *
 * Why XHR, not the service worker: real upload progress requires
 * XMLHttpRequest's `upload.onprogress` (fetch exposes no upload progress, and
 * service workers can't use XHR). So the upload runs here in the page. XHR also
 * works on insecure origins, so no secure-context fallback is needed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type TileState = 'preparing' | 'uploading' | 'ok' | 'failed';

interface Tile {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
  state: TileState;
  progress: number;        // 0..1, byte-level upload progress (uploading state)
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

const MAX_RETRIES = 4;
const RETRY_BASE_MS = 1500;

// Mirror of the server caps in media-processing.ts (can't import it here —
// it pulls in sharp). Checked before upload so guests get an instant,
// readable "too large" instead of a slow 413.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// crypto.randomUUID only exists in secure contexts; fall back for plain-http
// LAN origins (a phone pointed at a dev box).
function newTileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

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
  const out = Array.isArray(blob) ? blob[0] : blob;
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([out], newName, { type: 'image/jpeg', lastModified: file.lastModified });
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Build identifier, surfaced in the support panel. Injected at build via the
// Dockerfile's PUBLIC_GIT_SHA (currently 'dev' until Coolify passes the SHA).
const BUILD_SHA = (import.meta.env as Record<string, string | undefined>).PUBLIC_GIT_SHA ?? 'dev';

// Per-device support code shown in the "Trouble uploading?" panel and sent with
// every upload, so a guest's failure can be found in the server logs by ref.
const SUPPORT_CODE_KEY = 'sn_support_code';
const SUPPORT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars — read aloud over the phone
function makeSupportCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += SUPPORT_ALPHABET[Math.floor(Math.random() * SUPPORT_ALPHABET.length)];
  return `SL-${s}`;
}

interface ErrLogEntry { at: string; file: string; status: number; error: string; attempts: number }

interface UploadError { status: number; error: string }

// Single XHR POST with byte-level upload progress. Rejects with {status,error}
// so the retry layer can decide whether the failure is retryable.
function xhrUpload(
  file: File, slug: string, uploaderName: string, supportCode: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let error = `HTTP ${xhr.status}`;
      try { const b = JSON.parse(xhr.responseText); if (b && b.error) error = b.error; } catch { /* keep default */ }
      reject({ status: xhr.status, error } as UploadError);
    };
    xhr.onerror = () => reject({ status: 0, error: 'Network error' } as UploadError);
    xhr.ontimeout = () => reject({ status: 0, error: 'Timed out' } as UploadError);
    const form = new FormData();
    form.append('file', file);
    form.append('slug', slug);
    if (uploaderName) form.append('uploader_name', uploaderName);
    if (supportCode) form.append('support_code', supportCode);
    xhr.send(form);
  });
}

function isRetryable(status: number): boolean {
  // network/timeout (0), or 5xx, or the two retryable 4xx
  return status === 0 || status >= 500 || status === 408 || status === 429;
}

export default function UploadIsland({ slug }: Props) {
  const [name, setName] = useState('');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [errorLog, setErrorLog] = useState<ErrLogEntry[]>([]);
  const [supportCode, setSupportCode] = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const supportRef = useRef('');

  useEffect(() => {
    setName(localStorage.getItem(NAME_STORAGE_KEY) ?? '');
    let code = '';
    try { code = localStorage.getItem(SUPPORT_CODE_KEY) ?? ''; } catch { /* private mode */ }
    if (!code) {
      code = makeSupportCode();
      try { localStorage.setItem(SUPPORT_CODE_KEY, code); } catch { /* ignore */ }
    }
    supportRef.current = code;
    setSupportCode(code);
  }, []);

  function patchTile(id: string, patch: Partial<Tile>) {
    setTiles(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }

  async function uploadWithRetry(id: string, file: File, uploaderName: string) {
    let lastErr: UploadError = { status: 0, error: 'Upload failed' };
    let attemptsMade = 0;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      attemptsMade = attempt + 1;
      try {
        patchTile(id, { state: 'uploading', progress: 0, attempt, error: undefined });
        let lastPct = -1;
        await xhrUpload(file, slug, uploaderName, supportRef.current, (frac) => {
          // Only re-render when the rounded percent actually changes.
          const pct = Math.round(frac * 100);
          if (pct !== lastPct) { lastPct = pct; patchTile(id, { progress: frac }); }
        });
        patchTile(id, { state: 'ok', progress: 1 });
        return;
      } catch (e) {
        lastErr = (e as UploadError) ?? lastErr;
        if (!isRetryable(lastErr.status) || attempt === MAX_RETRIES) break;
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    }
    const tileErr = lastErr.status ? `${lastErr.error} (${lastErr.status})` : lastErr.error;
    patchTile(id, { state: 'failed', error: tileErr });
    setErrorLog(prev => [
      { at: new Date().toISOString(), file: file.name, status: lastErr.status, error: lastErr.error, attempts: attemptsMade },
      ...prev,
    ].slice(0, 20));
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
        state: tooBig ? 'failed' : isHeic(f) ? 'preparing' : 'uploading',
        progress: 0,
        attempt: 0,
        error: tooBig ?? undefined,
      };
    });
    setTiles(prev => [...newTiles, ...prev]);
    if (fileRef.current) fileRef.current.value = '';

    for (let i = 0; i < files.length; i++) {
      const tile = newTiles[i];
      if (tile.state === 'failed') continue; // rejected client-side (too large)
      try {
        const ready = await maybeConvertHeic(files[i]);
        await uploadWithRetry(tile.id, ready, trimmed);
      } catch (err) {
        console.error('[secondline] HEIC conversion failed', err);
        patchTile(tile.id, { state: 'failed', error: "Couldn't prepare this photo" });
      }
    }
  }

  const stats = useMemo(() => {
    const ok = tiles.filter(t => t.state === 'ok').length;
    const fail = tiles.filter(t => t.state === 'failed').length;
    const inflight = tiles.length - ok - fail;
    return { ok, fail, inflight };
  }, [tiles]);

  // A plain-text dump the guest can read to the host or copy/send to support.
  function buildDiagnostics(): string {
    const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType;
    const lines = [
      'Second Line — upload diagnostics',
      `Support code: ${supportCode || '(generating…)'}`,
      `Time: ${new Date().toISOString()}`,
      `Event: ${slug}`,
      `Result: ${stats.ok} uploaded, ${stats.fail} failed, ${stats.inflight} in progress`,
      `Online: ${navigator.onLine ? 'yes' : 'no'}${conn ? ` (${conn})` : ''}`,
      `Build: ${BUILD_SHA}`,
      `Device: ${navigator.userAgent}`,
    ];
    if (errorLog.length) {
      lines.push('Recent errors:');
      for (const e of errorLog) {
        lines.push(`- ${e.at} · ${e.file} · ${e.error}${e.status ? ` (HTTP ${e.status})` : ''} · ${e.attempts} ${e.attempts === 1 ? 'try' : 'tries'}`);
      }
    }
    return lines.join('\n');
  }

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(buildDiagnostics());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (insecure origin / older browser) — the
      // read-only textarea below is the manual fallback.
      setCopied(false);
    }
  }

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
        {tiles.map(t => {
          const pct = Math.round(t.progress * 100);
          return (
            <li key={t.id} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8,
                                    overflow: 'hidden', background: '#111' }}>
              <img src={t.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover',
                                                      filter: t.state === 'ok' ? 'none' : 'brightness(0.6)' }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 6,
                            alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontSize: 13, fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                {t.state === 'ok' && <span style={{ fontSize: 22 }}>✓</span>}
                {t.state === 'preparing' && (
                  <>
                    <span style={SPINNER_STYLE} aria-label="Preparing" role="status" />
                    <span style={{ fontSize: 11, fontWeight: 600 }}>Preparing…</span>
                  </>
                )}
                {t.state === 'uploading' && (
                  <span style={{ fontSize: 15, fontWeight: 700 }} aria-label={`Uploading ${pct}%`} role="status">
                    {pct}%
                    {t.attempt > 0 && (
                      <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: '#e0c074' }}>
                        retry {t.attempt}
                      </span>
                    )}
                  </span>
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

              {/* Real progress bar pinned to the bottom of the tile. */}
              {t.state === 'uploading' && (
                <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5,
                                                 background: 'rgba(0,0,0,0.45)' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: '#d4af37',
                                transition: 'width 0.15s linear' }} />
                </div>
              )}

              {/* Size label, bottom-left, for a little more at-a-glance info. */}
              {t.state !== 'failed' && (
                <span style={{ position: 'absolute', left: 4, top: 4, fontSize: 10, fontWeight: 600, color: '#fff',
                               background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: '1px 5px',
                               textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                  {humanSize(t.size)}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Support panel — collapsed by default; gives a guest (and whoever they
          call for help) a copyable snapshot plus a support code that also
          appears in the server logs. */}
      <details style={{ marginTop: 26, borderTop: '1px solid #2a2a2a', paddingTop: 14 }}>
        <summary style={{ cursor: 'pointer', color: '#b8b2a5', fontSize: 13, userSelect: 'none' }}>
          Trouble uploading?
        </summary>
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#b8b2a5' }}>
            Read the host your support code, or tap Copy and send the details:
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#b8b2a5' }}>
            Support code:{' '}
            <strong style={{ color: '#d4af37', fontSize: 17, letterSpacing: '0.1em' }}>{supportCode || '…'}</strong>
          </p>
          <textarea
            readOnly
            value={buildDiagnostics()}
            onFocus={e => e.currentTarget.select()}
            style={{ width: '100%', minHeight: 132, boxSizing: 'border-box', resize: 'vertical',
                     fontSize: 11, lineHeight: 1.5, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                     color: '#cfc9bd', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 8, padding: 10 }}
          />
          <button
            type="button"
            onClick={copyDiagnostics}
            style={{ marginTop: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                     borderRadius: 999, border: '1px solid #d4af37', background: 'transparent', color: '#d4af37' }}>
            {copied ? 'Copied ✓' : 'Copy for support'}
          </button>
        </div>
      </details>
    </div>
  );
}
