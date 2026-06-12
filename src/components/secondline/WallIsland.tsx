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
  videoMaxMs?: number;     // per-event admin setting; video playback cap
  videoFull?: boolean;     // per-event admin setting; play videos to the end
  hideBg?: boolean;        // per-event admin setting; hide side images
  hideCaption?: boolean;   // per-event admin setting; hide uploader captions
  transition?: string;     // per-event admin setting; hero transition style
  bgUrl?: string | null;   // per-event admin setting; custom backdrop image
}

// Hero enter/exit keyframe pairs, keyed by the wall_transition setting.
// kenburns is crossfade plus a slow scale across the dwell (images only).
const TRANSITION_ANIMS: Record<string, { enter: string; exit: string }> = {
  crossfade: { enter: 'sn-fade-in', exit: 'sn-fade-out' },
  slide: { enter: 'sn-slide-in', exit: 'sn-slide-out' },
  zoom: { enter: 'sn-zoom-in', exit: 'sn-zoom-out' },
  kenburns: { enter: 'sn-fade-in', exit: 'sn-fade-out' },
};

const PHOTO_DWELL_MS = 5000;
const VIDEO_MAX_MS = 30_000;
const CROSSFADE_MS = 400;
const CONTROLS_HIDE_MS = 3000;
// videoFull plays to the video's `ended` event; this timer is only the
// safety net for stalled/broken streams so the wall can never freeze.
const VIDEO_FULL_FAILSAFE_MS = 10 * 60_000;

export default function WallIsland({ slug, initialAssets, initialSince, kiosk,
                                     dwellMs = PHOTO_DWELL_MS, crossfadeMs = CROSSFADE_MS,
                                     videoMaxMs = VIDEO_MAX_MS, videoFull = false,
                                     hideBg = false, hideCaption = false,
                                     transition = 'crossfade', bgUrl = null }: Props) {
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
  function advance() {
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
    setPrevIdx(heroIdx);
    setHeroIdx(i => (i + 1) % assets.length);
    setTimeout(() => setPrevIdx(null), crossfadeMs);
  }

  useEffect(() => {
    if (assets.length === 0) return;
    const current = assets[heroIdx % assets.length];
    let dwell = dwellMs;
    if (current.mime_type.startsWith('video/')) {
      // duration_ms is null in v1 (no server-side probe), so the cap is the
      // effective dwell; with videoFull the <video>'s ended/error events
      // advance instead and the timer is just a failsafe.
      dwell = videoFull
        ? VIDEO_FULL_FAILSAFE_MS
        : (current.duration_ms ? Math.min(current.duration_ms, videoMaxMs) : videoMaxMs);
    }
    rotationTimer.current = setTimeout(advance, dwell);
    return () => { if (rotationTimer.current) clearTimeout(rotationTimer.current); };
  }, [heroIdx, assets, dwellMs, crossfadeMs, videoMaxMs, videoFull]);

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
      {/* --- Backdrop: a host-supplied image when set, otherwise a blurred
             blow-up of the current photo crossfading with the hero (Kululu
             behavior). Thumbs are plenty at 48px blur. --- */}
      {bgUrl ? (
        <div aria-hidden="true"
             style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bgUrl})`,
                      backgroundSize: 'cover', backgroundPosition: 'center',
                      filter: 'brightness(0.55)' }} />
      ) : (
        <>
          {prev?.mime_type.startsWith('image/') && <Backdrop key={`bp-${prev.id}`} thumb={prev.thumb} crossfadeMs={crossfadeMs} fadingOut />}
          {hero?.mime_type.startsWith('image/') && <Backdrop key={`bc-${hero.id}`} thumb={hero.thumb} crossfadeMs={crossfadeMs} />}
        </>
      )}

      {/* --- Side images: floating photo cards drifting up the side gutters.
             The admin "Hide side images" toggle removes them. --- */}
      {!hideBg && (
        <>
          <SideCards side="left" thumbs={bgThumbs} />
          <SideCards side="right" thumbs={bgThumbs} />
        </>
      )}

      {/* --- Hero region --- */}
      <div style={{ position: 'absolute', inset: 0, padding: '2% 17%', boxSizing: 'border-box',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Absolutely-positioned heroes measure against their containing block's
            PADDING box, which would let large media ignore the 10%/25% spec
            padding and run edge-to-edge. This inner wrapper spans exactly the
            content area so maxWidth/maxHeight:100% means "inside the padding". */}
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {prev && <Hero key={`prev-${prev.id}`} asset={prev} crossfadeMs={crossfadeMs} transition={transition}
                         dwellMs={dwellMs} fadingOut />}
          {hero && <Hero key={`cur-${hero.id}`} asset={hero} crossfadeMs={crossfadeMs} transition={transition}
                         dwellMs={dwellMs} videoRef={heroVideoRef}
                         onVideoDone={videoFull ? advance : undefined} />}
          {!hero && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', textAlign: 'center', color: '#b8b2a5' }}>
              Waiting for the first upload…
            </div>
          )}
          {hero?.uploader_name && !hideCaption && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: '2%', textAlign: 'center',
                          color: '#f8f4ea', fontSize: 'clamp(14px, 1.6vw, 22px)',
                          textShadow: '0 1px 4px rgba(0,0,0,0.8)', opacity: 0.9,
                          transition: `opacity ${crossfadeMs}ms ease-in-out`, pointerEvents: 'none' }}>
              Shared by {hero.uploader_name}
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
        @keyframes sn-fade-in  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sn-fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes sn-slide-in  { from { opacity: 0; translate: 6% 0; } to { opacity: 1; translate: 0 0; } }
        @keyframes sn-slide-out { from { opacity: 1; translate: 0 0; } to { opacity: 0; translate: -6% 0; } }
        @keyframes sn-zoom-in  { from { opacity: 0; scale: 1.1; } to { opacity: 1; scale: 1; } }
        @keyframes sn-zoom-out { from { opacity: 1; scale: 1; } to { opacity: 0; scale: 0.94; } }
        @keyframes sn-kenburns { from { scale: 1; } to { scale: 1.08; } }
        @keyframes sn-kenburns-hold { from { scale: 1.08; } to { scale: 1.08; } }
      `}</style>
    </div>
  );
}

