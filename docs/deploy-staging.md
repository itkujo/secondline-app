# Second Line — Staging deploy (CasaOS on ZimaBlade, behind Tailscale)

A pre-prod environment so you can run Task 32 (end-to-end smoke test) against
the same Docker image you'll ship to prod, without touching prod Wasabi or
sending real cron-triggered emails.

This runbook assumes:
- A ZimaBlade running CasaOS, reachable on your tailnet
- Tailscale Funnel or a Tailscale-bound subdomain with TLS (iOS Safari refuses
  Service Worker registration on non-HTTPS, non-localhost origins, which would
  silently break the upload-retry queue and HEIC conversion)
- A separate Wasabi bucket `secondline-staging` (see `docs/deploy.md` for the
  bucket + IAM creation pattern; mirror that for staging)
- A Resend API key + a verified `from` address you control

Cron is intentionally NOT scheduled in staging. Retention and expiry-reminder
crons are reached manually via `curl` when you want to test Step 6/7 of Task
32. This prevents a misconfigured `expires_at` from wiping a staging event
out from under you.

## 1. Build and ship the image to the ZimaBlade

On your dev machine:

```sh
# Tag with the current git SHA so /healthz reports it accurately
SHA=$(git rev-parse --short HEAD)
docker build \
  --build-arg SOURCE_COMMIT=$SHA \
  -t secondline-app:staging-$SHA \
  -t secondline-app:staging-latest \
  .

# Save and SCP to the ZimaBlade (replace <zima-tailscale-name>)
docker save secondline-app:staging-latest | \
  gzip | \
  ssh <zima-tailscale-name> "gunzip | docker load"
```

(If you prefer a registry, push to ghcr.io or a self-hosted registry and pull
on the ZimaBlade. The save/load loop above avoids that for a quick first run.)

## 2. Drop the compose file on the ZimaBlade

The repo's root `docker-compose.yml` was written for Coolify — it builds from
context. For CasaOS we want a pre-built-image variant. Save this as
`/var/lib/casaos/apps/secondline-staging/docker-compose.yml` on the box:

```yaml
services:
  app:
    image: secondline-app:staging-latest
    container_name: secondline-staging
    restart: unless-stopped
    environment:
      PORT: "3000"
      NODE_ENV: production
      SECONDLINE_DB_DIR: /data
      # everything else from the .env file beside this compose file:
    env_file:
      - ./.env
    volumes:
      - ./data:/data
    ports:
      # Bind to the Tailscale interface only — the box should not expose
      # this port on the public LAN. Replace <tailscale-ip> with the actual
      # IP `tailscale ip -4` reports on the ZimaBlade, OR use Tailscale Funnel
      # which proxies in front of localhost.
      - "<tailscale-ip>:3000:3000"
```

Why a bind-mounted `./data` directory rather than a named volume? On CasaOS,
bind mounts are visible in the file manager (you can grab a copy of
`secondline.db` for forensic inspection), and they survive `docker compose
down -v` without surprises. Named volumes are equally fine if you prefer.

Make sure the host `./data` directory is owned by UID 1000 (the in-container
`node` user) so SQLite can write:

```sh
mkdir -p /var/lib/casaos/apps/secondline-staging/data
chown 1000:1000 /var/lib/casaos/apps/secondline-staging/data
chmod 755 /var/lib/casaos/apps/secondline-staging/data
```

## 3. Create the staging `.env` next to the compose file

Copy `.env.staging.example` from the repo root to
`/var/lib/casaos/apps/secondline-staging/.env` on the box and fill in your
values. The required vars for staging are:

```env
# What URL the app thinks it's publicly served at. Used in:
#   - emails (gallery URL, ZIP CTA, expiry warning)
#   - QR codes printed from the admin event detail
# MUST be the HTTPS Tailscale-fronted URL, not the bare IP.
SECONDLINE_PUBLIC_URL=https://secondline-staging.<your-tailnet>.ts.net
MEDIA_PUBLIC_URL=https://secondline-staging.<your-tailnet>.ts.net

# Admin auth
ADMIN_PASSWORD=<pick a real one; phones will type it>
ADMIN_SESSION_SECRET=<openssl rand -hex 32>

# Resend — real keys so you can verify email rendering in your inbox
RESEND_API_KEY=re_...
RESEND_FROM=Smile NOLA Staging <staging@your-verified-domain>

# Storage — the STAGING bucket, never prod
SECONDLINE_ACTIVE_BACKEND=wasabi-staging
WASABI_STAGING_ACCESS_KEY=<IAM key for secondline-staging>
WASABI_STAGING_SECRET_KEY=<IAM secret for secondline-staging>

# Cron is intentionally NOT scheduled in staging. The token still has to be
# set because the cron endpoints check for it; without this they 503. You'll
# fire them manually with curl during Task 32 step 6/7.
SECONDLINE_CRON_TOKEN=<openssl rand -hex 32>
```

