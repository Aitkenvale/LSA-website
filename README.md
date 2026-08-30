# Bahá'í Community of Townsville — website

Community website: upcoming events and announcements, What We Believe / What We
Do pages, and a Community Centre page with a live hire-availability calendar and
application form. Built to be maintained by non-technical editors.

Live at https://townsville.bahai.org.au — total recurring cost **$0/month**
(every service on a free tier).

- **Editing** (non-technical): see [docs/EDITOR-GUIDE.md](docs/EDITOR-GUIDE.md)
- **Deployment & service setup**: see [docs/SETUP.md](docs/SETUP.md)
- **Full specification** (architecture, every service, how it all fits):
  see [docs/SPEC.md](docs/SPEC.md)

## Reusing this for your own community

This repo is public so other communities can build the same thing. Click
**"Use this template"** on GitHub (or fork), then:

1. Follow [docs/SETUP.md](docs/SETUP.md) end to end — it walks through every
   service (GitHub, Cloudflare Workers, Pages CMS, Google Calendar, Resend,
   Turnstile, the daily rebuild) on free tiers.
2. Replace the Townsville-specific content with your own: everything under
   `src/content/`, the photos in `src/assets/uploads/`, the documents in
   `public/files/`, the logo in `src/components/Logo.astro`, and `site` in
   `astro.config.mjs`.
3. Read [docs/SPEC.md](docs/SPEC.md) §11 first — it lists the operational
   quirks that cost us the most time.

No secrets live in this repo; all credentials are Cloudflare Worker secrets.

## Stack

| Piece | Choice |
|---|---|
| Framework | Astro + Tailwind CSS (static pages + two server API routes) |
| CMS | [Pages CMS](https://pagescms.org) — config in `.pages.yml`; editors sign in by email code |
| Hosting | Cloudflare Workers (git-connected deploys, free tier) |
| Availability calendar | Google service account → `/api/availability` (freeBusy proxy, busy blocks only) → custom grid |
| Hire form | `/api/hire` → Turnstile spam check → Resend email to booking officer |

## Key files

- `.pages.yml` — what editors can see/change (keep in sync with `src/content.config.ts`)
- `src/content/` — all site content (Markdown/YAML, committed by the CMS)
- `src/pages/api/availability.ts` — privacy boundary: only busy start/end times ever leave it
- `src/pages/api/hire.ts` — hire-form handler
- `docs/SETUP.md` — secrets, Google/Resend/Turnstile setup, the daily-rebuild cron (required)

## Development

```sh
npm install
cp .dev.vars.example .dev.vars   # optional; dev works without credentials
npm run dev                      # http://localhost:4321
npm run build                    # production build (dist/)
```

Without credentials, the availability API serves sample data in dev and the hire
form returns a friendly "not configured" message.

Timezone note: all event/calendar times are Australia/Brisbane (no DST). Naive
datetimes from the CMS are interpreted as Brisbane wall-clock time in
`src/content.config.ts` — don't let anything parse them in the build machine's
timezone.
