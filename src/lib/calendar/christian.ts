/**
 * Christian and Orthodox Christian holy days.
 *
 * Both are exactly computable. Western Easter uses the Gregorian computus
 * (Meeus/Jones/Butcher); Orthodox Easter uses the Julian computus, with the
 * resulting Julian date converted to the Gregorian calendar. Everything movable
 * is an offset from Easter; the rest are fixed civil dates.
 */

import { addDays, isoDate, jdToGregorian, weekday } from './astronomy.ts';
import type { Occurrence } from './types.ts';
import { withinRange, yearsSpanned } from './types.ts';

/** Gregorian (Western) Easter Sunday for a year, as an ISO date. */
export function westernEaster(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return isoDate({ year, month: Math.floor(n / 31), day: (n % 31) + 1 });
}

/** Julian Day for a date in the Julian calendar. */
function julianCalendarToJD(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day - 1524.5;
}

/** Gregorian ISO date for a Julian-calendar date. */
function julianToIso(year: number, month: number, day: number): string {
  return isoDate(jdToGregorian(julianCalendarToJD(year, month, day) + 0.5));
}

/** Orthodox Easter (Pascha) for a year, as a Gregorian ISO date. */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const n = d + e + 114;
  // This is a date in the Julian calendar; convert it.
  return julianToIso(year, Math.floor(n / 31), (n % 31) + 1);
}

/** The Sunday that begins Advent — the fourth Sunday before Christmas. */
function adventSunday(year: number): string {
  const christmas = isoDate({ year, month: 12, day: 25 });
  // Step back to the Sunday on or before Christmas, then back three more weeks.
  const back = weekday(christmas);
  return addDays(christmas, -(back === 0 ? 7 : back) - 21);
}

function occ(
  calendarId: string,
  key: string,
  name: string,
  date: string,
  extra: Partial<Occurrence> = {},
): Occurrence {
  return { calendarId, key, name, date, confidence: 'exact', ...extra };
}

/** Western Christian holy days for a Gregorian year. */
export function christianHolyDays(year: number): Occurrence[] {
  const id = 'christian';
  const easter = westernEaster(year);
  const off = (n: number) => addDays(easter, n);
  return [
    occ(id, 'epiphany', 'Epiphany', isoDate({ year, month: 1, day: 6 }), {
      note: 'Commemorates the manifestation of God in human form, and the visit of the Magi.',
    }),
    occ(id, 'ash-wednesday', 'Ash Wednesday', off(-46), { note: 'The first day of Lent.' }),
    occ(id, 'lent', 'Lent', off(-46), {
      // Ends at Maundy Thursday, following the Faith Communities Council of
      // Victoria multifaith calendar, whose definition we follow for consistency.
      endDate: off(-3),
      note: 'Forty days of fasting and reflection before Easter, not counting Sundays.',
    }),
    occ(id, 'palm-sunday', 'Palm Sunday', off(-7)),
    occ(id, 'holy-week', 'Holy Week', off(-7), { endDate: off(-1) }),
    occ(id, 'maundy-thursday', 'Maundy Thursday', off(-3)),
    occ(id, 'good-friday', 'Good Friday', off(-2), {
      note: 'Commemorates the crucifixion of Jesus Christ.',
    }),
    occ(id, 'easter', 'Easter Sunday', easter, {
      note: 'Celebrates the resurrection of Jesus Christ. The principal feast of the Christian year.',
    }),
    occ(id, 'ascension', 'Ascension Day', off(39)),
    occ(id, 'pentecost', 'Pentecost', off(49), {
      note: 'Commemorates the descent of the Holy Spirit upon the apostles.',
    }),
    occ(id, 'trinity-sunday', 'Trinity Sunday', off(56)),
    occ(id, 'assumption', 'Assumption of Mary', isoDate({ year, month: 8, day: 15 })),
    occ(id, 'all-saints', 'All Saints’ Day', isoDate({ year, month: 11, day: 1 })),
    occ(id, 'advent', 'Advent', adventSunday(year), {
      endDate: isoDate({ year, month: 12, day: 24 }),
      note: 'The season of preparation for Christmas, beginning four Sundays before.',
    }),
    occ(id, 'christmas', 'Christmas Day', isoDate({ year, month: 12, day: 25 }), {
      note: 'Celebrates the birth of Jesus Christ.',
    }),
  ];
}

/** Orthodox Christian holy days for a Gregorian year. */
export function orthodoxHolyDays(year: number): Occurrence[] {
  const id = 'orthodox';
  const pascha = orthodoxEaster(year);
  const off = (n: number) => addDays(pascha, n);
  return [
    occ(id, 'nativity', 'Nativity [Orthodox]', julianToIso(year, 12, 25), {
      note: 'Orthodox celebration of the birth of Jesus Christ, on the Julian calendar.',
    }),
    occ(id, 'theophany', 'Theophany [Orthodox]', julianToIso(year, 1, 6), {
      note: 'Also called the Feast of Epiphany — commemorates Christ’s baptism in the Jordan.',
    }),
    occ(id, 'clean-monday', 'Clean Monday', off(-48), { note: 'The first day of Great Lent.' }),
    occ(id, 'great-lent', 'Great Lent', off(-48), { endDate: off(-9) }),
    occ(id, 'palm-sunday', 'Palm Sunday [Orthodox]', off(-7)),
    occ(id, 'good-friday', 'Great Friday [Orthodox]', off(-2)),
    occ(id, 'pascha', 'Pascha (Orthodox Easter)', pascha, {
      note: 'The Orthodox celebration of the resurrection, dated by the Julian computus.',
    }),
    occ(id, 'ascension', 'Ascension [Orthodox]', off(39)),
    occ(id, 'pentecost', 'Pentecost [Orthodox]', off(49)),
    occ(id, 'transfiguration', 'Transfiguration [Orthodox]', julianToIso(year, 8, 6)),
    occ(id, 'dormition', 'Dormition of the Theotokos', julianToIso(year, 8, 15)),
  ];
}

export function generateChristian(fromIso: string, toIso: string): Occurrence[] {
  return withinRange(yearsSpanned(fromIso, toIso).flatMap(christianHolyDays), fromIso, toIso);
}

export function generateOrthodox(fromIso: string, toIso: string): Occurrence[] {
  return withinRange(yearsSpanned(fromIso, toIso).flatMap(orthodoxHolyDays), fromIso, toIso);
}
