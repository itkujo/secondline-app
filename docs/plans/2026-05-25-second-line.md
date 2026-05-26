# Second Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Repo bootstrap status (Task 0):** The standalone repo at
`/home/phoenix/code/secondline-app` is already initialized. The initial
commit (Astro 5 SSR + React 18 + node:sqlite + Tailwind v4 + AWS SDK v3 +
qrcode + archiver + sharp scaffold, plus `vitest.config.ts`, `tsconfig.json`,
`astro.config.mjs`, `package.json`, `.env.example`, `AGENTS.md`) was committed
at SHA `832940a` on the `main` branch. This plan does **not** re-init the
repo. The first work-task is Task 1 (schema bootstrap).

**Goal:** Ship v1 of Second Line — guests scan a QR code, upload from their phone, content appears on a live wall at the venue within seconds, host gets a downloadable album after, 6-month TTL then redirect to PicTime. Lives at `secondline.smile-nola.com` with media on `media.smile-nola.com`. Standalone repo deployed as a single Coolify service.

**Architecture:** Four layers inside the standalone app. (1) A storage backend registry (`src/lib/secondline/storage/`) that abstracts over any S3-compatible endpoint; v1 ships with `wasabi` registered and code-ready for `nas-home`. (2) Domain logic in `src/lib/secondline/` (events, assets, slugs, retention, ZIPs, email). (3) Single-password admin auth + middleware in `src/lib/auth.ts` and `src/middleware.ts`. (4) Five public route surfaces — guest upload `/u/<slug>`, wall `/w/<slug>`, gallery `/g/<slug>`, admin under `/admin/events/`, plus a media proxy at `/m/<slug>/<asset>` bound to `media.smile-nola.com` via Coolify. Realtime via SSE; resilience via a tiny service worker upload queue (single-shot uploads, retried in the background — no tus, no multipart). All schema lives in `src/lib/db.ts` via an idempotent `bootstrapSchema` migration.

**Tech stack:** TypeScript (strict, `verbatimModuleSyntax`), Astro 5 SSR with `@astrojs/node` standalone adapter, React 18 islands, `node:sqlite` (built-in, Node 22.5+), `sharp` with HEIC enabled, `@aws-sdk/client-s3` v3, `qrcode`, `archiver`, `resend`, `zod`, `vitest`. No native build step. No tus. No node-cron.

---

## Decisions locked from the brainstorming round

| Decision | Choice | Why |
|---|---|---|
| Where it lives | Standalone repo, single deployable | Allows fork/license to other photographers; no monorepo coupling |
| Domain shape | Subdomain `secondline.smile-nola.com` for app, `media.smile-nola.com` for assets | Spec §7.1: memorable URL, CSP isolation, cookie-free media |
| Upload protocol | Single-shot per file, service worker retry queue | "As simple as possible from end users phone". 50MB cap fits in one PUT. No tusd sidecar, no multipart orchestration. |
| Max upload size | 50 MB per file (videos), 10 MB per file (photos) | Server-enforced. |
| Database | SQLite via Node's built-in `node:sqlite` (no native build) | Node 22.5+ ships it; one fewer cross-Alpine-version footgun than `better-sqlite3`. API is a strict subset. |
| S3 SDK | `@aws-sdk/client-s3` v3 | Official, no native deps, works against Wasabi + MinIO with custom endpoint |
| Storage backends shipped in v1 | `wasabi` only, registry pattern in code | Allows adding `nas-home` later via config + env vars, zero code change. Per spec §7.5. |
| Realtime | SSE with auto-reconnect + `?since=<ts>` catch-up | Spec §7.3 |
| Wall framework | React 18 island via `@astrojs/react` | Already in the bootstrap. No new dep. |
| Animation | Pure CSS transitions + Web Animations API, compositor-only | Spec §5.2. No animation library. |
| Media public URL | `media.smile-nola.com/m/<slug>/<asset-id>` → Astro SSR route that validates and streams from the right backend | Spec §7.6. SSR proxy gives us access control. |
| Access control | Slug-gated (8-char opaque IDs); proxy validates asset belongs to slug | Spec §7.6. Matches Kululu/Memtly. |
| HEIC | Server-side conversion to JPEG via sharp + libheif | Spec §10 risk #2 |
| Retention | 180 days from event_date; nightly Coolify cron → bearer-gated `POST /api/cron/cleanup` | Spec §7.8. No node-cron. |
| Host email | Resend, via fresh `src/lib/email.ts` wrapper | Built in this repo from day one |
| QR codes | Server-side rendered SVG via `qrcode` package | Render in admin event page |
| Slugs | 8-char, base32 alphabet excluding ambiguous chars (no `0OIl1`) | Opaque, easy to read on signage |
| Event creation | Manual via admin form (`POST /api/admin/events`); host first/last/email/date + storage backend; no auto-create-from-inquiry | Standalone repo has no inquiry table |
| Admin auth | Single-password, HMAC-signed cookie (`sn_secondline`, 24h TTL, HttpOnly, SameSite=Lax, Secure in prod), in-memory rate limit | Same shape as smile-nola's; reimplemented here so the repo is self-contained |
| Failure mode for side-effects (ZIPs, emails) | Fire-and-forget, never throw to the client, audit-logged | Standard pattern |

---

## File Structure

**Files created by this plan (all paths relative to repo root):**

| Path | Responsibility |
|---|---|
| `src/lib/env.ts` | Env helpers: `getEnv`, `getRequiredEnv` |
| `src/lib/db.ts` | `getDb()` singleton, `bootstrapSchema(db)` creating events + assets tables, idempotent |
| `src/lib/auth.ts` | Single-password admin auth: cookie, rate limit, `isAuthed`, `passwordsMatch`, `clientIp` |
| `src/middleware.ts` | Auto-guard `/admin/*` and `/api/admin/*` (except login/logout) |
| `src/layouts/AdminLayout.astro` | Top-bar admin shell with nav + build-pill |
| `src/lib/email.ts` | Resend wrapper: `getResendClient`, `resolveFromAddress`, `sendRawEmail` |
| `src/lib/secondline/types.ts` | TypeScript types: `EventRow`, `AssetRow`, `BackendId`, `StorageBackend`, `PublicAsset`, SSE types |
| `src/lib/secondline/slugs.ts` | Generate opaque 8-char slugs; `isValidSlugShape` |
| `src/lib/secondline/events.ts` | DB layer: `createEvent`, `getEventBySlug`, `getEventById`, `setPicTimeUrl`, `setBackend`, `markExpired`, `markFirstUpload`, `markWarned30`, `listActiveEvents`, `listEventsExpiringBefore` |
| `src/lib/secondline/assets.ts` | DB layer: `recordAsset`, `listAssetsForEvent`, `listAssetsSince`, `getAsset`, `softDeleteAsset`, `countAssetsForEvent`, `totalBytesForEvent`, `listAllAssetsForPurge` |
| `src/lib/secondline/storage/backends.ts` | Backend registry loader (reads `secondline-backends.json`), `getBackend(id)`, `listBackends()`, `resetBackendsCache` |
| `src/lib/secondline/storage/s3.ts` | Thin AWS SDK wrapper. `putObject`, `getObjectStream`, `headObject`, `deleteObject`, `listObjectKeys` |
| `src/lib/secondline/media-processing.ts` | sharp pipeline: HEIC→JPEG, EXIF rotate, dimension extraction, thumbs |
| `src/lib/secondline/retention.ts` | Pure helpers + orchestrators: `isExpired`, `daysUntilExpiry`, `runRetentionSweep`, `sendExpiryReminders` |
| `src/lib/secondline/sse.ts` | In-process per-event subscriber registry. `subscribe(eventId, send)`, `broadcast(eventId, msg)` |
| `src/lib/secondline/qr.ts` | SVG QR code generation |
| `src/lib/secondline/email.ts` | Host-facing email templates: gallery ready, expiry warning, expired |
| `secondline-backends.json` | Backend registry. **Committed** with `wasabi` entry; secrets stay in env vars |
| `src/pages/u/[slug].astro` | Guest upload page (static shell + React island) |
| `src/pages/w/[slug].astro` | Wall page (static shell + React island) |
| `src/pages/g/[slug].astro` | Host gallery page (SSR + small island) |
| `src/pages/m/[slug]/[asset].ts` | Media proxy (the route Coolify maps `media.smile-nola.com` to) |
| `src/pages/m/[slug]/[asset]_thumb.ts` | Thumbnail proxy |
| `src/pages/api/upload.ts` | POST: accept uploaded file, process, write to backend, append asset row, broadcast SSE event |
| `src/pages/api/events/[slug]/assets.ts` | GET: list assets (used by gallery + wall initial load) |
| `src/pages/api/events/[slug]/stream.ts` | SSE endpoint |
| `src/pages/api/events/[slug]/since.ts` | GET ?ts=<iso>: catch-up after SSE reconnect |
| `src/pages/api/events/[slug]/zip.ts` | GET: stream ZIP of full event |
| `src/pages/api/cron/cleanup.ts` | POST, bearer-gated: retention sweep |
| `src/pages/api/cron/reminders.ts` | POST, bearer-gated: send 30-day expiry warnings |
| `src/pages/admin/login.astro` | Login page |
| `src/pages/admin/events/index.astro` | Admin list of all events |
| `src/pages/admin/events/new.astro` | Admin form to create a new event |
| `src/pages/admin/events/[id].astro` | Admin event detail (QR, backend selector, PicTime URL, asset list, manual delete) |
| `src/pages/api/admin/login.ts` | POST: verify password, issue cookie |
| `src/pages/api/admin/logout.ts` | POST: clear cookie |
| `src/pages/api/admin/events.ts` | POST: create event |
| `src/pages/api/admin/events/[id].ts` | PATCH: update event fields |
| `src/pages/api/admin/events/[id]/assets/[assetId].ts` | DELETE: operator delete an asset |
| `src/pages/api/admin/events/[id]/send-gallery.ts` | POST: send the host their gallery-ready email |
| `src/components/secondline/UploadIsland.tsx` | The guest upload React island |
| `src/components/secondline/WallIsland.tsx` | The wall SPA React island |
| `src/components/secondline/GalleryIsland.tsx` | The host gallery React island |
| `public/secondline-sw.js` | Service worker for upload retry queue |
| `Dockerfile` | Multi-stage build (Node 22 Alpine), produces a runnable image |
| `docker-compose.yml` | Single `app` service, named volume `secondline_data` mounted at `/data` |
| `docs/deploy.md` | Coolify domain config, env, scheduled tasks |
| `src/lib/secondline/__tests__/*` | Vitest specs alongside lib modules |
| `src/lib/__tests__/auth.test.ts` | Auth unit tests |

**Files modified by this plan (created at bootstrap, edited here):**

| Path | Reason |
|---|---|
| `package.json` | Already has every runtime dep; only test/CI scripts may be tuned. Verify per Task 1. |
| `.env.example` | Already has every var the plan needs; verify per Task 1. |
| `astro.config.mjs` | None expected — verify host-agnostic config matches plan needs. |

---

## Task 1: Verify environment, dependencies, and HEIC support

**Files:**
- Read-only: `package.json`, `.env.example`, `Dockerfile` (if present)
- Modify (only if HEIC verification fails): `Dockerfile`

The repo is already bootstrapped with every runtime dependency. This task confirms the working environment (Node 22.5+, libheif support in sharp, env-var template) before any feature work starts.

- [ ] **Step 1: Verify Node version**

```sh
node --version
```
Expected: `v22.5.0` or higher. If lower, install Node 22.5+ via `nvm install 22` (the `node:sqlite` module requires this).

- [ ] **Step 2: Verify package install is clean**

```sh
pnpm install --frozen-lockfile
```
Expected: no errors, no rebuild prompts.

- [ ] **Step 3: Verify sharp prebuild includes libheif**

```sh
node -e "import('sharp').then(m => console.log(JSON.stringify(m.default.format.heif)))"
```
Expected output contains `"input":true`. If the output shows `"input":false` (or the heif key is missing entirely), sharp's prebuild does not include libheif and we must patch the Dockerfile (next step).

- [ ] **Step 4: (Conditional) Patch the Dockerfile for libheif**

Only execute this step if Step 3 showed no HEIF input support. The Dockerfile is created in Task 28; for now, if the local environment lacks libheif, install it locally to unblock dev:

```sh
# Arch / CachyOS dev host
sudo pacman -S --needed libheif vips
# Then verify Step 3 again
```

Note in `docs/deploy.md` (Task 28) that the runtime image needs `apk add --no-cache vips-heif` when the sharp prebuild lacks HEIF support. Do not skip this — iPhone photos will fail to process otherwise.

- [ ] **Step 5: Verify env-var template is complete**

```sh
cat .env.example
```

Confirm it contains entries for:
- `PORT`, `SECONDLINE_PUBLIC_URL`, `MEDIA_PUBLIC_URL`
- `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`
- `SECONDLINE_DB_DIR`
- `RESEND_API_KEY`, `RESEND_FROM`, `NOTIFY_EMAIL`
- `SECONDLINE_ACTIVE_BACKEND`, `WASABI_ACCESS_KEY`, `WASABI_SECRET_KEY`
- `SECONDLINE_CRON_TOKEN`

All of these are already in the bootstrap. If anything is missing, add it now.

- [ ] **Step 6: Create local `.env` for dev**

```sh
cp .env.example .env
```

Edit `.env`:

```
PORT=4321
SECONDLINE_PUBLIC_URL=http://localhost:4321
MEDIA_PUBLIC_URL=http://localhost:4321
ADMIN_PASSWORD=devpass
ADMIN_SESSION_SECRET=dev-secret-do-not-use-in-prod
SECONDLINE_DB_DIR=./data
SECONDLINE_ACTIVE_BACKEND=wasabi
SECONDLINE_CRON_TOKEN=dev-cron-token
# Leave WASABI_* blank — first run uses an in-memory test backend until you wire up real credentials
```

- [ ] **Step 7: Verify build still works**

```sh
pnpm typecheck && pnpm build
```
Expected: both succeed (the bootstrap had a working build).

- [ ] **Step 8: No commit needed**

This task makes no code changes (assuming Step 4 was skipped). If the Dockerfile was patched, defer the commit to Task 28 where the Dockerfile is fully written.

---

## Task 2: Env-var helpers

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/lib/__tests__/env.test.ts`

The rest of the codebase calls `getEnv(name)` / `getRequiredEnv(name)` instead of touching `process.env` directly. This makes tests easy (can monkey-patch `process.env` before importing) and gives one place to put the "missing env" error message.

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/env.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { getEnv, getRequiredEnv } from '../env';

const KEY = 'SECONDLINE_TEST_ENV_KEY';

afterEach(() => { delete process.env[KEY]; });

describe('env helpers', () => {
  it('getEnv returns the trimmed value when set', () => {
    process.env[KEY] = '  hello  ';
    expect(getEnv(KEY)).toBe('hello');
  });

  it('getEnv returns empty string when unset', () => {
    expect(getEnv(KEY)).toBe('');
  });

  it('getRequiredEnv throws when unset', () => {
    expect(() => getRequiredEnv(KEY)).toThrow(/SECONDLINE_TEST_ENV_KEY/);
  });

  it('getRequiredEnv returns the value when set', () => {
    process.env[KEY] = 'x';
    expect(getRequiredEnv(KEY)).toBe('x');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/__tests__/env.test.ts
```
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `env.ts`**

Create `src/lib/env.ts`:

```ts
/**
 * Env-var accessors. Centralizes reads from process.env so tests can monkey-
 * patch and so missing-required errors say something useful.
 *
 * Always whitespace-trims. Empty strings are treated as "unset".
 */

export function getEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string') return '';
  return v.trim();
}

export function getRequiredEnv(name: string): string {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/__tests__/env.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/env.ts src/lib/__tests__/env.test.ts
git commit -m "feat: env helpers (getEnv, getRequiredEnv)"
```

---

## Task 3: Database bootstrap (events + assets schema)

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/__tests__/db.test.ts`

The DB layer uses `node:sqlite` (Node 22.5+ built-in). API is a strict subset of `better-sqlite3`: `prepare().run/get/all/iterate`, `exec()`, transactions via `BEGIN`/`COMMIT`. `RunResult` has `lastInsertRowid` and `changes`. WAL mode, foreign_keys=ON, synchronous=NORMAL.

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import sqlite from 'node:sqlite';
import { bootstrapSchema } from '../db';

let db: sqlite.DatabaseSync;

beforeEach(() => {
  db = new sqlite.DatabaseSync(':memory:');
  bootstrapSchema(db);
});

describe('schema bootstrap', () => {
  it('creates events table with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info('events')").all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    for (const n of [
      'id', 'slug', 'storage_backend_id',
      'host_first_name', 'host_last_name', 'host_email', 'event_date',
      'pictime_gallery_url', 'expires_at', 'status',
      'first_upload_at', 'created_at', 'warned_30_at',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('creates assets table with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info('assets')").all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    for (const n of [
      'id', 'event_id', 'source', 'storage_key', 'thumb_storage_key',
      'mime_type', 'byte_size', 'width', 'height', 'duration_ms',
      'uploader_name', 'uploaded_at', 'deleted_at',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('enforces slug UNIQUE on events', () => {
    db.prepare(`INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email, event_date, status)
                VALUES ('aaaaaaaa', 'wasabi', 'A', 'B', 'a@b.c', '2026-08-01', 'active')`).run();
    expect(() => db.prepare(`INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email, event_date, status)
                VALUES ('aaaaaaaa', 'wasabi', 'C', 'D', 'c@d.e', '2026-09-01', 'active')`).run())
      .toThrow(/UNIQUE/);
  });

  it('cascades delete from event to assets via FK', () => {
    const ev = db.prepare(`INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email, event_date, status)
                            VALUES ('bbbbbbbb', 'wasabi', 'A', 'B', 'a@b.c', '2026-08-01', 'active') RETURNING id`).get() as { id: number };
    db.prepare(`INSERT INTO assets (event_id, source, storage_key, mime_type, byte_size)
                VALUES (?, 'guest', 'key.jpg', 'image/jpeg', 12345)`).run(ev.id);
    db.prepare(`DELETE FROM events WHERE id = ?`).run(ev.id);
    const rows = db.prepare(`SELECT * FROM assets WHERE event_id = ?`).all(ev.id);
    expect(rows).toHaveLength(0);
  });

  it('bootstrapSchema is idempotent (safe to call twice)', () => {
    expect(() => bootstrapSchema(db)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/__tests__/db.test.ts
```
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `db.ts`**

Create `src/lib/db.ts`:

```ts
/**
 * SQLite singleton + schema bootstrap.
 *
 * Uses Node's built-in node:sqlite (Node 22.5+). No native build step, no
 * cross-platform headaches. API surface is a strict subset of better-sqlite3
 * (prepare().run/get/all/iterate, exec, transactions via BEGIN/COMMIT).
 *
 * The schema is created and migrated by bootstrapSchema, called once at app
 * boot via getDb(). All migrations are idempotent (CREATE TABLE IF NOT EXISTS,
 * column-add via PRAGMA table_info check).
 */

import sqlite from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEnv } from './env';

export type Db = sqlite.DatabaseSync;

let _db: Db | null = null;

export function getDb(): Db {
  if (_db) return _db;
  const dir = resolve(process.cwd(), getEnv('SECONDLINE_DB_DIR') || './data');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'secondline.db');
  const db = new sqlite.DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  bootstrapSchema(db);
  _db = db;
  return db;
}

/** Test-only: replace the singleton. */
export function __setDbForTest(db: Db | null): void {
  _db = db;
}

export function bootstrapSchema(db: Db): void {
  // Ensure PRAGMAs even when called against an in-memory test db.
  db.exec(`PRAGMA foreign_keys = ON;`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      storage_backend_id TEXT NOT NULL,
      host_first_name TEXT NOT NULL,
      host_last_name TEXT NOT NULL,
      host_email TEXT NOT NULL,
      event_date TEXT NOT NULL,
      pictime_gallery_url TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
      first_upload_at TEXT,
      warned_30_at TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS idx_events_status  ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_expires ON events(expires_at);

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'guest' CHECK (source IN ('guest','booth')),
      storage_key TEXT NOT NULL,
      thumb_storage_key TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      uploader_name TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_assets_event ON assets(event_id, uploaded_at);
    CREATE INDEX IF NOT EXISTS idx_assets_alive ON assets(event_id) WHERE deleted_at IS NULL;
  `);
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/__tests__/db.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/db.ts src/lib/__tests__/db.test.ts
git commit -m "feat: sqlite schema bootstrap (events + assets) via node:sqlite"
```

---

## Task 4: Admin auth module

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/__tests__/auth.test.ts`

