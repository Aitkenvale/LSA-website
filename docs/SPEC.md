# Website specification — Bahá'í Community of Townsville

*Complete blueprint: what was built, every service involved, and how to replicate
it from scratch. Written so a developer or AI agent with no prior context can
rebuild or maintain the entire system.*

Last updated: 2026-08-31. Status: **live** at https://townsville.bahai.org.au
(canonical; https://bahaitownsville.org.au serves the same site — 301 redirect
pending). Pre-launch gate active until the CMS `sitePassword` field is cleared.

---

## 1. What this is

A community website with a self-service venue-booking system, maintained by
non-technical editors, at $0/month recurring cost:

- **Home** — upcoming events + news, both auto-expiring, edited via CMS
- **What We Believe / What We Do** — content pages (hero + text/image sections)
- **Community Centre** — facility description, photo gallery, **live
  availability calendar** (fed by Google Calendar, shows only busy/free), hire
  rates, and an **application form** (spam-checked, emails the secretariat with
  a one-click "add to calendar" approval link, auto-acknowledges the applicant)
- **Extra pages** — editors can create unlinked pages that auto-appear at
  `/<file-name>/`

## 2. Architecture

```
Editors ──► Pages CMS (app.pagescms.org, email-code login)
                 │ commits Markdown/YAML/images
                 ▼
GitHub: Aitkenvale/LSA-website (public, source of truth)
                 │ push triggers build
                 ▼
Cloudflare Worker "lsa-website"  (git-connected: npm run build; npx wrangler deploy)
  ├─ static pages (Astro prerendered) + optimised images
  ├─ /api/availability ──► Google Calendar freeBusy (service account, busy blocks only)
  └─ /api/hire ──► Turnstile verify ──► Resend email (notify + acknowledge)

Google Calendar "Bahai Centre" (on lsatownsville@gmail.com)
  ◄── secretariat manages bookings; website reads ONLY free/busy
```

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Astro 7 + Tailwind CSS 4 (`@tailwindcss/vite`) | static output + 2 server routes (`prerender = false`) |
| Adapter | `@astrojs/cloudflare` (Workers, not Pages) | `imageService: 'compile'` — sharp optimises images at build; avoids paid Cloudflare Images |
| Runtime env | `import { env } from 'cloudflare:workers'` | `Astro.locals.runtime.env` was removed in Astro v6+ |
| Wrangler config | minimal `wrangler.jsonc` (name, compat date, `nodejs_compat`) | no `main`/`assets` — adapter generates them; a Pages-style `pages_build_output_dir` breaks the build |
| Content | Astro content collections + Zod (`src/content.config.ts`) | schema mirrors `.pages.yml`; bad CMS input fails the build loudly |
| Email | Resend REST API (no SDK) | |
| Auth to Google | `jose` (SignJWT RS256) — Workers-compatible | googleapis SDK does not run on Workers |
| Fonts | Fraunces (display) + Public Sans via Fontsource | self-hosted, no external font requests |
| Interactivity | vanilla inline `<script>` only | mobile menu, gallery lightbox, calendar island, form submit |

## 4. Accounts and services (all free tier)

| Service | Account | Role |
|---|---|---|
| GitHub | org **Aitkenvale**, repo **LSA-website** (CLI auth: BDS-AU) | source of truth; CMS commits here |
| Cloudflare | account "Assembly@bahaito…" (login email = lsatownsville@gmail.com) | Worker hosting, DNS zone, Turnstile, custom hostnames |
| Pages CMS | app.pagescms.org, sign-in with GitHub; editors invited by email | editing UI; config = `.pages.yml` in repo root |
| Google (free) | **lsatownsville@gmail.com** — the operational account | owns calendars ("Bahai Centre" = venue, "LSA Townsville" = internal), Drive for public files, Cloudflare login, Google Cloud project |
| Google Cloud | project **townsville-website** (no billing) | Calendar API enabled; service account `website-calendar@townsville-website.iam.gserviceaccount.com` |
| Resend | signed in with Google (lsatownsville) | sends form emails from `bookings@bahaitownsville.org.au`; domain verified (region ap-northeast-1) |
| Vodien | registrar for bahaitownsville.org.au (expiry 14 Sep 2029, auto-renew, transfer lock ON, DNSSEC off) | nameservers → aldo/sara.ns.cloudflare.com |
| NSA M365 | qld.bahai.org.au shared mailboxes (pending) | future official email; also SharePoint for Assembly records |

