/**
 * The calendar registry: what calendars exist, how they are labelled, and which
 * are on by default. Generated calendars are computed here; Google calendars
 * are declared by an administrator and fetched at runtime.
 */

import { generateBahaiHolyDays, generateBahaiMonths } from './bahai-generated.ts';
import { generateChristian, generateOrthodox } from './christian.ts';
import { generateJewish } from './hebrew.ts';
import { generateIslamic } from './islamic.ts';
import { generateBuddhist, generateHindu, generateJain, generateSikh } from './indic.ts';
import { applyOverrides, type OverrideTable } from './overrides.ts';
import type { Confidence, Occurrence } from './types.ts';

export type CalendarGroup = 'bahai' | 'other-faith' | 'community';

export interface GeneratedCalendar {
  id: string;
  /** Default display name. An administrator may rename it. */
  name: string;
  group: CalendarGroup;
  defaultOn: boolean;
  confidence: Confidence;
  /** One line on what the calendar contains and how far to trust it. */
  description: string;
  generate(from: string, to: string, options: GenerateOptions): Occurrence[];
}

export interface GenerateOptions {
  /** Administrator-verified dates, applied after generation. */
  dateOverrides?: OverrideTable;
}

/**
 * The generated calendars, in the order they should appear.
 *
 * Bahá'í calendars lead; every other tradition follows as a subordinate group.
 * The `group` field records that intent so the view can honour it; how it is
 * expressed visually is the view's business, not this file's.
 */
export const GENERATED_CALENDARS: GeneratedCalendar[] = [
  {
    id: 'bahai-months',
    name: 'Bahá’í Months',
    group: 'bahai',
    defaultOn: true,
    confidence: 'exact',
    description: 'The nineteen months of the Badí‘ calendar, with Ayyám-i-Há and the Fast.',
    generate: (from, to) => generateBahaiMonths(from, to),
  },
  {
    id: 'bahai-holy-days',
    name: 'Bahá’í Holy Days',
    group: 'bahai',
    defaultOn: true,
    confidence: 'exact',
    description: 'The eleven Holy Days, nine of which suspend work.',
    generate: (from, to) => generateBahaiHolyDays(from, to),
  },
  {
    id: 'buddhism',
    name: 'Buddhist Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'approximate',
    description: 'Dates vary between Theravāda, Mahāyāna and Tibetan traditions and by country.',
    generate: (from, to) => generateBuddhist(from, to),
  },
  {
    id: 'christian',
    name: 'Christian Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'exact',
    description: 'Western Christian observances, dated by the Gregorian computus.',
    generate: (from, to) => generateChristian(from, to),
  },
  {
    id: 'orthodox',
    name: 'Christian Orthodox Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'exact',
    description: 'Orthodox observances, dated by the Julian computus and calendar.',
    generate: (from, to) => generateOrthodox(from, to),
  },
  {
    id: 'hinduism',
    name: 'Hindu Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'approximate',
    description: 'Lunisolar dates computed with Lahiri ayanāṁśa; regional observance varies.',
    generate: (from, to) => generateHindu(from, to),
  },
  {
    id: 'islam',
    name: 'Islamic Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'approximate',
    description: 'The Hijri calendar is determined by moon sighting; local dates may differ by a day.',
    generate: (from, to) => generateIslamic(from, to),
  },
  {
    id: 'jainism',
    name: 'Jain Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'approximate',
    description: 'Lunisolar dates; Śvetāmbara and Digambara observance differs.',
    generate: (from, to) => generateJain(from, to),
  },
  {
    id: 'judaism',
    name: 'Jewish Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'exact',
    description: 'The Hebrew calendar is fixed and arithmetic. Each festival begins the evening before.',
    generate: (from, to) => generateJewish(from, to),
  },
  {
    id: 'sikhism',
    name: 'Sikh Holy Days',
    group: 'other-faith',
    defaultOn: false,
    confidence: 'approximate',
    description: 'Nanakshahi fixed dates, with the lunar gurpurabs computed.',
    generate: (from, to) => generateSikh(from, to),
  },
];

export function generatedCalendar(id: string): GeneratedCalendar | undefined {
  return GENERATED_CALENDARS.find((c) => c.id === id);
}

/** Produce every occurrence from every generated calendar in a window. */
export function generateAll(from: string, to: string, options: GenerateOptions = {}): Occurrence[] {
  const generated = GENERATED_CALENDARS.flatMap((c) => c.generate(from, to, options)).sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
  return applyOverrides(generated, options.dateOverrides ?? {});
}

// ---------------------------------------------------------------------------
// Administrator configuration
// ---------------------------------------------------------------------------

/** A Google calendar an administrator has attached by its secret iCal address. */
export interface GoogleCalendarConfig {
  id: string;
  /** Display name — the calendar's own name is not used, so it can be mapped. */
  name: string;
  /** Secret iCal address from Google Calendar settings. Empty until set up. */
  icsUrl: string;
  enabled: boolean;
  /**
   * Place this calendar directly after the named generated calendar in the
   * list, so the community's own Feast sits beside the Bahá'í months it
   * belongs to rather than being exiled to the bottom.
   */
  after?: string;
  /**
   * Substitute text shown in place of every event's real title, for viewers
   * without the privilege to see the calendar's detail. "Centre Booked",
   * "LSA Meeting". Empty means the real title is shown to everyone.
   */
  viewLabel: string;
  colour: string;
}

