# Second Line — Design

> **Repo:** `/home/phoenix/code/secondline-app` (standalone)
> **Originally drafted:** 2026-05-25 inside the smile-nola monorepo at
> `docs/superpowers/specs/`. Pivoted to standalone repo same day; this
> version is the authoritative spec.

**Status:** Draft for review
**Author:** Brainstorming session, 2026-05-25
**Scope:** v1 design only. Future enhancements are explicitly out of scope.

---

## 1. What it is

**Second Line** is a live event photo & video wall: guests scan a QR code,
upload from their phone, and their content appears on a display at the venue
in near real time. After the event, the host gets a downloadable album. 6
months later, the album expires and the URL redirects to that event's PicTime
gallery (where booth output lives permanently and prints are sold).

**Name origin:** The Second Line is the New Orleans wedding tradition where
the wedding party leads the parade and the guests join in. That's exactly
what this product does — guests become part of the show. The name is a NOLA
moat: no out-of-market competitor can credibly use it.

---

## 2. Why we're building it (business model)

Smile NOLA is the first and only customer for v1. The repo is structured as
a standalone product so it can be open-sourced or licensed to other
photographers later. Monetization for Smile NOLA's instance remains
downstream via PicTime print sales (unchanged).

For Smile NOLA specifically, Second Line is **always-on at every event** — no
per-event toggle, no upsell, no separate line item. It is free with every
booking.

Monetization is **downstream**, via print sales:

- **Booth output → PicTime** already happens today via the existing Smile NOLA
  workflow. Second Line does **not** own this pipeline, does not touch it, and
  does not change it. Second Line simply *references* the resulting PicTime
  gallery URL on each event record.
- **Guest uploads** → live on the Second Line wall + downloadable host album,
  **never published to PicTime** (auto or otherwise).
- Gallery page has a prominent "Buy prints from this event" CTA → links to
  the event's PicTime gallery URL.
- After 6 months, guest uploads expire and the gallery URL redirects to the
  PicTime gallery — reinforcing PicTime as the permanent home.

The funnel works as long as the event record has a valid `pictime_gallery_url`
set by the time the Second Line gallery is shared with the host. How that URL
gets populated (existing operator workflow, future automation, etc.) is
outside Second Line's scope.

This is a **lead-generation tool for the existing PicTime print revenue
stream**, not a standalone revenue product. Kululu competes for the wall fee
(~$99/event). We compete for the entire print-sales funnel by giving the wall
away as part of the booking.

---

## 3. What it is NOT (out of scope for v1)

To keep v1 finite and shippable:

