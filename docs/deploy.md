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
