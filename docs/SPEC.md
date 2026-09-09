# Website specification — Bahá'í Community of Townsville

*Complete blueprint: what was built, every service involved, and how to replicate
it from scratch. Written so a developer or AI agent with no prior context can
rebuild or maintain the entire system.*

Last updated: 2026-09-09. Status: **live** at https://townsville.bahai.org.au
(canonical; https://bahaitownsville.org.au serves the same site — 301 redirect
pending). Pre-launch gate active until the CMS `sitePassword` field is cleared.

**How to read this.** Sections 1–7 describe the site as a whole: what it is, how
it is hosted, and where its content comes from. Sections 8 and 9 describe the two
substantial features — the venue booking system and the community calendar — each
of which has its own data, its own privacy rules and its own failure modes.
Sections 10–14 are the practical remainder: replication, outstanding work, quirks
that cost time to discover, and the design system.

---

## 1. What this is

A community website with a self-service venue-booking system and a community
calendar, maintained by non-technical editors, at $0/month recurring cost:

- **Home** — upcoming events + news, both auto-expiring, edited via CMS
- **What We Believe / What We Do** — content pages (hero + text/image sections)
- **Community Centre** — facility description, photo gallery, **live
  availability calendar** (fed by the Centre's Outlook calendar, shows only
  busy/free), hire rates, and an **application form** (spam-checked, emails the
  secretariat with a one-click "add to calendar" approval link, auto-acknowledges
  the applicant)
- **Community calendar** at `/calendar` — Bahá'í Holy Days and Feasts, the holy
  days of eight other faith calendars, Queensland public holidays, and the community's
  own events from linked Outlook or Google calendars. Three views, five viewer
  tiers, administrator passkeys, and photographs kept against a day. See §9
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
  ├─ /api/availability ──► published Outlook feed (busy blocks only)
  ├─ /api/hire ──────────► Turnstile verify ──► Resend email (notify + acknowledge)
  └─ /calendar + /api/calendar-* ──┬──► KV  "lsa-calendar-session"  (config, passkeys)
                                   ├──► R2  "lsa-calendar-photos"   (day photographs)
                                   └──► linked Outlook / Google ICS feeds

Outlook calendar "Bahá'í Centre" (on centre.townsville@qld.bahai.org.au)
  ◄── secretariat manages bookings; website reads ONLY free/busy
