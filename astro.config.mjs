// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // TODO: set to the community's real domain before launch
  site: 'https://townsville-bahai.pages.dev',
  // 'compile' = images optimised at build time with sharp (free; all our
  // image-bearing pages are prerendered) instead of paid Cloudflare Images
  adapter: cloudflare({ imageService: 'compile', platformProxy: { enabled: true } }),
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
