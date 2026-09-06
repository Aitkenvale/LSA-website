/**
 * The global Plans, and where a local cycle sits inside one.
 *
 * A Plan is the framework the whole Bahá'í world works to — the Nine Year
 * Plan, and the shorter Plans before it. Each begins at Riḍván and its cycles
 * are numbered from one, which is why a cycle is spoken of as "183–18": the
 * eighteenth cycle, in the year 183 B.E.
 *
 * Plans are sequential and never overlap, so a list of names with their Riḍván
 * start dates says everything: a Plan runs until the next one begins. Keeping
 * the finished ones matters, because looking back at a past cycle should name
 * the Plan it belonged to rather than the current one.
 *
 * The local cycles are not the Plan's cycles. Ours follow the school terms so
 * that a cycle does not open in the week children go back; the Plan's follow
 * Riḍván. They run at the same rate — four a year — and drift by a fortnight
 * or so, which is near enough for one to be numbered by the other.
 */

import { parseIso } from './astronomy.ts';

export interface Plan {
  name: string;
  /** First day of the Plan, always a Riḍván. */
  start: string;
}

/**
 * The Plans this calendar ships knowing about.
 *
 * Enough history to name any cycle the planner can reach, and no more. The
 * next Plan is not here because it has not been announced; an administrator
 * adds it when it is, and cycles browsed beyond that date take its name.
 */
export const DEFAULT_PLANS: Plan[] = [
  { name: 'Five Year Plan', start: '2016-04-20' },
  { name: 'One Year Plan', start: '2021-04-20' },
  { name: 'Nine Year Plan', start: '2022-04-22' },
];

/** Whole months from one date to another, counting a part-month as none. */
export function monthsBetween(from: string, to: string): number {
  const a = parseIso(from);
  const b = parseIso(to);
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  return b.day < a.day ? months - 1 : months;
}

export function sortPlans(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** The Plan running on a given day, or null if it precedes the first one. */
export function planAt(iso: string, plans: Plan[]): Plan | null {
  const sorted = sortPlans(plans);
  let found: Plan | null = null;
  for (const plan of sorted) {
    if (plan.start <= iso) found = plan;
    else break;
  }
  return found;
}

/** The day a Plan ends: the day before the next begins, or unknown. */
export function planEnd(plan: Plan, plans: Plan[]): string | null {
  const sorted = sortPlans(plans);
  const next = sorted.find((p) => p.start > plan.start);
  if (!next) return null;
  const d = parseIso(next.start);
  const prev = new Date(Date.UTC(d.year, d.month - 1, d.day - 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * A local cycle's midpoint, which is what decides the Plan cycle it belongs to.
 *
 * Not its first day. A local cycle opens when the school holidays do, up to a
 * fortnight before or after the Plan's own quarter turns, so its first day
 * regularly falls in the previous Plan cycle and would number it one too low.
 * The middle of a twelve-week cycle is six weeks from either boundary, which
 * no drift of this size can push across.
 */
export function cycleMidpoint(start: string, end: string): string {
  const a = parseIso(start);
  const b = parseIso(end);
  const from = Date.UTC(a.year, a.month - 1, a.day);
  const to = Date.UTC(b.year, b.month - 1, b.day);
  return new Date(from + Math.floor((to - from) / 2)).toISOString().slice(0, 10);
}

/**
 * Which of a Plan's cycles a local cycle corresponds to.
 *
 * The Plan's cycles are three months each from its Riḍván, so the number is
 * simply how many quarters have passed, counting from one. Null when the cycle
 * falls before the Plan began.
 */
export function planCycleNumber(midpoint: string, plan: Plan): number | null {
  if (midpoint < plan.start) return null;
  return Math.floor(monthsBetween(plan.start, midpoint) / 3) + 1;
}

export interface CycleNaming {
  plan: Plan | null;
  number: number | null;
  /** "Cycle 18 — Nine Year Plan", or a bare cycle when no Plan covers it. */
  label: string;
}

export function nameCycle(start: string, end: string, plans: Plan[]): CycleNaming {
  const midpoint = cycleMidpoint(start, end);
  const plan = planAt(midpoint, plans);
  const number = plan ? planCycleNumber(midpoint, plan) : null;
  const label = plan && number ? `Cycle ${number} — ${plan.name}` : 'Cycle';
  return { plan, number, label };
}

/**
 * Cycle boundaries taken from a Plan's own quarters.
 *
 * Used only where the local dates run out. Queensland stops publishing a
 * year's term dates once it has passed, and the web archive holds nothing for
 * this page before 2019, so cycles earlier than that cannot be reconstructed
 * from the holidays. The Plan's quarters can: they run from its Riḍván, three
 * months apart, which is what our local cycles approximate anyway.
 *
 * These are shown as the Plan's dates rather than passed off as the
 * community's, because they are not the weeks anyone actually worked to —
 * only the right frame for a cycle number.
 */
export function planQuarterBoundaries(plans: Plan[], before: string): string[] {
  const sorted = sortPlans(plans);
  const dates: string[] = [];

  /*
   * A quarter falling days before the next boundary — whether that is the next
   * Plan's Riḍván or the first real term date — would make a stub cycle of a
   * week or two, which is not a cycle anyone planned. Six weeks is the drift
   * the two systems can genuinely differ by, so anything closer is dropped in
   * favour of the date that follows it.
   */
  const GAP_DAYS = 42;
  const daysApart = (a: string, b: string) =>
    (new Date(b).getTime() - new Date(a).getTime()) / 86400000;

  for (let i = 0; i < sorted.length; i += 1) {
    const plan = sorted[i];
    const stop = sorted[i + 1]?.start ?? before;
    const from = parseIso(plan.start);
    for (let q = 0; ; q += 1) {
      const iso = new Date(Date.UTC(from.year, from.month - 1 + q * 3, from.day))
        .toISOString().slice(0, 10);
      if (iso >= stop || iso >= before) break;
      // The Plan's own first day always stands, however close the next lies.
      if (q > 0 && (daysApart(iso, stop) < GAP_DAYS || daysApart(iso, before) < GAP_DAYS)) break;
      dates.push(iso);
    }
  }
  return [...new Set(dates)].sort();
}
