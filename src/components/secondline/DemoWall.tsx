/**
 * Demo wall.
 *
 * A self-contained, marketing-only echo of the real {@link WallIsland}: it
 * loops a fixed set of stock event photos with the same visual language
 * (blurred backdrop crossfade + contained Ken Burns hero + "Shared by"
 * caption + corner badge and scan chip) so the home page can show the product
 * in motion without any event, database, or SSE wiring behind it.
 *
 * Client-only — no SSR/hydration concerns since animation state lives entirely
 * in effects and nothing random is computed during render.
 */

import { useEffect, useRef, useState } from 'react';
import { getMessages, type Locale } from '@/lib/i18n';

interface Props {
  images: string[];
  /** Fake uploader names, cycled with the photos to sell the live-share feel. */
  names?: string[];
  dwellMs?: number;
  crossfadeMs?: number;
  locale?: Locale;
}

const DWELL_MS = 3400;
const CROSSFADE_MS = 800;

export default function DemoWall({ images, names = [], dwellMs = DWELL_MS, crossfadeMs = CROSSFADE_MS, locale = 'en' }: Props) {
  const m = getMessages(locale);
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rotation: advance to the next photo, holding the previous one mounted for
  // the length of the crossfade so both layers can cross-dissolve.
  useEffect(() => {
    if (images.length < 2) return;
    timer.current = setTimeout(() => {
      setPrev(idx);
      setIdx(i => (i + 1) % images.length);
      setTimeout(() => setPrev(null), crossfadeMs);
    }, dwellMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [idx, images.length, dwellMs, crossfadeMs]);

  // Pre-load the upcoming photo so the crossfade never shows a blank frame.
  useEffect(() => {
    if (images.length === 0) return;
    const next = new window.Image();
    next.src = images[(idx + 1) % images.length];
  }, [idx, images]);

  if (images.length === 0) return null;

  const cur = images[idx];
  const prevSrc = prev != null ? images[prev] : null;
  const name = names.length ? names[idx % names.length] : null;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden',
                  background: 'linear-gradient(180deg,#050505 0%,#1a0f1f 50%,#050505 100%)' }}>
      {/* Backdrop: a blurred blow-up of the current photo, crossfading. */}
      {prevSrc && <Backdrop key={`bp-${prev}`} src={prevSrc} crossfadeMs={crossfadeMs} fadingOut />}
      <Backdrop key={`bc-${idx}`} src={cur} crossfadeMs={crossfadeMs} />

      {/* Hero region: padded so media stays clear of the corners/overlays. */}
      <div style={{ position: 'absolute', inset: 0, padding: '7% 9%', boxSizing: 'border-box',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {prevSrc && <Hero key={`hp-${prev}`} src={prevSrc} crossfadeMs={crossfadeMs} dwellMs={dwellMs} fadingOut />}
          <Hero key={`hc-${idx}`} src={cur} crossfadeMs={crossfadeMs} dwellMs={dwellMs} />
          {name && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: '1%', textAlign: 'center',
                          color: '#f8f4ea', fontSize: 'clamp(11px, 1.4vw, 18px)',
                          textShadow: '0 1px 4px rgba(0,0,0,0.85)', opacity: 0.92, pointerEvents: 'none' }}>
              {m.landing.sharedBy(name)}
            </div>
          )}
        </div>
      </div>

      {/* Corner badge — mirrors the live wall's "Made with ♥ Smile NOLA". */}
      <div style={{ position: 'absolute', top: '4%', left: '4%', display: 'flex', alignItems: 'center',
                    gap: '0.45em', background: 'rgba(0,0,0,0.6)', borderRadius: 999,
                    padding: '0.4em 0.9em', fontSize: 'clamp(9px, 1.1vw, 14px)' }}>
        <span style={{ color: '#d4af37', lineHeight: 1 }}>♥</span>
        <span style={{ color: '#f8f4ea', whiteSpace: 'nowrap' }}>{m.common.madeWith}</span>
        <span style={{ color: '#d4af37', fontFamily: 'Georgia, serif', fontWeight: 700, letterSpacing: '0.05em' }}>
          Smile NOLA
        </span>
      </div>

      {/* Scan chip — the live wall's "scan to add photos" call, sized down. */}
      <div style={{ position: 'absolute', bottom: '4%', left: '4%', display: 'flex', alignItems: 'center',
                    gap: '0.6em', background: 'rgba(0,0,0,0.6)', borderRadius: 12,
                    padding: '0.5em 0.7em' }}>
        <div aria-hidden="true" style={{ width: 'clamp(26px, 3.6vw, 46px)', height: 'clamp(26px, 3.6vw, 46px)',
                                         borderRadius: 5, border: '2px solid #d4af37', background: '#fff',
                                         display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
                                         padding: 3, boxSizing: 'border-box' }}>
          {QR_CELLS.map((on, i) => (
            <span key={i} style={{ background: on ? '#0a0a0a' : 'transparent', borderRadius: 0.5 }} />
          ))}
        </div>
        <span style={{ color: '#f8f4ea', fontSize: 'clamp(9px, 1.1vw, 14px)', fontWeight: 600, lineHeight: 1.2 }}>
          {m.landing.demoScan}
        </span>
      </div>

      <style>{`
        @keyframes dw-fade-in  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dw-fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes dw-kenburns { from { scale: 1; } to { scale: 1.07; } }
        @keyframes dw-kenburns-hold { from { scale: 1.07; } to { scale: 1.07; } }
      `}</style>
    </div>
  );
}

// A fixed 4×4 on/off pattern that reads as a QR glyph without being scannable
// (the real wall renders a live QR; here it is pure decoration).
const QR_CELLS = [
  true, true, false, true,
  true, false, true, false,
  false, true, true, true,
  true, false, true, false,
];

function Backdrop({ src, crossfadeMs, fadingOut }: { src: string; crossfadeMs: number; fadingOut?: boolean }) {
  return (
    <div aria-hidden="true"
         style={{ position: 'absolute', inset: 0, backgroundImage: `url(${src})`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  filter: 'blur(42px) brightness(0.45) saturate(1.1)',
                  transform: 'scale(1.12)',
                  opacity: fadingOut ? 0 : 1,
                  transition: `opacity ${crossfadeMs}ms ease-in-out`, willChange: 'opacity' }} />
  );
}

function Hero({ src, crossfadeMs, dwellMs, fadingOut }: {
  src: string; crossfadeMs: number; dwellMs: number; fadingOut?: boolean;
}) {
  const enter = `dw-fade-in ${crossfadeMs}ms ease-in-out both`;
  const exit = `dw-fade-out ${crossfadeMs}ms ease-in-out forwards`;
  const kb = fadingOut
    ? 'dw-kenburns-hold 1ms linear forwards'
    : `dw-kenburns ${dwellMs + crossfadeMs * 2}ms linear forwards`;
  return (
    <img src={src} alt=""
         style={{ position: 'absolute', inset: 0, margin: 'auto',
                  maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                  borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                  animation: `${fadingOut ? exit : enter}, ${kb}`,
                  willChange: 'opacity, transform' }} />
  );
}
