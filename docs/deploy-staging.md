# Second Line — Staging deploy (CasaOS on ZimaBlade, Tailscale-internal HTTPS)

The ZimaBlade is the team's pre-prod test box. Reached over Tailscale by the
team for internal validation — no public DNS, no public exposure to the
internet — but **with a real Let's Encrypt cert** issued by Tailscale for
tailnet traffic. Production is a separate Coolify deploy at
`secondline.smile-nola.com`; see `docs/deploy.md` for that flow.

## Why this works

`tailscale serve --https=443` issues a real Let's Encrypt cert for your
machine's tailnet hostname (`<machine>.<tailnet>.ts.net`) and terminates TLS
locally. The cert is valid, browsers don't warn, iOS Safari registers
Service Workers normally — but the URL is only reachable from devices on
your tailnet. Perfect for team-internal staging.

This means **every Task 32 step is testable on staging**, including the
iPhone HEIC + Service Worker retry queue paths. No "skip this and verify in
prod" caveats.

## Prerequisites

- ZimaBlade running CasaOS, joined to your tailnet, with Docker installed
- A machine name registered for the ZimaBlade in your tailnet
  (`tailscale status` on the box shows it — e.g. `zimablade`, becoming
  `zimablade.<your-tailnet>.ts.net`)
- Tailscale 1.52+ on the ZimaBlade (the `tailscale serve` syntax used below
  is the post-1.52 version)
- HTTPS enabled in your tailnet admin console:
  https://login.tailscale.com/admin/dns → "HTTPS Certificates" → Enable
- Phones used for testing have the Tailscale app installed and are signed
  into the same tailnet
- Wasabi staging bucket `secondline-app` in `us-east-1`, IAM user scoped to
  only that bucket, access/secret keys in hand
- Resend API key + verified `from` address you control

## 1. Build the image on your dev machine

```sh
# Tag with the current git SHA so /healthz reports it accurately
SHA=$(git rev-parse --short HEAD)
docker build \
  --build-arg SOURCE_COMMIT=$SHA \
  -t secondline-app:staging-$SHA \
  -t secondline-app:staging-latest \
  .
```

## 2. Ship the image to the ZimaBlade

```sh
docker save secondline-app:staging-latest | \
  gzip | \
  ssh <zima-tailscale-name> "gunzip | docker load"
```

Replace `<zima-tailscale-name>` with the box's tailnet hostname (or its
tailnet IP). The SSH connection itself goes over the tailnet.

## 3. Stage the compose stack on the ZimaBlade

SSH in. Pick `/opt/secondline-staging/` as the stable directory (works
regardless of CasaOS app conventions):

```sh
sudo mkdir -p /opt/secondline-staging/data
sudo chown -R 1000:1000 /opt/secondline-staging/data
cd /opt/secondline-staging
```

Create `/opt/secondline-staging/docker-compose.yml`:

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
    env_file:
      - ./.env
    volumes:
      - ./data:/data
    ports:
      # Bind to localhost only on the ZimaBlade. Tailscale serve (next step)
      # will reverse-proxy from <hostname>.<tailnet>.ts.net:443 → 127.0.0.1:3000.
      # The container is NOT exposed on the LAN or the public internet.
      - "127.0.0.1:3000:3000"
```

The bind-mounted `./data` (owned by UID 1000) gives SQLite a place to write
that's visible host-side for forensic inspection.

## 4. Create `.env` next to the compose file

Edit `/opt/secondline-staging/.env` directly on the box (so secrets never
enter chat or your dev-machine shell history). Use `.env.staging.example`
from the repo as a template. Required vars:

```env
# What URL the app thinks it's served at. Real HTTPS via Tailscale Serve.
# Replace zimablade.<tailnet>.ts.net with your actual tailnet hostname.
SECONDLINE_PUBLIC_URL=https://zimablade.<tailnet>.ts.net
MEDIA_PUBLIC_URL=https://zimablade.<tailnet>.ts.net

# Admin auth
ADMIN_PASSWORD=<pick a real one; you'll type it on phones>
ADMIN_SESSION_SECRET=<openssl rand -hex 32>

# Real Resend
RESEND_API_KEY=re_...
RESEND_FROM=Smile NOLA Staging <staging@your-verified-domain>

# Storage — the staging bucket, never prod
SECONDLINE_ACTIVE_BACKEND=wasabi-staging
WASABI_STAGING_ACCESS_KEY=<IAM key for secondline-app bucket>
WASABI_STAGING_SECRET_KEY=<IAM secret for secondline-app bucket>

# Cron is intentionally NOT scheduled in staging. The token still has to be
# set because the cron endpoints check for it; without it they 503. You'll
# fire them manually with curl during Task 32 step 6/7.
SECONDLINE_CRON_TOKEN=<openssl rand -hex 32>
```

Notably absent: `WASABI_ACCESS_KEY` / `WASABI_SECRET_KEY` (prod). The
backend registry will log
`[secondline] backend "wasabi" skipped: missing WASABI_ACCESS_KEY` on boot.
That's expected and harmless. Only the backend referenced by
`SECONDLINE_ACTIVE_BACKEND` needs to be configured.

## 5. Start the container

```sh
cd /opt/secondline-staging
docker compose up -d
docker compose logs -f app
```

Expected:
- `[secondline] backend "wasabi" skipped: missing WASABI_ACCESS_KEY`
- `Listening on http://0.0.0.0:3000`
- No SQLite errors