- ❌ Per-event paid tiers or billing flows
- ❌ Public marketing site for the feature (it's part of Smile NOLA's booking, not its own product)
- ❌ Multi-tenant SaaS architecture (every deploy is single-tenant in v1)
- ❌ Moderation queues (we're at the event; we delete from a phone if needed)
- ❌ Audio controls (audio plays; the tech mutes the laptop)
- ❌ Per-event presentation customization (one visual style for all events; can revisit later)
- ❌ Photobooth integration (the upload API will accept any authenticated client; how the booth pushes there is a separate later project)
- ❌ Migrating an event between storage backends after first upload

---

## 4. User flows

### 4.1 Operator flow (Smile NOLA staff)

1. Operator manually creates an event via the admin form: enters host first
   name, host last name, host email, event date, and picks the
   `storage_backend_id` from a dropdown (default = `wasabi`; `nas-home` is
   selectable for low-stakes events). On submit, the system returns a slug,
   QR code, and the three public URLs (upload, wall, gallery).
2. Optionally, operator prints the QR code on signage from the admin.
3. At the event, the booth tech opens the wall URL on a laptop connected to
   the venue's display, clicks "Enter Fullscreen," walks away.
4. After the event, operator (or host) can download the full guest album as
   a ZIP.

### 4.2 Guest flow

1. Guest sees a QR code or short URL on a sign / table card / on the wall itself.
2. Scans → lands on the upload page in their phone browser. No app, no signup.
3. Picks a photo or video (or takes one) → hits Upload.
4. Sees optimistic "✓ Uploaded" immediately (upload continues in background
   via service worker if connection is flaky).
5. Within seconds, their photo appears in the wall's rotation.

### 4.3 Host flow (post-event)

1. Receives an email after the event with a link to their gallery + a
   download-as-ZIP button.
2. Gallery shows the album. CTA at the bottom: "Buy prints from your event →"
   (links to the event's PicTime gallery).
3. At 30 days before expiry: receives a reminder email with the ZIP link.
4. At 6 months: guest media is deleted; the gallery URL redirects to the
   PicTime gallery.

---

## 5. The Wall — visual design

The wall is the headline feature. Its presentation is fully specified here.

### 5.1 Layout — the one rule

The wall has a single layout rule that scales to any viewport:

> The hero region is the viewport minus **25% padding on left/right** and
> **10% padding on top/bottom**. Each piece of media renders at its
> **native aspect ratio**, sized as large as it can be while staying fully
> contained inside the padded region. Centered. The background is always
> visible in the remaining viewport area.

Consequences:

| Media shape | What you see |
|---|---|
| 9:16 portrait phone video | Tall and narrow, centered, lots of background visible on either side |
| 16:9 landscape video | Wide, more background visible above and below |
| 2:6 photobooth strip | Tall ribbon, lots of background on the sides |
| Square photo | Square, balanced background around it |
| 21:9 ultra-wide | Horizontal stripe, lots of vertical background |

The background is **always visible by design** — it is part of the composition,
not filler that shows when the photo happens to be a weird shape.

### 5.2 Background

- Color gradient (Smile NOLA palette by default; per-event customization is v2+)
- Small thumbnails of *other* photos from the same event scrolling slowly upward
- Heavy blur + reduced opacity so they read as motion-and-life, not as competing content
- Compositor-only animation (`transform` + `opacity`) — runs at 60fps on cheap laptops

### 5.3 Hero rotation

- Sequential queue. Items play in upload order.
- New uploads append to the end. The current loop continues; new items get
  picked up on the next pass.
- No interrupts, no jump-to-front, no "new" flash. Predictable rhythm.
- Photo dwell time: ~5 seconds (configurable in code, not exposed in v1)
- Video dwell time: video duration, capped at ~30s
- Transition between items: smooth crossfade (~400ms)

### 5.4 Video audio

- Audio plays on hero videos.
- The booth tech mutes the laptop at the OS level if the venue can't have audio.
- First user interaction with the page (the "Enter Fullscreen" click) unlocks
  browser audio autoplay for the session — no separate UX needed.
- **Known kiosk-mode limitation:** if the wall is opened with `?kiosk=1` and
  never clicked on, browsers block audible autoplay. Audio will start muted
  in that case until the page is clicked once. The tech can still hit `F` to
  fullscreen (a keyboard event also counts as user interaction). Document
  this in the operator handbook; not worth working around.

### 5.5 Viewport & fullscreen behavior

- The wall canvas is **fully fluid** — adapts to any browser window size.
  Phone preview, 16:9 TV, ultrawide LED video wall: same code, same page.
- Prominent **"Enter Fullscreen"** button in a corner of the wall page.
- **Esc** exits fullscreen (browser default behavior, free).
- **`F` key** toggles fullscreen.
- In fullscreen, controls auto-hide after **3 seconds of no mouse movement**;
  reappear on any mouse movement.
- **`?kiosk=1`** URL parameter hides all chrome entirely (button, controls,
  any overlays). For unattended event displays.

---

## 6. Resilience — fragile venue wifi

Every event happens on someone else's wifi, which is often awful. The product
is designed around that, not in spite of it.

### 6.1 Guest upload resilience

- **Service worker upload queue.** Uploads continue in the background even
  if the guest closes the browser tab. Retries with exponential backoff when
  the network returns.
- **Optimistic UI.** Guest sees "✓ Uploaded!" the moment they tap the
  button. The actual transfer completes asynchronously. They don't have to
  babysit it.
- **Single-shot per file**, not chunked. The 50MB cap fits in one PUT; the
  retry queue handles flaky-network failures by re-doing the whole upload.
  Simpler than multipart, simpler than tus.io, and good enough.

### 6.2 Wall resilience

- **Aggressive pre-fetch.** The wall fetches every piece of media to local
  cache *as soon as it learns about it* (via SSE), not when it's about to
  display it. By the time an item is in the rotation, it's already cached.
- **Continues playing through outages.** If the network drops mid-event, the
  wall keeps cycling through already-cached media. The bride/groom don't
  notice anything is wrong.
- **Reconnect catches up.** When the SSE connection recovers, the wall
  queries `/api/events/<slug>/since?ts=<last-seen-timestamp>` to fetch
  anything missed during the outage.

### 6.3 Booth resilience (when booth integration ships later)

- The booth never blocks on network. Strips are written locally first.
- A separate process flushes the local buffer to storage when network is reachable.
- This is the booth's problem to solve, not Second Line's. Second Line just
  needs to accept whatever comes in when it comes in.

---

## 7. Architecture

### 7.1 Where it lives

Second Line is a standalone Astro 5 SSR app. The repo at
`secondline-app` contains one deployable: the app server itself.
It is **single-tenant by design** — one repo deploy serves one
photographer (initially: Smile NOLA). To use the system for a
second photographer, the repo can be forked or redeployed as a
separate Coolify service.

**URL shape:** Smile NOLA's instance lives at
`secondline.smile-nola.com`, served by the app via a Coolify
domain routing rule. Media URLs use a separate subdomain
`media.smile-nola.com` so media fetches don't carry app cookies
and so the proxy can be scaled or replaced independently. A
different deploy can use any other domain pair.

### 7.2 Page shapes (Astro hybrid)

| Page | Route | Shape |
|---|---|---|
| Guest upload | `/u/<event-slug>` | Static shell + client island w/ service worker. Shell loads fast on bad wifi; upload logic is offline-first. |
| Wall | `/w/<event-slug>` | Thick SPA island in a static shell. Must keep running through network blips; caches media locally. |
| Host gallery | `/g/<event-slug>` | SSR + island. Post-event use on presumably-good wifi; standard CRUD. |
| Admin | `/admin/events/...` | SSR, single-password admin auth (built fresh for this app). Operator-only views. |
| Media proxy | `/m/<slug>/<asset>` | SSR pass-through that validates ownership and streams from the backend (Wasabi, NAS, etc). Coolify routes `media.smile-nola.com` to this path. |

URL slugs are short, opaque, unguessable (8 chars from a 31-char alphabet,
≈ 2^39 keyspace, e.g. `ekdnza28`).

### 7.3 Real-time updates

- **SSE (Server-Sent Events) with auto-reconnect.** One-way server→client.
  Native browser reconnect. Works through proxies and firewalls. Simpler
  than WebSockets and that's all we need.
- On (re)connect, the wall sends `?since=<last-seen-timestamp>` so the
  server can replay anything missed during a disconnect.
- Server emits `{ type: 'asset.added', asset: {...} }` on each new upload.

### 7.4 Hosting

- New repo, new Coolify service. The `docker-compose.yml` has one `app` service.
- **Reminders from cross-project "Lessons Learned" (`AGENTS.md`):**
  - Never gate runtime behavior on `request.url.hostname` — Traefik passes
    the internal IP as `Host`. Use `import.meta.env.PROD` or
    `SECONDLINE_PUBLIC_URL` / `MEDIA_PUBLIC_URL`.
  - If a deploy looks stale, suspect Docker layer cache. Use Coolify's
    "Force rebuild without cache" rather than just "Deploy."
  - Use the build-identity pill (admin nav) to confirm which SHA is actually
    live.

### 7.5 Storage — S3-compatible backend registry

**The core idea:** storage is a registry of S3-compatible backends. Every
event is bound to one of them. Adding a new backend is config, not code.

**Registry shape (config file at the repo root, `secondline-backends.json`):**

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

A `nas-home` entry can be added later by appending to this file. Credentials
stay in env vars on Coolify; only env-var names live in the registry JSON.

**Per-event binding:** each event has a `storage_backend_id` column
referencing a registry entry. Set at event creation via a dropdown in the
admin. **Immutable after first upload** (cross-backend migration is out of
scope for v1).

**v1 ships with two backend slots, one populated:**

| ID | What it is | When to pick it |
|---|---|---|
| `wasabi` | Wasabi S3, $6.99/TB/mo, zero egress fees | Default. Customer-facing events, brand-critical events, anything where reliability matters more than saving a few dollars. Ships in `secondline-backends.json` from day one. |
| `nas-home` | MinIO or Garage on a home DS925+ (or adjacent server), exposed over Tailscale | Low-stakes events, internal events, anywhere cost matters more than belt-and-suspenders reliability. NOT shipped in v1 — added by appending a registry entry + env vars when the NAS is ready. |

**Adding a third backend later** = add an entry to the registry, add the
credentials as env vars on Coolify, restart the app. No code change. The
new backend immediately appears in the event-creation dropdown.

### 7.6 Media public-URL strategy

The wall, the guest album, and downloads all need media URLs that work in
arbitrary public browsers. Some backends are publicly reachable (Wasabi);
some aren't (NAS over Tailscale). To unify:

**Coolify proxies all media** at `media.smile-nola.com/m/<event-slug>/<asset-id>`,
which fetches from the actual backend over its appropriate network path.

- Wasabi → public internet
- NAS over Tailscale → tailnet
- Future backends → whatever network path their endpoint requires

**Access control:** Media URLs are gated by the event slug being known. The
slug is 8 opaque characters, which is sufficient against casual enumeration
but is **not a hard security boundary** — anyone with the slug can view the
gallery (which is exactly how Kululu and Memtly work, and matches what hosts
expect: a sharable link). The proxy validates that `<asset-id>` actually
belongs to `<event-slug>` to prevent cross-event asset peeking. Backend-id
is not in the public URL — that's an internal routing detail.

The wall and gallery pre-fetch media into the browser's cache, so the proxy
bandwidth cost is bounded by what each viewer actually displays once.

(Optional v2+: signed short-lived URLs if any customer ever asks for it;
per-site reverse proxies at each NAS location to bypass Coolify. Neither
needed at v1 scale.)

### 7.7 Backup & long-term archive

| Layer | Where | What |
|---|---|---|
| **Operational backup (Wasabi events)** | Nightly rclone from Wasabi → home DS925+ via Tailscale | Belt-and-suspenders during the live 6-month window |
| **Long-term archive (all events, post-6mo)** | DS925+, replicated to both DS220s via Synology Snapshot Replication or Hyper Backup | 3-way geographic redundancy after expiry |
| **Cold restore** | Manual process pulling from DS925+ on request | "I lost my photos, it's been 8 months" → optional retrieval fee |

**Hardware notes:**

- **DS925+** (4-bay, Ryzen V1500B, 4GB→32GB RAM, full Container Manager
  support): runs MinIO/Garage natively, is the active NAS endpoint.
- **DS220 × 2** (2-bay, ARM Realtek, 512MB RAM, no Container Manager):
  passive replicas. Each is co-located with a separate server that *could*
  expose its own S3 endpoint if promoted to a live backend later (future
  optionality, not v1 scope).

### 7.8 Retention enforcement

- Nightly cron in Coolify: find events where `event_date + 180 days < now`,
  delete all guest-uploaded assets from their storage backend, mark the
  event as `expired`, set the gallery URL to redirect to the event's
  PicTime gallery.
- 30 days before expiry: send the host a reminder email with the ZIP
  download link and a print-sales CTA. Deduped via a `warned_30_at` column
  so re-running the cron in the same window doesn't double-email.
- Expired event gallery URL: HTTP 302 → PicTime gallery URL stored on the
  event record.

---

## 8. Data model

The schema is created from scratch by the app on first boot — no inherited
tables, no external system to migrate from.

```
events
  id INTEGER PK
  slug TEXT UNIQUE              -- 8-char opaque public ID
  storage_backend_id TEXT       -- FK to backend registry (JSON, not table)
  host_first_name TEXT
  host_last_name TEXT
  host_email TEXT
  event_date TEXT               -- YYYY-MM-DD
  pictime_gallery_url TEXT      -- nullable
  expires_at TEXT               -- ISO timestamp (event_date + 180 days), nullable
  status TEXT                   -- 'active' | 'expired'
  first_upload_at TEXT          -- nullable
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  warned_30_at TEXT             -- nullable, prevents duplicate expiry warnings

assets
  id INTEGER PK
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE
  source TEXT NOT NULL DEFAULT 'guest' CHECK (source IN ('guest','booth'))
  storage_key TEXT NOT NULL     -- path in backend bucket
  thumb_storage_key TEXT
  mime_type TEXT NOT NULL
  byte_size INTEGER NOT NULL
  width INTEGER
  height INTEGER
  duration_ms INTEGER           -- null for images
  uploader_name TEXT            -- optional, guest can leave blank
  uploaded_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  deleted_at TEXT               -- soft delete
```

Indexes: `events(slug)`, `events(status)`, `events(expires_at)`,
`assets(event_id, uploaded_at)`, partial index on `assets(event_id) WHERE
deleted_at IS NULL`.

---

## 9. Tech stack

- **App:** Astro 5 SSR with `@astrojs/node` standalone adapter, React 18
  islands via `@astrojs/react` (one island each for wall, upload, gallery).
- **DB:** SQLite via Node's built-in `node:sqlite` (no native build step;
  Node 22.5+). Single file at `${SECONDLINE_DB_DIR:-./data}/secondline.db`.
  WAL mode, synchronous=NORMAL, foreign_keys=ON.
- **Storage:** Wasabi (v1 default) + future MinIO/Garage on home NAS.
  Both speak S3 via AWS SDK v3 (`@aws-sdk/client-s3`).
- **Realtime:** SSE.
- **Upload:** Single-shot multipart POST per file, retried by a tiny custom
  service worker (no Workbox).
- **QR codes:** `qrcode` npm package, server-side SVG.
- **ZIP:** `archiver` npm package, streamed.
- **Image processing:** `sharp` with libheif-enabled prebuild for HEIC support.
- **Email:** Resend, via a thin wrapper in `src/lib/email.ts`.
- **Auth:** Single-password admin, HMAC-signed session cookie, in-memory
  rate limit. Built fresh for this repo, no external dependency.
- **Tests:** `vitest` (run config in `vitest.config.ts`).
- **Typecheck:** `astro check`.

---

## 10. Risks & open questions for implementation

These are not v1-blockers but should be tracked through implementation:

1. **MinIO/Garage on Synology DS925+:** verify Container Manager image and
   bind-mount permissions work cleanly. Smoke test before depending on it
   for an event. Out of scope until the second backend ships.
2. **HEIC handling:** iPhone photos are HEIC by default. Server-side
   conversion to JPEG (sharp + libheif) is mandatory before display.
   The Task 1 verification step confirms whether the sharp prebuild
   includes libheif on the Dockerfile's Node 22 Alpine base.
3. **PicTime API:** can we automatically push booth output to PicTime, or
   is it a manual import? If manual, the funnel still works but should be
   honest in the host email copy. Out-of-band investigation, not v1.
4. **Wall pre-fetch storage limit:** browsers cap how much a service worker
   can cache. At a 500-photo wedding with 1080p videos, we may exceed it.
   The wall caches via the browser's HTTP cache (`Cache-Control: immutable`),
   not via the SW cache — so we don't enforce a cap. If real events show
   eviction problems, add an LRU later.
5. **Mobile data costs for guests:** guests on cellular uploading 4K video
   may rack up charges. Surface this politely on the upload page
   ("We recommend joining venue wifi before uploading videos") — v2 copy
   tweak, not a v1 blocker.

---

## 11. Success criteria for v1

We'll call v1 done when:

- An operator can create a new event from the admin form in under a minute
  and immediately print its QR.
- An operator can print a QR code from the admin
- A guest can scan, upload a photo or video from an iPhone, and see it on
  a wall within ~30s, end-to-end on real venue wifi
- The wall runs in fullscreen for 6+ hours without manual intervention
  (after one initial click to enter fullscreen / unlock audio) and
  continues running through a simulated 5-minute network outage
- A host receives the post-event email with a working ZIP download
- A test event past its TTL is correctly purged and its URL correctly
  redirects to the PicTime gallery URL on file
- At least one real Smile NOLA event has used it end-to-end successfully

---

## 12. Out of scope for this spec (parking lot)

Captured here so they're not lost, but **not part of v1**:

- Photobooth → wall integration (separate later project; the upload API
  will accept any authenticated client)
- Per-event color/theme customization
- Moderation queues / pre-approval mode
- Promoting DS220-site servers to additional live backends
- "Save my favorites" / curation flows for the host
- Live reactions, voting, comments on photos
- SMS notifications to guests
- Auto-creating short URLs (e.g. `secondline.com/abc`) — subdomain only in v1
- Multi-language UI
- Public marketing page for Second Line as a product
- Auto-event-creation from external systems (a webhook endpoint from
  smile-nola's inquiry API, etc. — could be added later via a thin
  HTTP webhook)
