/**
 * Queensland public holidays.
 *
 * Appointed under the Holidays Act 1983 and published each year by the
 * Queensland Government at
 * https://www.qld.gov.au/recreation/travel/holidays/public
 *
 * There is no maintained machine-readable source to subscribe to: the national
 * dataset that once carried these (data.gov.au) is marked inactive and no
 * longer updated, Queensland's own open data portal has no holidays dataset,
 * and the government page offers neither iCal nor CSV. So they are computed
 * from the rules in the Act, which is stable and verifiable, rather than
 * scraped from a page that may be restructured at any time.
 *
 * TOWNSVILLE, NOT BRISBANE. The Royal Queensland Show holiday (the Ekka) is
 * Brisbane-only and is deliberately not included — a generic "Queensland
 * holidays" feed will list it and be wrong here. Townsville has its own show
 * holiday, which the Act appoints annually rather than fixing by rule; see the
 * note on showHoliday below.
 */

import { addDays, isoDate, weekday } from './astronomy.ts';
import { westernEaster } from './christian.ts';
import type { Occurrence } from './types.ts';
import { withinRange, yearsSpanned } from './types.ts';

const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;

/** The nth occurrence of a weekday in a month; n = 1 is the first. */
function nthWeekday(year: number, month: number, targetWeekday: number, n: number): string {
  const first = isoDate({ year, month, day: 1 });
  const shift = (targetWeekday - weekday(first) + 7) % 7;
  return addDays(first, shift + (n - 1) * 7);
}

function isWeekend(iso: string): boolean {
  const day = weekday(iso);
  return day === SATURDAY || day === SUNDAY;
}

/** The Monday on or after a date. */
function followingMonday(iso: string): string {
  return addDays(iso, (MONDAY - weekday(iso) + 7) % 7 || 7);
}

/**
 * Townsville's show holiday, appointed annually for the City of Townsville.
 *
 * It has fallen on the first Monday in July in every published year from 2021
 * to 2026, so that is what we compute — but because it is appointed rather than
 * fixed by rule, it is marked 'approximate' so it shows in the administrator's
 * "Dates to confirm" list and can be corrected against the official table.
 */
function showHoliday(year: number): string {
  return nthWeekday(year, 7, MONDAY, 1);
}

function make(
  key: string,
  name: string,
  date: string,
  year: number,
  extra: Partial<Occurrence> = {},
): Occurrence {
  return {
    calendarId: 'queensland',
    key: `${key}-${year}`,
    name,
    date,
    confidence: 'exact',
    ...extra,
  };
}

/** Queensland public holidays observed in Townsville, for a Gregorian year. */
export function queenslandHolidays(year: number): Occurrence[] {
  const out: Occurrence[] = [];
  const easter = westernEaster(year);

  const newYear = isoDate({ year, month: 1, day: 1 });
  out.push(make('new-year', "New Year's Day", newYear, year));
  // A weekend New Year's Day gains an extra holiday; it does not move.
  if (isWeekend(newYear)) {
    out.push(
      make('new-year-extra', "New Year's Day holiday", followingMonday(newYear), year, {
        note: "Additional holiday because New Year's Day falls on a weekend.",
      }),
    );
  }

  // Australia Day is observed on the Monday if it lands on a weekend — moved,
  // rather than gaining an extra day as Christmas does.
  const australiaDay = isoDate({ year, month: 1, day: 26 });
  out.push(
    make(
      'australia-day',
      'Australia Day',
      isWeekend(australiaDay) ? followingMonday(australiaDay) : australiaDay,
      year,
    ),
  );

  out.push(make('good-friday', 'Good Friday', addDays(easter, -2), year));
  out.push(make('easter-saturday', 'Day after Good Friday', addDays(easter, -1), year));
  out.push(make('easter-sunday', 'Easter Sunday', easter, year));
  out.push(make('easter-monday', 'Easter Monday', addDays(easter, 1), year));

  // Anzac Day moves only for a Sunday. A Saturday Anzac Day stays put.
  const anzac = isoDate({ year, month: 4, day: 25 });
  out.push(
    make('anzac-day', 'Anzac Day', weekday(anzac) === SUNDAY ? addDays(anzac, 1) : anzac, year),
  );

  out.push(make('labour-day', 'Labour Day', nthWeekday(year, 5, MONDAY, 1), year));

  out.push(
    make('show-holiday', 'Townsville Show Holiday', showHoliday(year), year, {
      confidence: 'approximate',
      note: 'Appointed each year for the City of Townsville. Confirm against the published show holiday dates.',
    }),
  );

  out.push(make('kings-birthday', "King's Birthday", nthWeekday(year, 10, MONDAY, 1), year));

  out.push(
    make('christmas-eve', 'Christmas Eve (part-day)', isoDate({ year, month: 12, day: 24 }), year, {
      note: 'A part-day public holiday, from 6pm to midnight.',
    }),
  );

  const christmas = isoDate({ year, month: 12, day: 25 });
  const boxing = isoDate({ year, month: 12, day: 26 });
  out.push(make('christmas-day', 'Christmas Day', christmas, year));
  out.push(make('boxing-day', 'Boxing Day', boxing, year));

  // When Christmas or Boxing Day falls on a weekend the Act adds a further
  // holiday on 27 or 28 December respectively, rather than moving the day
  // itself — so both the original and the substitute are holidays.
  if (isWeekend(christmas)) {
    out.push(
      make('christmas-extra', 'Christmas Day holiday', isoDate({ year, month: 12, day: 27 }), year, {
        note: 'Additional holiday because Christmas Day falls on a weekend.',
      }),
    );
  }
  if (isWeekend(boxing)) {
    out.push(
      make('boxing-extra', 'Boxing Day holiday', isoDate({ year, month: 12, day: 28 }), year, {
        note: 'Additional holiday because Boxing Day falls on a weekend.',
      }),
    );
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function generateQueensland(from: string, to: string): Occurrence[] {
  return withinRange(yearsSpanned(from, to).flatMap(queenslandHolidays), from, to);
}
