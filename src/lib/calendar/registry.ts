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
import { generateQueensland } from './queensland.ts';
import { applyOverrides, type OverrideTable } from './overrides.ts';
import type { Confidence, Occurrence } from './types.ts';

export type CalendarGroup = 'bahai' | 'other-faith' | 'community' | 'secular';

/** The headings calendars are gathered under in the drawer. */
export type CalendarSection = 'bahai' | 'interfaith' | 'secular';

export const CALENDAR_SECTIONS: { id: CalendarSection; label: string }[] = [
  { id: 'bahai', label: 'Bahá’í Calendars' },
  { id: 'interfaith', label: 'Interfaith Calendars' },
  { id: 'secular', label: 'Secular Calendars' },
];

/** Where a calendar sits by default; an administrator may move it. */
export function defaultSection(group: CalendarGroup): CalendarSection {
  if (group === 'other-faith') return 'interfaith';
  if (group === 'secular') return 'secular';
  // Bahá'í calendars and the community's own linked calendars sit together.
  return 'bahai';
}

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
    id: 'queensland',
    name: 'Queensland Public Holidays',
    group: 'secular',
    defaultOn: false,
    confidence: 'exact',
    description:
      'Computed from the Holidays Act 1983, for Townsville — the Brisbane Ekka holiday does not apply here.',
    generate: (from, to) => generateQueensland(from, to),
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
    // Deliberately not teal: these events land on the teal Feast wash, where a
    // teal dot disappears.
    colour: 'blue',
    after: 'bahai-months',
  },
  {
    id: 'holy-day-event',
    name: 'Holy Day Event',
    icsUrl: '',
    enabled: false,
    viewLabel: '',
    // Likewise not gold, which is the Holy Day wash these sit on.
    colour: 'violet',
    after: 'bahai-holy-days',
  },
];

/**
 * Colours an administrator can give a linked calendar, shown as the dot beside
 * its events.
 *
 * A fixed set rather than a free picker, because these have to stay
 * distinguishable from one another and read clearly against white, sand, and
 * the gold and teal sunset washes. They are strongly saturated on purpose: at
 * the size of a dot, muted colours turn to grey mush and stop carrying any
 * information at all.
 */
export const CALENDAR_COLOURS: { id: string; label: string; value: string }[] = [
  { id: 'red', label: 'Red', value: '#e03131' },
  { id: 'orange', label: 'Orange', value: '#f76707' },
  // Darker than a pure amber on purpose: #f59f00 measured only 1.8 against the
  // gold sunset wash, where the dot all but disappeared. This holds 2.9.
  { id: 'amber', label: 'Amber', value: '#c77800' },
  { id: 'green', label: 'Green', value: '#2f9e44' },
  { id: 'teal', label: 'Teal', value: '#0ca678' },
  { id: 'cyan', label: 'Cyan', value: '#1098ad' },
  { id: 'blue', label: 'Blue', value: '#1c7ed6' },
  { id: 'indigo', label: 'Indigo', value: '#4263eb' },
  { id: 'violet', label: 'Violet', value: '#7048e8' },
  { id: 'pink', label: 'Pink', value: '#d6336c' },
];

/** Used when a calendar has no colour, or one saved before the palette changed. */
export const DEFAULT_CALENDAR_COLOUR = 'blue';

export function calendarColour(id: string | undefined): string {
  const found = CALENDAR_COLOURS.find((c) => c.id === id);
  if (found) return found.value;
  return CALENDAR_COLOURS.find((c) => c.id === DEFAULT_CALENDAR_COLOUR)!.value;
}

export interface CalendarConfig {
  generated: Record<string, GeneratedCalendarSettings>;
  google: GoogleCalendarConfig[];
  /** Calendar ids in display order. Anything absent keeps its registry order. */
  order: string[];
  /** Section overrides, where a calendar has been dragged out of its default. */
  sections: Record<string, CalendarSection>;
  /**
   * Which section headings are expanded. Remembered so that collapsing a
   * section stays collapsed the next time the drawer is opened — the list is
   * rebuilt from scratch each time, so without this it springs back open.
   */
  sectionsOpen: Record<string, boolean>;
}

export function defaultConfig(): CalendarConfig {
  const generated: Record<string, GeneratedCalendarSettings> = {};
  for (const c of GENERATED_CALENDARS) generated[c.id] = { enabled: c.defaultOn };
  return {
    generated,
    google: SEEDED_GOOGLE_CALENDARS.map((c) => ({ ...c })),
    order: [],
    sections: {},
    sectionsOpen: Object.fromEntries(CALENDAR_SECTIONS.map((s) => [s.id, true])),
  };
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
  base.order = stored.order ?? [];
  base.sections = stored.sections ?? {};
  // Merged rather than replaced, so a section added later starts open instead
  // of being absent and defaulting to closed.
  base.sectionsOpen = { ...base.sectionsOpen, ...(stored.sectionsOpen ?? {}) };
  return base;
}

export type ListedCalendar = {
  id: string;
  name: string;
  section: CalendarSection;
  kind: 'generated' | 'google';
  confidence?: Confidence;
};

/**
 * The calendars a reader can switch on, gathered under their section headings
 * and in display order.
 *
 * Order comes from `config.order` where the reader has arranged things, and
 * otherwise from the registry, with each Google calendar following whichever
 * generated calendar it is anchored to. Google calendars with no address yet
 * are omitted — there is nothing to show.
 */
export function listedCalendars(config: CalendarConfig): ListedCalendar[] {
  const usable = config.google.filter((c) => c.icsUrl.trim());
  const natural: ListedCalendar[] = [];

  const sectionFor = (id: string, group: CalendarGroup): CalendarSection =>
    config.sections[id] ?? defaultSection(group);

  for (const c of GENERATED_CALENDARS) {
    natural.push({
      id: c.id,
      name: c.name,
      section: sectionFor(c.id, c.group),
      kind: 'generated',
      confidence: c.confidence,
    });
    for (const g of usable.filter((g) => g.after === c.id)) {
      natural.push({ id: g.id, name: g.name, section: sectionFor(g.id, 'community'), kind: 'google' });
    }
  }
  const anchors = new Set(GENERATED_CALENDARS.map((c) => c.id));
  for (const g of usable.filter((g) => !g.after || !anchors.has(g.after))) {
    natural.push({ id: g.id, name: g.name, section: sectionFor(g.id, 'community'), kind: 'google' });
  }

  // Anything the reader has arranged leads, in their order; the rest follows in
  // registry order, so a newly added calendar appears rather than vanishing.
  const rank = new Map(config.order.map((id, i) => [id, i]));
  return natural
    .map((entry, i) => ({ entry, key: rank.get(entry.id) ?? config.order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.entry);
}