```

One Worker serves everything. The calendar was built on a separate branch and a
separate Worker (`lsa-calendar`) and merged into `main` on 7 September 2026; both
the branch and that Worker were deleted on 9 September. `docs/CALENDAR-SETUP.md`
keeps the record of that arrangement and of the merge.

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Astro 7 + Tailwind CSS 4 (`@tailwindcss/vite`) | static output + server routes (`prerender = false`) |
| Adapter | `@astrojs/cloudflare` (Workers, not Pages) | `imageService: 'compile'` — sharp optimises images at build; avoids paid Cloudflare Images |
| Runtime env | `import { env } from 'cloudflare:workers'` | `Astro.locals.runtime.env` was removed in Astro v6+ |
| Wrangler config | minimal `wrangler.jsonc` (name, compat date, `nodejs_compat`, R2 binding) | no `main`/`assets` — adapter generates them; a Pages-style `pages_build_output_dir` breaks the build |
| Content | Astro content collections + Zod (`src/content.config.ts`) | schema mirrors `.pages.yml`; bad CMS input fails the build loudly |
| Shared state | Cloudflare KV (calendar config, passkeys) | read on nearly every request, written rarely — what KV is good at; a change can take ~1 min to reach every location |
| Object storage | Cloudflare R2 (day photographs) | 10 GB free; no egress fees; bucket is private and every read is checked |
| Email | Resend REST API (no SDK) | |
| Crypto | Web Crypto only — HMAC sessions, hand-written WebAuthn | no auth library, no second notion of identity (§9.6) |
| Fonts | Fraunces (display) + Public Sans via Fontsource | self-hosted, no external font requests |
| Interactivity | vanilla inline `<script>` only | mobile menu, gallery lightbox, availability island, the whole calendar UI, form submit |

## 4. Accounts and services (all free tier)

| Service | Account | Role |
|---|---|---|
| GitHub | org **Aitkenvale**, repo **LSA-website** (CLI auth: BDS-AU) | source of truth; CMS commits here. **Public** — nothing secret may be committed |
| Cloudflare | login email lsatownsville@gmail.com | Worker hosting, DNS zone, KV, R2, Turnstile, custom hostnames |
| Pages CMS | app.pagescms.org, sign-in with GitHub; editors invited by email | editing UI; config = `.pages.yml` in repo root |
| Google (free) | **lsatownsville@gmail.com** — the operational account | Drive for public files, Cloudflare login. No longer serves any calendar the site reads |
| Resend | signed in with Google (lsatownsville) | sends form emails from `bookings@bahaitownsville.org.au`; domain verified (region ap-northeast-1) |
| Vodien | registrar for bahaitownsville.org.au (expiry 14 Sep 2029, auto-renew, transfer lock ON, DNSSEC off) | nameservers → aldo/sara.ns.cloudflare.com |
| NSA M365 | qld.bahai.org.au shared mailboxes | official email; the Centre calendar lives here; also SharePoint for Assembly records |

**Retired:** Google Workspace (assembly@/centre@bahaitownsville.org.au) —
cancelled 2026-08-08; email for the domain has no MX by design (clean bounce).
Old InMotion-hosted site — replaced. Google Cloud project **townsville-website**
(number 265255237934) and its service account — shut down 2026-09-09 when the
Centre's bookings moved to Outlook, permanent deletion 9 Oct 2026, restorable
until then. Shutting it down revoked the service-account key immediately and the
live site was unaffected, which is the proof the Google path was dead and not
merely thought to be. The old Google "Bahai Centre" calendar is kept, labelled
OLD, read by nothing. The `lsa-calendar` Worker and the `calendar` branch went
the same day.

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

## 6. Worker secrets and bindings

All on the `lsa-website` Worker. **Names only here** — values live in the
committee password store or the service dashboards. This repository is public, so
no secret may ever be committed to it or passed into a page.

### Secrets (Settings → Variables and Secrets, type "Secret")

| Name | Used by | Purpose |
|---|---|---|
| `VENUE_ICS_URL` | booking | the Centre calendar's published ICS address (Outlook → Publish a calendar → **"Can view when I'm busy"**). A bearer token: whoever holds it can read the busy times. Rotate by unpublishing and republishing |
| `RESEND_API_KEY` | booking | Resend API key |
| `RESEND_FROM` | booking | `Bahai Community of Townsville <bookings@bahaitownsville.org.au>` — **ASCII only**; accented characters make Resend reject the send |
| `TURNSTILE_SECRET` | booking | Turnstile server key (widget: hostnames bahaitownsville.org.au, townsville.bahai.org.au, localhost; Managed mode) |
| `SESSION_SECRET` | calendar | signs the tier cookie (HMAC-SHA256). Changing it silently signs everyone out — they are not told, they simply find they are |
| `ADMIN_CODE` | calendar | the administrator code, checked server-side. Deliberately **not** a CMS field |
| `ADMIN_RECOVERY_CODE` | calendar | optional; the way back in when passkeys are enrolled but unusable (new device, lost phone, changed domain) |
| `CODE_COMMUNITY` | calendar | shared code granting the community tier |
| `CODE_HOODS` | calendar | shared code granting the neighbourhood tier |
| `CODE_ASSEMBLY` | calendar | shared code granting the Assembly tier |

Turnstile **site** key is public and hardcoded as a fallback in
`HireForm.astro` (overridable via `PUBLIC_TURNSTILE_SITE_KEY` build var).

### Bindings (Settings → Bindings)

| Type | Variable | Points at |
|---|---|---|
| KV namespace | `SESSION` | namespace **`lsa-calendar-session`** (id `eb12c850…`) — calendar config, passkeys, passkey policy |
| R2 bucket | `PHOTOS` | bucket **`lsa-calendar-photos`** — day photographs |

**Hazard worth knowing.** A second, empty namespace `lsa-website-session` also
exists in the account. Binding that one instead would present an administrator
with no calendars, no cycle dates and no way to sign in with a passkey, while the
real configuration sat untouched in the namespace nobody was reading — a
confusing failure that looks like data loss and is not. The R2 binding is also
declared in `wrangler.jsonc` so that `astro dev` gets a local bucket rather than
an undefined binding; the KV namespace is deliberately **not** declared there,
because naming it in a file would invite a local run to write to the live one.

## 7. Content model ↔ CMS

`.pages.yml` (CMS) must stay in sync with `src/content.config.ts` (Zod). CMS
sidebar order: Home · What We Believe · What We Do · Community Centre ·
Community Centre gallery · Pages · Events · News · Calendar overrides ·
Site settings.

| CMS item | File(s) | Notes |
|---|---|---|
| Home | `src/content/homepage/home.yml` | hero title/intro/buttons, section headings, empty-state texts, venue call-out |
| What We Believe / What We Do | `src/content/pages/*.md` | title, intro (rich-text), hero image+alt, sections[]: heading, text (rich-text/markdown), optional image+alt, imageCaption, imageStyle (`photo` = framed 3:2 crop / `emblem` = small uncropped icon-style), imageSide (`left`/`right` on desktop) |
| Community Centre | `src/content/centre/centre.md` | page fields **plus** hire settings: hireHeading, hireCalendarNote, hireIntro, hirePolicyUrl (link shown on the form), hireRates[] |
| Community Centre gallery | `src/content/gallery/gallery.yml` | single file: photos[] of {image, caption}; array order = display order — rows are **drag-sortable** in the CMS; caption renders under each photo and in the lightbox |
| Pages (future) | `src/content/extra-pages/*.md` | auto-routed by `src/pages/[slug].astro` at `/<file-name>/`; not in nav |
| Events | `src/content/events/*.md` | title, start/end (naive datetimes = **Brisbane wall clock**; schema appends +10:00 — never let the build machine's TZ parse them), location, image+alt, body. Home shows `end ?? start >= build-time now`; **requires the daily rebuild cron** |
| News | `src/content/announcements/*.md` | newest 5 shown; optional `expires` |
| Calendar overrides | `src/content/calendar/overrides.yml` | verified dates for observationally-determined holy days — see §9.3 |
| Site settings | `src/content/settings/site.yml` | siteName, tagline (SEO description), contactEmail, bookingEmail (hire recipient — CMS-editable), phone, address, facebook, footer{text, acknowledgement, links[]}, sitePassword (pre-launch gate; clear to launch), calendarAccessCode and showCalendarLink (§9.10) |

Media (two CMS stores): **Images** → `src/assets/uploads/`, referenced
relatively (`../../assets/uploads/x.jpg`), Astro emits responsive WebP at
build; extensions must be listed explicitly per field incl. uppercase
(`jpg, jpeg, png, webp, gif` + uppercase variants). **Documents** (pdf/doc/docx)
→ `public/files/`, served verbatim at `/files/…` (e.g. the Centre Hire Policy).
Pages CMS rejects uploads over ~3 MB (HTTP 413) — resize photos first.
Rich-text fields store markdown; rendering uses `marked` with `breaks: true` so
single newlines become line breaks.

Calendar photographs are **not** in the CMS. They are uploaded through the
calendar itself and stored in R2 (§9.8).

## 8. The venue booking system

### How a booking actually happens

Applicant fills the form on `/community-centre/` → `/api/hire` checks it and
emails the secretariat → the secretariat considers it, and if it is approved
clicks the "add to calendar" link in that email, which opens Outlook with the
booking prefilled → they choose the Bahá'í Centre calendar and save → the
published feed changes → the availability grid shows the date as taken.

### /api/availability

`src/pages/api/availability.ts`. Validates `?month=YYYY-MM` within current..+3
months (Brisbane clock) → fetches the published Outlook feed → `parseIcs` →
returns `{month, busy:[{start,end}]}` **only**.

Event titles can never leak, because the "Can view when I'm busy" publication
strips subject, location and notes at Microsoft's end, before the feed is
generated. The protection is at the source, not in our filtering.

Edge-cached 2 minutes (Cache API, keyed per URL/hostname), browser 1 minute. The
feed is built per request — measured in seconds, not the hours once assumed — so
the cache is the only staleness the page has. In dev without the secret it serves
sample data. Unlike Google's freeBusy, the ICS does **not** merge overlapping
bookings: two overlapping entries arrive as two blocks, which the grid handles by
coverage rather than by count.

An error must never read as "the hall is free", so a failed fetch returns 502 and
the page says it could not find out.

**Every event in the feed is treated as busy.** `TRANSP` / free-vs-busy
transparency is not read, on the assumption that a "Can view when I'm busy" feed
only publishes what Microsoft already considers busy. The Google equivalent had a
known trap here — all-day events default to *Free* and silently failed to block a
date — so if an all-day Outlook booking ever fails to show, this is the first
thing to check.

### Availability grid

`AvailabilityCalendar.astro`: month grid, states Available ✓ / Partly ◐ /
Booked ✕ from coverage of 08:00–22:00 (+10:00 fixed — QLD has no DST); click a
day for busy time ranges; prev/next within the horizon.

### /api/hire

`src/pages/api/hire.ts`. Honeypot (`website` field → fake success) → field
validation (including three required checkboxes: public liability insurance,
hire-policy read, alcohol & drug free; endTime > startTime) → Turnstile
siteverify → Resend send #1 to `bookingEmail` (text + HTML, with the Outlook
compose deeplink; user input HTML-escaped) → best-effort send #2 acknowledging
the applicant. Astro's origin check rejects cross-site POSTs.

The notes in that deeplink are joined with `<br>`, not newlines: Outlook's
compose field reads its body as HTML, and both a bare newline and a CRLF pair
arrive as one run-on line. An `.ics` attachment was tried as a more robust
alternative and abandoned — Outlook's web client refused to import its own file,
valid or not, and the same file imported by hand worked, which placed the fault
in the attachment button rather than the file.

**Time pickers**: 15-minute `<select>` slots 08:00–22:00 (native `type=time step`
is unreliable across browsers).

## 9. The community calendar

At `/calendar`. Roughly 10,000 lines across `src/lib/calendar/`,
`src/components/calendar/CalendarView.astro` and seven API routes. This section
is the map.

### 9.1 The idea

One calendar page that answers three different questions — *what day is it in the
Badí' calendar?*, *what is on this month?*, and *where are we in the cycle?* —
without becoming three separate tools. Readers turn calendars on and off for
themselves; what each reader is *allowed* to see is decided on the server, so
choosing to display less is a preference and being shown less is a rule.

### 9.2 The three views

| View | Grid | Week starts |
|---|---|---|
| **Gregorian** | ordinary month | reader's choice |
| **Badí'** | one Bahá'í month of 19 days | reader's choice |
| **Cycle** | a whole planning cycle — 12 weeks, or 16 over the summer | **Assembly's** setting, shown greyed to the reader |

Each view remembers its own set of enabled calendars and its own week-start, in
the reader's browser. The Cycle view's week-start is deliberately not the
reader's: a cycle is a shared plan, and two people discussing "week 7" need the
same seven days in mind.

The Cycle view shows Gregorian dates, listed at the top of each cell, and carries
two slim left-hand columns — the phase name (drawn once per run of weeks, rotated)
and the week number — in configurable pastel colours.

### 9.3 Calculated calendars

Eleven calendars are computed rather than fetched, from
`src/lib/calendar/registry.ts`:

`bahai-months` · `bahai-holy-days` · `buddhism` · `christian` · `orthodox` ·
`hinduism` · `islam` · `jainism` · `judaism` · `sikhism` · `queensland`

Only the two Bahá'í ones are on by default. All of it is pure arithmetic — no
ephemeris files, no network — so it runs unchanged in a Worker.

**Astronomy** (`astronomy.ts`) is Jean Meeus, *Astronomical Algorithms* (2nd ed.):
ch. 7 Julian Day, ch. 25 solar coordinates, ch. 27 equinoxes/solstices, ch. 47
lunar position, ch. 49 lunar phases.

**The Badí' calendar** (`badi.ts`) follows the Universal House of Justice's letter
of 10 July 2014, under which the calendar is astronomically determined from
172 B.E. (2015):

- Naw-Rúz is the Bahá'í day (sunset to sunset) in which the March equinox falls,
  reckoned at Tehran.
- The Twin Holy Birthdays fall on the first and second days after the eighth new
  moon following Naw-Rúz, again at Tehran.

Everything else — nineteen months of nineteen days, the length of Ayyám-i-Há, the
Fast, the Feasts and the fixed-date Holy Days — follows arithmetically from those
two anchors.

**The computation alone is not enough, and `badi-official.ts` is why.** In most
years the equinox misses Tehran sunset by hours. In 183 B.E. (2026) it falls
within *sixteen seconds* of it — far inside the uncertainty of any sunset model,
since atmospheric refraction alone varies by more than that and Tehran sits
1200 m above sea level. Computed naively, 183 B.E. comes out a day early, which
would shift every Feast and Holy Day in the year. The Universal House of Justice
has published the determinations in advance for 172–221 B.E., and that table
wins over the computation. `nawRuzConfidence()` reports which happened:
`official` (from the table), `computed` (a comfortable margin), or `marginal`
(within 30 minutes of sunset — computed, but an official date is really
required). To extend the table, add rows from the official list or from the
annual "Significant Bahá'í Dates" sheet.

**Confidence** (`types.ts`) is carried on every occurrence and shown to the
reader:

- `exact` — a deterministic rule; any published calendar will agree.
- `approximate` — the tradition determines the date observationally (moon
  sighting) or it varies by region or school. We compute the common astronomical
  answer; local observance may differ, usually by a day.
- `verified` — was approximate, and an administrator has confirmed it against an
  announcement or published source.

**Overrides** (`overrides.ts`, edited in the CMS at
`src/content/calendar/overrides.yml`) are how an approximate date becomes a
verified one. Each is keyed `"<calendarId>:<occurrence key>"` and records the
source it came from, so the record stays auditable. An override with no date
simply promotes the computed date to `verified` without changing it. The table is
read on the server and never supplied by the browser, so a reader cannot
fabricate one.

### 9.4 Linked calendars

An administrator can attach any number of Outlook or Google calendars by ICS
address. Two are offered ready-named and empty — **Feast Event** and
**Holy Day Event** — so attaching one is a paste rather than a setup, and either
can be deleted if the community keeps no such calendar.

`/api/calendar-feed.json` is a proxy, and the design point is that **the browser
asks for a calendar by id, never by address**. The address is held in KV and only
an administrator can read it back. Fetches are restricted to an allow-list of
hosts — `calendar.google.com`, `www.google.com`, `outlook.office365.com`,
`outlook.office.com`, `outlook.live.com` — so a stored address cannot be turned
into a request to somewhere else.

`ics.ts` is a small iCalendar reader. One VEVENT is published per series, so
recurrences are expanded here: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT,
UNTIL, BYDAY for weekly rules, EXDATE, and RECURRENCE-ID overrides (where one
occurrence has been edited, the feed publishes both the series and a replacement
for that date). Anything more exotic is emitted as a single occurrence rather
than dropped.

**Multi-day events must be matched by overlap, not by start date.** Filtering on
the start date loses an event that begins before the window and runs into it —
which is how an event starting on the last day of cycle 18 and running three days
went missing from cycle 19. The reader reaches back by the longest span in the
feed and then keeps anything that overlaps.

### 9.5 Who sees what — tiers

`tiers.ts`. Five tiers, a ladder where each includes everything below it:

| Tier | Label | Session | How you get it |
|---|---|---|---|
| `public` | Public | — | the default |
| `community` | Community member | 180 days | shared code (`CODE_COMMUNITY`) |
| `hoods` | Neighbourhood | 90 days | shared code (`CODE_HOODS`) |
| `assembly` | Assembly and Secretariat | 30 days | shared code (`CODE_ASSEMBLY`) |
| `admin` | Administrator | 1 day | passkey, or `ADMIN_CODE` (§9.6) |

Session lengths shorten as the tier sees more: a forgotten community session is
harmless, a forgotten admin session is the worst case.

The middle tiers share one code each rather than having accounts. That is
deliberate — the community tier could run to hundreds of people, which no
per-person system does for free, and what it protects (which home a Feast is at,
by family name rather than address) is a publication boundary rather than a
secret.

The tier travels in an HMAC-signed, HttpOnly, Secure, SameSite=Lax cookie
(`cal_tier`). Signed rather than encrypted: the tier is not itself a secret, and
what matters is only that a reader cannot mint one they did not earn. Codes are
compared with a timing-safe comparison.

**Every calendar carries two tiers**, not one:

- `visibility` — the lowest tier that may see the calendar exists at all.
- `detailFrom` — the lowest tier that may see real event titles.

Below `detailFrom` the **server** substitutes the calendar's view label and
strips title, location and description before responding. This is the important
word: until 6 September 2026 the substitution happened in the browser, which hid
the titles from the reader and from nobody else. Feed addresses never leave the
Worker below the admin tier.

### 9.6 Administrator access — passkeys

`webauthn.ts`, `passkey-store.ts`, `/api/passkey.json`.

WebAuthn is implemented directly — CBOR enough to read an attestation object,
COSE enough to read a public key, and the signature check — rather than by
adopting better-auth and its passkey plugin on D1. That stack brings its own user
table, its own session cookie and its own idea of who is signed in, and the
calendar already has one. Two session systems in one Worker is a standing
invitation for them to disagree about who you are, and the tier is what decides
who may read a calendar's address. So a passkey does exactly one thing here — it
proves you may hold the admin tier — and the existing session takes over
unchanged.

Credentials live in KV under their own keys, apart from the configuration
document. That document is rewritten in full whenever an administrator drags a
calendar or picks a colour, and a stray write must never be able to delete the
thing that lets people sign in. A stored credential holds a public key and
nothing else of value.

Challenges are remembered for 300 seconds and spent on use, so one cannot be
replayed. The verification checks are tested by mutation: removing any one of
them makes the test suite fail.

`ADMIN_RECOVERY_CODE` is the way back in when passkeys exist but none can be
used. This is not hypothetical — **a passkey is bound to a domain**, so moving
the calendar from the old Worker's address to `townsville.bahai.org.au`
invalidated every enrolled passkey at once, and the recovery code was the only
door left.

### 9.7 Cycles, phases and Plans

`school-terms.ts`, `plans.ts`.

A cycle is a planning period rather than a calendrical one: roughly three months
of activity ending in a reflection meeting. Communities pin cycles to the school
year because that is what everybody else's life is already pinned to — a cycle
beginning mid-term asks families to start something new in the week the children
go back. So **a cycle begins when a school term ends**. Three terms are followed
by a fortnight's holiday and one by six weeks, which is where 12, 12, 12 and 16
weeks comes from.

Queensland term dates for 2019–2028 are bundled, transcribed from the
department's published sheets. Other states can be chosen; only those publishing
machine-readable data can be loaded automatically, and every boundary can be
corrected by hand. Only the current cycle and the next eight are shown — a cycle
that has passed needs no adjusting.

Each cycle has three phases: **Expansion**, **Consolidation**, and
**Planning & Reflection**. Expansion and Planning & Reflection are given a number
of weeks each (two by default) and Consolidation takes the remainder, so the
arithmetic works for a 12-week and a 16-week cycle without a second setting.

**Plans** are the global framework — the Nine Year Plan and its predecessors.
Each begins at Riḍván, and its cycles are numbered from one, which is why a cycle
is spoken of as "183–18": the eighteenth cycle, in the year 183 B.E. Plans are
sequential and never overlap, so a list of names with Riḍván start dates says
everything; a Plan runs until the next begins. Finished Plans are kept, because
looking back at a past cycle should name the Plan it belonged to.

Seeded: Five Year Plan (2016-04-20), One Year Plan (2021-04-20), Nine Year Plan
(2022-04-22). A local cycle is numbered by its **midpoint**, because ours follow
the school terms and the Plan's follow Riḍván; they run at the same rate but
drift by a fortnight either way, and the midpoint is the stable answer.

### 9.8 Photographs

`photo-store.ts`, `/api/calendar-photos.json`, `/api/calendar-photo`.

**Kept against a day, not against an event.** Event identifiers belong to
Microsoft: editing an occurrence can change one, recurrences carry synthesised
ones, and republishing a calendar reissues them. A date cannot be taken away —
and for a record it is the truer key anyway, since a photograph is evidence of
what happened on a day. If the event is later moved, the photograph stays where
it was taken.

| | |
|---|---|
| Storage | R2 bucket `lsa-calendar-photos`, bound as `PHOTOS` |
| Layout | image at `photos/<date>/<id>.jpg`; one index JSON per day at `photos/<date>.json` |
| Limits | 10 per day; longest edge 2000 px; JPEG quality 0.8; 4 MB upload cap |
| EXIF | destroyed on re-encode; orientation baked in first via `createImageBitmap(blob, {imageOrientation:'from-image'})` |
| Thumbnails | none — a camera icon on the cell, with a count |

Reading a day is one GET rather than a HEAD per object, and editing a caption
touches nothing else. Counting photographs across a whole cycle uses **one**
`list()` with `include: ['customMetadata']` — an earlier version read each day
separately and was capped at 62 days, which silently reported "no photographs"
for anything later in a 72-day cycle.

Five separate permissions, each a tier, **all defaulting to `admin`**:
`view`, `upload`, `edit`, `download`, `delete`.

The camera icon appears on every cell for anyone who may use it: grey when the
day has none, filled teal with a count when it has. The bucket is private and
every image request is checked — no signed or unguessable URLs, because an
address that grants access is an address that can be forwarded. Refusal and
absence both answer 404, so the endpoint cannot be used to discover which days
have photographs.

### 9.9 Where state lives

| What | Where | Why |
|---|---|---|
| Which calendars exist, their names, addresses, colours, tiers; cycle dates, phases, Plans; photo permissions | KV `lsa-calendar-session`, one document | a property of the community, not of whoever is looking; set once by an administrator, enforced on the server |
| Passkey credentials and policy | KV, separate keys | must survive a full rewrite of the configuration document |
| Challenges | KV, 300s TTL | spent on use |
| Photographs and their captions | R2 | bytes, and one index per day |
| Which calendars a reader has switched on, which sections they have collapsed, each view's week-start | the reader's browser | preferences; nobody else is affected |

### 9.10 Publishing the calendar

Two independent controls, both in Site settings:

- **`showCalendarLink`** — one switch with three consequences: the header link,
  the `noindex` instruction on the page, and whether it appears in the sitemap.
  Kept together so none can be on while another is forgotten. With it off the
  page still answers at its address; what is withheld is the invitation.
- **`calendarAccessCode`** — a `prompt()` gate on the page, the same casual
  deterrent as the site-wide `sitePassword`. **Not access control** — this
  repository is public, so treat the code as visible. Nothing private sits behind
  it in any case: a reader who has not signed in sees only Holy Days and public
  holidays.

The administrator code is deliberately *not* a CMS field. It is `ADMIN_CODE`, a
Worker secret, compared on the server.

### 9.11 API routes

| Route | Methods | Cache | Notes |
|---|---|---|---|
| `/api/calendar-config.json` | GET, PUT, DELETE | `no-store` | the shared configuration, filtered to the caller's tier |
| `/api/calendar-feed.json` | GET | `private, max-age=60` | linked-calendar proxy; `private` keeps tier-gated detail out of any shared cache |
| `/api/calendar-session.json` | GET, POST, DELETE | `no-store` | sign in with a tier code; sign out |
| `/api/calendar-admin.json` | POST | `no-store` | admin code / recovery code |
| `/api/passkey.json` | GET, POST | `no-store` | enrol and authenticate |
| `/api/calendar-photos.json` | GET, POST, PATCH, DELETE | `no-store` | day photographs; each verb gated on its own permission |
| `/api/calendar-photo` | GET | `private, max-age=3600` | one image's bytes |
| `/api/holy-days.json` | GET | `public, max-age=300, s-maxage=86400` | calculated dates only — pure arithmetic, safe to cache hard |
| `/api/school-terms.json` | GET | `no-store` | term dates for a state |

## 10. Site-wide implementation details

- **Pre-launch gate** (`Base.astro`): when `sitePassword` is set — `noindex` meta
  plus an inline `prompt()` gate storing the pass in localStorage; a wrong answer
  swaps the body for "Coming soon". Deterrent only, by design. Editors clear the
  CMS field to launch.
- **Form fields must be `min-w-0`** inside grid columns, or native controls
  overflow on mobile.
- **Mobile**: the header (logo, title, menu), page title, view buttons, date and
  the Today/sign-in/preferences row all have to fit before anything else is
  considered — the brand type steps down below 430 px and again below 360 px. The
  calendar grid then scrolls sideways, sized to show about 3.3 columns.
- **Nightly rebuild**: `.github/workflows/nightly-rebuild.yml` pushes an empty
  commit at 17:00 UTC (3am AEST) daily, so that time-based content (upcoming
  events, "today") stays correct without a visitor triggering a build. Health
  check: `/build-info.json` shows the last build time.

## 11. Replication steps (condensed; fuller version in SETUP.md)

1. Scaffold Astro + Tailwind + `@astrojs/cloudflare`; copy this repo's `src/`,
   `.pages.yml`, `wrangler.jsonc`, `astro.config.mjs`.
2. Push to a GitHub repo owned by an org-controlled account.
3. Cloudflare → Workers → import repo (build `npm run build`, deploy
   `npx wrangler deploy`). Site live on workers.dev.
4. Add DNS zone to Cloudflare (free), switch registrar nameservers, then attach
   apex + www as Worker custom domains (delete conflicting A/CNAME first).
5. Pages CMS: install GitHub app on the repo, invite editors by email.
6. Outlook: publish the Centre calendar at **"Can view when I'm busy"** → copy
   the ICS address → `VENUE_ICS_URL` secret.
7. Resend: add + verify domain (auto-adds DNS via Cloudflare integration), API
   key → `RESEND_API_KEY`/`RESEND_FROM` secrets.
8. Turnstile: create widget (Managed) for prod hostnames + localhost →
   `TURNSTILE_SECRET` secret; site key into `HireForm.astro`.
9. Calendar: create a KV namespace and an R2 bucket, bind them as `SESSION` and
   `PHOTOS`, and set the six calendar secrets from §6. Sign in with `ADMIN_CODE`,
   enrol a passkey, then set `ADMIN_RECOVERY_CODE`.
10. Daily rebuild: the workflow is already in the repo — adjust the cron for your
    timezone.
11. Test: form end-to-end incl. Turnstile; availability with a timed AND an
    all-day booking; the calendar's three views, a tier code, a passkey, and a
    photograph upload; mobile layout; the gates; CMS edit→live loop.

## 12. Known-pending work

- ~~Nightly rebuild cron~~ **DONE** (2026-08-09).
- ~~NSA CNAME / canonical hostname~~ **DONE** (2026-08): townsville.bahai.org.au
  live and set as `site`; contact/booking email is
  contact.townsville@qld.bahai.org.au (NSA M365 shared mailbox).
- ~~Calendar on its own Worker~~ **DONE** (2026-09-07/09): merged into `main`,
  second Worker and branch deleted.
- 301 redirect bahaitownsville.org.au → townsville.bahai.org.au: Cloudflare
  redirect rule, expression
  `(http.host in {"bahaitownsville.org.au" "www.bahaitownsville.org.au"})`,
  dynamic target `concat("https://townsville.bahai.org.au", http.request.uri.path)`,
  301, preserve query string — not yet deployed.
- Announce the calendar: set `showCalendarLink`, clear `calendarAccessCode`.
- Photo permissions are all `admin` while the feature is being tried. Widening
  `view` and `upload` is the point of them being settings.
- Editor invites; editor-guide PDF (with screenshots) → committee OneDrive.
- Launch: clear `sitePassword` in CMS; consider disabling the workers.dev route.
- Gmail account: passkey exists; add a second passkey/recovery owned by the
  Assembly (officer-turnover safety).
- Optional tidy: prune remaining old-zone DNS leftovers; delete the empty
  `lsa-website-session` KV namespace (§6); Search Console registration
  post-launch.

## 13. Operational quirks (hard-won)

**Pages CMS**

- It caches parsed config; after editing `.pages.yml` outside the app, force a
  re-read via Admin → Configuration → tiny edit → Save. **Warning:** CMS saves
  made *before* that nudge silently strip fields the stale config does not know
  about — nudge first, edit after.
- Image fields are extension-case-sensitive: list uppercase variants (`JPG`,
  `PNG`, …) explicitly or editors' iPhone photos are rejected.

**Astro / local dev**

- `rm -rf node_modules/.vite` after long sessions; `rm -rf .astro` after
  content-schema changes; never run `npm run build` while the dev server is
  running (shared cache corruption). Production builds are unaffected.
- An un-imported name is an undefined global, not a compile error — it fails
  silently in the browser. The Cycle view button did nothing for a while for
  exactly this reason.

**Cloudflare**

- Email verification can silently suppress addresses that ever hard-bounced
  (support ticket to clear).
- **Workers Builds deploys to whichever Worker its project is bound to,
  regardless of `wrangler.jsonc`.** Twice, the website project built the calendar
  branch and served it as the live site, putting a password in front of the
  public website. The fix was turning OFF "Builds for non-production branches"
  on the website project.
- On a cache **hit** Cloudflare rewrites the browser-facing `max-age` up to the
  zone's Browser Cache TTL (4 hours by default), leaving `s-maxage` alone. It
  acts as a floor, so `/api/availability` goes out as `max-age=14400` despite the
  code asking for 60. Set Browser Cache TTL to "Respect Existing Headers", or add
  a Cache Rule for `/api/`, if this ever matters.

**Merging long-lived branches**

- A merge can be silently wrong without conflicting. `sitePassword: '1844'` came
  across because `main` had no such line to conflict with, and the Worker name
  auto-merged to `lsa-calendar` because only the *comment* above it conflicted.
  Read the merged file, not just the conflict list.

**Other**

- Old cPanel hosts reject curl's default user agent (406) — use a browser UA when
  testing legacy sites.

## 14. Design system

Teal/gold on warm neutrals, WCAG AA: teal-950 #0a2a2b … teal-700 #0e6e6b
(buttons/links) … teal-100 #d8f0ee; gold-500 #c9a227 (accents only; gold-700
#8a6d1d at text sizes); sand-50 #faf7f0 background; ink #1e2528 text. Tokens in
`src/styles/global.css` (`@theme`). Fraunces for display, Public Sans for body.
Nine-pointed star mark, African/mudcloth-influenced — outline star, chevrons,
dotted ring (`Logo.astro`, favicon; `dark` prop for dark backgrounds). Sections
open with a small gold rule; cards are white with soft teal-tinted shadows.

Linked calendars are given one of ten strongly saturated dot colours, chosen to
stay distinguishable from each other and legible against white, sand, and the
gold and teal sunset washes the calendar uses for Holy Days and Feasts.
