/**
 * School terms, and the planning cycles derived from them.
 *
 * A cycle is a planning period rather than a calendrical one: roughly three
 * months of activity ending in a reflection meeting. In practice communities
 * pin cycles to the school year, because that is what everybody else's life is
 * already pinned to — a cycle that begins mid-term asks families to start
 * something new in the same week the children go back.
 *
 * So the default is: a cycle begins when a term ends. Three terms are followed
 * by a fortnight's holiday and one by six weeks, which is where 12, 12, 12 and
 * 16 weeks comes from. It is only a default. Term lengths vary between nine and
 * eleven weeks, and an Assembly may have good reason to plan to a different
 * rhythm entirely, so every boundary can be overridden.
 *
 * The dates below are transcribed from each department's own published
 * calendar rather than fetched at run time. There is no feed worth depending
 * on: the national machine-readable dataset was abandoned by PM&C, only New
 * South Wales and Victoria publish term dates as data, and Queensland's own
 * open-data portal carries a request for them that has never been filled. The
 * alternative was six scrapers pointed at pages that get redesigned without
 * notice, failing silently inside a Worker at the moment somebody opened the
 * planning view. A table that is wrong is at least visibly wrong, and an
 * administrator can correct any date by hand.
 */

import { addDays, daysBetween, weekday } from './astronomy.ts';

export type AuStateId = 'act' | 'nsw' | 'nt' | 'qld' | 'sa' | 'tas' | 'vic' | 'wa';

export const AU_STATES: { id: AuStateId; name: string }[] = [
  { id: 'act', name: 'Australian Capital Territory' },
  { id: 'nsw', name: 'New South Wales' },
  { id: 'nt', name: 'Northern Territory' },
  { id: 'qld', name: 'Queensland' },
  { id: 'sa', name: 'South Australia' },
  { id: 'tas', name: 'Tasmania' },
  { id: 'vic', name: 'Victoria' },
  { id: 'wa', name: 'Western Australia' },
];

export function isAuState(value: unknown): value is AuStateId {
  return AU_STATES.some((s) => s.id === value);
}

/** Sunday is 0, matching the rest of the calendar's date helpers. */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * Only the three days a week is ever started on here.
 *
 * A cycle beginning on a Wednesday would put the boundary in the middle of a
 * row, which defeats the purpose of a planning grid.
 */
export const WEEK_START_CHOICES: WeekDay[] = [6, 0, 1];

export interface SchoolTerm {
  year: number;
  term: 1 | 2 | 3 | 4;
  /** First day of term, ISO. */
  start: string;
  /** Last day of term, ISO. */
  end: string;
}

export interface TermSource {
  name: string;
  url: string;
  /** When these dates were last read from that page. */
  checked: string;
}

/**
 * Term dates that ship with the calendar.
 *
 * Queensland only, because that is where this community is and because each
 * additional state means transcribing another department's calendar by hand.
 * Choosing a state with no table here leaves the dates blank for an
 * administrator to fill in; New South Wales and Victoria can fetch their own.
 */
export const BUNDLED_TERMS: Partial<Record<AuStateId, SchoolTerm[]>> = {
  qld: [
    { year: 2026, term: 1, start: '2026-01-27', end: '2026-04-02' },
    { year: 2026, term: 2, start: '2026-04-20', end: '2026-06-26' },
    { year: 2026, term: 3, start: '2026-07-13', end: '2026-09-18' },
    { year: 2026, term: 4, start: '2026-10-06', end: '2026-12-11' },
    { year: 2027, term: 1, start: '2027-01-27', end: '2027-03-25' },
    { year: 2027, term: 2, start: '2027-04-12', end: '2027-06-25' },
    { year: 2027, term: 3, start: '2027-07-12', end: '2027-09-17' },
    { year: 2027, term: 4, start: '2027-10-05', end: '2027-12-10' },
    { year: 2028, term: 1, start: '2028-01-24', end: '2028-03-31' },
    { year: 2028, term: 2, start: '2028-04-18', end: '2028-06-23' },
    { year: 2028, term: 3, start: '2028-07-10', end: '2028-09-15' },
    { year: 2028, term: 4, start: '2028-10-03', end: '2028-12-08' },
  ],
};

