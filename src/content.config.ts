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

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: ({ image }) =>
    z.object({
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
          }),
        )
        .default([]),
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
    footerText: z.string(),
    hireIntro: z.string(),
    hireRates: z.array(z.string()).default([]),
  }),
});

export const collections = { events, announcements, pages, gallery, settings };