**Retired:** Google Workspace (assembly@/centre@bahaitownsville.org.au) —
cancelled 2026-08-08; email for the domain has no MX by design (clean bounce).
Old InMotion-hosted site — replaced.

## 5. Domains & DNS (zone: bahaitownsville.org.au, on Cloudflare)

| Record | Value | Purpose |
|---|---|---|
| Worker custom domains | apex + www → Worker `lsa-website` | the site |
| A `sites` → 192.0.2.1 (proxied) | Cloudflare for SaaS fallback origin | CNAME target for townsville.bahai.org.au |
| TXT apex | `google-site-verification=Rtj3ATRPfIzJuzUOhB9bU_KWKHBrGF02OEKlSH7-szc` | legacy Google verification (harmless) |
| TXT apex | `v=spf1 -all` | domain sends no email at apex (anti-spoof) |
| MX/TXT `send`, TXT `resend._domainkey` | added by Resend | form-email sending + DKIM |

**townsville.bahai.org.au** (NSA-controlled zone) — **live and canonical**:
NSA added `CNAME townsville.bahai.org.au → sites.bahaitownsville.org.au`; our
side is a Cloudflare for SaaS custom hostname (cert validated via HTTP — if a
cert sticks on "Pending Validation (TXT)", edit it to HTTP validation) plus a
Worker route `townsville.bahai.org.au/*` → lsa-website. `site` in
`astro.config.mjs` points here (canonical/sitemap). The 301 from
bahaitownsville.org.au (Cloudflare redirect rule) is not yet deployed.

## 6. Worker secrets (Settings → Variables and Secrets; names only — values in committee password store / service dashboards)

| Name | Purpose |
|---|---|
| `GOOGLE_SA_EMAIL` | service-account client_email |
| `GOOGLE_SA_KEY` | service-account private_key (PEM; literal `\n` OK — code normalises) |
| `VENUE_CALENDAR_ID` | the venue calendar's ID (`…@group.calendar.google.com`, from calendar Settings → Integrate calendar) |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM` | `Bahai Community of Townsville <bookings@bahaitownsville.org.au>` — **ASCII only**; accented characters make Resend reject the send |
| `TURNSTILE_SECRET` | Turnstile server key (widget: hostnames bahaitownsville.org.au, townsville.bahai.org.au, localhost; Managed mode) |

Turnstile **site** key is public and hardcoded as a fallback in
`HireForm.astro` (overridable via `PUBLIC_TURNSTILE_SITE_KEY` build var).

## 7. Content model ↔ CMS

`.pages.yml` (CMS) must stay in sync with `src/content.config.ts` (Zod). CMS
sidebar order: Home · What We Believe · What We Do · Community Centre ·
Community Centre gallery · Pages · Events · News · Site settings.

