import type { APIRoute } from 'astro';

// Prerendered at build time — shows when the site was last built.
// Used to verify the nightly rebuild cron is working.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ built: new Date().toISOString() }), {
    headers: { 'content-type': 'application/json' },
  });
