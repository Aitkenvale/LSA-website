/**
 * The three generated Bahá'í calendars: Months, Feast and Holy Days.
 *
 * Bahá'í Months and Holy Days are wholly computed. The Feast is computed with an
 * override: a community may hold its Feast on any day of the Bahá'í month, and
 * commonly does when the first day is awkward, so each Feast carries a default
 * (the first day of the month) that an administrator can move.
 */

import { addDays } from './astronomy.ts';
import {
  ayyamIHaRange,
  badiHolyDays,
  badiMonthStarts,
  badiToGregorian,
  fastRange,
  gregorianToBadi,
  nawRuz,
  nawRuzConfidence,
} from './badi.ts';
import type { Occurrence } from './types.ts';
import { withinRange } from './types.ts';

/** Bahá'í years overlapping a Gregorian window. */
function badiYearsFor(fromIso: string, toIso: string): number[] {
  const first = gregorianToBadi(fromIso).year;
  const last = gregorianToBadi(toIso).year;
  const years: number[] = [];
  for (let y = first - 1; y <= last + 1; y += 1) years.push(y);
  return years;
}

/**
 * Where a community holds its Nineteen Day Feast, when not on the first day of
 * the month. Keyed "<badiYear>-<monthNumber>", valued as the day of the Bahá'í
 * month (1–19). Administrator-editable; the default is always day 1.
 */
export type FeastOverrides = Record<string, number>;

export function feastOverrideKey(badiYear: number, monthNumber: number): string {
  return `${badiYear}-${monthNumber}`;
}

/** Bahá'í Months — the nineteen month beginnings, plus Ayyám-i-Há and the Fast. */
export function generateBahaiMonths(fromIso: string, toIso: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const year of badiYearsFor(fromIso, toIso)) {
    for (const start of badiMonthStarts(year)) {
      if (start.month.number === 0) continue; // Ayyám-i-Há is listed separately below
      out.push({
        calendarId: 'bahai-months',
        key: `month-${year}-${start.month.number}`,
        name: `${start.month.name} (${start.month.meaning})`,
        date: start.date,
        endDate: addDays(badiToGregorian(year, start.month.number, 19), 0),
        startsPreviousEvening: true,
        note: `Month ${start.month.number} of ${year} B.E.`,
        confidence: 'exact',
      });
    }
    const ayyam = ayyamIHaRange(year);
    out.push({
      calendarId: 'bahai-months',
      key: `ayyam-i-ha-${year}`,
      name: 'Ayyám-i-Há',
      date: ayyam.start,
      endDate: ayyam.end,
      startsPreviousEvening: true,
      note: `${ayyam.length} intercalary days of hospitality and charity, preceding the Fast.`,
      confidence: 'exact',
    });
    const fast = fastRange(year);
    out.push({
      calendarId: 'bahai-months',
      key: `fast-${year}`,
      name: 'The Fast',
      date: fast.start,
      endDate: fast.end,
      startsPreviousEvening: true,
      note: 'The month of ‘Alá’ — nineteen days of fasting from sunrise to sunset.',
      confidence: 'exact',
    });
  }
  return withinRange(out, fromIso, toIso);
}

/**
 * Bahá'í Feast — the Nineteen Day Feast for each month.
 *
 * Date only, by decision: the time and programme of a Feast are shared through
 * the community's own channels, not published on the calendar.
 */
export function generateBahaiFeast(
  fromIso: string,
  toIso: string,
  overrides: FeastOverrides = {},
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const year of badiYearsFor(fromIso, toIso)) {
    for (const start of badiMonthStarts(year)) {
      if (start.month.number === 0) continue;
      const day = overrides[feastOverrideKey(year, start.month.number)] ?? 1;
      const moved = day !== 1;
      out.push({
        calendarId: 'bahai-feast',
        key: `feast-${year}-${start.month.number}`,
        name: `Feast of ${start.month.name} (${start.month.meaning})`,
        date: badiToGregorian(year, start.month.number, day),
        startsPreviousEvening: true,
        note: moved
          ? `Held on ${day} ${start.month.name} — moved from the first day of the month.`
          : undefined,
        confidence: 'exact',
      });
    }
  }
  return withinRange(out, fromIso, toIso);
}

/** Bahá'í Holy Days — the eleven Holy Days, nine of which suspend work. */
export function generateBahaiHolyDays(fromIso: string, toIso: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const year of badiYearsFor(fromIso, toIso)) {
    const uncertain = nawRuzConfidence(year) === 'marginal';
    for (const h of badiHolyDays(year)) {
      out.push({
        calendarId: 'bahai-holy-days',
        key: `${h.key}-${year}`,
        name: h.name,
        date: h.date,
        startsPreviousEvening: true,
        workSuspended: h.workSuspended,
        note: uncertain
          ? `Naw-Rúz for ${year} B.E. falls too near Tehran sunset to compute reliably — confirm against the published dates.`
          : undefined,
        confidence: uncertain ? 'approximate' : 'exact',
      });
    }
  }
  return withinRange(out, fromIso, toIso);
}

export { nawRuz, nawRuzConfidence };
