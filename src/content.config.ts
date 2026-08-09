import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// These schemas are the build-time safety net for content edited via Pages CMS
// (.pages.yml must stay in sync with them — a malformed entry fails the build
// loudly instead of silently breaking the site).

// Naive datetimes from the CMS are Brisbane wall-clock time (no DST in QLD);
// never let the build machine's timezone interpret them.
const brisbaneDate = z.union([z.string(), z.date()]).transform((v) => {
  if (v instanceof Date) return v;
  const s = v.trim();
  return new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+10:00`);
});

const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      start: brisbaneDate,
      end: brisbaneDate.optional(),
      location: z.string(),
      image: image().optional(),
      imageAlt: z.string().optional(),
    }),
});

const announcements = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/announcements' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      expires: z.coerce.date().optional(),
      image: image().optional(),
      imageAlt: z.string().optional(),
    }),
});

const pageFields = ({ image }: { image: () => z.ZodTypeAny }) => ({
  title: z.string(),
  intro: z.string(),
  heroImage: image().optional(),
  heroImageAlt: z.string().optional(),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        text: z.string(),
        image: image().optional(),
        imageAlt: z.string().optional(),
        imageCaption: z.string().optional(),
        imageSide: z.enum(['left', 'right']).default('right'),
      }),
    )
    .default([]),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: ({ image }) => z.object(pageFields({ image })),
});

// Future non-menu pages created by editors; each renders at /<file-name>/
const extraPages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/extra-pages' }),
  schema: ({ image }) => z.object(pageFields({ image })),
});

// The Community Centre page carries its own hire settings alongside the content
const centre = defineCollection({
  loader: glob({ pattern: 'centre.md', base: './src/content/centre' }),
  schema: ({ image }) =>
    z.object({
      ...pageFields({ image }),
      hireHeading: z.string().default('Hire the Centre'),
      hireCalendarNote: z.string().default(''),
      hireIntro: z.string(),
      hireRates: z.array(z.string()).default([]),
    }),
});

const gallery = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/gallery' }),
  schema: ({ image }) =>
    z.object({
      image: image(),
      caption: z.string(),
      order: z.number().default(99),
    }),
});

const homepage = defineCollection({
  loader: glob({ pattern: 'home.yml', base: './src/content/homepage' }),
  schema: z.object({
    heroTitle: z.string(),
    heroIntro: z.string(),
    heroButtonEvents: z.string().default('Upcoming events'),
    heroButtonBelieve: z.string().default('What we believe'),
    eventsHeading: z.string().default('Upcoming events'),
    eventsEmptyText: z.string().default('Nothing scheduled right now — check back soon.'),
    announcementsHeading: z.string().default('News & announcements'),
    announcementsEmptyText: z.string().default('No announcements at the moment.'),
    venueHeading: z.string().default('Looking for a venue?'),
    venueText: z.string().default(''),
    venueButton: z.string().default('Community Centre'),
  }),
});

const settings = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/settings' }),
  schema: z.object({
    siteName: z.string(),
    tagline: z.string(),
    contactEmail: z.string().email(),
    bookingEmail: z.string().email(),
    phone: z.string().optional(),
    address: z.string(),
    facebook: z.string().url().or(z.literal('')).optional(),
    // Link target for the Centre Hire Policy (shown on the hire form)
    hirePolicyUrl: z.string().default(''),
    footer: z.object({
      text: z.string(),
      acknowledgement: z.string(),
    }),
    // Non-empty = pre-launch gate active (casual deterrent, not security)
    sitePassword: z.string().default(''),
  }),
});

export const collections = {
  events,
  announcements,
  pages,
  extraPages,
  centre,
  gallery,
  settings,
  homepage,
};