Single-password admin auth. Cookie `sn_secondline`, 24h TTL, HMAC-signed with `ADMIN_SESSION_SECRET`. SameSite=Lax, HttpOnly, Secure when `import.meta.env.PROD`. In-memory sliding-window rate limit per-(bucket, IP). Login bucket: 5 attempts per 5 minutes.

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  passwordsMatch, issueSessionCookie, clearSessionCookie,
  readSessionCookie, verifyCookie, isAuthed,
  clientIp, rateLimit, loginRateLimit, resetRateLimit,
  COOKIE_NAME,
} from '../auth';

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'correct-horse';
  process.env.ADMIN_SESSION_SECRET = 'test-secret-key-32-bytes-min-okay';
  resetRateLimit();
});

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_SESSION_SECRET;
});

describe('auth', () => {
  it('passwordsMatch true on exact match, false otherwise, constant-time', () => {
    expect(passwordsMatch('correct-horse')).toBe(true);
    expect(passwordsMatch('wrong')).toBe(false);
    expect(passwordsMatch('')).toBe(false);
  });

  it('issueSessionCookie returns a Set-Cookie string with HttpOnly + SameSite + Path', () => {
    const c = issueSessionCookie();
    expect(c).toContain(`${COOKIE_NAME}=`);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=\d+/);
  });

  it('clearSessionCookie returns a Set-Cookie that expires the cookie', () => {
    const c = clearSessionCookie();
    expect(c).toContain(`${COOKIE_NAME}=`);
    expect(c).toMatch(/Max-Age=0/);
  });

  it('verifyCookie accepts a freshly-issued token and rejects tampering', () => {
    const set = issueSessionCookie();
    const value = set.split(';')[0].split('=')[1];
    expect(verifyCookie(value)).toBe(true);
    expect(verifyCookie(value + 'x')).toBe(false);
    expect(verifyCookie('garbage')).toBe(false);
    expect(verifyCookie('')).toBe(false);
  });

  it('readSessionCookie pulls the named cookie out of a header', () => {
    expect(readSessionCookie(`other=1; ${COOKIE_NAME}=abc.def; foo=bar`)).toBe('abc.def');
    expect(readSessionCookie('')).toBeNull();
    expect(readSessionCookie('other=1')).toBeNull();
  });

  it('isAuthed combines readSessionCookie + verifyCookie', () => {
    const set = issueSessionCookie();
    const value = set.split(';')[0].split('=')[1];
    const req = new Request('http://x', { headers: { cookie: `${COOKIE_NAME}=${value}` } });
    expect(isAuthed(req)).toBe(true);
    const reqBad = new Request('http://x', { headers: { cookie: `${COOKIE_NAME}=garbage` } });
    expect(isAuthed(reqBad)).toBe(false);
  });

  it('clientIp prefers X-Forwarded-For first value', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('clientIp falls back to X-Real-IP', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(clientIp(req)).toBe('9.9.9.9');
  });

  it('rateLimit denies after window cap', () => {
    for (let i = 0; i < 3; i++) expect(rateLimit('test', '1.1.1.1', 3, 60_000)).toBe(true);
    expect(rateLimit('test', '1.1.1.1', 3, 60_000)).toBe(false);
    // Different IP unaffected
    expect(rateLimit('test', '2.2.2.2', 3, 60_000)).toBe(true);
  });

  it('loginRateLimit allows 5 then denies', () => {
    for (let i = 0; i < 5; i++) expect(loginRateLimit('1.1.1.1')).toBe(true);
    expect(loginRateLimit('1.1.1.1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/__tests__/auth.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `auth.ts`**

Create `src/lib/auth.ts`:

```ts
/**
 * Single-password admin auth.
 *
 * - Cookie `sn_secondline`, 24h TTL, HMAC-signed with ADMIN_SESSION_SECRET.
 * - SameSite=Lax, HttpOnly, Secure when import.meta.env.PROD.
 * - In-memory sliding-window rate limit per (bucket, IP). Login bucket caps
 *   at 5 attempts per 5 minutes.
 * - All password compares are constant-time.
 *
 * This module owns ALL admin-auth surface. Middleware (src/middleware.ts)
 * and the login/logout endpoints are the only consumers.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { getEnv, getRequiredEnv } from './env';

export const COOKIE_NAME = 'sn_secondline';
const COOKIE_TTL_SEC = 24 * 60 * 60;
const COOKIE_TTL_MS = COOKIE_TTL_SEC * 1000;

// --- Password ---

export function passwordsMatch(submitted: string): boolean {
  const expected = getEnv('ADMIN_PASSWORD');
  if (!expected || !submitted) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Cookie signing ---

function sign(payload: string): string {
  const secret = getRequiredEnv('ADMIN_SESSION_SECRET');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Cookie value format: <issuedAtMs>.<sig>
 * Verification re-signs and compares constant-time; rejects on TTL expiry.
 */
export function issueSessionCookie(): string {
  const issuedAt = Date.now();
  const nonce = randomBytes(8).toString('base64url');
  const payload = `${issuedAt}.${nonce}`;
  const sig = sign(payload);
  const value = `${payload}.${sig}`;
  const flags = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_TTL_SEC}`,
  ];
  if (isProd()) flags.push('Secure');
  return flags.join('; ');
}

export function clearSessionCookie(): string {
  const flags = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isProd()) flags.push('Secure');
  return flags.join('; ');
}

export function verifyCookie(value: string): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [issuedAtStr, nonce, sig] = parts;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > COOKIE_TTL_MS) return false;
  const expected = sign(`${issuedAtStr}.${nonce}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readSessionCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const name = p.slice(0, eq);
    if (name === COOKIE_NAME) return p.slice(eq + 1);
  }
  return null;
}

export function isAuthed(request: Request): boolean {
  const v = readSessionCookie(request.headers.get('cookie') ?? '');
  if (!v) return false;
  return verifyCookie(v);
}

// --- IP detection ---

export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return '0.0.0.0';
}

// --- Rate limit ---

interface Bucket { hits: number[]; }
const buckets = new Map<string, Bucket>();

function key(name: string, ip: string): string { return `${name}::${ip}`; }

export function rateLimit(name: string, ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const k = key(name, ip);
  let b = buckets.get(k);
  if (!b) { b = { hits: [] }; buckets.set(k, b); }
  b.hits = b.hits.filter(t => now - t < windowMs);
  if (b.hits.length >= max) return false;
  b.hits.push(now);
  return true;
}

export function loginRateLimit(ip: string): boolean {
  return rateLimit('login', ip, 5, 5 * 60 * 1000);
}

export function resetRateLimit(): void {
  buckets.clear();
}

// --- Helpers ---

function isProd(): boolean {
  // import.meta.env is replaced at build time; in tests/runtime the
  // NODE_ENV-style check is the fallback.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { if ((import.meta as any).env?.PROD) return true; } catch { /* not in vite */ }
  return process.env.NODE_ENV === 'production';
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/__tests__/auth.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/auth.ts src/lib/__tests__/auth.test.ts
git commit -m "feat: single-password admin auth (cookie, HMAC, rate limit)"
```

---

## Task 5: Middleware

**Files:**
- Create: `src/middleware.ts`

Auto-guard `/admin/*` and `/api/admin/*`. Exceptions: `/admin/login`, `/api/admin/login`, `/api/admin/logout`. Page routes get 302 → `/admin/login`. API routes get 401 JSON.

- [ ] **Step 1: Implement `src/middleware.ts`**

Create `src/middleware.ts`:

```ts
/**
 * Astro middleware. Auto-guards admin surfaces:
 *
 *   /admin/*       -> redirect to /admin/login if not authed
 *   /api/admin/*   -> 401 JSON if not authed
 *
 * Exempt routes:
 *   /admin/login
 *   /api/admin/login
 *   /api/admin/logout
 *
 * Cron and public surfaces are unguarded — they have their own bearer-token
 * checks (/api/cron/*) or are slug-gated (/u, /w, /g, /m, /api/events, /api/upload).
 */

import { defineMiddleware } from 'astro:middleware';
import { isAuthed } from '@/lib/auth';

const EXEMPT_PATHS = new Set<string>([
  '/admin/login',
  '/api/admin/login',
  '/api/admin/logout',
]);

export const onRequest = defineMiddleware(async ({ request, url, redirect }, next) => {
  const path = url.pathname;
  const isAdminPage = path.startsWith('/admin/') || path === '/admin';
  const isAdminApi = path.startsWith('/api/admin/') || path === '/api/admin';

  if ((isAdminPage || isAdminApi) && !EXEMPT_PATHS.has(path)) {
    if (!isAuthed(request)) {
      if (isAdminApi) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return redirect(`/admin/login?next=${encodeURIComponent(path)}`, 302);
    }
  }

  return next();
});
```

- [ ] **Step 2: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add src/middleware.ts
git commit -m "feat: middleware to guard /admin and /api/admin"
```

---

## Task 6: Email wrapper

**Files:**
- Create: `src/lib/email.ts`
- Create: `src/lib/__tests__/email.test.ts`

Thin Resend wrapper. `getResendClient()`, `resolveFromAddress()`, `sendRawEmail({to, subject, html})`. Console fallback when `RESEND_API_KEY` is missing — never throws.

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/email.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveFromAddress, sendRawEmail } from '../email';

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

describe('email', () => {
  it('resolveFromAddress uses RESEND_FROM when set', () => {
    process.env.RESEND_FROM = 'Test <test@example.com>';
    expect(resolveFromAddress()).toBe('Test <test@example.com>');
  });

  it('resolveFromAddress falls back to a sane default', () => {
    expect(resolveFromAddress()).toContain('@');
  });

  it('sendRawEmail console-falls-back when no API key, never throws', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(sendRawEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('sendRawEmail returns silently when to is empty', async () => {
    process.env.RESEND_API_KEY = 'fake';
    await expect(sendRawEmail({ to: '', subject: 's', html: 'x' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/__tests__/email.test.ts
```

- [ ] **Step 3: Implement `email.ts`**

Create `src/lib/email.ts`:

```ts
/**
 * Resend wrapper. One-call surface: sendRawEmail({to, subject, html}).
 *
 * If RESEND_API_KEY is not set, falls back to console.info — never throws.
 * That way local dev and broken-prod-config both degrade gracefully instead
 * of taking down the request that triggered the email.
 */

import { Resend } from 'resend';
import { getEnv } from './env';

const DEFAULT_FROM = 'Smile NOLA <hello@smile-nola.com>';

let _client: Resend | null = null;

export function getResendClient(): Resend | null {
  const key = getEnv('RESEND_API_KEY');
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

export function resolveFromAddress(): string {
  return getEnv('RESEND_FROM') || DEFAULT_FROM;
}

export interface RawEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendRawEmail(input: RawEmailInput): Promise<void> {
  if (!input.to) return;
  const client = getResendClient();
  const from = input.from || resolveFromAddress();
  if (!client) {
    console.info('[email] (fallback) would send', { from, to: input.to, subject: input.subject });
    return;
  }
  try {
    await client.emails.send({ from, to: input.to, subject: input.subject, html: input.html });
  } catch (err) {
    console.error('[email] sendRawEmail failed', err);
  }
}

/** Test-only: reset the cached client. */
export function __resetEmailClient(): void {
  _client = null;
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/__tests__/email.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/email.ts src/lib/__tests__/email.test.ts
git commit -m "feat: resend email wrapper with console fallback"
```

---

## Task 7: AdminLayout + login page + logout endpoint

**Files:**
- Create: `src/layouts/AdminLayout.astro`
- Create: `src/pages/admin/login.astro`
- Create: `src/pages/api/admin/login.ts`
- Create: `src/pages/api/admin/logout.ts`

AdminLayout is the top-bar shell every admin page wraps with. Dark brand: gold (`#d4af37`) on near-black (`#050505`). Build-pill reads `import.meta.env.PUBLIC_GIT_SHA` (set from `SOURCE_COMMIT` at Docker build time) or falls back to `'dev'`.

- [ ] **Step 1: Implement `AdminLayout.astro`**

Create `src/layouts/AdminLayout.astro`:

```astro
---
/**
 * Admin shell.
 *
 * Top bar with brand mark, section nav, and build-identity pill (shows the
 * git SHA the running container was built from — proves to operators which
 * version they're hitting after a deploy).
 */
export interface Props {
  title?: string;
  section?: 'events' | 'login';
}
const { title = 'Admin', section } = Astro.props;

const NAV = [
  { key: 'events', label: 'Events', href: '/admin/events' },
] as const;

const buildSha = (import.meta.env.PUBLIC_GIT_SHA as string | undefined)?.slice(0, 7) || 'dev';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>{title} · Second Line</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; background: #050505; color: #f8f4ea;
                   font-family: Helvetica, Arial, sans-serif; min-height: 100vh; }
      .topbar { display: flex; align-items: center; gap: 24px; padding: 14px 22px;
                border-bottom: 1px solid #181818; background: #080808; position: sticky; top: 0; z-index: 5; }
      .brand { font-family: Georgia, serif; color: #d4af37; letter-spacing: 0.1em; font-size: 16px; text-decoration: none; }
      .brand small { font-size: 10px; letter-spacing: 0.25em; color: #b8b2a5; display: block; }
      nav.sections { display: flex; gap: 4px; margin-left: 8px; flex: 1; }
      nav.sections a { padding: 6px 12px; border-radius: 999px; font-size: 13px; color: #cfc7b3;
                       text-decoration: none; border: 1px solid transparent; }
      nav.sections a.active { color: #d4af37; border-color: rgba(212,175,55,0.3); background: rgba(212,175,55,0.06); }
      nav.sections a:hover { color: #d4af37; }
      .build-pill { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px;
                    background: #111; color: #b8b2a5; padding: 4px 10px; border-radius: 999px;
                    border: 1px solid #1a1a1a; }
      .logout-btn { background: transparent; border: 1px solid #2a2a2a; color: #b8b2a5;
                    padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
      .logout-btn:hover { color: #d4af37; border-color: rgba(212,175,55,0.3); }
      main.admin { max-width: 1200px; margin: 0 auto; padding: 24px 22px 80px; }
      h1 { font-size: 26px; margin: 0 0 6px; color: #f8f4ea; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/admin/events">
        SMILE NOLA <small>SECOND LINE</small>
      </a>
      {section !== 'login' && (
        <nav class="sections">
          {NAV.map(item => (
            <a href={item.href} class={section === item.key ? 'active' : ''}>{item.label}</a>
          ))}
        </nav>
      )}
      <span class="build-pill" title="Build SHA">{buildSha}</span>
      {section !== 'login' && (
        <form method="POST" action="/api/admin/logout" style="margin:0;">
          <button type="submit" class="logout-btn">Log out</button>
        </form>
      )}
    </header>
    <main class="admin">
      <slot />
    </main>
  </body>
</html>
```

- [ ] **Step 2: Implement the login page**

Create `src/pages/admin/login.astro`:

```astro
---
/**
 * Admin login page.
 *
 * POSTs to /api/admin/login which sets the session cookie and redirects
 * back to `next` or /admin/events. Errors render inline (?error=1).
 */
import AdminLayout from '@/layouts/AdminLayout.astro';
import { isAuthed } from '@/lib/auth';

export const prerender = false;

// Bounce already-authed users to the dashboard.
if (isAuthed(Astro.request)) {
  return Astro.redirect('/admin/events');
}

const next = Astro.url.searchParams.get('next') || '/admin/events';
const error = Astro.url.searchParams.get('error') === '1';
const tooMany = Astro.url.searchParams.get('error') === 'rate';
---
<AdminLayout title="Sign in" section="login">
  <div style="max-width:420px;margin:48px auto 0;">
    <h1>Sign in</h1>
    <p style="color:#b8b2a5;margin:0 0 24px;">Single-password admin.</p>
    {error && (
      <div style="background:rgba(160,80,80,0.12);border:1px solid rgba(160,80,80,0.3);color:#d08989;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:14px;">
        Wrong password.
      </div>
    )}
    {tooMany && (
      <div style="background:rgba(160,80,80,0.12);border:1px solid rgba(160,80,80,0.3);color:#d08989;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:14px;">
        Too many attempts. Try again in 5 minutes.
      </div>
    )}
    <form method="POST" action="/api/admin/login">
      <input type="hidden" name="next" value={next} />
      <label style="display:block;font-size:13px;color:#b8b2a5;margin-bottom:6px;">Password</label>
      <input
        type="password"
        name="password"
        autocomplete="current-password"
        autofocus
        required
        style="display:block;width:100%;box-sizing:border-box;padding:10px 12px;background:#111;color:#f8f4ea;border:1px solid #2a2a2a;border-radius:8px;font-size:16px;" />
      <button type="submit" style="margin-top:16px;background:#d4af37;color:#050505;border:0;padding:11px 22px;border-radius:999px;font-weight:600;cursor:pointer;font-size:14px;">
        Sign in
      </button>
    </form>
  </div>
</AdminLayout>
```

- [ ] **Step 3: Implement the login POST endpoint**

Create `src/pages/api/admin/login.ts`:

```ts
/**
 * POST /api/admin/login
 *
 * Body: application/x-www-form-urlencoded
 *   password=<string>
 *   next=<path>   (optional, defaults to /admin/events)
 *
 * On success: 302 to `next` with Set-Cookie.
 * On wrong password: 302 to /admin/login?error=1 (preserves next).
 * On rate-limit: 302 to /admin/login?error=rate.
 */

import type { APIRoute } from 'astro';
import { passwordsMatch, issueSessionCookie, clientIp, loginRateLimit } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!loginRateLimit(ip)) {
    return new Response(null, { status: 302, headers: { Location: '/admin/login?error=rate' } });
  }

  let password = '';
  let next = '/admin/events';
  try {
    const form = await request.formData();
    password = String(form.get('password') ?? '');
    const n = String(form.get('next') ?? '');
    if (n && n.startsWith('/') && !n.startsWith('//')) next = n;
  } catch {
    return new Response(null, { status: 302, headers: { Location: '/admin/login?error=1' } });
  }

  if (!passwordsMatch(password)) {
    const loc = `/admin/login?error=1&next=${encodeURIComponent(next)}`;
    return new Response(null, { status: 302, headers: { Location: loc } });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': issueSessionCookie(),
    },
  });
};
```

- [ ] **Step 4: Implement the logout POST endpoint**

Create `src/pages/api/admin/logout.ts`:

```ts
/**
 * POST /api/admin/logout — clears the session cookie, 302 to /admin/login.
 */

import type { APIRoute } from 'astro';
import { clearSessionCookie } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = async () => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': clearSessionCookie(),
    },
  });
};
```

- [ ] **Step 5: Manual smoke test**

```sh
pnpm dev &
DEV_PID=$!
sleep 4
# Visit http://localhost:4321/admin/events in a browser
# Expected: redirected to /admin/login
# Enter `devpass` (from .env), expected: redirected to /admin/events
# Click "Log out", expected: redirected to /admin/login
kill $DEV_PID
```

- [ ] **Step 6: Commit**

```sh
git add src/layouts/AdminLayout.astro src/pages/admin/login.astro src/pages/api/admin/login.ts src/pages/api/admin/logout.ts
git commit -m "feat(admin): login page, logout endpoint, AdminLayout shell"
```

---

## Task 8: Types module

**Files:**
- Create: `src/lib/secondline/types.ts`

- [ ] **Step 1: Write `types.ts`**

Create `src/lib/secondline/types.ts`:

```ts
/**
 * Second Line types. Hand-written to match the SQLite row shapes in db.ts.
 * Keep in sync with migrations there.
 */

export type EventStatus = 'active' | 'expired';
export type AssetSource = 'guest' | 'booth';
export type BackendId = string; // resolved against the registry at runtime

export interface EventRow {
  id: number;
  slug: string;
  storage_backend_id: BackendId;
  host_first_name: string;
  host_last_name: string;
  host_email: string;
  event_date: string;                 // YYYY-MM-DD
  pictime_gallery_url: string | null;
  expires_at: string | null;          // ISO timestamp (computed: event_date + 180 days)
  status: EventStatus;
  first_upload_at: string | null;
  warned_30_at: string | null;
  created_at: string;
}

export interface AssetRow {
  id: number;
  event_id: number;
  source: AssetSource;
  storage_key: string;                // path in the backend bucket
  thumb_storage_key: string | null;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  uploader_name: string | null;
  uploaded_at: string;
  deleted_at: string | null;
}

/**
 * StorageBackend = an S3-compatible endpoint we can read/write to.
 * Built from a registry entry (secondline-backends.json) + env vars at runtime.
 */
export interface StorageBackend {
  id: BackendId;
  label: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;            // true for MinIO/Garage, false for Wasabi
}

export interface BackendRegistryEntry {
  id: string;
  label: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_env: string;             // env var name to read access key from
  secret_key_env: string;
  force_path_style?: boolean;
}

/**
 * Public view of an asset — what we send to clients via SSE and the gallery API.
 * Never includes the raw storage_key (backend-id is an internal routing detail).
 */
export interface PublicAsset {
  id: number;
  src: string;                        // /m/<slug>/<id>
  thumb: string;                      // /m/<slug>/<id>_thumb
  mime_type: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  uploader_name: string | null;
  uploaded_at: string;
}

export interface SseAssetAdded {
  type: 'asset.added';
  asset: PublicAsset;
  ts: string;                         // ISO timestamp for ?since= replay
}

export interface SseAssetRemoved {
  type: 'asset.removed';
  id: number;
  ts: string;
}

export type SseMessage = SseAssetAdded | SseAssetRemoved;
```

- [ ] **Step 2: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add src/lib/secondline/types.ts
git commit -m "feat(secondline): types module for events, assets, backends, SSE"
```

---

## Task 9: Slug generator

**Files:**
- Create: `src/lib/secondline/slugs.ts`
- Create: `src/lib/secondline/__tests__/slugs.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/secondline/__tests__/slugs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateSlug, SLUG_ALPHABET, SLUG_LENGTH, isValidSlugShape } from '../slugs';

describe('slugs', () => {
  it('generates a slug of exactly SLUG_LENGTH characters', () => {
    const s = generateSlug();
    expect(s).toHaveLength(SLUG_LENGTH);
  });

  it('only uses characters from the safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const s = generateSlug();
      for (const ch of s) {
        expect(SLUG_ALPHABET).toContain(ch);
      }
    }
  });

  it('alphabet excludes visually ambiguous characters', () => {
    expect(SLUG_ALPHABET).not.toMatch(/[0oOilI1]/);
  });

  it('isValidSlugShape accepts well-formed slugs and rejects malformed ones', () => {
    expect(isValidSlugShape('abcd2345')).toBe(true);
    expect(isValidSlugShape('abc')).toBe(false);          // too short
    expect(isValidSlugShape('abcd2345X')).toBe(false);    // too long
    expect(isValidSlugShape('abcd234O')).toBe(false);     // forbidden char (O)
    expect(isValidSlugShape('../../etc')).toBe(false);
    expect(isValidSlugShape('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/__tests__/slugs.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `slugs.ts`**

Create `src/lib/secondline/slugs.ts`:

```ts
/**
 * Slug generation for Second Line events.
 *
 * Slugs are short, opaque, base32-ish identifiers that appear in every public
 * Second Line URL (/u/<slug>, /w/<slug>, /g/<slug>, /m/<slug>/...). They are
 * the only access control on guest-facing pages (matching Kululu/Memtly) and
 * therefore must be:
 *
 *  - long enough to be infeasible to enumerate (8 chars × 31 alphabet ≈ 2^39)
 *  - readable when printed on signage or read aloud (no 0/O/1/I/l ambiguity)
 *  - case-stable (lowercase only)
 *  - sourced from crypto.randomInt, not Math.random
 */

import { randomInt } from 'node:crypto';

export const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 chars
export const SLUG_LENGTH = 8;

export function generateSlug(): string {
  let s = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    s += SLUG_ALPHABET[randomInt(0, SLUG_ALPHABET.length)];
  }
  return s;
}

const SLUG_RE = new RegExp(`^[${SLUG_ALPHABET}]{${SLUG_LENGTH}}$`);

export function isValidSlugShape(s: unknown): s is string {
  return typeof s === 'string' && SLUG_RE.test(s);
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/__tests__/slugs.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/slugs.ts src/lib/secondline/__tests__/slugs.test.ts
git commit -m "feat(secondline): slug generator with safe alphabet"
```

---

## Task 10: Storage backend registry

**Files:**
- Create: `secondline-backends.json`
- Create: `src/lib/secondline/storage/backends.ts`
- Create: `src/lib/secondline/storage/__tests__/backends.test.ts`

- [ ] **Step 1: Write `secondline-backends.json`**

Create `secondline-backends.json` at the repo root (committed; contains NO secrets, only env-var-name pointers):

```json
{
  "backends": [
    {
      "id": "wasabi",
      "label": "Wasabi (production)",
      "endpoint": "https://s3.us-east-1.wasabisys.com",
      "region": "us-east-1",
      "bucket": "secondline-prod",
      "access_key_env": "WASABI_ACCESS_KEY",
      "secret_key_env": "WASABI_SECRET_KEY",
      "force_path_style": false
    }
  ]
}
```

Adding `nas-home` later = append an entry to this file + add `NAS_HOME_ACCESS_KEY` / `NAS_HOME_SECRET_KEY` to Coolify env. No code change required.

- [ ] **Step 2: Write failing test**

Create `src/lib/secondline/storage/__tests__/backends.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadBackends, getBackend, listBackends, resetBackendsCache } from '../backends';

describe('backend registry', () => {
  beforeEach(() => { resetBackendsCache(); });
  afterEach(() => {
    delete process.env.WASABI_ACCESS_KEY;
    delete process.env.WASABI_SECRET_KEY;
  });

  it('loads the wasabi entry from secondline-backends.json', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    const backends = loadBackends();
    expect(backends.length).toBeGreaterThan(0);
    const wasabi = getBackend('wasabi');
    expect(wasabi.id).toBe('wasabi');
    expect(wasabi.endpoint).toContain('wasabisys.com');
    expect(wasabi.accessKey).toBe('AK');
    expect(wasabi.secretKey).toBe('SK');
    expect(wasabi.forcePathStyle).toBe(false);
  });

  it('throws a helpful error when an env credential is missing', () => {
    delete process.env.WASABI_ACCESS_KEY;
    expect(() => loadBackends()).toThrow(/WASABI_ACCESS_KEY/);
  });

  it('throws when looking up an unknown backend id', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    expect(() => getBackend('nope')).toThrow(/nope/);
  });

  it('listBackends returns all loaded entries', () => {
    process.env.WASABI_ACCESS_KEY = 'AK';
    process.env.WASABI_SECRET_KEY = 'SK';
    const all = listBackends();
    expect(all.some(b => b.id === 'wasabi')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/storage/__tests__/backends.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement `backends.ts`**

Create `src/lib/secondline/storage/backends.ts`:

```ts
/**
 * Storage backend registry.
 *
 * Loads secondline-backends.json (committed, no secrets) and resolves env
 * vars into a usable StorageBackend with credentials. The registry is the
 * extension point: adding a new backend at v2 = append a JSON entry + add
 * the credential env vars to Coolify. No code change.
 *
 * Singleton-with-reset pattern so tests can blow away cache between cases.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEnv } from '@/lib/env';
import type { BackendId, BackendRegistryEntry, StorageBackend } from '../types';

let _cache: Map<BackendId, StorageBackend> | null = null;

function configPath(): string {
  return resolve(process.cwd(), 'secondline-backends.json');
}

export function resetBackendsCache(): void {
  _cache = null;
}

export function loadBackends(): StorageBackend[] {
  if (_cache) return Array.from(_cache.values());

  const raw = readFileSync(configPath(), 'utf8');
  const parsed = JSON.parse(raw) as { backends: BackendRegistryEntry[] };
  if (!Array.isArray(parsed.backends)) {
    throw new Error('secondline-backends.json: expected { backends: [...] }');
  }

  const cache = new Map<BackendId, StorageBackend>();
  for (const entry of parsed.backends) {
    const accessKey = getEnv(entry.access_key_env);
    const secretKey = getEnv(entry.secret_key_env);
    if (!accessKey) throw new Error(`Backend ${entry.id}: missing env var ${entry.access_key_env}`);
    if (!secretKey) throw new Error(`Backend ${entry.id}: missing env var ${entry.secret_key_env}`);
    cache.set(entry.id, {
      id: entry.id,
      label: entry.label,
      endpoint: entry.endpoint,
      region: entry.region,
      bucket: entry.bucket,
      accessKey,
      secretKey,
      forcePathStyle: !!entry.force_path_style,
    });
  }

  _cache = cache;
  return Array.from(cache.values());
}

export function getBackend(id: BackendId): StorageBackend {
  if (!_cache) loadBackends();
  const b = _cache!.get(id);
  if (!b) throw new Error(`Unknown storage backend: ${id}`);
  return b;
}

export function listBackends(): StorageBackend[] {
  return loadBackends();
}
```

- [ ] **Step 5: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/storage/__tests__/backends.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add secondline-backends.json src/lib/secondline/storage/backends.ts src/lib/secondline/storage/__tests__/backends.test.ts
git commit -m "feat(secondline): storage backend registry with wasabi entry"
```

---

## Task 11: S3 client wrapper

**Files:**
- Create: `src/lib/secondline/storage/s3.ts`
- Create: `src/lib/secondline/storage/__tests__/s3.test.ts`

The wrapper centralizes AWS SDK setup per backend and exposes a small surface (put, get-stream, head, delete, list) so the rest of the code never imports `@aws-sdk/client-s3` directly.

- [ ] **Step 1: Write failing test**

Create `src/lib/secondline/storage/__tests__/s3.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { StorageBackend } from '../../types';

// Mock the AWS SDK before importing the wrapper
vi.mock('@aws-sdk/client-s3', () => {
  const send = vi.fn();
  return {
    S3Client: vi.fn().mockImplementation(opts => ({ send, _opts: opts })),
    PutObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'put', input })),
    GetObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'get', input })),
    DeleteObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'del', input })),
    HeadObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'head', input })),
    ListObjectsV2Command: vi.fn().mockImplementation(input => ({ _cmd: 'list', input })),
  };
});

import * as awsMock from '@aws-sdk/client-s3';
import { createS3Adapter } from '../s3';

const backend: StorageBackend = {
  id: 'wasabi', label: 'Wasabi',
  endpoint: 'https://s3.us-east-1.wasabisys.com',
  region: 'us-east-1', bucket: 'secondline-prod',
  accessKey: 'AK', secretKey: 'SK', forcePathStyle: false,
};

describe('s3 adapter', () => {
  it('constructs an S3Client with the backend credentials and endpoint', () => {
    createS3Adapter(backend);
    expect(awsMock.S3Client).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: backend.endpoint,
      region: backend.region,
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      forcePathStyle: false,
    }));
  });

  it('putObject sends a PutObjectCommand with bucket/key/body/contentType', async () => {
    const adapter = createS3Adapter(backend);
    const send = (adapter as unknown as { _send: ReturnType<typeof vi.fn> })._send;
    send.mockResolvedValueOnce({});
    await adapter.putObject({ key: 'a/b.jpg', body: Buffer.from('x'), contentType: 'image/jpeg' });
    expect(awsMock.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'secondline-prod', Key: 'a/b.jpg', Body: Buffer.from('x'), ContentType: 'image/jpeg',
      CacheControl: undefined, Metadata: undefined,
    });
    expect(send).toHaveBeenCalled();
  });

  it('getObjectStream returns the SDK response Body', async () => {
    const adapter = createS3Adapter(backend);
    const send = (adapter as unknown as { _send: ReturnType<typeof vi.fn> })._send;
    const fakeStream = { pipe: vi.fn() };
    send.mockResolvedValueOnce({ Body: fakeStream, ContentType: 'image/jpeg', ContentLength: 999 });
    const r = await adapter.getObjectStream('a/b.jpg');
    expect(r.body).toBe(fakeStream);
    expect(r.contentType).toBe('image/jpeg');
    expect(r.contentLength).toBe(999);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/storage/__tests__/s3.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `s3.ts`**

Create `src/lib/secondline/storage/s3.ts`:

```ts
/**
 * Thin AWS SDK v3 wrapper.
 *
 * One adapter per StorageBackend. The rest of the codebase only imports
 * createS3Adapter and the returned S3Adapter interface — never @aws-sdk/client-s3
 * directly. Keeps the SDK swappable and tests easy.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { StorageBackend } from '../types';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | Readable;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectStreamResult {
  body: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
}

export interface S3Adapter {
  putObject(input: PutObjectInput): Promise<void>;
  getObjectStream(key: string): Promise<GetObjectStreamResult>;
  headObject(key: string): Promise<{ contentType?: string; contentLength?: number } | null>;
  deleteObject(key: string): Promise<void>;
  listObjectKeys(prefix: string): Promise<string[]>;
}

export function createS3Adapter(backend: StorageBackend): S3Adapter {
  const client = new S3Client({
    endpoint: backend.endpoint,
    region: backend.region,
    credentials: { accessKeyId: backend.accessKey, secretAccessKey: backend.secretKey },
    forcePathStyle: backend.forcePathStyle,
  });

  // Exposed for tests; not part of the public interface.
  const _send = (cmd: unknown) => (client as unknown as { send: (c: unknown) => Promise<unknown> }).send(cmd);

  const adapter: S3Adapter & { _send: typeof _send } = {
    _send,
    async putObject({ key, body, contentType, cacheControl, metadata }) {
      await _send(new PutObjectCommand({
        Bucket: backend.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: metadata,
      }));
    },
    async getObjectStream(key) {
      const res = await _send(new GetObjectCommand({ Bucket: backend.bucket, Key: key })) as {
        Body: Readable; ContentType?: string; ContentLength?: number;
      };
      return { body: res.Body, contentType: res.ContentType, contentLength: res.ContentLength };
    },
    async headObject(key) {
      try {
        const res = await _send(new HeadObjectCommand({ Bucket: backend.bucket, Key: key })) as {
          ContentType?: string; ContentLength?: number;
        };
        return { contentType: res.ContentType, contentLength: res.ContentLength };
      } catch (err: unknown) {
        const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
        throw err;
      }
    },
    async deleteObject(key) {
      await _send(new DeleteObjectCommand({ Bucket: backend.bucket, Key: key }));
    },
    async listObjectKeys(prefix) {
      const out: string[] = [];
      let token: string | undefined;
      do {
        const res = await _send(new ListObjectsV2Command({
          Bucket: backend.bucket, Prefix: prefix, ContinuationToken: token,
        })) as { Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string };
        for (const obj of (res.Contents ?? [])) {
          if (obj.Key) out.push(obj.Key);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
  };
  return adapter;
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/storage/__tests__/s3.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/storage/s3.ts src/lib/secondline/storage/__tests__/s3.test.ts
git commit -m "feat(secondline): S3 adapter wrapping @aws-sdk/client-s3 v3"
```

---

## Task 12: Events DB layer

**Files:**
- Create: `src/lib/secondline/events.ts`
- Create: `src/lib/secondline/__tests__/events.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/secondline/__tests__/events.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite from 'node:sqlite';
import { bootstrapSchema, __setDbForTest } from '../../db';
import {
  createEvent, getEventBySlug, getEventById,
  setPicTimeUrl, markExpired, listActiveEvents, markFirstUpload, markWarned30,
} from '../events';

let db: sqlite.DatabaseSync;

beforeEach(() => {
  db = new sqlite.DatabaseSync(':memory:');
  bootstrapSchema(db);
  __setDbForTest(db);
});

afterEach(() => {
  __setDbForTest(null);
});

describe('events DB layer', () => {
  it('createEvent inserts a row and returns it with a unique slug and computed expires_at', () => {
    const ev = createEvent({
      host_first_name: 'Sarah', host_last_name: 'Beaumont',
      host_email: 'sarah@example.com', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    expect(ev.slug).toHaveLength(8);
    expect(ev.status).toBe('active');
    expect(ev.expires_at).toBeTruthy();
    // 180 days from 2026-08-01 = 2027-01-28
    expect(ev.expires_at!.startsWith('2027-01-28')).toBe(true);
    expect(ev.host_first_name).toBe('Sarah');
  });

  it('createEvent uses default backend when not specified', () => {
    process.env.SECONDLINE_ACTIVE_BACKEND = 'wasabi';
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
    });
    expect(ev.storage_backend_id).toBe('wasabi');
  });

  it('getEventBySlug returns the row when slug matches, null otherwise', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    expect(getEventBySlug(ev.slug)?.id).toBe(ev.id);
    expect(getEventBySlug('zzzzzzzz')).toBeNull();
  });

  it('setPicTimeUrl updates the URL', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    setPicTimeUrl(ev.id, 'https://pictime.example/abc');
    expect(getEventBySlug(ev.slug)?.pictime_gallery_url).toBe('https://pictime.example/abc');
  });

  it('markExpired flips status', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    markExpired(ev.id);
    expect(getEventBySlug(ev.slug)?.status).toBe('expired');
  });

  it('markFirstUpload sets first_upload_at only once (idempotent)', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    markFirstUpload(ev.id);
    const first = getEventBySlug(ev.slug)!;
    expect(first.first_upload_at).toBeTruthy();
    markFirstUpload(ev.id);
    const second = getEventBySlug(ev.slug)!;
    expect(second.first_upload_at).toBe(first.first_upload_at);
  });

  it('markWarned30 sets warned_30_at only once', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    markWarned30(ev.id);
    const first = getEventBySlug(ev.slug)!;
    expect(first.warned_30_at).toBeTruthy();
    markWarned30(ev.id);
    const second = getEventBySlug(ev.slug)!;
    expect(second.warned_30_at).toBe(first.warned_30_at);
  });

  it('listActiveEvents returns only active events', () => {
    const a = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    const b = createEvent({
      host_first_name: 'C', host_last_name: 'D',
      host_email: 'c@d.e', event_date: '2026-09-01',
      storage_backend_id: 'wasabi',
    });
    markExpired(b.id);
    const active = listActiveEvents();
    const ids = active.map(e => e.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it('getEventById round-trips', () => {
    const ev = createEvent({
      host_first_name: 'A', host_last_name: 'B',
      host_email: 'a@b.c', event_date: '2026-08-01',
      storage_backend_id: 'wasabi',
    });
    expect(getEventById(ev.id)?.slug).toBe(ev.slug);
    expect(getEventById(99999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/__tests__/events.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `events.ts`**

Create `src/lib/secondline/events.ts`:

```ts
/**
 * Second Line events DB layer.
 *
 * One event = one host's gallery + wall. Created manually by an operator
 * via /admin/events/new (Task 24). Storage backend is locked at creation;
 * cross-backend migration is out of scope for v1.
 */

import { getDb } from '../db';
import { getEnv } from '../env';
import { generateSlug } from './slugs';
import type { EventRow } from './types';

const RETENTION_DAYS = 180;

function defaultBackendId(): string {
  return getEnv('SECONDLINE_ACTIVE_BACKEND') || 'wasabi';
}

function computeExpiresAt(eventDate: string): string | null {
  if (!eventDate) return null;
  const d = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + RETENTION_DAYS);
  return d.toISOString();
}

export interface CreateEventInput {
  host_first_name: string;
  host_last_name: string;
  host_email: string;
  event_date: string;           // YYYY-MM-DD
  storage_backend_id?: string;  // defaults to SECONDLINE_ACTIVE_BACKEND
  pictime_gallery_url?: string | null;
}

export function createEvent(input: CreateEventInput): EventRow {
  const backend = input.storage_backend_id || defaultBackendId();
  const expires_at = computeExpiresAt(input.event_date);
  const stmt = getDb().prepare(`
    INSERT INTO events (slug, storage_backend_id, host_first_name, host_last_name, host_email,
                        event_date, pictime_gallery_url, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
    RETURNING *
  `);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return stmt.get(
        generateSlug(),
        backend,
        input.host_first_name,
        input.host_last_name,
        input.host_email,
        input.event_date,
        input.pictime_gallery_url ?? null,
        expires_at,
      ) as EventRow;
    } catch (err: unknown) {
      const msg = String((err as Error)?.message ?? '');
      if (attempt === 7 || !/UNIQUE/i.test(msg)) throw err;
    }
  }
  throw new Error('createEvent: slug generation exhausted retries');
}

export function getEventBySlug(slug: string): EventRow | null {
  return (getDb().prepare(`SELECT * FROM events WHERE slug = ?`).get(slug) as EventRow | undefined) ?? null;
}

export function getEventById(id: number): EventRow | null {
  return (getDb().prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined) ?? null;
}

export function setPicTimeUrl(eventId: number, url: string | null): void {
  getDb().prepare(`UPDATE events SET pictime_gallery_url = ? WHERE id = ?`).run(url, eventId);
}

export function setBackend(eventId: number, backendId: string): void {
  // Caller must enforce "no assets yet"; we don't second-guess.
  getDb().prepare(`UPDATE events SET storage_backend_id = ? WHERE id = ?`).run(backendId, eventId);
}

export function markExpired(eventId: number): void {
  getDb().prepare(`UPDATE events SET status = 'expired' WHERE id = ?`).run(eventId);
}

export function markFirstUpload(eventId: number): void {
  getDb().prepare(`UPDATE events SET first_upload_at = COALESCE(first_upload_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(eventId);
}

export function markWarned30(eventId: number): void {
  getDb().prepare(`UPDATE events SET warned_30_at = COALESCE(warned_30_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(eventId);
}

export function listActiveEvents(): EventRow[] {
  return getDb().prepare(`SELECT * FROM events WHERE status = 'active' ORDER BY created_at DESC`).all() as EventRow[];
}

export function listEventsExpiringBefore(iso: string): EventRow[] {
  return getDb().prepare(`SELECT * FROM events WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`).all(iso) as EventRow[];
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/__tests__/events.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/events.ts src/lib/secondline/__tests__/events.test.ts
git commit -m "feat(secondline): events DB layer"
```

---

## Task 13: Assets DB layer

**Files:**
- Create: `src/lib/secondline/assets.ts`
- Create: `src/lib/secondline/__tests__/assets.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/secondline/__tests__/assets.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite from 'node:sqlite';
import { bootstrapSchema, __setDbForTest } from '../../db';
import { createEvent } from '../events';
import {
  recordAsset, listAssetsForEvent, getAsset, softDeleteAsset,
  countAssetsForEvent, listAssetsSince, totalBytesForEvent, listAllAssetsForPurge,
} from '../assets';

let db: sqlite.DatabaseSync;
let eventId: number;

beforeEach(() => {
  db = new sqlite.DatabaseSync(':memory:');
  bootstrapSchema(db);
  __setDbForTest(db);
  eventId = createEvent({
    host_first_name: 'A', host_last_name: 'B',
    host_email: 'a@b.c', event_date: '2026-08-01',
    storage_backend_id: 'wasabi',
  }).id;
});

afterEach(() => { __setDbForTest(null); });

describe('assets DB layer', () => {
  it('recordAsset inserts and returns the new row', () => {
    const a = recordAsset({
      eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: 'k/1_thumb.jpg',
      mimeType: 'image/jpeg', byteSize: 100_000, width: 1024, height: 768, durationMs: null, uploaderName: 'Alice',
    });
    expect(a.id).toBeGreaterThan(0);
    expect(a.storage_key).toBe('k/1.jpg');
  });

  it('listAssetsForEvent returns alive assets in upload order', () => {
    recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    const list = listAssetsForEvent(eventId);
    expect(list.map(a => a.storage_key)).toEqual(['k/1.jpg', 'k/2.jpg']);
  });

  it('softDeleteAsset hides asset from listAssetsForEvent but row remains', () => {
    const a = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    softDeleteAsset(a.id);
    expect(listAssetsForEvent(eventId)).toHaveLength(0);
    expect(getAsset(a.id)?.deleted_at).toBeTruthy();
  });

  it('countAssetsForEvent counts only alive', () => {
    const a = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    expect(countAssetsForEvent(eventId)).toBe(2);
    softDeleteAsset(a.id);
    expect(countAssetsForEvent(eventId)).toBe(1);
  });

  it('listAssetsSince returns assets uploaded strictly after the given ISO ts', () => {
    const first = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    db.prepare(`UPDATE assets SET uploaded_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(first.id);
    const second = recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    const since = listAssetsSince(eventId, '2021-01-01T00:00:00Z');
    expect(since.map(a => a.id)).toEqual([second.id]);
  });

  it('totalBytesForEvent sums byte_size of alive assets', () => {
    recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1000, width: 1, height: 1, durationMs: null, uploaderName: null });
    recordAsset({ eventId, source: 'guest', storageKey: 'k/2.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 2500, width: 1, height: 1, durationMs: null, uploaderName: null });
    expect(totalBytesForEvent(eventId)).toBe(3500);
  });

  it('listAllAssetsForPurge includes soft-deleted rows', () => {
    const a = recordAsset({ eventId, source: 'guest', storageKey: 'k/1.jpg', thumbStorageKey: null,
      mimeType: 'image/jpeg', byteSize: 1, width: 1, height: 1, durationMs: null, uploaderName: null });
    softDeleteAsset(a.id);
    expect(listAllAssetsForPurge(eventId)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/__tests__/assets.test.ts
```

- [ ] **Step 3: Implement `assets.ts`**

Create `src/lib/secondline/assets.ts`:

```ts
/**
 * Second Line assets DB layer.
 *
 * Soft-deletes only (deleted_at column); operator removal is reversible until
 * the retention sweep hard-purges the storage object. Public listing always
 * filters deleted_at IS NULL.
 */

import { getDb } from '../db';
import type { AssetRow, AssetSource } from './types';

export interface RecordAssetInput {
  eventId: number;
  source: AssetSource;
  storageKey: string;
  thumbStorageKey: string | null;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  uploaderName: string | null;
}

export function recordAsset(input: RecordAssetInput): AssetRow {
  return getDb().prepare(`
    INSERT INTO assets
      (event_id, source, storage_key, thumb_storage_key, mime_type, byte_size, width, height, duration_ms, uploader_name, uploaded_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    RETURNING *
  `).get(
    input.eventId, input.source, input.storageKey, input.thumbStorageKey,
    input.mimeType, input.byteSize, input.width, input.height, input.durationMs, input.uploaderName,
  ) as AssetRow;
}

export function getAsset(id: number): AssetRow | null {
  return (getDb().prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow | undefined) ?? null;
}

export function listAssetsForEvent(eventId: number): AssetRow[] {
  return getDb().prepare(`
    SELECT * FROM assets
    WHERE event_id = ? AND deleted_at IS NULL
    ORDER BY uploaded_at ASC, id ASC
  `).all(eventId) as AssetRow[];
}

export function listAssetsSince(eventId: number, sinceIso: string): AssetRow[] {
  return getDb().prepare(`
    SELECT * FROM assets
    WHERE event_id = ? AND deleted_at IS NULL AND uploaded_at > ?
    ORDER BY uploaded_at ASC, id ASC
  `).all(eventId, sinceIso) as AssetRow[];
}

export function softDeleteAsset(id: number): void {
  getDb().prepare(`UPDATE assets SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

export function countAssetsForEvent(eventId: number): number {
  const r = getDb().prepare(`SELECT COUNT(*) AS n FROM assets WHERE event_id = ? AND deleted_at IS NULL`).get(eventId) as { n: number };
  return r.n;
}

export function totalBytesForEvent(eventId: number): number {
  const r = getDb().prepare(`SELECT COALESCE(SUM(byte_size), 0) AS s FROM assets WHERE event_id = ? AND deleted_at IS NULL`).get(eventId) as { s: number };
  return r.s;
}

export function listAllAssetsForPurge(eventId: number): AssetRow[] {
  return getDb().prepare(`SELECT * FROM assets WHERE event_id = ?`).all(eventId) as AssetRow[];
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/__tests__/assets.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/assets.ts src/lib/secondline/__tests__/assets.test.ts
git commit -m "feat(secondline): assets DB layer with soft-delete and since-cursor"
```

---

## Task 14: Media processing — HEIC/EXIF/thumbnail pipeline

**Files:**
- Create: `src/lib/secondline/media-processing.ts`
- Create: `src/lib/secondline/__tests__/media-processing.test.ts`

The pipeline takes a raw uploaded `Buffer` + its declared MIME and returns a normalized `{ main, thumb, mimeType, width, height, durationMs }` ready to write to S3. For images, `thumb` is a 400 px-edge JPEG. For videos, `thumb` is `null` in v1 — we don't transcode and don't run ffprobe. The wall and gallery handle null thumbs by reusing the main asset URL; the media thumb route falls back to the main object when `thumb_storage_key IS NULL`.

- [ ] **Step 1: Write failing tests**

Create `src/lib/secondline/__tests__/media-processing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  processImageUpload, processVideoUpload, isAcceptedMime,
  ACCEPTED_IMAGE_MIME, ACCEPTED_VIDEO_MIME, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
} from '../media-processing';

async function makeJpegBuffer(w = 200, h = 100): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
}

describe('media-processing', () => {
  it('isAcceptedMime accepts jpeg, png, webp, heic, heif, common video MIMEs', () => {
    for (const m of ACCEPTED_IMAGE_MIME) expect(isAcceptedMime(m)).toBe(true);
    for (const m of ACCEPTED_VIDEO_MIME) expect(isAcceptedMime(m)).toBe(true);
    expect(isAcceptedMime('application/pdf')).toBe(false);
    expect(isAcceptedMime('image/gif')).toBe(false);   // explicitly not in v1
  });

  it('processImageUpload returns normalized JPEG + thumbnail + dimensions', async () => {
    const input = await makeJpegBuffer(800, 600);
    const r = await processImageUpload(input, 'image/jpeg');
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    expect(r.main.length).toBeGreaterThan(0);
    expect(r.thumb!.length).toBeGreaterThan(0);
    expect(r.thumb!.length).toBeLessThan(r.main.length);
    const tmeta = await sharp(r.thumb!).metadata();
    expect(Math.max(tmeta.width ?? 0, tmeta.height ?? 0)).toBeLessThanOrEqual(400);
  });

  it('processImageUpload rotates per EXIF before measuring', async () => {
    const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await processImageUpload(input, 'image/jpeg');
    // After auto-rotation, what was 200×100 with orientation=6 becomes 100×200
    expect(r.width).toBe(100);
    expect(r.height).toBe(200);
  });

  it('processImageUpload rejects oversize images', async () => {
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    await expect(processImageUpload(huge, 'image/jpeg')).rejects.toThrow(/size/i);
  });

  it('processVideoUpload passes the body through and returns null dimensions', async () => {
    const buf = Buffer.alloc(1024);
    const r = await processVideoUpload(buf, 'video/mp4');
    expect(r.main).toBe(buf);
    expect(r.mimeType).toBe('video/mp4');
    expect(r.width).toBeNull();
    expect(r.height).toBeNull();
  });

  it('processVideoUpload rejects oversize videos', async () => {
    const huge = Buffer.alloc(MAX_VIDEO_BYTES + 1);
    await expect(processVideoUpload(huge, 'video/mp4')).rejects.toThrow(/size/i);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/__tests__/media-processing.test.ts
```

- [ ] **Step 3: Implement `media-processing.ts`**

Create `src/lib/secondline/media-processing.ts`:

```ts
/**
 * Second Line media processing.
 *
 * Photos: HEIC/HEIF → JPEG conversion, EXIF auto-rotate, dimension extraction,
 * thumbnail generation (400 px longest edge). Output is always JPEG.
 *
 * Videos: pass-through. We do not transcode in v1. We don't even probe frame
 * size — that requires ffprobe which is out of scope. The wall renders videos
 * at their native aspect ratio via the same padding rule as photos, so size
 * matters only for the layout math; null dimensions are tolerated.
 *
 * Size limits per the decision matrix:
 *   - Photos: 10 MB
 *   - Videos: 50 MB
 */

import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;   // 50 MB

export const ACCEPTED_IMAGE_MIME = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
];
export const ACCEPTED_VIDEO_MIME = [
  'video/mp4', 'video/quicktime', 'video/webm',
];
export const ALL_ACCEPTED_MIME = [...ACCEPTED_IMAGE_MIME, ...ACCEPTED_VIDEO_MIME];

const THUMB_MAX_EDGE = 400;

export function isAcceptedMime(m: string): boolean {
  return ALL_ACCEPTED_MIME.includes(m.toLowerCase());
}

export function isImageMime(m: string): boolean {
  return ACCEPTED_IMAGE_MIME.includes(m.toLowerCase());
}

export function isVideoMime(m: string): boolean {
  return ACCEPTED_VIDEO_MIME.includes(m.toLowerCase());
}

export interface ProcessedMedia {
  main: Buffer;
  thumb: Buffer | null;
  mimeType: string;             // canonical MIME of `main`
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export async function processImageUpload(input: Buffer, declaredMime: string): Promise<ProcessedMedia> {
  if (input.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image size ${input.length} exceeds max ${MAX_IMAGE_BYTES}`);
  }
  if (!isImageMime(declaredMime)) {
    throw new Error(`Unsupported image MIME: ${declaredMime}`);
  }

  // .rotate() with no args = EXIF-aware auto-rotate
  const pipeline = sharp(input).rotate();
  const meta = await pipeline.metadata();
  const width = meta.width ?? null;
  const height = meta.height ?? null;

  const main = await pipeline.clone().jpeg({ quality: 90, mozjpeg: true, progressive: true }).toBuffer();
  const thumb = await pipeline.clone().resize({
    width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true,
  }).jpeg({ quality: 75, mozjpeg: true, progressive: true }).toBuffer();

  return { main, thumb, mimeType: 'image/jpeg', width, height, durationMs: null };
}

export async function processVideoUpload(input: Buffer, declaredMime: string): Promise<ProcessedMedia> {
  if (input.length > MAX_VIDEO_BYTES) {
    throw new Error(`Video size ${input.length} exceeds max ${MAX_VIDEO_BYTES}`);
  }
  if (!isVideoMime(declaredMime)) {
    throw new Error(`Unsupported video MIME: ${declaredMime}`);
  }
  // Pass-through. v2+ may add ffprobe-based dimensions and thumbnail extraction.
  return { main: input, thumb: null, mimeType: declaredMime.toLowerCase(), width: null, height: null, durationMs: null };
}

/**
 * Top-level dispatcher used by the upload route.
 */
export async function processUpload(input: Buffer, declaredMime: string): Promise<ProcessedMedia> {
  if (isImageMime(declaredMime)) return processImageUpload(input, declaredMime);
  if (isVideoMime(declaredMime)) return processVideoUpload(input, declaredMime);
  throw new Error(`Unsupported MIME: ${declaredMime}`);
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/__tests__/media-processing.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/media-processing.ts src/lib/secondline/__tests__/media-processing.test.ts
git commit -m "feat(secondline): media processing pipeline (HEIC->JPEG, EXIF rotate, thumbnail)"
```

---

## Task 15: SSE broadcaster

**Files:**
- Create: `src/lib/secondline/sse.ts`
- Create: `src/lib/secondline/__tests__/sse.test.ts`

Per-process in-memory subscriber registry keyed by `event_id`. Subscribers register a `send(line: string)` callback; on broadcast, we write to all live subscribers and drop any whose callback throws. Single container = no multi-instance fanout needed.

- [ ] **Step 1: Write failing test**

Create `src/lib/secondline/__tests__/sse.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/__tests__/sse.test.ts
```

- [ ] **Step 3: Implement `sse.ts`**

Create `src/lib/secondline/sse.ts`:

```ts
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
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/__tests__/sse.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/sse.ts src/lib/secondline/__tests__/sse.test.ts
git commit -m "feat(secondline): in-process SSE hub for per-event broadcasts"
```

---

## Task 16: Upload API endpoint

**Files:**
- Create: `src/pages/api/upload.ts`

The endpoint accepts a single file at a time (the client iterates over the FileList and POSTs each one). Multipart form-data; field name `file`; optional `uploader_name` field; required `slug` field. Server:

1. Validates slug → load event
2. Refuses if event status is `expired`
3. Validates file MIME via `isAcceptedMime`
4. Reads body to Buffer (up to 50 MB)
5. `processUpload(buf, mime)` → normalized main + thumb
6. `getBackend(event.storage_backend_id)` → `createS3Adapter()`
7. Generate storage keys: `<event-id>/<asset-uuid>.<ext>`
8. Upload to S3 (Promise.all main + thumb)
9. `recordAsset(...)` in DB
10. `markFirstUpload(event.id)`
11. Build `PublicAsset`, broadcast SSE
12. Return `{ ok: true, asset }`

- [ ] **Step 1: Implement `src/pages/api/upload.ts`**

```ts
/**
 * Second Line guest upload endpoint.
 *
 * POST multipart/form-data
 *   - file: required, the photo/video bytes
 *   - slug: required, the event slug
 *   - uploader_name: optional, guest-supplied name
 *
 * Per-file POST (the client loops over a FileList). Single-shot upload —
 * no chunking, no multipart S3 — backed by the service worker for retry
 * on flaky networks. Max body size: 50 MB (videos) / 10 MB (images);
 * processUpload enforces both.
 *
 * Never throws to the client. On any failure returns { ok: false, error }
 * with the right HTTP status, and the service worker retries.
 */

import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { getEventBySlug, markFirstUpload } from '@/lib/secondline/events';
import { recordAsset } from '@/lib/secondline/assets';
import { processUpload, isAcceptedMime, isImageMime, MAX_VIDEO_BYTES } from '@/lib/secondline/media-processing';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';
import { getSseHub } from '@/lib/secondline/sse';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { PublicAsset, SseAssetAdded } from '@/lib/secondline/types';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const ctype = request.headers.get('content-type') ?? '';
    if (!ctype.includes('multipart/form-data')) {
      return json(415, { ok: false, error: 'Expected multipart/form-data' });
    }
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '');
    if (!isValidSlugShape(slug)) return json(400, { ok: false, error: 'Invalid slug' });

    const event = getEventBySlug(slug);
    if (!event) return json(404, { ok: false, error: 'Event not found' });
    if (event.status === 'expired') return json(410, { ok: false, error: 'Event has expired' });

    const file = form.get('file');
    if (!(file instanceof File)) return json(400, { ok: false, error: 'Missing file' });
    if (file.size === 0) return json(400, { ok: false, error: 'Empty file' });
    if (file.size > MAX_VIDEO_BYTES) return json(413, { ok: false, error: 'File too large' });

    const declaredMime = (file.type || 'application/octet-stream').toLowerCase();
    if (!isAcceptedMime(declaredMime)) return json(415, { ok: false, error: `Unsupported type ${declaredMime}` });

    const uploaderNameRaw = form.get('uploader_name');
    const uploaderName = typeof uploaderNameRaw === 'string' && uploaderNameRaw.trim()
      ? uploaderNameRaw.trim().slice(0, 80)
      : null;

    const buf = Buffer.from(await file.arrayBuffer());
    const processed = await processUpload(buf, declaredMime);

    const assetUuid = randomUUID();
    const ext = isImageMime(processed.mimeType) ? 'jpg' : extForVideoMime(processed.mimeType);
    const mainKey = `${event.id}/${assetUuid}.${ext}`;
    const thumbKey = processed.thumb ? `${event.id}/${assetUuid}_thumb.jpg` : null;

    const backend = getBackend(event.storage_backend_id);
    const s3 = createS3Adapter(backend);
    const ops: Promise<void>[] = [
      s3.putObject({
        key: mainKey, body: processed.main, contentType: processed.mimeType,
        cacheControl: 'public, max-age=31536000, immutable',
      }),
    ];
    if (thumbKey && processed.thumb) {
      ops.push(s3.putObject({
        key: thumbKey, body: processed.thumb, contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      }));
    }
    await Promise.all(ops);

    const asset = recordAsset({
      eventId: event.id,
      source: 'guest',
      storageKey: mainKey,
      thumbStorageKey: thumbKey,
      mimeType: processed.mimeType,
      byteSize: processed.main.length,
      width: processed.width,
      height: processed.height,
      durationMs: processed.durationMs,
      uploaderName,
    });

    markFirstUpload(event.id);

    const publicAsset: PublicAsset = {
      id: asset.id,
      src: `/m/${event.slug}/${asset.id}`,
      thumb: asset.thumb_storage_key ? `/m/${event.slug}/${asset.id}_thumb` : `/m/${event.slug}/${asset.id}`,
      mime_type: asset.mime_type,
      width: asset.width,
      height: asset.height,
      duration_ms: asset.duration_ms,
      uploader_name: asset.uploader_name,
      uploaded_at: asset.uploaded_at,
    };
    const msg: SseAssetAdded = { type: 'asset.added', asset: publicAsset, ts: asset.uploaded_at };
    getSseHub().broadcast(event.id, msg);

    return json(200, { ok: true, asset: publicAsset });
  } catch (err) {
    console.error('[secondline] upload failed', err);
    return json(500, { ok: false, error: 'Internal error' });
  }
};

function extForVideoMime(mime: string): string {
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  return 'bin';
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
```

- [ ] **Step 2: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add src/pages/api/upload.ts
git commit -m "feat(secondline): POST /api/upload accepting multipart guest uploads"
```

---

## Task 17: Assets list + since-cursor endpoints

**Files:**
- Create: `src/pages/api/events/[slug]/assets.ts`
- Create: `src/pages/api/events/[slug]/since.ts`

- [ ] **Step 1: Write the assets listing endpoint**

Create `src/pages/api/events/[slug]/assets.ts`:

```ts
/**
 * GET /api/events/<slug>/assets
 * Returns the full asset list for an event (used by the wall and gallery on
 * initial load). Slug-gated. No auth.
 */

import type { APIRoute } from 'astro';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsForEvent } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { PublicAsset, AssetRow } from '@/lib/secondline/types';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return json(400, { error: 'Invalid slug' });
  const event = getEventBySlug(slug);
  if (!event) return json(404, { error: 'Not found' });
  if (event.status === 'expired' && event.pictime_gallery_url) {
    return new Response(null, { status: 302, headers: { Location: event.pictime_gallery_url } });
  }
  const rows = listAssetsForEvent(event.id);
  return json(200, {
    event: { slug: event.slug, status: event.status },
    assets: rows.map(r => toPublic(r, event.slug)),
  });
};

function toPublic(r: AssetRow, slug: string): PublicAsset {
  return {
    id: r.id,
    src: `/m/${slug}/${r.id}`,
    thumb: r.thumb_storage_key ? `/m/${slug}/${r.id}_thumb` : `/m/${slug}/${r.id}`,
    mime_type: r.mime_type,
    width: r.width, height: r.height, duration_ms: r.duration_ms,
    uploader_name: r.uploader_name, uploaded_at: r.uploaded_at,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
```

- [ ] **Step 2: Write the since-cursor endpoint**

Create `src/pages/api/events/[slug]/since.ts`:

```ts
/**
 * GET /api/events/<slug>/since?ts=<ISO>
 * Returns assets uploaded strictly after `ts`. Used by the wall to catch up
 * after an SSE disconnect.
 */

import type { APIRoute } from 'astro';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsSince } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { AssetRow, PublicAsset } from '@/lib/secondline/types';

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return json(400, { error: 'Invalid slug' });
  const event = getEventBySlug(slug);
  if (!event) return json(404, { error: 'Not found' });

  const ts = url.searchParams.get('ts') ?? '';
  if (!ts || Number.isNaN(Date.parse(ts))) return json(400, { error: 'Invalid ts' });

  const rows = listAssetsSince(event.id, ts);
  return json(200, { assets: rows.map(r => toPublic(r, event.slug)) });
};

function toPublic(r: AssetRow, slug: string): PublicAsset {
  return {
    id: r.id,
    src: `/m/${slug}/${r.id}`,
    thumb: r.thumb_storage_key ? `/m/${slug}/${r.id}_thumb` : `/m/${slug}/${r.id}`,
    mime_type: r.mime_type,
    width: r.width, height: r.height, duration_ms: r.duration_ms,
    uploader_name: r.uploader_name, uploaded_at: r.uploaded_at,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
```

- [ ] **Step 3: Verify typecheck**

```sh
pnpm typecheck
```

- [ ] **Step 4: Commit**

```sh
git add src/pages/api/events/[slug]/assets.ts src/pages/api/events/[slug]/since.ts
git commit -m "feat(secondline): assets-list and since-cursor GET endpoints"
```

---

## Task 18: SSE stream endpoint

**Files:**
- Create: `src/pages/api/events/[slug]/stream.ts`

The Astro Node adapter supports streaming responses. We return a `ReadableStream` whose `start(controller)` registers an SSE subscriber that writes via `controller.enqueue`. Keep-alive comment every 25s.

- [ ] **Step 1: Implement the SSE stream endpoint**

Create `src/pages/api/events/[slug]/stream.ts`:

```ts
/**
 * GET /api/events/<slug>/stream
 * Server-Sent Events stream of asset.added/asset.removed events.
 *
 * The handler does NOT replay history. Clients are expected to:
 *   1. GET /assets on connect to seed initial state
 *   2. Open this stream
 *   3. If the stream drops, reconnect and call /since?ts=<last-seen> to catch up
 *
 * Why: pushing history through SSE complicates ordering and ack semantics for
 * no benefit. The two-call pattern is dead simple to reason about.
 */

import type { APIRoute } from 'astro';
import { getEventBySlug } from '@/lib/secondline/events';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import { getSseHub } from '@/lib/secondline/sse';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return new Response('Invalid slug', { status: 400 });
  const event = getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });
  if (event.status === 'expired') return new Response('Expired', { status: 410 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send(': connected\n\n');
      unsubscribe = getSseHub().subscribe(event.id, send);
      keepAlive = setInterval(() => {
        try { send(': ka\n\n'); } catch { /* will be cleaned in cancel */ }
      }, 25_000);
    },
    cancel() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
```

- [ ] **Step 2: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add src/pages/api/events/[slug]/stream.ts
git commit -m "feat(secondline): SSE stream endpoint with keep-alive"
```

---

## Task 19: Media proxy endpoints

**Files:**
- Create: `src/pages/m/[slug]/[asset].ts`
- Create: `src/pages/m/[slug]/[asset]_thumb.ts`

These are the routes Coolify maps `media.smile-nola.com` to. They validate `<slug>` + `<asset>` belong together, look up the right backend, stream the object from S3 to the client.

- [ ] **Step 1: Implement main asset proxy**

Create `src/pages/m/[slug]/[asset].ts`:

```ts
/**
 * Media proxy.
 *
 * GET /m/<slug>/<asset-id>
 * Streams the main asset from its backend's S3-compatible store.
 *
 * Access control:
 *   - Slug must shape-match — rejects path traversal at parse time.
 *   - Asset must belong to the event for that slug — prevents cross-event peek.
 *
 * Notes on the proxy lesson from AGENTS.md: this route relies on the request
 * arriving at the app through Traefik. We do NOT inspect Host headers — the
 * route is bound by Astro's path-based matching, not domain matching. Coolify
 * routes BOTH secondline.smile-nola.com AND media.smile-nola.com to the app,
 * and the `/m/*` scoping is done at the Astro level via this file's location.
 */

import type { APIRoute } from 'astro';
import { Readable } from 'node:stream';
import { getEventBySlug } from '@/lib/secondline/events';
import { getAsset } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  const assetRaw = String(params.asset ?? '');
  if (!isValidSlugShape(slug)) return new Response('Bad slug', { status: 400 });
  const assetId = Number(assetRaw);
  if (!Number.isInteger(assetId) || assetId <= 0) return new Response('Bad asset id', { status: 400 });

  const event = getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });
  const asset = getAsset(assetId);
  if (!asset || asset.event_id !== event.id) return new Response('Not found', { status: 404 });
  if (asset.deleted_at) return new Response('Gone', { status: 410 });

  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);

  try {
    const { body, contentType, contentLength } = await s3.getObjectStream(asset.storage_key);
    const webStream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
    const headers: Record<string, string> = {
      'Content-Type': contentType ?? asset.mime_type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (contentLength != null) headers['Content-Length'] = String(contentLength);
    return new Response(webStream, { status: 200, headers });
  } catch (err) {
    console.error('[secondline] media proxy failed', { slug, assetId, err: String(err) });
    return new Response('Backend error', { status: 502 });
  }
};
```

- [ ] **Step 2: Implement thumbnail proxy**

Create `src/pages/m/[slug]/[asset]_thumb.ts`:

```ts
/**
 * GET /m/<slug>/<asset-id>_thumb
 * Streams the asset thumbnail; falls back to main object if no thumb stored
 * (videos in v1 — no extracted frame).
 */

import type { APIRoute } from 'astro';
import { Readable } from 'node:stream';
import { getEventBySlug } from '@/lib/secondline/events';
import { getAsset } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  const assetRaw = String(params.asset ?? '');
  if (!isValidSlugShape(slug)) return new Response('Bad slug', { status: 400 });
  const assetId = Number(assetRaw);
  if (!Number.isInteger(assetId) || assetId <= 0) return new Response('Bad asset id', { status: 400 });

  const event = getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });
  const asset = getAsset(assetId);
  if (!asset || asset.event_id !== event.id) return new Response('Not found', { status: 404 });
  if (asset.deleted_at) return new Response('Gone', { status: 410 });

  const key = asset.thumb_storage_key ?? asset.storage_key;
  const contentType = asset.thumb_storage_key ? 'image/jpeg' : asset.mime_type;

  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);

  try {
    const { body, contentLength } = await s3.getObjectStream(key);
    const webStream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (contentLength != null) headers['Content-Length'] = String(contentLength);
    return new Response(webStream, { status: 200, headers });
  } catch (err) {
    console.error('[secondline] thumb proxy failed', { slug, assetId, err: String(err) });
    return new Response('Backend error', { status: 502 });
  }
};
```

- [ ] **Step 3: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/pages/m/[slug]/[asset].ts src/pages/m/[slug]/[asset]_thumb.ts
git commit -m "feat(secondline): media proxy routes (main + thumb) with slug/asset ownership check"
```

---

## Task 20: Service worker for upload retry

**Files:**
- Create: `public/secondline-sw.js`

The SW owns a queue keyed by uploadId, retries each on a backoff, and posts back to the page on success/failure. No Workbox.

- [ ] **Step 1: Implement the service worker**

Create `public/secondline-sw.js`:

```js
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
```

- [ ] **Step 2: Commit**

```sh
git add public/secondline-sw.js
git commit -m "feat(secondline): service worker for upload retry queue"
```

---

## Task 21: Guest upload page + island

**Files:**
- Create: `src/pages/u/[slug].astro`
- Create: `src/components/secondline/UploadIsland.tsx`

The page is a thin Astro shell: registers the SW, mounts the React island with the slug prop, includes minimal styling. The island handles file picker, name field, optimistic UI per file, per-file progress.

- [ ] **Step 1: Implement the upload page shell**

Create `src/pages/u/[slug].astro`:

```astro
---
/**
 * Guest upload page.
 *
 * Static-rendered shell with a React island. Loads fast on bad wifi.
 * Validates the slug shape SSR-side and 404s early — no JS needed to
 * tell a guest their link is wrong.
 */
import UploadIsland from '@/components/secondline/UploadIsland';
import { getEventBySlug } from '@/lib/secondline/events';
import { isValidSlugShape } from '@/lib/secondline/slugs';

export const prerender = false;

const slug = Astro.params.slug ?? '';
if (!isValidSlugShape(slug)) return Astro.redirect('/404');
const event = getEventBySlug(slug);
if (!event) return Astro.redirect('/404');
if (event.status === 'expired') {
  if (event.pictime_gallery_url) return Astro.redirect(event.pictime_gallery_url);
  return Astro.redirect('/404');
}
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <title>Share your photos · Second Line</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; background: #050505; color: #f8f4ea; font-family: system-ui, sans-serif; }
      .wrap { max-width: 560px; margin: 0 auto; padding: 24px 20px 80px; }
      h1 { font-size: 22px; margin: 8px 0 4px; }
      p.lead { color: #b8b2a5; font-size: 14px; margin: 0 0 24px; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <h1>Add to the wall</h1>
      <p class="lead">Photos & videos appear on the screen here at the event.</p>
      <UploadIsland client:load slug={slug} />
    </main>
    <script is:inline>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/secondline-sw.js').catch(err => console.error('[secondline] SW failed', err));
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: Implement the React upload island**

Create `src/components/secondline/UploadIsland.tsx`:

```tsx
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

type TileState = 'queued' | 'uploading' | 'ok' | 'failed';

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

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(NAME_STORAGE_KEY, trimmed);

    const newTiles: Tile[] = files.map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      previewUrl: URL.createObjectURL(f),
      state: 'queued',
      attempt: 0,
    }));
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
      sw.postMessage({
        type: 'enqueue',
        id: newTiles[i].id,
        slug,
        file: files[i],
        uploaderName: trimmed || null,
      });
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
              {t.state === 'queued' && '·'}
              {t.state === 'failed' && '!'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/pages/u/[slug].astro src/components/secondline/UploadIsland.tsx
git commit -m "feat(secondline): guest upload page and React island with SW-backed retry"
```

---

## Task 22: Wall page + island

**Files:**
- Create: `src/pages/w/[slug].astro`
- Create: `src/components/secondline/WallIsland.tsx`

The wall island:
1. Fetches initial assets via `/api/events/<slug>/assets`
2. Opens SSE to `/api/events/<slug>/stream`
3. On disconnect: reconnects + calls `/since?ts=<last-seen>` to catch up
4. Maintains a sequential rotation through all known assets
5. Pre-caches via the browser's HTTP cache (`<img>`/`<video>` preload)
6. Renders ONE hero at 25%/10% padded layout with 400ms crossfade
7. Renders a background of slowly scrolling blurred thumbnails
8. Fullscreen button + F-key + Esc + auto-hide controls + `?kiosk=1`

- [ ] **Step 1: Implement the wall page shell**

Create `src/pages/w/[slug].astro`:

```astro
---
/**
 * The Wall.
 *
 * SSR shell that fetches the initial asset list server-side so the page can
 * paint media on first frame (no JS-blocking initial load). The React island
 * takes over for SSE + rotation + pre-cache + fullscreen behavior.
 */
import WallIsland from '@/components/secondline/WallIsland';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsForEvent } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { PublicAsset, AssetRow } from '@/lib/secondline/types';

export const prerender = false;

const slug = Astro.params.slug ?? '';
if (!isValidSlugShape(slug)) return Astro.redirect('/404');
const event = getEventBySlug(slug);
if (!event) return Astro.redirect('/404');
if (event.status === 'expired') {
  if (event.pictime_gallery_url) return Astro.redirect(event.pictime_gallery_url);
  return Astro.redirect('/404');
}

const rows = listAssetsForEvent(event.id);
const initialAssets: PublicAsset[] = rows.map((r: AssetRow) => ({
  id: r.id,
  src: `/m/${slug}/${r.id}`,
  thumb: r.thumb_storage_key ? `/m/${slug}/${r.id}_thumb` : `/m/${slug}/${r.id}`,
  mime_type: r.mime_type,
  width: r.width, height: r.height, duration_ms: r.duration_ms,
  uploader_name: r.uploader_name, uploaded_at: r.uploaded_at,
}));
const initialSince = rows.length ? rows[rows.length - 1].uploaded_at : new Date().toISOString();
const isKiosk = Astro.url.searchParams.get('kiosk') === '1';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Wall · Second Line</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; background: #050505; color: #f8f4ea; height: 100%; overflow: hidden;
                   font-family: system-ui, sans-serif; }
      #wall-root { position: fixed; inset: 0; }
    </style>
  </head>
  <body>
    <div id="wall-root">
      <WallIsland client:load slug={slug} initialAssets={initialAssets} initialSince={initialSince} kiosk={isKiosk} />
    </div>
  </body>
</html>
```

- [ ] **Step 2: Implement the wall island**

Create `src/components/secondline/WallIsland.tsx`:

```tsx
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
}

const PHOTO_DWELL_MS = 5000;
const VIDEO_MAX_MS = 30_000;
const CROSSFADE_MS = 400;
const CONTROLS_HIDE_MS = 3000;

export default function WallIsland({ slug, initialAssets, initialSince, kiosk }: Props) {
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
    let dwell = PHOTO_DWELL_MS;
    if (current.mime_type.startsWith('video/')) {
      dwell = current.duration_ms ? Math.min(current.duration_ms, VIDEO_MAX_MS) : VIDEO_MAX_MS;
    }
    rotationTimer.current = setTimeout(() => {
      setPrevIdx(heroIdx);
      setHeroIdx(i => (i + 1) % assets.length);
      setTimeout(() => setPrevIdx(null), CROSSFADE_MS);
    }, dwell);
    return () => { if (rotationTimer.current) clearTimeout(rotationTimer.current); };
  }, [heroIdx, assets]);

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
        {prev && <Hero key={`prev-${prev.id}`} asset={prev} fadingOut />}
        {hero && <Hero key={`cur-${hero.id}`} asset={hero} videoRef={heroVideoRef} />}
        {!hero && (
          <div style={{ textAlign: 'center', color: '#b8b2a5' }}>
            Waiting for the first upload…
          </div>
        )}
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

function Hero({ asset, fadingOut, videoRef }: { asset: PublicAsset; fadingOut?: boolean; videoRef?: React.MutableRefObject<HTMLVideoElement | null> }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    maxWidth: '100%', maxHeight: '100%',
    objectFit: 'contain',
    opacity: fadingOut ? 0 : 1,
    transition: `opacity 400ms ease-in-out`,
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
```

- [ ] **Step 3: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/pages/w/[slug].astro src/components/secondline/WallIsland.tsx
git commit -m "feat(secondline): wall page with SSE rotation, background scroller, fullscreen controls"
```

---

## Task 23: Host gallery page

**Files:**
- Create: `src/pages/g/[slug].astro`
- Create: `src/components/secondline/GalleryIsland.tsx`

The gallery is calmer: grid of thumbnails, click to open lightbox, "Download all as ZIP" CTA, "Buy prints from this event" CTA (if PicTime URL set).

- [ ] **Step 1: Implement the gallery page**

Create `src/pages/g/[slug].astro`:

```astro
---
/**
 * Host gallery.
 *
 * Calm, dark, simple. Grid of thumbnails, click for lightbox. CTAs for
 * ZIP download and PicTime prints. Used post-event by the host (and
 * sharable with their guests by them).
 */
import GalleryIsland from '@/components/secondline/GalleryIsland';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsForEvent } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import type { PublicAsset, AssetRow } from '@/lib/secondline/types';

export const prerender = false;

const slug = Astro.params.slug ?? '';
if (!isValidSlugShape(slug)) return Astro.redirect('/404');
const event = getEventBySlug(slug);
if (!event) return Astro.redirect('/404');
if (event.status === 'expired') {
  if (event.pictime_gallery_url) return Astro.redirect(event.pictime_gallery_url);
  return Astro.redirect('/404');
}

const rows = listAssetsForEvent(event.id);
const initialAssets: PublicAsset[] = rows.map((r: AssetRow) => ({
  id: r.id,
  src: `/m/${slug}/${r.id}`,
  thumb: r.thumb_storage_key ? `/m/${slug}/${r.id}_thumb` : `/m/${slug}/${r.id}`,
  mime_type: r.mime_type,
  width: r.width, height: r.height, duration_ms: r.duration_ms,
  uploader_name: r.uploader_name, uploaded_at: r.uploaded_at,
}));
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Gallery · Second Line</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; background: #050505; color: #f8f4ea; font-family: system-ui, sans-serif; }
      .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 20px 96px; }
      h1 { font-size: 28px; margin: 0 0 6px; }
      p.lead { color: #b8b2a5; margin: 0 0 32px; }
      .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 28px; }
      a.cta {
        display: inline-block; padding: 12px 22px; border-radius: 999px; font-size: 14px; font-weight: 600;
        text-decoration: none; border: 1px solid #d4af37; background: #d4af37; color: #050505;
      }
      a.cta.secondary { background: transparent; color: #d4af37; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <h1>Your event gallery</h1>
      <p class="lead">All the photos and videos guests shared during the event.</p>

      <div class="cta-row">
        <a class="cta" href={`/api/events/${slug}/zip`} download>Download all as ZIP</a>
        {event.pictime_gallery_url && (
          <a class="cta secondary" href={event.pictime_gallery_url} target="_blank" rel="noopener">
            Buy prints from this event →
          </a>
        )}
      </div>

      <GalleryIsland client:load slug={slug} initialAssets={initialAssets} />
    </main>
  </body>
</html>
```

- [ ] **Step 2: Implement the gallery island**

Create `src/components/secondline/GalleryIsland.tsx`:

```tsx
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
```

- [ ] **Step 3: Verify typecheck and commit**

```sh
pnpm typecheck
git add src/pages/g/[slug].astro src/components/secondline/GalleryIsland.tsx
git commit -m "feat(secondline): host gallery page with grid + lightbox + ZIP/PicTime CTAs"
```

---

## Task 24: ZIP download endpoint

**Files:**
- Create: `src/pages/api/events/[slug]/zip.ts`

Stream a ZIP via `archiver` rather than buffering. The endpoint pulls each asset from S3 as a stream and pipes into the archiver, which pipes to the Response body.

- [ ] **Step 1: Implement the ZIP endpoint**

Create `src/pages/api/events/[slug]/zip.ts`:

```ts
/**
 * GET /api/events/<slug>/zip
 *
 * Streams a ZIP of every alive asset for the event. Slug-gated, no auth —
 * matches the gallery's access model.
 *
 * Filenames in the ZIP are `<slug>-<asset-id>.<ext>`. We don't have
 * the guest's original filename (we throw it away on processing); a stable
 * sortable ID is more useful for the host anyway.
 */

import type { APIRoute } from 'astro';
import archiver from 'archiver';
import { Readable } from 'node:stream';
import { getEventBySlug } from '@/lib/secondline/events';
import { listAssetsForEvent } from '@/lib/secondline/assets';
import { isValidSlugShape } from '@/lib/secondline/slugs';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? '');
  if (!isValidSlugShape(slug)) return new Response('Bad slug', { status: 400 });
  const event = getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });

  const assets = listAssetsForEvent(event.id);
  if (assets.length === 0) return new Response('No assets', { status: 404 });

  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);

  const archive = archiver('zip', { zlib: { level: 1 } }); // photos/videos already compressed
  archive.on('warning', err => console.warn('[secondline] zip warning', err));
  archive.on('error', err => console.error('[secondline] zip error', err));

  void (async () => {
    try {
      for (const a of assets) {
        const { body } = await s3.getObjectStream(a.storage_key);
        const ext = extFromMime(a.mime_type);
        archive.append(body, { name: `${event.slug}-${a.id}.${ext}` });
      }
      await archive.finalize();
    } catch (err) {
      console.error('[secondline] zip build failed', err);
      archive.abort();
    }
  })();

  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="secondline-${event.slug}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
};

function extFromMime(m: string): string {
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'bin';
}
```

- [ ] **Step 2: Verify typecheck and commit**

```sh
pnpm typecheck
git add src/pages/api/events/[slug]/zip.ts
git commit -m "feat(secondline): streaming ZIP download endpoint"
```

---

## Task 25: Host email templates

**Files:**
- Create: `src/lib/secondline/email.ts`
- Create: `src/lib/secondline/__tests__/email.test.ts`

Three templates that go through the shared `sendRawEmail` from `src/lib/email.ts`.

- [ ] **Step 1: Write failing test**

Create `src/lib/secondline/__tests__/email.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderGalleryReadyHtml, renderExpiryWarningHtml, renderExpiredHtml } from '../email';
import type { EventRow } from '../types';

const event: EventRow = {
  id: 1, slug: 'ekdnza28',
  storage_backend_id: 'wasabi',
  host_first_name: 'Sarah', host_last_name: 'Beaumont',
  host_email: 'sarah@example.com',
  event_date: '2026-10-12',
  pictime_gallery_url: 'https://pictime.example/wedding-abc',
  expires_at: '2027-04-10T00:00:00Z',
  status: 'active',
  first_upload_at: null,
  warned_30_at: null,
  created_at: '2026-05-25T00:00:00Z',
};

describe('secondline email templates', () => {
  it('gallery-ready includes gallery URL and ZIP link', () => {
    const html = renderGalleryReadyHtml(event, 'https://secondline.smile-nola.com');
    expect(html).toContain('/g/ekdnza28');
    expect(html).toContain('/api/events/ekdnza28/zip');
    expect(html).toContain('Sarah');
  });

  it('expiry warning includes days-remaining and ZIP CTA', () => {
    const html = renderExpiryWarningHtml(event, 'https://secondline.smile-nola.com', 30);
    expect(html).toContain('30');
    expect(html).toContain('ZIP');
  });

  it('expired template points to PicTime', () => {
    const html = renderExpiredHtml(event);
    expect(html).toContain(event.pictime_gallery_url!);
  });

  it('escapes HTML in dynamic fields', () => {
    const evil = { ...event, host_first_name: '<script>alert(1)</script>' };
    const html = renderGalleryReadyHtml(evil, 'https://x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/__tests__/email.test.ts
```

- [ ] **Step 3: Implement `email.ts`**

Create `src/lib/secondline/email.ts`:

```ts
/**
 * Second Line host-facing email templates.
 *
 * All inline HTML, brand-tinted (dark luxury, gold on near-black). Senders
 * call sendRawEmail from @/lib/email; this module owns only the templates
 * and the thin wrapper functions that map an EventRow into a send.
 */

import { getEnv } from '@/lib/env';
import { sendRawEmail } from '@/lib/email';
import type { EventRow } from './types';

function publicBase(): string {
  return getEnv('SECONDLINE_PUBLIC_URL') || 'https://secondline.smile-nola.com';
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#050505;color:#f8f4ea;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">${inner}</div></body></html>`;
}

function brandHeader(): string {
  return `<div style="text-align:center;margin-bottom:24px;">
    <div style="font-family:Georgia,serif;font-size:22px;color:#d4af37;letter-spacing:0.08em;">SMILE NOLA</div>
    <div style="font-size:11px;color:#b8b2a5;letter-spacing:0.2em;margin-top:6px;">SECOND LINE</div>
  </div>`;
}

function buttonHtml(label: string, href: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:#d4af37;color:#050505;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">${esc(label)}</a>`;
}

export function renderGalleryReadyHtml(event: EventRow, base?: string): string {
  const b = base || publicBase();
  const galleryUrl = `${b}/g/${event.slug}`;
  const zipUrl = `${b}/api/events/${event.slug}/zip`;
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">Your event gallery is ready</h1>
    <p style="color:#cfc7b3;line-height:1.55;">Hi ${esc(event.host_first_name)}, here's everything your guests shared during the event.</p>
    <p style="margin:28px 0;">${buttonHtml('View gallery', galleryUrl)}</p>
    <p style="color:#b8b2a5;font-size:14px;line-height:1.55;">
      You can also <a href="${esc(zipUrl)}" style="color:#d4af37;">download everything as a ZIP</a>.
    </p>
    <p style="color:#9a9484;font-size:12px;margin-top:32px;">
      Your guest gallery is available for 180 days from your event date.
    </p>
  `);
}

export function renderExpiryWarningHtml(event: EventRow, base: string, daysLeft: number): string {
  const b = base || publicBase();
  const zipUrl = `${b}/api/events/${event.slug}/zip`;
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">Your guest gallery expires in ${daysLeft} days</h1>
    <p style="color:#cfc7b3;line-height:1.55;">Hi ${esc(event.host_first_name)}, your Second Line gallery will be cleared in ${daysLeft} days. Grab everything as a ZIP now so you have a copy.</p>
    <p style="margin:28px 0;">${buttonHtml('Download all as ZIP', zipUrl)}</p>
    ${event.pictime_gallery_url ? `<p style="color:#b8b2a5;font-size:14px;">After that, you'll still be able to <a href="${esc(event.pictime_gallery_url)}" style="color:#d4af37;">order prints from PicTime</a>.</p>` : ''}
  `);
}

export function renderExpiredHtml(event: EventRow): string {
  return shell(`
    ${brandHeader()}
    <h1 style="font-size:22px;margin:0 0 12px;">Your guest gallery has been archived</h1>
    <p style="color:#cfc7b3;line-height:1.55;">Hi ${esc(event.host_first_name)}, your Second Line gallery from your event on ${esc(event.event_date)} has reached its 180-day end. Prints are still available on PicTime:</p>
    <p style="margin:28px 0;">${buttonHtml('Order prints', event.pictime_gallery_url || 'https://smile-nola.com')}</p>
  `);
}

// ---- Send wrappers ----

export async function sendGalleryReady(event: EventRow): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: `Your event gallery is ready — Smile NOLA`,
    html: renderGalleryReadyHtml(event),
  });
}

export async function sendExpiryWarning(event: EventRow, daysLeft: number): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: `Your gallery expires in ${daysLeft} days — Smile NOLA`,
    html: renderExpiryWarningHtml(event, publicBase(), daysLeft),
  });
}

export async function sendExpiredNotice(event: EventRow): Promise<void> {
  if (!event.host_email) return;
  await sendRawEmail({
    to: event.host_email,
    subject: `Your guest gallery has been archived — Smile NOLA`,
    html: renderExpiredHtml(event),
  });
}
```

- [ ] **Step 4: Run tests**

```sh
pnpm vitest run src/lib/secondline/__tests__/email.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/email.ts src/lib/secondline/__tests__/email.test.ts
git commit -m "feat(secondline): host email templates (gallery-ready, expiry warning, expired)"
```

---

## Task 26: Retention sweep + cron endpoints

**Files:**
- Create: `src/lib/secondline/retention.ts`
- Create: `src/lib/secondline/__tests__/retention.test.ts`
- Create: `src/pages/api/cron/cleanup.ts`
- Create: `src/pages/api/cron/reminders.ts`

- [ ] **Step 1: Write failing test for pure functions**

Create `src/lib/secondline/__tests__/retention.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isExpired, daysUntilExpiry } from '../retention';
import type { EventRow } from '../types';

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1, slug: 'aaaa2345',
    storage_backend_id: 'wasabi',
    host_first_name: 'A', host_last_name: 'B', host_email: 'a@b.c',
    event_date: '2026-01-01',
    pictime_gallery_url: null,
    expires_at: null, status: 'active',
    first_upload_at: null, warned_30_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('retention pure functions', () => {
  it('isExpired returns false when expires_at is null', () => {
    expect(isExpired(event({ expires_at: null }), new Date('2030-01-01'))).toBe(false);
  });
  it('isExpired returns true once expires_at is in the past', () => {
    expect(isExpired(event({ expires_at: '2026-06-01T00:00:00Z' }), new Date('2026-06-02'))).toBe(true);
  });
  it('isExpired returns false if expires_at is in the future', () => {
    expect(isExpired(event({ expires_at: '2026-06-01T00:00:00Z' }), new Date('2026-05-31'))).toBe(false);
  });
  it('daysUntilExpiry returns null when expires_at is null', () => {
    expect(daysUntilExpiry(event({ expires_at: null }), new Date('2026-01-01'))).toBeNull();
  });
  it('daysUntilExpiry returns rounded-down integer days', () => {
    expect(daysUntilExpiry(event({ expires_at: '2026-02-01T00:00:00Z' }), new Date('2026-01-01T12:00:00Z'))).toBe(30);
  });
  it('daysUntilExpiry returns negative for past expiry', () => {
    expect(daysUntilExpiry(event({ expires_at: '2026-01-01T00:00:00Z' }), new Date('2026-01-10T00:00:00Z'))).toBe(-9);
  });
});
```

- [ ] **Step 2: Implement `retention.ts`**

Create `src/lib/secondline/retention.ts`:

```ts
/**
 * Retention sweep and reminder orchestration.
 *
 * Pure helpers (isExpired, daysUntilExpiry) are tested in isolation.
 * The sweep functions are side-effectful and call into the storage adapter
 * to delete objects, then update DB state to 'expired'. They log every
 * action and tolerate per-event failures (one bad event doesn't block the
 * batch — log it, continue).
 */

import { listActiveEvents, listEventsExpiringBefore, markExpired, markWarned30 } from './events';
import { listAllAssetsForPurge, softDeleteAsset } from './assets';
import { getBackend } from './storage/backends';
import { createS3Adapter } from './storage/s3';
import { sendExpiryWarning, sendExpiredNotice } from './email';
import type { EventRow } from './types';

export function isExpired(event: EventRow, now: Date): boolean {
  if (!event.expires_at) return false;
  return Date.parse(event.expires_at) <= now.getTime();
}

export function daysUntilExpiry(event: EventRow, now: Date): number | null {
  if (!event.expires_at) return null;
  const diffMs = Date.parse(event.expires_at) - now.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

export async function runRetentionSweep(now: Date = new Date()): Promise<{ processed: number; expired: number; failed: number }> {
  const events = listActiveEvents();
  let expired = 0, failed = 0;
  for (const ev of events) {
    if (!isExpired(ev, now)) continue;
    try {
      await purgeEventAssets(ev);
      markExpired(ev.id);
      await sendExpiredNotice(ev).catch(err => console.error('[secondline] expired notice send failed', err));
      expired++;
    } catch (err) {
      console.error('[secondline] retention sweep: failed to expire event', { id: ev.id, slug: ev.slug, err: String(err) });
      failed++;
    }
  }
  return { processed: events.length, expired, failed };
}

async function purgeEventAssets(event: EventRow): Promise<void> {
  const assets = listAllAssetsForPurge(event.id);
  if (assets.length === 0) return;
  const backend = getBackend(event.storage_backend_id);
  const s3 = createS3Adapter(backend);
  for (const a of assets) {
    try {
      await s3.deleteObject(a.storage_key);
      if (a.thumb_storage_key) await s3.deleteObject(a.thumb_storage_key);
      softDeleteAsset(a.id);
    } catch (err) {
      console.error('[secondline] failed to delete asset object', { id: a.id, key: a.storage_key, err: String(err) });
      // continue — the next sweep run will retry
    }
  }
}

/**
 * Send the 30-day expiry warning to hosts of events that are within their
 * warning window AND haven't already been notified (warned_30_at IS NULL).
 * Safe to re-run within the same day — dedupes via warned_30_at column.
 */
export async function sendExpiryReminders(now: Date = new Date(), windowDays = 30): Promise<{ sent: number }> {
  const horizonMs = now.getTime() + windowDays * 24 * 60 * 60 * 1000;
  const horizonIso = new Date(horizonMs).toISOString();
  const events = listEventsExpiringBefore(horizonIso);
  let sent = 0;
  for (const ev of events) {
    if (ev.warned_30_at) continue;
    const left = daysUntilExpiry(ev, now);
    if (left == null || left < 0 || left > windowDays) continue;
    try {
      await sendExpiryWarning(ev, left);
      markWarned30(ev.id);
      sent++;
    } catch (err) {
      console.error('[secondline] expiry warning send failed', { id: ev.id, err: String(err) });
    }
  }
  return { sent };
}
```

- [ ] **Step 3: Run retention tests**

```sh
pnpm vitest run src/lib/secondline/__tests__/retention.test.ts
```
Expected: PASS.

- [ ] **Step 4: Implement `cleanup` cron endpoint**

Create `src/pages/api/cron/cleanup.ts`:

```ts
/**
 * POST /api/cron/cleanup
 *
 * Triggered by a Coolify scheduled task. Bearer-gated (NOT cookie auth) so
 * Coolify can call it without an admin session. Lives OUTSIDE /api/admin so
 * the middleware doesn't try to apply.
 */

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { runRetentionSweep } from '@/lib/secondline/retention';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const token = getEnv('SECONDLINE_CRON_TOKEN');
  if (!token) return json(503, { error: 'cron not configured' });
  const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!constantTimeEquals(provided, token)) return json(401, { error: 'unauthorized' });

  const result = await runRetentionSweep(new Date());
  return json(200, { ok: true, ...result });
};

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
```

- [ ] **Step 5: Implement `reminders` cron endpoint**

Create `src/pages/api/cron/reminders.ts`:

```ts
/**
 * POST /api/cron/reminders
 *
 * Sends 30-day expiry warnings to hosts whose events are within the warning
 * window and haven't been warned yet (dedupe via events.warned_30_at).
 */

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { sendExpiryReminders } from '@/lib/secondline/retention';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const token = getEnv('SECONDLINE_CRON_TOKEN');
  if (!token) return json(503, { error: 'cron not configured' });
  const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!constantTimeEquals(provided, token)) return json(401, { error: 'unauthorized' });

  const result = await sendExpiryReminders(new Date(), 30);
  return json(200, { ok: true, ...result });
};

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
```

- [ ] **Step 6: Verify typecheck and commit**

```sh
pnpm typecheck && pnpm test
git add src/lib/secondline/retention.ts src/lib/secondline/__tests__/retention.test.ts src/pages/api/cron/cleanup.ts src/pages/api/cron/reminders.ts
git commit -m "feat(secondline): retention sweep + bearer-gated cron endpoints for cleanup and reminders"
```

---

## Task 27: QR code generation

**Files:**
- Create: `src/lib/secondline/qr.ts`
- Create: `src/lib/secondline/__tests__/qr.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/secondline/__tests__/qr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderQrSvg } from '../qr';

describe('qr', () => {
  it('returns an SVG string for any URL', async () => {
    const svg = await renderQrSvg('https://secondline.smile-nola.com/u/aaaa2345');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```sh
pnpm vitest run src/lib/secondline/__tests__/qr.test.ts
```

- [ ] **Step 3: Implement `qr.ts`**

Create `src/lib/secondline/qr.ts`:

```ts
/**
 * Server-side QR code generation. Returns an SVG string suitable for
 * inlining in a print-ready page.
 */

import QRCode from 'qrcode';

export async function renderQrSvg(url: string, opts: { size?: number } = {}): Promise<string> {
  const size = opts.size ?? 320;
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: size });
}
```

- [ ] **Step 4: Run test, expect PASS**

```sh
pnpm vitest run src/lib/secondline/__tests__/qr.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/lib/secondline/qr.ts src/lib/secondline/__tests__/qr.test.ts
git commit -m "feat(secondline): server-side QR SVG renderer"
```

---

## Task 28: Admin — create-event form + POST endpoint

**Files:**
- Create: `src/pages/admin/events/new.astro`
- Create: `src/pages/api/admin/events.ts`

Manual event creation. Required: host_first_name, host_last_name, host_email, event_date, storage_backend_id. Optional: pictime_gallery_url. The form POSTs to `/api/admin/events`; on success the endpoint 302-redirects to the new event's detail page so the operator can immediately print the QR.

- [ ] **Step 1: Implement the create page**

Create `src/pages/admin/events/new.astro`:

```astro
---
/**
 * Admin: create a Second Line event.
 *
 * Single form posting to /api/admin/events. On success, redirects to the
 * newly-created event's detail page (?created=1 surfaces a confirmation
 * banner there).
 */
import AdminLayout from '@/layouts/AdminLayout.astro';
import { listBackends } from '@/lib/secondline/storage/backends';
import { getEnv } from '@/lib/env';

export const prerender = false;

const backends = listBackends();
const defaultBackend = getEnv('SECONDLINE_ACTIVE_BACKEND') || 'wasabi';
const error = Astro.url.searchParams.get('error') || '';
---
<AdminLayout section="events" title="New event">
  <p style="margin:0 0 6px;"><a href="/admin/events" style="color:#d4af37;">← All events</a></p>
  <h1>New event</h1>
  <p style="color:#b8b2a5;margin:0 0 24px;">Creates the gallery slug + QR code. Storage backend locks after the first upload.</p>

  {error && (
    <div style="background:rgba(160,80,80,0.12);border:1px solid rgba(160,80,80,0.3);color:#d08989;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:14px;">
      {error}
    </div>
  )}

  <form method="POST" action="/api/admin/events" class="event-form">
    <div class="row">
      <label>
        <span>Host first name</span>
        <input type="text" name="host_first_name" required maxlength="80" autocomplete="given-name" />
      </label>
      <label>
        <span>Host last name</span>
        <input type="text" name="host_last_name" required maxlength="80" autocomplete="family-name" />
      </label>
    </div>

    <label>
      <span>Host email</span>
      <input type="email" name="host_email" required maxlength="200" autocomplete="email" />
    </label>

    <label>
      <span>Event date</span>
      <input type="date" name="event_date" required />
    </label>

    <label>
      <span>Storage backend</span>
      <select name="storage_backend_id" required>
        {backends.map(b => (
          <option value={b.id} selected={b.id === defaultBackend}>{b.label}</option>
        ))}
      </select>
    </label>

    <label>
      <span>PicTime gallery URL (optional)</span>
      <input type="url" name="pictime_gallery_url" placeholder="https://pictime.example/your-gallery" />
    </label>

    <div style="margin-top:8px;">
      <button type="submit" class="primary-btn">Create event</button>
    </div>
  </form>

  <style>
    .event-form { display: grid; gap: 14px; max-width: 560px; }
    .event-form .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .event-form label { display: block; }
    .event-form label > span { display: block; font-size: 12px; color: #b8b2a5; margin-bottom: 6px; letter-spacing: 0.04em; }
    .event-form input, .event-form select {
      width: 100%; box-sizing: border-box; padding: 10px 12px; background: #111; color: #f8f4ea;
      border: 1px solid #2a2a2a; border-radius: 6px; font-size: 14px;
    }
    .primary-btn {
      background: #d4af37; color: #050505; border: 0; padding: 11px 22px;
      border-radius: 999px; font-weight: 600; cursor: pointer; font-size: 14px;
    }
  </style>
</AdminLayout>
```

- [ ] **Step 2: Implement the POST endpoint**

Create `src/pages/api/admin/events.ts`:

```ts
/**
 * POST /api/admin/events
 *
 * Body: application/x-www-form-urlencoded
 *   host_first_name (required)
 *   host_last_name  (required)
 *   host_email      (required)
 *   event_date      (required, YYYY-MM-DD)
 *   storage_backend_id (required, must exist in registry)
 *   pictime_gallery_url (optional)
 *
 * On success: 302 to /admin/events/<new-id>?created=1.
 * On validation error: 302 to /admin/events/new?error=<msg>.
 *
 * Guarded by middleware (lives under /api/admin).
 */

import type { APIRoute } from 'astro';
import { createEvent } from '@/lib/secondline/events';
import { getBackend } from '@/lib/secondline/storage/backends';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try { form = await request.formData(); }
  catch { return redirectErr('Bad form body'); }

  const host_first_name = String(form.get('host_first_name') ?? '').trim();
  const host_last_name = String(form.get('host_last_name') ?? '').trim();
  const host_email = String(form.get('host_email') ?? '').trim();
  const event_date = String(form.get('event_date') ?? '').trim();
  const storage_backend_id = String(form.get('storage_backend_id') ?? '').trim();
  const pictime_raw = String(form.get('pictime_gallery_url') ?? '').trim();

  if (!host_first_name || host_first_name.length > 80) return redirectErr('Host first name is required (≤80 chars)');
  if (!host_last_name || host_last_name.length > 80) return redirectErr('Host last name is required (≤80 chars)');
  if (!EMAIL_RE.test(host_email)) return redirectErr('Host email looks invalid');
  if (!DATE_RE.test(event_date)) return redirectErr('Event date must be YYYY-MM-DD');
  if (Number.isNaN(Date.parse(`${event_date}T00:00:00Z`))) return redirectErr('Event date is not a valid date');

  try { getBackend(storage_backend_id); }
  catch { return redirectErr(`Unknown storage backend: ${storage_backend_id}`); }

  let pictime_gallery_url: string | null = null;
  if (pictime_raw) {
    if (!/^https?:\/\//i.test(pictime_raw)) return redirectErr('PicTime URL must start with http(s)://');
    pictime_gallery_url = pictime_raw;
  }

  const event = createEvent({
    host_first_name, host_last_name, host_email,
    event_date, storage_backend_id, pictime_gallery_url,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/events/${event.id}?created=1` },
  });
};

function redirectErr(msg: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/events/new?error=${encodeURIComponent(msg)}` },
  });
}
```

- [ ] **Step 3: Verify typecheck**

```sh
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/pages/admin/events/new.astro src/pages/api/admin/events.ts
git commit -m "feat(secondline): admin new-event form + POST /api/admin/events"
```

---

## Task 29: Admin events list

**Files:**
- Create: `src/pages/admin/events/index.astro`

- [ ] **Step 1: Implement the list page**

Create `src/pages/admin/events/index.astro`:

```astro
---
/**
 * Admin: Second Line events list.
 * Read-only table; click a row to open the detail page (Task 30).
 */
import AdminLayout from '@/layouts/AdminLayout.astro';
import { getDb } from '@/lib/db';

export const prerender = false;

const rows = getDb().prepare(`
  SELECT e.id, e.slug, e.storage_backend_id, e.status, e.expires_at, e.first_upload_at, e.created_at,
         e.pictime_gallery_url,
         e.host_first_name, e.host_last_name, e.host_email, e.event_date,
         (SELECT COUNT(*) FROM assets a WHERE a.event_id = e.id AND a.deleted_at IS NULL) AS asset_count
  FROM events e
  ORDER BY e.created_at DESC
  LIMIT 500
`).all() as Array<{
  id: number; slug: string; storage_backend_id: string; status: string;
  expires_at: string | null; first_upload_at: string | null; created_at: string;
  pictime_gallery_url: string | null;
  host_first_name: string; host_last_name: string;
  host_email: string; event_date: string; asset_count: number;
}>;
---
<AdminLayout section="events" title="Events">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
    <div>
      <h1 style="margin:0 0 4px;">Events</h1>
      <p style="color:#b8b2a5;margin:0;">Second Line walls and galleries.</p>
    </div>
    <a href="/admin/events/new" class="primary-btn">+ New event</a>
  </div>

  <div class="table-wrap">
    <table class="rows">
      <thead>
        <tr>
          <th>Created</th>
          <th>Host</th>
          <th>Event date</th>
          <th>Slug</th>
          <th>Backend</th>
          <th>Assets</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr>
            <td>{r.created_at.slice(0,10)}</td>
            <td>{r.host_first_name} {r.host_last_name}</td>
            <td>{r.event_date}</td>
            <td><code>{r.slug}</code></td>
            <td>{r.storage_backend_id}</td>
            <td>{r.asset_count}</td>
            <td><span class={`status-pill is-${r.status}`}>{r.status}</span></td>
            <td><a href={`/admin/events/${r.id}`} class="chip">Open</a></td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colspan="8" class="empty">No events yet. <a href="/admin/events/new" style="color:#d4af37;">Create the first one</a>.</td></tr>
        )}
      </tbody>
    </table>
  </div>

  <style>
    .primary-btn { display: inline-block; background: #d4af37; color: #050505; text-decoration: none;
      padding: 9px 18px; border-radius: 999px; font-weight: 600; font-size: 13px; }
    .table-wrap { overflow-x: auto; border: 1px solid #1a1a1a; border-radius: 8px; }
    table.rows { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.rows th { text-align: left; background: rgba(212,175,55,0.06); color: #d4af37;
      font-weight: 600; padding: 10px 12px; border-bottom: 1px solid #1f1f1f; font-size: 12px;
      letter-spacing: 0.04em; text-transform: uppercase; }
    table.rows td { padding: 10px 12px; border-bottom: 1px solid #131313; color: #d8d2c2; }
    table.rows tr:hover td { background: rgba(212,175,55,0.04); }
    .status-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px;
      letter-spacing: 0.06em; text-transform: uppercase; }
    .status-pill.is-active { background: rgba(70,160,90,0.12); color: #6ec089; border: 1px solid rgba(70,160,90,0.3); }
    .status-pill.is-expired { background: rgba(160,80,80,0.12); color: #d08989; border: 1px solid rgba(160,80,80,0.3); }
    .chip { display: inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(212,175,55,0.08);
      color: #d4af37; text-decoration: none; font-size: 12px; border: 1px solid rgba(212,175,55,0.3); }
    .chip:hover { background: rgba(212,175,55,0.16); }
    .empty { padding: 32px; text-align: center; color: #888; }
  </style>
</AdminLayout>
```

- [ ] **Step 2: Verify typecheck and commit**

```sh
pnpm typecheck
git add src/pages/admin/events/index.astro
git commit -m "feat(secondline): admin events list"
```

---

## Task 30: Admin event detail page + edit/delete endpoints

**Files:**
- Create: `src/pages/admin/events/[id].astro`
- Create: `src/pages/api/admin/events/[id].ts`
- Create: `src/pages/api/admin/events/[id]/assets/[assetId].ts`
- Create: `src/pages/api/admin/events/[id]/send-gallery.ts`

The detail page renders:
- Public URLs (gallery, upload, wall) with copy buttons
- Printable QR code (SVG, server-rendered)
- Storage-backend selector — disabled if any assets exist (immutability)
- PicTime gallery URL field (inline save)
- "Send gallery email" button
- Asset list with Delete button per row

- [ ] **Step 1: Implement the detail page**

Create `src/pages/admin/events/[id].astro`:

```astro
---
import AdminLayout from '@/layouts/AdminLayout.astro';
import { getEventById } from '@/lib/secondline/events';
import { listAssetsForEvent, countAssetsForEvent } from '@/lib/secondline/assets';
import { listBackends } from '@/lib/secondline/storage/backends';
import { renderQrSvg } from '@/lib/secondline/qr';
import { getEnv } from '@/lib/env';

export const prerender = false;

const id = Number(Astro.params.id);
if (!Number.isInteger(id)) return Astro.redirect('/admin/events');
const event = getEventById(id);
if (!event) return Astro.redirect('/admin/events');

const assets = listAssetsForEvent(event.id);
const backends = listBackends();
const base = getEnv('SECONDLINE_PUBLIC_URL') || 'https://secondline.smile-nola.com';
const uploadUrl = `${base}/u/${event.slug}`;
const wallUrl = `${base}/w/${event.slug}`;
const galleryUrl = `${base}/g/${event.slug}`;
const qrSvg = await renderQrSvg(uploadUrl, { size: 280 });
const backendLocked = countAssetsForEvent(event.id) > 0;
const justCreated = Astro.url.searchParams.get('created') === '1';
---
<AdminLayout section="events" title={`Event ${event.slug}`}>
  <p style="margin:0 0 6px;"><a href="/admin/events" style="color:#d4af37;">← All events</a></p>
  <h1 style="margin:0 0 4px;">{event.host_first_name} {event.host_last_name}</h1>
  <p style="color:#b8b2a5;margin:0 0 24px;">
    Event date {event.event_date} · expires {event.expires_at?.slice(0,10) ?? '—'} ·
    {event.host_email}
  </p>

  {justCreated && (
    <div style="background:rgba(70,160,90,0.12);border:1px solid rgba(70,160,90,0.3);color:#6ec089;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:14px;">
      Event created. Print the QR below for the venue.
    </div>
  )}

  <div class="grid">
    <section class="card">
      <h2>Public URLs</h2>
      <ul class="urls">
        <li><label>Upload</label><code>{uploadUrl}</code><button class="chip copy-btn" data-copy={uploadUrl}>Copy</button></li>
        <li><label>Wall</label><code>{wallUrl}</code><button class="chip copy-btn" data-copy={wallUrl}>Copy</button></li>
        <li><label>Gallery</label><code>{galleryUrl}</code><button class="chip copy-btn" data-copy={galleryUrl}>Copy</button></li>
      </ul>
    </section>

    <section class="card">
      <h2>Print this QR for signage</h2>
      <div class="qr" set:html={qrSvg}></div>
      <p style="color:#b8b2a5;font-size:13px;margin:8px 0 0;">Scans to <code>{uploadUrl}</code></p>
      <p><button class="chip" onclick="window.print()">Print</button></p>
    </section>

    <section class="card">
      <h2>Storage backend</h2>
      <p style="color:#b8b2a5;font-size:13px;margin:0 0 8px;">
        {backendLocked
          ? <>Locked — assets already uploaded ({assets.length}).</>
          : <>Choose where uploads land. Locked once the first upload arrives.</>}
      </p>
      <select id="backend-select" disabled={backendLocked} class="select">
        {backends.map(b => (
          <option value={b.id} selected={b.id === event.storage_backend_id}>{b.label}</option>
        ))}
      </select>
    </section>

    <section class="card">
      <h2>PicTime gallery URL</h2>
      <p style="color:#b8b2a5;font-size:13px;margin:0 0 8px;">Used by the gallery "Buy prints" CTA and the expired redirect.</p>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="pictime-input" type="url" placeholder="https://pictime.example/your-gallery"
               value={event.pictime_gallery_url ?? ''} class="text-input" />
        <button id="pictime-save" class="chip">Save</button>
      </div>
      <span id="pictime-status" style="color:#b8b2a5;font-size:12px;margin-top:6px;display:block;"></span>
    </section>

    <section class="card">
      <h2>Send gallery email</h2>
      <p style="color:#b8b2a5;font-size:13px;margin:0 0 8px;">
        Emails the host their gallery URL + ZIP link. Send when the event is over.
      </p>
      <p style="color:#b8b2a5;font-size:12px;margin:0 0 12px;">
        Recipient: <code>{event.host_email}</code>
      </p>
      <button id="send-gallery-btn" class="chip">Send gallery email</button>
      <span id="send-gallery-status" style="color:#b8b2a5;font-size:12px;margin-left:8px;"></span>
    </section>
  </div>

  <h2 style="margin-top:32px;">Assets ({assets.length})</h2>
  {assets.length === 0
    ? <p style="color:#b8b2a5;">None yet.</p>
    : (
      <ul class="asset-grid">
        {assets.map(a => (
          <li>
            <a href={`/m/${event.slug}/${a.id}`} target="_blank" rel="noopener">
              <img src={`/m/${event.slug}/${a.id}_thumb`} alt="" loading="lazy" />
            </a>
            <div class="asset-meta">
              <span>{a.uploader_name ?? <em style="color:#666;">anonymous</em>}</span>
              <button class="del-btn" data-asset-id={a.id}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    )}

  <script define:vars={{ eventId: event.id }}>
    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const val = btn.getAttribute('data-copy') || '';
        try {
          await navigator.clipboard.writeText(val);
          const orig = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = orig; }, 1200);
        } catch {
          btn.textContent = 'Press ⌘C';
        }
      });
    });

    document.getElementById('backend-select')?.addEventListener('change', async (e) => {
      const select = e.currentTarget;
      select.disabled = true;
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storage_backend_id: select.value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Failed to update backend');
        location.reload();
      } else {
        select.disabled = false;
      }
    });

    document.getElementById('pictime-save')?.addEventListener('click', async () => {
      const input = document.getElementById('pictime-input');
      const status = document.getElementById('pictime-status');
      status.textContent = 'Saving…';
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pictime_gallery_url: input.value || null }),
      });
      const j = await res.json().catch(() => ({}));
      status.textContent = res.ok ? 'Saved ✓' : (j.error || 'Failed');
    });

    document.getElementById('send-gallery-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('send-gallery-btn');
      const status = document.getElementById('send-gallery-status');
      btn.disabled = true;
      status.textContent = 'Sending…';
      const res = await fetch(`/api/admin/events/${eventId}/send-gallery`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      status.textContent = res.ok ? 'Sent ✓' : (j.error || 'Failed');
      setTimeout(() => { btn.disabled = false; }, 2000);
    });

    document.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const assetId = btn.getAttribute('data-asset-id');
        if (!confirm('Delete this asset?')) return;
        btn.disabled = true;
        const res = await fetch(`/api/admin/events/${eventId}/assets/${assetId}`, { method: 'DELETE' });
        if (res.ok) btn.closest('li')?.remove();
        else { alert('Failed to delete'); btn.disabled = false; }
      });
    });
  </script>

  <style>
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { background: #0d0d0d; border: 1px solid #1a1a1a; border-radius: 10px; padding: 16px; }
    .card h2 { font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: #d4af37; margin: 0 0 12px; }
    .urls { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    .urls li { display: grid; grid-template-columns: 70px 1fr auto; gap: 8px; align-items: center; }
    .urls label { color: #b8b2a5; font-size: 12px; }
    .urls code { background: #181818; padding: 4px 8px; border-radius: 4px; font-size: 12px; word-break: break-all; }
    .qr { display: flex; justify-content: center; padding: 8px; background: white; border-radius: 8px; }
    .qr svg { width: 220px; height: 220px; display: block; }
    .select, .text-input { width: 100%; padding: 8px 10px; background: #111; color: #f8f4ea;
      border: 1px solid #2a2a2a; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
    .chip { display: inline-block; padding: 6px 12px; border-radius: 999px; background: rgba(212,175,55,0.08);
      color: #d4af37; text-decoration: none; font-size: 12px; border: 1px solid rgba(212,175,55,0.3); cursor: pointer; }
    .chip:hover { background: rgba(212,175,55,0.16); }
    .asset-grid { list-style: none; padding: 0; margin: 12px 0 0; display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    .asset-grid li { background: #111; border-radius: 6px; overflow: hidden; }
    .asset-grid img { display: block; width: 100%; aspect-ratio: 1/1; object-fit: cover; }
    .asset-meta { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px;
      font-size: 11px; color: #b8b2a5; }
    .del-btn { background: transparent; border: 0; color: #d08989; cursor: pointer; font-size: 11px; }
    @media print { .card:not(:nth-child(2)) { display: none; } body { background: white; color: black; } }
  </style>
</AdminLayout>
```

- [ ] **Step 2: Implement the PATCH endpoint**

Create `src/pages/api/admin/events/[id].ts`:

```ts
/**
 * Admin event mutations. Guarded by middleware.
 *
 *   PATCH body:
 *     { storage_backend_id?: string, pictime_gallery_url?: string|null }
 *
 *   storage_backend_id changes are rejected if any assets exist (immutability
 *   guarantee from spec §7.5).
 */

import type { APIRoute } from 'astro';
import { getEventById, setBackend, setPicTimeUrl } from '@/lib/secondline/events';
import { countAssetsForEvent } from '@/lib/secondline/assets';
import { getBackend } from '@/lib/secondline/storage/backends';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json(400, { error: 'Bad id' });
  const event = getEventById(id);
  if (!event) return json(404, { error: 'Not found' });

  let body: { storage_backend_id?: string; pictime_gallery_url?: string | null } = {};
  try { body = await request.json(); } catch { return json(400, { error: 'Bad JSON' }); }

  if (typeof body.storage_backend_id === 'string') {
    if (body.storage_backend_id !== event.storage_backend_id) {
      if (countAssetsForEvent(event.id) > 0) {
        return json(409, { error: 'Backend is locked — assets already uploaded' });
      }
      try { getBackend(body.storage_backend_id); }
      catch { return json(400, { error: `Unknown backend ${body.storage_backend_id}` }); }
      setBackend(event.id, body.storage_backend_id);
    }
  }
  if ('pictime_gallery_url' in body) {
    const v = body.pictime_gallery_url ? String(body.pictime_gallery_url).trim() : null;
    if (v && !/^https?:\/\//i.test(v)) return json(400, { error: 'URL must start with http(s)://' });
    setPicTimeUrl(event.id, v);
  }

  return json(200, { ok: true });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
```

- [ ] **Step 3: Implement the asset-delete endpoint**

Create `src/pages/api/admin/events/[id]/assets/[assetId].ts`:

```ts
import type { APIRoute } from 'astro';
import { getEventById } from '@/lib/secondline/events';
import { getAsset, softDeleteAsset } from '@/lib/secondline/assets';
import { getBackend } from '@/lib/secondline/storage/backends';
import { createS3Adapter } from '@/lib/secondline/storage/s3';
import { getSseHub } from '@/lib/secondline/sse';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  const eventId = Number(params.id);
  const assetId = Number(params.assetId);
  if (!Number.isInteger(eventId) || !Number.isInteger(assetId)) return json(400, { error: 'Bad id' });
  const event = getEventById(eventId);
  if (!event) return json(404, { error: 'Event not found' });
  const asset = getAsset(assetId);
  if (!asset || asset.event_id !== event.id) return json(404, { error: 'Asset not found' });
  if (asset.deleted_at) return json(200, { ok: true });

  // Best-effort object deletion; if it fails, retention sweep will retry.
  try {
    const s3 = createS3Adapter(getBackend(event.storage_backend_id));
    await s3.deleteObject(asset.storage_key);
    if (asset.thumb_storage_key) await s3.deleteObject(asset.thumb_storage_key);
  } catch (err) {
    console.error('[secondline] admin delete: backend deletion failed', { assetId, err: String(err) });
    // Continue: still mark deleted_at so it disappears from UI.
  }
  softDeleteAsset(asset.id);

  // Tell live walls
  getSseHub().broadcast(event.id, { type: 'asset.removed', id: asset.id, ts: new Date().toISOString() });

  return json(200, { ok: true });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
```

- [ ] **Step 4: Implement the send-gallery endpoint**

Create `src/pages/api/admin/events/[id]/send-gallery.ts`:

```ts
import type { APIRoute } from 'astro';
import { getEventById } from '@/lib/secondline/events';
import { sendGalleryReady } from '@/lib/secondline/email';

export const prerender = false;

export const POST: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json(400, { error: 'Bad id' });
  const event = getEventById(id);
  if (!event) return json(404, { error: 'Not found' });
  if (!event.host_email) return json(400, { error: 'Event has no host email' });
  await sendGalleryReady(event);
  return json(200, { ok: true });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
```

- [ ] **Step 5: Verify typecheck and commit**

```sh
pnpm typecheck && pnpm test
git add src/pages/admin/events/[id].astro src/pages/api/admin/events/[id].ts src/pages/api/admin/events/[id]/assets/[assetId].ts src/pages/api/admin/events/[id]/send-gallery.ts
git commit -m "feat(secondline): admin event detail page with QR, backend selector, PicTime URL, asset delete, send-gallery"
```

---

## Task 31: Deploy — Dockerfile, docker-compose, Coolify config, deploy doc

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `docs/deploy.md`
- Modify: `.dockerignore` (if needed)

Single-container deploy. Multi-stage Dockerfile (build → runtime). Node 22 Alpine base. Persistent volume `secondline_data` at `/data` holds `secondline.db`. Coolify routes both `secondline.smile-nola.com` and `media.smile-nola.com` to the same service.

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile` at the repo root:

```dockerfile
# syntax=docker/dockerfile:1.7

# --- Stage 1: build ---
FROM node:22-alpine AS build
WORKDIR /app

# Build deps for sharp (libvips); HEIF input depends on the sharp prebuild —
# add vips-heif here too so processing iPhone uploads doesn't fail.
RUN apk add --no-cache vips vips-heif

# Pin pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Surface the build SHA so the admin build-pill can display it
ARG SOURCE_COMMIT=dev
ENV PUBLIC_GIT_SHA=$SOURCE_COMMIT

RUN pnpm build

# --- Stage 2: runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app

# Runtime libvips + libheif for sharp at request time
RUN apk add --no-cache vips vips-heif tini

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy only what the runtime needs
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/secondline-backends.json ./secondline-backends.json
COPY --from=build /app/public ./public

# The DB and uploads live in /data; create with permissive perms so the
# named volume mounts cleanly even if Coolify owns it as root.
RUN mkdir -p /data && chmod 777 /data
ENV SECONDLINE_DB_DIR=/data
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# tini reaps zombies; node entrypoint serves the SSR adapter
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "./dist/server/entry.mjs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/admin/login >/dev/null 2>&1 || exit 1
```

- [ ] **Step 2: Write the docker-compose.yml**

Create `docker-compose.yml` at the repo root:

```yaml
# Single-service deploy. Coolify owns Traefik labels; this file only declares
# the app container, its env-var contract, and the persistent data volume.
# DO NOT add a second service here for media — the same app handles both
# subdomains via Coolify domain routing.

services:
  app:
    build:
      context: .
      args:
        SOURCE_COMMIT: ${SOURCE_COMMIT:-dev}
    restart: unless-stopped
    environment:
      PORT: "3000"
      NODE_ENV: production
      SECONDLINE_DB_DIR: /data
      # All other env vars come from Coolify-managed application env:
      # SECONDLINE_PUBLIC_URL, MEDIA_PUBLIC_URL,
      # ADMIN_PASSWORD, ADMIN_SESSION_SECRET,
      # RESEND_API_KEY, RESEND_FROM,
      # SECONDLINE_ACTIVE_BACKEND, WASABI_ACCESS_KEY, WASABI_SECRET_KEY,
      # SECONDLINE_CRON_TOKEN,
      # SOURCE_COMMIT (injected by Coolify at build time)
    volumes:
      - secondline_data:/data
    expose:
      - "3000"

volumes:
  secondline_data:
```

- [ ] **Step 3: Create `.dockerignore`**

Create or update `.dockerignore` at the repo root to keep the build context small:

```
node_modules
.git
.astro
dist
data
*.db
*.db-wal
*.db-shm
.env
.env.*
!.env.example
docs
README.md
```

- [ ] **Step 4: Write the deploy doc**

Create `docs/deploy.md`:

```markdown
# Second Line — Deploy

Standalone Astro 5 SSR app, one container, deployed via Coolify.

## Coolify service

Create a new Coolify Application:
- **Source:** this repo (GitHub or self-hosted Gitea)
- **Branch:** `main`
- **Build pack:** Docker Compose
- **Compose file:** `docker-compose.yml`

### Domains

Bind two domains to the `app` service in Coolify:

1. `secondline.smile-nola.com` → app port 3000
2. `media.smile-nola.com` → app port 3000

Both serve from the same container; Astro routes scope by URL path (`/u`,
`/w`, `/g`, `/m`, `/admin`).

### Required env vars (Coolify Application env)

| Var | Purpose |
|---|---|
| `SECONDLINE_PUBLIC_URL` | `https://secondline.smile-nola.com` — used in emails, QR text, redirects |
| `MEDIA_PUBLIC_URL` | `https://media.smile-nola.com` |
| `ADMIN_PASSWORD` | Single-password admin |
| `ADMIN_SESSION_SECRET` | `openssl rand -hex 32` — HMAC key for session cookie |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM` | `Smile NOLA <hello@smile-nola.com>` (must be a verified Resend domain) |
| `SECONDLINE_ACTIVE_BACKEND` | `wasabi` (or any id in `secondline-backends.json`) |
| `WASABI_ACCESS_KEY` | Wasabi IAM access key, scoped to the `secondline-prod` bucket |
| `WASABI_SECRET_KEY` | Matching secret |
| `SECONDLINE_CRON_TOKEN` | `openssl rand -hex 32` — bearer for `/api/cron/*` callbacks |

`SOURCE_COMMIT` is injected automatically by Coolify at build time; the
Dockerfile picks it up via `ARG SOURCE_COMMIT` and surfaces it to the admin
build-pill as `PUBLIC_GIT_SHA`.

### Persistent volume

The `secondline_data` named volume in `docker-compose.yml` mounts at `/data`
and holds `secondline.db` (+ future bind-mounted artefacts).

### Wasabi bucket setup

1. Create bucket `secondline-prod` in `us-east-1`
2. Create an IAM user with read/write/delete access ONLY to that bucket
3. Save the access/secret keys into Coolify env as `WASABI_ACCESS_KEY` /
   `WASABI_SECRET_KEY`

### Adding a new storage backend (e.g. `nas-home`)

1. Append an entry to `secondline-backends.json` at the repo root
2. Add the credential env vars (matching `access_key_env` / `secret_key_env`
   in the JSON) to Coolify
3. Push + "Force rebuild without cache"
4. The new backend appears in the admin new-event form's dropdown

No code change required.

### Coolify scheduled tasks

Add two scheduled tasks to the `app` service:

```
Daily retention sweep
schedule: 0 3 * * *
command: curl -sf -X POST -H "Authorization: Bearer $SECONDLINE_CRON_TOKEN" http://127.0.0.1:3000/api/cron/cleanup
```

```
Daily expiry reminders
schedule: 0 14 * * *
command: curl -sf -X POST -H "Authorization: Bearer $SECONDLINE_CRON_TOKEN" http://127.0.0.1:3000/api/cron/reminders
```

The URLs use the in-container loopback to skip the external network hop.

### Deploy verification

After a deploy:

```sh
# Confirm the SHA is what you expect
curl -s "https://secondline.smile-nola.com/?cb=$(date +%s)" -I

# Visit /admin/login and check the build-pill in the top-right of the admin
# nav matches the git SHA you pushed.
```

If the SHA is stale, click **"Force rebuild without cache"** in Coolify — not
just "Deploy". Docker's layer cache will silently serve a stale `COPY . .`
otherwise.

### Out-of-scope: webhooks from external systems

A future enhancement would let an external system (e.g. a marketing-site
inquiry API) POST to a webhook on this app to auto-create events from
external sources. v1 is single-tenant manual-creation only.
```

- [ ] **Step 5: Verify the Dockerfile builds locally**

```sh
docker build --build-arg SOURCE_COMMIT=local -t secondline-app:local .
docker run --rm -p 3000:3000 \
  -e ADMIN_PASSWORD=devpass \
  -e ADMIN_SESSION_SECRET=dev-secret \
  -e SECONDLINE_PUBLIC_URL=http://localhost:3000 \
  -e MEDIA_PUBLIC_URL=http://localhost:3000 \
  -e WASABI_ACCESS_KEY=dummy -e WASABI_SECRET_KEY=dummy \
  -v secondline_data:/data \
  secondline-app:local &
sleep 8
curl -I http://localhost:3000/admin/login
# Expect 200
docker stop $(docker ps -q --filter ancestor=secondline-app:local) || true
```

- [ ] **Step 6: Commit**

```sh
git add Dockerfile docker-compose.yml .dockerignore docs/deploy.md
git commit -m "chore: dockerfile, docker-compose, deploy doc"
```

---

## Task 32: End-to-end smoke test

**Files:** None (validation only).

The "v1 done" criteria from spec §11. Run all of these against the live production environment AFTER deploy.

- [ ] **Step 1: Create a test event from the admin form**

Log into `/admin/login` with the production admin password. Click **+ New event**, fill in test host data (use a real address you control for the email), pick `wasabi`, leave PicTime URL blank for now, submit.

Expected:
- 302 redirect to `/admin/events/<id>?created=1`
- Confirmation banner reads "Event created"
- QR card shows a scannable QR with the upload URL

- [ ] **Step 2: Print the QR and test from a real phone**

Click Print on the QR card. Scan with an iPhone and an Android phone. Confirm both:
- Open the upload page
- Picker shows "Photo Library / Take Photo / Choose Files"
- Single-select upload succeeds (tile flips to ✓ within a few seconds)
- Multi-select upload succeeds
- HEIC photo from iPhone uploads and shows up as JPEG on the wall

- [ ] **Step 3: Open the wall on a laptop**

Open the Wall URL on a laptop, click Enter Fullscreen. Upload from the phone. Confirm:
- New photo appears within ~5 s
- 5 s dwell per photo, 400 ms crossfade
- Background slowly scrolls blurred thumbnails
- F-key toggles fullscreen
- `?kiosk=1` hides the controls

- [ ] **Step 4: Network resilience test**

With the wall open, turn off wifi on the laptop for 5 minutes (or block the SSE endpoint via OS firewall). Confirm:
- Wall keeps cycling through already-loaded media
- When the network returns, missed uploads catch up via `?since=`

- [ ] **Step 5: Gallery + ZIP**

Open the Gallery URL. Confirm:
- Grid renders all uploads
- Lightbox works for both photos and videos
- "Download all as ZIP" produces a working ZIP file
- "Buy prints from this event" CTA appears only after you set the PicTime URL in admin

Set the PicTime URL via the admin detail page and re-test the CTA.

- [ ] **Step 6: Email**

Click "Send gallery email" on the admin detail page. Confirm:
- Status flips to "Sent ✓"
- The email lands in the inbox you set for `host_email`
- The email renders correctly in Gmail / Apple Mail (dark, gold accents, buttons clickable, gallery + ZIP links work)

For the 30-day expiry warning, trigger it manually:

```sh
# Set the test event's expires_at to about 25 days from now
sqlite3 /data/secondline.db "UPDATE events SET expires_at = datetime('now','+25 days'), warned_30_at = NULL WHERE id = <TEST-EVENT-ID>"

# Then call the reminders cron
curl -X POST -H "Authorization: Bearer $SECONDLINE_CRON_TOKEN" https://secondline.smile-nola.com/api/cron/reminders
```

Expected: `{"ok":true,"sent":1}`. The warning email arrives. Verify the row's `warned_30_at` is now set; re-running the cron returns `{"ok":true,"sent":0}` (dedupe).

- [ ] **Step 7: Retention sweep**

Manually expire the test event:

```sh
sqlite3 /data/secondline.db "UPDATE events SET expires_at = '2020-01-01T00:00:00Z' WHERE id = <TEST-EVENT-ID>"

curl -X POST -H "Authorization: Bearer $SECONDLINE_CRON_TOKEN" https://secondline.smile-nola.com/api/cron/cleanup
```

Confirm:
- Response: `{"ok":true,"processed":N,"expired":1,"failed":0}`
- The event row's `status` is now `expired`
- All asset objects in Wasabi for that event are gone (check via Wasabi console)
- Visiting `/g/<slug>` 302-redirects to the PicTime URL (if set) or 404s

- [ ] **Step 8: Tag the release**

```sh
git tag -a v1.0 -m "Second Line v1: live guest wall, gallery, retention, Wasabi storage"
git push --tags
```

---

## Spec ↔ plan coverage

Walk every section of the spec and confirm a task implements it:

| Spec section | Task |
|---|---|
| §1 What it is | n/a (overview) |
| §2 Business model | n/a (rationale) |
| §3 Out of scope | n/a (negative scope) |
| §4.1 Operator flow | Task 28 (create form), 30 (detail/QR/print/send-gallery) |
| §4.2 Guest flow | Task 21 (upload page+island), 20 (SW) |
| §4.3 Host flow | Task 23 (gallery), 24 (ZIP), 25 (email templates), 26 (reminders cron) |
| §5.1 Wall layout | Task 22 (WallIsland hero region 25%/10% padding) |
| §5.2 Background | Task 22 (background scrolling thumbs, compositor-only) |
| §5.3 Hero rotation | Task 22 (sequential rotation, 5s photo / 30s video / 400ms crossfade) |
| §5.4 Video audio | Task 22 (autoplay + playsInline + user-interaction unlock via Enter Fullscreen) |
| §5.5 Viewport & fullscreen | Task 22 (Enter Fullscreen, F-key, controls auto-hide, ?kiosk=1) |
| §6.1 Guest resilience | Task 20 (SW retry queue), 21 (optimistic UI) |
| §6.2 Wall resilience | Task 22 (pre-cache + ?since= catch-up), 18 (SSE stream + browser auto-reconnect) |
| §6.3 Booth resilience | n/a (future scope; upload API ready for it) |
| §7.1 Where it lives | Task 1 (verify bootstrap), 31 (Dockerfile/compose/deploy) |
| §7.2 Page shapes | Task 7 (admin), 21 (upload), 22 (wall), 23 (gallery), 19 (media proxy) |
| §7.3 Real-time | Task 15 (SSE hub), 18 (SSE stream endpoint), 17 (since-cursor) |
| §7.4 Hosting | Task 31 (Coolify config in deploy.md) |
| §7.5 Storage registry | Task 10 (registry loader + secondline-backends.json) |
| §7.6 Media public URL | Task 19 (media proxy with ownership check) |
| §7.7 Backup & archive | n/a (operational, documented in deploy.md) |
| §7.8 Retention | Task 26 (retention sweep + reminders + cron endpoints) |
| §8 Data model | Task 3 (schema), 8 (types), 12 (events DB), 13 (assets DB) |
| §9 Tech stack | Task 1 (verify) — everything is bootstrap, no install task |
| §10 Risks | Task 1 (HEIC verification), 14 (HEIC processing), 31 (Dockerfile vips-heif) |
| §11 Success criteria | Task 32 (e2e smoke test) |
| §12 Out of scope | n/a (negative scope; webhook future-work mentioned in deploy.md) |

Plus the standalone-app cross-cutting concerns:

| Concern | Task |
|---|---|
| Single-password admin auth | Task 4 (auth.ts) |
| Middleware to guard `/admin` and `/api/admin` | Task 5 |
| Admin shell | Task 7 (AdminLayout + login + logout) |
| Email transport | Task 6 (`src/lib/email.ts`) |
| Manual event creation flow | Task 28 (form + POST) |
| Admin event list | Task 29 |
| Admin event detail + mutations | Task 30 |

---

## Open items deferred to follow-ups (NOT v1 blockers)

These were called out in the spec or surfaced during planning. Each gets its own future plan.

1. **`nas-home` backend wiring.** Plan: smoke-test MinIO/Garage in Container Manager on DS925+ over Tailscale, add config entry + env vars, document operator selection criteria. Estimated 1 day.
2. **Photobooth → wall integration.** The upload API already accepts arbitrary clients; booth side needs its own pipeline (Syncthing? direct multipart POST?). Out of scope.
3. **`?since=<ts>` dedupe across reconnects.** v1 trusts the client's last-seen timestamp; if it drifts the wall may re-render an asset briefly. Acceptable for v1; harden in v2 if observed.
4. **Service worker cache budget.** Spec §10 risk #5: a 500-photo wedding may exceed the SW cache. Currently we don't write to the SW cache — only the browser's HTTP cache (via `Cache-Control: immutable`). If that proves insufficient at the first real event, add an explicit `caches.open()` LRU.
5. **Per-event color/theme customization.** Spec §3.
6. **Webhook intake from external systems.** Spec §12 — a future thin HTTP webhook endpoint that lets an external CRM/inquiry-system push event-creation requests in. Not v1; documented in `docs/deploy.md` as out-of-scope.

---
