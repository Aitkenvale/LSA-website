# Deployment & service setup

One-time setup checklist for the developer/administrator. Target: $0/month.

## 1. GitHub

- Create a repo under an account/org controlled by the committee (use a
  committee email, not a personal one) and push this project. Public or private
  both work — everything secret lives in Cloudflare, never in the repo. This
  repo is public so other communities can reuse it.
- The repo is the source of truth and the backup; Pages CMS commits into it.
- Starting from this repo? Click **"Use this template"** on GitHub for a clean
  copy, then replace the Townsville content: everything under `src/content/`,
  the photos in `src/assets/uploads/`, the files in `public/files/`, the logo
  (`src/components/Logo.astro`), and `site` in `astro.config.mjs`.

## 2. Cloudflare (hosting)

- Create a Cloudflare account (committee email). Add the community's domain
  (free plan) if you want Cloudflare to manage DNS — recommended.
- **Workers & Pages → Create → connect the GitHub repo.**
  - Build command: `npm run build`
  - Deploy command: `npx wrangler deploy`
- Add the custom domain to the Worker (Settings → Domains & Routes).
- Secrets (Settings → Variables and Secrets, type "Secret"):
  - `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY`, `VENUE_CALENDAR_ID` (step 4)
  - `RESEND_API_KEY`, `RESEND_FROM` (step 5)
  - `TURNSTILE_SECRET` (step 6)
- Plain-text build variable: `PUBLIC_TURNSTILE_SITE_KEY` (step 6).

## 3. Pages CMS (editing)

- Go to https://app.pagescms.org, sign in with the GitHub account, and open the
  repo — the `.pages.yml` in the repo root configures everything.
- Invite each editor by **email** (Settings → Collaborators). Editors sign in
  with a one-time email code; they never need GitHub accounts.

## 4. Google Calendar availability (one-time; a free Gmail account is fine)

1. In [Google Cloud Console](https://console.cloud.google.com): create a project
   (e.g. "townsville-website") → enable the **Google Calendar API**.
2. Create a **service account** (no roles needed) → create a **JSON key** and
   download it.
   - If key creation is blocked (Google Workspace accounts only), a Workspace
     super-admin must lift the `iam.disableServiceAccountKeyCreation` org
     policy for this project.
3. In Google Calendar, as the owner of the **venue calendar**: Settings →
   Share with specific people → add the service account's email with
   **"See only free/busy (hide details)"**.
4. From the JSON key set the Cloudflare secrets:
   - `GOOGLE_SA_EMAIL` = `client_email`
   - `GOOGLE_SA_KEY` = `private_key` (paste as-is, including BEGIN/END lines)
   - `VENUE_CALENDAR_ID` = the venue calendar's ID (calendar Settings →
     "Integrate calendar")
5. Keys don't expire; nothing recurring. Verify: `/api/availability?month=<this month>`
   returns busy blocks with **no event titles**.

## 5. Resend (hire-form email)

1. Create an account at https://resend.com (committee email), free tier.
2. Verify the community's domain (add the DNS records Resend shows — easy if
   DNS is on Cloudflare).
3. Create an API key → Cloudflare secret `RESEND_API_KEY`.
4. Set `RESEND_FROM` to e.g. `Website <website@yourdomain.org.au>`.
5. The recipient (booking officer) is set by editors in Site settings.

## 6. Turnstile (spam protection)

- Cloudflare dashboard → Turnstile → Add site (invisible/managed mode) for the
  domain. Copy the **site key** into `PUBLIC_TURNSTILE_SITE_KEY` (build var) and
  the **secret key** into `TURNSTILE_SECRET` (secret).
- Until these are set, the form still works — it just skips the spam check.

## 7. Daily rebuild (required — events expire at build time)

The home page decides "what's upcoming" when the site builds, so it must be
rebuilt daily. This repo already includes the mechanism — a GitHub Actions
workflow, `.github/workflows/nightly-rebuild.yml`, which pushes an empty commit
at `0 17 * * *` (17:00 UTC = 3:00am AEST), triggering the normal
Cloudflare git-connected build. Nothing to configure beyond adjusting the cron
time for your timezone.

Health check: `/build-info.json` on the live site shows the last build time —
if it's more than a day old, the cron is broken (check the repo's Actions tab).

## 8. Local development

```bash
git clone <repo> ~/Sites/townsville-bahai && cd ~/Sites/townsville-bahai
npm install
cp .dev.vars.example .dev.vars   # fill in what you have; all optional in dev
npm run dev
```

Without credentials, the availability API serves **sample data** in dev and the
hire form returns a friendly "not set up" message.

## 9. Handover checklist

- [ ] All editors invited to Pages CMS and have each added a test event
- [ ] `docs/EDITOR-GUIDE.md` exported to PDF → committee OneDrive
- [ ] GitHub, Cloudflare, Resend, Google Cloud credentials in the committee
      password store (not a personal account)
- [ ] Booking officer receiving hire-form emails (send a test)
- [ ] Daily rebuild cron verified (yesterday's test event gone by morning)
