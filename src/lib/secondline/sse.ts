/**
 * In-process SSE hub for Second Line walls.
 *
 * One hub per Node process (the app runs as a single container). Subscribers
 * register a write callback; broadcast formats SSE lines and writes to every
 * live subscriber. Any subscriber whose send throws is dropped — there's no
 * recovery, the client reconnects via the browser's native EventSource retry.
 *
 * No persistent buffer here: the SSE stream's GET handler is responsible for
 * sending an initial backfill from the DB (via assets.listAssetsSince) when a
 * client (re)connects with ?since=<ts>. The hub only handles live broadcasts
 * after that point.
 */

import type { SseMessage } from './types';

export type SseSendFn = (chunk: string) => void;

export interface SseHub {
  subscribe(eventId: number, send: SseSendFn): () => void;
  broadcast(eventId: number, msg: SseMessage): void;
  subscriberCount(eventId: number): number;
}

export function createSseHub(): SseHub {
  const subs = new Map<number, Set<SseSendFn>>();

  function subscribe(eventId: number, send: SseSendFn): () => void {
    let set = subs.get(eventId);
    if (!set) { set = new Set(); subs.set(eventId, set); }
    set.add(send);
    return () => {
      const s = subs.get(eventId);
      if (s) {
        s.delete(send);
        if (s.size === 0) subs.delete(eventId);
      }
    };
  }

  function broadcast(eventId: number, msg: SseMessage): void {
    const set = subs.get(eventId);
    if (!set) return;
    const line = formatSse(msg);
    const dead: SseSendFn[] = [];
    for (const send of set) {
      try { send(line); } catch { dead.push(send); }
    }
    for (const d of dead) set.delete(d);
    if (set.size === 0) subs.delete(eventId);
  }

  function subscriberCount(eventId: number): number {
    return subs.get(eventId)?.size ?? 0;
  }

  return { subscribe, broadcast, subscriberCount };
}

function formatSse(msg: SseMessage): string {
  return `event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`;
}

// Process-singleton hub. Reset via __resetSseHub for tests.
let _hub: SseHub | null = null;
export function getSseHub(): SseHub {
  if (!_hub) _hub = createSseHub();
  return _hub;
}
export function __resetSseHub(): void { _hub = null; }
