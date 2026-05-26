import { describe, it, expect, vi } from 'vitest';
import { createSseHub } from '../sse';
import type { SseMessage } from '../types';

function makeAsset(id: number) {
  return {
    id, src: `/m/abc/${id}`, thumb: `/m/abc/${id}_thumb`,
    mime_type: 'image/jpeg', width: 100, height: 100,
    duration_ms: null, uploader_name: null, uploaded_at: '2026-05-25T00:00:00Z',
  };
}

describe('SSE hub', () => {
  it('delivers broadcasts only to subscribers of the matching event', () => {
    const hub = createSseHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe(1, a);
    hub.subscribe(2, b);
    const msg: SseMessage = { type: 'asset.added', asset: makeAsset(7), ts: '2026-05-25T00:00:00Z' };
    hub.broadcast(1, msg);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    const payload = a.mock.calls[0][0] as string;
    expect(payload).toContain('event: asset.added');
    expect(payload).toContain('data: ');
    expect(payload).toContain('"id":7');
    expect(payload.endsWith('\n\n')).toBe(true);
  });

  it('unsubscribes cleanly', () => {
    const hub = createSseHub();
    const a = vi.fn();
    const unsub = hub.subscribe(1, a);
    unsub();
    hub.broadcast(1, { type: 'asset.added', asset: makeAsset(1), ts: 't' });
    expect(a).not.toHaveBeenCalled();
  });

  it('drops subscribers whose send throws', () => {
    const hub = createSseHub();
    const bad = vi.fn(() => { throw new Error('socket gone'); });
    const good = vi.fn();
    hub.subscribe(1, bad);
    hub.subscribe(1, good);
    hub.broadcast(1, { type: 'asset.added', asset: makeAsset(1), ts: 't' });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    hub.broadcast(1, { type: 'asset.added', asset: makeAsset(2), ts: 't' });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(2);
  });

  it('formats SSE lines correctly', () => {
    const hub = createSseHub();
    const a = vi.fn();
    hub.subscribe(1, a);
    hub.broadcast(1, { type: 'asset.removed', id: 9, ts: '2026-05-25T00:00:00Z' });
    const payload = a.mock.calls[0][0] as string;
    const lines = payload.split('\n');
    expect(lines[0]).toBe('event: asset.removed');
    expect(lines[1].startsWith('data: ')).toBe(true);
    expect(JSON.parse(lines[1].slice('data: '.length))).toMatchObject({ type: 'asset.removed', id: 9 });
  });
});
