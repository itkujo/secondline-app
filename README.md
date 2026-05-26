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

## Deploy

See `docs/deploy.md` (to be written during implementation plan task 27).

## License

TBD (private during development).
