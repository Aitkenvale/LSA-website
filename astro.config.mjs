// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Canonical public address (NSA CNAME live 2026-08-10); bahaitownsville.org.au redirects here
  site: 'https://townsville.bahai.org.au',
  // 'compile' = images optimised at build time with sharp (free; all our
  // image-bearing pages are prerendered) instead of paid Cloudflare Images
  adapter: cloudflare({ imageService: 'compile', platformProxy: { enabled: true } }),
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