/**
 * Per-calendar settings for a generated calendar: only whether it is shown.
 *
 * A computed calendar has nothing else to configure. Its name is fixed by what
 * it is, and a view label would be meaningless because there is no private
 * detail to withhold — the dates are public facts. View labels belong solely to
 * Google calendars, which carry real events.
 */
export interface GeneratedCalendarSettings {
  enabled: boolean;
}

/**
 * Calendars a community is expected to keep in Google, offered ready-named so
 * an administrator only has to paste in the address. They stay hidden from
 * readers until one is supplied.
 */
export const SEEDED_GOOGLE_CALENDARS: GoogleCalendarConfig[] = [
  {
    id: 'feast-event',
    name: 'Feast Event',
    icsUrl: '',
    enabled: false,
    viewLabel: '',
    colour: 'teal',
    after: 'bahai-months',
  },
  {
    id: 'holy-day-event',
    name: 'Holy Day Event',
    icsUrl: '',
    enabled: false,
    viewLabel: '',
    colour: 'gold',
    after: 'bahai-holy-days',
  },
];

/**
 * Colours an administrator can give a linked calendar, shown as the dot beside
 * its events. A fixed set rather than a free colour picker: these have to sit
 * against white, sand and two tint washes without disappearing or shouting, and
 * they need to stay distinguishable from each other.
 */
export const CALENDAR_COLOURS: { id: string; label: string; value: string }[] = [
  { id: 'teal', label: 'Teal', value: '#0e6e6b' },
  { id: 'gold', label: 'Gold', value: '#a98721' },
  { id: 'plum', label: 'Plum', value: '#7c4a72' },
  { id: 'clay', label: 'Clay', value: '#a8563c' },
  { id: 'moss', label: 'Moss', value: '#5c7a3f' },
  { id: 'slate', label: 'Slate', value: '#4a5c6a' },
  { id: 'berry', label: 'Berry', value: '#9c3f56' },
  { id: 'ink', label: 'Ink', value: '#1e2528' },
];

export function calendarColour(id: string | undefined): string {
  return CALENDAR_COLOURS.find((c) => c.id === id)?.value ?? CALENDAR_COLOURS[0].value;
}

export interface CalendarConfig {
  generated: Record<string, GeneratedCalendarSettings>;
  google: GoogleCalendarConfig[];
}

export function defaultConfig(): CalendarConfig {
  const generated: Record<string, GeneratedCalendarSettings> = {};
  for (const c of GENERATED_CALENDARS) generated[c.id] = { enabled: c.defaultOn };
  return { generated, google: SEEDED_GOOGLE_CALENDARS.map((c) => ({ ...c })) };
}

/** Merge a stored config over the defaults, so new calendars appear automatically. */
export function mergeConfig(stored: Partial<CalendarConfig> | null): CalendarConfig {
  const base = defaultConfig();
  if (!stored) return base;
  for (const c of GENERATED_CALENDARS) {
    const s = stored.generated?.[c.id];
    if (s) base.generated[c.id] = { ...base.generated[c.id], ...s };
  }
  if (stored.google) {
    // Keep the seeded entries present even in a config saved before they
    // existed, so they do not silently vanish for someone who has one stored.
    const storedById = new Map(stored.google.map((c) => [c.id, c]));
    base.google = [
      ...SEEDED_GOOGLE_CALENDARS.map((seed) => ({ ...seed, ...storedById.get(seed.id) })),
      ...stored.google.filter((c) => !SEEDED_GOOGLE_CALENDARS.some((s) => s.id === c.id)),
    ];
  }
  return base;
}

export type ListedCalendar =
  | { kind: 'generated'; id: string; name: string; confidence: Confidence }
  | { kind: 'google'; id: string; name: string };

/**
 * The calendars a reader can switch on, in display order: each generated
 * calendar, followed by any Google calendar anchored to it, then the rest.
 * Google calendars with no address yet are omitted — there is nothing to show.
 */
export function listedCalendars(config: CalendarConfig): ListedCalendar[] {
  const usable = config.google.filter((c) => c.icsUrl.trim());
  const out: ListedCalendar[] = [];
  for (const c of GENERATED_CALENDARS) {
    out.push({ kind: 'generated', id: c.id, name: c.name, confidence: c.confidence });
    for (const g of usable.filter((g) => g.after === c.id)) {
      out.push({ kind: 'google', id: g.id, name: g.name });
    }
  }
  const anchors = new Set(GENERATED_CALENDARS.map((c) => c.id));
  for (const g of usable.filter((g) => !g.after || !anchors.has(g.after))) {
    out.push({ kind: 'google', id: g.id, name: g.name });
  }
  return out;
}
