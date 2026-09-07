// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

/*
 * Whether the calendar is announced, read straight from the settings file.
 *
 * The sitemap is built here rather than in a page, so it cannot ask the
 * content collection. Reading the one line keeps a single source of truth: an
 * editor turns the switch off in Pages CMS and the calendar leaves the header,
 * gains a noindex, and drops out of the sitemap together. Parsed with a plain
 * expression rather than a YAML library — it is one boolean, and a dependency
 * to read it would be worse than the regex.
 */
const showCalendarLink = (() => {
  try {
    return /^showCalendarLink:\s*true\s*$/m.test(readFileSync('src/content/settings/site.yml', 'utf8'));
  } catch {
    // Missing or unreadable settings: assume unannounced, which errs towards
    // keeping the page out of the sitemap rather than into it.
    return false;
  }
})();

// https://astro.build/config
export default defineConfig({
  // Canonical public address (NSA CNAME live 2026-08-10); bahaitownsville.org.au redirects here
  site: 'https://townsville.bahai.org.au',
  // 'compile' = images optimised at build time with sharp (free; all our
  // image-bearing pages are prerendered) instead of paid Cloudflare Images
  adapter: cloudflare({ imageService: 'compile', platformProxy: { enabled: true } }),
  integrations: [
    sitemap({
      filter: (page) => showCalendarLink || !new URL(page).pathname.startsWith('/calendar'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