Notably absent: `WASABI_ACCESS_KEY` / `WASABI_SECRET_KEY` (prod). The
backend registry will log a `[secondline] backend "wasabi" skipped: missing
WASABI_ACCESS_KEY` warning on boot — that's expected and harmless. Only the
backend referenced by `SECONDLINE_ACTIVE_BACKEND` needs creds.

## 4. Start it

```sh
cd /var/lib/casaos/apps/secondline-staging
docker compose up -d
docker compose logs -f app
```

Expected log lines:
- `[secondline] backend "wasabi" skipped: missing WASABI_ACCESS_KEY`
- `Listening on http://0.0.0.0:3000`
- No SQLite errors

Verify the SHA and healthcheck from the same box:

```sh
curl -s http://127.0.0.1:3000/healthz
# {"ok":true,"sha":"<expected-short-sha>","ts":"..."}
```

## 5. Bind the Tailscale-fronted hostname with TLS

Two paths, pick one:

**Tailscale Funnel (simplest):**

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
sudo tailscale funnel 443 on
```

This exposes the container on `https://<zima-machine-name>.<your-tailnet>.ts.net`
with a real Let's Encrypt cert auto-managed by Tailscale. Phones outside the
tailnet can reach it, which is what you want for the QR scan test.

**Reverse proxy with a real subdomain (more polish, more work):**

Add an A record `secondline-staging.smile-nola.com` → ZimaBlade's Tailscale
IP, then put Caddy or Traefik on the box doing TLS-ALPN-01 or DNS-01 cert
issuance, with `secondline-staging.smile-nola.com` reverse-proxying to
`127.0.0.1:3000`. Out of scope for this runbook; the Tailscale Funnel path
covers the smoke test.

## 6. Verify from a phone over Tailscale

Open `https://<the URL you just set up>/admin/login` on your phone:

- Cert should be green (no warning)
- Log in with `ADMIN_PASSWORD`
- The build-pill in the top-right of the admin nav shows the short SHA
  matching what you built locally

If the cert is bad → SW won't register, HEIC conversion test won't work, the
upload retry queue won't engage. Fix the cert before proceeding.

## 7. Walk through Task 32

Use the staging URL everywhere Task 32 says `secondline.smile-nola.com`.
Specifically:

- Step 6 (expiry warning): the `sqlite3` UPDATE statement runs against
  `/var/lib/casaos/apps/secondline-staging/data/secondline.db` on the
  ZimaBlade (not inside the container — the bind mount makes the file
  available host-side).
- Step 6/7 (cron triggers): hit `http://127.0.0.1:3000/api/cron/...` from
  inside the box (since you didn't expose port 3000 to the LAN), or
  `https://<staging URL>/api/cron/...` from your dev machine with the
  bearer token. Both work.

## Tearing it down

```sh
cd /var/lib/casaos/apps/secondline-staging
docker compose down
# DB and uploads in ./data are preserved. To wipe:
rm -rf data/
```

## Iterating

To deploy a new commit:

```sh
# On dev machine
SHA=$(git rev-parse --short HEAD)
docker build --build-arg SOURCE_COMMIT=$SHA -t secondline-app:staging-latest .
docker save secondline-app:staging-latest | gzip | \
  ssh <zima> "gunzip | docker load"

# On the ZimaBlade
cd /var/lib/casaos/apps/secondline-staging
docker compose up -d --force-recreate

# Verify the new SHA actually deployed
curl -s http://127.0.0.1:3000/healthz
```

If the SHA from `/healthz` doesn't match what you expected, the image didn't
update — most likely the `docker load` skipped because the tag already
existed at that name. Rebuild with a fresh `staging-$SHA` tag and update
the compose file's `image:` field.
