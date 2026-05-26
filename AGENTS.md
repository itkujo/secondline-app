# AGENTS.md — Second Line

This is the standalone Second Line repo. It is NOT part of the smile-nola
monorepo. The original design and historical context were authored inside
that monorepo; the canonical spec and plan now live here in `docs/`.

## Stack

- Astro 5 SSR, `@astrojs/node` standalone adapter
- React 18 islands (`@astrojs/react`)
- SQLite via Node's built-in `node:sqlite` module (no native dep, no compile step).
  Single file at `${SECONDLINE_DB_DIR:-./data}/secondline.db`.
- Tailwind v4 via `@tailwindcss/vite`
- AWS SDK v3 (`@aws-sdk/client-s3`) for object storage — supports Wasabi, MinIO, Garage, any S3-compatible endpoint
- Resend for transactional email
- vitest for tests, `astro check` for typecheck (no ESLint/Biome/Prettier)
- pnpm 10.x
- Node **>= 22.5.0** required (`node:sqlite` was added there, stable since 22.12).
  Enforced via `engines.node` in package.json.

## Conventions

- TS strict mode, path alias `@/* → src/*`, `verbatimModuleSyntax: true` (always `import type`)
- API routes: `export const prerender = false;` at top, local `function json()` helper at bottom
- DB column naming: snake_case. TS interfaces: PascalCase.
- File naming: PascalCase for components, camelCase or kebab-case for lib modules
- Fire-and-forget side effects: `void someFn(...)` — never throw to the client from email/storage failures
- Always `getEnv()` from `@/lib/env`, never raw `process.env`
- `crypto.randomUUID()` for external IDs, `crypto.timingSafeEqual` for token compares

## Critical proxy lesson (from smile-nola operational experience)

Never gate runtime behavior on `request.url.hostname` / `Astro.url.hostname`.
Traefik (Coolify's bundled proxy) forwards the internal IP as the `Host`
header inside the container. Use `import.meta.env.PROD` for build-time prod
checks, or `SECONDLINE_PUBLIC_URL`/`MEDIA_PUBLIC_URL` env vars, or
`X-Forwarded-Proto`/`X-Forwarded-Host` headers when you need the public origin.

## Deploy hygiene

- `SOURCE_COMMIT` is injected by Coolify at runtime — surface it in the admin
  UI build-pill so you can verify which SHA is actually live (`curl -s "https://secondline.smile-nola.com/?cb=$(date +%s)"`).
- If a deploy looks stale, use Coolify's "Force rebuild without cache" not
  "Deploy" — Docker layer cache can serve a stale `COPY . .` layer.
- The Dockerfile pins a Node 22+ Alpine base. Because we use `node:sqlite`
  (no native build), there's no Alpine-version constraint from SQLite. The
  only native deps are `sharp` (image processing) — if `sharp` ever changes
  its prebuild support, verify before bumping the base image.

## Why `node:sqlite` instead of `better-sqlite3`

- Zero native build step (works on any Node 22.5+ without `node-gyp`)
- Ships with Node — one fewer thing to break across Alpine versions
- API is a strict subset of better-sqlite3 (prepared statements + `run`/`get`/`all`/`iterate`)
- If we ever need pragmas or features `node:sqlite` lacks, swapping back is a small DB-layer edit
