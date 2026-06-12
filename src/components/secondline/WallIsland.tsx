/**
 * Wall island.
 *
 * Single hero element with a 400 ms crossfade between items. Sequential
 * rotation through every known asset, in upload order. New uploads append
 * to the end and are picked up on the next loop pass — no interrupts.
 *
 * Layout rule (spec §5.1):
 *   hero region = viewport minus 25% horizontal / 10% vertical padding;
 *   media renders at its native aspect ratio, sized as large as it can be
 *   while staying fully contained in that region; centered.
 *
 * Background: gradient + slowly upward-scrolling blurred thumbnails (compositor
 * only — transform + opacity, no layout).
 *
 * Resilience: SSE subscribe + browser-native auto-reconnect; on each
 * (re)connect, GET /since?ts=<last-seen> to catch missed assets.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicAsset, SseMessage } from '@/lib/secondline/types';

interface Props {
  slug: string;
  initialAssets: PublicAsset[];
  initialSince: string;
  kiosk: boolean;
  dwellMs?: number;        // per-event admin setting; ms each photo shows
  crossfadeMs?: number;    // per-event admin setting; ms of crossfade
}

const PHOTO_DWELL_MS = 5000;
const VIDEO_MAX_MS = 30_000;
const CROSSFADE_MS = 400;
const CONTROLS_HIDE_MS = 3000;

export default function WallIsland({ slug, initialAssets, initialSince, kiosk,
                                     dwellMs = PHOTO_DWELL_MS, crossfadeMs = CROSSFADE_MS }: Props) {
  const [assets, setAssets] = useState<PublicAsset[]>(initialAssets);
  const [heroIdx, setHeroIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(!kiosk);
  const sinceRef = useRef<string>(initialSince);
  const seenIdsRef = useRef<Set<number>>(new Set(initialAssets.map(a => a.id)));
  const rotationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  // --- SSE + catch-up ---
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    function connect() {
      es = new EventSource(`/api/events/${slug}/stream`);
      es.addEventListener('open', () => { void catchUp(); });
      es.addEventListener('asset.added', e => handleMessage(JSON.parse((e as MessageEvent).data) as SseMessage));
      es.addEventListener('asset.removed', e => handleMessage(JSON.parse((e as MessageEvent).data) as SseMessage));
      es.addEventListener('error', () => {
        // EventSource auto-reconnects. On next open, catchUp() runs again.
      });
    }
    async function catchUp() {
      try {
        const r = await fetch(`/api/events/${slug}/since?ts=${encodeURIComponent(sinceRef.current)}`);
        if (!r.ok) return;
        const body = await r.json() as { assets: PublicAsset[] };
        if (cancelled || !body.assets?.length) return;
        appendAssets(body.assets);
      } catch { /* swallow; SSE will keep us moving */ }
    }
    function handleMessage(m: SseMessage) {
      if (m.type === 'asset.added') appendAssets([m.asset]);
      else if (m.type === 'asset.removed') {
        setAssets(prev => prev.filter(a => a.id !== m.id));
        seenIdsRef.current.delete(m.id);
      }
    }
    function appendAssets(incoming: PublicAsset[]) {
      const fresh = incoming.filter(a => !seenIdsRef.current.has(a.id));
      if (fresh.length === 0) return;
      for (const a of fresh) seenIdsRef.current.add(a.id);
      const last = fresh[fresh.length - 1];
      if (last.uploaded_at > sinceRef.current) sinceRef.current = last.uploaded_at;
      for (const a of fresh) {
        if (a.mime_type.startsWith('image/')) {
          const img = new Image();
          img.src = a.src;
          const th = new Image();
          th.src = a.thumb;
        }
        // Videos pre-cache lazily — too expensive to fetch a 50MB clip just-in-case
      }
      setAssets(prev => [...prev, ...fresh]);
    }
    connect();
    return () => { cancelled = true; es?.close(); };
  }, [slug]);

  // --- Rotation ---
  useEffect(() => {
    if (assets.length === 0) return;
    const current = assets[heroIdx % assets.length];
    let dwell = dwellMs;
    if (current.mime_type.startsWith('video/')) {
      dwell = current.duration_ms ? Math.min(current.duration_ms, VIDEO_MAX_MS) : VIDEO_MAX_MS;
    }
    rotationTimer.current = setTimeout(() => {
      setPrevIdx(heroIdx);
      setHeroIdx(i => (i + 1) % assets.length);
      setTimeout(() => setPrevIdx(null), crossfadeMs);
    }, dwell);
    return () => { if (rotationTimer.current) clearTimeout(rotationTimer.current); };
  }, [heroIdx, assets, dwellMs, crossfadeMs]);

  // --- Controls auto-hide ---
  useEffect(() => {
    if (kiosk) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    function show() {
      setControlsVisible(true);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      }
    }
    window.addEventListener('mousemove', show);
    window.addEventListener('keydown', onKey);
    show();
    return () => {
      window.removeEventListener('mousemove', show);
      window.removeEventListener('keydown', onKey);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [kiosk]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  const hero = assets[heroIdx % assets.length] ?? null;
  const prev = prevIdx != null ? assets[prevIdx % assets.length] : null;
  const bgThumbs = useMemo(() => assets.slice(-24), [assets]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg,#050505 0%,#1a0f1f 50%,#050505 100%)', overflow: 'hidden' }}>
      {/* --- Background scrolling thumbnails --- */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.18, filter: 'blur(36px) saturate(1.4)' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, willChange: 'transform',
                      animation: 'sn-bgscroll 90s linear infinite',
                      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
          {Array.from({ length: 3 }).flatMap((_, dup) =>
            bgThumbs.map(a => (
              <div key={`${dup}-${a.id}`} style={{ aspectRatio: '1 / 1', backgroundImage: `url(${a.thumb})`,
                                                   backgroundSize: 'cover', backgroundPosition: 'center' }} />
            ))
          )}
        </div>
      </div>

      {/* --- Hero region --- */}
      <div style={{ position: 'absolute', inset: 0, padding: '10% 25%', boxSizing: 'border-box',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Absolutely-positioned heroes measure against their containing block's
            PADDING box, which would let large media ignore the 10%/25% spec
            padding and run edge-to-edge. This inner wrapper spans exactly the
            content area so maxWidth/maxHeight:100% means "inside the padding". */}
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {prev && <Hero key={`prev-${prev.id}`} asset={prev} crossfadeMs={crossfadeMs} fadingOut />}
          {hero && <Hero key={`cur-${hero.id}`} asset={hero} crossfadeMs={crossfadeMs} videoRef={heroVideoRef} />}
          {!hero && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', textAlign: 'center', color: '#b8b2a5' }}>
              Waiting for the first upload…
            </div>
          )}
        </div>
      </div>

      {/* --- Controls --- */}
      {!kiosk && (
        <div style={{ position: 'absolute', bottom: 16, right: 16, opacity: controlsVisible ? 1 : 0, transition: 'opacity 300ms', pointerEvents: controlsVisible ? 'auto' : 'none' }}>
          <button onClick={toggleFullscreen}
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#d4af37', border: '1px solid #d4af37',
                           borderRadius: 999, padding: '10px 18px', fontSize: 14, cursor: 'pointer' }}>
            Enter Fullscreen (F)
          </button>
        </div>
      )}

      <style>{`
        @keyframes sn-bgscroll {
          from { transform: translateY(0); }
          to   { transform: translateY(-33.333%); }
        }
      `}</style>
    </div>
  );
}

function Hero({ asset, crossfadeMs, fadingOut, videoRef }: { asset: PublicAsset; crossfadeMs: number; fadingOut?: boolean; videoRef?: React.MutableRefObject<HTMLVideoElement | null> }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    inset: 0, margin: 'auto',          // center within the padded content area
    maxWidth: '100%', maxHeight: '100%',
    objectFit: 'contain',
    opacity: fadingOut ? 0 : 1,
    transition: `opacity ${crossfadeMs}ms ease-in-out`,
    willChange: 'opacity',
  };
  if (asset.mime_type.startsWith('video/')) {
    return (
      <video ref={el => { if (videoRef) videoRef.current = el; }}
             src={asset.src} autoPlay playsInline style={style}
             onCanPlay={e => { (e.target as HTMLVideoElement).play().catch(() => {}); }} />
    );
  }
  return <img src={asset.src} alt="" style={style} />;
}
