/** Shared types for the calculated religious calendars. */

/**
 * How much to trust a generated date.
 *
 *  - 'exact'       Deterministic rule with no observational element. The date is
 *                  the date, and any published calendar will agree.
 *  - 'approximate' The tradition determines the date observationally (moon
 *                  sighting) or varies by region or school. We compute the
 *                  common astronomical answer; local observance may differ,
 *                  usually by a day.
 *  - 'verified'    Was approximate, and an administrator has since confirmed it
 *                  against an announcement or published source. See overrides.ts.
 */
export type Confidence = 'exact' | 'approximate' | 'verified';

export interface Occurrence {
  /** Which generated calendar produced this. */
  calendarId: string;
  /** Stable identifier within the calendar, for de-duplication. */
  key: string;
  name: string;
  /** Gregorian date, ISO "YYYY-MM-DD". */
  date: string;
  /** Inclusive last day, for observances spanning several days. */
  endDate?: string;
  /** Observance begins at sunset on the evening before `date`. */
  startsPreviousEvening?: boolean;
  /** Bahá'í Holy Days on which work is suspended. */
  workSuspended?: boolean;
  /** Short explanatory note, shown on hover or in the day detail. */
  note?: string;
  confidence: Confidence;
  /**
   * This observance is defined relative to another one and must move with it.
   * Mahavira Nirvana IS Diwali; Hola Mohalla is the day after Holi. Without
   * this, verifying one date would silently split a pair that has to stay
   * together.
   */
  linkedTo?: { key: string; offsetDays?: number };
}

/** A generated calendar: a faith's holy days, computed rather than entered. */
export interface GeneratedCalendarDef {
  id: string;
  name: string;
  /** Grouping used by the design: Bahá'í content leads, everything else is subordinate. */
  group: 'bahai' | 'other-faith';
  /** Default visibility for a fresh install. */
  defaultOn: boolean;
  /** Worst-case confidence of anything this calendar generates. */
  confidence: Confidence;
  /** Produce every occurrence between two ISO dates, inclusive. */
  generate(fromIso: string, toIso: string): Occurrence[];
}

/** Restrict a generated list to a window and sort it. */
export function withinRange(list: Occurrence[], fromIso: string, toIso: string): Occurrence[] {
  return list
    .filter((o) => (o.endDate ?? o.date) >= fromIso && o.date <= toIso)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Gregorian years spanned by a date window, with a year of padding either side. */
export function yearsSpanned(fromIso: string, toIso: string): number[] {
  const first = Number(fromIso.slice(0, 4)) - 1;
  const last = Number(toIso.slice(0, 4)) + 1;
  const years: number[] = [];
  for (let y = first; y <= last; y += 1) years.push(y);
  return years;
}
