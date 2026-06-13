# Second Line

Live event photo & video wall. Guests scan a QR code, upload from their phone,
their content appears on a display at the venue in near real time. After the
event, the host gets a downloadable album.

Standalone Astro 5 SSR app, designed for single-tenant deployment via Coolify.

- **Design spec:** [docs/specs/2026-05-25-second-line-design.md](docs/specs/2026-05-25-second-line-design.md)
- **Implementation plan:** [docs/plans/2026-05-25-second-line.md](docs/plans/2026-05-25-second-line.md)

## Quickstart

```sh
pnpm install
cp .env.example .env  # fill in ADMIN_PASSWORD, ADMIN_SESSION_SECRET, etc.
pnpm dev
```

App boots on http://localhost:4321 (or PORT if set).

## Commands

- `pnpm dev` — dev server
- `pnpm build` — production build
- `pnpm start` — run production build
- `pnpm typecheck` — `astro check`
- `pnpm test` — `vitest run`

## Guest uploads & troubleshooting

Guests scan the QR on the wall (or on table cards), which opens `/u/<slug>` — a
React island ([`UploadIsland`](src/components/secondline/UploadIsland.tsx)) that
posts each file to [`/api/upload`](src/pages/api/upload.ts). The endpoint
processes images (sharp: EXIF auto-rotate + thumbnail), stores the original and
thumbnail in the event's S3 bucket (Wasabi), records a row in SQLite, and
broadcasts the new asset to the live wall over SSE. iPhone HEIC photos are
converted to JPEG **in the browser** (heic2any) before upload.

### Upload UX

- **Real progress bars.** Each file uploads via `XMLHttpRequest`, so the tile
  shows true byte-level progress. (We use XHR rather than `fetch` because fetch
  exposes no upload progress — so the upload runs in the page, not the retry
  service worker, which is now unused.)
- **Automatic retries.** Transient failures (network drop, HTTP 5xx/408/429)
  retry with exponential backoff, up to 5 attempts; the tile shows `retry N`.
  Real client errors (too large, unsupported type) fail immediately.
- **Clear failures.** A failed tile shows the message and HTTP status, e.g.
  `Internal error (500)`.

### "Trouble uploading?" — the support flow

Every upload page has a collapsible **Trouble uploading?** panel at the bottom.
It shows a per-device **support code** like `SL-XVA5` plus copyable diagnostics
(device, browser, connection, event, build, recent errors). The same support
code is sent with every upload and written to the server logs on any failure.

**To troubleshoot a guest's problem:**

1. Ask the guest to open **Trouble uploading?** and read you their support code
   (or tap **Copy for support** and send you the text).
2. In the Coolify container logs, search for that code. The failure line carries
   the event slug and the real underlying error:
   ```
   [secondline] upload failed (ref=SL-XVA5 slug=k5yxdgr9) InvalidAccessKeyId: ...
   ```

Common root causes:

- **Storage credentials** — S3 `403` / `InvalidAccessKeyId` → check the
  `WASABI_ACCESS_KEY` / `WASABI_SECRET_KEY` env vars in Coolify.
- **Oversized file** — the client rejects photos > 10 MB / videos > 200 MB
  before upload (shown on the tile, no server hit).
- **Stale upload page after a deploy** — a guest who had the page open before a
  redeploy can hit renamed assets; have them hard-refresh. **Avoid redeploying
  during a live event** for this reason.

## Deploy

See `docs/deploy.md` (to be written during implementation plan task 27).

## License

TBD (private during development).
