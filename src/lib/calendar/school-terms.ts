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
 * administrator to fill in; Victoria can fetch its own.
 *
 * 2026 onward comes from the department's current pages. 2019 to 2025 comes
 * from captures of that same page taken during each of those years, because a
 * year is removed once it has passed — cycles that have already happened are
 * still worth looking back at. Only in-year captures were used: the archive
 * will happily answer with the nearest page it has, which is how four
 * different years first came back carrying one year's dates. Every row is
 * checked to start and end on a weekday, which is what caught it.
 *
 * Nothing before 2019 exists in the archive for this page. Cycles earlier than
 * that fall back to the Plan's own quarters.
 */
export const BUNDLED_TERMS: Partial<Record<AuStateId, SchoolTerm[]>> = {
  qld: [
    { year: 2019, term: 1, start: '2019-01-29', end: '2019-04-05' },
    { year: 2019, term: 2, start: '2019-04-23', end: '2019-06-28' },
    { year: 2019, term: 3, start: '2019-07-15', end: '2019-09-20' },
    { year: 2019, term: 4, start: '2019-10-08', end: '2019-12-13' },
    { year: 2020, term: 1, start: '2020-01-28', end: '2020-04-03' },
    { year: 2020, term: 2, start: '2020-04-20', end: '2020-06-26' },
    { year: 2020, term: 3, start: '2020-07-13', end: '2020-09-18' },
    { year: 2020, term: 4, start: '2020-10-06', end: '2020-12-11' },
    { year: 2021, term: 1, start: '2021-01-27', end: '2021-04-01' },
    { year: 2021, term: 2, start: '2021-04-19', end: '2021-06-25' },
    { year: 2021, term: 3, start: '2021-07-12', end: '2021-09-17' },
    { year: 2021, term: 4, start: '2021-10-05', end: '2021-12-10' },
    { year: 2022, term: 1, start: '2022-01-24', end: '2022-04-01' },
    { year: 2022, term: 2, start: '2022-04-19', end: '2022-06-24' },
    { year: 2022, term: 3, start: '2022-07-11', end: '2022-09-16' },
    { year: 2022, term: 4, start: '2022-10-04', end: '2022-12-09' },
    { year: 2023, term: 1, start: '2023-01-23', end: '2023-03-31' },
    { year: 2023, term: 2, start: '2023-04-17', end: '2023-06-23' },
    { year: 2023, term: 3, start: '2023-07-10', end: '2023-09-15' },
    { year: 2023, term: 4, start: '2023-10-03', end: '2023-12-08' },
    { year: 2024, term: 1, start: '2024-01-22', end: '2024-03-28' },
    { year: 2024, term: 2, start: '2024-04-15', end: '2024-06-21' },
    { year: 2024, term: 3, start: '2024-07-08', end: '2024-09-13' },
    { year: 2024, term: 4, start: '2024-09-30', end: '2024-12-13' },
    { year: 2025, term: 1, start: '2025-01-28', end: '2025-04-04' },
    { year: 2025, term: 2, start: '2025-04-22', end: '2025-06-27' },
    { year: 2025, term: 3, start: '2025-07-14', end: '2025-09-19' },
    { year: 2025, term: 4, start: '2025-10-07', end: '2025-12-12' },
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
 * The day a cycle begins: the first day of the holidays.
 *
 * Term almost always ends on a Friday, but not always — Queensland's first
 * term of 2026 ends on the Thursday before Good Friday. Either way the cycle
 * opens the next morning. Where that lands in the week is a question for the
 * grid, not for the date.
 */
export function holidayStart(termEnd: string): string {
  return addDays(termEnd, 1);
}

/** Cycle boundaries implied by a set of term dates. */
export function boundariesFromTerms(terms: SchoolTerm[]): string[] {
  return [...new Set(terms.map((t) => holidayStart(t.end)))].sort();
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
 * The final boundary opens a cycle that cannot be closed until the next date
 * is known, so it yields one cycle fewer than there are boundaries. That is
 * honest: showing a cycle whose end was invented would be worse than showing
 * one cycle less.
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

/** How many cycles the planner shows: the one running, and eight ahead. */
export const CYCLES_SHOWN = 9;

/**
 * The cycles worth looking at.
 *
 * A cycle that has finished cannot be planned and does not need adjusting, so
 * it drops off the list rather than accumulating. As each one ends the rest
 * move up and a blank appears at the bottom, to be filled in when the date is
 * known.
 */
export function upcomingCycles(
  boundaries: string[],
  today: string,
  count: number = CYCLES_SHOWN,
): Cycle[] {
  const all = cyclesFromBoundaries(boundaries);
  const from = all.findIndex((c) => c.end >= today);
  return from < 0 ? [] : all.slice(from, from + count);
}

/**
 * The first day of the week a date falls in.
 *
 * A cycle begins when the holidays do, which can be any day; the grid still
 * has to open on whichever day the reader has chosen, so the first row reaches
 * back to it.
 */
export function startOfWeek(iso: string, weekStart: WeekDay): string {
  return addDays(iso, -(((weekday(iso) - weekStart) % 7 + 7) % 7));
}

/** The weeks a cycle occupies once it is snapped out to whole weeks. */
export function cycleWeekStarts(cycle: Cycle, weekStart: WeekDay): string[] {
  const weeks: string[] = [];
  let day = startOfWeek(cycle.start, weekStart);
  while (day <= cycle.end) {
    weeks.push(day);
    day = addDays(day, 7);
  }
  return weeks;
}

// ---- phases ----------------------------------------------------------------

export type PhaseId = 'expansion' | 'consolidation' | 'reflection';

export const PHASES: { id: PhaseId; name: string }[] = [
  { id: 'expansion', name: 'Expansion' },
  { id: 'consolidation', name: 'Consolidation' },
  { id: 'reflection', name: 'Planning & Reflection' },
];

export interface PhasePlan {
  expansionWeeks: number;
  reflectionWeeks: number;
}

export const DEFAULT_PHASE_PLAN: PhasePlan = { expansionWeeks: 2, reflectionWeeks: 2 };

/**
 * Which phase a week belongs to.
 *
 * Expansion opens the cycle and Planning & Reflection closes it, both at a
 * fixed number of weeks; consolidation is whatever lies between, which is why
 * it absorbs the difference between a twelve-week cycle and a sixteen-week one.
 *
 * A short cycle could be asked for more weeks than it has. Rather than let the
 * two ends overlap — which would put a week in two phases at once — expansion
 * is honoured first and reflection takes what is left.
 */
export function phaseForWeek(week: number, totalWeeks: number, plan: PhasePlan): PhaseId {
  const expansion = Math.max(0, Math.min(Math.floor(plan.expansionWeeks), totalWeeks));
  const reflection = Math.max(0, Math.min(Math.floor(plan.reflectionWeeks), totalWeeks - expansion));
  if (week <= expansion) return 'expansion';
  if (week > totalWeeks - reflection) return 'reflection';
  return 'consolidation';
}

/** Each phase as a run of consecutive weeks, so a label can be drawn once. */
export function phaseRuns(
  totalWeeks: number,
  plan: PhasePlan,
): { phase: PhaseId; from: number; weeks: number }[] {
  const runs: { phase: PhaseId; from: number; weeks: number }[] = [];
  for (let week = 1; week <= totalWeeks; week += 1) {
    const phase = phaseForWeek(week, totalWeeks, plan);
    const last = runs[runs.length - 1];
    if (last && last.phase === phase) last.weeks += 1;
    else runs.push({ phase, from: week, weeks: 1 });
  }
  return runs;
}

// ---- phase colours ---------------------------------------------------------

/**
 * Pastels, because these columns run the whole height of the grid beside the
 * days. A saturated band there would pull the eye away from the dates, which
 * are what the view is for.
 */
export const PASTEL_COLOURS: { id: string; label: string; value: string }[] = [
  { id: 'apricot', label: 'Apricot', value: '#f6e2cd' },
  { id: 'blush', label: 'Blush', value: '#f2dcdc' },
  { id: 'sand', label: 'Sand', value: '#efe6d2' },
  { id: 'sage', label: 'Sage', value: '#dbe7d4' },
  { id: 'mint', label: 'Mint', value: '#d6e8e2' },
  { id: 'sky', label: 'Sky', value: '#d9e6f2' },
  { id: 'lilac', label: 'Lilac', value: '#e3dcef' },
  { id: 'stone', label: 'Stone', value: '#e6e4df' },
];

export type PhaseColours = Record<PhaseId, string>;

export const DEFAULT_PHASE_COLOURS: PhaseColours = {
  expansion: 'apricot',
  consolidation: 'sage',
  reflection: 'lilac',
};

export function pastelValue(id: string): string {
  return (PASTEL_COLOURS.find((c) => c.id === id) ?? PASTEL_COLOURS[0]).value;
}
