# Community calendar — setup

The community calendar is built in this repository but deployed **separately**
from the live website, so work in progress never reaches the public site. This
is the one-time setup. Target: $0/month, as with the rest of the project.

## Why one repository, not two

The calendar lives on a `calendar` **branch of this repository**, not in a repo
of its own. Separation of the *deployment* is what keeps the live site safe, and
that is achieved by the branch and a second Worker — a second repository would
add nothing to it while costing:

- **The eventual merge.** The calendar is expected to become part of the
  website. Two repositories means two histories, and a merge later that has to
  reconcile them by hand.
- **Everything it already shares.** The calendar uses the site's layout, header,
  footer, palette, fonts, page hero and site settings. A second repository means
  duplicating all of it, then keeping two copies in step.
- **One CMS.** Pages CMS is configured per repository by `.pages.yml`. One
  repository means one configuration, and calendar settings appear alongside the
  website's — which is what we want when the two merge.

So: same repository, separate branch, separate Worker, separate password.

```
main      →  lsa-website   →  townsville.bahai.org.au   (public, live)
calendar  →  lsa-calendar  →  lsa-calendar.workers.dev  (private, password)
```

Merging later is then an ordinary `git merge`, and the second Worker and CMS
project are simply deleted.

---

## 1. Create the branch

From the project folder:

```bash
git checkout -b calendar && git add -A && git commit -m "Add community calendar" && git push -u origin calendar
```

`main` is untouched, so the live website keeps building and deploying exactly as
before.

## 2. Create the calendar Worker

In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**,
and choose this same repository again.

- **Branch to build:** `calendar` *(not `main` — this is the important one)*
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy --env calendar`

The `--env calendar` is what makes this a second, separate Worker called
`lsa-calendar`. Both branches share one `wrangler.jsonc`; the deploy command is
the only difference, so the two branches never conflict over it.

The Worker is reachable at `https://lsa-calendar.<your-subdomain>.workers.dev`.
No custom domain is needed while it is private.

### Turn off non-production builds on the website Worker — do this FIRST

Open `lsa-website` → **Settings → Builds → Branch control**, and make sure
**"Builds for non-production branches" is unchecked**, with the production
branch set to `main`.

This is not a tidiness measure. A Workers Builds project deploys to the Worker
it belongs to, whatever branch it built and whatever name is in
`wrangler.jsonc`. With that box ticked, every push to `calendar` is published as
the live website — which happened twice during setup, putting a password in
front of the public site and marking every page `noindex` until `main` was
rebuilt.

Renaming the Worker on the calendar branch does **not** prevent this. It only
protects against an accidental `npx wrangler deploy` run by hand.

## 3. Add the secret

On the **`lsa-calendar`** Worker → Settings → Variables and Secrets → add a
**Secret**:

| Name | Value |
|---|---|
| `CALENDAR_ADMIN_CODE` | a long phrase of your choosing |

This opens the calendar's administrator settings. It is deliberately not in the
repository — **this repository is public**, so anything committed to it can be
read by anyone.

Set it on `lsa-website` too if and when the calendar merges into the live site.

The calendar's other features (holy day calculations, verified dates, Google
calendar reading) need no secrets. If you later want the hire form and venue
availability working on the calendar deployment as well, copy the secrets listed
in `SETUP.md` §2 onto this Worker; without them those two pages simply show an
error, and nothing else is affected.

## 4. Set the password

The whole calendar deployment sits behind one password, the same mechanism the
website used before launch.

In Pages CMS → **Site settings** → **Pre-launch access code**. On the `calendar`
branch this is set to `1844`; change it to something of your own.

While it is set, every page of the calendar deployment asks for the code and is
marked `noindex` so search engines ignore it. Clearing it would make the whole
deployment public — don't, until the Assembly has approved it.

> This is a deterrent, not access control: it keeps the site out of general
> circulation, and should not be relied on to protect anything sensitive.

## 5. Point Pages CMS at the branch

In [Pages CMS](https://app.pagescms.org), add the repository a second time and
choose the **`calendar` branch**. You now have two projects on the same login:

| Project | Branch | Edits |
|---|---|---|
| LSA-website | `main` | the live website |
| LSA-website (calendar) | `calendar` | the calendar, including its settings |

Calendar settings appear in the calendar project's sidebar as **Calendar
verified dates**, and the password under **Site settings**.

Be careful which project you are in — they look alike. Editing website content
in the calendar project changes only the calendar deployment.

## 6. Check it worked

1. Open `https://lsa-calendar.<your-subdomain>.workers.dev/calendar` — it should
   ask for the password.
2. Enter it; the calendar should appear, showing this month with Bahá'í dates
   under each Gregorian date.
3. Open the menu icon at the top right. **Anyone** can switch calendars on and
   off here; the choice is remembered in that person's browser.
4. Expand **Administrator settings** and enter `CALENDAR_ADMIN_CODE`. Names,
   view labels, Google calendars and **Dates to confirm** should unlock.

If the password prompt does not appear, the CMS change has not built yet — each
save is a commit and a rebuild, so allow a minute or two.

---

## Working on it afterwards

```bash
git checkout calendar     # work here
npm run dev               # http://localhost:4321/calendar
npm test                  # the calendar's date calculations
```

Every push to `calendar` redeploys the calendar Worker and nothing else.

For local development copy `.dev.vars.example` to `.dev.vars` and set
`CALENDAR_ADMIN_CODE` in it. `.dev.vars` is gitignored and must stay that way.

## Merging into the website, later

When the Assembly approves it:

1. Set `CALENDAR_ADMIN_CODE` on the `lsa-website` Worker.
2. `git checkout main && git merge calendar`
3. In Site settings, clear **Pre-launch access code** and — if the calendar
   should stay private a while longer while the rest of the site is public — set
   **Calendar access code** instead, which gates only `/calendar`.
4. Add the calendar to the site's navigation.
5. Delete the `lsa-calendar` Worker and the second Pages CMS project.

Before that point, note the limitation recorded in the calendar's code: view
labels are currently applied in the browser, so a Google calendar's real event
titles do reach the reader's device. That is acceptable while the whole
deployment is behind a password and only administrators can attach a calendar.
It must be moved to the server before the calendar is public.