function Backdrop({ thumb, crossfadeMs, fadingOut }: { thumb: string; crossfadeMs: number; fadingOut?: boolean }) {
  return (
    <div aria-hidden="true"
         style={{ position: 'absolute', inset: 0, backgroundImage: `url(${thumb})`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  filter: 'blur(48px) brightness(0.45) saturate(1.1)',
                  transform: 'scale(1.12)',     // hide the blur's edge vignette
                  opacity: fadingOut ? 0 : 1,
                  transition: `opacity ${crossfadeMs}ms ease-in-out`, willChange: 'opacity' }} />
  );
}

// Deterministic per-asset variation (NOT Math.random — the island is
// SSR-rendered then hydrated, and random values would mismatch).
function vary(id: number, salt: number, min: number, max: number): number {
  const h = (id * 2654435761 + salt * 97) >>> 0;
  return min + (h % 1000) / 1000 * (max - min);
}

function SideCards({ side, thumbs }: { side: 'left' | 'right'; thumbs: PublicAsset[] }) {
  if (thumbs.length === 0) return null;
  const ordered = side === 'right' ? [...thumbs].reverse() : thumbs;
  return (
    <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, [side]: 0, width: '12%',
                                     overflow: 'hidden', pointerEvents: 'none' }}>
      {/* Content is tripled and the keyframe travels -33.333%, so the upward
          drift loops seamlessly. Varied card sizes, gaps, and horizontal
          offsets read as individually floating photos (Kululu look). */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, willChange: 'transform',
                    animation: `sn-bgscroll ${side === 'left' ? 75 : 95}s linear infinite`,
                    display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: 3 }).flatMap((_, dup) =>
          ordered.map((a, i) => (
            <div key={`${dup}-${a.id}`}
                 style={{ width: `${Math.round(vary(a.id, 1, 48, 78))}%`,
                          aspectRatio: vary(a.id, 2, 0, 1) > 0.5 ? '1 / 1' : '3 / 4',
                          marginTop: `${Math.round(vary(a.id, 3, 36, 130))}px`,
                          marginLeft: vary(a.id + i, 4, 0, 1) > 0.5 ? 'auto' : `${Math.round(vary(a.id, 5, 4, 16))}%`,
                          marginRight: vary(a.id + i, 4, 0, 1) > 0.5 ? `${Math.round(vary(a.id, 5, 4, 16))}%` : undefined,
                          backgroundImage: `url(${a.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center',
                          borderRadius: 10, boxShadow: '0 4px 14px rgba(0,0,0,0.55)' }} />
          ))
        )}
      </div>
    </div>
  );
}

function Hero({ asset, crossfadeMs, transition, dwellMs, fadingOut, videoRef, onVideoDone }: {
  asset: PublicAsset; crossfadeMs: number; transition: string; dwellMs: number; fadingOut?: boolean;
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  onVideoDone?: () => void;   // set when videos play full-length: advance on ended/error
}) {
  const anims = TRANSITION_ANIMS[transition] ?? TRANSITION_ANIMS.crossfade;
  const isImage = asset.mime_type.startsWith('image/');
  // Keyframes use the standalone `translate`/`scale` properties (not
  // `transform`) so the kenburns scale composes with the enter fade.
  let animation = fadingOut
    ? `${anims.exit} ${crossfadeMs}ms ease-in-out forwards`
    : `${anims.enter} ${crossfadeMs}ms ease-in-out both`;
  if (transition === 'kenburns' && isImage) {
    // Exiting heroes hold the end scale — without this the photo would snap
    // back to scale 1 for its fade-out.
    animation += fadingOut
      ? `, sn-kenburns-hold 1ms linear forwards`
      : `, sn-kenburns ${dwellMs + crossfadeMs * 2}ms linear forwards`;
  }
  const style: React.CSSProperties = {
    position: 'absolute',
    inset: 0, margin: 'auto',          // center within the padded content area
    maxWidth: '100%', maxHeight: '100%',
    objectFit: 'contain',
    borderRadius: 10,
    boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
    animation,
    willChange: 'opacity, transform',
  };
  if (asset.mime_type.startsWith('video/')) {
    return (
      <video ref={el => { if (videoRef) videoRef.current = el; }}
             src={asset.src} autoPlay playsInline style={style}
             onCanPlay={e => { (e.target as HTMLVideoElement).play().catch(() => {}); }}
             onEnded={fadingOut ? undefined : onVideoDone}
             onError={fadingOut ? undefined : onVideoDone} />
    );
  }
  return <img src={asset.src} alt="" style={style} />;
}
