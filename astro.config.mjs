import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Second Line — standalone Astro SSR app for live event photo/video walls.
// Deploys as a single container via Coolify; serves both the app domain
// (secondline.smile-nola.com) and the media subdomain (media.smile-nola.com)
// — Coolify owns Traefik labels, this app is host-agnostic.

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  site: "https://secondline.smile-nola.com",
  server: { host: true, port: Number(process.env.PORT ?? 4321) },
  // Traefik proxies break Astro's Origin check (Host header is the internal
  // container IP, not the public domain). CSRF defense is the signed HMAC
  // session cookie for admin routes + JSON content-type on public forms.
  security: { checkOrigin: false },
  vite: { plugins: [tailwindcss()] },
  build: { inlineStylesheets: "auto" },
});
