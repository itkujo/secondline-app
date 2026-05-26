# AGENTS.md — Second Line

This is the standalone Second Line repo. It is NOT part of the smile-nola
monorepo. The original design and historical context were authored inside
that monorepo; the canonical spec and plan now live here in `docs/`.

## Stack

- Astro 5 SSR, `@astrojs/node` standalone adapter
- React 18 islands (`@astrojs/react`)
- SQLite via `better-sqlite3` (single file at `${SECONDLINE_DB_DIR:-./data}/secondline.db`)
- Tailwind v4 via `@tailwindcss/vite`
- AWS SDK v3 (`@aws-sdk/client-s3`) for object storage — supports Wasabi, MinIO, Garage, any S3-compatible endpoint
- Resend for transactional email
- vitest for tests, `astro check` for typecheck (no ESLint/Biome/Prettier)
- pnpm 10.x

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
- Alpine 3.22 is pinned in the Dockerfile because 3.23's musl breaks
  better-sqlite3's prebuilt binary. Any new native dep must verify Alpine 3.22.
