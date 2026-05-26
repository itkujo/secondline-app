/**
 * Gallery island. Grid + click-to-lightbox. No SSE — gallery is post-event
 * read-mostly; a hard refresh covers any late uploads.
 */

import { useState } from 'react';
import type { PublicAsset } from '@/lib/secondline/types';

interface Props { slug: string; initialAssets: PublicAsset[]; }

export default function GalleryIsland({ initialAssets }: Props) {
  const [active, setActive] = useState<PublicAsset | null>(null);

  if (initialAssets.length === 0) {
    return <p style={{ color: '#b8b2a5' }}>No uploads yet.</p>;
  }
  return (
    <>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                   display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
        {initialAssets.map(a => (
          <li key={a.id}>
            <button
              onClick={() => setActive(a)}
              style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', padding: 0, border: 0,
                       background: '#111', borderRadius: 6, cursor: 'zoom-in', overflow: 'hidden' }}>
              <img src={a.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      {active && (
        <div onClick={() => setActive(null)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out', zIndex: 50 }}>
          {active.mime_type.startsWith('video/')
            ? <video src={active.src} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%' }} />
            : <img src={active.src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        </div>
      )}
    </>
  );
}