Verify on the box loopback:

```sh
curl -s http://127.0.0.1:3000/healthz
# {"ok":true,"sha":"<short-sha>","ts":"..."}
```

## 6. Front it with `tailscale serve --https`

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
```

This:
- Provisions a Let's Encrypt cert for `<your-machine>.<tailnet>.ts.net` (if
  it doesn't already exist; cached after first issuance)
- Listens on the tailnet interface, port 443
- Reverse-proxies all requests to the local app on port 3000
- Runs in the background and persists across `tailscale up`/`down` cycles

Verify the cert is live from your dev machine (on the tailnet):

```sh
curl -s https://zimablade.<tailnet>.ts.net/healthz
# Should return JSON with the SHA, no cert warning
```

If `--https=443` errors with "MagicDNS or HTTPS not enabled," enable HTTPS
in the tailnet admin: https://login.tailscale.com/admin/dns → "HTTPS
Certificates" → Enable → wait ~30 seconds → retry.

To disable the serve later:

```sh
sudo tailscale serve --https=443 off
```

## 7. Open from your laptop and phones

From any device on the tailnet (phones need the Tailscale app installed and
to be signed in):

```
https://zimablade.<tailnet>.ts.net/admin/login
```

Cert is real, no warning. iOS Safari registers the Service Worker. The full
Task 32 flow is now testable end-to-end.

## 8. Walk through Task 32

From your laptop on the tailnet, open the admin URL. Run Task 32 steps 1-7
exactly as documented in `docs/plans/2026-05-25-second-line.md`, with these
adaptations:

- Replace every reference to `https://secondline.smile-nola.com` with
  `https://zimablade.<tailnet>.ts.net` (or whatever your machine's tailnet
  hostname is)
- For step 6 / step 7 cron triggers, run them from the box's loopback to
  bypass Tailscale serve entirely:
  ```sh
  # On the ZimaBlade
  curl -X POST \
    -H "Authorization: Bearer $(grep ^SECONDLINE_CRON_TOKEN /opt/secondline-staging/.env | cut -d= -f2)" \
    http://127.0.0.1:3000/api/cron/reminders
  ```
- For the SQLite UPDATE in step 6 (to backdate `expires_at`), run on the
  ZimaBlade against the bind-mounted DB:
  ```sh
  sqlite3 /opt/secondline-staging/data/secondline.db \
    "UPDATE events SET expires_at = datetime('now','+25 days'), warned_30_at = NULL WHERE id = <TEST-EVENT-ID>"
  ```
- Skip step 8 ("tag the release") — tag from prod after the Coolify deploy
  succeeds, not after staging

## 9. Iterate

To deploy a new commit to staging:

```sh
# On dev machine
SHA=$(git rev-parse --short HEAD)
docker build --build-arg SOURCE_COMMIT=$SHA -t secondline-app:staging-latest .
docker save secondline-app:staging-latest | gzip | \
  ssh <zima> "gunzip | docker load"

# On the ZimaBlade
cd /opt/secondline-staging
docker compose up -d --force-recreate

# Verify the new SHA actually deployed (from dev machine, via tailscale serve)
curl -s https://zimablade.<tailnet>.ts.net/healthz
```

If `/healthz` reports the old SHA, the image didn't update. Most common
cause: `docker load` was a no-op because the tag already existed. Rebuild
with a fresh `staging-$SHA` tag and update the compose file's `image:`
field.

## Tearing it down

```sh
# Stop serving the tailnet endpoint
sudo tailscale serve --https=443 off

# Stop the container
cd /opt/secondline-staging
docker compose down

# Preserve DB:        do nothing further
# Wipe DB:            sudo rm -rf data/
# Wipe Wasabi bucket: empty `secondline-app` via Wasabi console, or trigger
#                     /api/cron/cleanup with all events backdated
```

## Differences from prod (docs/deploy.md)

| Thing | Staging (ZimaBlade) | Prod (Coolify) |
|---|---|---|
| Hostname | `<machine>.<tailnet>.ts.net` | `secondline.smile-nola.com` |
| TLS | Tailscale-provisioned LE cert (tailnet-only) | Coolify-provisioned LE cert (public) |
| Reachability | Devices on the tailnet only | Public internet |
| Wasabi bucket | `secondline-app` | `secondline-prod` |
| `SECONDLINE_ACTIVE_BACKEND` | `wasabi-staging` | `wasabi` |
| Cron tasks | Disabled (manual curl) | Two daily scheduled tasks |
| iPhone HEIC + SW | **Testable** (real cert) | Testable |
| Deploy mechanism | `docker save` + `docker load` over SSH | Coolify "Force rebuild without cache" |
