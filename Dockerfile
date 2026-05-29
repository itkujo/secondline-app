# syntax=docker/dockerfile:1.7

# --- Stage 1: build ---
FROM node:22-alpine AS build
WORKDIR /app

# Build deps for sharp (libvips). HEIC is converted client-side via heic2any
# in the browser, so we do NOT need vips-heif or libde265 server-side.
RUN apk add --no-cache vips

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

# Runtime libvips for sharp + tini for proper PID 1 signal handling.
# No vips-heif: HEIC is handled in the browser (see Decisions Locked table).
RUN apk add --no-cache vips tini

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy only what the runtime needs
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/secondline-backends.json ./secondline-backends.json
COPY --from=build /app/public ./public

# Run as the baked-in `node` user (UID/GID 1000) so volume contents aren't
# root-owned. CasaOS / Synology / Coolify all mount cleanly at 1000:1000.
# /data is the persistent volume mount for secondline.db; chown so the
# non-root process can write on first boot.
RUN mkdir -p /data && chown -R node:node /data /app
ENV SECONDLINE_DB_DIR=/data
ENV NODE_ENV=production
ENV PORT=3000

USER node

EXPOSE 3000

# tini reaps zombies; node entrypoint serves the SSR adapter
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "./dist/server/entry.mjs"]

# Liveness via the dedicated /healthz endpoint (cheap, no middleware, no
# DB write). Returns 200 with the build SHA so you can grep the container
# log for the SHA you expect to be running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1