| CMS item | File(s) | Notes |
|---|---|---|
| Home | `src/content/homepage/home.yml` | hero title/intro/buttons, section headings, empty-state texts, venue call-out |
| What We Believe / What We Do | `src/content/pages/*.md` | title, intro (rich-text), hero image+alt, sections[]: heading, text (rich-text/markdown), optional image+alt, imageCaption, imageStyle (`photo` = framed 3:2 crop / `emblem` = small uncropped icon-style), imageSide (`left`/`right` on desktop) |
| Community Centre | `src/content/centre/centre.md` | page fields **plus** hire settings: hireHeading, hireCalendarNote, hireIntro, hirePolicyUrl (link shown on the form), hireRates[] |
| Community Centre gallery | `src/content/gallery/gallery.yml` | single file: photos[] of {image, caption}; array order = display order — rows are **drag-sortable** in the CMS; caption renders under each photo and in the lightbox |
| Pages (future) | `src/content/extra-pages/*.md` | auto-routed by `src/pages/[slug].astro` at `/<file-name>/`; not in nav |
| Events | `src/content/events/*.md` | title, start/end (naive datetimes = **Brisbane wall clock**; schema appends +10:00 — never let the build machine's TZ parse them), location, image+alt, body. Home shows `end ?? start >= build-time now`; **requires the daily rebuild cron** |
| News | `src/content/announcements/*.md` | newest 5 shown; optional `expires` |
| Site settings | `src/content/settings/site.yml` | siteName, tagline (SEO description), contactEmail, bookingEmail (hire recipient — CMS-editable), phone, address, facebook, footer{text, acknowledgement, links[] {name,url} — the footer "Explore" column}, sitePassword (pre-launch gate; clear to launch) |

Media (two CMS stores): **Images** → `src/assets/uploads/`, referenced
relatively (`../../assets/uploads/x.jpg`), Astro emits responsive WebP at
build; extensions must be listed explicitly per field incl. uppercase
(`jpg, jpeg, png, webp, gif` + uppercase variants). **Documents** (pdf/doc/docx)
→ `public/files/`, served verbatim at `/files/…` (e.g. the Centre Hire Policy).
Pages CMS rejects uploads over ~3 MB (HTTP 413) — resize photos first.
Rich-text fields store markdown; rendering uses `marked` with `breaks: true` so
single newlines become line breaks.

## 8. Key implementation details

- **/api/availability** (`src/pages/api/availability.ts`): validates
  `?month=YYYY-MM` within current..+3 months (Brisbane clock) → service-account
  JWT (scope `calendar.freebusy`) → Google freeBusy → merges overlaps → returns
  `{month, busy:[{start,end}]}` **only** — event titles can never leak (freeBusy
  is incapable + calendar share is "See only free/busy"). Edge-cached 15 min
  (Cache API, keyed per URL/hostname), browser 5 min. In dev without secrets it
  serves sample data.
- **Calendar UI** (`AvailabilityCalendar.astro`): month grid, states Available ✓
  / Partly ◐ / Booked ✕ from coverage of 08:00–22:00 (+10:00 fixed — QLD has no
  DST); click a day for busy time ranges; prev/next within horizon.
- **/api/hire** (`src/pages/api/hire.ts`): honeypot (`website` field → fake
  success) → field validation (incl. three required checkboxes: public liability
  insurance, hire-policy read, alcohol & drug free; endTime > startTime) →
  Turnstile siteverify →
  Resend send #1 to `bookingEmail` (text + HTML with a prefilled Google
  Calendar template link titled "Centre hire: NAME"; user-input HTML-escaped)
  → best-effort send #2 acknowledging the applicant. Astro's origin check
  rejects cross-site POSTs.
- **Booking workflow**: request email → secretary replies (reply-to = applicant)
  → clicks calendar link → selects "Bahai Centre" calendar → saves. Site
  updates within ~15 min. **All-day Google events default to Free — must be set
  to "Busy"** or they won't block availability.
- **Time pickers**: 15-minute `<select>` slots 08:00–22:00 (native
  `type=time step` is unreliable across browsers).
- **Pre-launch gate** (`Base.astro`): when `sitePassword` set — `noindex` meta +
  inline prompt() gate storing pass in localStorage; wrong answer swaps body for
  "Coming soon". Deterrent only, by design. Editors clear the CMS field to launch.
- **Form fields must be `min-w-0`** inside grid columns or native controls
  overflow on mobile.

## 9. Replication steps (condensed; fuller version in SETUP.md)

1. Scaffold Astro + Tailwind + `@astrojs/cloudflare`; copy this repo's `src/`,
   `.pages.yml`, `wrangler.jsonc`, `astro.config.mjs`.
