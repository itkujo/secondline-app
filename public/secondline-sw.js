/**
 * Second Line upload retry service worker.
 *
 * Receives upload jobs from the upload page via postMessage, executes
 * fetch() with exponential backoff, and reports back to all clients of
 * this SW with the final outcome. Survives page navigation and tab
 * close — the SW keeps running long enough to drain its queue.
 *
 * No Workbox. ~80 LOC of vanilla SW.
 *
 * Message protocol (page -> SW):
 *   { type: 'enqueue', id, slug, file, uploaderName }
 *
 * Message protocol (SW -> page):
 *   { type: 'progress', id, state: 'queued'|'uploading'|'ok'|'failed', attempt, error? }
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const MAX_RETRIES = 6;
const RETRY_BASE_MS = 1500;

self.addEventListener('message', async (event) => {
  const data = event.data || {};
  if (data.type !== 'enqueue') return;
  const { id, slug, file, uploaderName } = data;
  broadcast({ type: 'progress', id, state: 'queued', attempt: 0 });
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      broadcast({ type: 'progress', id, state: 'uploading', attempt });
      const form = new FormData();
      form.append('file', file);
      form.append('slug', slug);
      if (uploaderName) form.append('uploader_name', uploaderName);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (res.ok) {
        broadcast({ type: 'progress', id, state: 'ok', attempt });
        return;
      }
      const status = res.status;
      // 4xx (other than 408/429) = client error; do not retry
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        const body = await safeJson(res);
        broadcast({ type: 'progress', id, state: 'failed', attempt, error: (body && body.error) || ('HTTP ' + status) });
        return;
      }
      // else retry
    } catch (err) {
      // network error: retry
    }
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
    }
  }
  broadcast({ type: 'progress', id, state: 'failed', attempt: MAX_RETRIES, error: 'retry-exhausted' });
});

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(msg);
}
async function safeJson(res) { try { return await res.json(); } catch { return null; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