export const TERM_SOURCES: Partial<Record<AuStateId, TermSource>> = {
  qld: {
    name: 'Queensland Department of Education',
    url: 'https://education.qld.gov.au/about-us/calendar/term-dates',
    checked: '2026-09-07',
  },
};

/**
 * The states whose term dates can be fetched, because they publish them as data.
 *
 * Victoria only. New South Wales did publish term dates as a CSV and it looked
 * like the obvious second candidate, but the file stops at 2025 and Transport
 * for NSW have labelled it "Not updated anymore" — a feed that answers with
 * stale dates is worse than no feed, because nothing about the response says
 * it is out of date. Victoria's comes from its Department of Education, is
 * refreshed monthly and already carries 2026 through 2030.
 */
export const LOADABLE_STATES: AuStateId[] = ['vic'];

/**
 * Victoria's dates live in a general "important dates" file whose name carries
 * the month it was published, so the address is resolved through the catalogue
 * rather than written down. The resource id is stable; the filename is not.
 */
export const VIC_DATES_PACKAGE = 'a8bc540d-181b-4fb5-8110-5fe52a04f6a7';
export const VIC_CATALOGUE = 'https://discover.data.vic.gov.au/api/3/action/package_show';

export function canLoadTerms(state: AuStateId): boolean {
  return LOADABLE_STATES.includes(state);
}

/**
 * Where the calendar's own record of cycles begins.
 *
 * The bundled term dates start with 2026, because a department stops
 * publishing a year once it has passed — the cycle running through January
 * 2026 began in December 2025, and that date can no longer be read from
 * anywhere official. Rather than guess it, the series simply starts at the
 * beginning of 2026 and an administrator can move it earlier if they have the
 * date to hand.
 */
export const SERIES_START = '2026-01-01';

/**
 * The day a cycle begins, given the day term ended.
 *
 * Term almost always ends on a Friday, but not always — Queensland's first
 * term of 2026 ends on the Thursday before Good Friday. Taking the first
 * chosen weekday on or after the day after term ends handles both, and gives a
 * grid whose first row is a whole week.
 */
export function cycleStartAfter(termEnd: string, alignDay: WeekDay): string {
  let day = addDays(termEnd, 1);
  while (weekday(day) !== alignDay) day = addDays(day, 1);
  return day;
}

/** The first chosen weekday on or after a given date. */
export function alignOnOrAfter(from: string, alignDay: WeekDay): string {
  let day = from;
  while (weekday(day) !== alignDay) day = addDays(day, 1);
  return day;
}

/**
 * Cycle boundaries implied by a set of term dates.
 *
 * One boundary per term end, plus an opening boundary so that the first cycle
 * of the series is not lost for want of the previous year's dates.
 */
export function boundariesFromTerms(
  terms: SchoolTerm[],
  alignDay: WeekDay,
  seriesStart: string = SERIES_START,
): string[] {
  const found = new Set<string>([alignOnOrAfter(seriesStart, alignDay)]);
  for (const term of terms) found.add(cycleStartAfter(term.end, alignDay));
  return [...found].sort();
}

export interface Cycle {
  /** Position in the series, counting from one. */
  number: number;
  start: string;
  /** Last day of the cycle: the day before the next one begins. */
  end: string;
  weeks: number;
}

/**
 * Cycles between consecutive boundaries.
 *
 * The final boundary opens a cycle that cannot be closed until the next term's
 * dates are known, so it yields one cycle fewer than there are boundaries.
 * That is honest: showing a cycle whose end was invented would be worse than
 * showing one cycle less.
 */
export function cyclesFromBoundaries(boundaries: string[]): Cycle[] {
  const sorted = [...new Set(boundaries)].sort();
  const cycles: Cycle[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const start = sorted[i];
    const next = sorted[i + 1];
    cycles.push({
      number: i + 1,
      start,
      end: addDays(next, -1),
      weeks: Math.round(daysBetween(start, next) / 7),
    });
  }
  return cycles;
}

export function cycleContaining(iso: string, cycles: Cycle[]): Cycle | null {
  return cycles.find((c) => iso >= c.start && iso <= c.end) ?? null;
}