2. Push to a GitHub repo owned by an org-controlled account.
3. Cloudflare → Workers → import repo (build `npm run build`, deploy
   `npx wrangler deploy`). Site live on workers.dev.
4. Add DNS zone to Cloudflare (free), switch registrar nameservers, then attach
   apex + www as Worker custom domains (delete conflicting A/CNAME first).
5. Pages CMS: install GitHub app on the repo, invite editors by email.
6. Google: free account → Cloud project → enable Calendar API → service account
   + JSON key → share venue calendar "See only free/busy" → set the three
   `GOOGLE_*`/`VENUE_CALENDAR_ID` secrets.
7. Resend: add + verify domain (auto-adds DNS via Cloudflare integration), API
   key → `RESEND_API_KEY`/`RESEND_FROM` secrets.
8. Turnstile: create widget (Managed) for prod hostnames + localhost →
   `TURNSTILE_SECRET` secret; site key into `HireForm.astro`.
9. Daily rebuild: GitHub Actions workflow
   `.github/workflows/nightly-rebuild.yml` (already in the repo) pushes an
   empty commit at 17:00 UTC (3am AEST) daily — adjust the cron for your
   timezone. Health check: `/build-info.json` shows the last build time.
10. Test: form end-to-end incl. Turnstile, calendar with a timed AND an all-day
    (Busy) booking, mobile layout, the gate, CMS edit→live loop.

## 10. Known-pending work

- ~~Nightly rebuild cron~~ **DONE** (2026-08-09): see §9 step 9.
- ~~NSA CNAME / canonical hostname~~ **DONE** (2026-08): townsville.bahai.org.au
  live and set as `site`; contact/booking email is
  contact.townsville@qld.bahai.org.au (NSA M365 shared mailbox).
- 301 redirect bahaitownsville.org.au → townsville.bahai.org.au: Cloudflare
  redirect rule, expression
  `(http.host in {"bahaitownsville.org.au" "www.bahaitownsville.org.au"})`,
  dynamic target `concat("https://townsville.bahai.org.au", http.request.uri.path)`,
  301, preserve query string — not yet deployed.
- Editor invites; editor-guide PDF (with screenshots) → committee OneDrive.
- Launch: clear `sitePassword` in CMS; consider disabling workers.dev route.
- Gmail account: passkey exists; add a second passkey/recovery owned by the
  Assembly (officer-turnover safety).
- Optional tidy: prune remaining old-zone DNS leftovers; Search Console
  registration post-launch.

## 11. Operational quirks (hard-won)

- Pages CMS caches parsed config; after editing `.pages.yml` outside the app,
  force re-read via Admin → Configuration → tiny edit → Save. **Warning:** CMS
  saves made *before* that nudge silently strip fields the stale config doesn't
  know about — nudge first, edit after.
- Pages CMS image fields are extension-case-sensitive: list uppercase variants
  (`JPG`, `PNG`, …) explicitly or editors' iPhone photos are rejected.
- Astro dev server: `rm -rf node_modules/.vite` after long sessions;
  `rm -rf .astro` after content-schema changes; never run `npm run build` while
  dev server is running (shared cache corruption). Production builds unaffected.
- Cloudflare email verification can silently suppress addresses that ever
  hard-bounced (support ticket to clear).
- Old cPanel hosts reject curl's default user agent (406) — use a browser UA
  when testing legacy sites.

## 12. Design system

Teal/gold on warm neutrals, WCAG AA: teal-950 #0a2a2b … teal-700 #0e6e6b
(buttons/links) … teal-100 #d8f0ee; gold-500 #c9a227 (accents only; gold-700
#8a6d1d at text sizes); sand-50 #faf7f0 background; ink #1e2528 text. Tokens in
`src/styles/global.css` (`@theme`). Fraunces for display, Public Sans for body.
Nine-pointed star mark, African/mudcloth-influenced — outline star, chevrons,
dotted ring (`Logo.astro`, favicon; `dark` prop for dark backgrounds). Sections open with a small gold
rule; cards are white with soft teal-tinted shadows.
