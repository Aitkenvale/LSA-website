/**
 * The Hijri calendar and the Islamic observances.
 *
 * IMPORTANT: unlike the Bahá'í, Christian and Jewish calendars in this folder,
 * the Hijri calendar is observational — a month begins when the new crescent is
 * actually sighted, and authorities in different countries reach different
 * conclusions for the same month. There is no algorithm that is "correct".
 *
 * What we compute here is the common astronomical approximation used by
 * published calendars: a month begins on the day following the day of the
 * astronomical new moon, reckoned at Mecca. In practice this agrees with local
 * observance most of the time and is a day out otherwise, which is why every
 * occurrence generated here is marked 'approximate'.
 */

import {
  addDays,
  gregorianToJD,
  isoDate,
  jdToGregorian,
  moonPhase,
  tdToUt,
  type GeoLocation,
} from './astronomy.ts';
import type { Occurrence } from './types.ts';
import { withinRange } from './types.ts';

const MECCA: GeoLocation = { latitude: 21.4225, longitude: 39.8262, utcOffsetHours: 3 };

/**
 * Lunation number whose following day is 1 Muharram of year 1 A.H.
 * Calibrated so that 1 Muharram 1447 falls on 26 June 2025.
 */
const K_EPOCH = -17037;

export const HIJRI_MONTHS = [
  'Muharram', 'Safar', 'Rabi‘ al-awwal', 'Rabi‘ al-thani',
  'Jumada al-awwal', 'Jumada al-thani', 'Rajab', 'Sha‘ban',
  'Ramadan', 'Shawwal', 'Dhu al-Qi‘dah', 'Dhu al-Hijjah',
];

/** Gregorian ISO date on which Hijri month `month` (1–12) of `year` begins. */
export function hijriMonthStart(year: number, month: number): string {
  const k = K_EPOCH + (year - 1) * 12 + (month - 1);
  const newMoonUt = tdToUt(moonPhase(k));
  // Civil date at Mecca on which the conjunction occurs; the month begins the
  // following day, the first on which the crescent could be seen after sunset.
  const meccaDate = isoDate(jdToGregorian(newMoonUt + MECCA.utcOffsetHours / 24));
  return addDays(meccaDate, 1);
}

/** Gregorian ISO date for a Hijri year/month/day. */
export function hijriToGregorian(year: number, month: number, day: number): string {
  return addDays(hijriMonthStart(year, month), day - 1);
}

/** Days in a Hijri month, from the interval between successive new moons. */
export function hijriMonthLength(year: number, month: number): number {
  const next = month === 12 ? hijriMonthStart(year + 1, 1) : hijriMonthStart(year, month + 1);
  const start = hijriMonthStart(year, month);
  const p = start.split('-').map(Number);
  const q = next.split('-').map(Number);
  return Math.round(gregorianToJD(q[0], q[1], q[2]) - gregorianToJD(p[0], p[1], p[2]));
}

/** Islamic observances for a Hijri year, as Gregorian dates. */
export function islamicHolyDays(hijriYear: number): Occurrence[] {
  const id = 'islam';
  const g = (m: number, d: number) => hijriToGregorian(hijriYear, m, d);
  const make = (
    key: string,
    name: string,
    date: string,
    extra: Partial<Occurrence> = {},
  ): Occurrence => ({
    calendarId: id,
    key: `${key}-${hijriYear}`,
    name,
    date,
    // The Islamic day begins at sunset.
    startsPreviousEvening: true,
    confidence: 'approximate',
    ...extra,
  });

  const ramadanStart = g(9, 1);
  const ramadanLength = hijriMonthLength(hijriYear, 9);

  return [
    make('hijra', 'Hijra (Islamic New Year)', g(1, 1), {
      note: `Begins the Hijri year ${hijriYear} A.H., marking the migration of the Prophet Muhammad to Medina.`,
    }),
    make('ashura', 'Ashura', g(1, 10)),
    make('mawlid', 'Mawlid an-Nabi', g(3, 12), {
      note: 'Commemorates the birth of the Prophet Muhammad.',
    }),
    make('lailat-al-miraj', 'Lailat al Miraj', g(7, 27), {
      note: 'The Night Journey — the Prophet Muhammad’s journey to Jerusalem and ascension.',
    }),
    make('lailat-al-baraah', 'Lailat al Bara’ah', g(8, 15), {
      note: 'The night of salvation, on which forgiveness is sought.',
    }),
    make('ramadan', 'Ramadan', ramadanStart, {
      endDate: addDays(ramadanStart, ramadanLength - 1),
      note: 'The month of fasting, commemorating the revelation of the Qur’an.',
    }),
    make('lailat-al-qadr', 'Lailat al Qadr', g(9, 27), {
      note: 'The Night of Power, commemorating the first revelation of the Qur’an.',
    }),
    make('eid-al-fitr', 'Eid al-Fitr', g(10, 1), {
      note: 'The festival marking the end of Ramadan.',
    }),
    make('arafah', 'Day of Arafah', g(12, 9)),
    make('eid-al-adha', 'Eid al-Adha', g(12, 10), {
      note: 'The Festival of Sacrifice, falling at the culmination of the Hajj.',
    }),
  ];
}

/** Hijri years that could contribute observances to a Gregorian window. */
function hijriYearsFor(fromIso: string, toIso: string): number[] {
  const toHijri = (gy: number) => Math.floor((gy - 622) * (33 / 32)) + 1;
  const first = toHijri(Number(fromIso.slice(0, 4))) - 1;
  const last = toHijri(Number(toIso.slice(0, 4))) + 1;
  const years: number[] = [];
  for (let y = first; y <= last; y += 1) years.push(y);
  return years;
}

export function generateIslamic(fromIso: string, toIso: string): Occurrence[] {
  return withinRange(hijriYearsFor(fromIso, toIso).flatMap(islamicHolyDays), fromIso, toIso);
}
